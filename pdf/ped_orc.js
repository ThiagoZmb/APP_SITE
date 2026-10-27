// ============================================================
// PDF do Pedido / Orçamento / Guia de Produção — fiel ao VB:
// Modulo_Pedido_Orçamento.Gerar_PDF_PedOrc(tipoDoc, modoProducao) (iTextSharp).
// Medidas do iText reproduzidas: A4, margens 10, borda 0,5, padding 2 nas células,
// célula de texto com entrelinha = tamanho da fonte, parágrafo com 1,5 × tamanho,
// fonte "Arial" do VB = Helvetica (o iText cai na Helvetica quando a Arial não está registrada).
// A parte de texto (descrição de cada item, formatos de número/data) é pura e testada.
// ============================================================
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const LOGO_PADRAO = path.join(__dirname, '..', 'imagens', 'logo_elegance.png');
const MARGEM = 10, PAD = 2, BORDA = 0.5;
const FONTE = { normal: 'Helvetica', negrito: 'Helvetica-Bold', sublinhado: 'Helvetica' };
const EMPRESA = 'Elegance Indústria e Comércio de Artefatos de Alumínio LTDA/Me';
const CONTATO = 'Tel: (27) 3326-7213 / E-mail: elegance@elegancealuminio.com.br';
const VALIDADE = 'Este orçamento têm validade de 10DD á partir da data discriminada acima';

// ---------------- leitura no formato do VB ----------------

// PDF_LerColuna: Nothing/DBNull → "", senão ToString() (cultura pt-BR: decimal com vírgula).
// O mysql2 devolve DECIMAL como texto "2286.00"; o VB mostraria "2286,00".
function textoVB(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return String(v).replace('.', ',');
  const s = String(v);
  return /^-?\d+\.\d+$/.test(s) ? s.replace('.', ',') : s;
}

// PDF_LerDecimal: aceita "1.234,56" (pt-BR) e "1234.56" (banco)
function lerDecimal(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const s = String(v ?? '').trim();
  if (!s) return 0;
  const n = s.includes(',') ? parseFloat(s.replace(/\./g, '').replace(',', '.')) : parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

const milhar = (n, casas) => {
  const [i, d] = Math.abs(n).toFixed(casas).split('.');
  return i.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + (casas ? ',' + d : '');
};
// ToString("N2", pt-BR)
const numeroBR = (v, casas = 2) => { const n = lerDecimal(v); return (n < 0 ? '-' : '') + milhar(n, casas); };
// ToString("C2", pt-BR): "R$ 1.234,56" / "-R$ 1,00"
const moedaBR = v => { const n = lerDecimal(v); return (n < 0 ? '-' : '') + 'R$ ' + milhar(n, 2); };

// PDF_FormatarQuantidade: 2,00 → "2" | 2,26 → "2,26"
const formatarQuantidade = v => { const n = lerDecimal(v); return n === Math.trunc(n) ? String(n) : numeroBR(n, 2); };

// PDF_FormatarData (coluna DATA): data → dd/MM/yyyy; o que não for data sai como está
function dataVB(v) {
  const t = String(v ?? '').trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(t);
  if (m) return `${m[1].padStart(2, '0')}/${m[2].padStart(2, '0')}/${m[3]}`;
  return t;
}

// DATA_PRONTO: o VB imprime o DateTime.ToString() cru → "05/10/2026 00:00:00";
// coluna em texto ("dd/mm/aaaa", herança do VB) sai como está
function dataHoraVB(v) {
  const t = String(v ?? '').trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(t);
  if (!m) return t;
  return `${m[3]}/${m[2]}/${m[1]} ${m[4] || '00'}:${m[5] || '00'}:${m[6] || '00'}`;
}

// agrupa as linhas por item (PDF_AgruparPorColuna)
function agruparPor(rows, col) {
  const m = {};
  (rows || []).forEach(r => { const k = String(r[col] ?? '').trim(); (m[k] = m[k] || []).push(r); });
  return m;
}

// Blocos de furação por folha (bloco 11b do VB): FURO = 1 abre um bloco novo (LADO + 1 furo);
// os demais somam no bloco aberto; FURO nulo é ignorado. As linhas chegam ORDER BY id.
function blocosDeFuros(furos) {
  const blocos = [];
  for (const f of furos || []) {
    if (f.FURO === null || f.FURO === undefined || String(f.FURO).trim() === '') continue;
    if (Number(f.FURO) === 1) blocos.push({ lado: String(f.LADO ?? '').trim(), qtd: 1 });
    else if (blocos.length) blocos[blocos.length - 1].qtd++;
  }
  return blocos;
}

const ladoPorExtenso = lado => {
  const u = String(lado || '').toUpperCase();
  if (u.startsWith('D')) return 'direita';
  if (u.startsWith('S')) return 'superior';
  if (u.startsWith('I')) return 'inferior';
  return 'esquerda';
};

// Texto da coluna Descrição de um item (bloco 11 do VB), linha a linha.
// estilo: 'negrito' (fonteCelula), 'normal' (fonteNormal), 'sublinhado' (fonteSublinhada); todas Arial 7.
// grupos = { v4, complementos, serralheria, compSerralheria, furos } já filtrados para o item.
function descricaoItem(tipoProduto, grupos = {}) {
  const L = [];
  const add = (texto, estilo) => L.push({ texto, estilo });
  const v4 = grupos.v4 || [];
  const blocos = blocosDeFuros(grupos.furos);
  const furosJaEscritos = new Set();
  let idxFolha = 0;

  if (v4.length) {
    add('Tipo de produto: ' + tipoProduto, 'sublinhado');
    for (const d of v4) {
      idxFolha++;
      const c = nome => textoVB(d[nome]);
      const perfil = c('PERFIL'), acabPerfil = c('ACABAMENTO_PERFIL'), corPerfil = c('COR_PERFIL');
      const revestimento = c('REVESTIMENTO'), corRevest = c('COR_REVESTIMENTO');
      const puxador = c('PUXADOR'), acabPuxador = c('ACABAMENTO_PUXADOR'), corPuxador = c('COR_PUXADOR');
      const qtdPuxador = c('QTD_PUXADOR'), posPuxador = c('POSICAO_PUXADOR'), tamPuxador = c('TAM_PUXADOR');
      const altura = c('ALTURA'), largura = c('LARGURA'), porta = c('PORTA');
      // VB: puxador <> Nothing And qtdPuxador <> Nothing → as duas colunas não vazias (sem Trim)
      const temPuxador = puxador !== '' && qtdPuxador !== '';
      const linhaPerfil = 'Perfil: ' + perfil + ' ' + acabPerfil + (corPerfil !== '' ? ' | Cor: ' + corPerfil : '');

      if (tipoProduto === 'Porta de giro' || tipoProduto === 'Porta basculante' || tipoProduto === 'Frente de gaveta') {
        add(' ', 'negrito');
        add(linhaPerfil, 'negrito');
        // acabamento_revestimentoPDF é uma variável global que o Gerar_PDF_PedOrc nunca preenche → vazia
        if (revestimento !== '') add('Revestimento: ' + revestimento + ' ' + (corRevest !== '' ? '(' + corRevest + ')' : ''), 'normal');
        if (temPuxador) {
          add('Puxador: ' + qtdPuxador + ' - ' + puxador + ' ' + acabPuxador, 'negrito');
          add('Posição: ' + posPuxador + '   |   Tamanho: ' + tamPuxador + ' mm', 'negrito');
        }
        add(' ', 'negrito');
        add('Tamanho: ' + altura + ' x ' + largura, 'sublinhado');
        // furação desta folha (o "fallback" do VB usa qtd_furosPDF, que nunca é preenchida nesse procedimento)
        if (!furosJaEscritos.has(idxFolha) && idxFolha <= blocos.length) {
          furosJaEscritos.add(idxFolha);
          const b = blocos[idxFolha - 1];
          add('Porta ' + ladoPorExtenso(b.lado) + ': ' + b.qtd + ' furos', 'negrito');
        }
        add(' ', 'negrito');
      }

      if (tipoProduto === 'Porta de correr') {
        if (porta === 'Folha 1') {
          add(' ', 'negrito');
          add(linhaPerfil, 'negrito');
          if (revestimento !== '') add('Revestimento: ' + revestimento + (corRevest !== '' ? '(' + corRevest + ')' : ''), 'negrito');
          add(' ', 'negrito');
          add(porta + ': H = ' + altura + ' x L = ' + largura + ' mm', 'sublinhado');
          if (temPuxador) {
            add('Puxador: ' + qtdPuxador + ' - ' + puxador + ' ' + corPuxador, 'normal');
            add('Posição: ' + posPuxador, 'normal');
            add('Tamanho: ' + tamPuxador + ' mm', 'normal');
          }
        } else {
          add(' ', 'negrito');
          add(porta + ': H = ' + altura + ' x L = ' + largura + ' mm', 'sublinhado');
          if (temPuxador) {
            add('Puxador: ' + qtdPuxador + ' - ' + puxador + ' ' + corPuxador, 'normal');
            add('Posição: ' + posPuxador, 'normal');
            add('Tamanho: ' + tamPuxador + ' mm', 'normal');
          }
          add(' ', 'negrito');
        }
      }

      if (tipoProduto === 'Serviço') {
        add(' ', 'negrito'); add('Serviço: ' + perfil, 'negrito'); add(' ', 'negrito');
      }
      if (tipoProduto === 'Perfil' || tipoProduto === 'Puxador' || tipoProduto === 'Trilhos') {
        const rot = tipoProduto === 'Trilhos' ? 'Trilho' : tipoProduto;
        add(' ', 'negrito');
        add(rot + ': ' + perfil + ' ' + acabPerfil + ' - COR: ' + corPerfil, 'negrito');
        add('Tamanho: ' + altura + ' mm', 'negrito');
        add(' ', 'negrito');
      }
      if (tipoProduto === 'Revestimento') {
        add(' ', 'negrito');
        add('Revestimento: ' + revestimento + (corRevest !== '' ? ' - COR: ' + corRevest : ''), 'negrito');
        add('Tamanho: ' + altura + ' x ' + largura + ' mm', 'negrito');
        add(' ', 'negrito');
      }
    }
  }

  // complementos (ped_orc_complementos): qualquer tipo de item
  if ((grupos.complementos || []).length) {
    add('Complementos: ', 'normal');
    for (const r of grupos.complementos) add(textoVB(r.QTD) + ' - ' + textoVB(r.COMPLEMENTO), 'normal');
  }

  // serralheria (bloco 11d): só quando o item é "Metalons"
  if (tipoProduto === 'Metalons' && (grupos.serralheria || []).length) {
    for (const m of grupos.serralheria) {
      add('Produto: ' + textoVB(m.PRODUTO), 'sublinhado');
      add('Material: ' + textoVB(m.MATERIAL), 'normal');
      add('Acabamento: ' + textoVB(m.ACABAMENTO), 'normal');
      add('Cor: ' + textoVB(m.COR), 'normal');
      add('Tamanho: H=' + textoVB(m.ALTURA) + ' x L=' + textoVB(m.LARGURA) + ' x P=' + textoVB(m.PROFUNDIDADE), 'normal');
      add(' ', 'normal');
    }
    for (const cs of grupos.compSerralheria || []) {
      add(' ', 'normal');
      add('Complementos: ', 'normal');
      add(formatarQuantidade(cs.QUANTIDADE) + ' - ' + textoVB(cs.DESCRICAO), 'normal');
    }
  }
  return L;
}

// Colunas da tabela de itens (SetWidths do VB). Sem Unitário/Total = layout da Guia de Produção,
// usado também para quem não tem valores.ver.
function colunasPdf(comValores, W = 1) {
  const pesos = comValores ? [2, 2, 7, 21, 11, 5, 5] : [2, 2, 7, 21, 11];
  const rotulos = ['Item', 'Qtd', 'Imagem', 'Descrição', 'Observação', 'Unitário', 'Total'];
  const alinhar = ['left', 'left', 'center', 'left', 'center', 'left', 'center'];
  const soma = pesos.reduce((s, p) => s + p, 0);
  return pesos.map((p, i) => ({ label: rotulos[i], w: W * p / soma, align: alinhar[i] }));
}

// ---------------- desenho (motor mínimo de tabelas no jeito do iText) ----------------

// quebra de linha do iText: quebra em espaço ou depois de hífen; espaços do fim da linha não contam
function quebrar(doc, texto, fonte, tamanho, largura) {
  doc.font(fonte).fontSize(tamanho);
  const larg = s => doc.widthOfString(s);
  const linhas = [];
  for (const par of String(texto).split(/\r\n|\r|\n/)) {
    const pedacos = par.match(/[^\s-]*-+|[^\s-]+|\s+/g) || [];
    let atual = '';
    for (const p of pedacos) {
      if (/^\s+$/.test(p)) { atual += p; continue; }
      if (larg(atual + p) <= largura) { atual += p; continue; }
      if (atual.trim() !== '') { linhas.push(atual.replace(/\s+$/, '')); atual = ''; }
      let palavra = p;
      while (larg(palavra) > largura && palavra.length > 1) {
        let k = palavra.length - 1;
        while (k > 1 && larg(palavra.slice(0, k)) > largura) k--;
        linhas.push(palavra.slice(0, k));
        palavra = palavra.slice(k);
      }
      atual = (atual.trim() === '' ? atual : '') + palavra;
      if (larg(atual) > largura) atual = palavra;
    }
    linhas.push(atual.replace(/\s+$/, ''));
  }
  return linhas;
}

// Célula: { texto, estilo, tamanho } (modo texto do iText: entrelinha = tamanho)
//      ou { paragrafos: [{ texto, estilo, tamanho }] } (AddElement: entrelinha = 1,5 × tamanho)
//      ou { imagem } ; opcionais: alinhar ('left'|'center'|'right'), vertical ('top'|'middle')
// Imagem contida na caixa: cabe inteira na largura e (se houver) na altura máxima, mantendo a proporção
function ajustarImagem(w, h, larguraInterna, maxAltura = Infinity) {
  const esc = Math.min(larguraInterna / w, maxAltura / h);
  return { w: w * esc, h: h * esc };
}

function montarCelula(doc, cel, largura) {
  const interna = largura - 2 * PAD;
  const base = { alinhar: cel.alinhar || 'left', vertical: cel.vertical || 'top', fundo: cel.fundo || null, linhas: [] };
  if (cel.imagem) {
    const { w, h } = ajustarImagem(cel.imagem.width, cel.imagem.height, interna, cel.maxAltura);
    return { ...base, imagem: { obj: cel.imagem, w, h, dx: (interna - w) / 2 }, altura: h + 2 * PAD };
  }
  const pars = cel.paragrafos
    ? cel.paragrafos.map(p => ({ ...p, entrelinha: 1.5 * p.tamanho }))
    : (String(cel.texto ?? '') === '' ? [] : [{ texto: String(cel.texto), estilo: cel.estilo, tamanho: cel.tamanho, entrelinha: cel.tamanho }]);
  let y = PAD;
  for (const p of pars) {
    for (const t of quebrar(doc, p.texto, FONTE[p.estilo], p.tamanho, interna)) {
      y += p.entrelinha;
      base.linhas.push({ texto: t, estilo: p.estilo, tamanho: p.tamanho, base: y });
    }
  }
  // célula de texto vazia não ocupa altura (no PDF do VB a "Observação" vazia não abre uma linha a mais)
  return { ...base, altura: pars.length ? y + PAD : 0 };
}

function escrever(ctx, texto, estilo, tamanho, x, baseY) {
  const { doc } = ctx;
  if (texto === '') return;
  doc.font(FONTE[estilo]).fontSize(tamanho).fillColor('black')
     .text(texto, x, baseY, { lineBreak: false, baseline: 'alphabetic' });
  ctx.textos.push(texto);
  if (estilo === 'sublinhado') {
    // sublinhado do iText: espessura 1/15 e posição −1/3 do tamanho da fonte
    // (no pdfkit o y cresce para baixo: abaixo da linha de base = + tamanho/3)
    const w = doc.widthOfString(texto), yLinha = baseY + tamanho / 3;
    doc.save().lineWidth(tamanho / 15).moveTo(x, yLinha).lineTo(x + w, yLinha).stroke().restore();
  }
}

function desenharCelula(ctx, m, x, y, largura, altura) {
  const { doc } = ctx;
  if (m.fundo) doc.save().fillColor(m.fundo).rect(x, y, largura, altura).fill().restore();
  doc.lineWidth(BORDA).rect(x, y, largura, altura).stroke();
  const desloc = m.vertical === 'middle' ? (altura - m.altura) / 2 : 0;
  if (m.imagem) doc.image(m.imagem.obj, x + PAD + (m.imagem.dx || 0), y + PAD + desloc, { width: m.imagem.w, height: m.imagem.h });
  for (const l of m.linhas) {
    doc.font(FONTE[l.estilo]).fontSize(l.tamanho);
    const w = doc.widthOfString(l.texto);
    const interna = largura - 2 * PAD;
    const dx = m.alinhar === 'center' ? (interna - w) / 2 : m.alinhar === 'right' ? interna - w : 0;
    escrever(ctx, l.texto, l.estilo, l.tamanho, x + PAD + dx, y + desloc + l.base);
  }
}

// ctx.margem (opcional) troca a margem da página: o PDF de Vidros do VB usa 2 pt em vez de 10
const margemDe = ctx => ctx.margem ?? MARGEM;
const fimDaPagina = ctx => ctx.doc.page.height - margemDe(ctx);
function novaPagina(ctx) { ctx.doc.addPage({ size: 'A4', margin: margemDe(ctx) }); ctx.y = margemDe(ctx); }

// corta uma linha da tabela que não cabe nem numa página inteira (SplitRows do iText)
function cortarLinha(montadas, disponivel) {
  const limite = disponivel - PAD;
  let corte = 0;
  montadas.forEach(m => m.linhas.forEach(l => { if (l.base <= limite) corte = Math.max(corte, l.base); }));
  if (corte === 0) corte = limite;
  const resto = montadas.map(m => {
    const linhas = m.linhas.filter(l => l.base > corte).map(l => ({ ...l, base: l.base - corte + PAD }));
    const altura = linhas.length ? Math.max(...linhas.map(l => l.base)) + PAD : 2 * PAD;
    return { ...m, vertical: 'top', imagem: null, linhas, altura };
  });
  const parte = montadas.map(m => ({ ...m, vertical: 'top', linhas: m.linhas.filter(l => l.base <= corte) }));
  return [parte, resto];
}

// PdfPTable com WidthPercentage 100: larguras proporcionais aos pesos; cabecalho = HeaderRows 1
// larguraPct < 1: tabela mais estreita que a página, centralizada (WidthPercentage 70 = 0.7)
function tabela(ctx, pesos, linhas, { espacoAntes = 0, cabecalho = null, larguraPct = 1 } = {}) {
  const { doc } = ctx;
  const M = margemDe(ctx);
  const W = (doc.page.width - 2 * M) * larguraPct;
  const X0 = (doc.page.width - W) / 2;
  const soma = pesos.reduce((s, p) => s + p, 0);
  const larguras = pesos.map(p => W * p / soma);
  const montar = linha => linha.map((cel, i) => montarCelula(doc, cel, larguras[i]));
  const desenhar = (montadas, altura) => {
    let x = X0;
    montadas.forEach((m, i) => { desenharCelula(ctx, m, x, ctx.y, larguras[i], altura); x += larguras[i]; });
    ctx.y += altura;
  };
  const cab = cabecalho ? montar(cabecalho) : null;
  const hCab = cab ? Math.max(...cab.map(m => m.altura)) : 0;
  if (ctx.y > M) ctx.y += espacoAntes;
  if (cab) {
    if (ctx.y + hCab > fimDaPagina(ctx)) novaPagina(ctx);
    desenhar(cab, hCab);
  }
  for (const linha of linhas) {
    let montadas = montar(linha);
    let altura = Math.max(...montadas.map(m => m.altura));
    // SplitLate do iText: a linha que não cabe vai inteira para a página seguinte;
    // só é cortada se não couber nem numa página nova
    if (ctx.y + altura > fimDaPagina(ctx) && ctx.y > M + hCab + 0.01) {
      novaPagina(ctx);
      if (cab) desenhar(cab, hCab);
    }
    while (ctx.y + altura > fimDaPagina(ctx)) {
      const disponivel = fimDaPagina(ctx) - ctx.y;
      const [parte, resto] = cortarLinha(montadas, disponivel);
      desenhar(parte, disponivel);
      novaPagina(ctx);
      if (cab) desenhar(cab, hCab);
      montadas = resto;
      altura = Math.max(...montadas.map(m => m.altura));
    }
    desenhar(montadas, altura);
  }
}

// Paragraph do iText alinhado à direita (totais): entrelinha 1,5 × tamanho
function paragrafoDireita(ctx, texto, estilo, tamanho) {
  const { doc } = ctx;
  const W = doc.page.width - 2 * MARGEM;
  for (const t of quebrar(doc, texto, FONTE[estilo], tamanho, W)) {
    const entrelinha = 1.5 * tamanho;
    if (ctx.y + entrelinha > fimDaPagina(ctx)) novaPagina(ctx);
    ctx.y += entrelinha;
    doc.font(FONTE[estilo]).fontSize(tamanho);
    escrever(ctx, t, estilo, tamanho, MARGEM + W - doc.widthOfString(t), ctx.y);
  }
}

function carregarLogo(doc, logo) {
  try {
    if (logo === false) return null;
    const arq = logo || LOGO_PADRAO;
    if (typeof arq === 'string' && !fs.existsSync(arq)) return null;
    return doc.openImage(arq);
  } catch { return null; }
}

// Desenho da porta (PNG capturado na configuração) na coluna Imagem; sem desenho, ou com bytes que não abrem como imagem, a célula fica vazia
const ALTURA_MAX_DESENHO = 170;
function imagemDoItem(doc, png) {
  if (!png) return { texto: '' };
  try { return { imagem: doc.openImage(png), maxAltura: ALTURA_MAX_DESENHO, alinhar: 'center', vertical: 'middle' }; }
  catch { return { texto: '' }; }
}

// dados = { tipo, numero, cab, itens, v4, complementos, serralheria, compSerralheria, furos, medicao, desenhos: { [item]: Buffer PNG } }
// opcoes = { verValores, producao, logo }  → devolve a lista de textos escritos (para os testes)
function desenharPedOrc(doc, dados, { verValores = false, producao = false, logo } = {}) {
  const ctx = { doc, y: MARGEM, textos: [] };
  const { tipo, numero, cab = {} } = dados;
  const ehPedido = tipo === 'Pedido';
  const comPrecos = !producao && verValores;
  const negrito9 = texto => ({ texto, estilo: 'negrito', tamanho: 9 });

  // BLOCO 7 — cabeçalho: logo | empresa + contato (ou "Guia de Produção") | número
  const img = carregarLogo(doc, logo);
  const centro = producao
    ? { texto: 'Guia de Produção', estilo: 'negrito', tamanho: 24, alinhar: 'center', vertical: 'middle' }
    : { texto: EMPRESA + '\n' + CONTATO, estilo: 'normal', tamanho: 12, alinhar: 'center', vertical: 'middle' };
  tabela(ctx, [22, 28, 7], [[
    img ? { imagem: img } : { texto: '' },
    centro,
    { texto: (ehPedido ? 'Pedido n°:' : 'Orçamento n°:') + numero, estilo: 'negrito', tamanho: 12, alinhar: 'center' }
  ]]);

  // BLOCO 8 — cliente / datas
  tabela(ctx, [55, 20], [[negrito9('Cliente: ' + textoVB(cab.RAZAO_SOCIAL)),
    negrito9((ehPedido ? 'Data do pedido: ' : 'Data do orçamento: ') + dataVB(cab.DATA))]], { espacoAntes: 10 });
  tabela(ctx, [55, 20], [[negrito9('Cliente Final: ' + textoVB(cab.CLIENTE_FINAL)),
    negrito9('Pronto em: ' + dataHoraVB(cab.DATA_PRONTO))]]);

  // BLOCO 9 — medição (só Guia) e validade (só Orçamento)
  if (producao && textoVB(dados.medicao) !== '') tabela(ctx, [1], [[negrito9('Medição: ' + textoVB(dados.medicao))]]);
  if (!ehPedido && !producao) tabela(ctx, [100], [[negrito9(VALIDADE)]], { espacoAntes: 10 });

  // BLOCO 10/11 — itens
  const cols = colunasPdf(comPrecos);
  const cel7 = (texto, alinhar) => ({ texto, estilo: 'negrito', tamanho: 7, alinhar });
  const cabecalho = cols.map(c => ({ ...cel7(c.label, c.align), vertical: c.label === 'Imagem' ? 'middle' : 'top' }));
  const g = {
    v4: agruparPor(dados.v4, 'ITEM_PEDIDO'), complementos: agruparPor(dados.complementos, 'ITEM_PEDIDO'),
    serralheria: agruparPor(dados.serralheria, 'ITEM_PEDIDO'), compSerralheria: agruparPor(dados.compSerralheria, 'ITEM_PEDIDO'),
    furos: agruparPor(dados.furos, 'ITEM')
  };
  const linhas = (dados.itens || []).map(it => {
    const id = String(it.ITEM ?? '').trim();
    const desc = descricaoItem(textoVB(it.TIPO_PRODUTO), {
      v4: g.v4[id], complementos: g.complementos[id], serralheria: g.serralheria[id],
      compSerralheria: g.compSerralheria[id], furos: g.furos[id]
    });
    const linha = [cel7(textoVB(it.ITEM)), cel7(textoVB(it.QTD)), imagemDoItem(doc, dados.desenhos?.[Number(id)]),
      { paragrafos: desc.map(l => ({ ...l, tamanho: 7 })) }, cel7(textoVB(it.OBSERVACAO))];
    if (comPrecos) linha.push(cel7(moedaBR(it.UNITARIO)), cel7(moedaBR(it.TOTAL)));
    return linha;
  });
  tabela(ctx, cols.map(c => c.w), linhas, { espacoAntes: 15, cabecalho });

  // BLOCO 12 — observação geral
  tabela(ctx, [1], [[{ ...negrito9('Observação:'), alinhar: 'center', vertical: 'middle' }]]);
  tabela(ctx, [1], [[negrito9(textoVB(cab.OBS_GERAL))]]);

  // BLOCO 13 — totais (fora da Guia e só para quem vê valores)
  if (comPrecos) {
    paragrafoDireita(ctx, 'Subtotal: ' + moedaBR(cab.SUB_TOTAL), 'negrito', 9);
    paragrafoDireita(ctx, 'Desconto: ' + numeroBR(cab.DESCONTO, 2) + ' %', 'negrito', 9);
    paragrafoDireita(ctx, 'Total: ' + moedaBR(cab.TOTAL), 'negrito', 9);
  }
  return ctx.textos;
}

// PDF de Vidros do VB (Modulo_Pedido_Orçamento.Gerar_PDF_Vidros): A4, margem 2, Arial 9 negrito, três tabelas com 70% da largura:
// "Medição / Nº Pedido" (cinza), uma linha em branco e Item | Qtd | Vidro | Cor | Tamanho (cabeçalho cinza, sem repetir nas páginas seguintes).
// Não calcula nada: imprime o que ProcessarPortasNoBanco gravou na tabela `vidros` ao salvar o pedido.
// dados = { numero, medicao, linhas: [{ ITEM, QTD, MODELO, COR_REVESTIMENTO, TAMANHO }] } → devolve a lista de textos escritos
const CINZA_VB = '#cccccc';   // o VB escreve "#ccccccc" (7 dígitos, provável erro de digitação)
function desenharVidros(doc, { numero, medicao, linhas }) {
  const ctx = { doc, y: 2, textos: [], margem: 2 };
  const c = (texto, extra = {}) => ({ texto, estilo: 'negrito', tamanho: 9, ...extra });
  const opc = { larguraPct: 0.7 };
  tabela(ctx, [5.5, 1], [[c('Medição: ' + (medicao ?? ''), { fundo: CINZA_VB }), c(' Nº Pedido: ' + numero, { fundo: CINZA_VB })]], opc);
  tabela(ctx, [1], [[c(' ')]], opc);
  const cab = ['Item', 'Qtd ', 'Vidro ', 'Cor ', 'Tamanho '].map(t => c(t, { fundo: CINZA_VB }));
  const corpo = linhas.map(l => [l.ITEM, l.QTD, l.MODELO, l.COR_REVESTIMENTO, l.TAMANHO].map(v => c(String(v ?? ''))));
  tabela(ctx, [1, 1, 5, 4, 2], [cab, ...corpo], opc);
  return ctx.textos;
}

const novoDocumento = (extra = {}) => new PDFDocument({ size: 'A4', margin: MARGEM, ...extra });

// Pasta e nome do arquivo como no VB (Module1: pasta_pedidos / pasta_orçamentos / pasta_produção, dentro de "C:\Programa Elegance\";
// Gerar_PDF_PedOrc, BLOCO 4): {nº}_{razão social}.PDF · Guia de Produção: {nº}_{razão social}_P.PDF.
// O VB grava a razão social como está; aqui só saem os caracteres que o Windows não aceita em nome de arquivo.
const nomeSeguroWindows = t => String(t ?? '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').trim().replace(/[. ]+$/, '');
function destinoPdf({ tipo, numero, razaoSocial, producao = false, vidros = false }) {
  const base = `${numero}_${nomeSeguroWindows(razaoSocial)}`;
  if (vidros) return { pasta: 'Vidros_Produção', nome: `${base}_V.PDF` };   // Module1: pasta_vidros; frm_Controle_de_Pedidos: {nº}_{razão}_V.PDF
  if (producao) return { pasta: 'Produção', nome: `${base}_P.PDF` };
  return { pasta: tipo === 'Pedido' ? 'Pedidos(PDF)' : 'Orçamentos(PDF)', nome: `${base}.PDF` };
}

module.exports = {
  desenharPedOrc, desenharVidros, ajustarImagem, novoDocumento, destinoPdf, nomeSeguroWindows, descricaoItem, blocosDeFuros, colunasPdf,
  textoVB, lerDecimal, moedaBR, numeroBR, formatarQuantidade, dataVB, dataHoraVB, quebrar, LOGO_PADRAO
};
