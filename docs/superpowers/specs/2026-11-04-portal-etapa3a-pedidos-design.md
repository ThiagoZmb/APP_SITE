# Portal do cliente, etapa 3a: pedidos e status (design)

Data: 2026-11-04. Parte da etapa 3 do spec `2026-11-03-portal-do-cliente-seguranca-design.md` (seção 7). A etapa 3 foi dividida em três ciclos independentes: **3a pedidos e status (este)**, 3b financeiro, 3c PDF e DANFE. 3b e 3c reaproveitam o isolamento por empresa definido aqui.

## 1. Objetivo e decisões

O cliente logado no portal vê os pedidos da própria empresa e o andamento de cada um.

Decisões do dono (04/11/2026):
- Começar por pedidos e status.
- **Só status, sem valores e sem itens.** Valores só no financeiro (3b), com `financeiro.ver`.

Premissas (a confirmar na revisão): o cliente vê só `TIPO = 'Pedido'`, nunca orçamento; a permissão é `pedidos.ver` (o administrador geral já a tem; a etapa 4 a distribui aos demais usuários).

## 2. Abordagem escolhida

Rotas dedicadas do portal, com SQL próprio e **lista fechada de campos**. Descartados: reaproveitar `/dados_pedidos` com filtro (a consulta carrega `TOTAL`, observação e outros campos internos; um erro de filtro vazaria tudo) e criar view no MySQL (DDL no banco do VB, que o projeto nunca altera).

## 3. Rotas

Ambas nascem por `registro.portal('get', ..., ['pedidos.ver'], handler)` e entram nas listas fixas de `registro.rotasPortal()`.

- `GET /portal/api/pedidos?pagina=N`: pedidos da empresa, `NUMERO` decrescente, 50 por página. `pagina` inteiro estrito ≥ 1 (senão 400). Resposta: `{ pedidos: [...], pagina, temMais }` (busca 51 linhas para saber se há mais).
- `GET /portal/api/pedidos/:numero`: ficha de um pedido. `:numero` inteiro estrito positivo (`12abc` = 404, não 400, para não distinguir formato de inexistência).

## 4. Isolamento por empresa

- A empresa vem **só** de `req.portal.empresaCodigo` (sessão). Nenhum parâmetro da requisição escolhe empresa ou nome de cliente.
- A ligação é feita dentro da consulta, em uma única ida ao banco:

```sql
FROM ped_orc p
JOIN cadastro_clientes c ON c.RAZAO_SOCIAL = p.RAZAO_SOCIAL
LEFT JOIN web_entregas en ON en.numero = p.NUMERO
WHERE c.CODIGO = ? AND p.TIPO = 'Pedido'
```

  (`LEFT JOIN web_entregas` e a ligação por razão social seguem o padrão de `/dados_pedidos` e `rotas/entregas.js`. `portalAutenticar` já garante a cada requisição que a razão social da empresa é não vazia e única, então o JOIN não cruza empresas.)
- Pedido de outra empresa, inexistente ou com número inválido responde o **mesmo 404** (mesmo corpo e mesmos cabeçalhos).

## 5. Lista fechada de campos

Resposta de cada pedido, exatamente estas chaves:

| chave | origem | observação |
|---|---|---|
| `numero` | `p.NUMERO` | |
| `data` | `p.DATA` | `YYYY-MM-DD` |
| `situacao` | `p.SITUACAO` | rótulo do mapa abaixo |
| `dataEntrega` | `p.DATA_ENTREGA` | só quando a situação é Entregue ou Retirado, senão `null` |
| `entrega` | `en.status` | rótulo do mapa abaixo, ou `null` se não há entrega registrada |
| `dataAgendada` | `en.data_agendada` | só com entrega Agendada ou Saiu para entrega, senão `null` |

**Nunca selecionados** (nem na consulta): `TOTAL`, `OBS_GERAL`, `CLIENTE_FINAL`, `FINANCEIRO`, comissão, itens, `en.motivo`/observações de ocorrência, motorista, anexos, outros eventos de entrega. Os nomes de chave não casam com `REGEX_VALOR` (`seguranca/valores.js`).

**Rótulos fechados** (função pura `calculo/portal_pedidos.js`):
- Situação: `Em Produção` → "Em produção"; `Pronto` → "Pronto"; `Entregue` → "Entregue"; `Retirado` → "Retirado"; `Cancelado` → "Cancelado"; qualquer outro valor → "Em andamento".
- Entrega: `a_programar` → "Aguardando agendamento"; `agendada` → "Entrega agendada"; `em_rota` → "Saiu para entrega"; `ocorrencia` → "Entrega a reprogramar"; `entregue` → "Entregue"; `retirado` → "Retirado"; `enviada` → "Enviada"; `cancelada` → "Cancelada"; qualquer outro → `null`. O motivo da ocorrência nunca é repassado.

## 6. Arquivos

- `calculo/portal_pedidos.js`: pura. `projetarPedido(linha)` (monta só as chaves da lista, aplica rótulos e regras de data), `paginaValida(texto)`, `numeroValido(texto)`.
- `rotas/portal_pedidos.js`: as duas rotas, consulta SQL com a lista de colunas escrita à mão, `pool` injetado como nas demais rotas. Erro de banco: 500 genérico, log só com `err.code`.
- Registro em `index.js` ao lado dos demais módulos de portal.
- `portal/public/pedidos.html` e `pedidos.js` (sem script nem estilo inline, texto por `textContent`, chamadas com `X-Portal: 1`, 401 volta ao login); link a partir de `inicio.html`; atualizar `portal.css` só se preciso.
- `docs/regras/portal-identidade.md`: seção nova (ou arquivo `portal-pedidos.md`) e linha de resumo no `CLAUDE.md`.

## 7. Erros

- 401 (sessão): igual ao do portal. 403 sem `pedidos.ver`. 503 portal não configurado (já cobertos pelos guardas).
- 400 `pagina` inválida. 404 uniforme para o detalhe. 500 genérico para erro de banco.

## 8. Testes (node:test, banco falso)

- Duas empresas com pedidos: cada uma vê só os seus, na lista e no detalhe; detalhe de pedido alheio e de inexistente com **corpo e status idênticos**.
- Chaves da resposta exatamente iguais à lista (contagem > 0) e SQL sem `TOTAL`, `OBS_GERAL`, `CLIENTE_FINAL`, `FINANCEIRO`, `motivo`.
- **Prova de mutação**: trocar o critério `c.CODIGO = ?` (ou passar o código de outra fonte) faz o teste de isolamento falhar; o banco falso deve aplicar o filtro de verdade, não devolver tudo.
- Orçamento nunca aparece.
- Rótulos: cada situação e status do mapa, e valor desconhecido.
- `dataEntrega` e `dataAgendada` só nas situações previstas.
- Paginação: 50 por página, `temMais`, `pagina` inválida = 400.
- Sem `pedidos.ver` = 403; sem sessão = 401; sessão de funcionário não vale.
- As rotas aparecem em `registro.rotasPortal()` e `registro.verificar()` passa.
- Teste de página: `pedidos.html` sem inline e com os mesmos cabeçalhos de `/portal`.

## 9. Fora do escopo

Valores e itens; PDF/DANFE (3c); financeiro (3b); busca e filtros; auditoria de leitura da lista (PDF e financeiro serão auditados; a lista de status não); criação de usuários (etapa 4).

## 10. Não testável aqui

Consulta contra MySQL real (JOIN por razão social e collation), página no navegador real. Conferir no roteiro de MySQL de teste já previsto na seção 12 de `docs/portal_configuracao.md`.
