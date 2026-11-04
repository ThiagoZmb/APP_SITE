# Portal do cliente, etapa 4: usuários da empresa e permissões. Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** o administrador geral de uma empresa cliente convida, edita permissões, promove, rebaixa, desativa, reenvia convite e remove usuários da própria empresa, com isolamento por empresa, trava do último administrador e auditoria.

**Architecture:** o modelo de permissões do portal ganha `usuarios.gerir` (só do papel `admin_geral`) separado das três concedíveis; os helpers de convite saem de `rotas/portal_admin.js` para `portal/convites.js`; sete rotas `registro.portal(..., ['usuarios.gerir'])` fazem as ações em transação com `FOR UPDATE`; tela `usuarios.html`.

**Tech Stack:** Node.js, Express 4, mysql2 (pool injetado), express-rate-limit, `node:test`, HTML/JS puro com CSP sem inline.

**Spec:** `docs/superpowers/specs/2026-11-04-portal-etapa4-usuarios-design.md`. Padrão de referência: `rotas/portal_admin.js` (lado da equipe: convites, desativar, remover), `rotas/portal_documentos.js` (limitador), `test/portal_admin_rotas.test.js`, `test/apoio/bancoPortal.js`.

## Global Constraints

- Rotas só por `registro.portal(metodo, caminho, ['usuarios.gerir'], ...)`; empresa só de `req.portal.empresaCodigo`; nenhum corpo/parâmetro escolhe a empresa. Todo acesso a usuário por id confere `cliente_codigo = empresa da sessão` na própria consulta; outra empresa, inexistente ou id inválido (`/^\d{1,9}$/`) = o mesmo 404 `{ error: 'Usuário não encontrado.' }`.
- `usuarios.gerir` só existe para o papel `admin_geral` (por papel, em `carregarPermissoesPortal`); nunca é concedível; linha `usuarios.gerir` em `web_portal_permissoes` não vale para usuário comum. `PERMISSOES_CONCEDIVEIS = ['pedidos.ver','documentos.ver','financeiro.ver']`; qualquer outro código na requisição = 400. `documentos.ver` sem `pedidos.ver` = 400 `Para ver documentos, conceda também a visão de pedidos.` (concessão, edição e rebaixamento).
- Trava do último administrador: a empresa nunca fica sem `admin_geral` com situação `ativo`; rebaixar ou desativar o último = 409 `A empresa precisa de ao menos um administrador ativo.`; vale sob concorrência (transação com `SELECT ... FOR UPDATE` nas linhas de usuário da empresa, na mesma ordem em toda rota).
- Convite: 48 h, uso único, só hash no banco, link `PORTAL_URL_BASE/portal/convite.html#<token>` só na resposta quando o e-mail não foi enviado; nunca em log nem auditoria. E-mail com `normalizarEmail` de `rotas/portal_admin.js`; duplicado em qualquer empresa = 409 `Já existe um usuário do portal com este e-mail.`. Limite 20 convites por hora por administrador (429 `{ error: 'Muitos convites. Aguarde antes de convidar de novo.' }`; vale para `POST /usuarios` e `reenviar_convite`).
- Respostas nunca trazem `senha_hash`, segredo/estado do TOTP, tokens, códigos de recuperação nem datas internas. Corpo precisa ser objeto JSON (senão 400).
- Auditoria (`auditarPortal`, `usuarioId` do administrador, `clienteCodigo`, `detalhe` só com ids/códigos, nunca e-mail, link nem token): `usuario_convidado`, `usuario_permissoes`, `usuario_papel`, `usuario_desativado`, `convite_reenviado`, `usuario_removido`; só em sucesso; falha de gravação não desfaz a ação.
- Erro de banco: 500 `{ error: 'Erro de servidor' }`, log só com `err.code`.
- Refatorações sem mudança de comportamento: `test/portal_admin_*.test.js` e demais testes existentes passam sem alterar expectativas.
- Front: sem script/estilo inline, `textContent`, `PortalApi.chamar`, 401 volta a `/portal/login.html`.
- Testes de segurança desta base já tiveram teste vazio: contagem > 0 e prova de mutação. Escrever arquivos só com Write/Edit, nunca heredoc de shell nem script de redirecionamento (em `index.js`, só Edit). `git add` só dos arquivos da tarefa, pelo nome (a árvore tem trabalho de outra frente e há auto-commits externos "commit"; nunca stash/checkout/reset/add -A). Commits na main com `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Cada tarefa vê o teste falhar antes de implementar (nas refatorações, a suíte existente verde antes e depois).

## Review Focus

- Dois administradores tentam se rebaixar/desativar ao mesmo tempo (simule com a trava: a segunda requisição vê o estado já mudado) e o último administrador tentando se desativar/rebaixar (Tarefa 2).
- Administrador da empresa A manipulando o id de usuário da empresa B em CADA uma das 7 rotas: 404 idêntico, nada alterado (Tarefa 2).
- Usuário comum com todas as permissões concedíveis chamando as rotas de usuários = 403; linha `usuarios.gerir` gravada para usuário comum não o torna administrador (Tarefas 1 e 2).
- Convidado que conclui o convite entra com exatamente as permissões dadas (e só elas): fluxo convidar → `convite/iniciar`/`concluir` → login → `/eu` (Tarefa 2).
- Rebaixar um administrador cujas linhas de permissão antigas existem: valem só as novas; promover apaga as linhas (Tarefa 2).

---

### Task 1: Modelo de permissões e helpers de convite compartilhados

**Files:**
- Create: `portal/convites.js`
- Modify: `portal/acesso.js`, `rotas/portal_admin.js`
- Test: `test/portal_convites.test.js`, `test/portal_acesso.test.js` (acrescentar casos)

**Interfaces:**
- Produces:
  - `portal/acesso.js`: exporta também `PERMISSOES_CONCEDIVEIS` (as 3) e `PERMISSOES_PORTAL` passa a incluir `'usuarios.gerir'`; `carregarPermissoesPortal(pool, usuarioId, papel)`: `admin_geral` recebe `PERMISSOES_PORTAL` (as 4); os demais recebem as linhas gravadas filtradas por `PERMISSOES_CONCEDIVEIS`.
  - `portal/convites.js`: `VALIDADE_CONVITE_MS`; `criarConvite(conn, usuarioId, quem) -> Promise<token>`; `invalidarConvites(conn, usuarioId) -> Promise<void>`; `responderConviteJson({ config, email }, { token, para, razaoSocial }) -> Promise<{ enviado: boolean, link?: string }>` (tenta `email.enviarConvite({ para, link, razaoSocial })`, falha de envio = `enviado: false`; o link só no retorno quando `enviado` é falso). `rotas/portal_admin.js` passa a usar `criarConvite` e `invalidarConvites` do módulo e mantém a resposta própria `{ emailEnviado, link? }`.

- [ ] **Step 1:** rodar `node --test test/portal_*.test.js` e anotar a contagem verde (linha de base).
- [ ] **Step 2: Write the failing tests:** `test/portal_convites.test.js` (convite de 48 h com só o hash no banco falso, `invalidarConvites` marca `usado_em`, `responderConviteJson` com e-mail enviado não devolve link, com falha de envio devolve o link `config.baseUrl + '/portal/convite.html#' + token`); em `test/portal_acesso.test.js`: admin_geral tem as 4; usuário comum com linhas `pedidos.ver` e `usuarios.gerir` gravadas recebe só `pedidos.ver`; linha desconhecida ignorada. Rodar: FAIL.
- [ ] **Step 3: Implement** o módulo e a mudança de `acesso.js`; trocar o uso em `rotas/portal_admin.js`.
- [ ] **Step 4: Run** a linha de base do Step 1 (mesma contagem + novos, expectativas intactas) e `npm test`. Expected: PASS (falhas alheias, se houver, não são de `portal`).
- [ ] **Step 5: Commit** `refactor(portal): permissões concedíveis e helpers de convite compartilhados`.

### Task 2: Rotas de usuários da empresa

**Files:**
- Create: `rotas/portal_usuarios.js`
- Test: `test/portal_usuarios_rotas.test.js`
- Modify: `index.js` (require e registro após `registrarPortalDocumentos`, só por Edit), `test/portal_auth_rotas.test.js` (lista exata de `rotasPortal()`), `test/apoio/bancoPortal.js` (regras de SQL novas que as rotas usarem, sem alterar as existentes)

**Interfaces:**
- Consumes: Tarefa 1 (`criarConvite`, `invalidarConvites`, `responderConviteJson`, `PERMISSOES_CONCEDIVEIS`); `normalizarEmail` de `rotas/portal_admin.js`; `emTransacaoPortal` de `portal/transacao.js`; `ErroUsuario` de `rotas/transacao.js`; `auditarPortal` de `portal/auditoria.js`; `sessoes.revogarUsuario(usuarioId)`; `req.portal` (`usuarioId`, `empresaCodigo`, `razaoSocial`), `req.ip`.
- Produces: `registrarPortalUsuarios({ portal, pool, sessoes, email, config, limite = { janelaMs: 60 * 60 * 1000, max: 20 } }) -> void` com as 7 rotas da spec seção 3.

- [ ] **Step 1: Write the failing tests** em `test/portal_usuarios_rotas.test.js` (app montado como `test/portal_auth_rotas.test.js`/`portal_documentos_rotas.test.js`: registro real, `criarBancoPortal`, sessões abertas por cookie; duas empresas ACME (40) e BETA (41) com administradores e usuários comuns em vários estados; `registrarPortalAuth` também montado para o teste de fluxo). Casos:
  1. `GET /usuarios` lista só os da empresa da sessão (contagem > 0), com as chaves exatas `id, email, papel, situacao, permissoes`; serialização sem `senha_hash`, `totp`, `token`; administrador aparece com as 3 concedíveis.
  2. **404 idêntico** para `PUT permissoes`, `POST papel`, `desativar`, `reenviar_convite`, `remover` com id de usuário da outra empresa, inexistente e `12abc`: status, corpo e cabeçalhos iguais; nada alterado no banco falso; sem auditoria.
  3. `POST /usuarios`: cria `usuario`/`convidado` com as permissões dadas e convite; resposta `{ ok: true, enviado, link? }` (link só sem envio); e-mail duplicado em OUTRA empresa = 409 com a mesma mensagem; e-mail inválido = 400; permissão fora da lista (`usuarios.gerir`, `x`) = 400; `documentos.ver` sem `pedidos.ver` = 400; corpo não objeto = 400.
  4. `PUT permissoes`: substitui (apaga e regrava na transação), em administrador = 409, vale para `convidado` e `ativo`, `inativo` = 409; mesmas validações do item 3.
  5. `POST papel`: promover só `ativo` (apaga linhas de permissões); rebaixar exige `permissoes` array (pode ser `[]`) e grava só as novas (linhas antigas somem); **trava do último administrador** (único administrador ativo tentando se rebaixar = 409; com 2 administradores, o primeiro rebaixa e o segundo, que agora é o último, é recusado — simule a segunda chamada logo após a primeira); papel inválido = 400.
  6. `desativar`: sessões do usuário revogadas (`sessoes.revogarUsuario`) e convites abertos invalidados; último administrador = 409; si mesmo com outro administrador ativo = permitido; já inativo = 409.
  7. `reenviar_convite`: só `convidado`; convites anteriores invalidados; `ativo` = 409. `remover`: só `convidado` sem `termo_aceito_em`; apaga usuário, convites, recuperação, permissões, sessões; e-mail liberado; demais = 409.
  8. **Permissão**: usuário comum com as 3 concedíveis chamando as 7 rotas = 403 sem consulta de dados; linha `usuarios.gerir` gravada para usuário comum não o torna administrador (403); administrador de empresa suspensa = 401; sem cookie 401; JWT de funcionário 401.
  9. **Prova de mutação** do isolamento: pool envolvido que troca `cliente_codigo = ?` por `1 = 1` nas consultas por id faz a asserção de isolamento (item 2) falhar (usuário da empresa B passa a ser alterado); controle sem mutação passa.
  10. **Fluxo completo**: administrador convida `novo@acme.com` com `pedidos.ver`; o convite concluído por `convite/iniciar` + `concluir` (rotas de `portal_auth`) e o login mostram `/eu` com permissões exatamente `['pedidos.ver']`; depois `PUT permissoes` para `pedidos.ver` + `financeiro.ver` vale na requisição seguinte (permissões lidas a cada requisição).
  11. Auditoria: uma linha por ação bem-sucedida com o nome do evento da spec, `usuario_id` do administrador, `cliente_codigo` e `detalhe` só com ids/códigos (sem e-mail, link, token); nenhuma em 400/403/404/409; pool de auditoria lançando erro mantém a ação.
  12. Limite: o 21º convite do mesmo administrador (`POST /usuarios` + `reenviar_convite` juntos) em 1 h = 429; outro administrador não é afetado; `GET /usuarios` não conta.
  13. Erro de banco (`{ code: 'ER_X' }`) = 500 genérico, log só `ER_X`; `registro.rotasPortal()` contém as 7 rotas e `registro.verificar()` passa.
- [ ] **Step 2: Run** `node --test test/portal_usuarios_rotas.test.js`. Expected: FAIL (`MODULE_NOT_FOUND`).
- [ ] **Step 3: Implement** `rotas/portal_usuarios.js`: helper `usuarioDaEmpresa(conn, empresa, id, { travar })` (consulta `... WHERE id = ? AND cliente_codigo = ?`); helper `travarAdministradores(conn, empresa)` (`SELECT id FROM web_portal_usuarios WHERE cliente_codigo = ? ORDER BY id FOR UPDATE`) chamado no início de TODA rota que muda papel, situação ou remove (mesma ordem sempre); `validarPermissoes(lista)` (array de strings únicas só de `PERMISSOES_CONCEDIVEIS`, regra documentos⇒pedidos); limitador `express-rate-limit` por `u${usuarioId}` só em `POST /usuarios` e `reenviar_convite`, depois da autenticação, sem cabeçalhos RateLimit; auditoria depois do commit. Registrar em `index.js` por Edit e atualizar a lista exata de `test/portal_auth_rotas.test.js`.
- [ ] **Step 4: Run** o teste focado e depois `npm test`. Expected: PASS (inclusive `test/seguranca_registro.test.js` e `test/seguranca_barreira.test.js`).
- [ ] **Step 5: Commit** `feat(portal): administrador geral gerencia os usuários da própria empresa`.

### Task 3: Tela de usuários, link no início e documentação

**Files:**
- Create: `portal/public/usuarios.html`, `portal/public/usuarios.js`
- Modify: `portal/public/inicio.html` (link "Usuários" oculto por padrão), `portal/public/inicio.js` (mostra o link só com `usuarios.gerir` em `usuario.permissoes`), `portal/public/portal.css` (só se preciso), `test/portal_paginas.test.js` (`HTMLS`, `JSS` e teste HTTP de cabeçalhos), `docs/regras/portal-identidade.md`, `CLAUDE.md`, `docs/portal_configuracao.md`
- Test: `test/portal_usuarios_tela.test.js`

**Interfaces:**
- Consumes: as 7 rotas da Tarefa 2; `/portal/api/eu`; padrão de `portal/public/pedido.js`/`financeiro.js` e DOM falso de `test/portal_financeiro_tela.test.js`.

- [ ] **Step 1: Write the failing test** `test/portal_usuarios_tela.test.js` (DOM falso com `vm`): `usuarios.html`/`.js` existem e passam as regras de página (sem inline, sem `innerHTML` etc.); sem `usuarios.gerir` em `/eu` a tela mostra aviso e NÃO chama `/portal/api/usuarios`; com a permissão lista os usuários por `textContent` (e-mail com `<script>` aparece como texto); formulário de convite envia `{ email, permissoes }` por `POST` (checkbox de documentos marca pedidos junto); resposta com `link` mostra o link para copiar (como texto, nunca como `href`); cada ação (salvar permissões, promover/rebaixar, desativar, reenviar, remover) só dispara após `confirm()` verdadeiro e chama a rota certa com o id numérico; erro do servidor (409/400/404/429) é mostrado e a lista não muda; 401 → login; o botão da ação sobre o próprio usuário avisa antes; `inicio.html` tem o link oculto e `inicio.js` o mostra só com a permissão.
- [ ] **Step 2: Run** `node --test test/portal_usuarios_tela.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** `usuarios.html` (título de 2 a 4 palavras, por exemplo "Usuários da empresa"), `usuarios.js` e o link condicional.
- [ ] **Step 4: Run** `npm test`. Expected: PASS (falhas alheias de outra frente, se houver, não contam; confirmar que nenhuma é de `portal`).
- [ ] **Step 5: Documentar:** seção "Etapa 4: usuários da empresa" em `docs/regras/portal-identidade.md` (modelo de permissões `usuarios.gerir` x concedíveis, rotas, isolamento por empresa nas consultas por id, trava do último administrador com `FOR UPDATE`, regra documentos⇒pedidos, limite de convites, auditoria e lista de eventos, o que NÃO foi testado: MySQL real, concorrência real, SMTP real, navegador real); `CLAUDE.md` (o portal agora tem gestão de usuários pela própria empresa; seção 2 lista `rotas/portal_usuarios.js`, `portal/convites.js`, `usuarios.html/.js`; remova/ajuste qualquer frase que diga que a criação de usuários é a etapa 4); `docs/portal_configuracao.md` (passo de conferência na seção 12: criar usuário comum pelo administrador de uma empresa de teste, conferir convite por e-mail, permissões e a trava do último administrador no MySQL real; atualizar linha de abertura e seção 11).
- [ ] **Step 6: Commit** `feat(portal): tela de usuários da empresa e documentação da etapa 4`.

---

## Self-review (feito)

- **Cobertura da spec:** seção 2 (permissões) → Tarefa 1; seção 3 (sete rotas, 404, trava, limite) → Tarefa 2; seção 4 (auditoria) → Tarefa 2 teste 11; seção 5 (refatoração) → Tarefa 1; seção 6 (tela) → Tarefa 3; seção 7 (documentos⇒pedidos) → Tarefa 2 testes 3 e 4; seção 8 → Tarefas 1 a 3; seção 10 → Tarefa 3 passo 5.
- **Consistência de nomes:** `PERMISSOES_CONCEDIVEIS`, `usuarios.gerir`, `criarConvite`, `invalidarConvites`, `responderConviteJson`, `registrarPortalUsuarios`, mensagens 404/409/429 iguais nas Global Constraints e nos testes.
- **Risco aberto:** SQL e concorrência só em banco falso (`FOR UPDATE` não é simulado); o teste da trava sob concorrência é sequencial.
