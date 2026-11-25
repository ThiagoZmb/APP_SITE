# Minha semana Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Caderno semanal de tarefas pessoal: sete dias mais Tarefas e Notas, em linhas, com caixinha de concluído.

**Architecture:** Tabela `web_tarefas` (uma linha por tarefa), rotas `/minha_semana` filtradas sempre por `req.user.id`, página `tarefas.html` + `tarefas.js` com lógica pura testável no Node.

**Tech Stack:** Node/Express, mysql2, `node:test`, HTML/CSS/JS puro.

**Spec:** `docs/superpowers/specs/2026-11-25-minha-semana-design.md`

## Global Constraints

- Usuário sempre de `req.user.id`; linha de outro usuário responde **404**; nem administrador vê a lista alheia.
- Rotas por `rota(...)` com exigência `[]` (só login); nenhuma permissão nova.
- Texto: 1 a **300** caracteres; quadro: `dia`, `tarefas` ou `notas`; data só (e obrigatória) em `dia`.
- Texto nunca vai para auditoria nem log. Nenhuma tabela do VB é lida ou alterada.
- Cores e componentes de `DESIGN.md`/`tema.css`; CSP como em `tintas.html`, sem `cdn.jsdelivr.net`.
- Fora do escopo: horários, lembretes, compartilhar, impressão, transferir pendências.
- Commit e push só quando o dono pedir (os passos abaixo não fazem commit).

## Review Focus

1. Enter seguido de saída da linha (ou conexão lenta): deve nascer **uma** tarefa só.
2. Falha ao salvar: o texto fica na tela, a linha marcada, e a próxima tentativa salva.
3. Semana que cruza mês/ano e fuso (data não pode "voltar um dia"): sem `toISOString`.
4. Texto com `<`, aspas ou emoji: aparece como texto, igual ao digitado.
5. Marcar a caixinha enquanto a linha nova ainda está salvando: a marca não se perde.

---

### Task 1: Banco, validação e rotas

**Files:**
- Create: `calculo/minha_semana.js`, `rotas/minha_semana.js`, `test/minha_semana_rotas.test.js`
- Modify: `seguranca/instalacao.js` (array `TABELAS`), `index.js` (require e registro junto dos outros `registrar*`), `test/instalacao.test.js:30-35` (49 → 50, incluir `web_tarefas`)

**Interfaces:**
- `calculo/minha_semana.js`: `validarData(s) → boolean` (AAAA-MM-DD real); `diasDaSemana(inicio) → string[7]` (aritmética em UTC); `validarNova(corpo) → {ok, valor:{quadro,data,texto}} | {ok:false, motivo}`; `validarMudanca(corpo) → {ok, valor:{texto?,feita?}} | {ok:false, motivo}`. Texto: quebras de linha viram espaço, depois `trim`.
- `registrarMinhaSemana({ rota, pool })`.
- Linha na resposta: `{ id:number, quadro, data:string|null, texto, feita:boolean }`.

| Rota | Entrada | Saída |
|---|---|---|
| `GET /minha_semana?inicio=AAAA-MM-DD` | primeiro dia (segunda) | `{ linhas: [] }`: dias da semana + todas de `tarefas`/`notas`, ordem por `id` |
| `POST /minha_semana` | `{quadro, data, texto}` | 201, linha |
| `PUT /minha_semana/:id` | `{texto?, feita?}` | linha |
| `DELETE /minha_semana/:id` | | `{ ok: true }` |

Tabela: `id INT AUTO_INCREMENT PK, usuario_codigo INT NOT NULL, quadro ENUM('dia','tarefas','notas') NOT NULL, data DATE NULL, texto VARCHAR(300) NOT NULL, feita TINYINT(1) NOT NULL DEFAULT 0, criado_em DATETIME NULL, atualizado_em DATETIME NULL, KEY ix_tarefas_usuario (usuario_codigo, quadro, data)`, com `${OPCOES}` (conferir que o charset aceita emoji; se `OPCOES` não for utf8mb4, declarar nesta tabela).

- [ ] **Step 1: Testes que falham** em `test/minha_semana_rotas.test.js`, no molde de `test/checklist_rotas.test.js` (pool falso com lista em memória, usuários 7 e 8, `permissoes: new Set()`):
  - `usuário sem nenhuma permissão cria e lê a própria linha` (201; aparece no GET com texto idêntico, incluindo `<b> "x" 😀`; `feita === false`).
  - `outro usuário não vê, não altera e não exclui` (GET vazio; PUT e DELETE → 404; linha intacta), com administrador (`administrativo.ver`) no papel do outro.
  - `usuario do corpo ou da URL é ignorado` (POST com `usuario_codigo: 8` grava 7).
  - `recusa 400`: quadro `x`; `dia` sem data; data `2026-02-30`; `tarefas` com data é gravada com `data: null`; texto vazio; 301 caracteres; PUT sem campos; `feita: "sim"`; `inicio` inválido; id `abc` → 404.
  - `semana cruzando o ano`: `diasDaSemana('2026-12-28')` vai até `'2027-01-03'`.
  - `resposta não perde campo na rede de valores`: o GET mantém `id, quadro, data, texto, feita`.
  - `sem token → 401`; `instalarTabelas cria web_tarefas`.
- [ ] **Step 2:** `node --test test/minha_semana_rotas.test.js` → FAIL (módulo inexistente).
- [ ] **Step 3:** implementar os arquivos e ligações. Todo `SELECT/UPDATE/DELETE` leva `usuario_codigo = ?`; 404 quando não achar. Erro: `console.error` só com rótulo e `err.code`.
- [ ] **Step 4:** `npm test` → tudo PASS (inclui barreira e registro de rotas).

### Task 2: Tela, menu e documentação

**Files:**
- Create: `tarefas.html`, `tarefas.js`, `test/minha_semana_tela.test.js`, `docs/regras/minha-semana.md`
- Modify: `layout.js` (`ICONES`, `MENU`, `ATEND_BLOQUEADAS`), `CLAUDE.md` (funcionalidades, pastas, resumo na seção 5), `DESIGN.md` e `tema.css` (só se o quadro pautado exigir padrão novo)

**Interfaces:**
- `tarefas.js` no formato UMD de `tintas.js`, exportando `{ segundaDe(date) → 'AAAA-MM-DD', somarDias(iso, n) → iso, rotuloSemana(inicio) → '23/11 a 29/11', criarLinha(chamar, dados) , iniciar(win) }`.
- `criarLinha(chamar, {id?, quadro, data, texto, feita})` → `{ dados, salvarTexto(t): Promise, marcar(b): Promise, erro: boolean }`. As operações de uma linha entram numa fila (uma por vez): é o que impede o POST duplicado. Texto vazio: linha com `id` → DELETE; sem `id` → nada. Texto igual ao salvo → nenhuma chamada.
- Menu: `{ secao: 'Pessoal' }, { href: 'tarefas.html', texto: 'Minha semana', icone: 'tarefas' }` antes de `{ secao: 'Comercial' }`. **Não** entra em `PAGINAS` (sem permissão; não vira primeira página de ninguém). Entra em `ATEND_BLOQUEADAS`.

- [ ] **Step 1: Testes que falham** em `test/minha_semana_tela.test.js` (`chamar` falso que registra chamadas):
  - `segundaDe(new Date(2026, 10, 29, 23, 30))` (domingo à noite) → `'2026-11-23'`; `somarDias('2026-12-28', 6)` → `'2027-01-03'`.
  - `duas gravações seguidas fazem um POST só` (a segunda, com texto igual, não chama; com texto diferente faz PUT no id devolvido).
  - `marcar durante o POST pendente` → depois do POST vem `PUT {feita:true}`.
  - `falha mantém o texto, marca erro e a nova tentativa salva`.
  - `apagar o texto exclui`; `linha nova vazia não chama nada`.
  - `layout: Minha semana aparece para quem não tem permissão nenhuma e some no modo atendimento` (reusar `carregarLayout` de `test/atendimento_modo.test.js`).
  - `tarefas.html carrega tema.css por último entre as folhas, layout.js e entregas_comum.js, e a CSP não tem cdn.jsdelivr`.
- [ ] **Step 2:** `node --test test/minha_semana_tela.test.js` → FAIL.
- [ ] **Step 3:** implementar. Grade de 3 colunas na ordem do desenho do spec (coluna a coluna: Seg, Ter, Qua | Qui, Sex, Sáb | Tarefas, Notas, Domingo); no celular 1 coluna na ordem Seg→Dom, Tarefas, Notas, rolando até hoje. Cada quadro tem no mínimo 8 linhas pautadas e sempre uma vazia no fim. Texto via `input.value` (`maxlength="300"`), nunca `innerHTML`. Salva no Enter e no `blur`; Enter leva o foco à próxima linha. Trocar de semana espera as filas pendentes e descarta resposta de GET antigo. Se o GET falhar, mostrar aviso e "Tentar de novo", sem linhas editáveis. Linha com erro: borda `--danger-color` e aviso. `beforeunload` avisa se houver texto não salvo.
- [ ] **Step 4:** `npm test` → tudo PASS.
- [ ] **Step 5:** conferir no navegador com API simulada (computador e largura de celular): criar, marcar, apagar, trocar de semana. Registrar o que não foi testado.
- [ ] **Step 6:** documentar (`docs/regras/minha-semana.md` com as regras do spec; resumo no `CLAUDE.md`).
