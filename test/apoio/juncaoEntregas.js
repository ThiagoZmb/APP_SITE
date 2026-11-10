// Simula, PELO TEXTO do SQL, a junção de ped_orc com web_entregas (várias entregas por pedido):
//  - com a junção da entrega principal (rotas/entregas_resumo.js: "en.id = (SELECT e2.id FROM web_entregas e2 ...")
//    o pedido sai UMA vez, com a entrega principal (calculo/entregas.js) e as contagens;
//  - com um LEFT JOIN direto (o jeito antigo) o pedido sai uma vez POR entrega, como no MySQL de verdade.
// Assim um teste com 2 entregas no mesmo pedido falha se alguém voltar ao LEFT JOIN direto.
const { entregaPrincipal, resumoEntregas } = require('../../calculo/entregas');

const JUNCAO_PRINCIPAL = /LEFT JOIN web_entregas en ON en\.numero = p\.NUMERO[^\n]* AND en\.id = \(SELECT e2\.id FROM web_entregas e2 WHERE e2\.numero = p\.NUMERO/;

// devolve [{ en, qtd }] para o pedido `numero`: en = linha de web_entregas (ou null), qtd = { qtdEntregas, qtdEntregasConcluidas }
function juntarEntregas(sql, numero, entregas, { casa = true } = {}) {
  const doPedido = casa ? entregas.filter(e => e.numero === numero) : [];
  const vazio = { qtdEntregas: 0, qtdEntregasConcluidas: 0 };
  if (!JUNCAO_PRINCIPAL.test(sql)) return doPedido.length ? doPedido.map(en => ({ en, qtd: vazio })) : [{ en: null, qtd: vazio }];
  const en = entregaPrincipal(doPedido);
  return [{ en, qtd: en ? resumoEntregas(doPedido) : vazio }];
}

module.exports = { juntarEntregas, JUNCAO_PRINCIPAL };
