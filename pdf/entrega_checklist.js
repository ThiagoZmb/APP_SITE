// ==========================================================================
// PDF "CHECKLIST EXTERNO – ENTREGAS" (A4 retrato, UMA página), no modelo da planilha que o motorista leva impressa:
// logo | título | data de entrega (+ dia da semana) | pedido | cliente | cliente final | endereço | observações de entrega
// (+ "Qualquer dúvida entrar em contato com :") | faixa MOTORISTA | conferido itens/volumes (caixinhas) | itens da entrega
// (lista compacta, só se couber) | observações gerais | data de recebimento | recebido por | documento | declaração | assinatura.
// Texto do banco é só DADO: passa por textoPdf (caracteres que a Helvetica escreve) e é medido/quebrado aqui; nada de HTML.
// Nunca cria segunda página: todo texto é escrito em posição fixa, sem quebra automática do pdfkit (lineBreak: false).
// dados = montarAutomatico/mesclar/folhaEmBranco (calculo/entrega_checklist.js). Devolve os textos escritos (para os testes).
// ==========================================================================
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { textoPdf, ajustarTexto, quebrarLinhas, dataBR, diaDaSemana, qtdTexto, linhaItem } = require('../calculo/entrega_checklist');

const LOGO = path.join(__dirname, '..', 'imagens', 'logo_elegance.png');
const PAG = { w: 595.28, h: 841.89 };
const M = 34;                     // margem
const W = PAG.w - 2 * M;          // largura útil
const LW = 168;                   // coluna dos rótulos
const VX = M + LW, VW = W - LW;   // caixa dos valores
const FIM = PAG.h - M;            // nada passa daqui
const F = { n: 'Helvetica', b: 'Helvetica-Bold' };
const COR = { tinta: '#000000', borda: '#4d4d4d', faixa: '#d9d9d9', suave: '#5a5a5a', caixaLeve: '#f2f2f2' };
const GAP = 5;
const PAD = 5;
const DECLARACAO = 'DECLARO QUE RECEBI TODOS OS ITENS RELACIONADOS ACIMA EM PERFEITAS CONDIÇÕES, INCLUSIVE SEM NENHUMA VIOLAÇÃO DAS EMBALAGENS.';

const novoDocumento = () => new PDFDocument({ size: 'A4', margin: 0, info: { Title: 'Checklist externo - Entregas', Author: 'Elegance' } });

function desenharChecklistEntrega(doc, dados, { logo, geradoEm } = {}) {
  const textos = [];
  const d = dados || {};
  const medir = (s, tam, fonte = F.n) => { doc.font(fonte).fontSize(tam); return doc.widthOfString(s); };
  // escreve UMA linha em posição fixa (sem quebra automática: nunca cria página)
  const escrever = (s, x, y, { fonte = F.n, tam = 10, cor = COR.tinta, alinhar = 'left', largura = 0 } = {}) => {
    const txt = String(s ?? '');
    if (!txt) return;
    doc.font(fonte).fontSize(tam).fillColor(cor);
    let px = x;
    if (alinhar !== 'left' && largura) {
      const w = doc.widthOfString(txt);
      px = alinhar === 'center' ? x + (largura - w) / 2 : x + largura - w;
    }
    doc.text(txt, px, y, { lineBreak: false });
    textos.push(txt);
  };
  const caixa = (x, y, w, h, { fundo = null, borda = COR.borda } = {}) => {
    doc.save().lineWidth(0.8);
    if (fundo) doc.rect(x, y, w, h).fillAndStroke(fundo, borda); else doc.rect(x, y, w, h).strokeColor(borda).stroke();
    doc.restore();
  };
  const rotulo = (s, y, h, { tam = 9.5 } = {}) => escrever(s, M, y + (h - tam) / 2 + 1, { fonte: F.b, tam });
  const campo = (chave, multi = false) => textoPdf(d[chave], { multilinha: multi });

  let y = M;
  // ---- cabeçalho: logo à esquerda, título centralizado ----
  try {
    const arq = logo === undefined ? LOGO : logo;
    if (arq && (typeof arq !== 'string' || fs.existsSync(arq))) doc.image(arq, M, y, { fit: [150, 54] });
  } catch { /* sem logo, a folha continua */ }
  escrever('CHECKLIST EXTERNO', M, y + 8, { fonte: F.b, tam: 21, alinhar: 'center', largura: W });
  escrever('ENTREGAS', M, y + 34, { fonte: F.b, tam: 13, alinhar: 'center', largura: W });
  y += 64;

  // ---- linhas rótulo | valor ----
  const ALT = 23;
  // linha de uma só linha de texto: a fonte diminui até caber; se nem assim, corta com "..."
  function linhaSimples(rot, valor, { negrito = false, extra = '' } = {}) {
    caixa(VX, y, VW, ALT);
    rotulo(rot, y, ALT);
    const larg = VW - 2 * PAD - (extra ? medir(extra, 8) + 8 : 0);
    if (valor) {
      const a = ajustarTexto(valor, larg, (s, tam) => medir(s, tam, negrito ? F.b : F.n), { tamanhos: [11, 10, 9, 8], maxLinhas: 1 });
      escrever(a.linhas[0], VX + PAD, y + (ALT - a.tamanho) / 2 + 1, { fonte: negrito ? F.b : F.n, tam: a.tamanho });
    }
    if (extra) escrever(extra, VX, y + (ALT - 8) / 2 + 1, { tam: 8, cor: COR.suave, alinhar: 'right', largura: VW - PAD });
    y += ALT + GAP;
  }

  // data de entrega + dia da semana por extenso
  caixa(VX, y, VW, ALT);
  rotulo('DATA DE ENTREGA:', y, ALT);
  const data = dataBR(d.dataEntrega);
  if (data) {
    escrever(data, VX + PAD, y + (ALT - 11) / 2 + 1, { fonte: F.n, tam: 11 });
    escrever(diaDaSemana(d.dataEntrega), VX + PAD + medir(data, 11) + 18, y + (ALT - 11) / 2 + 1, { fonte: F.b, tam: 11 });
  }
  y += ALT + GAP;
  linhaSimples('PEDIDO:', campo('pedido'), { negrito: true, extra: textoPdf(d.entregaRotulo) });
  linhaSimples('CLIENTE:', campo('cliente'));
  linhaSimples('CLIENTE FINAL:', campo('clienteFinal'));

  // endereço: até 4 linhas, a fonte diminui antes de cortar
  {
    const txt = campo('endereco', true);
    const a = txt ? ajustarTexto(txt, VW - 2 * PAD, (s, tam) => medir(s, tam), { tamanhos: [11, 10, 9, 8], maxLinhas: 4 }) : { tamanho: 11, linhas: [] };
    const lh = a.tamanho * 1.22;
    const h = Math.max(ALT, a.linhas.length * lh + 2 * PAD - 1);
    caixa(VX, y, VW, h);
    escrever('ENDEREÇO:', M, y + (ALT - 9.5) / 2 + 1, { fonte: F.b, tam: 9.5 });
    a.linhas.forEach((l, k) => escrever(l, VX + PAD, y + PAD + k * lh, { tam: a.tamanho }));
    y += h + GAP;
  }

  // observações de entrega + "Qualquer dúvida entrar em contato com :" e o contato no local
  {
    escrever('OBSERVAÇÕES DE ENTREGA:', M, y + 2, { fonte: F.b, tam: 9.5 });
    y += 15;
    const obs = campo('observacoes', true);
    const a = obs ? ajustarTexto(obs, W - 2 * PAD, (s, tam) => medir(s, tam), { tamanhos: [10, 9, 8], maxLinhas: 4 }) : { tamanho: 10, linhas: [] };
    const lh = a.tamanho * 1.22;
    const prefixo = 'Qualquer dúvida entrar em contato com : ';
    const contato = campo('contato');
    const larguraPrefixo = medir(prefixo, 9.5, F.b);
    const c = contato ? ajustarTexto(contato, W - 2 * PAD - larguraPrefixo, (s, tam) => medir(s, tam, F.b), { tamanhos: [9.5, 8.5, 8], maxLinhas: 1 }) : null;
    const hObs = Math.max(a.linhas.length ? a.linhas.length * lh : 0, d.branco || !obs ? 26 : 0);
    const h = PAD + hObs + 4 + 14 + PAD - 2;
    caixa(M, y, W, h);
    a.linhas.forEach((l, k) => escrever(l, M + PAD, y + PAD + k * lh, { tam: a.tamanho }));
    const yc = y + PAD + hObs + 4;
    escrever(prefixo.trim(), M + PAD, yc, { fonte: F.b, tam: 9.5 });
    if (c) escrever(c.linhas[0], M + PAD + larguraPrefixo, yc + (9.5 - c.tamanho) / 2, { fonte: F.b, tam: c.tamanho });
    y += h + GAP + 3;
  }

  // faixa cinza MOTORISTA com o nome
  {
    const h = 24;
    caixa(M, y, W, h, { fundo: COR.faixa });
    escrever('MOTORISTA', M + PAD, y + (h - 11) / 2 + 1, { fonte: F.b, tam: 11 });
    const nome = campo('motorista');
    if (nome) {
      const a = ajustarTexto(nome, VW - 2 * PAD, (s, tam) => medir(s, tam, F.b), { tamanhos: [11, 10, 9, 8], maxLinhas: 1 });
      escrever(a.linhas[0], VX + PAD, y + (h - a.tamanho) / 2 + 1, { fonte: F.b, tam: a.tamanho });
    }
    y += h + GAP + 3;
  }

  // conferências à mão: caixinha de itens (com o esperado ao lado) e de volumes
  {
    const lx = M + 230, bw = 64;
    const conferir = (rot, esperado) => {
      caixa(lx, y, bw, ALT);
      escrever(rot, M, y + (ALT - 9.5) / 2 + 1, { fonte: F.b, tam: 9.5 });
      if (esperado) escrever(esperado, lx + bw + 8, y + (ALT - 8.5) / 2 + 1, { tam: 8.5, cor: COR.suave });
      y += ALT + GAP;
    };
    const esp = d.qtdItensEsperada !== null && d.qtdItensEsperada !== undefined && Number(d.qtdItensEsperada) > 0 ? `(esperado: ${qtdTexto(d.qtdItensEsperada)})` : '';
    conferir('CONFERIDO QUANTIDADE DE ITENS:', esp);
    conferir('CONFERIDO QUANTIDADE DE VOLUMES:', '');
  }

  // ---- parte de baixo (posição fixa a partir do fim da página): recebimento, declaração e assinatura ----
  const ALT_REC = 24;
  const dec = quebrarLinhas(textoPdf(DECLARACAO), W, s => medir(s, 9.5, F.b));
  const hDec = dec.length * 12;
  const hAss = 30;
  const hRodape = 12;
  const yRodape = FIM - 8;
  const yAss = yRodape - hRodape - hAss + 8;
  const yDec = yAss - 10 - hDec;
  const yRec = yDec - 10 - 3 * (ALT_REC + GAP) + GAP;

  // ---- miolo variável: itens da entrega (só se couber) e a caixa de observações gerais (o que sobrar) ----
  const MIN_OBS = 58;
  const espaco = yRec - 10 - y;                       // entre as conferências e o recebimento
  const obsGerais = campo('observacoesGerais', true);
  const itens = Array.isArray(d.itens) ? d.itens : [];
  let linhasItens = [];
  if (itens.length) {
    const brutas = itens.map(i => textoPdf(linhaItem(i)));
    const larg = W - 2 * PAD;
    for (const b of brutas) linhasItens.push(...ajustarTexto(b, larg, (s, tam) => medir(s, tam), { tamanhos: [8], maxLinhas: 1 }).linhas);
    const lhI = 10;
    const cabem = Math.max(0, Math.floor((espaco - MIN_OBS - 15 - 14 - 2 * PAD - 8) / lhI));
    if (cabem < 1) linhasItens = [];
    else if (linhasItens.length > Math.min(cabem, 12)) {
      const n = Math.max(1, Math.min(cabem, 12) - 1);
      const resto = linhasItens.length - n;
      linhasItens = [...linhasItens.slice(0, n), `... e mais ${resto} ${resto === 1 ? 'item' : 'itens'} (ver o pedido)`];
    }
  }
  if (linhasItens.length) {
    escrever('ITENS DA ENTREGA', M, y + 1, { fonte: F.b, tam: 8, cor: COR.suave });
    y += 12;
    const h = linhasItens.length * 10 + 2 * PAD - 2;
    caixa(M, y, W, h, { fundo: COR.caixaLeve, borda: '#bdbdbd' });
    linhasItens.forEach((l, k) => escrever(l, M + PAD, y + PAD + k * 10, { tam: 8 }));
    y += h + GAP + 3;
  }

  escrever('OBSERVAÇÕES GERAIS DA ENTREGA:', M, y + 2, { fonte: F.b, tam: 9.5 });
  y += 15;
  {
    const h = Math.max(30, yRec - 10 - y); // a caixa ocupa o que sobrar (o miolo de cima tem altura limitada: nunca passa daqui)
    caixa(M, y, W, h);
    if (obsGerais) {
      const a = ajustarTexto(obsGerais, W - 2 * PAD, (s, tam) => medir(s, tam), { tamanhos: [10, 9, 8], maxLinhas: tam => (h - 2 * PAD) / (tam * 1.22) });
      a.linhas.forEach((l, k) => escrever(l, M + PAD, y + PAD + k * a.tamanho * 1.22, { tam: a.tamanho }));
    }
  }

  // recebimento (à mão)
  let yr = yRec;
  for (const r of ['DATA DE RECEBIMENTO:', 'RECEBIDO POR :', 'DOCUMENTO:']) {
    caixa(VX, yr, VW, ALT_REC);
    rotulo(r, yr, ALT_REC);
    yr += ALT_REC + GAP;
  }
  dec.forEach((l, k) => escrever(l, M, yDec + k * 12, { fonte: F.b, tam: 9.5, alinhar: 'center', largura: W }));
  escrever('ASSINATURA:', M, yAss + hAss - 14, { fonte: F.b, tam: 9.5 });
  doc.save().lineWidth(0.8).strokeColor(COR.tinta).moveTo(VX, yAss + hAss - 4).lineTo(M + W, yAss + hAss - 4).stroke().restore();
  if (geradoEm) escrever(textoPdf(`Gerado pelo sistema em ${geradoEm}${d.editado ? ' (editado pela equipe)' : ''}`), M, yRodape, { tam: 6.5, cor: COR.suave });
  return textos;
}

module.exports = { desenharChecklistEntrega, novoDocumento, DECLARACAO, LOGO };
