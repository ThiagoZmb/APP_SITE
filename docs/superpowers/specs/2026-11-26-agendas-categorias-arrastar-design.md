# Agendas: categorias com cores, novo visual e arrastar itens

Vale para **Minha semana** (`tarefas.*`) e **Semana compartilhada** (`tarefas_admin.*`). Pedido do dono em 2026-11-26: entender a semana batendo o olho, como no Google Agenda, e mudar itens de data sem redigitar.

## Objetivos
- Categorias criadas pelo usuário, cada uma com nome e cor.
- Itens como faixas coloridas, semana em sete colunas.
- Arrastar itens entre dias, Tarefas e Notas.

## Fora do escopo
Grade de horas, visão de mês, juntar as duas agendas numa tela, reordenar itens dentro do mesmo dia, religar alarmes, repetição de itens.

## Caminhos considerados
- **A. Manter as duas telas com visual novo (escolhido pelo dono).** Pessoal e compartilhado não se misturam; reforma menor. Cada ajuste é feito nas duas páginas.
- **B. Uma tela só, com camadas como no Google.** Mais parecido com a referência, mas arrisca confundir item pessoal com compartilhado e é uma reforma bem maior.
- Biblioteca de calendário pronta: descartada (o front não usa build e os itens não têm horário).

## Categorias
- Nome (1 a 30 caracteres, sem repetir na mesma lista) e uma cor de uma paleta fixa de 10, legível no tema escuro. Guarda-se o código da cor, não o hexadecimal; as cores viram variáveis em `tema.css` e entram em `DESIGN.md`.
- **Minha semana:** cada usuário tem as suas; só ele vê (mesma regra de privacidade: dono = usuário do login, categoria alheia = 404).
- **Semana compartilhada:** uma lista única; quem tem `tarefas_admin.usar` cria, renomeia, troca a cor e exclui.
- Excluir categoria pede confirmação; os itens ficam "Sem categoria", nunca são apagados.
- Tabelas novas `web_tarefas_categorias` e `web_tarefas_admin_categorias`; coluna `categoria_id` (opcional) em `web_tarefas` e `web_tarefas_admin`. Só tabelas `web_*`; os itens já escritos continuam, sem categoria.

## Tela
```
 [‹] [Hoje] [›]  Novembro de 2026                [Categorias]
 ☑ ■ Financeiro  ☑ ■ Entregas  ☑ ■ Médico  ☑ ■ Sem categoria

   SEG      TER      QUA      QUI     SEX      SÁB     DOM
   23       24       25      (26)     27       28      29
 ▇Extrato ▇Ponto   ▇Michele ▇13º    ▇Backup
 + item   + item   + item   + item  + item   + item  + item
 [ TAREFAS ................ ]  [ NOTAS ................... ]
```
- Cabeçalho do dia com número grande; hoje num círculo.
- Item = faixa com o fundo da cor da categoria (sem categoria: cinza neutro). O texto continua editável no lugar, quebrando linha, e salva como hoje.
- Caixa de concluído dentro da faixa; concluído fica apagado e riscado, mantendo a cor.
- Marcador na faixa abre um menu: escolher a categoria e **Mover para...** (dia, Tarefas ou Notas), que também serve a quem usa teclado.
- Linha vazia no fim de cada dia para escrever; o item novo nasce sem categoria. Deixam de existir as 8 linhas pautadas fixas.
- Legenda no topo: marcar e desmarcar mostra e esconde a categoria. A escolha fica guardada naquele navegador.
- Mantidos: semana de segunda a domingo, quebra em 4 colunas e coluna única no celular, rascunho, autoria na compartilhada.

## Arrastar
- Computador: segurar pela alça da faixa e soltar no destino, que fica destacado. O texto continua selecionável.
- Celular: tocar e segurar a alça, arrastar; a tela rola ao chegar na borda.
- Só itens já salvos se arrastam. Arrastar não muda texto, categoria nem concluído.
- Mover para Notas (que não têm caixinha nem alarme) tira o concluído e o alarme; havendo alarme, pergunta antes. Entre dias e Tarefas o alarme gravado não muda.
- Se a gravação falhar, o item volta ao lugar com aviso.
- Compartilhada: o movimento leva a versão do item; se outra pessoa mudou antes, nada é gravado por cima e a tela mostra o atual.
- Para outra semana: pelo menu **Mover para...**, escolhendo a data.

## Rotas
- `PUT /minha_semana/:id` e `PUT /semana_admin/:id` passam a aceitar `quadro`, `data` e `categoriaId`; as leituras devolvem as categorias.
- Rotas de categorias: `/minha_semana/categorias` e `/semana_admin/categorias` (listar, criar, alterar, excluir), registradas pelo `registro` com as mesmas permissões das páginas.

## Testes e verificação
Testes `node:test` para rotas (privacidade, versão, exclusão de categoria, mover) e telas. Conferência das telas num navegador antes de entregar; celular de verdade fica para o dono testar.
