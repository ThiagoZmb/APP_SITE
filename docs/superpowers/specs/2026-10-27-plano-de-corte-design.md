# Plano de corte de perfis com aproveitamento de varas — especificação

Data: 2026-10-27 · Projeto: APP_SITE (ELEGANCE) · Situação: aguardando revisão

## 1. Objetivo

Gerar, a partir de um **Pedido**, a lista de peças de perfil de alumínio a cortar e distribuí-las em varas (e em retalhos já existentes) minimizando a perda. Substitui, para pedidos, a digitação manual da tela `frm_aproveitamento_vara` do VB, que hoje não tem ligação com o pedido.

Sucesso = o cortador abre o pedido, vê o plano com varas/retalhos e sobras, corta marcando as peças, confere as sobras reais, e o estoque de retalhos reflete o que foi cortado de verdade.

## 2. Decisões já tomadas

| Tema | Decisão |
|---|---|
| Escopo do plano | Um pedido por vez (algoritmo pronto para receber vários pedidos no futuro). |
| Retalhos | Plano usa retalhos existentes antes de abrir vara nova. |
| Atualização do estoque de retalhos | Plano gerado; o estoque só muda após **conferência** do corte real. |
| Peças incluídas | Perfis da porta (altura e largura), puxadores e divisores. Serralheria fica de fora. |
| Vara | Padrão 6000 mm, serra 3 mm (valores do VB), com exceção por perfil. |
| Sobra mínima para virar retalho | Padrão 500 mm, com exceção por perfil. |
| Algoritmo | Várias heurísticas determinísticas, escolhe a melhor (seção 5). |

## 3. Fatos do código existente em que o desenho se apoia

- VB `frm_aproveitamento_vara.vb`: barra 6000 mm, serra 3 mm, First-Fit Decreasing, marca peça cortada com clique. Não lê pedido nem estoque.
- Tabela `perfis` (só Pedido; gravada em `rotas/ped_orc.js:296-299`): `NUMERO, ITEM, QTD_PORTAS, PERFIL, QTD_ALTURA, TAM_ALTURA, QTD_LARGURA, TAM_LARGURA, PUXADOR, QTD_PUXADOR, TAM_PUXADOR`. Não tem acabamento nem cor.
- `ped_orc_itens_v4`: acabamento e cor do perfil, divisor (`DIVISOR, QTD_HORIZONTAL, QTD_VERTICAL, TAM_DIV_HORIZONTAL, TAM_DIV_VERTICAL`, `ACABAMENTO_DIVISOR, COR_DIVISOR`), acabamento/cor do puxador. Ligação por `NUMERO` + `ITEM`.
- `calculo/engenharia.js` `medidasPerfil` calcula as medidas dos perfis por folha. O plano **não recalcula** medidas: lê o que o pedido gravou.
- Não existe controle de retalho de perfil no VB nem na web (só sobra de chapa, em `frmPlanoCorteChapa`).
- O comprimento da vara não está em nenhum cadastro encontrado.

Pontos a confirmar na implementação (não verificados): o significado exato de `TAM_PUXADOR` no corte (comprimento de uma peça de puxador), se `QTD_PUXADOR` é por porta, e a multiplicação correta por `QTD_PORTAS` e por `QTD` do item em `ped_orc_itens_v4`. A implementação deve derivar isso do código de gravação e de testes com pedidos reais, sem supor.

## 4. Componentes

1. `calculo/corte_pecas.js` (puro). Entrada: linhas de `perfis` e `ped_orc_itens_v4` do pedido. Saída: lista de peças `{ perfil, acabamento, cor, tamanho, item, origem: porta-altura|porta-largura|puxador|divisor }` expandida pelas quantidades, e lista de **pendências** (peça sem tamanho, perfil sem acabamento/cor). Peça com dado faltando vai para pendências e fica fora do plano. Nada é estimado.
2. `calculo/corte_otimizacao.js` (puro). Entrada: peças, retalhos disponíveis, parâmetros por perfil (vara, serra, mínimo). Saída: por grupo (perfil+acabamento+cor), lista de barras (`vara` nova ou `retalho` com id), peças em cada uma, sobra, aproveitamento; sobras classificadas em `guardar` (≥ mínimo) ou `descartar`. Determinístico.
3. `rotas/corte.js`, registrado via `seguranca/rotas.js`, plugado no `index.js`.
4. `corte.html` + `corte.js`: plano, conferência, retalhos, parâmetros. Item "Plano de corte" no menu do botão direito dos pedidos (`painel_inicial.html`) e no menu lateral (`layout.js`).
5. Tabelas `web_*` criadas em `seguranca/instalacao.js`; permissões em `seguranca/permissoes.js`.

## 5. Algoritmo

Por grupo (perfil, acabamento, cor):
1. Retalhos disponíveis do mesmo grupo são candidatos primeiro (menor retalho que comporte a peça).
2. Cada peça consome `tamanho + serra` (um corte por peça, conservador e igual ao FFD do VB).
3. Estratégias executadas: First-Fit Decreasing, Best-Fit Decreasing, e ordens alternativas (por tamanho crescente de retalho, desempate estável). Para grupos pequenos, busca exata limitada por tempo/nós.
4. Escolhe o plano com **menos varas novas**; desempate: maior aproveitamento, depois menor número de retalhos pequenos gerados. Desempate final determinístico (ordem estável), para o mesmo pedido gerar sempre o mesmo plano.
5. Invariante testada: o resultado nunca usa mais varas que o First-Fit Decreasing do VB.
6. Peça maior que a vara: erro no item, plano dos demais continua.

Aproveitamento = soma dos tamanhos das peças ÷ soma dos comprimentos das varas/retalhos usados. Calculado em milímetros inteiros, sem ponto flutuante.

## 6. Dados

Tabelas novas (nunca alteram tabelas do VB):

- `web_corte_config`: `id`, `perfil` (NULL = padrão), `comprimento_vara` INT, `serra` INT, `sobra_minima` INT, auditoria de criação/alteração. UNIQUE em `perfil`. Linha padrão 6000 / 3 / 500 criada na instalação.
- `web_retalhos`: `id`, `perfil`, `acabamento`, `cor`, `comprimento` INT, `situacao` (`disponivel`, `reservado`, `usado`, `descartado`), `plano_origem` (NULL se cadastro manual), `plano_reserva` (NULL se não reservado), `criado_em`, `atualizado_em`, `criado_por`.
- `web_corte_planos`: `id`, `pedido`, `situacao` (`gerado`, `conferido`, `desatualizado`, `cancelado`), `impressao_pecas` (hash das peças), `parametros` JSON, `resultado` JSON, `criado_por/em`, `conferido_por/em`.

Sem FK para tabelas do VB. Medidas em mm inteiros.

## 7. Fluxo

1. Pré-visualização (`GET`): calcula sem gravar e sem reservar. Mostra plano e pendências.
2. Salvar plano (`POST`): em transação, grava o plano e marca os retalhos usados como `reservado`. Se um retalho já foi reservado por outro plano entre a pré-visualização e o salvar, recusa com mensagem clara e pede para recalcular.
3. Corte: marcar peças cortadas (estado do progresso guardado no plano).
4. Conferir/confirmar (`POST`), em transação: retalhos usados → `usado`; reservados não usados → `disponivel`; sobras ≥ mínimo, com medida real informada, → novos retalhos `disponivel`; sobras menores → descartadas; plano → `conferido`; auditoria.
5. Refazer plano: libera reservas do plano anterior (que vai para `cancelado`).
6. Pedido alterado depois do plano salvo (impressão das peças diferente): plano marcado `desatualizado` na leitura, sem recálculo automático. Pedido cancelado ou excluído pela web: reservas liberadas na mesma transação. Exclusão feita direto pelo VB deixa reserva órfã, com tela para liberar manualmente.

## 8. Permissões e segurança

`corte.ver`, `corte.planejar` (gerar, salvar, conferir, confirmar), `corte.parametros` (parâmetros e retalhos manuais). Migração: Administrador e Interno completo recebem ver+planejar; só Administrador recebe parametros. Toda rota por `registro.rota(...)`. Nenhum campo de dinheiro; contagens com nomes `qtd*`. Alterações auditadas em `web_auditoria` (somente nomes de campo e medidas). Validação no servidor.

## 9. Tela

Cabeçalho com resumo; pendências no topo; faixa por perfil/acabamento/cor com varas em escala (retalho em cor distinta, serra como marca, sobra rotulada, risco em texto além de cor); marcar peça cortada por clique; modo conferência (medida real, guardar ou descartar); abas Retalhos e Parâmetros; estados de carregamento, erro e vazio. Estilo, CSP e `layout.js` como nas demais telas.

## 10. Testes (`node:test`, sem MySQL)

- `corte_pecas`: quantidades, agrupamento, pendências, puxador e divisor.
- `corte_otimizacao`: peça = vara; peça > vara; retalho antes de vara nova; cor/acabamento nunca misturam; serra; determinismo; nunca pior que FFD do VB; sobra mínima por perfil.
- Rotas (banco falso novo `test/apoio/bancoCorte.js`): permissões, reserva e conflito de reserva, confirmação atômica, plano desatualizado, liberação em cancelamento/exclusão, auditoria.
- Tela: ids e estrutura. A captura real no navegador e o MySQL real não têm teste automático.

## 11. Fora desta versão

Serralheria; vários pedidos num plano; vários comprimentos de vara por perfil e estoque de varas inteiras; etiquetas/PDF do plano; baixa automática no `estoque` do VB.

## 12. Riscos e limitações conhecidas

- `perfis` não guarda acabamento/cor: depende de `ped_orc_itens_v4` e da consistência `NUMERO`+`ITEM`; divergência vira pendência.
- Reserva órfã por exclusão direta no VB.
- Comprimento real da vara depende do que for cadastrado em `web_corte_config`; o padrão 6000 mm vem do VB e não foi confirmado contra o fornecedor.
- Medidas lidas do pedido gravado: pedidos antigos sem registro em `perfis` (ou gravados antes de mudança de regra) não geram plano.
