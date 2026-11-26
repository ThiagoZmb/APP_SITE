# Agendas: repetir itens (série)

Vale para **Minha semana** e **Semana compartilhada**. Aprovado pelo dono em 2026-11-26. Complementa `2026-11-26-agendas-categorias-arrastar-design.md`.

## O que faz
- Menu "⋯" do item salvo (dias e Tarefas, fora de série): **Repetir…**. (a) **Todos os dias**, de [data] até [data], com "Pular fins de semana" desmarcado; (b) **Todo mês**, no dia [N], por [X] meses. Prévia "Vai criar N itens: de … a …" com a mesma conta do servidor.
- Cada data é uma linha própria (caixinha, arraste, "Mover para", alarme: só daquele dia), ligadas por `serie_id`. O item vira a 1ª ocorrência (vai para a 1ª data); as cópias nascem com o mesmo texto e categoria, sem alarme e não concluídas.
- Mensal: primeira data com o dia N >= data do item (Tarefas: >= hoje); mês sem o dia N cai no último dia e volta ao N no mês seguinte; fim de semana fica no dia certo. Limites: diária até 366 dias (mínimo 2 itens), mensal de 2 a 60 meses, até 2100.
- Mudar **texto** ou **categoria**, ou **apagar** (texto vazio), num item de série pergunta: **Só este / Este e os próximos / Todos / Cancelar**. "Próximos" = posição na série (`serie_pos`) >= a deste, ou seja, a ordem de criação (mover um dia não muda a posição). Apagar em série nunca apaga concluído (o próprio item clicado sai sempre).
- Marca ↻ (role="img", "Item que se repete") embaixo do "⋯". Item em série não oferece "Repetir…" de novo. Mover para Notas tira da série.
- Fora: semanal, anual, editar a regra de uma série.

## Quando a pergunta aparece
Só ao terminar: Enter ou sair da linha, e só se o texto (limpo) mudou de verdade. Nunca a cada tecla. **Cancelar**: nada é gravado; o texto fica no campo e no rascunho do navegador, a linha mostra "Não salvo…" com **Escolher** e **Desfazer**; sair da linha de novo não pergunta outra vez pelo mesmo texto; a semana não troca enquanto houver escolha pendente. A escolha fica guardada para aquele texto (nova tentativa depois de falha de rede não pergunta de novo) e vai no rascunho; rascunho de série sem escolha nunca é enviado sozinho.

## Política na Semana compartilhada (versão/409)
O item clicado leva a versão (409 = nada gravado, conflito de sempre). Nos **outros** itens do escopo o servidor só muda (ou apaga) os que **ainda estão iguais a este** no que vai mudar (mesmo texto para texto/apagar, mesma categoria para categoria); os diferentes ficam como estão e a resposta diz quantos (`diferentes`), que a tela avisa. Assim uma operação em série nunca grava por cima, em silêncio, do que outra pessoa mudou num dia. Itens mudados ganham versão nova (quem os tiver abertos com algo pendente recebe o 409 de sempre). Na **pessoal** não há outra pessoa: o escopo vale para todos os itens dele (menos os concluídos, na exclusão).

## Dados e rotas
- Colunas `serie_id CHAR(32) NULL` (aleatório do servidor) e `serie_pos SMALLINT NULL` em `web_tarefas` e `web_tarefas_admin`, com índice, num ALTER só e só se faltarem.
- `POST /minha_semana/:id/repetir` e `POST /semana_admin/:id/repetir` (`versao` na compartilhada): transação com o item travado (`FOR UPDATE`): já em série = 409 `jaEmSerie` (clique duplo ou nova tentativa não duplica); um INSERT de várias linhas; devolve `{ linha, linhas, qtd }`.
- `PUT …/:id` com `escopo` (`proximos`/`todos`) aceita só `texto`/`categoriaId`; `DELETE …/:id` com `escopo` (pessoal: `?escopo=`; compartilhada: corpo). Resposta com `serie: { escopo, alteradas | apagadas, concluidas, diferentes }`.
- Privacidade: tudo filtrado pelo dono (pessoal) e por tabela; o identificador da série nunca vem da tela.

## Visual
Alça, "⋯" e ↻ na tinta da faixa, sem transparência (mesmo contraste do texto, >= 4,5:1). No computador (ponteiro fino) a caixinha fica em cima da alça (pontos na horizontal) numa coluna de 16px e o "⋯" tem 20px: o texto ganhou ~30% de largura nas sete colunas (1600px: 91 → 120px). No toque nada muda (28 × 42 e 40 × 42).
