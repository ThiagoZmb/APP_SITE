# Minha semana (caderno de tarefas pessoal)

> **Alarmes EM STAND BY** (decisão do dono, até o sistema ir para o HostGator): desligados pela chave `ALARMES_ATIVOS = false` em `layout.js`, sem apagar código, tabelas nem dados (sem sino, sem janela, sem `GET /alarmes`; o alarme gravado fica intacto). Para religar: trocar para `true` e subir o `?v=`.

Arquivos: `tarefas.html`, `tarefas.js`, `rotas/minha_semana.js`, `calculo/minha_semana.js`, tabela `web_tarefas`. Testes: `test/minha_semana_rotas.test.js` e `test/minha_semana_tela.test.js`. Desenho aprovado: `docs/superpowers/specs/2026-11-25-minha-semana-design.md`.

## Privacidade
- Só exige login (`rota(..., [])`); não há permissão nova.
- O dono da linha é sempre `req.user.id`. Todo `SELECT`, `UPDATE` e `DELETE` leva `usuario_codigo = ?`; usuário no corpo ou na URL é ignorado.
- Linha de outra pessoa responde **404**. Nem o administrador vê a lista alheia.
- O texto não vai para a auditoria nem para o log (o log leva só o rótulo da rota e o `err.code`).
- Na tela, se outro usuário entrar no mesmo navegador em outra aba, a página recarrega antes de enviar qualquer coisa.
- Nenhuma tabela do VB é lida ou alterada.

## Dados e rotas
- `web_tarefas`: uma linha por tarefa; `quadro` = `dia`, `tarefas` ou `notas`; `data` só no quadro `dia`; `texto` de 1 a 300 caracteres (quebra de linha vira espaço); `feita`; `alarme` opcional (dias e Tarefas), com `alarme_visto` e `alarme_adiado` (colunas acrescentadas na subida se faltarem).
- `GET /minha_semana?inicio=AAAA-MM-DD`: os sete dias a partir de `inicio`, mais todas as linhas de `tarefas` e `notas`, na ordem de criação.
- `POST /minha_semana`, `PUT /minha_semana/:id` (`texto`, `feita` e/ou `alarme`), `DELETE /minha_semana/:id`.
- Alarme (sino na linha, janela de aviso em qualquer tela, OK e Adiar): `docs/regras/semana-administradores-alarmes.md`, junto com a Semana compartilhada (cópia desta página).

## Tela
- Menu **Pessoal > Minha semana**. Fica fora de `PAGINAS` (nunca é a primeira página de ninguém) e está em `ATEND_BLOQUEADAS` (no modo atendimento some do menu e nada é buscado).
- A leitura é sempre da esquerda para a direita (pedido do dono, como a semana do Google Agenda), e a ordem do DOM é a mesma (Tab segue Segunda → Domingo). Quem manda é a largura da área (já sem o menu lateral): a partir de 960px, uma fileira com os 7 dias e, embaixo, Tarefas e Notas lado a lado; menos que isso, 4 colunas (Seg a Qui, Sex a Dom, depois Tarefas e Notas, metade cada). Celular (até 700px de tela): uma coluna, de Segunda a Domingo, Tarefas e Notas; a semana atual abre rolada até hoje.
- Cada linha é um `textarea` que cresce com o texto (aparece inteiro, quebrando linha). O texto continua sendo uma linha só: Enter salva e passa para a próxima sem inserir quebra, e o que for colado com quebras vira espaço.
- Cada quadro tem no mínimo 8 linhas e sempre uma vazia no fim. Salva no Enter e ao sair da linha. Apagar todo o texto exclui. Notas não têm caixinha.
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
- Fora do escopo: repetição de alarme, aviso com o sistema fechado, compartilhar (há a página própria dos administradores), impressão, transferir pendências.
