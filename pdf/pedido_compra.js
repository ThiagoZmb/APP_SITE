// ==========================================================================
// PDF do pedido de compra ao fornecedor (A4 retrato, quantas páginas precisar), SEM preços.
// Texto do banco é só DADO: passa por textoPdf e é medido/quebrado aqui, em posição fixa.
// dados = carregarPedido (rotas/pedidos_compra_banco.js). Devolve os textos escritos (para os testes).
// ==========================================================================
const fs = require('fs');
const PDFDocument = require('pdfkit');
const { textoPdf, quebrarLinhas, dataBR } = require('../calculo/entrega_checklist');
const { LOGO } = require('./entrega_checklist');

const PAG = { w: 595.28, h: 841.89 };
const M = 36;
const W = PAG.w - 2 * M;
const FIM = PAG.h - M;
const F = { n: 'Helvetica', b: 'Helvetica-Bold' };
const COLUNAS = [{ nome: 'Código', x: M, w: 100 }, { nome: 'Descrição', x: M + 100, w: 280 }, { nome: 'Quantidade', x: M + 380, w: W - 380 }];
const TAM = 10, LINHA = 12.5, PAD = 4;

const novoDocumento = () => new PDFDocument({ size: 'A4', margin: 0, info: { Title: 'Pedido de compra', Author: 'Elegance' } });

function textoQuantidade({ qtd, porCaixa, unidade }) {
  const un = unidade ? ' ' + unidade : '';
  if (!(porCaixa > 1)) return `${qtd}${un}`;
  const caixas = qtd / porCaixa;
  return `${caixas} ${caixas === 1 ? 'caixa' : 'caixas'} com ${porCaixa} (${qtd}${un})`;
}

function desenharPedidoCompra(doc, d, { logo } = {}) {
  const textos = [];
  const escrever = (s, x, y, { fonte = F.n, tam = TAM, alinhar = 'left', largura = 0 } = {}) => {
    const txt = String(s ?? '');
    if (!txt) return;
    doc.font(fonte).fontSize(tam).fillColor('#000000');
    const px = alinhar === 'right' ? x + largura - doc.widthOfString(txt) : x;
    doc.text(txt, px, y, { lineBreak: false });
    textos.push(txt);
  };
  const quebrar = (s, largura, fonte = F.n) => quebrarLinhas(s, largura, t => { doc.font(fonte).fontSize(TAM); return doc.widthOfString(t); });
  const traco = (y, grossura = 0.5) => doc.save().lineWidth(grossura).strokeColor('#4d4d4d').moveTo(M, y).lineTo(M + W, y).stroke().restore();
  let y = M;

  try {
    const arq = logo === undefined ? LOGO : logo;
    if (arq && (typeof arq !== 'string' || fs.existsSync(arq))) doc.image(arq, M, y, { fit: [140, 50] });
  } catch { /* sem logo, a folha continua */ }
  escrever(`PEDIDO DE COMPRA Nº ${d.numero}`, M, y + 12, { fonte: F.b, tam: 15, alinhar: 'right', largura: W });
  escrever(`Data: ${dataBR(String(d.enviadoEm || d.criadoEm || '').slice(0, 10))}`, M, y + 33, { alinhar: 'right', largura: W });
  y += 66;
  for (const l of quebrar(`Fornecedor: ${textoPdf(d.fornecedor)}`, W, F.b)) { escrever(l, M, y, { fonte: F.b }); y += LINHA; }
  y += 10;

  const cabecalho = () => {
    for (const c of COLUNAS) escrever(c.nome, c.x + PAD, y, { fonte: F.b });
    y += LINHA + 3;
    traco(y, 1);
    y += PAD;
  };
  const novaPagina = () => { doc.addPage({ size: 'A4', margin: 0 }); y = M; };

  cabecalho();
  for (const i of d.itens) {
    const celulas = [textoPdf(i.codFornecedor), textoPdf(i.nomeFornecedor || i.produto), textoPdf(textoQuantidade(i))]
      .map((t, k) => quebrar(t, COLUNAS[k].w - 2 * PAD));
    const altura = Math.max(1, ...celulas.map(c => c.length)) * LINHA + PAD;
    if (y + altura > FIM) { novaPagina(); cabecalho(); }
    celulas.forEach((linhas, k) => linhas.forEach((l, n) => escrever(l, COLUNAS[k].x + PAD, y + n * LINHA)));
    y += altura;
    traco(y);
    y += PAD;
  }

  const obs = textoPdf(d.observacao, { multilinha: true });
  if (obs) {
    y += 10;
    if (y + 3 * LINHA > FIM) novaPagina();
    escrever('Observação:', M, y, { fonte: F.b });
    y += LINHA + 2;
    for (const l of quebrar(obs, W)) {
      if (y + LINHA > FIM) novaPagina();
      escrever(l, M, y);
      y += LINHA;
    }
  }
  return textos;
}

module.exports = { desenharPedidoCompra, novoDocumento, textoQuantidade };
