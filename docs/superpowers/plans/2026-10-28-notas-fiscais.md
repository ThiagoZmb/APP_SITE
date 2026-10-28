# Notas fiscais sem itens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Registrar notas fiscais de entrada (fornecedor) e de saída (cliente) só pelo cabeçalho, sem itens e sem efeito em estoque, caixa ou tabelas do VB.

**Architecture:** Módulo novo no padrão de tintas/fornecedores: validação pura em `calculo/notas_fiscais.js`, rotas em `rotas/notas_fiscais.js` (registradas por `registro.rota`), tabela própria `web_notas_fiscais` em `seguranca/instalacao.js`, tela `notas_fiscais.html/.js`. Testes com `node:test` e banco falso.

**Tech Stack:** Node.js + Express 4, mysql2, HTML/CSS/JS puro, `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-28-notas-fiscais-design.md`

## Global Constraints

- Tabelas do VB nunca são alteradas; só `web_notas_fiscais` é nova (sem FK; `contraparte_codigo` = `cadastro_fornecedores.COD` na entrada, `cadastro_clientes.CODIGO` na saída).
- Permissões `notas.ver` / `notas.editar` (área `Cadastros`); migração dá ambas a Administrador e Interno completo.
- Valor é dinheiro: campo da API `valorTotal`; sem `valores.ver` a rota não devolve e, ao editar, mantém o gravado; criar sem `valores.ver` = 403.
- Nenhum outro nome de campo de resposta pode casar com `REGEX_VALOR` (`seguranca/valores.js`); contagens usam `qtd*`.
- Valor: vírgula ou ponto decimal, > 0, `1.234,56` e `1.500` recusados (mesma regra de `numero()` em `calculo/tintas.js`).
- Sem exclusão. Cancelar exige motivo (≤ 300 caracteres), é irreversível; nota cancelada não edita.
- Imutáveis depois de criada: tipo, número, série, chave, contraparte. Editáveis: `dataEmissao`, `valorTotal`, `observacao`.
- Auditoria (`nota_fiscal_criada`, `nota_fiscal_alterada`, `nota_fiscal_cancelada`) guarda só nomes de campos; nunca valor, chave ou motivo.
- Mensagens e rótulos em português; CSP e estilo iguais às demais páginas.
- Commits direto na `main`, mensagem terminando com `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

- Chave de 44 dígitos com dígito verificador errado ou com 43/45 dígitos → 400 (Task 1 e 3).
- Número com zeros à esquerda (`000123` vs `123`) e série vazia contam como a mesma nota → 409 (Task 1 e 3).
- Número de nota cancelada continua ocupado (não se reaproveita número fiscal) → 409 ao relançar (Task 3).
- Dois lançamentos simultâneos da mesma nota: o índice único do banco (`ER_DUP_ENTRY`) vira 409, não 500 (Task 3).
- Data de emissão impossível (`2026-02-30`) ou vazia → 400 (Task 1).
- Busca com `%`/`_` na caixa de busca não vira curinga (Task 3).
- Usuário com estados restritos lançando saída para cliente de outro estado → 403 (Task 3).

---

### Task 1: Validação pura

**Files:**
- Create: `calculo/notas_fiscais.js`
- Test: `test/notas_calculo.test.js`

**Interfaces:**
- Produces:
  - `TIPOS_NOTA = ['entrada', 'saida']`
  - `chaveValida(chave: string): boolean` — 44 dígitos, DV módulo 11 (pesos 2..9 da direita para a esquerda; resto 0/1 → DV 0).
  - `normalizarNumero(v): string` — só dígitos, sem zeros à esquerda; `''` se inválido.
  - `validarNota(b, { podeValores, criando }): { erros: string[], dados }` — `dados` com `tipo, numero, serie, chave|null, dataEmissao, contraparteCodigo, valorTotal (só se podeValores), observacao`. Ao editar (`criando:false`) valida só `dataEmissao`, `valorTotal`, `observacao`.
  - `validarCancelamento(b): { erros, motivo }`.

- [ ] **Step 1: Write the failing tests** em `test/notas_calculo.test.js` (padrão de `test/tintas_calculo.test.js`):
  - `chaveValida`: uma chave de 44 dígitos montada no teste com DV calculado pelo próprio teste → `true`; mesma chave com último dígito trocado → `false`; 43 dígitos, 45 dígitos e `'abc'` → `false`.
  - `normalizarNumero('000123') === '123'`, `normalizarNumero('12a') === ''`, `normalizarNumero('') === ''`, `normalizarNumero('0') === ''`, número com mais de 9 dígitos → `''`.
  - `validarNota` criando OK: `{tipo:'entrada', numero:'000123', serie:'', dataEmissao:'2026-10-20', contraparteCodigo:'5', valorTotal:'1500,50', observacao:'x'}` com `podeValores:true` → `erros` vazio, `dados.numero === '123'`, `dados.serie === '1'`, `dados.chave === null`, `dados.valorTotal === 1500.5`.
  - Erros (cada um isolado, mensagem contendo o campo): tipo `'x'`; número `'abc'`; data `'2026-02-30'`, `''` e `'20/10/2026'`; contraparte `0` e `'a'`; valor `'1.234,56'`, `'1.500'`, `'0'`, `'-5'`, `''` (com `podeValores:true`); chave com DV errado; observação com 501 caracteres; série com 6 caracteres.
  - Sem `podeValores`: `dados` não tem `valorTotal` e valor ruim não gera erro.
  - `criando:false` ignora tipo/número/contraparte inválidos e valida só os três editáveis.
  - `validarCancelamento({motivo:' '})` → erro; motivo de 301 caracteres → erro; `' ok '` → `motivo === 'ok'`.

- [ ] **Step 2: Run** `node --test test/notas_calculo.test.js` — Expected: FAIL (módulo não existe).

- [ ] **Step 3: Implement** `calculo/notas_fiscais.js`. Reusar a ideia de `numero()` de `calculo/tintas.js` (copiar a função local; não exportar de tintas). Data: regex `AAAA-MM-DD` e conferir com `new Date` que o dia existe. Chave: remover espaços antes de validar; vazia = `null`.

- [ ] **Step 4: Run** o mesmo comando — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add calculo/notas_fiscais.js test/notas_calculo.test.js
git commit -m "feat(notas): validação pura de notas fiscais sem itens"
```

---

### Task 2: Tabela, permissões e migração

**Files:**
- Modify: `seguranca/permissoes.js:41-42` (acrescentar duas permissões após `tintas.editar`)
- Modify: `seguranca/instalacao.js` (CREATE TABLE na lista de DDL, antes de `web_custo_material`; nova função `acrescentarPermissoesNotas`; export)
- Modify: `index.js:15` (import) e `index.js:1634` (chamada na subida, após tintas)
- Test: `test/notas_instalacao.test.js`

**Interfaces:**
- Produces: `acrescentarPermissoesNotas(pool): Promise<{feito: boolean}>` — mesmo molde de `acrescentarPermissoesTintas`, marcador de auditoria `permissoes_notas`, permissões `notas.ver` e `notas.editar`, perfis Administrador e Interno completo.
- Tabela `web_notas_fiscais` com as colunas e tipos da spec (seção Dados) e `${OPCOES}`; `UNIQUE KEY ux_nota_numero (tipo, serie, numero, contraparte_codigo)`, `UNIQUE KEY ux_nota_chave (chave)`, `KEY ix_nota_data (tipo, data_emissao)`.

- [ ] **Step 1: Write the failing test** `test/notas_instalacao.test.js`:
  - catálogo de `permissoes.js` contém `notas.ver` e `notas.editar` com `area: 'Cadastros'`, e o perfil "Interno completo" inicial as inclui;
  - com pool falso (`criarPoolFalso`), `acrescentarPermissoesNotas` insere as duas permissões para os perfis devolvidos e grava a auditoria `permissoes_notas`; segunda chamada (regra devolve linha para o `SELECT id FROM web_auditoria`) retorna `{feito:false}` sem inserir;
  - o DDL de `instalarTabelas` executado no pool falso inclui `CREATE TABLE IF NOT EXISTS \`web_notas_fiscais\`` com `ux_nota_numero` e `ux_nota_chave`.

- [ ] **Step 2: Run** `node --test test/notas_instalacao.test.js` — Expected: FAIL.

- [ ] **Step 3: Implement** as três alterações descritas em Files.

- [ ] **Step 4: Run** `node --test test/notas_instalacao.test.js` e `npm test` — Expected: PASS (nenhum teste existente quebra; se algum conta o número de permissões, atualizar).

- [ ] **Step 5: Commit**

```bash
git add seguranca/permissoes.js seguranca/instalacao.js index.js test/notas_instalacao.test.js
git commit -m "feat(notas): tabela web_notas_fiscais e permissões notas.ver/notas.editar"
```

---

### Task 3: Rotas

**Files:**
- Create: `rotas/notas_fiscais.js`
- Create: `test/apoio/bancoNotas.js` (molde de `test/apoio/bancoTintas.js`: `bancoNotas()`, `prepararNotas(t, {perfil, usuario, banco, estados})`, `PERFIS`)
- Modify: `index.js:1612` (registrar logo após `registrarTintas`, passando `foraDosEstados`)
- Test: `test/notas_rotas.test.js`

**Interfaces:**
- Consumes: `validarNota`, `validarCancelamento`, `TIPOS_NOTA` (Task 1); `emTransacao`, `ErroUsuario`, `agoraLocal` de `rotas/transacao.js`; `semValores`, `podeVerValores`, `preservarValores` de `seguranca/valores.js`; `foraDosEstados(req, res, estado): boolean` do `index.js`.
- Produces: `registrarNotas({ rota, pool, foraDosEstados })`. Rotas (permissão): `GET /notas_fiscais` (`notas.ver`), `GET /notas_fiscais/:id` (`notas.ver`), `POST /notas_fiscais` (`notas.editar`), `PUT /notas_fiscais/:id` (`notas.editar`), `POST /notas_fiscais/:id/cancelar` (`notas.editar`).
- Resposta de nota: `{ id, tipo, numero, serie, chave, dataEmissao, contraparteCodigo, contraparteNome, valorTotal, observacao, situacao, motivoCancelamento, criadoPor, criadoEm }`; lista: `{ notas: [...], qtdNotas, limitada }` com `LIMITE_LISTA = 200`, ordenada por `data_emissao DESC, id DESC`. Filtros: `tipo`, `de`, `ate` (datas), `situacao`, `q` (número ou nome da contraparte, `LIKE` com escape de `\ % _`).
- Criar: lê a contraparte (`SELECT COD, RAZAO_FABRICANTE FROM cadastro_fornecedores WHERE COD = ? AND RAZAO_FABRICANTE <> '.'` na entrada; `SELECT CODIGO, RAZAO_SOCIAL, ESTADO FROM cadastro_clientes WHERE CODIGO = ?` na saída), 400 se não existir, `foraDosEstados` na saída; confere duplicidade de número/série/contraparte e de chave com `SELECT ... FOR UPDATE` → 409; trata `err.code === 'ER_DUP_ENTRY'` do INSERT também como 409. Editar/cancelar: `SELECT ... FOR UPDATE`, 404 se não existe, 409 se já cancelada. Editar na saída também confere `foraDosEstados` do cliente da nota.

- [ ] **Step 1: Write `test/apoio/bancoNotas.js`** com regras para cada SQL da rota (INSERT/SELECT/UPDATE de `web_notas_fiscais`, as duas consultas de contraparte, `web_auditoria`), imitando `bancoTintas.js`; `semear.nota(x)`, `semear.fornecedor()`, `semear.cliente({ESTADO})`. Perfis: `'Notas'` (`notas.ver`, `notas.editar`), `'Notas com valores'` (+ `valores.ver`), `'Somente ver notas'` (`notas.ver`), `'Sem acesso'`.

- [ ] **Step 2: Write the failing tests** `test/notas_rotas.test.js`:
  - cria entrada (200, `id` 1, auditoria `nota_fiscal_criada` sem o valor/chave no JSON) e saída; `contraparteNome` copiado do cadastro;
  - 400: fornecedor/cliente inexistente, fornecedor `.`, dados inválidos da Task 1;
  - 409: mesmo tipo+série+número+contraparte (incluindo `000123` vs `123`), mesma chave em outra nota, número de nota **cancelada** reaproveitado; mesmo número com outra contraparte é permitido; `ER_DUP_ENTRY` simulado no INSERT → 409;
  - sem `valores.ver`: criar → 403 e nada gravado; listar/ler não traz `valorTotal`; editar preserva o valor gravado;
  - `PUT`: altera data/valor/observação, auditoria `nota_fiscal_alterada` com `campos` só dos nomes que mudaram; tentar mandar `numero`/`tipo`/`chave` no corpo não altera; 404; nota cancelada → 409;
  - cancelar: exige motivo (400), grava situação/motivo, auditoria `nota_fiscal_cancelada` sem o motivo; segunda vez → 409; depois editar → 409;
  - lista: filtros `tipo`, `de/ate`, `situacao`, `q` por número e por nome; `q='%'` não casa tudo; limite 200 com `limitada: true`;
  - estados: usuário restrito a `['RJ']` lançando saída para cliente `SP` → 403 e nada gravado; consulta/edita nota dessa saída → 403;
  - permissões: `Somente ver notas` lê (200) e não grava (403); `Sem acesso` → 403 em tudo;
  - nenhuma chave da resposta (exceto `valorTotal`) casa com `REGEX_VALOR`.

- [ ] **Step 3: Run** `node --test test/notas_rotas.test.js` — Expected: FAIL.

- [ ] **Step 4: Implement** `rotas/notas_fiscais.js` no molde de `rotas/tintas.js` (helpers `auditar`, `erro500`, `like`), e o registro em `index.js`.

- [ ] **Step 5: Run** `node --test test/notas_rotas.test.js` e `npm test` — Expected: PASS; `registro.verificar()` não acusa rota fora do registro.

- [ ] **Step 6: Commit**

```bash
git add rotas/notas_fiscais.js test/apoio/bancoNotas.js test/notas_rotas.test.js index.js
git commit -m "feat(notas): rotas de notas fiscais de entrada e saída sem itens"
```

---

### Task 4: Tela

**Files:**
- Create: `notas_fiscais.html`, `notas_fiscais.js` (molde: `tintas.html`/`tintas.js`; lógica pura exportada por `module.exports` quando houver `module`, como `tintas.js`)
- Modify: `layout.js` (item de menu `Notas fiscais`, `sub: true`, logo após Fornecedores; `'notas_fiscais.html': ['notas.ver']` em `PAGINAS`; reaproveitar um ícone existente)
- Test: `test/notas_tela.test.js`

**Interfaces:**
- Consumes: rotas da Task 3. Contraparte: fornecedores via `GET /fornecedores`, clientes via `GET /clientes` (conferir o formato de resposta lendo `fornecedores.js` e `clientes.html` antes de usar).
- Produces em `notas_fiscais.js`: `CAMPOS = ['tipo','numero','serie','chave','dataEmissao','contraparteCodigo','valorTotal','observacao']`; `validarForm(f, { comValores }): string[]`; `corpoCriar(f, { comValores })` (apara espaços, omite `valorTotal` sem `comValores`); `corpoEditar(f, { comValores })` (só `dataEmissao`, `valorTotal`, `observacao`); `paraTela(n)` (12.5 → `'12,5'`).
- Tela: abas Entrada/Saída (`id="aba-entrada"`, `id="aba-saida"`), `busca`, filtros `de`/`ate`/`filtro-situacao`, lista, botões `btn-novo`, `btn-salvar`, `btn-cancelar-nota` (`data-perm="notas.editar"`), campos de valor com `data-valor`; sem handlers inline; contraparte por `<select>` pesquisável de fornecedor (entrada) ou cliente (saída); nota cancelada abre só leitura e mostra o motivo.

- [ ] **Step 1: Write the failing tests** `test/notas_tela.test.js` (molde de `test/tintas_tela.test.js`): `validarForm` (obrigatórios, chave, valor só validado com `comValores`), `corpoCriar`/`corpoEditar` (omissões), `paraTela`; HTML tem CSP, viewport, scripts `layout.js`, `entregas_comum.js`, `notas_fiscais.js`, os ids acima, `data-perm="notas.editar"`, `data-valor`, nenhum `on…=` inline; `layout.js` tem o item de menu entre Fornecedores e Funcionários e a entrada em `PAGINAS`.

- [ ] **Step 2: Run** `node --test test/notas_tela.test.js` — Expected: FAIL.

- [ ] **Step 3: Implement** os arquivos e a mudança em `layout.js`.

- [ ] **Step 4: Run** `node --test test/notas_tela.test.js` e `npm test` — Expected: PASS. A tela real no navegador não tem teste automático: abrir `notas_fiscais.html` contra um backend local e conferir lançar, editar e cancelar uma entrada e uma saída; se não for possível, dizer isso na entrega.

- [ ] **Step 5: Commit**

```bash
git add notas_fiscais.html notas_fiscais.js layout.js test/notas_tela.test.js
git commit -m "feat(notas): tela de notas fiscais de entrada e saída"
```

---

### Task 5: Documentação

**Files:**
- Modify: `CLAUDE.md` (linha da funcionalidade na seção 1; linhas em `rotas/`, `calculo/` e telas na seção 2; nova seção 5 "Notas fiscais (sem itens)" com tabela, regras, permissões, limitações e testes)

- [ ] **Step 1:** Escrever a seção resumindo a spec (tabela, imutáveis x editáveis, número cancelado continua ocupado, valor/403, estados, sem exclusão, fora do escopo: itens, estoque, financeiro, XML) e a lista de testes `test/notas_*.test.js`.
- [ ] **Step 2: Run** `npm test` — Expected: tudo PASS.
- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(notas): documenta notas fiscais sem itens no CLAUDE.md"
```
