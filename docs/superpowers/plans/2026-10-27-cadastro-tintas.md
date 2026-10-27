# Cadastro de tintas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Levar o `frm_Cadastro_Tintas` do VB para a web (lista, busca, criar, editar, excluir) sobre a mesma tabela `tintas`.

**Architecture:** Mesmo molde de fornecedores/funcionários: validação pura em `calculo/tintas.js`, rotas em `rotas/tintas.js` registradas por `registro.rota`, tela `tintas.html` + `tintas.js` (UMD: funções puras testadas no Node, desenho só no navegador). `VALOR` é dinheiro: `semValores`/`preservarValores`.

**Tech Stack:** Node.js + Express 4, mysql2, front-end HTML/JS puro, testes `node:test` com banco simulado.

**Spec:** `docs/superpowers/specs/2026-10-27-cadastro-tintas-design.md`

## Global Constraints

- A web não cria nem altera a tabela `tintas` (tabela do VB; colunas `COD, RAZAO_FABRICANTE, CLASSE, VALOR, PORCENTAGEM, REF_FABRICANTE, COR_ELEGANCE, TIPO, CONJUNTO, COR, RENDIMENTO`, nesta ordem no INSERT do VB).
- Obrigatórios: fabricante, classe, tipo, conjunto, valor, % da mistura. % entre 0 e 100. Cor obrigatória, exceto classe `Tinta`. Rendimento vazio = 0. Vírgula decimal aceita.
- Cor gravada em hexadecimal ARGB de 8 dígitos maiúsculos (`FF1A2B3C`). Classe `Tinta` sem cor grava `FF000000` (o que o VB grava: `ColorDialog1.Color` padrão é preto).
- Código novo = `MAX(COD)+1` com `FOR UPDATE`, gravado explicitamente em `COD`.
- `REF_FABRICANTE` não repete (409, sem diferenciar maiúsculas nem espaços nas pontas); fabricante precisa existir em `cadastro_fornecedores` (registro `.` não conta).
- Permissões novas `tintas.ver` / `tintas.editar` (Administrador e Interno completo na migração; nenhum outro perfil). `tintas.editar` também exclui.
- `VALOR` só com `valores.ver`; sem ela a rota não devolve e, ao salvar, mantém o valor gravado (cadastro novo = 0). Contagens usam `qtd*`.
- Auditoria `tinta_criada` / `tinta_alterada` / `tinta_excluida`: só nomes dos campos alterados, nunca valores.
- Dado da API só entra na tela por `esc()` ou `value`/`textContent`. CSP em cada página.
- Commits direto na `main` (preferência do usuário); mensagem termina com `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

- Valor `1.234,56` (ponto de milhar) ou `abc`/negativo: recusar com mensagem, nunca gravar 1.23 nem NaN → Task 1.
- Referência igual só na caixa/espaços (`" tx-10 "` vs `TX-10`): 409, não duplica → Task 3.
- Usuário sem `valores.ver` edita uma tinta: o preço gravado não pode zerar → Task 3.
- Excluir tinta inexistente ou já excluída: 404 limpo, sem 500 → Task 3.
- Cor em minúsculas ou formato errado (`#fff`, `ZZ`): minúsculas viram maiúsculas; formato errado dá 400 → Task 1.

---

## File Structure

- Create `calculo/tintas.js` — listas fixas, `validarTinta`.
- Create `rotas/tintas.js` — `registrarTintas`.
- Create `tintas.js`, `tintas.html` — tela.
- Create `test/tintas_calculo.test.js`, `test/tintas_rotas.test.js`, `test/tintas_tela.test.js`, `test/apoio/bancoTintas.js`.
- Modify `seguranca/permissoes.js`, `seguranca/instalacao.js`, `index.js`, `layout.js`, `CLAUDE.md`, `test/permissoes.test.js`, `test/instalacao.test.js`.

### Task 1: Regras puras (`calculo/tintas.js`)

**Files:**
- Create: `calculo/tintas.js`
- Test: `test/tintas_calculo.test.js`

**Interfaces:**
- Produces: `CLASSES_TINTA`, `TIPOS_TINTA`, `CONJUNTOS_TINTA` (arrays de string, ordenados pt-BR como o `.Sorted = True` do VB); `validarTinta(b, { podeValores = false } = {}) -> { erros: string[], dados }` com `dados = { fabricante, classe, tipo, conjunto, valor: number|undefined, porcentagem: number, refFabricante, corElegance, cor: string, rendimento: number }`. Chaves de entrada `b` iguais às de `dados` (a `cor` entra como ARGB de 8 dígitos). Sem `podeValores`, `valor` nem é lido (`dados.valor` fica `undefined`, sem erro).

- [ ] **Step 1: Write the failing tests** em `test/tintas_calculo.test.js`:
  - listas: `CLASSES_TINTA.length === 6` (contém `Tinta`, `Verniz`), `TIPOS_TINTA.length === 19` (contém `'Pasticgrip'` com essa grafia do VB e `'Aderente (Fundo Fosfatizante)'`), `CONJUNTOS_TINTA.length === 9`.
  - base válida `{ fabricante:'Sayerlack', classe:'Verniz', tipo:'Verniz Fosco', conjunto:'Conjunto Vidro', valor:'12,5', porcentagem:'50', cor:'ff1a2b3c', rendimento:'' }` com `{ podeValores: true }` → `erros` vazio, `valor === 12.5`, `cor === 'FF1A2B3C'`, `rendimento === 0`.
  - faltando cada obrigatório → mensagem contendo o rótulo (`Fabricante`, `Classe`, `Tipo`, `Conjunto`, `Valor`, `% da mistura`).
  - `valor: '1.234,56'`, `'abc'`, `'-3'` → erro com `Valor`; `porcentagem: '100,5'` e `'-1'` → erro; `'0'` e `'100'` válidos.
  - classe `Tinta` sem cor → válido e `dados.cor === 'FF000000'`; classe `Verniz` sem cor → erro `Cor`.
  - cor `'#fff'` e `'ZZ'` → erro `Cor`.
  - classe/tipo/conjunto fora da lista → erro.
  - sem `podeValores`: `valor` ausente não gera erro e `dados.valor === undefined`.
  - `refFabricante` com 101 caracteres → erro; texto das pontas é cortado (`trim`).
- [ ] **Step 2: Run** `node --test test/tintas_calculo.test.js` — Expected: FAIL (módulo não existe).
- [ ] **Step 3: Implement** `calculo/tintas.js`. Listas: copiar literalmente de `e:\Programas\EleganSys V5\frm_Cadastro_Tintas.vb` linhas 53-61 (classes), 65-76 (conjuntos), 80-101 (tipos), ordenando com `localeCompare(…, 'pt-BR')`. Número: aceita `^\d+([.,]\d+)?$` (uma vírgula OU um ponto, nunca os dois); `1.234,56` é recusado. Limite de tamanho 100 para `refFabricante` e `corElegance`. Estilo e helper `campo(erros, valor, rotulo, max, {obrigatorio})` como em `calculo/cadastros.js` (copiar a ideia, não importar o que não é exportado).
- [ ] **Step 4: Run** o teste — Expected: PASS.
- [ ] **Step 5: Commit** `feat(tintas): regras de validação do cadastro de tintas`.

### Task 2: Permissões

**Files:**
- Modify: `seguranca/permissoes.js` (CATALOGO, área `Cadastros`, logo após `funcionarios.editar`; `Interno completo` já herda de `TODAS`, nada a excluir), `seguranca/instalacao.js` (nova `acrescentarPermissoesTintas` + export), `index.js` (import e chamada em `iniciar()` junto das outras), `test/permissoes.test.js`, `test/instalacao.test.js`.

**Interfaces:**
- Produces: códigos `tintas.ver` ("Ver tintas") e `tintas.editar` ("Cadastrar, editar e excluir tintas"; valor também exige Valores financeiros); `acrescentarPermissoesTintas(pool) -> Promise<{ feito: boolean }>`, mesmo molde de `acrescentarPermissoesCadastros` com `darAoAdministrador`-style: Administrador e Interno completo recebem as duas; auditoria `permissoes_tintas`; roda uma vez.

- [ ] **Step 1: Write the failing tests**: em `test/permissoes.test.js` o total de `Interno completo` passa de 26 para 28 e `Administrador` inclui as duas; nenhum outro perfil inicial as tem. Em `test/instalacao.test.js`, teste análogo a `cadastros: Administrador recebe…` esperando inserts `[[1,'tintas.ver'],[1,'tintas.editar'],[2,'tintas.ver'],[2,'tintas.editar']]`, auditoria com `permissoes_tintas` e `{ feito:false }` na segunda vez.
- [ ] **Step 2: Run** `node --test test/permissoes.test.js test/instalacao.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement** as três alterações; em `index.js` acrescentar `if ((await acrescentarPermissoesTintas(pool)).feito) console.log('[permissões] tintas.* acrescentadas ao Administrador e Interno completo');` depois da linha de cadastros.
- [ ] **Step 4: Run** os dois testes — Expected: PASS.
- [ ] **Step 5: Commit** `feat(tintas): permissões tintas.ver e tintas.editar`.

### Task 3: Rotas e banco falso

**Files:**
- Create: `rotas/tintas.js`, `test/apoio/bancoTintas.js`
- Modify: `index.js` (`require('./rotas/tintas')` e `registrarTintas({ rota: registro.rota, pool });` depois de `registrarFuncionarios`)
- Test: `test/tintas_rotas.test.js`

**Interfaces:**
- Consumes: `validarTinta`, listas (Task 1); `emTransacao`, `ErroUsuario`, `agoraLocal` de `rotas/transacao.js`; `semValores`, `podeVerValores`, `preservarValores` de `seguranca/valores.js`; permissões (Task 2).
- Produces (JSON, chaves iguais às de `dados` mais `codigo`):
  - `GET /tintas?busca=&classe=` → `{ tintas: [{codigo, fabricante, classe, tipo, conjunto, refFabricante, corElegance, cor, valor?}], classes, tipos, conjuntos, fabricantes: string[] }` (busca por `REF_FABRICANTE` ou `COR_ELEGANCE`, `like()` escapado, `ORDER BY REF_FABRICANTE`, `LIMIT 2000`; `fabricantes` = razões de `cadastro_fornecedores` exceto `.`).
  - `GET /tintas/:codigo` → `{ tinta }` completo (+ `porcentagem`, `rendimento`); 404 se não existe/inválido.
  - `POST /tintas/salvar` (corpo = campos de `dados`, mais `codigo` para atualizar) → `{ ok, codigo, criado }`; 400 validação, 404 código inexistente, 409 referência duplicada, 400 fabricante inexistente.
  - `DELETE /tintas/:codigo` → `{ ok: true }`; 404 se não existe.
  - Exports: `registrarTintas({ rota, pool })`.
- `bancoTintas.js` exporta `bancoTintas()` (estado `tintas`, `fornecedores`, `auditoria`; `semear.tinta(x)`, `semear.fornecedor(x)`) e `prepararTintas(t, { perfil, banco })` no molde exato de `bancoCadastros.js`, com `PERFIS = { 'Tintas': ['tintas.ver','tintas.editar'], 'Tintas com valores': [..., 'valores.ver'], 'Somente ver tintas': ['tintas.ver'], 'Sem acesso': ['pedidos.ver'] }`. Regras de SQL imitam as da rota (SELECT lista, SELECT por COD, `SELECT COALESCE(MAX(COD), 0) + 1`, SELECT por referência, SELECT fornecedor, INSERT, UPDATE, DELETE, auditoria).

- [ ] **Step 1: Write the failing tests** em `test/tintas_rotas.test.js` (perfil `Tintas com valores` salvo onde indicado):
  - cria: 200, `criado`, código 1, `banco.tintas[0].COR === 'FF1A2B3C'`, auditoria `tinta_criada` sem valor no detalhe; segunda tinta recebe código 2.
  - referência `' tx-10 '` quando já existe `TX-10` → 409, nada gravado; atualizar a própria tinta mantendo a referência → 200.
  - fabricante que não existe → 400; fabricante `.` → 400; campos obrigatórios faltando → 400.
  - atualiza: 200, auditoria `tinta_alterada` com `campos` só com os nomes que mudaram; código 999 → 404; `codigo:'abc'` → 400.
  - lista: busca por referência e por cor Elegance, filtro `classe`, escape de `%` na busca, vem `classes/tipos/conjuntos/fabricantes`; detalhe e 404 (`/tintas/999`, `/tintas/abc`).
  - sem `valores.ver` (perfil `Tintas`): lista e detalhe não têm a chave `valor`; salvar atualização com `valor` no corpo mantém o `VALOR` gravado; criar grava `VALOR = 0`.
  - exclui: 200, some do banco, auditoria `tinta_excluida`; excluir de novo → 404; 999 → 404.
  - 403: perfil `Sem acesso` em todas as rotas; `Somente ver tintas` lista mas não salva nem exclui (403).
  - nenhum nome de campo da resposta (exceto `valor`) casa com `REGEX_VALOR`.
- [ ] **Step 2: Run** `node --test test/tintas_rotas.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement** `rotas/tintas.js` espelhando `rotas/fornecedores.js` (`resumo`/`completo`, `codigoDe`, `auditar`, `emTransacao`, 500 genérico). Detalhes não óbvios: `valor` passa por `semValores(req, obj, ['valor'])`; no salvar, `validarTinta(b, { podeValores: podeVerValores(req) })` e `preservarValores(req, dados, atualCompleto || { valor: 0 }, ['valor'])`; referência duplicada via `SELECT COD FROM tintas WHERE REF_FABRICANTE = ? FOR UPDATE` ignorando o próprio `COD` (só quando a referência não é vazia); INSERT com as 11 colunas na ordem do VB; DELETE dentro de `emTransacao` com `SELECT ... FOR UPDATE` para dar 404 e auditar. Registrar a rota `delete` com `rota('delete', '/tintas/:codigo', EDITAR, …)`.
- [ ] **Step 4: Run** `node --test test/tintas_rotas.test.js` — Expected: PASS; depois `npm test` — Expected: nenhum teste antigo quebra (se algum teste que lista todas as rotas/permissões reclamar, atualizar a lista dele com as 4 rotas novas).
- [ ] **Step 5: Commit** `feat(tintas): rotas de listar, ver, salvar e excluir tintas`.

### Task 4: Tela

**Files:**
- Create: `tintas.js`, `tintas.html`
- Modify: `layout.js` (ícone `tintas`, item `{ href: 'tintas.html', texto: 'Tintas', icone: 'tintas', sub: true }` logo depois de `custos.html`, `PAGINAS['tintas.html'] = ['tintas.ver']`); páginas que carregam `layout.js` com parâmetro de cache (seguir o commit `3d06ddf` e o `grep "layout.js?v"` para o padrão de atualização)
- Test: `test/tintas_tela.test.js`

**Interfaces:**
- Consumes: API da Task 3; `entregas_comum.js` (`esc`, `txt`, `criarApi`, `criarToast`); `win.Acesso.pode('tintas.editar')`.
- Produces (exports do UMD `tintas.js`): `CAMPOS = ['fabricante','classe','tipo','conjunto','valor','porcentagem','refFabricante','corElegance','cor','rendimento']`; `validarForm(f, { comValores = false } = {}) -> string[]` (espelha o servidor; `valor` só validado com `comValores`); `corpoSalvar(f, codigo, { comValores = false } = {}) -> objeto` (só `CAMPOS`, `valor` omitido sem `comValores`, `codigo` só se informado); `corParaInput(argb) -> '#rrggbb'` (`'FF1A2B3C'` → `'#1a2b3c'`; inválido/vazio → `'#000000'`); `inputParaCor(hex) -> 'FF1A2B3C'` (`'#1a2b3c'` → `'FF1A2B3C'`); `iniciar(win)`.

- [ ] **Step 1: Write the failing tests** em `test/tintas_tela.test.js`: `corParaInput('FF1A2B3C') === '#1a2b3c'`, `corParaInput('0') === '#000000'`, `inputParaCor('#1a2b3c') === 'FF1A2B3C'` (ida e volta); `validarForm` com formulário válido → `[]`, vazio → mensagens para fabricante, classe, tipo, conjunto, % da mistura (e valor só com `comValores`); `corpoSalvar` corta espaços, omite `valor` sem `comValores` e `codigo` quando `null`; HTML/layout: `tintas.html` tem CSP, carrega `layout.js` e `tintas.js`, e `layout.js` contém `tintas.html` no MENU e em `PAGINAS` com `tintas.ver` (copiar o estilo das asserções de fornecedores em `test/cadastros_tela.test.js`).
- [ ] **Step 2: Run** `node --test test/tintas_tela.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement** `tintas.js` seguindo `fornecedores.js` (mesma estrutura UMD, lista com busca de 250 ms, formulário, `salvar` com trava `ocupado`) e `tintas.html` copiando o esqueleto de `fornecedores.html` (CSP sem ViaCEP é opcional manter). Diferenças: filtro de classe no lugar do de situação; coluna da cor com bolinha (`<span style="background:#rrggbb">`; cor vinda da API só passa por `corParaInput`, nunca direto no HTML); `<select>` de fabricante, classe, tipo e conjunto preenchidos com as listas da resposta de `GET /tintas`; `<input type="color">` para a cor; campo `valor` oculto e fora do `corpoSalvar` quando `!win.Acesso.pode('valores.ver')`; botão Excluir (só com `tintas.editar`) com `confirm` e `DELETE /tintas/:codigo`.
- [ ] **Step 4: Run** o teste — Expected: PASS. Depois subir `npm start` não é possível sem MySQL; conferir `node -e "require('./tintas.js')"` sem erro.
- [ ] **Step 5: Commit** `feat(tintas): tela de cadastro de tintas e item no menu`.

### Task 5: Documentação e verificação final

**Files:**
- Modify: `CLAUDE.md` (seção 1: funcionalidade Tintas; seção 2: pastas `rotas/tintas.js`, `calculo/tintas.js`, `tintas.html/.js`; seção 5, "Cadastros": regras de tintas — tabela `tintas` do VB, ref sem repetir, cor ARGB e `FF000000` para Tinta sem cor, valor só com `valores.ver`, exclusão permitida e auditada, testes)

- [ ] **Step 1: Edit** `CLAUDE.md` como descrito.
- [ ] **Step 2: Run** `npm test` — Expected: tudo passa (informar o total).
- [ ] **Step 3: Conferir pendência no banco real** e registrar no relatório final: tipos de `PORCENTAGEM`, `RENDIMENTO`, `COR` e se `COD` é AUTO_INCREMENT (rodar `SHOW CREATE TABLE tintas` com acesso ao banco; sem acesso, deixar como pendência avisada ao usuário).
- [ ] **Step 4: Commit** `docs(tintas): CLAUDE.md com o cadastro de tintas`.
