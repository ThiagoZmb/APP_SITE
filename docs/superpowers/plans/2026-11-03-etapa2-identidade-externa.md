# Etapa 2 — Identidade externa do portal do cliente: plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar ao cliente uma identidade própria e segura (convite, senha, 2º fator TOTP, sessão isolada) e à equipe as ferramentas para liberar empresas e convidar o administrador geral, sem expor nenhum dado de pedido ou financeiro ainda.

**Architecture:** O portal é um conjunto de rotas `/portal/api/*` e de páginas `/portal/*` servidas **pelo próprio servidor da API** (mesma origem, decisão do dono), com sessão opaca em cookie `__Host-portal` guardada com hash no banco, nunca JWT e nunca o `JWT_SECRET` dos funcionários. O registro de rotas ganha duas categorias (`portal` e `portalPublica`) para que nenhuma rota do portal escape da barreira. A equipe opera por rotas `/admin/portal/*` com a permissão nova `portal.gerir`.

**Tech Stack:** Node.js, Express 4, mysql2, bcryptjs, `node:crypto` (TOTP, AES-256-GCM), nodemailer (única dependência nova, versão fixada), `node:test` com banco falso.

**Spec:** `docs/superpowers/specs/2026-11-03-portal-do-cliente-seguranca-design.md` (seções 6, 8, 9, 10). A Tarefa 10 corrige a spec onde este plano decide diferente (sessão opaca em vez de JWT, 7 tabelas, login em um passo, páginas na mesma origem).

## Global Constraints

- Testes com `node:test` e `node:assert/strict`; cada arquivo começa com `process.env.JWT_SECRET = 'teste'; process.env.NODE_ENV = 'test';`. Nenhum teste precisa de MySQL, SMTP ou navegador reais (banco falso `test/apoio/poolFalso.js`, transporte de e-mail injetado).
- Toda rota nasce por `registro.rota`, `registro.publica`, `registro.portal` ou `registro.portalPublica`; `registro.verificar()` passa e continua recusando Router montado.
- Tabelas do VB não são alteradas. Tabelas novas `web_portal_*` em `seguranca/instalacao.js`, sem FK.
- Mensagens ao usuário em português. Nunca registrar em log, auditoria ou resposta: senha, token, segredo TOTP, código TOTP, código de recuperação, e-mail completo de conta inexistente, `err.message` de banco (logar só `err.code || 'sem código'`).
- Senha: 12 a 72 bytes UTF-8 (limite do bcrypt), bcrypt com `CUSTO_BCRYPT` (12, de `seguranca/login_limite.js`). Convite: 48 h, uso único, só o hash SHA-256 no banco. Sessão: cookie `__Host-portal` com `HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=28800`, expiração absoluta de 8 h e inatividade de 60 min.
- A resposta de login é a mesma (401 `E-mail, senha ou código inválidos.`) para e-mail inexistente, senha errada, código errado, empresa suspensa ou usuário inativo, com o mesmo trabalho (hash falso, verificação TOTP fictícia).
- Commits na `main`, um por tarefa, **sem push**, terminando com `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. `npm test` inteiro verde (além da linha de base: 2 falhas fixas pré-existentes e testes instáveis do SEFAZ) antes de cada commit. Atualizar `CLAUDE.md` na tarefa que muda comportamento ou variável de ambiente.

## Review Focus

1. **Login em tempo e resposta iguais** para e-mail inexistente, senha errada, código errado, empresa suspensa e usuário inativo (Tarefa 7).
2. **Convite:** reutilização, expirado, lixo/tamanho estranho e dois aceites simultâneos (só um vence; a marcação de uso é atômica) (Tarefa 7).
3. **TOTP:** repetição do mesmo código dentro da janela (guardar o último passo usado), deriva de ±1 passo, espaços no código, não-dígitos (Tarefa 2 e 7).
4. **Tokens cruzados:** cookie do portal enviado como `Bearer` nas rotas de funcionário e JWT de funcionário enviado como cookie nas rotas do portal dão 401; empresa suspensa no meio da sessão derruba a requisição seguinte (Tarefas 1, 5 e 6).
5. **CSRF e origem:** POST sem o cabeçalho `X-Portal: 1` ou com `Origin` diferente da base dá 403, inclusive o logout; o `cors` global não pode virar 500 num POST do próprio portal (Tarefa 5).

---

## Estrutura de arquivos

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `seguranca/rotas.js` | modificar | categorias `portal` e `portalPublica`, listas conferidas |
| `portal/senha.js`, `totp.js`, `cripto.js`, `tokens.js` | criar | primitivas puras |
| `portal/config.js` | criar | `lerConfigPortal` |
| `portal/limpeza.js` | criar | retenção |
| `portal/email.js` | criar | envio do convite |
| `portal/cookie.js`, `portal/sessoes.js`, `portal/acesso.js`, `portal/auditoria.js` | criar | sessão, autenticação e auditoria do portal |
| `rotas/portal_admin.js` | criar | rotas da equipe `/admin/portal/*` |
| `rotas/portal_auth.js` | criar | `/portal/api/*` (convite, login, logout, eu) |
| `portal/public/*` | criar | páginas e scripts do portal |
| `portal_admin.html`, `portal_admin.js` | criar | tela da equipe |
| `seguranca/permissoes.js`, `seguranca/instalacao.js`, `index.js` | modificar | permissão, 7 tabelas, ligações |

---

### Task 1: Registro de rotas do portal e lista fixa

**Files:**
- Modify: `seguranca/rotas.js`
- Test: `test/seguranca_registro.test.js` (estender), `test/seguranca_barreira.test.js` (estender)

**Interfaces:**
- Produces: `criarRegistro(app, { autenticado, portalPublico = [], portalAutenticado = [] })` passa a devolver também `portal(metodo, caminho, exige, ...handlers)` (prefixa `portalAutenticado` e a permissão do portal `exige`: lista de códigos `pedidos.ver`, `documentos.ver`, `financeiro.ver`, vazia = qualquer usuário ativo do portal), `portalPublica(metodo, caminho, ...handlers)` (prefixa `portalPublico`), `rotasPortal()` e `rotasPortalPublicas()` (cópias de `{ metodo, caminho }`). `verificar()` aceita as quatro categorias e continua recusando rota solta e Router montado.
- A permissão do portal é lida de `req.portal.permissoes` (um `Set`), preenchido na Tarefa 5.

- [ ] **Step 1: Write the failing tests:** (a) `rotasPortalPublicas()` e `rotasPortal()` devolvem cópias e começam vazias; (b) rota criada por `portal(...)` aparece só em `rotasPortal()`, e `portalPublica(...)` só em `rotasPortalPublicas()`; (c) rota `portal` sem `req.portal` responde 401 (o guarda de `portalAutenticado` injetado nega) e com permissão faltando responde 403 `{ error: 'Sem permissão para esta ação.' }`; (d) `verificar()` lança para `app.get` solto e para Router montado, e passa com as quatro categorias; (e) em `test/seguranca_barreira.test.js`: um cookie `__Host-portal=<hex qualquer>` não autentica nenhuma das rotas de funcionário, e um `Authorization: Bearer <32 hex aleatórios>` (formato de sessão do portal) dá 401 em todas as rotas de `rotasAutenticadas()` (com `sid` e `tipo` válidos já provados na etapa 1, aqui é o caminho inverso).
- [ ] **Step 2: Run** `node --test test/seguranca_registro.test.js test/seguranca_barreira.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement** em `seguranca/rotas.js` as duas categorias e as duas listas; mesmo mecanismo de `MARCA` das rotas existentes.
- [ ] **Step 4: Run** os mesmos arquivos e `npm test` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(portal): categorias de rota do portal no registro`.

---

### Task 2: Primitivas puras (senha, TOTP, cifra, tokens)

**Files:**
- Create: `portal/senha.js`, `portal/totp.js`, `portal/cripto.js`, `portal/tokens.js`
- Test: `test/portal_primitivas.test.js`

**Interfaces:**
- `validarSenha(senha: string, { email }: { email: string }): { ok: boolean, motivo?: string }` — recusa menos de 12 caracteres, mais de 72 **bytes** UTF-8, só um caractere repetido, contida no e-mail ou contendo a parte antes do `@` (sem caixa), e as senhas da lista fixa `SENHAS_FRACAS` (exportada, pelo menos `123456789012`, `senhasenha12`, `elegance2026`, `elegancealuminio`, `qwertyuiop12`). Mensagens em português, uma por motivo.
- `gerarSegredo(): string` (20 bytes aleatórios em base32 RFC 4648, sem padding); `codigoEm(segredo: string, passo: number): string` (6 dígitos, HMAC-SHA1, passo de 30 s); `verificar(segredo: string, codigo: string, { agora = Date.now(), ultimoPasso = 0 } = {}): { ok: boolean, passo?: number }` — aceita passos atual ±1, só passos **maiores** que `ultimoPasso`, ignora espaços no código e recusa qualquer coisa que não seja 6 dígitos; `uriOtpauth({ segredo, email, emissor = 'Elegance' }): string`.
- `criarCripto(chaveBase64: string): { cifrar(texto: string): string, decifrar(blob: string): string }` — AES-256-GCM, formato `v1:<iv>:<tag>:<cifrado>` (base64), IV novo a cada chamada; lança `Error` se a chave não tiver 32 bytes; `decifrar` lança em blob adulterado ou de outra chave.
- `novoTokenOpaco(): { token: string, hash: string }` (32 bytes em base64url + SHA-256 hex); `hashToken(token: string): string`; `gerarCodigosRecuperacao(n = 10): { codigos: string[], hashes: string[] }` (formato `XXXX-XXXX`, alfabeto sem `0 O 1 I L`); `hashCodigoRecuperacao(codigo: string): string` (normaliza para maiúsculas, sem `-` nem espaço).

- [ ] **Step 1: Write the failing tests:** senha (limites 11/12 caracteres, 72/73 bytes com acentos, repetida, contida no e-mail, lista fraca, aceita uma boa); TOTP com os **vetores do RFC 6238** (segredo ASCII `12345678901234567890`, tempos 59, 1111111109, 1111111111, 1234567890, 2000000000, 20000000000, códigos de 6 dígitos 287082, 081804, 050471, 005924, 279037, 353130), deriva ±1 aceita e ±2 recusada, o mesmo passo recusado na segunda vez (`ultimoPasso`), `'287 082'` aceito e `'28708a'`/`'12345'`/`''` recusados; cifra (ida e volta, IV diferente a cada vez, adulteração e chave errada lançam, chave de 31 bytes lança); tokens (comprimento, `hash` = SHA-256 do token, dois tokens diferentes, códigos de recuperação únicos e `hashCodigoRecuperacao('abcd efgh') === hashCodigoRecuperacao('ABCD-EFGH')`).
- [ ] **Step 2: Run** `node --test test/portal_primitivas.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement** os quatro módulos só com `node:crypto` (sem dependências); base32 próprio de poucas linhas.
- [ ] **Step 4: Run** o teste — Expected: PASS.
- [ ] **Step 5: Commit** `feat(portal): primitivas de senha, TOTP, cifra e tokens`.

---

### Task 3: Configuração, 7 tabelas, permissão `portal.gerir` e retenção

**Files:**
- Create: `portal/config.js`, `portal/limpeza.js`
- Modify: `seguranca/instalacao.js` (tabelas e `acrescentarPermissoesPortal`), `seguranca/permissoes.js` (catálogo), `index.js` (instalar na subida)
- Test: `test/portal_config.test.js`, `test/portal_instalacao.test.js`, `test/portal_limpeza.test.js`; ajustar `test/instalacao.test.js` (34 → 41 tabelas)

**Interfaces:**
- `lerConfigPortal(env = process.env): { ativo: boolean, motivo?: string, baseUrl?: string, chaveCripto?: string, termoVersao: string, smtp?: { host: string, port: number, user: string, pass: string, from: string } }` — `ativo` só com `PORTAL_URL_BASE` (`https://…`, sem caminho nem barra final; `http://localhost…` só com `NODE_ENV` diferente de `production`) e `PORTAL_CHAVE_CRIPTO` (base64 de exatamente 32 bytes); sem eles `ativo: false` e `motivo` em português; `termoVersao = PORTAL_TERMO_VERSAO || '2026-11-rascunho'`; `smtp` só se `SMTP_HOST`, `SMTP_USER` e `SMTP_PASS` existirem (`SMTP_PORT` padrão 465, `SMTP_FROM` padrão = `SMTP_USER`). Nunca devolve valores no `motivo`.
- Tabelas (todas `ENGINE`/charset como as demais; e-mail em `utf8mb4_bin`): `web_portal_empresas (cliente_codigo INT PK, situacao ENUM('ativa','suspensa') NOT NULL DEFAULT 'ativa', liberado_por VARCHAR(100) NOT NULL, liberado_em DATETIME NOT NULL, suspenso_em DATETIME NULL)`; `web_portal_usuarios (id INT AUTO_INCREMENT PK, email VARCHAR(190) COLLATE utf8mb4_bin NOT NULL UNIQUE, cliente_codigo INT NOT NULL, papel ENUM('admin_geral','usuario') NOT NULL, situacao ENUM('convidado','ativo','inativo') NOT NULL DEFAULT 'convidado', senha_hash VARCHAR(100) NULL, totp_segredo_cifrado VARCHAR(400) NULL, totp_ativo TINYINT NOT NULL DEFAULT 0, totp_ultimo_passo BIGINT NOT NULL DEFAULT 0, senha_alterada_em DATETIME NULL, termo_versao VARCHAR(30) NULL, termo_aceito_em DATETIME NULL, criado_em DATETIME NOT NULL, criado_por VARCHAR(100) NOT NULL, KEY idx_portal_usuario_empresa (cliente_codigo))`; `web_portal_permissoes (usuario_id INT NOT NULL, permissao VARCHAR(60) NOT NULL, PRIMARY KEY (usuario_id, permissao))`; `web_portal_convites (id INT AUTO_INCREMENT PK, token_hash CHAR(64) NOT NULL UNIQUE, usuario_id INT NOT NULL, expira_em DATETIME NOT NULL, usado_em DATETIME NULL, criado_por VARCHAR(100) NOT NULL, criado_em DATETIME NOT NULL, KEY idx_portal_convite_usuario (usuario_id))`; `web_portal_recuperacao (usuario_id INT NOT NULL, codigo_hash CHAR(64) NOT NULL, usado_em DATETIME NULL, PRIMARY KEY (usuario_id, codigo_hash))`; `web_portal_sessoes (id CHAR(64) PK, usuario_id INT NOT NULL, criado_em DATETIME NOT NULL, expira_em DATETIME NOT NULL, ultimo_uso_em DATETIME NOT NULL, ip VARCHAR(45) NULL, revogada TINYINT NOT NULL DEFAULT 0, KEY idx_portal_sessao_usuario (usuario_id))`; `web_portal_auditoria (id INT AUTO_INCREMENT PK, quando DATETIME NOT NULL, evento VARCHAR(40) NOT NULL, usuario_id INT NULL, cliente_codigo INT NULL, ip VARCHAR(45) NULL, detalhe TEXT NULL, KEY idx_portal_audit_evento (evento), KEY idx_portal_audit_quando (quando))`.
- Permissão `portal.gerir` no catálogo (área "Administração", nome "Gerenciar o portal do cliente: liberar empresas, convidar, suspender e reiniciar o 2º fator"); fora do perfil "Interno completo" (acrescentar à lista de exclusões); `acrescentarPermissoesPortal(pool)` dá só ao Administrador, com o mesmo marcador/idempotência de `darAoAdministrador` (`seguranca/instalacao.js`), e é chamada na subida em `index.js`.
- `limparPortal(pool, { agora = () => new Date() } = {}): Promise<{ auditoria: number, sessoes: number, convites: number }>` apaga auditoria com mais de 12 meses, sessões expiradas há mais de 1 dia e convites expirados há mais de 30 dias; roda na subida e a cada 24 h (`setInterval(...).unref()`), nunca em `NODE_ENV=test`.

- [ ] **Step 1: Write the failing tests:** config (ativa com as duas variáveis válidas; inativa sem `PORTAL_URL_BASE`, com `http://` em `production`, com barra final, com caminho, com chave de 31 bytes e sem chave; `smtp` ausente sem as três variáveis; porta padrão; o `motivo` nunca contém o valor das variáveis); instalação (as 7 DDL existem, `web_portal_usuarios.email` é `utf8mb4_bin`, nenhuma `FOREIGN KEY`, `portal.gerir` no catálogo e fora do "Interno completo", `acrescentarPermissoesPortal` idempotente e só para o Administrador); limpeza (os três `DELETE` com os intervalos certos e o relógio injetado, devolve as contagens de `affectedRows`).
- [ ] **Step 2: Run** os três arquivos — Expected: FAIL.
- [ ] **Step 3: Implement** os módulos e ligar a instalação, a permissão e a limpeza em `index.js`.
- [ ] **Step 4: Run** `npm test` — Expected: PASS (contagem de tabelas atualizada para 41).
- [ ] **Step 5: Commit** `feat(portal): configuração, tabelas, permissão portal.gerir e retenção`.

---

### Task 4: Envio de convite por e-mail

**Files:**
- Create: `portal/email.js`
- Modify: `package.json`, `package-lock.json` (nodemailer fixado, sem `^`; verificar `npm audit --omit=dev` limpo)
- Test: `test/portal_email.test.js`

**Interfaces:**
- `criarEmail({ smtp, criarTransporte = nodemailer.createTransport }): { configurado: boolean, enviarConvite({ para, link, razaoSocial }): Promise<{ enviado: boolean }> }` — sem `smtp` devolve `configurado: false` e `enviarConvite` responde `{ enviado: false }` sem tentar. O corpo do e-mail é texto simples em português com o link e a validade (48 h), **sem a senha SMTP nem o token em log**; erro de envio nunca lança: devolve `{ enviado: false }` e loga só `err.code || 'sem código'`.

- [ ] **Step 1: Write the failing tests** com transporte falso: sem `smtp` não chama o transporte; com `smtp` chama `sendMail` uma vez com `to`, `from` (= `smtp.from`), assunto "Convite para o portal Elegance" e o link no corpo; erro do transporte vira `{ enviado: false }` e o `console.error` capturado não contém o link nem a senha; o transporte é criado com `secure: true` quando a porta é 465.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** e adicionar `nodemailer` com versão exata (`npm install --save-exact nodemailer`; escolher a versão estável mais recente com mais de duas semanas).
- [ ] **Step 4: Run** `npm test` e `npm audit --omit=dev` — Expected: PASS e 0 vulnerabilidades.
- [ ] **Step 5: Commit** `feat(portal): envio do convite por e-mail (nodemailer)`.

---

### Task 5: Infraestrutura da sessão do portal (cookie, sessão, autenticação, CSRF, CORS, auditoria)

**Files:**
- Create: `portal/cookie.js`, `portal/sessoes.js`, `portal/acesso.js`, `portal/auditoria.js`
- Modify: `index.js` (cors, cabeçalhos do portal, registro com os guardas)
- Test: `test/portal_sessoes.test.js`, `test/portal_acesso.test.js`

**Interfaces:**
- `lerCookie(req, nome): string | null` (parse simples do cabeçalho `Cookie`, sem dependência); `cookieSessao(valor, { maxAgeSeg = 28800 }): string` e `cookieLimpar(): string` (strings de `Set-Cookie` com `__Host-portal`, `HttpOnly; Secure; SameSite=Strict; Path=/`).
- `criarSessoesPortal({ pool, agora = () => new Date() }): { criar(usuarioId: number, ip: string): Promise<string> /* token opaco */, valida(token: string): Promise<{ usuarioId: number } | null>, revogar(token: string): Promise<void>, revogarUsuario(usuarioId: number): Promise<void>, revogarEmpresa(clienteCodigo: number): Promise<void> }` — guarda só `hashToken(token)`; `valida` recusa token de formato inválido sem consultar o banco, sessão revogada, expirada (8 h absolutas), inativa há mais de 60 min, e atualiza `ultimo_uso_em` no máximo uma vez por minuto; datas gravadas e comparadas pelo mesmo caminho (como `seguranca/sessoes.js`).
- `criarAcessoPortal({ pool, sessoes, config }): { portalAtivo, portalAutenticar }` — middlewares: `portalAtivo` responde `503 { error: 'Portal não configurado.' }` se `config.ativo` for falso; `portalAutenticar` lê o cookie, valida a sessão e carrega `req.portal = { usuarioId, empresaCodigo, papel, email, razaoSocial, permissoes: Set }`; responde 401 `{ error: 'Sessão expirada. Entre novamente.' }` (mesma mensagem para tudo) se a sessão for inválida, o usuário não estiver `ativo`, a empresa não estiver `ativa` em `web_portal_empresas` **ou o nome da empresa deixar de ser único** (`empresaLiberavel`, abaixo) — conferido **a cada requisição**; em método diferente de GET/HEAD exige o cabeçalho `X-Portal: 1` e, se houver `Origin`, igual a `config.baseUrl`, senão 403 `{ error: 'Requisição recusada.' }`. Permissões do administrador geral = as três do portal; as do usuário vêm de `web_portal_permissoes` (só códigos conhecidos).
- `empresaLiberavel(pool, clienteCodigo): Promise<{ ok: boolean, motivo?: 'inexistente'|'nome_duplicado'|'ja_liberada' }>` (exportada de `portal/acesso.js`): o cadastro existe em `cadastro_clientes`, `COUNT(*)` por `RAZAO_SOCIAL` (a mesma comparação do `JOIN_CLIENTE`) é 1; `ja_liberada` só é devolvido ao **liberar** (parâmetro `{ aoLiberar: true }`).
- `auditarPortal(pool, { evento, usuarioId = null, clienteCodigo = null, ip = null, detalhe = null }): Promise<void>` — grava em `web_portal_auditoria`; **nunca lança** (falha vira `console.error` só com `err.code`); `detalhe` objeto vira JSON.
- CORS: no `index.js` o `origin()` global passa a aceitar também `config.baseUrl` **somente** para caminhos `/portal/` (usar a forma `cors((req, cb) => …)`); fora dele nada muda. Cabeçalhos do portal: middleware antes das rotas, só em `/portal`, com `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'`, `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`.
- `index.js` cria o registro com `portalPublico: [portalAtivo]` e `portalAutenticado: [portalAtivo, portalAutenticar]`.

- [ ] **Step 1: Write the failing tests:** cookie (parse com vários cookies, valor ausente, `Set-Cookie` exato com todos os atributos e `Max-Age=0` ao limpar); sessões (criar grava só o hash, nunca o token; `valida` false para formato inválido sem consulta, revogada, expirada 8 h, inativa 61 min, e true no limite; `ultimo_uso_em` atualizado no máximo 1 vez por minuto; `revogarEmpresa` atualiza por `cliente_codigo` via junção); acesso (503 sem configuração; 401 uniforme para sessão inválida, usuário `convidado`/`inativo`, empresa `suspensa` **no meio da sessão** e nome duplicado; 200 com `req.portal` correto; permissões do `admin_geral` = as três e do `usuario` = só as da tabela, ignorando código desconhecido; POST sem `X-Portal` = 403, com `Origin` de outro site = 403, com `Origin` igual à base e `X-Portal: 1` passa; GET não exige o cabeçalho); `empresaLiberavel` (inexistente, duplicado, ok, já liberada só com `aoLiberar`); `auditarPortal` não lança com banco quebrado; teste de CORS: POST com `Origin` = base em `/portal/api/...` não vira 500 e em `/clientes/salvar` continua recusado; cabeçalhos do portal presentes só em `/portal/`.
- [ ] **Step 2: Run** os dois arquivos — Expected: FAIL.
- [ ] **Step 3: Implement** os quatro módulos e as ligações no `index.js`.
- [ ] **Step 4: Run** `npm test` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(portal): sessão opaca, autenticação por cookie, CSRF, CORS e auditoria do portal`.

---

### Task 6: Rotas da equipe `/admin/portal/*`

**Files:**
- Create: `rotas/portal_admin.js`
- Modify: `index.js` (registrar)
- Test: `test/portal_admin_rotas.test.js` (banco falso `test/apoio/bancoPortal.js`, a criar)

**Interfaces:** `registrarPortalAdmin({ rota, pool, sessoes, email, config })`. Todas por `rota(..., ['portal.gerir'], …)`, com auditoria em `web_auditoria` (`acao`: `portal_empresa_liberada`, `portal_empresa_suspensa`, `portal_empresa_reativada`, `portal_convite_criado`, `portal_2fa_reiniciado`; `alvo` = código ou id; `detalhe` só com ids) — nunca e-mail nem token.
- `GET /admin/portal/clientes?q=` → `{ clientes: [{ codigo, razaoSocial, cnpjCpf, situacaoPortal: 'nao_liberada'|'ativa'|'suspensa', liberavel: boolean, motivo?: string }] }` (até 50; `q` por razão social ou código).
- `GET /admin/portal/empresas` → `{ empresas: [{ clienteCodigo, razaoSocial, situacao, qtdUsuarios }] }`; `GET /admin/portal/empresas/:codigo/usuarios` → `{ usuarios: [{ id, email, papel, situacao }] }`.
- `POST /admin/portal/empresas` `{ clienteCodigo }` → libera (usa `empresaLiberavel(..., { aoLiberar: true })`; 409 com mensagem em português para `nome_duplicado` e `ja_liberada`, 404 para inexistente); `POST /admin/portal/empresas/:codigo/suspender` (revoga as sessões da empresa na hora) e `…/reativar`.
- `POST /admin/portal/convites` `{ clienteCodigo, email }` → cria o administrador geral: exige empresa liberada e `ativa`, e-mail ASCII válido (até 190, minúsculo e sem espaços; 400 senão), 409 se o e-mail já existir; cria usuário `convidado` com papel `admin_geral` e um convite de 48 h (token de `novoTokenOpaco`, link `${config.baseUrl}/portal/convite.html#${token}`, no **fragmento**); tenta o e-mail; responde `{ emailEnviado: boolean, link?: string }` com o `link` **somente** quando o e-mail não foi enviado (a equipe copia e envia à mão); o token nunca é devolvido de outra forma nem registrado.
- `POST /admin/portal/usuarios/:id/reenviar_convite` (só usuário `convidado`; invalida os convites anteriores e cria novo) e `POST /admin/portal/usuarios/:id/reiniciar_2fa` (só `ativo`; zera segredo, `totp_ativo`, `totp_ultimo_passo` e códigos de recuperação, volta a `convidado`, revoga as sessões e cria novo convite); mesma resposta de `convites`. A conta de um usuário só é alterada se `cliente_codigo` da rota/usuário existir; id inexistente = 404.

- [ ] **Step 1: Write the failing tests:** 403 sem `portal.gerir` em todas; barreira de token de cliente já cobre (`rotasAutenticadas`); liberar (ok, duplicado 409, já liberada 409, inexistente 404); suspender revoga sessões e reativar volta; convite (empresa não liberada 400, e-mail inválido 400, repetido 409, ok com e-mail configurado devolve `emailEnviado: true` **sem** `link`, sem e-mail devolve `link` com `#token` e o token do link confere com `token_hash` gravado, o `INSERT` nunca contém o token em claro); reenviar invalida o anterior (`UPDATE ... usado_em`); reiniciar 2FA zera tudo e revoga sessões; auditoria sem e-mail nem token nas chamadas ao banco; nenhum nome de campo casa com `REGEX_VALOR` (`seguranca/valores.js`).
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** o módulo e o banco falso; registrar em `index.js`.
- [ ] **Step 4: Run** `npm test` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(portal): rotas da equipe para liberar empresas e convidar o administrador geral`.

---

### Task 7: Rotas de autenticação do portal

**Files:**
- Create: `rotas/portal_auth.js`
- Modify: `index.js` (registrar; limitador por IP)
- Test: `test/portal_auth_rotas.test.js`

**Interfaces:** `registrarPortalAuth({ portal, portalPublica, pool, sessoes, cripto, config })`. Limite por IP nas rotas públicas (`express-rate-limit`, 10 falhas por 15 min, `skipSuccessfulRequests: true`) e limite por conta com `criarLimiteLogin` (`seguranca/login_limite.js`; chave `c:<id>` se o e-mail existe, `n:<e-mail minúsculo>` se não), 429 igual nos dois casos.
- `POST /portal/api/convite/iniciar` `{ token }` (`portalPublica`) → valida o convite (existe, não usado, não expirado, usuário `convidado`, empresa `ativa`); gera segredo TOTP novo, grava cifrado em `totp_segredo_cifrado` (`totp_ativo = 0`); responde `{ email, segredo, uri, termoVersao }`. Qualquer falha de token = 400 `{ error: 'Convite inválido ou expirado.' }` (mesma mensagem).
- `POST /portal/api/convite/concluir` `{ token, senha, codigo, aceitoTermo, termoVersao }` (`portalPublica`) → em **uma transação** com o convite e o usuário travados (`FOR UPDATE`): revalida o convite, `aceitoTermo === true` e `termoVersao === config.termoVersao`, `validarSenha`, verifica o código TOTP contra o segredo gravado; só então grava `senha_hash` (bcrypt `CUSTO_BCRYPT`), `totp_ativo = 1`, `totp_ultimo_passo` = passo usado, `situacao = 'ativo'`, termo e data, marca `usado_em` (`UPDATE ... WHERE usado_em IS NULL`, `affectedRows` 1 ou desfaz tudo) e gera 10 códigos de recuperação; responde `{ ok: true, codigosRecuperacao: string[] }` (única vez). Não abre sessão. Falha de senha/código/termo **não consome** o convite. Auditoria `convite_aceito`.
- `POST /portal/api/login` `{ email, senha, codigo }` (`portalPublica`) → um passo; mesmo trabalho em todos os caminhos (hash falso e verificação TOTP fictícia), 401 uniforme (ver Global Constraints); aceita no lugar de `codigo` um código de recuperação (`codigoRecuperacao`), marcando-o usado; `verificar(..., { ultimoPasso })` e grava o novo passo; cria a sessão, `Set-Cookie`, responde `{ ok: true, usuario: { email, papel, empresa: { codigo, razaoSocial }, permissoes: string[] } }`. Auditoria `login_ok`, `login_falha` (sem e-mail de conta inexistente: `detalhe` com um HMAC curto do e-mail, como na etapa 1), `login_bloqueado`, `login_negado` (empresa suspensa/usuário inativo, sem revelar ao cliente).
- `POST /portal/api/logout` (`portal`, exige só sessão válida) → revoga a sessão, limpa o cookie, auditoria `logout`; `GET /portal/api/eu` (`portal`) → mesmo objeto `usuario` do login.

- [ ] **Step 1: Write the failing tests:** convite (iniciar com token inexistente/usado/expirado/lixo → mesma 400; iniciar troca o segredo a cada chamada; concluir com senha fraca, código errado, sem termo ou versão errada → erro **sem** consumir o convite; concluir ok grava hash e ativa; **duas conclusões simultâneas**: só uma vence (a outra 400) e há apenas um conjunto de códigos de recuperação; o token nunca aparece nas chamadas ao banco além do hash; códigos de recuperação gravados só como hash); login (ok devolve cookie com todos os atributos; 5 falhas bloqueiam a conta com 429 igual para e-mail inexistente; tempo/trabalho igual: espiar `bcrypt.compare` chamado 1 vez em todos os caminhos e a verificação TOTP também; empresa suspensa, usuário inativo/convidado e e-mail inexistente dão a mesma resposta; **mesmo código TOTP reutilizado** é recusado; código de recuperação funciona uma vez; sem `X-Portal` ou com `Origin` errado não vale nas rotas `portal` mas as públicas só exigem JSON); logout revoga e a mesma sessão dá 401 em seguida e o logout repetido não dá 5xx; `/eu` com sessão e sem; cookie/Bearer cruzado (JWT de funcionário como cookie → 401 nas rotas do portal); nenhuma resposta ou log contém senha, segredo ou código.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** o módulo; registrar em `index.js`.
- [ ] **Step 4: Run** `npm test` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(portal): convite, login com 2º fator, logout e /eu`.

---

### Task 8: Páginas do portal na mesma origem

**Files:**
- Create: `portal/public/login.html`, `convite.html`, `inicio.html`, `termo.html`, `portal.css`, `login.js`, `convite.js`, `inicio.js`
- Modify: `index.js` (`app.use('/portal', express.static(...))` com `index: false`, `dotfiles: 'deny'`)
- Test: `test/portal_paginas.test.js`

**Interfaces:** páginas em HTML/CSS/JS puros, **sem script nem estilo inline, sem `innerHTML` com dado do servidor** (`textContent`), todas as chamadas com `fetch('/portal/api/...', { credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Portal': '1' } })`. `login.html` (e-mail, senha, código de 6 dígitos ou de recuperação; mensagem de erro única), `convite.html` (lê o token do **fragmento** da URL e o apaga com `history.replaceState`; mostra o segredo e a URI para o aplicativo autenticador, pede senha, confirmação, código, aceite do termo; ao concluir mostra os códigos de recuperação **uma vez** com aviso para guardá-los), `inicio.html` (placeholder: mostra e-mail, empresa e botão Sair; o conteúdo real é da etapa 3), `termo.html` (**texto provisório, marcado com destaque "RASCUNHO — substituir pelo texto jurídico antes do primeiro cliente"**; o texto é do dono).

- [ ] **Step 1: Write the failing tests** (estáticos, como `test/*_tela.test.js`, e HTTP contra o app): cada arquivo `.html` não tem `<script>` sem `src`, atributo `on*=`, `style=` nem `javascript:`; cada `.js` não usa `innerHTML`, `eval`, `document.write` nem `localStorage`/`sessionStorage`; `GET /portal/login.html` devolve 200 com a CSP exata da Tarefa 5 e `Cache-Control: no-store`; `GET /portal/` não lista diretório; `/portal/../index.js` e `/portal/%2e%2e/index.js` não devolvem arquivo; `convite.js` chama `history.replaceState` e envia o cabeçalho `X-Portal`; `termo.html` contém a palavra `RASCUNHO`; nenhum script compila com erro (`new vm.Script`).
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** as páginas e o `express.static`; confirmar que `registro.verificar()` continua passando com o middleware estático.
- [ ] **Step 4: Run** `npm test` — Expected: PASS. **Não testado aqui:** as páginas no navegador real (validar à mão: convite, 2º fator no aplicativo, login e sair).
- [ ] **Step 5: Commit** `feat(portal): páginas de login, convite, termo e início na mesma origem`.

---

### Task 9: Tela da equipe para liberar empresas e convidar

**Files:**
- Create: `portal_admin.html`, `portal_admin.js`
- Modify: `layout.js` (menu "Portal do cliente", subitem de Administração, com `portal.gerir`; entrada em `PAGINAS`)
- Test: `test/portal_admin_tela.test.js`

**Interfaces:** segue o padrão de `tintas.html`/`tintas.js` (cabeçalho com `API_BASE`, CSP própria como as demais páginas do site interno, `layout.js`). Funções: buscar cliente (`GET /admin/portal/clientes?q=`), liberar, listar empresas e usuários, convidar o administrador geral (e-mail), reenviar convite, reiniciar 2º fator (com `confirm`), suspender/reativar (com `confirm`). Quando a resposta traz `link`, mostra-o em um campo somente leitura com botão "Copiar" e o aviso "Envie este link ao cliente por um canal seguro; ele não será mostrado de novo." Mostra o motivo quando uma empresa não é liberável (nome duplicado: orientar a corrigir o cadastro e apontar `GET /clientes/nomes_duplicados`).

- [ ] **Step 1: Write the failing tests** (estáticos): a página existe com a CSP de uma tela interna e `layout.js`; o menu e `PAGINAS` ligam `portal.gerir`; `portal_admin.js` usa `textContent` para dados do servidor (sem `innerHTML` com valor), compila, e pede `confirm` antes de suspender e reiniciar o 2º fator.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** a tela e o menu.
- [ ] **Step 4: Run** `npm test` — Expected: PASS. **Não testado aqui:** a tela no navegador.
- [ ] **Step 5: Commit** `feat(portal): tela da equipe para liberar empresas e convidar`.

---

### Task 10: Documentação e correção da spec

**Files:** Modify: `CLAUDE.md`, `docs/superpowers/specs/2026-11-03-portal-do-cliente-seguranca-design.md`; Create: `docs/portal_configuracao.md`.

- [ ] **Step 1:** `CLAUDE.md`: funcionalidade "Portal do cliente (identidade)" na seção 1; pastas `portal/` e `rotas/portal_*.js` na seção 2; variáveis `PORTAL_URL_BASE`, `PORTAL_CHAVE_CRIPTO`, `PORTAL_TERMO_VERSAO`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` na seção 4 (nomes e finalidade, sem valores; sem elas o portal responde "Portal não configurado."); regras na seção 5 ("Portal do cliente: identidade"): sessão opaca em cookie `__Host-portal`, `X-Portal: 1` + `Origin`, convite no fragmento, empresa conferida a cada requisição (ativa e nome único), login em um passo com resposta uniforme, TOTP com passo não reutilizável, códigos de recuperação, a permissão `portal.gerir` (só Administrador) e o que **não** foi testado (SMTP, navegador, aplicativo autenticador real).
- [ ] **Step 2:** `docs/portal_configuracao.md`: passo a passo do dono (gerar `PORTAL_CHAVE_CRIPTO` com `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`, `PORTAL_URL_BASE` = endereço do servidor no Render, SMTP da conta `portal@elegancealuminio.com.br` **só no painel do Render, nunca no chat nem no git**, confirmar servidor/porta SMTP no painel da UOL, testar convite com e-mail de teste, trocar o texto provisório do termo pelo texto jurídico e subir a versão em `PORTAL_TERMO_VERSAO`, e a lista de pendências que continuam sendo condição para o primeiro cliente real).
- [ ] **Step 3:** Spec: seção 6.1 (7 tabelas, `web_portal_recuperacao`), 6.2 (sessão opaca em cookie na mesma origem, sem JWT; login em um passo; `X-Portal` + `Origin`; inatividade de 60 min), 6.4 e seção 7 (páginas servidas pelo servidor da API; staff e portal em origens diferentes).
- [ ] **Step 4:** `npm test` — Expected: linha de base. **Step 5: Commit** `docs(portal): configuração, CLAUDE.md e ajuste da spec`.

---

## Fora deste plano

- Tudo que o cliente **vê** depois de logar (pedidos, PDFs/DANFE, financeiro) é a etapa 3; as rotas dessas funções usarão `registro.portal(...)` e `req.portal.empresaCodigo`, nunca um código vindo da requisição.
- Criar usuários e permissões da empresa pelo administrador geral é a etapa 4 (esta etapa só cria o administrador geral).
- Troca de senha pelo próprio usuário, recuperação automática e QR code ficam fora (a v1 usa a equipe; o segredo é digitado no aplicativo).
- Pendências do dono que continuam condição do primeiro cliente: senha do MySQL, IPs, histórico do git, texto jurídico do termo, SMTP configurado.

## Auto-revisão

- Cobertura da spec: 6.1 → T3; 6.2 → T5, T7 (com os ajustes da T10); 6.3 → T5 (`empresaLiberavel`) e T6; 6.4 → T4 e T6; 5.1 (barreira/paridade) → T1; seção 9 (auditoria 12 meses, termo versionado) → T3, T5, T7, T8; seção 10 (testes) → cada tarefa.
- Nomes consistentes entre tarefas: `registro.portal`/`portalPublica` e `rotasPortal`/`rotasPortalPublicas` (T1, T5, T7); `criarSessoesPortal` com `revogarUsuario`/`revogarEmpresa` (T5, T6); `empresaLiberavel` (T5, T6); `criarCripto`, `novoTokenOpaco`, `hashToken`, `verificar` (T2, T6, T7); `lerConfigPortal` (T3, T4, T5, T6, T7); `auditarPortal` (T5, T7).
- Ordem: T1 e T2 independentes; T3 antes de T4–T7; T5 antes de T6 e T7; T8 depois de T7; T9 depois de T6.
