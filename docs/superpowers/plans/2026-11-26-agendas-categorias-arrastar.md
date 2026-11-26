# Plano: agendas com categorias, novo visual e arrastar

Especificação: `docs/superpowers/specs/2026-11-26-agendas-categorias-arrastar-design.md`. Vale para Minha semana e Semana compartilhada.

## Arquivos
- `seguranca/instalacao.js`: tabelas `web_tarefas_categorias` (usuario_codigo, nome, cor; único por usuário+nome) e `web_tarefas_admin_categorias` (nome único, cor); coluna `categoria_id INT NULL` em `web_tarefas` e `web_tarefas_admin` só se faltar (consulta ao `information_schema`, como as do alarme).
- `calculo/minha_semana.js`: `CORES` (10 códigos), `validarCategoria`, `chaveNome` (repetição sem diferença de maiúsculas e acentos, como o `utf8mb4_unicode_ci`), `validarMudanca` com `quadro`, `data` e `categoriaId`; `validarNova` com `categoriaId` opcional.
- `rotas/minha_semana.js` e `rotas/semana_admin.js`: GET devolve `{ linhas, categorias }` (duas consultas em `Promise.all`); linhas com `categoriaId`; PUT aceita mover (`quadro` + `data`) e `categoriaId`; ir para Notas zera concluído e alarme (e os avisos). Rotas novas registradas pelo `registro`:
  - `GET/POST /minha_semana/categorias`, `PUT/DELETE /minha_semana/categorias/:id` (só login; dono = `req.user.id`; alheia = 404).
  - `GET/POST /semana_admin/categorias`, `PUT/DELETE /semana_admin/categorias/:id` (`tarefas_admin.usar`).
  - Excluir categoria: transação; apaga a categoria e deixa os itens sem categoria (nunca apaga item).
  - `categoriaId` que não é da lista certa (outro dono, a outra agenda, inexistente) = 400, nada gravado.
- `agenda_comum.js` (novo, só a parte nova, usado pelas duas telas): paleta, legenda (filtro guardado no navegador), menu da faixa, janela "Mover para", janela "Categorias", confirmação, arraste com Pointer Events.
- `tarefas.js/.html`, `tarefas_admin.js/.html`: faixas coloridas, cabeçalho de dia com número, uma linha vazia no fim, legenda, botão Categorias, menu, arraste; `criarLinha` ganha `colorir` e `mover` pela mesma fila.
- `tema.css` + `DESIGN.md`: variáveis `--cat-*` (10 cores, tinta, versão "concluído", neutra), faixa, legenda, menu; `?v=` do tema em todas as páginas.
- Docs: `docs/regras/minha-semana.md`, `docs/regras/semana-administradores-alarmes.md`, `CLAUDE.md`.

## Tarefas (TDD, `node:test`, banco em memória `test/apoio/bancoSemana.js`)
1. Teste de instalação (tabelas e ADD COLUMN idempotente) -> instalacao.js.
2. Testes das rotas de categorias (pessoal e compartilhada) -> rotas.
3. Testes de mover/colorir nas rotas de item -> rotas.
4. Testes das funções puras de tela (agenda_comum.js e `criarLinha.mover/colorir`) -> telas.
5. Tela, CSS, verificação no Edge headless com API simulada (1600 e 390 px).
6. Docs e `npm test`.

## Cinco modos de falha mais prováveis (cada um com teste)
1. **Categoria alheia aceita** (privacidade): PUT/POST com `categoriaId` de outro usuário ou da outra agenda grava. Teste: 400 e banco intacto; PUT/DELETE em categoria alheia = 404.
2. **Movimento grava por cima na compartilhada**: mover com versão velha muda o dia. Teste: 409 com a linha atual, nada gravado; sem versão = 400.
3. **Excluir categoria some com itens ou deixa lixo**: Teste: itens continuam, com `categoriaId` null; itens de outro usuário não são tocados.
4. **Subida quebra no MySQL real** (ADD COLUMN repetido, palavra reservada): Teste: coluna já existente não gera ALTER; DDL sem FK, utf8mb4, nomes não reservados.
5. **Arraste e atualização brigando / linha com texto pendente movida**: Teste: `podeArrastar` falso com texto não salvo, erro ou fila ocupada; `podeAtualizar` falso com arraste em andamento, menu ou janela abertos; mover entra na fila (sem POST repetido) e falha devolve o item.
Extra: nome de categoria só por `textContent`/`value` (teste sem `innerHTML`), texto e nome fora do log.
