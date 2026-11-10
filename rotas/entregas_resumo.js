'use strict';
// Várias entregas por pedido (etapa 1): junção de ped_orc com web_entregas que devolve UMA linha por pedido.
// Antes havia no máximo uma entrega por pedido (UNIQUE(numero)); com a entrega parcial um LEFT JOIN direto repetiria
// a linha do pedido (e o total do pedido seria somado em dobro nas telas). Aqui:
//  - `en` = só a entrega "principal" do pedido (mesma regra de entregaPrincipal em calculo/entregas.js):
//      ativa de data agendada mais cedo (sem data por último; desempate id menor) > concluída mais recente > cancelada mais recente;
//  - `er` = contagens do pedido (uma linha por número): qtd_entregas (não canceladas) e qtd_concluidas (entregue/retirado).
// Sem window functions (o MySQL do servidor pode ser 5.7). Nomes de contagem com qtd* (nunca nome de dinheiro).

const FINAIS = "'entregue', 'retirado', 'cancelada'";

// id da entrega principal do pedido `numero` (expressão SQL do número na consulta de fora)
const idPrincipal = numero => `(SELECT e2.id FROM web_entregas e2 WHERE e2.numero = ${numero}
        ORDER BY CASE WHEN e2.status IN ('entregue', 'retirado') THEN 1 WHEN e2.status = 'cancelada' THEN 2 ELSE 0 END,
                 CASE WHEN e2.status NOT IN (${FINAIS}) THEN e2.data_agendada IS NULL END,
                 CASE WHEN e2.status NOT IN (${FINAIS}) THEN e2.data_agendada END,
                 CASE WHEN e2.status NOT IN (${FINAIS}) THEN e2.id END,
                 e2.id DESC
        LIMIT 1)`;

// LEFT JOIN da entrega principal (`en`) + contagens (`er`). `condicao` é acrescentada ao ON de `en` (ex.: " AND p.TIPO = 'Pedido'").
function juntarEntregaPrincipal({ numero = 'p.NUMERO', condicao = '' } = {}) {
  return `LEFT JOIN web_entregas en ON en.numero = ${numero}${condicao} AND en.id = ${idPrincipal(numero)}
      LEFT JOIN (SELECT numero, COUNT(CASE WHEN status <> 'cancelada' THEN 1 END) AS qtd_entregas,
                        COUNT(CASE WHEN status IN ('entregue', 'retirado') THEN 1 END) AS qtd_concluidas
                   FROM web_entregas GROUP BY numero) er ON er.numero = en.numero`;
}

// colunas das contagens (0 quando o pedido não tem entrega)
const colunasQtdEntregas = (total = 'qtdEntregas', concluidas = 'qtdEntregasConcluidas') =>
  `COALESCE(er.qtd_entregas, 0) AS ${total}, COALESCE(er.qtd_concluidas, 0) AS ${concluidas}`;

module.exports = { juntarEntregaPrincipal, colunasQtdEntregas, idPrincipal };
