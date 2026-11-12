// Etiqueta de pedido/produção para a Zebra (ZPL), 100 x 60 mm a 203 dpi (8 dots/mm = 800 x 480 dots). Função pura, sem banco.
// Uma etiqueta por item do Pedido. Nenhum campo de dinheiro. Todo texto do banco passa por sanearZpl: ^, ~ e \ são
// caracteres de comando do ZPL, então o conteúdo do pedido nunca pode chegar à impressora com eles.
// Layout (2026-11-12, copiado da etiqueta de referência do dono): logo + "Pedido: N", "Nome: razão social",
// "Cliente: cliente final", "Qtd: n" e o código de barras do nº do pedido. Textos em negrito grande, sem endereço da empresa.
const LOGO = require('./etiqueta_logo'); // bitmap 1-bit gerado por calculo/gerar_logo_zpl.js
const MAX_TEXTO = 60;      // razão social / cliente final (depois do rótulo "Nome: " / "Cliente: ")
const MAX_QTD = 12;
const LARGURA = 800;
const MARGEM = 20;
const AVANCO = 0.6;        // largura média de um caractere da fonte 0 em negrito = AVANCO x altura (estimativa conservadora)

// remove ^ ~ \ e troca caracteres de controle por espaço
function sanearZpl(texto) {
  return String(texto ?? '').replace(/[\^~\\]/g, '').replace(/[\x00-\x1f\x7f]/g, ' ');
}

const limpar = texto => sanearZpl(texto).replace(/\s+/g, ' ').trim();
const larguraEstimada = (texto, altura) => Math.ceil(texto.length * AVANCO * altura);

// quebra em palavras (palavra maior que a linha é partida); devolve as linhas
function quebrar(texto, caracteresPorLinha) {
  const linhas = []; let atual = '';
  for (let palavra of texto.split(' ')) {
    while (palavra.length > caracteresPorLinha) {
      if (atual) { linhas.push(atual); atual = ''; }
      linhas.push(palavra.slice(0, caracteresPorLinha)); palavra = palavra.slice(caracteresPorLinha);
    }
    if (!atual) atual = palavra;
    else if (atual.length + 1 + palavra.length <= caracteresPorLinha) atual += ' ' + palavra;
    else { linhas.push(atual); atual = palavra; }
  }
  if (atual) linhas.push(atual);
  return linhas;
}

// Escolhe tamanho e linhas para caber em larguraMax: uma linha no maior tamanho possível; senão até maxLinhas
// menores; se ainda não couber, trunca com "…" (nunca corta sem aviso).
function ajustar(texto, larguraMax, { uma = [60, 52], varias = [52, 44, 36], maxLinhas = 2 } = {}) {
  for (const h of uma) if (larguraEstimada(texto, h) <= larguraMax) return { altura: h, linhas: [texto] };
  if (maxLinhas > 1) {
    for (const h of varias) {
      const cap = Math.floor(larguraMax / (AVANCO * h));
      const linhas = quebrar(texto, cap);
      if (linhas.length <= maxLinhas) return { altura: h, linhas };
    }
  }
  const h = maxLinhas > 1 ? varias[varias.length - 1] : uma[uma.length - 1];
  const cap = Math.floor(larguraMax / (AVANCO * h));
  const linhas = quebrar(texto, cap);
  if (linhas.length <= maxLinhas) return { altura: h, linhas };
  const corte = linhas.slice(0, maxLinhas);
  const ultima = corte[maxLinhas - 1];
  corte[maxLinhas - 1] = (ultima.length >= cap ? ultima.slice(0, cap - 1) : ultima) + '…';
  return { altura: h, linhas: corte };
}

// negrito simulado: a mesma linha impressa duas vezes, 2 dots deslocada
const negrito = (x, y, altura, texto) =>
  [0, 2].map(d => `^FO${x + d},${y}^A0N,${altura},${altura}^FD${texto}^FS`).join('\n');

function blocoTexto(x, y, texto, larguraMax, opcoes) {
  const { altura, linhas } = ajustar(texto, larguraMax, opcoes);
  return linhas.map((l, i) => negrito(x, y + i * altura, altura, l)).join('\n');
}

// módulos (barras) de um Code 128 só de dígitos no modo automático (^BC...,A): start + dados (Code C) + troca/dígito solto + check + stop
function modulosCode128(digitos) {
  const n = digitos.length;
  const simbolos = Math.floor(n / 2) + (n % 2 ? 2 : 0);
  return 11 * (1 + simbolos + 1) + 13;
}

function codigoDeBarras(num) {
  const largura = 3; // módulo de 3 dots (0,375 mm): legível por leitor comum
  const total = modulosCode128(num) * largura;
  const x = Math.max(LARGURA / 2, LARGURA - 3 * 10 - total); // encosta à direita, deixando zona de silêncio de 10 módulos
  return `^FO${x},368^BY${largura},3,80^BCN,80,N,N,N,A^FD${num}^FS`;
}

const logo = () => [
  '^FO14,14^GB240,94,3,B,3^FS', // caixa arredondada em volta do logo
  `^FO22,20^GFA,${LOGO.bytesPorLinha * LOGO.altura},${LOGO.bytesPorLinha * LOGO.altura},${LOGO.bytesPorLinha},${LOGO.hex}^FS`
].join('\n');

// dados = { numero, cliente (razão social), clienteFinal, itens: [{ ITEM, QTD }] }  →  { zpl, quantidade }
function montarEtiquetas({ numero, cliente, clienteFinal, itens }) {
  const lista = itens || [];
  const num = String(numero ?? '').replace(/\D/g, '');
  const nome = limpar(cliente).slice(0, MAX_TEXTO) || '—';
  const final = limpar(clienteFinal).slice(0, MAX_TEXTO) || '—';
  const util = LARGURA - 2 * MARGEM;
  const blocos = lista.map(it => {
    const qtd = limpar(it.QTD).slice(0, MAX_QTD) || '1';
    return [
      '^XA^CI28^PW800^LL480',
      logo(),
      blocoTexto(272, 30, `Pedido: ${num}`, LARGURA - 272 - MARGEM, { uma: [64, 56, 48, 40, 32], maxLinhas: 1 }),
      blocoTexto(MARGEM, 120, `Nome: ${nome}`, util),
      blocoTexto(MARGEM, 240, `Cliente: ${final}`, util),
      blocoTexto(MARGEM, 368, `Qtd: ${qtd}`, 330, { uma: [64, 56, 48, 40, 32], maxLinhas: 1 }),
      codigoDeBarras(num),
      '^XZ'
    ].join('\n');
  });
  return { zpl: blocos.join('\n'), quantidade: lista.length };
}

module.exports = { sanearZpl, montarEtiquetas };
