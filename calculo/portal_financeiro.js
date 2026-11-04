'use strict';
// Portal do cliente, etapa 3b: projeção e validação puras do financeiro (sem banco).
const { paginaValida, TAMANHO_PAGINA, PAGINA_MAXIMA } = require('./portal_pedidos');

const EM_ABERTO = ['A Receber', 'Atrasado', 'Protestado'];

const SITUACOES = Object.freeze({
  'A Receber': 'A receber',
  'Atrasado': 'Em atraso',
  'Protestado': 'Protestado',
  'Recebido': 'Pago',
});

const tem = (mapa, k) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(mapa, k);

function visaoValida(valor) {
  if (valor === undefined) return 'abertos';
  return valor === 'abertos' || valor === 'pagos' ? valor : null;
}

// Arredonda a 2 casas pela notação decimal (Math.round('10.005e2')), que evita o erro de 10.005*100.
function dinheiro(valor) {
  let n;
  if (typeof valor === 'number') n = valor;
  else if (typeof valor === 'string' && valor.trim() !== '') n = Number(valor.trim());
  else return null;
  if (!Number.isFinite(n)) return null;
  const txt = String(n);
  const r = txt.includes('e') ? Math.round(n * 100) / 100 : Number(Math.round(txt + 'e2') + 'e-2');
  return Object.is(r, -0) ? 0 : r;
}

function docesMesesAtras(hoje) {
  const [a, m, d] = hoje.split('-').map(Number);
  const ano = a - 1;
  const ultimo = new Date(Date.UTC(ano, m, 0)).getUTCDate();
  const p2 = n => String(n).padStart(2, '0');
  return `${ano}-${p2(m)}-${p2(Math.min(d, ultimo))}`;
}

function projetarTitulo(linha, hoje) {
  const l = linha || {};
  if (!tem(SITUACOES, l.SITUACAO)) return null;
  if (typeof l.DATA !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(l.DATA)) return null;
  const valor = dinheiro(l.VALOR);
  if (valor === null) return null;
  let situacao = SITUACOES[l.SITUACAO];
  if (l.SITUACAO === 'A Receber' && l.DATA < hoje) situacao = 'Em atraso';
  const pedTxt = l.PEDIDO === null || l.PEDIDO === undefined ? '' : String(l.PEDIDO).trim();
  const pedido = pedTxt === '' ? null : (/^\d+$/.test(pedTxt) ? Number(pedTxt) : pedTxt);
  const nf = l.NOTA_FISCAL === null || l.NOTA_FISCAL === undefined ? '' : String(l.NOTA_FISCAL).trim();
  return {
    vencimento: l.DATA,
    pedido,
    notaFiscal: nf === '' ? null : nf,
    valor,
    situacao,
  };
}

module.exports = { visaoValida, dinheiro, docesMesesAtras, projetarTitulo, EM_ABERTO, paginaValida, TAMANHO_PAGINA, PAGINA_MAXIMA };
