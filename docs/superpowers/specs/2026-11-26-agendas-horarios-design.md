# Agendas: lista única de categorias e grade de horários

Vale para **Minha semana** e **Semana compartilhada**. Aprovado pelo dono em 2026-11-26. Complementa `2026-11-26-agendas-categorias-arrastar-design.md` e `2026-11-26-agendas-repeticao-design.md`.

## A) Lista única de categorias
- Uma lista só para as duas agendas: a tabela que já era a da compartilhada (`web_tarefas_admin_categorias`, nome único sem diferenciar maiúsculas/acentos). Mesmo nome = mesma cor em todo lugar.
- Ler: todo usuário logado (`GET /minha_semana/categorias` e o `GET /minha_semana` trazem a lista). Criar, renomear, trocar a cor e excluir: só com `tarefas_admin.usar`, pelas duas bases (`/minha_semana/categorias` e `/semana_admin/categorias`); sem ela, 403 sem tocar no banco e a tela esconde o botão "Categorias" e o "Editar categorias…" do menu. Os itens pessoais continuam privados.
- Excluir tira a categoria dos itens das DUAS agendas (de todas as pessoas), numa transação, sem apagar item e sem mudar a versão dos itens compartilhados. A confirmação diz isso.
- **Itens pessoais ganham a coluna nova `categoria_unica_id`** (id na lista única). A coluna antiga `web_tarefas.categoria_id` e a tabela `web_tarefas_categorias` ficam como estavam (nada apagado), só sem uso pelo servidor novo. Por que coluna nova e não remapear no lugar: no deploy o servidor antigo ainda atende por alguns minutos e continuaria lendo/gravando `categoria_id` com os ids pessoais; com coluna nova nenhum dos dois interpreta errado o número do outro, e a migração nunca remapeia duas vezes (a origem nunca é reescrita).
- **Migração** (`unificarCategoriasAgendas`, na subida, uma vez, marcador `agendas_categorias_unicas` em `web_auditoria`): numa transação, trava a lista única (`FOR UPDATE`), confere o marcador de novo, junta as categorias pessoais pelo nome (mesma comparação do banco): nome que já existe na lista única = vale a cor dela; entre pessoas diferentes com o mesmo nome vale a categoria pessoal mais antiga (menor id), com o nome e a cor dela. Preenche `categoria_unica_id` dos itens (só onde está vazio, só da dona da categoria) e grava o marcador; nomes fora do log e da auditoria (só contagens). Acima de 30 no total, todas ficam (criar nova volta a valer quando ficar abaixo de 30). Interrompida = nada gravado, roda de novo na próxima subida; duas subidas juntas = a segunda espera a trava e vê o marcador.

## B) Grade de horários
- Horário de início e fim **opcional, só em itens dos dias** (`hora_inicio`/`hora_fim` SMALLINT em minutos desde 00:00, 0 a 1440, em `web_tarefas` e `web_tarefas_admin`). API: `horario: { inicio: 'HH:MM', fim: 'HH:MM' } | null`. Sem horário = "dia todo" (todos os itens existentes).
- Tela larga (área da semana >= 880px, sem o menu lateral; ~1220px de janela): horas na lateral esquerda; em cima, cabeçalho do dia e a faixa "dia todo"; embaixo a grade 00:00–24:00 com rolagem própria, aberta perto das 07:00, linha da hora atual no dia de hoje. Itens sobrepostos lado a lado; texto cortado na faixa e inteiro ao focar (e no campo, para leitor de tela).
- Clicar num horário vazio cria o item ali (1h, início em passos de 15 min). Arrastar pela alça muda dia e horário (15 min); puxar a borda de baixo muda a duração. Do "dia todo" para a grade ganha horário (1h); da grade para o "dia todo" perde; para Tarefas/Notas perde (o servidor tira).
- Menu "⋯" → **Horário…** (dia todo / das … às …), para teclado e celular.
- Tela estreita/celular: sem grade; lista por dia, "dia todo" primeiro e depois por horário, com o horário escrito na faixa.
- Repetição: as cópias levam o mesmo horário; mudar o horário de um item em série vale só para aquele dia (o `PUT` com `escopo` só aceita texto e categoria).
- Compartilhada: mudar horário leva a versão (409 = nada por cima). A atualização de 60 s espera arraste, redimensionamento, menu e janelas.
- Rascunho no navegador guarda o horário de item novo criado na grade.
- Fora: visão de dia/mês, fuso, horário em Tarefas/Notas, horário mudando a série inteira, alarme ligado ao horário (são campos separados; alarmes seguem em stand by).
