# Semana compartilhada e alarmes

> **Alarmes EM STAND BY** (decisão do dono, até o sistema ir para o HostGator): desligados pela chave `ALARMES_ATIVOS = false` em `layout.js`, sem apagar código, tabelas nem dados (sem sino, sem janela, sem `GET /alarmes`; o alarme gravado fica intacto). Para religar: trocar para `true` e subir o `?v=`.

Arquivos: `tarefas_admin.html`, `tarefas_admin.js`, `agenda_comum.js` (parte nova, igual nas duas agendas), `calculo/agenda_repeticao.js` (repetição), `rotas/semana_admin.js`, `rotas/alarmes.js`, `calculo/alarmes.js`, `alarmes.js` (carregado pelo `layout.js` em todas as telas). Tabelas `web_tarefas_admin`, `web_tarefas_admin_avisos` e `web_tarefas_admin_categorias`; colunas `alarme`, `alarme_visto` e `alarme_adiado` em `web_tarefas`; `categoria_id` em `web_tarefas` e `web_tarefas_admin`. Testes: `test/semana_admin_rotas.test.js`, `test/semana_admin_tela.test.js`, `test/alarmes_rotas.test.js`, `test/alarmes_tela.test.js`, `test/agendas_categorias_rotas.test.js`, `test/agendas_tela.test.js`, `test/agendas_repeticao*.test.js` (banco em memória com trava de linha no `FOR UPDATE`: `test/apoio/bancoSemana.js`). Desenhos aprovados: `docs/superpowers/specs/2026-11-25-semana-administradores-alarmes-design.md` e `docs/superpowers/specs/2026-11-26-agendas-categorias-arrastar-design.md`.

A Semana compartilhada é uma **cópia separada** da Minha semana (escolha do dono): ajuste de tela feito em `tarefas.js`/`tarefas.html` precisa ser repetido em `tarefas_admin.js`/`tarefas_admin.html`. Só a parte nova (paleta, legenda, menu da faixa, janelas e arraste) fica em um arquivo único, `agenda_comum.js`, e o visual dela no bloco AGENDAS do `tema.css`. Quadros, texto, datas, grade, faixas, menu, legenda e arraste seguem `docs/regras/minha-semana.md`.

## Categorias e mover (compartilhada)
- Lista única (`web_tarefas_admin_categorias`, nome único `uk_tarefas_admin_cat_nome`): quem tem `tarefas_admin.usar` cria, renomeia, troca a cor e exclui. `GET/POST /semana_admin/categorias`, `PUT/DELETE /semana_admin/categorias/:id` (sem a permissão: 403 sem tocar no banco; inexistente: 404; nome repetido: 409). Mesmas regras de nome e cor da pessoal; nome fora do log e da auditoria.
- Categoria pessoal nunca vale aqui e a compartilhada nunca vale na pessoal: `categoriaId` de outra lista = 400, nada gravado.
- Excluir a categoria (transação) deixa os itens "Sem categoria" **sem mudar a versão deles** (texto, concluído e alarme continuam os mesmos); nunca apaga item.
- Trocar a categoria e **mover** (`quadro` + `data` no `PUT`) levam a versão que a pessoa via: se outra pessoa mudou antes, 409 com a linha atual, **nada gravado por cima**; a tela adota o atual (põe o item onde ele está agora) e avisa. Item apagado por outra pessoa (404): sai da tela com aviso. Ir para Notas zera concluído, "feita por" e alarme e apaga os avisos do alarme (a tela pergunta antes se havia alarme).
- A atualização de 60 s também traz a lista de categorias (legenda e cores mudam se outra pessoa mexeu) e leva para o lugar novo o item que outra pessoa moveu. **Não roda com um arraste em andamento, com o menu da faixa ou qualquer janela aberta** (tenta no minuto seguinte; confere de novo depois que a resposta chega).
- Legenda guardada no navegador em `semana_admin_legenda:<id>`, separada da pessoal.

## Repetir (série) na compartilhada
- Mesmas regras da pessoal (`docs/regras/minha-semana.md`, "Repetir"): colunas `serie_id`/`serie_pos` em `web_tarefas_admin` (índice `ix_tarefas_admin_serie`), menu **Repetir…**, datas, limites, ↻, pergunta **Só este / Este e os próximos / Todos**, Cancelar/Desfazer, rascunho com a escolha, Notas tira da série, caixinha/arraste/alarme só daquele dia. Uma série da pessoal nunca vale aqui (tabelas separadas; mesmo `serie_id` plantado na outra tabela não é tocado).
- `POST /semana_admin/:id/repetir` leva a `versao`: versão velha = 409 com a linha atual e nada criado; já em série = 409 `jaEmSerie` (com `atual`). O item original ganha versão nova; as cópias nascem na versão 1 com a autoria de **quem repetiu** (login), não a do item original.
- **Política para não gravar por cima de ninguém** (decisão desta entrega): `PUT /semana_admin/:id` com `escopo` e `DELETE` com `{ versao, escopo }` conferem a versão **do item clicado** (409 de sempre). Nos **outros** itens do escopo, o servidor só muda (ou apaga) os que **ainda estão iguais a este** no que vai mudar: mesmo texto (texto e exclusão) ou mesma categoria (categoria). Os que alguém deixou diferentes ficam como estão e voltam contados em `serie.diferentes`; a tela avisa ("1 item ficou como estava, porque alguém o deixou diferente"). Concluídos nunca são apagados em série. Cada item mudado ganha versão nova: quem estiver com ele aberto e pendente recebe o 409 de sempre ("Manter o meu"/"Usar o atual"). Itens já iguais ao novo valor não são regravados.
- A pergunta avisa a regra ("Nas outras repetições só muda o que ainda está igual a este…"). Linha em conflito ou apagada por outra pessoa segue o caminho de sempre antes de qualquer pergunta de série.
- A atualização de 60 s não mexe em linha esperando a escolha da série nem com a pergunta aberta; traz os itens que outra pessoa repetiu nesta semana.

## Quem entra
- Permissão `tarefas_admin.usar` ("Semana compartilhada", área Pessoal), em `PERMISSOES_ADMINISTRATIVAS`: sem a chave `administrativo.ver` ela não vale, nem com exceção "liberar".
- **Automática** (decisão do dono, 2026-11-26): todo usuário ativo com `administrativo.ver` recebe a permissão, esteja ou não no perfil (`permissoesFinais`). Só se tira com a exceção "Bloquear" no usuário. A caixa do perfil não faz diferença: na tela ela fica travada e acompanha o Acesso administrativo.
- A migração antiga (`acrescentarPermissoesTarefasAdmin`, só no perfil Administrador) continua no código, sem efeito prático.
- Sem ela: 403 nas quatro rotas, nenhum alarme compartilhado, menu escondido. No modo atendimento a página só some para quem não tem `administrativo.ver` (para o administrativo ela continua no menu e abre). Nunca é a primeira página depois do login.

## Rotas e versão
- `GET /semana_admin?inicio=` (`{ linhas, categorias }`), `POST /semana_admin`, `PUT /semana_admin/:id` (`texto`, `feita`, `alarme`, `categoriaId`, mover com `quadro` + `data`, sempre com `versao`), `DELETE /semana_admin/:id` (`versao` no corpo ou na URL).
- Linha: `id, quadro, data, texto, feita, alarme, versao, criadaPor, feitaPor, categoriaId`. Autor e "feita por" vêm do login (nome gravado na linha; nenhuma tabela do VB).
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
- **Não testado**: banco MySQL real (o SQL de avisos com `ON DUPLICATE KEY UPDATE`, os `ADD COLUMN`, as tabelas de categorias, o ALTER da série, o INSERT de várias linhas e os `id IN (...)` só foram exercitados no banco simulado), celular de verdade, som, e uso por duas pessoas reais. Categorias, faixas, legenda, arraste (mouse e toque emulado), conflito no arraste e atualização esperando o arraste: verificados no Edge headless com API simulada (1600 e 390 px).
