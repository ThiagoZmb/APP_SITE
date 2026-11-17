# Permissões por ação (tela de usuários e perfis)

Pedido do dono (2026-11-17): a tela de permissões deve ser mais detalhada, com uma caixa por ação. Exemplo dado: "Reagendar entregas só pode ser feita pelo administrativo".

## O que mudou

Permissões "grossas" que cobriam várias ações foram desdobradas. Formato sempre `area.acao`, no catálogo único `seguranca/permissoes.js`.

| Antes | Ação | Permissão nova | Quem recebeu na migração |
|---|---|---|---|
| `entregas.programar` | Reagendar (`POST /entregas/:id/reagendar`) e mudar data, tipo ou motorista de entrega já programada pelo "Editar entrega" (`PUT /entregas/:id`) | `entregas.reagendar` (**só administrativo**) | perfis com `entregas.programar` **e** `administrativo.ver`; usuário com a chave por exceção e perfil que programava |
| `entregas.programar` | Cancelar entrega | `entregas.cancelar` | quem tinha `entregas.programar` |
| `entregas.programar` | Criar entrega à mão (`POST /entregas/pedido/:numero/criar`) | `entregas.criar` | idem |
| `entregas.programar` | Separar em outra entrega, gerar entrega do restante/saldo | `entregas.dividir` | idem |
| `entregas.programar` | Encerrar saldo (pode fechar o pedido) | `entregas.encerrar_saldo` | idem |
| `entregas.programar` | Baixa pela equipe: retirada, enviada, comprovante, e o envio das fotos (`PUT /entregas/:id/anexo`) | `entregas.concluir` | idem |
| `entregas.programar` | Foto do checklist assinado pela tela da equipe | `entregas.checklist_assinado` | idem |
| `pedidos.situacao` | Alterar a data de pronto do Pedido | `pedidos.data_pronto` | quem tinha `pedidos.situacao` |
| `orcamentos.criar` | Ajustar o desconto adicional do Pedido (`GET/POST /ped_orc/:tipo/:numero/desconto`, + `valores.ver`) | `pedidos.desconto` | quem tinha `orcamentos.criar` |

`entregas.programar` continua: agendar a entrega A programar, corrigir endereço, contato e observação (Editar entrega) e editar os campos do checklist externo (com `entregas.checklist`). `entregas.baixar` (motorista) e a baixa administrativa em "Minhas entregas" (chave `administrativo.ver`) não mudaram.

## Reagendar = administrativo

`entregas.reagendar` está em `PERMISSOES_ADMINISTRATIVAS`: sem a chave `administrativo.ver` ela some em `permissoesFinais`, venha do perfil ou de exceção "liberar". É o mesmo mecanismo de financeiro, gestão e preços, então a regra fica num lugar só, no servidor, e a tela mostra o selo "Só administrativo" na caixa. A alternativa (deixar a caixa livre e só "não marcar" em perfis de operador) dependeria de disciplina na hora de editar perfis; foi descartada.

O "Editar entrega" não é atalho: mudar data, tipo ou motorista de entrega que já saiu de A programar devolve 403 sem `entregas.reagendar` (a janela esconde esses campos para quem não tem). Entrega ainda A programar: definir a data é agendar (`entregas.programar`).

## Migração (`seguranca/instalacao.js`)

`desdobrarPermissoes(pool, marcador, regras)`, uma vez por marcador (`web_auditoria`), numa transação, só `INSERT IGNORE` em `web_perfil_permissoes` e `web_usuario_excecoes` (nunca toca tabela do VB nem tira permissão):

- perfil com a antiga ganha as novas;
- exceção do usuário na antiga (liberar **ou** bloquear) é copiada para as novas com o mesmo tipo, para o bloqueio continuar valendo;
- `soComChave` (hoje só `entregas.reagendar`) vai só ao perfil que tem a antiga **e** `administrativo.ver`, e por exceção "liberar" a quem tem a chave liberada por exceção e um perfil com a antiga.

Marcadores: `permissoes_entregas_acoes` e `permissoes_pedidos_acoes`, chamados na subida do `index.js` **depois** de `acrescentarPermissoesAdministrativo` (o reagendar depende da chave).

Perfis iniciais (instalação nova): Administrador e Interno completo têm todas as novas de entregas e `pedidos.desconto`; o Interno completo não tem `pedidos.data_pronto` (como não tem `pedidos.situacao`); Vendedor ganha `pedidos.desconto`; Operador ganha `pedidos.data_pronto`.

## Tela (`usuarios.html`)

O catálogo (`GET /admin/permissoes`) agora traz, por permissão, `descricao` (o que a caixa libera, onde aparece e o que mais exige) e `administrativa` (selo "Só administrativo"). Grade de exceções do usuário e caixas do perfil mostram rótulo + descrição, agrupados pela área. Toda permissão nova precisa de uma linha em `DESCRICOES` (`test/permissoes.test.js` confere).

## Telas que mudaram o `data-perm`

`entregas.html`/`entregas.js` (cada botão com a sua; o "Salvar" da agenda ficou sem `data-perm` porque serve a Agendar e a Reagendar), `entrega_editar.js` (`podeReagendar`), `inicio_menu.js` e `painel_inicial.html` (desconto, data de pronto e "Programar entrega" = `entregas.criar`).

## Testes

`test/permissoes_acoes.test.js` (rotas, Editar entrega, migração), `test/permissoes.test.js` (catálogo, descrições, administrativa, perfis iniciais), `test/data_pronto.test.js`, `test/desconto_pedido*.test.js`, `test/entregas_*.test.js` (perfis "Programador", "Programador sem reagendar" e "Só agendar" em `test/apoio/bancoEntregas.js`).

## Propostas ainda NÃO implementadas (o dono decide)

- Baixa administrativa em "Minhas entregas" com permissão própria (`entregas.baixa_administrativa`) em vez da chave inteira.
- `pedidos.situacao` separado em "Pronto/Em Produção" e "Entregue/Retirado à mão" (hoje o Operador marca Entregue sem passar pelas Entregas).
- `financeiro.situacao` separado de `financeiro.lancar` (exige mudar também `/fluxo/salvar`, que grava a situação junto da edição).
- `estoque.movimentar` separado em entrada e saída (mexe na detecção do perfil "só baixa por QR" do `layout.js`, na nota de compra e no plano de corte).
- `clientes.renomear` separado de `clientes.editar` (renomear com histórico).

**NÃO validado na prática** com usuários reais.
