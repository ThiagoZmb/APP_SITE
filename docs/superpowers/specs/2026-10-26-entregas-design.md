# Módulo de Entregas — desenho

Data: 2026-10-26 · Status: implementada

## Desvios da implementação (valem sobre o texto abaixo)

1. **Sem gancho no web**: o registro de entrega nasce só pela varredura idempotente (`sincronizarFila`); a web nunca marca Pronto.
2. `recebedor` virou **`entregue_a`** (`receb` casa com `REGEX_VALOR`).
3. **Upload por PUT binário** (`PUT .../anexo`) e colunas extras em `web_entrega_anexos`: `entrega_id`, `criado_por`, `criado_em`; `evento_id` fica nulo até a baixa vincular o anexo.
4. **Foto do canhoto obrigatória**; assinatura opcional.
5. A aba **"Em rota"** da equipe inclui o status `enviada`.
6. **Rotas extras**: `GET /entregas/motoristas` e `GET .../anexo/:anexoId` (equipe e motorista).
7. A migração de permissões dá `entregas.ver` + `entregas.programar` a Administrador e Interno completo e **nenhuma** a `entregas.baixar` (o perfil Motorista é criado pela administração).
8. Ligações: `entregaStatus`/`dataAgendada` nas listas de pedidos, selo no painel de pedidos, "Entregas da semana" usa a data agendada, e o financeiro do cliente mostra `qtdEntregasPendentes` (somente leitura).

## 1. Objetivo

Seção de **Entregas** para coordenar a saída dos pedidos prontos. Três modos:

- **Motorista** (terceirizado): tem login próprio, vê só as entregas atribuídas a ele, no celular, e dá baixa.
- **Retirada**: o cliente retira na empresa; a equipe dá a baixa.
- **Outro estado**: transportadora/envio interestadual; a equipe registra e anexa o comprovante quando o cliente confirmar. Não aparece para o motorista.

Integra com **pedidos** (`ped_orc`) e **financeiro** (somente leitura na fase 1) e respeita as restrições de acesso do sistema. **Valores ficam ocultos** e só aparecem se o administrador liberar `valores.ver` ao usuário.

## 2. Decisões já tomadas

| Tema | Decisão |
|---|---|
| Baixa do motorista | Entregue + comprovante (foto do canhoto, quem recebeu, assinatura na tela) + ocorrências (cliente ausente, endereço errado, recusa, entrega parcial) com motivo e reagendamento |
| Cobrança no ato | Fora do escopo (fase 2) |
| Criação | Quando o pedido vira `Pronto`, nasce o registro com status **A programar**, sem endereço, motorista nem data. Depois a equipe usa **Agendar** |
| Endereço | Nunca preenchido automaticamente; digitado na hora de agendar ou depois. O endereço do cliente aparece só como sugestão de um clique |
| Data | `data_agendada` nasce vazia. `DATA_ENTREGA` do pedido aparece só como "prometido" (referência) |
| Outro estado | Registro (transportadora, rastreio, previsão) + comprovante anexado pela equipe depois |
| Fotos | No MySQL (MEDIUMBLOB), pois o disco do Render é efêmero |
| Criação do registro | Abordagem A: gancho no web **e** varredura idempotente ao abrir a tela (o VB também muda a situação do pedido direto no banco) |

## 3. Modelo de dados

Tabelas `web_*`, criadas em `seguranca/instalacao.js`. Tabelas do VB não são alteradas.

**`web_entregas`** (uma linha por pedido)
`id`, `numero` (UNIQUE; liga a `ped_orc` por `NUMERO` e `TIPO='Pedido'`), `status`, `tipo` (`motorista|retirada|outro_estado`, nulo até agendar), `data_agendada`, `motorista_codigo`, `endereco_rua`, `endereco_numero`, `endereco_bairro`, `endereco_cidade`, `endereco_uf`, `endereco_cep`, `endereco_ref`, `contato_local`, `transportadora`, `rastreio`, `previsao`, `observacao`, `criado_em`, `atualizado_em`.

**`web_entrega_eventos`** (histórico imutável)
`id`, `entrega_id`, `quando`, `usuario`, `tipo` (`criada|agendada|reagendada|saiu|entregue|parcial|ausente|endereco_errado|recusa|retirada|enviada|comprovante|cancelada`), `motivo`, `recebedor`, `detalhe` (JSON, ex.: itens entregues na parcial).

**`web_entrega_anexos`**
`id`, `evento_id`, `tipo` (`foto|assinatura`), `mime`, `dados` (MEDIUMBLOB, ≤ 1 MB).

Contagens usam nomes `qtd*` (a `redeDeValores` apaga campos com nome de dinheiro). Nenhum campo do módulo usa nomes como valor/total/frete/pago.

## 4. Fluxo de status

```
A programar → Agendada → Em rota → Entregue
                 │          └→ Ocorrência (ausente / endereço errado / recusa / parcial) → Reagendada → Agendada
                 └→ Cancelada (equipe)
Retirada:     A programar → Agendada → Retirado (balcão; equipe dá a baixa)
Outro estado: A programar → Agendada → Enviada → Entregue (comprovante anexado pela equipe)
```

- Transições validadas no servidor; baixa repetida é recusada.
- *Entregue* grava `ped_orc.SITUACAO='Entregue'` e *Retirado* grava `'Retirado'`, na **mesma transação** do evento.
- *Parcial* não fecha o pedido: vira ocorrência com a lista do entregue e pede reagendamento do restante.
- Cancelar a entrega não altera a situação do pedido.
- Pedido que volte de `Pronto` para `Em Produção` antes de ser agendado tem o registro "A programar" cancelado.

## 5. Criação do registro

- Gancho no web (`rotas/ped_orc.js` e na rota que muda a situação).
- Varredura idempotente ao abrir `GET /entregas`: `INSERT ... SELECT` dos pedidos `Pronto` sem registro; `UNIQUE(numero)` impede duplicidade. Cobre pedidos marcados como prontos pelo VB.

## 6. Telas

**`entregas.html`** (equipe, computador): abas Fila / Agenda / Em rota / Concluídas / Ocorrências, busca por pedido/cliente. Colunas: pedido, cliente, cidade/UF, prometido, status, ação. **Agendar** abre painel lateral (data, tipo, motorista, endereço, observação; para outro estado: transportadora, rastreio, previsão). Agenda por dia, agrupada por motorista, com reagendamento. Ocorrências com motivo e botão Reagendar. Detalhe com linha do tempo e comprovantes. Ação "Anexar comprovante" para outro estado.

**`minhas_entregas.html`** (motorista, celular, mobile-first): cartões do dia com cliente, endereço, botões "Abrir no mapa" e "Ligar", itens (descrição e quantidade), observações. **Iniciar rota** e **Dar baixa** com quatro resultados: Entregue, Parcial, Cliente ausente, Endereço errado/Recusa. Entregue pede quem recebeu, foto do canhoto e assinatura; os demais pedem motivo e sugerem reagendamento. Botões grandes, uma ação por tela, `<meta viewport>`.

**Ligações:** painel "Entregas da semana" de `inicio.html` passa a ler de `web_entregas`; selo de status da entrega na lista de pedidos; cliente com entrega pendente sinalizado no financeiro (somente leitura). Menu: item em `layout.js` (MENU, PAGINAS, ICONES).

## 7. Permissões

Novas em `seguranca/permissoes.js` (área "Entregas"):

| Código | Para quê |
|---|---|
| `entregas.ver` | Ver fila, agenda, ocorrências e detalhes (equipe) |
| `entregas.programar` | Agendar, reagendar, cancelar, editar endereço/transportadora, anexar comprovante de outro estado, baixa de retirada |
| `entregas.baixar` | Ver só as próprias entregas e dar baixa: saiu, entregue, ocorrência |

- Perfil **Motorista** (criado pelo administrador) tem só `entregas.baixar`. Valores só com exceção `liberar valores.ver` por usuário (`web_usuario_excecoes`, já existe).
- Administrador e Interno completo recebem `entregas.ver` e `entregas.programar` por migração pontual com marcador em `web_auditoria`.

## 8. Rotas (`rotas/entregas.js`, todas por `registro.rota`)

- Equipe: `GET /entregas`, `GET /entregas/:id`, `POST /entregas/:id/agendar|reagendar|cancelar|retirada|comprovante`, `PUT /entregas/:id/endereco`.
- Motorista: `GET /minhas_entregas`, `GET /minhas_entregas/:id`, `POST /minhas_entregas/:id/saiu|baixa|ocorrencia`.

## 9. Segurança

1. Isolamento do motorista: rotas `minhas_entregas` filtram por `motorista_codigo` do token; entrega alheia responde 404.
2. O motorista não recebe preços, desconto, crédito nem saldo; `semValores` e `redeDeValores` aplicados.
3. `filtroEstados` para usuários com estados restritos.
4. Anexos: só JPEG/PNG com assinatura de arquivo validada, ≤ 1 MB, até 3 por evento; download exige a permissão da entrega; CSP inalterado.
5. Cada evento grava também em `web_auditoria` (quem, quando, ação).
6. Gravações de baixa são transações.

## 10. Testes (`node:test`, banco falso)

Transições válidas e inválidas; baixa repetida; isolamento do motorista (404); valores ocultos sem `valores.ver`; baixa atualiza `ped_orc.SITUACAO`; varredura idempotente; cancelamento quando o pedido sai de `Pronto`; validação de anexos; `registro.verificar()` com as rotas novas.

## 11. Fora do escopo (fase 2)

Cobrança no ato (dinheiro/PIX do motorista com lançamento em `fluxo_de_caixa`), roteirização/otimização de rota, notificações ao cliente, geolocalização em tempo real.
