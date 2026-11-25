# Semana dos administradores e alarmes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Segunda página de semana, compartilhada entre administradores, e alarme opcional nas duas, com aviso dentro do sistema.

**Architecture:** Cópia separada da Minha semana (tabela, rotas, página e script próprios, escolha do dono) e um único módulo de alarmes (`rotas/alarmes.js` + `alarmes.js` carregado pelo `layout.js` em todas as telas).

**Tech Stack:** Node/Express, mysql2, `node:test`, HTML/CSS/JS puro.

**Spec:** `docs/superpowers/specs/2026-11-25-semana-administradores-alarmes-design.md`

## Global Constraints

- Permissão `tarefas_admin.usar` (com `DESCRICOES` e em `PERMISSOES_ADMINISTRATIVAS`), concedida só ao perfil **Administrador** por `darAoAdministrador` com marcador próprio.
- Sem a permissão: 403 nas rotas, nenhum alarme compartilhado, menu escondido. Pessoal continua isolada por `req.user.id`.
- Mesmas regras de texto/quadro/data da Minha semana (`calculo/minha_semana.js`, que pode ser reutilizado).
- Alarme: `'AAAA-MM-DD HH:MM'`, hora de Brasília como digitada; só quadros `dia` e `tarefas`; uma vez; feita ou apagada não toca; botões **OK** e **Adiar 10 minutos**.
- `web_tarefas` pode já existir publicada: colunas novas por ADD COLUMN idempotente (padrão de `instalarTabelas`).
- Nenhuma tabela do VB (ler o nome do autor vem de `req.acesso.nome`, gravado na linha). Texto fora de log e auditoria.
- Sem commit nem push.

## Review Focus

1. Duas pessoas editando a mesma linha, ou uma apagando enquanto a outra digita: nada some sem aviso.
2. Atualização automática não mexe na linha em foco nem em linha com texto não salvo.
3. Usuário que perde a permissão com a página aberta ou com rascunho guardado: nada compartilhado fica na tela nem vira linha pessoal.
4. Vários alarmes vencidos juntos, várias abas, recarga: uma janela por vez, e OK numa aba não reaparece.
5. Alarme trocado depois de um OK volta a tocar; adiar não altera o alarme dos outros.

---

### Task 1: Compartilhada, servidor

**Files:** Create `rotas/semana_admin.js`, `test/semana_admin_rotas.test.js`. Modify `seguranca/instalacao.js`, `seguranca/permissoes.js`, `index.js`, testes de instalação/permissões afetados.

**Interfaces (produz):**
- `web_tarefas_admin`: `id, quadro, data, texto VARCHAR(300), feita, alarme DATETIME NULL, versao INT NOT NULL DEFAULT 1, criada_por_codigo, criada_por VARCHAR(100), feita_por VARCHAR(100) NULL, criado_em, atualizado_em`.
- `GET /semana_admin?inicio=` → `{linhas}`; `POST /semana_admin`; `PUT /semana_admin/:id` `{texto?, feita?, alarme?, versao}`; `DELETE /semana_admin/:id` `{versao}` (corpo ou query).
- Linha: `{id, quadro, data, texto, feita, alarme, versao, criadaPor, feitaPor}`.
- Versão diferente → **409** `{error, atual: linha}`, sem gravar; linha inexistente → 404. Sucesso soma 1 à versão (UPDATE com `WHERE id=? AND versao=?`).

- [ ] Testes que falham: dois administradores veem a mesma linha; sem permissão → 403 nas quatro rotas; autoria e `feitaPor` vêm do login (corpo ignorado) e `feitaPor` limpa ao desmarcar; versão velha → 409 sem alterar (PUT e DELETE); nada de `web_tarefas` aparece aqui nem o contrário; migração dá a permissão só ao Administrador e é idempotente.
- [ ] Implementar; `npm test`.

### Task 2: Compartilhada, tela

**Files:** Create `tarefas_admin.html`, `tarefas_admin.js`, `test/semana_admin_tela.test.js`. Modify `layout.js` (MENU na seção Pessoal logo após "Minha semana", `PAGINAS['tarefas_admin.html'] = ['tarefas_admin.usar']` antes de `minhas_entregas.html` e sem virar primeira página de quem já tinha outra, `ATEND_BLOQUEADAS`).

- Cópia de `tarefas.js`/`tarefas.html`, título "Semana dos administradores"; chave de rascunho própria (`semana_admin_rascunho:<id>`).
- Autoria discreta sob o texto: `Ana` ou `Ana · feita por João`.
- Atualização a cada 60 s e ao voltar à aba, só em linhas sem foco e sem pendência.
- 409: manter o texto digitado na linha, mostrar o texto atual e oferecer "Manter o meu" (regrava com a versão nova) ou "Usar o atual". 404 em PUT: avisar que foi apagada e oferecer recriar (não recriar sozinho). 403: limpar a tela.

- [ ] Testes que falham para: 409, 404, atualização preservando foco/pendência, rascunho separado da página pessoal, menu e permissão.
- [ ] Implementar; `npm test`.

### Task 3: Alarmes, servidor

**Files:** Create `rotas/alarmes.js`, `calculo/alarmes.js`, `test/alarmes_rotas.test.js`. Modify `instalacao.js`, `rotas/minha_semana.js`, `rotas/semana_admin.js`, `index.js`.

- `web_tarefas` ganha `alarme`, `alarme_visto DATETIME NULL`, `alarme_adiado DATETIME NULL`. Nova `web_tarefas_admin_avisos (tarefa_id, usuario_codigo, alarme DATETIME, visto TINYINT, adiado DATETIME NULL, PRIMARY KEY (tarefa_id, usuario_codigo))`.
- `validarAlarme(s) → boolean`. `PUT` das duas páginas aceita `alarme` (string ou `null`); quadro `notas` com alarme → 400. Linha pessoal passa a devolver `alarme`.
- `GET /alarmes` (`[]`) → `{alarmes:[{origem:'pessoal'|'admin', id, texto, alarme, quando}]}`: não feitas, com alarme, não vistos para este usuário; `quando` = adiado, senão alarme. Compartilhados só com a permissão. O servidor não compara horários.
- `POST /alarmes/:origem/:id/ok` `{alarme}`; `POST /alarmes/:origem/:id/adiar` `{alarme, ate}`. `alarme` diferente do atual → 409. Pessoal de outro usuário → 404; admin sem permissão → 403. Aviso guardado só vale enquanto o `alarme` for o mesmo.

- [ ] Testes que falham para cada linha acima e Review Focus 5; instalação acrescenta colunas só se faltarem; apagar tarefa compartilhada apaga os avisos.
- [ ] Implementar; `npm test`.

### Task 4: Alarmes, tela

**Files:** Create `alarmes.js`, `test/alarmes_tela.test.js`. Modify `layout.js` (carregar `alarmes.js` como carrega `pwa.js`; `/alarmes` em `SEGUNDO_PLANO`; subir `?v=`), `tarefas.html/.js`, `tarefas_admin.html/.js`, `docs/regras/` (`minha-semana.md` e novo `semana-administradores-alarmes.md`), `CLAUDE.md`.

- Sino por linha (dias e Tarefas, só com texto) abrindo data e hora; linha com alarme mostra `25/11 14:30`; "Remover". Linha nova: salvar o texto antes do alarme, pela mesma fila.
- `alarmes.js`: consulta a cada 60 s e agenda localmente pelo relógio do aparelho; janela `<dialog>` com texto via `textContent`, OK e Adiar 10 minutos, som por WebAudio (falha silenciosa). Uma janela por vez; outra aba fecha a sua quando o item sai da consulta. Erro ou 401 na consulta: ignorar sem redirecionar. Modo atendimento ligado: não mostrar. Editar alarme nesta aba reconsulta na hora.

- [ ] Testes que falham: escolha do que está vencido (`quando <= agora` local), fila de um por vez, atendimento retém, `ate` = agora + 10 min cruzando a meia-noite, erro silencioso.
- [ ] Implementar; `npm test`.
- [ ] Edge headless com banco em memória: as duas páginas (1566 e 375 px), conflito entre duas sessões, alarme tocando em outra tela do sistema. Registrar o não testado.
