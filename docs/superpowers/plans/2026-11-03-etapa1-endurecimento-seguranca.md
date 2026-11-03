# Etapa 1 — Endurecimento de segurança: plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir no sistema atual os achados de segurança que bloqueiam abrir o site para clientes, sem alterar tabelas do VB.

**Architecture:** Módulos pequenos e puros em `seguranca/` (chave admin, limite de login, sessões, SSL do MySQL), ligados ao `index.js` e ao `registro` existente. Cada correção nasce de um teste que reproduz o problema. Tabelas novas só `web_*`, criadas em `seguranca/instalacao.js`.

**Tech Stack:** Node.js 18+, Express 4, mysql2, jsonwebtoken, bcryptjs, express-rate-limit, `node:test` com banco falso (`test/apoio/poolFalso.js`).

**Spec:** `docs/superpowers/specs/2026-11-03-portal-do-cliente-seguranca-design.md` (seção 5). Esta é a etapa 1 de 4; as etapas 2 a 4 terão planos próprios.

## Global Constraints

- Testes com `node:test` e `node:assert/strict`; cada arquivo começa com `process.env.JWT_SECRET = 'teste'; process.env.NODE_ENV = 'test';`. Nenhum teste precisa de MySQL real.
- Toda rota nasce por `registro.rota(...)` ou `registro.publica(...)`; `registro.verificar()` tem de continuar passando.
- Tabelas do VB não são alteradas. Tabelas novas: `web_*`, em `seguranca/instalacao.js`, sem FK.
- Mensagens ao usuário em português. Nunca registrar em log, auditoria ou resposta: senha, token, `ADMIN_KEY`, stack trace nem `err.message` de banco.
- Auditoria em `web_auditoria (quando, quem, acao, alvo, detalhe)`; `detalhe` guarda só nomes de campo, códigos e IP, nunca valor nem dado pessoal.
- Commits na `main`, um por tarefa, **sem push** (decisão registrada do dono), terminando com `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Ao fim de cada tarefa: `npm test` inteiro verde antes do commit.
- Atualizar `CLAUDE.md` na tarefa que muda comportamento ou variável de ambiente.

## Review Focus

1. Usuário com texto enorme, Unicode ou aspas no login: sempre 401 uniforme (ou 400 pelo limite atual), nunca 500.
2. Atacante trocando de IP contra uma só conta: o limite por conta vale independente do IP (Tarefa 4).
3. Sessão revogada precisa deixar de valer **na hora**, mesmo dentro do cache de 60 s de permissões (Tarefa 6).
4. `ADMIN_KEY` enviada com tamanho diferente, repetida (array de header) ou vazia: resposta 403, nunca exceção (`timingSafeEqual` lança com tamanhos diferentes) (Tarefa 3).
5. `/logout` com token expirado, inválido ou repetido: sem queda e idempotente (Tarefa 6).

---

## Estrutura de arquivos

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `.gitignore`, `APP_SITE.rar` | modificar/remover do índice | tira o `.rar` do git |
| `seguranca/erros.js` | criar | tratador global de erros |
| `seguranca/chave_admin.js` | criar | `chaveAdminConfere`, `limitadorAdmin` |
| `seguranca/login_limite.js` | criar | limite por conta e hash falso |
| `seguranca/sessoes.js` | criar | sessões revogáveis |
| `seguranca/mysql_ssl.js` | criar | `opcoesSsl` |
| `seguranca/rotas.js` | modificar | `rotasAutenticadas()` |
| `seguranca/instalacao.js` | modificar | tabela `web_sessoes` |
| `index.js`, `rotas/notas_importacao.js`, `rotas/pesos_importacao.js`, `rotas/admin.js` | modificar | ligações |
| `layout.js` | modificar | logout chama o servidor |
| `test/seguranca_*.test.js` | criar | um arquivo por tarefa |

---

### Task 1: Tirar o `APP_SITE.rar` do git

**Files:**
- Modify: `.gitignore`, `CLAUDE.md` (seção 2, linha do `APP_SITE.rar`)
- Remove do índice: `APP_SITE.rar`
- Test: `test/seguranca_repo.test.js`

**Interfaces:** Produces: nada para outras tarefas.

- [ ] **Step 1: Write the failing test** `rar nao esta rastreado e o gitignore recusa *.rar`: roda `git ls-files` (`child_process.execFileSync`) e afirma que nenhuma linha termina em `.rar`; lê `.gitignore` e afirma que contém a linha `*.rar`.
- [ ] **Step 2: Run** `node --test test/seguranca_repo.test.js` — Expected: FAIL.
- [ ] **Step 3:** `git rm --cached APP_SITE.rar` (o arquivo continua no disco), acrescentar `*.rar` ao `.gitignore`, e corrigir o `CLAUDE.md` (a linha dizia "não rastreado"; passa a dizer que estava rastreado e que o histórico ainda contém a senha antiga do banco até a limpeza do histórico, que depende do dono).
- [ ] **Step 4: Run** o teste — Expected: PASS.
- [ ] **Step 5: Commit** `fix(seguranca): tira APP_SITE.rar do git`. **Não reescrever o histórico**: é destrutivo e só com confirmação explícita do dono.

---

### Task 2: Tratador global de erros e fim do `detalhe: err.message`

**Files:**
- Create: `seguranca/erros.js`
- Modify: `index.js` (15 ocorrências de `detalhe: err.code || err.message` e a ligação do tratador após as rotas), `rotas/notas_importacao.js`, `rotas/pesos_importacao.js`
- Test: `test/seguranca_erros.test.js`

**Interfaces:** Produces: `tratadorDeErros(err, req, res, next)` (Express, 4 argumentos).

- [ ] **Step 1: Write the failing tests:**
  - `nenhuma resposta devolve detalhe de erro`: varre `index.js`, `rotas/`, `leitura/` e falha se casar `/detalhe:\s*err/`.
  - `tratador global responde 500 sem stack nem mensagem`: monta um `express()` com uma rota que lança `new Error('SELECT secreto')`, o tratador, e afirma `status 500`, corpo exatamente `{ error: 'Erro de servidor' }` (o texto 'secreto' e 'at ' não aparecem).
  - `JSON malformado responde 400 {error:'Requisição inválida.'}` (erro `entity.parse.failed`).
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** `tratadorDeErros` em `seguranca/erros.js` (loga só `err.message` no servidor, nunca na resposta; respeita `res.headersSent`); remover as 15 propriedades `detalhe` (mantendo o `error` de cada resposta); ligar o tratador em `index.js` depois do último `registro.rota` e antes de `registro.verificar()`. Conferir no front (`grep -n "\.detalhe" *.js *.html`) que nenhuma tela lê `detalhe`; se ler, ajustar a tela para só mostrar `error`.
- [ ] **Step 4: Run** `npm test` — Expected: tudo PASS.
- [ ] **Step 5: Commit** `fix(seguranca): erros sem detalhe interno nas respostas`.

---

### Task 3: `ADMIN_KEY` e `/migrar_senhas` endurecidos

**Files:**
- Create: `seguranca/chave_admin.js`
- Modify: `index.js:816-862` (`/admin/definir_senha`, `/migrar_senhas`), `rotas/notas_importacao.js`, `rotas/pesos_importacao.js` (todas leem `x-admin-key`), `CLAUDE.md` (seção 4: nova variável)
- Test: `test/seguranca_chave_admin.test.js`

**Interfaces:**
- Produces: `chaveAdminConfere(req, env = process.env): boolean` (falso se `ADMIN_KEY` ausente, se `ADMIN_ROTAS !== '1'`, se o header faltar, vier repetido/array ou tiver outro tamanho; compara os SHA-256 com `crypto.timingSafeEqual`); `limitadorAdmin` (express-rate-limit, 5 por 15 min por IP, resposta `429 {error:'Muitas tentativas. Aguarde 15 minutos.'}`).

- [ ] **Step 1: Write the failing tests:**
  - unidade `chaveAdminConfere`: chave certa com `ADMIN_ROTAS='1'` → `true`; chave certa sem `ADMIN_ROTAS` → `false`; chave de outro tamanho → `false` sem lançar; array `['a','b']` → `false`; `ADMIN_KEY` indefinida → `false`.
  - HTTP: 6 chamadas seguidas a `/admin/definir_senha` com chave errada → a 6ª é 429.
  - `/migrar_senhas` com linha `{CODIGO: 1, SENHA: null}` e outra `{CODIGO: 2, SENHA: ''}` → nenhum `UPDATE` executado para elas, resposta traz `ignorados: 2`; senha em texto puro `'abc12345'` continua virando hash `$2`.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** o módulo e trocar as comparações `chave !== process.env.ADMIN_KEY` por `!chaveAdminConfere(req)`, com `limitadorAdmin` antes do handler; em `/migrar_senhas` pular `SENHA` nula ou vazia e contar em `ignorados`. Documentar `ADMIN_ROTAS=1` no `CLAUDE.md` (**as rotas ficam desligadas por padrão; o dono liga só quando precisar**).
- [ ] **Step 4: Run** `npm test` — Expected: PASS.
- [ ] **Step 5: Commit** `fix(seguranca): ADMIN_KEY em tempo constante, limitada e desligada por padrão`.

---

### Task 4: Login endurecido (tempo igual, limite por conta, auditoria)

**Files:**
- Create: `seguranca/login_limite.js`
- Modify: `index.js:184-218` (rota `/login`)
- Test: `test/seguranca_login.test.js` (e ajustar `test/login.test.js` se o limite por IP atual mudar de valor)

**Interfaces:**
- Produces: `criarLimiteLogin({ maxFalhas = 5, janelaMs = 15 * 60 * 1000, agora = Date.now }): { bloqueado(chave): { bloqueado: boolean, segundos: number }, falhou(chave): void, limpar(chave): void }` (chave = usuário em minúsculas); `HASH_FALSO: string` (hash bcrypt de um valor aleatório gerado na subida).
- Consumes: `auditar` não existe como função compartilhada; usar o `INSERT INTO web_auditoria` direto, como `rotas/admin.js:16`.

- [ ] **Step 1: Write the failing tests:**
  - unidade: 5 `falhou('caio')` → `bloqueado('caio').bloqueado === true` e `segundos > 0`; passada a janela (relógio injetado) → `false`; `limpar` zera.
  - HTTP: usuário inexistente executa `bcrypt.compare` mesmo assim (espiar `bcrypt.compare` com `t.mock.method`: chamado 1 vez) e responde 401 com a mesma mensagem da senha errada.
  - HTTP: 5 senhas erradas para `Caio` vindas de IPs diferentes (header `X-Forwarded-For` com `TRUST_PROXY_HOPS`) → a 6ª, mesmo com a senha certa, é `429` (limite por conta independe do IP).
  - HTTP: login certo grava `web_auditoria` com `acao = 'login_ok'`; errado grava `'login_falha'`; `detalhe` contém `ip` e **não** contém a senha (assert por `JSON.stringify(chamadas)`).
  - login certo limpa a contagem da conta.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** o módulo (em memória, uma instância única do Render; registrar essa limitação no `CLAUDE.md`) e ligar na rota: checar `bloqueado` antes de tudo; em usuário inexistente comparar com `HASH_FALSO`; chamar `falhou`/`limpar`; auditar sucesso e falha (erro ao auditar não derruba o login).
- [ ] **Step 4: Run** `npm test` — Expected: PASS.
- [ ] **Step 5: Commit** `fix(seguranca): login com tempo igual, limite por conta e auditoria`.

---

### Task 5: Token com tipo e barreira central contra usuário externo

**Files:**
- Modify: `seguranca/rotas.js` (registrar as rotas autenticadas), `index.js:93-122` (`gerarToken`, `autenticar`)
- Test: `test/seguranca_barreira.test.js`

**Interfaces:**
- Produces: `registro.rotasAutenticadas(): Array<{ metodo: string, caminho: string }>` (preenchido por `rota(...)`, não por `publica`); token de funcionário passa a levar `tipo: 'funcionario'`; `autenticar` recusa com 401 qualquer token cujo `tipo` exista e seja diferente de `'funcionario'`.

- [ ] **Step 1: Write the failing tests:**
  - `token com tipo cliente e recusado em toda rota autenticada`: para cada item de `registro.rotasAutenticadas()` (substituindo `:param` por `1`), chama o método HTTP com `Authorization: Bearer <jwt tipo:'cliente', issuer 'elegance-api', v:2>` e afirma `status 401` (nunca 2xx nem 5xx); a lista tem de ter mais de 50 rotas (guarda contra lista vazia).
  - `token sem tipo (emitido antes) continua valendo`: usa o `tokenV2` já existente em `test/login.test.js` numa rota simples.
  - `gerarToken inclui tipo funcionario` (decodificar o token do `/login`).
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** a lista em `seguranca/rotas.js`, o campo `tipo` no token e a recusa em `autenticar`.
- [ ] **Step 4: Run** `npm test` — Expected: PASS.
- [ ] **Step 5: Commit** `fix(seguranca): token de cliente é recusado em toda rota de funcionário`.

---

### Task 6: Sessões revogáveis de funcionário

**Files:**
- Create: `seguranca/sessoes.js`
- Modify: `seguranca/instalacao.js` (tabela), `index.js` (login cria sessão; `autenticar` confere; `POST /logout`), `rotas/admin.js:239` e `index.js` `/admin/definir_senha` (revogar todas ao trocar senha), `layout.js:185` e `layout.js:266` (chamar o logout), `CLAUDE.md`
- Test: `test/seguranca_sessoes.test.js`

**Interfaces:**
- Produces: tabela `web_sessoes (id CHAR(32) PK, usuario_codigo INT NOT NULL, criado_em DATETIME NOT NULL, expira_em DATETIME NOT NULL, ip VARCHAR(45), revogada TINYINT NOT NULL DEFAULT 0, KEY idx_sessao_usuario (usuario_codigo))`; `criarSessoes({ pool, agora = () => new Date() }): { criar(usuarioCodigo, ip): Promise<string>, valida(sid, usuarioCodigo): Promise<boolean>, revogar(sid): Promise<void>, revogarTodas(usuarioCodigo, { exceto } = {}): Promise<void> }`; o JWT passa a levar `sid`; `POST /logout` (`registro.rota('post', '/logout', [], …)`, resposta `{ ok: true }`).
- Decisão: token **sem** `sid` é recusado (401 "Sessão expirada. Faça login novamente."); como o token vale 8 h, cada usuário precisa entrar uma vez após o deploy. Sem período de convivência.

- [ ] **Step 1: Write the failing tests:**
  - unidade com banco falso: `criar` devolve id de 32 hex e insere com `expira_em` = agora + 8 h; `valida` é `false` para sessão revogada, expirada, de outro usuário ou inexistente; `revogarTodas('exceto')` não revoga a atual.
  - HTTP: login devolve token com `sid`; chamada autenticada com esse token passa; após `POST /logout` a **mesma** chamada responde 401 **imediatamente**, mesmo com `acesso.carregar` em cache (Review Focus 3).
  - HTTP: token sem `sid` → 401.
  - HTTP: `/logout` duas vezes e com token expirado → sem 5xx (segunda 200 ou 401 conforme o token, nunca exceção) (Review Focus 5).
  - HTTP: `POST /admin/usuarios/:codigo/senha` chama `revogarTodas` desse usuário (UPDATE com `revogada = 1` nas chamadas do banco falso).
  - teste estático: `layout.js` contém uma chamada a `/logout` antes de `removeItem('auth')` nos dois pontos de saída.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** o módulo; `autenticar` confere `valida(payload.sid, payload.id)` direto no banco a cada requisição (por chave primária, sem cache); `layout.js` envia `fetch(API_BASE + '/logout', { method: 'POST', headers: { Authorization }, keepalive: true })` e depois remove o `auth`, sem esperar a resposta.
- [ ] **Step 4: Run** `npm test` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(seguranca): sessões de funcionário revogáveis e logout real`.

---

### Task 7: Renomear cliente com histórico e relatório de nomes duplicados

**Files:**
- Modify: `index.js:460-485` (`/clientes/salvar`) e rota nova no mesmo arquivo, `CLAUDE.md`
- Test: `test/seguranca_clientes_nome.test.js`

**Interfaces:**
- Produces: em `POST /clientes/salvar`, renomear a razão social de um cadastro que já tem pedido ou lançamento no nome antigo responde `409 { error: 'Este cliente tem histórico no nome atual. Confirme para renomear.', codigo: 'renomear_confirmar' }` salvo `confirmarRenomear: true` no corpo; auditoria `cliente_renomeado` com `alvo = código` e `detalhe = null`. `GET /clientes/nomes_duplicados` (permissão `clientes.editar`) → `{ duplicados: [{ razaoSocial, qtdCadastros, codigos: number[] }] }`, calculado por `GROUP BY RAZAO_SOCIAL HAVING COUNT(*) > 1` (a mesma comparação que o `JOIN_CLIENTE` usa, então o relatório mostra exatamente os nomes ambíguos).
- Observação para a etapa 2: `ped_orc` e `fluxo_de_caixa` só guardam a razão social, então a ligação continua por nome; a etapa 2 só libera uma empresa no portal se ela **não** aparece neste relatório. Esta tarefa não troca o `JOIN_CLIENTE` por código porque não há coluna de código nessas tabelas.

- [ ] **Step 1: Write the failing tests:** renomear com histórico sem confirmação → 409 e nenhum `UPDATE cadastro_clientes`; com `confirmarRenomear: true` → 200, `UPDATE` e auditoria; renomear cadastro sem histórico → 200 direto; `nomes_duplicados` devolve o agrupamento do banco falso e responde 403 sem `clientes.editar`; nenhum nome de campo da resposta casa com `REGEX_VALOR` (`seguranca/valores.js`).
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** a verificação de histórico (`SELECT 1 FROM ped_orc WHERE RAZAO_SOCIAL = ? LIMIT 1` e `fluxo_de_caixa`, pelo nome antigo) e a rota; a tela de clientes passa a perguntar e reenviar com `confirmarRenomear` ao receber `renomear_confirmar` (ajuste mínimo em `clientes.html`/script correspondente).
- [ ] **Step 4: Run** `npm test` — Expected: PASS.
- [ ] **Step 5: Commit** `fix(seguranca): renomear cliente com histórico pede confirmação; relatório de nomes duplicados`.

---

### Task 8: TLS opcional na conexão com o MySQL

**Files:**
- Create: `seguranca/mysql_ssl.js`
- Modify: `index.js:54-64` (pool), `CLAUDE.md` (seção 4: variáveis)
- Test: `test/seguranca_mysql_ssl.test.js`

**Interfaces:** Produces: `opcoesSsl(env = process.env, lerArquivo = fs.readFileSync): undefined | { rejectUnauthorized: true, ca?: string }` — `undefined` sem `DB_SSL=1`; com `DB_SSL=1` devolve `rejectUnauthorized: true` (nunca `false`) e, se `DB_SSL_CA` apontar um arquivo `.pem`, o conteúdo em `ca`.

- [ ] **Step 1: Write the failing tests:** sem `DB_SSL` → `undefined`; `DB_SSL='1'` → `{ rejectUnauthorized: true }`; com `DB_SSL_CA='x.pem'` e `lerArquivo` falso → `ca` é o conteúdo; arquivo ilegível lança erro com mensagem em português ("Não consegui ler o certificado do banco (DB_SSL_CA).").
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** e passar `ssl: opcoesSsl()` ao `createPool`. **Padrão continua desligado**: o dono precisa confirmar com o HostGator que o MySQL remoto oferece TLS e só então ligar `DB_SSL=1` no Render.
- [ ] **Step 4: Run** `npm test` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(seguranca): TLS opcional no MySQL (DB_SSL, DB_SSL_CA)`.

---

### Task 9: Dependências com vulnerabilidade

**Files:** Modify: `package.json`, `package-lock.json`.

- [ ] **Step 1:** `npm audit --omit=dev` e guardar a saída para o commit.
- [ ] **Step 2:** `npm audit fix` (sem `--force`); se sobrar item que só `--force` resolve, **não** aplicar: listar na mensagem do commit.
- [ ] **Step 3:** `npm test` — Expected: todos PASS. `@anthropic-ai/sdk` permanece fixado em 0.133.0.
- [ ] **Step 4: Commit** `chore(seguranca): npm audit fix`.

---

### Task 10: Verificação manual (sem código) e pendências do dono

- [ ] **Step 1:** Com o banco de leitura (arquivo `db_leitura.env`, usuário só SELECT; não imprimir a senha), listar `cliente_usuarios` com perfil ativo em `web_usuario_acesso` cuja `RAZAO_SOCIAL` não seja a da empresa, e entregar a lista ao dono para decidir quem sai. Nada é alterado.
- [ ] **Step 2:** Conferir se algum login existente tem `SENHA` que não começa com `$2` (ainda texto puro), sem imprimir o valor.
- [ ] **Step 3:** Registrar no `CLAUDE.md` e entregar ao dono a lista de pendências **fora do código**, condição do primeiro cliente real: trocar a senha do MySQL (Render e HostGator), restringir os IPs com acesso, limpar o histórico do git (reescrita destrutiva, só com confirmação), confirmar a visibilidade do repositório, ligar `DB_SSL=1` quando o HostGator confirmar.
- [ ] **Step 4: Commit** `docs: pendências de segurança fora do código`.

---

## Fora deste plano (precisa de decisão do dono)

- **Origem compartilhada `thiagozmb.github.io`:** qualquer outro site Pages da mesma conta lê o `localStorage` do sistema e é aceito pelo CORS e pelo serviço local da porta 3917. Um segredo de pareamento não resolve isso (ficaria no mesmo `localStorage`). A correção real é publicar o front numa origem própria (domínio ou subdomínio da empresa). A spec seção 5.8 previa o pareamento e deve ser corrigida.
- **Token fora do `localStorage` para funcionários e CSP sem `'unsafe-inline'` nas páginas antigas:** trabalho grande no front, fica como meta gradual (o portal novo já nasce assim, etapa 3).
- **Não testável aqui:** TLS real do HostGator, o Render, a senha SMTP.

## Auto-revisão

- Cobertura da spec 5: item 1 → T5; item 2 → T7 (com a ressalva da ligação por nome); item 3 → T3; item 4 → T6; item 5 → T4; item 6 → T2 e T9; item 7 → T8; item 8 → fora do plano, com motivo; item 9 → T10; item 10 → T1 e T10.
- Consistência de nomes: `rotasAutenticadas` (T5), `criarSessoes`/`valida`/`revogarTodas` (T6), `chaveAdminConfere` (T3), `criarLimiteLogin`/`HASH_FALSO` (T4), `opcoesSsl` (T8).
- Ordem: T4 antes de T6 (ambos alteram `/login`; T6 acrescenta a sessão ao fluxo já endurecido); T5 antes de T6 (T6 muda o mesmo `autenticar`).
