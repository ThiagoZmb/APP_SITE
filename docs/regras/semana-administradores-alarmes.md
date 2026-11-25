# Semana compartilhada e alarmes

> **Alarmes EM STAND BY** (decisão do dono, até o sistema ir para o HostGator): desligados pela chave `ALARMES_ATIVOS = false` em `layout.js`, sem apagar código, tabelas nem dados (sem sino, sem janela, sem `GET /alarmes`; o alarme gravado fica intacto). Para religar: trocar para `true` e subir o `?v=`.

Arquivos: `tarefas_admin.html`, `tarefas_admin.js`, `rotas/semana_admin.js`, `rotas/alarmes.js`, `calculo/alarmes.js`, `alarmes.js` (carregado pelo `layout.js` em todas as telas). Tabelas `web_tarefas_admin` e `web_tarefas_admin_avisos`; colunas `alarme`, `alarme_visto` e `alarme_adiado` em `web_tarefas`. Testes: `test/semana_admin_rotas.test.js`, `test/semana_admin_tela.test.js`, `test/alarmes_rotas.test.js`, `test/alarmes_tela.test.js` (banco em memória: `test/apoio/bancoSemana.js`). Desenho aprovado: `docs/superpowers/specs/2026-11-25-semana-administradores-alarmes-design.md`.

A Semana compartilhada é uma **cópia separada** da Minha semana (escolha do dono): ajuste de tela feito em `tarefas.js`/`tarefas.html` precisa ser repetido em `tarefas_admin.js`/`tarefas_admin.html`. Quadros, texto, datas e grade seguem `docs/regras/minha-semana.md`.

## Quem entra
- Permissão `tarefas_admin.usar` ("Semana compartilhada", área Pessoal), em `PERMISSOES_ADMINISTRATIVAS`: sem a chave `administrativo.ver` ela não vale.
- Começa só no perfil Administrador (`acrescentarPermissoesTarefasAdmin`, marcador `permissoes_tarefas_admin`, depois da chave administrativa na subida). O dono pode dá-la a outra pessoa na tela de Usuários.
- Sem ela: 403 nas quatro rotas, nenhum alarme compartilhado, menu escondido. No modo atendimento a página some e nada é buscado. Nunca é a primeira página depois do login.

## Rotas e versão
- `GET /semana_admin?inicio=`, `POST /semana_admin`, `PUT /semana_admin/:id` (`texto`, `feita`, `alarme`, `versao`), `DELETE /semana_admin/:id` (`versao` no corpo ou na URL).
- Linha: `id, quadro, data, texto, feita, alarme, versao, criadaPor, feitaPor`. Autor e "feita por" vêm do login (nome gravado na linha; nenhuma tabela do VB).
- Versão diferente: **409** `{ error, atual }` sem gravar. Linha inexistente: 404. Cada gravação soma 1 à versão (linha travada com `FOR UPDATE`).
- Texto fora de log e auditoria. Não há registro de quem apagou.

## Tela
- Autoria discreta sob o texto ("Ana" ou "Ana · feita por João").
- Atualiza a cada 60 s e ao voltar à aba, **só em linhas livres**: sem foco, sem nada pendente, sem erro e sem a janela do alarme aberta.
- Conflito (409): o texto digitado fica no campo, o atual é mostrado e a pessoa escolhe **Manter o meu** (grava por cima da versão nova; o que ela não mudou fica como o outro deixou) ou **Usar o atual**. Se o que ela queria já é o que está lá, a tela adota sem perguntar.
- Apagada por outra pessoa (404): avisa e oferece **Criar de novo** ou **Descartar**; não recria sozinha.
- Perdeu a permissão (403): a tela é limpa.
- Rascunho em `semana_admin_rascunho:<id>`, separado da página pessoal (nunca vira linha pessoal). Guarda a versão que a pessoa via: se a linha mudou enquanto isso, volta como conflito. Rascunho de linha nova sem resposta só adota linha criada pela própria pessoa. Quem perde a permissão deixa o rascunho pendente guardado naquele navegador (não é mostrado nem enviado).

## Alarmes (nas duas páginas)
- `'AAAA-MM-DD HH:MM'`, hora como digitada (Brasília). Só quadros dos dias e Tarefas; toca uma vez; feita ou apagada não toca.
- Sino na linha abre uma janela com data e hora (**Salvar**, **Remover**, **Cancelar**); a linha mostra `Alarme 25/11 14:30`. Em linha nova o texto é salvo antes, pela mesma fila.
- `PUT` das duas páginas aceita `alarme` (texto ou `null`); notas com alarme = 400.
- `GET /alarmes`: não feitas, com alarme, ainda não vistas por quem pergunta; `quando` = horário adiado, senão o alarme. Compartilhados só com a permissão. O servidor não compara horários.
- `POST /alarmes/:origem/:id/ok` `{ alarme }` e `.../adiar` `{ alarme, ate }` (`origem` = `pessoal` ou `admin`). Alarme diferente do atual = 409; pessoal de outro = 404; admin sem permissão = 403. Adiar não desfaz um OK já dado para o mesmo horário.
- Trocar o horário volta a tocar (para todos, na compartilhada: os avisos são apagados). Adiar e OK valem só para quem clicou e não mudam a linha nem a versão. Apagar a tarefa apaga os avisos.
- `alarmes.js`: consulta a cada 60 s (e ao voltar à aba, ao gravar na própria aba e quando outra aba responde); dispara pelo **relógio do aparelho**; uma janela por vez, com três bipes (WebAudio); o foco vai para o texto, não para o OK. Modo atendimento retém (ligar ou desligar vale na hora, pelo evento `atendimento-mudou` do `layout.js`). Com o aviso aberto, nenhuma tecla chega à tela de baixo (`blindarTeclado`, `window` em captura): Tab alcança Adiar/OK, Enter e Espaço acionam o botão, Esc e F5 não fazem nada; os modais da tela continuam abertos com o que foi digitado. Erro ou 401 são ignorados.

## Limites conhecidos
- O aviso só aparece com o sistema aberto; fechado, aparece na próxima entrada. Pode atrasar até 1 minuto (aba em segundo plano pode atrasar mais).
- Aparelho com fuso ou relógio errado toca no horário errado.
- O navegador pode bloquear o som enquanto a pessoa não tiver clicado na página.
- Várias abas abertas: cada uma mostra a sua janela e toca; OK numa fecha as outras.
- Excluir e depois marcar a mesma linha por outra pessoa só aparece na próxima atualização (até 1 minuto).
- **Não testado**: banco MySQL real (o SQL de avisos com `ON DUPLICATE KEY UPDATE` e o `ADD COLUMN` só foram exercitados no banco simulado), celular de verdade, som, e uso por duas pessoas reais.
