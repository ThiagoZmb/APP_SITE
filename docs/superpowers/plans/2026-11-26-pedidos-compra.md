# Pedidos a fornecedor — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a partir do Estoque, sugerir o que comprar, montar o pedido ao fornecedor com PDF e acompanhar a chegada pela entrada de nota.

**Architecture:** regras puras em `calculo/pedidos_compra.js`; SQL compartilhado (saldo a caminho, baixa, desfazer) em `rotas/pedidos_compra_banco.js`, usado pelas rotas novas e pela entrada de estoque dentro da mesma transação; tela nova `pedidos_compra.html`.

**Tech Stack:** Node/Express, mysql2, pdfkit, HTML/JS puro, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-26-pedidos-compra-design.md` (ler junto; `CLAUDE.md` e `DESIGN.md` valem sempre).

## Global Constraints

- Nenhuma dependência nova. Rotas só por `rota(metodo, caminho, permissoes, handler)`.
- Permissões: toda rota nova exige `['estoque.ver', 'compras.ver']`; as que gravam, também `'compras.criar'`. Nenhuma é administrativa.
- Sem preços em lugar nenhum deste módulo. **Nome de campo JSON não pode casar com `REGEX_VALOR` de `seguranca/valores.js`** (a rede apaga): nada de `recebido`, `total`, `saldo`; use `chegou`, `falta`, `qtdUnidades`.
- Tabelas só `web_*`, criadas em `seguranca/instalacao.js`. Única escrita em tabela antiga: `estoque.AGUARDANDO` = `'Aguardando'` ou `''`.
- Quantidades: inteiras > 0, controladas em unidades do estoque; `porCaixa` inteiro de 1 a 100000.
- Situações: `rascunho`, `enviado`, `parcial`, `recebido`, `encerrado`, `cancelado`. Rótulo de `parcial`: "Chegou em parte".
- Datas locais por `hojeLocal`/`agoraLocal` (`rotas/transacao.js`), nunca `toISOString` na tela.
- Gravações em `emTransacao`; ordem de travas: linhas de `estoque` antes das linhas de pedido. Consultas independentes fora de transação saem juntas (`Promise.all`).
- Commits locais na `main`, um por tarefa, sem push; mensagem termina com `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Duplo clique em "Salvar" num pedido novo → um pedido só (a repetição dá 409).
2. Usuário sem `valores.ver` (Estoquista com `compras.ver`) → recebe `chegou`/`falta` intactos.
3. Nota com o mesmo produto em duas linhas e dois pedidos abertos → soma as linhas, abate do mais antigo, sobra ignorada.
4. Tela velha: "enviar", "editar" ou "excluir" num pedido que já mudou de situação → 409, nada muda.
5. Pedido com 80 itens e nomes muito longos → PDF em várias páginas, sem texto sobreposto nem item perdido.

---

### Task 1: Regras puras

**Files:** Create `calculo/pedidos_compra.js`, `test/pedidos_compra_calculo.test.js`

**Interfaces — Produces:**
- `quantidadeSugerida({ qtd, minimo, consumoDia, prazoDias, diasDados, aCaminho, porCaixa }) → number|null` (unidades). Conta: `max(minimo − qtd, diasDados >= 30 ? consumoDia × (prazoDias + 30) − qtd : 0) − aCaminho`; arredonda para cima (inteiro, depois múltiplo de `porCaixa`); `<= 0` → `null`.
- `entraNaSugestao({ qtd, minimo, alerta, consumoAno }) → boolean`: `(minimo > 0 && qtd <= minimo) || alerta === 'comprar' || (qtd <= 0 && consumoAno > 0)`.
- `montarSugestao({ analise, diasDados, produtos, aCaminho, rascunhos, porCaixa }) → Item[]`: `analise` = `itens` de `calcularAnalises`; `produtos` = Map código → `{ situacao, aguardando }` já filtrado pelo fornecedor; `aCaminho` = Map código → unidades; `rascunhos` = Map código → número do pedido; `porCaixa` = Map código → n. Só ativos. `Item = { codigo, produto, unidade, qtd, minimo, diasCobertura, aCaminho, porCaixa, sugerido, marcado, aviso }`.
  - `marcado = sugerido !== null && !rascunhos.has(codigo) && !(aguardando && !aCaminho)`.
  - `aviso`: `em rascunho nº N` | `marcado como aguardando fora destes pedidos` | `''`.
- `distribuirBaixa(abertos, chegada) → [{ itemId, pedidoId, produtoCodigo, qtd }]`: `abertos = [{ itemId, pedidoId, produtoCodigo, falta }]` já do mais antigo ao mais novo; `chegada` = Map código → qtd; não altera as entradas.
- `situacaoPelaChegada(atual, itens) → string`: `itens = [{ qtd, chegou }]`; `rascunho`/`encerrado`/`cancelado` ficam; todos `chegou >= qtd` → `recebido`; algum `chegou > 0` → `parcial`; senão `enviado`.
- `acaoPermitida(acao, situacao, algoChegou) → situacaoNova|null`: `enviar`: rascunho→enviado; `encerrar`: enviado|parcial→encerrado; `cancelar`: enviado sem nada chegado→cancelado.
- `validarPedido(corpo) → { erro } | { fornecedor, observacao, itens: [{ produtoCodigo, qtd, porCaixa }] }`: corpo `itens: [{ produtoCodigo, quantidade, porCaixa }]` (`quantidade` = caixas, ou unidades se `porCaixa` 1; `qtd = quantidade × porCaixa`); fornecedor obrigatório (190); observação até 2000; 1 a 300 itens; produto repetido é erro; `qtd` até 1000000.

- [ ] **Step 1: testes que falham**

```js
const base = { qtd: 4, minimo: 10, consumoDia: 0, prazoDias: 15, diasDados: 90, aCaminho: 0, porCaixa: 1 };
test('quantidade sugerida', () => {
  assert.equal(quantidadeSugerida(base), 6);
  assert.equal(quantidadeSugerida({ ...base, consumoDia: 1 }), 41);          // 1 × 45 − 4
  assert.equal(quantidadeSugerida({ ...base, consumoDia: 1, diasDados: 10 }), 6);
  assert.equal(quantidadeSugerida({ ...base, porCaixa: 50 }), 50);
  assert.equal(quantidadeSugerida({ ...base, aCaminho: 6 }), null);
  assert.equal(quantidadeSugerida({ ...base, qtd: 10 }), null);              // no mínimo: entra na lista, campo vazio
});
test('quem entra', () => {
  assert.ok(entraNaSugestao({ qtd: 10, minimo: 10, alerta: 'ok', consumoAno: 0 }));
  assert.ok(entraNaSugestao({ qtd: 0, minimo: 0, alerta: 'falta', consumoAno: 3 }));
  assert.ok(!entraNaSugestao({ qtd: 0, minimo: 0, alerta: 'falta', consumoAno: 0 }));
});
test('baixa: mais antigo primeiro, sobra ignorada', () => {
  const abertos = [{ itemId: 1, pedidoId: 1, produtoCodigo: 7, falta: 5 }, { itemId: 2, pedidoId: 2, produtoCodigo: 7, falta: 5 }];
  assert.deepEqual(distribuirBaixa(abertos, new Map([[7, 8]])).map(b => [b.itemId, b.qtd]), [[1, 5], [2, 3]]);
  assert.deepEqual(distribuirBaixa(abertos, new Map([[7, 30]])).map(b => b.qtd), [5, 5]);
  assert.equal(abertos[0].falta, 5);
});
```
Mais testes: `montarSugestao` (inativo fora; em rascunho e `Aguardando` sem pedido vêm desmarcados com o aviso exato); `situacaoPelaChegada` e `acaoPermitida` em todas as transições acima; `validarPedido` (`quantidade 2, porCaixa 50` → `qtd 100`; erro para 0, 1.5, repetido, sem itens, sem fornecedor).

- [ ] **Step 2:** `node --test test/pedidos_compra_calculo.test.js` → FAIL (módulo não existe).
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** rodar de novo → PASS.
- [ ] **Step 5:** commit `feat: regras dos pedidos a fornecedor`.

### Task 2: Permissões e tabelas

**Files:** Modify `seguranca/permissoes.js`, `seguranca/instalacao.js`, `index.js` (chamada na subida, junto de `acrescentarPermissoesPedidosAcoes`), `test/permissoes.test.js`; Create `test/pedidos_compra_instalacao.test.js`

**Interfaces — Produces:** permissões `compras.ver` ("Ver pedidos a fornecedor") e `compras.criar` ("Criar e enviar pedidos a fornecedor"), área `Estoque`, com linha em `DESCRICOES`; `acrescentarPermissoesCompras(pool) = desdobrarPermissoes(pool, 'permissoes_compras', [{ de: 'estoque.editar', para: ['compras.ver', 'compras.criar'] }])`; tabelas:

- `web_pedidos_compra`: `numero INT AUTO_INCREMENT PK`, `chave VARCHAR(64) NOT NULL UNIQUE`, `fornecedor VARCHAR(190) NOT NULL`, `situacao VARCHAR(12) NOT NULL`, `observacao TEXT`, `criado_em/criado_por`, `enviado_em/enviado_por`, `fechado_em/fechado_por` (encerrar ou cancelar); índice `(fornecedor, situacao)`.
- `web_pedidos_compra_itens`: `id` PK, `pedido_numero`, `produto_codigo`, `nome_produto`, `cod_fornecedor`, `nome_fornecedor`, `unidade`, `qtd INT`, `por_caixa INT`; índices por `pedido_numero` e `produto_codigo`.
- `web_pedidos_compra_baixas`: `id` PK, `item_id`, `nota VARCHAR(190)`, `fornecedor VARCHAR(190)`, `qtd INT`, `quando DATETIME`; índices `(nota, fornecedor)` e `item_id`.

- [ ] **Step 1:** testes: catálogo tem as duas, não administrativas; `CATALOGO.length` 80→82 e perfil Interno completo 58→60 em `test/permissoes.test.js`; Estoquista e Operador não ganham; migração roda uma vez (modelo: teste de migração em `test/notas_compra_tela.test.js:168`); `instalarTabelas` cria as três.
- [ ] **Step 2:** `npm test` → falham os novos.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** commit `feat: permissões e tabelas dos pedidos a fornecedor`.

### Task 3: Rotas dos pedidos

**Files:** Create `rotas/pedidos_compra.js`, `rotas/pedidos_compra_banco.js`, `test/apoio/bancoCompras.js`, `test/pedidos_compra_rotas.test.js`; Modify `rotas/estoque_analises.js`, `index.js`

**Interfaces — Consumes:** Task 1 e 2.
**Produces:**
- `rotas/estoque_analises.js`: `carregarAnalises(pool, { hoje, janela, verValores, classe }) → resultado de calcularAnalises` (extrair as consultas da rota, que passa a chamá-la; comportamento igual).
- `rotas/pedidos_compra_banco.js` (recebe `pool` ou `conn`, sem require de outras rotas):
  - `aCaminhoPorProduto(db, codigos?) → Map<codigo, unidades>` (itens de pedidos `enviado`/`parcial`, `qtd − baixas`, só positivos)
  - `marcarAguardando(conn, codigos)` (`'Aguardando'` se há unidades a caminho, senão `''`)
- `registrarPedidosCompra({ rota, pool })`, rotas nesta ordem:

| Rota | Resposta |
|---|---|
| `GET /pedidos_compra` | `[{ numero, fornecedor, situacao, criadoEm, enviadoEm, qtdItens }]`, mais novos primeiro |
| `GET /pedidos_compra/fornecedores` | todos de `cadastro_fornecedores`: `[{ fornecedor, qtdSugeridos }]`, maiores primeiro |
| `GET /pedidos_compra/sugestao?fornecedor=` | `{ itens: Item[] }` (janela 90) |
| `GET /pedidos_compra/produtos?busca=&fornecedor=` | até 50 ativos: `{ codigo, produto, unidade, qtd, porCaixa }` |
| `GET /pedidos_compra/:numero` | cabeçalho + `itens: [{ codigo, produto, codFornecedor, nomeFornecedor, unidade, qtd, porCaixa, chegou, falta }]` |
| `POST /pedidos_compra` `{ chave, fornecedor, observacao, itens }` | 201 `{ numero }`; chave repetida 409; fornecedor fora do cadastro 400 |
| `PUT /pedidos_compra/:numero` | só rascunho, senão 409 |
| `DELETE /pedidos_compra/:numero` | só rascunho, senão 409 |
| `POST /pedidos_compra/:numero/situacao` `{ acao }` | `{ situacao }`; `acaoPermitida` nula → 409; chama `marcarAguardando` |

`porCaixa` de um produto: o do item mais recente em pedido não cancelado do mesmo fornecedor; senão o `fator` inteiro > 1 mais recente de `web_estoque_ligacoes` (fornecedor + produto); senão 1. Os nomes/código/unidade do item são copiados do `estoque` pelo servidor.

- [ ] **Step 1:** `bancoCompras.js` no modelo de `bancoEstoque.js` (reaproveitando-o, com listas `pedidosCompra`, `comprasItens`, `comprasBaixas`). Testes: criar → enviar → `AGUARDANDO` vira `'Aguardando'` e a sugestão mostra `aCaminho`; cancelar volta a `''`; editar/excluir/enviar fora da situação → 409; mesma `chave` duas vezes → 201 e 409, um pedido só; produto inexistente → 400 e nada gravado; sem `compras.ver` → 403 em todas; sem `compras.criar` → 403 nas que gravam; usuário sem `valores.ver` recebe `chegou` e `falta`; `porCaixa` nas três origens.
- [ ] **Step 2:** `node --test test/pedidos_compra_rotas.test.js` → FAIL.
- [ ] **Step 3:** implementar e registrar no `index.js` junto de `registrarEstoqueMovimentos`.
- [ ] **Step 4:** `npm test` → PASS (inclui os testes de análises, que não podem mudar).
- [ ] **Step 5:** commit `feat: rotas dos pedidos a fornecedor`.

### Task 4: Chegada pela entrada e "a caminho" no estoque

**Files:** Modify `rotas/pedidos_compra_banco.js`, `rotas/estoque_movimentos.js` (entrada ~l. 222-254, desfazer ~l. 396-401), `index.js` (`GET /estoque`, l. 1275-1296), `test/apoio/bancoEstoque.js`; Create `test/pedidos_compra_chegada.test.js`

**Interfaces — Produces:**
- `baixarPorEntrada(conn, { nota, fornecedor, data, chegada: Map<codigo, qtd>, quando }) → [{ numero, situacao }]`: trava (`FOR UPDATE`) pedidos `enviado`/`parcial` do fornecedor com `DATE(criado_em) <= data`, ordem `numero`; usa `distribuirBaixa`; grava baixas; atualiza situação; depois `marcarAguardando` para os códigos que ainda têm algo a caminho.
- `desfazerBaixas(conn, { nota, fornecedor, codigos })`: apaga as baixas da nota, recalcula a situação dos pedidos tocados (inclusive `recebido` → `parcial`/`enviado`) e chama `marcarAguardando(codigos)`.
- `POST /estoque/entrada` acrescenta `pedidosAtualizados` na resposta **só quando não for vazio** (testes atuais comparam a resposta inteira).
- `GET /estoque` acrescenta `aCaminho` (número) só nos itens com valor > 0, consultado junto (`Promise.all`).

- [ ] **Step 1:** testes pela API: pedido de 20 + entrada de 12 → `parcial`, falta 8, `AGUARDANDO` continua `'Aguardando'`; segunda nota de 8 → `recebido`, `''`; dois pedidos e nota com o produto em duas linhas (5 + 3) contra faltas 5 e 5 → 5 e 3; nota de outro fornecedor ou com data anterior à criação → pedido intacto; rascunho, encerrado e cancelado não recebem; desfazer devolve falta e situação; pedido encerrado continua encerrado ao desfazer; nota recusada (409 repetida) não grava baixa; sem pedido, a resposta fica igual à de hoje; usuário sem `compras.ver` dá entrada e a baixa acontece.
- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3:** implementar; acrescentar em `bancoEstoque.js` as regras SQL novas (listas vazias por padrão).
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** commit `feat: entrada de nota baixa o pedido ao fornecedor`.

### Task 5: PDF

**Files:** Create `pdf/pedido_compra.js`, `test/pedidos_compra_pdf.test.js`; Modify `rotas/pedidos_compra.js`

**Interfaces — Produces:** `desenharPedidoCompra(doc, dados, { logo }) → string[]` (textos escritos, para teste, como `pdf/entrega_checklist.js`); `novoDocumento()`; rota `GET /pedidos_compra/:numero/pdf` (`['estoque.ver','compras.ver']`, `application/pdf`, nome `Pedido_compra_<numero>.pdf`, 404 se não existe).

A4 retrato: logo (`LOGO` de `pdf/entrega_checklist.js`), "PEDIDO DE COMPRA Nº N", data (`enviado_em` ou `criado_em`, dd/mm/aaaa), "Fornecedor: X", tabela "Código | Descrição | Quantidade", observação no fim. Descrição = nome no fornecedor, ou o da casa se vazio. Quantidade: `porCaixa > 1` → `2 caixas com 50 (100 un)` (`1 caixa com 50 (50 un)`), `un` = unidade do item; senão `100 un`. Cabeçalho da tabela repete a cada página; texto do banco passa por `textoPdf`.

- [ ] **Step 1:** testes: texto exato da quantidade nos três casos; nome da casa quando o do fornecedor é vazio; nenhum texto com `R$`; 80 itens com nome de 190 caracteres → mais de uma página e os 80 códigos presentes; rota 200 `%PDF`, 404, 403.
- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** rodar → PASS; gerar um PDF de amostra no scratchpad e abrir com Read para conferir o visual.
- [ ] **Step 5:** commit `feat: PDF do pedido ao fornecedor`.

### Task 6: Tela, avisos e documentação

**Files:** Create `pedidos_compra.html`, `pedidos_compra.js`, `test/pedidos_compra_tela.test.js`, `docs/regras/pedidos-compra.md`; Modify `estoque.html` (aba após "Histórico": `data-perm="compras.ver"`; coluna "Aguardando" mostra `p.aCaminho || p.aguardando`), `layout.js` (`PAGINAS['pedidos_compra.html'] = ['estoque.ver','compras.ver']`; `PAGINA_PAI` → `estoque.html`), `movimentacao_estoque.html` (após lançar nota, ~l. 766), `CLAUDE.md`

**Interfaces — Consumes:** rotas das tasks 3 e 5.
**Produces:** funções puras em `pedidos_compra.js` (UMD como `calculo/agenda_repeticao.js`): `totalUnidades(quantidade, porCaixa)`, `textoTotal(quantidade, porCaixa, unidade)` (`2 caixas × 50 = 100 un`), `itensParaEnviar(linhas)` (só marcadas com quantidade; linha marcada sem quantidade → erro com o nome do produto).

Comportamento: moldura, CSP e `tema.css` como `notas_fiscais.html`; tabelas com cabeçalho fixo; textos do banco escapados. Visões "Pedidos" (lista; rascunhos com selo de destaque) e o formulário/detalhe do desenho na spec §5.1. Quantidade sugerida entra convertida em caixas. Mudar `porCaixa` recalcula o texto, não a quantidade digitada. `chave` nova por pedido novo e a mesma até salvar com sucesso. "Gerar PDF" salva o rascunho, baixa o arquivo (fetch com token → blob) e, se rascunho, pergunta "Marcar como enviado?". Cancelar, encerrar e excluir pedem confirmação. Botões de gravação com `data-perm="compras.criar"`. Trocar de fornecedor com itens preenchidos pede confirmação. Na entrada: toast "Pedido(s) ao fornecedor atualizado(s): nº 12 (Chegou em parte)".

- [ ] **Step 1:** testes das três funções e das ligações estáticas (aba com `data-perm="compras.ver"`, entrada em `PAGINAS`, `?v=` coerente).
- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3:** implementar tela e alterações.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** conferir no navegador (skill `run`) com API simulada: sugerir, salvar, PDF, marcar enviado, cabeçalho fixo e largura de celular. Anotar o que não foi testado.
- [ ] **Step 6:** `docs/regras/pedidos-compra.md` (regras da spec §5) e no `CLAUDE.md` um item na seção 1, as linhas de pastas e um bloco curto na seção 5.
- [ ] **Step 7:** commit `feat: tela de pedidos a fornecedor`.
