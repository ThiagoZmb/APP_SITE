# Minha semana (caderno de tarefas pessoal)

> **Alarmes EM STAND BY** (decisão do dono, até o sistema ir para o HostGator): desligados pela chave `ALARMES_ATIVOS = false` em `layout.js`, sem apagar código, tabelas nem dados (sem sino, sem janela, sem `GET /alarmes`; o alarme gravado fica intacto). Para religar: trocar para `true` e subir o `?v=`.

Arquivos: `tarefas.html`, `tarefas.js`, `agenda_comum.js` (parte nova, igual nas duas agendas: categorias, legenda, menu, "Mover para", arraste), `rotas/minha_semana.js`, `calculo/minha_semana.js`, tabelas `web_tarefas` e `web_tarefas_categorias`; visual no bloco AGENDAS do `tema.css`. Testes: `test/minha_semana_rotas.test.js`, `test/minha_semana_tela.test.js`, `test/agendas_categorias_rotas.test.js` e `test/agendas_tela.test.js`. Desenhos aprovados: `docs/superpowers/specs/2026-11-25-minha-semana-design.md` e `docs/superpowers/specs/2026-11-26-agendas-categorias-arrastar-design.md` (categorias, novo visual e arrastar).

## Privacidade
- Só exige login (`rota(..., [])`); não há permissão nova.
- O dono da linha é sempre `req.user.id`. Todo `SELECT`, `UPDATE` e `DELETE` leva `usuario_codigo = ?`; usuário no corpo ou na URL é ignorado.
- Linha de outra pessoa responde **404**. Nem o administrador vê a lista alheia.
- O texto não vai para a auditoria nem para o log (o log leva só o rótulo da rota e o `err.code`).
- Na tela, se outro usuário entrar no mesmo navegador em outra aba, a página recarrega antes de enviar qualquer coisa.
- Nenhuma tabela do VB é lida ou alterada.

## Dados e rotas
- `web_tarefas`: uma linha por tarefa; `quadro` = `dia`, `tarefas` ou `notas`; `data` só no quadro `dia`; `texto` de 1 a 300 caracteres (quebra de linha vira espaço); `feita`; `alarme` opcional (dias e Tarefas), com `alarme_visto` e `alarme_adiado`; `categoria_id` opcional (NULL = sem categoria). As colunas `alarme*` e `categoria_id` são acrescentadas na subida se faltarem (consulta ao `information_schema`, sem ADD COLUMN repetido).
- `GET /minha_semana?inicio=AAAA-MM-DD`: `{ linhas, categorias }`: os sete dias a partir de `inicio`, mais todas as linhas de `tarefas` e `notas`, na ordem de criação, e as categorias da pessoa (duas consultas em paralelo). Linha com categoria que não existe mais volta com `categoriaId: null`.
- `POST /minha_semana` (aceita `categoriaId`, normalmente nulo: o item novo nasce sem categoria), `PUT /minha_semana/:id` (`texto`, `feita`, `alarme`, `categoriaId` e/ou mover: `quadro` + `data`, esta só no dia), `DELETE /minha_semana/:id`.
- **Mover** não muda texto, categoria nem concluído; entre dias e Tarefas o alarme gravado fica. **Ir para Notas tira o concluído e o alarme** (com o "já vi" e o adiamento); `{ quadro: 'notas', feita: true }` ou alarme junto = 400.
- `categoriaId` que não é desta pessoa (de outra pessoa, da Semana compartilhada ou inexistente) = **400**, nada gravado.

## Categorias (`web_tarefas_categorias`)
- Cada pessoa tem as suas (`usuario_codigo` = `req.user.id`); só ela vê. Categoria de outra pessoa = **404** (ver, mudar, excluir).
- `GET/POST /minha_semana/categorias`, `PUT/DELETE /minha_semana/categorias/:id` (só login). Nome de 1 a 30 caracteres, uma linha; não repete na lista (maiúsculas e acentos não contam, igual à chave única `uk_tarefas_cat_nome (usuario_codigo, nome)` do `utf8mb4_unicode_ci`): repetido = 409. Cor = um dos 10 códigos (`vermelho, laranja, amarelo, lima, verde, turquesa, azul, lavanda, roxo, rosa`), nunca hexadecimal. Até 30 categorias por pessoa.
- Excluir (transação): apaga a categoria e deixa os itens dela "Sem categoria"; **nunca apaga item**. A tela pede confirmação.
- Nome fora do log e da auditoria (o log leva só o rótulo da rota e o `err.code`).
- Alarme (sino na linha, janela de aviso em qualquer tela, OK e Adiar): `docs/regras/semana-administradores-alarmes.md`, junto com a Semana compartilhada (cópia desta página).

## Tela
- Menu **Pessoal > Minha semana**. Fica fora de `PAGINAS` (nunca é a primeira página de ninguém) e está em `ATEND_BLOQUEADAS` (no modo atendimento some do menu e nada é buscado, **menos para quem tem `administrativo.ver`**, que continua vendo e usando).
- A leitura é sempre da esquerda para a direita (pedido do dono, como a semana do Google Agenda), e a ordem do DOM é a mesma (Tab segue Segunda → Domingo). Quem manda é a largura da área (já sem o menu lateral): a partir de 960px, uma fileira com os 7 dias e, embaixo, Tarefas e Notas lado a lado; menos que isso, 4 colunas (Seg a Qui, Sex a Dom, depois Tarefas e Notas, metade cada). Celular (até 700px de tela): uma coluna, de Segunda a Domingo, Tarefas e Notas; a semana atual abre rolada até hoje.
- Cabeçalho: ‹ Hoje › , mês da semana ("Novembro de 2026", ou "Novembro – Dezembro de 2026") com o intervalo, e o botão **Categorias**. Cada dia mostra o dia curto (SEG) e o número; hoje fica no círculo cobre.
- Cada item salvo é uma **faixa** com o fundo da cor da categoria (sem categoria: cinza neutro); concluído fica apagado e riscado, mantendo a cor. Visual e contraste: `DESIGN.md` ("Categorias das agendas" e "Agendas").
- Cada linha é um `textarea` que cresce com o texto (aparece inteiro, quebrando linha). O texto continua sendo uma linha só: Enter salva e passa para a próxima sem inserir quebra, e o que for colado com quebras vira espaço.
- Cada quadro tem só os itens e **uma linha vazia no fim** para escrever ("+ Novo item"); não há mais as 8 linhas pautadas. Linha que ficou vazia no meio (texto apagado e excluído) sai da tela. Salva no Enter e ao sair da linha. Apagar todo o texto exclui. Notas não têm caixinha.
- **Menu da faixa** (botão "⋯", só em item salvo): escolher a categoria (ou "Sem categoria"), **Mover para…** (os dias desta semana, Tarefas, Notas ou outra data; serve a quem usa teclado) e "Editar categorias…". Trocar a categoria grava na hora pela fila da linha; se falhar, nada muda e aparece aviso.
- **Legenda** no topo (só quando há categorias): desmarcar esconde os itens daquela categoria (ou os "Sem categoria"). A escolha fica guardada **naquele navegador** (`minha_semana_legenda:<id do usuário>`); o que está sendo escrito ou deu erro nunca é escondido.
- **Arrastar** (Pointer Events, mouse e toque): segurar a alça (seis pontos à esquerda da faixa) e soltar em outro dia, em Tarefas ou em Notas; o destino fica destacado e uma cópia segue o ponteiro. No toque, segurar a alça um instante; perto da borda a tela rola sozinha. Esc, `pointercancel` ou soltar fora de um quadro desfazem. **Só item salvo e sem nada pendente se arrasta** (texto digitado e ainda não salvo, fila ocupada ou erro: não sai do lugar e a tela avisa "Espere o texto ser salvo"). O movimento entra na mesma fila da linha (sem POST repetido). Se a gravação falhar, o item volta ao lugar com aviso. Ir para Notas com alarme gravado pergunta antes (mesmo com os alarmes em stand by, porque o alarme gravado seria apagado). Para outra semana: "Mover para…" com a data.
- Tarefas e Notas não mudam com a semana. Tarefa não concluída fica no dia em que foi escrita.
- Cada linha grava em fila (uma operação por vez), para não nascer tarefa repetida. Se falhar, o texto fica, a linha ganha borda vermelha e aviso, e Enter tenta de novo. Com texto não salvo, a semana não troca e o navegador avisa ao sair.
- Linha apagada em outro aparelho: se for editada aqui, é criada de novo.
- Datas sem fuso (`somarDias`, `segundaDe`); não usar `toISOString`.

## Rascunho no navegador (nada digitado se perde)
- Enquanto o servidor não confirma, o texto e a marca ficam no `localStorage` do navegador, na chave `minha_semana_rascunho:<id do usuário>` (id lido do token do login). É gravado ao digitar e ao marcar e **removido assim que salvar ou apagar dá certo**. Só guarda o que está pendente. Armazenamento bloqueado: a tela funciona, sem essa proteção.
- Cobre sessão expirada ou bloqueada durante a gravação (a tela vai para o login e apaga o `auth`, o rascunho fica) e aba fechada ou descartada no celular.
- Ao abrir a página, o mesmo usuário recebe o rascunho de volta na linha, no quadro e na semana certos, com aviso de não salvo, e ele é enviado. Dias de outras semanas são enviados em segundo plano antes de carregar a semana; se falhar, aparece um aviso e o texto fica guardado para aquela semana. Rascunho de outro usuário nunca é lido nem enviado.
- Sem duplicar: se um envio de linha nova ficou sem resposta, antes de reenviar a tela procura no servidor linha com o mesmo quadro, data e texto enviado e usa a existente. Linha que nunca foi enviada vira linha nova, mesmo que exista outra igual.
- Ao esconder ou fechar a aba (`visibilitychange` e `pagehide`), as linhas pendentes são salvas pela mesma fila (sem POST repetido). O envio na saída pode ser cancelado pelo navegador; o rascunho cobre.
- **Fica no computador**: até salvar, o texto está legível no armazenamento daquele navegador (mesmo depois de Sair), para quem tiver acesso ao perfil do Windows e souber procurar. A tela não o mostra a outro usuário do sistema.

## Limites conhecidos
- Rascunho antigo vence: se a mesma linha foi mudada em outro aparelho depois, o rascunho restaurado grava por cima.
- Duas abas do mesmo usuário: uma aba aberta enquanto a outra ainda tem texto pendente pode enviá-lo também (linha repetida).

- Não há atualização automática: o que foi escrito em outro aparelho aparece ao trocar de semana, ao tocar em "Hoje" ou ao reabrir a página. Dois aparelhos editando a mesma linha: vale a última gravação.
- Se o servidor gravar uma linha nova, a resposta se perder e a nova tentativa for na mesma tela aberta (sem recarregar), nasce outra igual.
- Usuário sem nenhuma permissão de tela não consegue entrar no sistema (regra do login, anterior a este módulo).
- Fora do escopo: repetição de alarme, aviso com o sistema fechado, compartilhar (há a página própria dos administradores), impressão, transferir pendências, grade de horas, visão de mês, reordenar itens dentro do mesmo dia (a ordem é a de criação).
- Categoria criada ou renomeada em outro aparelho só aparece ao trocar de semana ou reabrir (a pessoal não se atualiza sozinha).
- **Verificado no Edge headless com API simulada (servidor real em modo de teste, banco em memória), em 1600 e 390 px; não testado em celular real (toque, rolagem na borda), em MySQL real nem em produção.**
