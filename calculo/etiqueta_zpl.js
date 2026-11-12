// Etiqueta de pedido/produção para a Zebra (ZPL), 100 x 60 mm a 203 dpi (8 dots/mm = 800 x 480 dots). Função pura, sem banco.
// Uma etiqueta por item do Pedido. Nenhum campo de dinheiro. Todo texto do banco ou digitado passa por sanearZpl: ^, ~ e \ são
// caracteres de comando do ZPL, então o conteúdo do pedido nunca pode chegar à impressora com eles.
// Layout (2026-11-12): logo + "Pedido: N", "Nome: razão social", "Cliente: cliente final", [Medidas: ...], "Qtd: n", [Destino: UF]
// e o código de barras do nº do pedido. Nome, Cliente e Medidas SEMPRE numa linha só (fonte menor até 36; depois trunca com "...").
// Os rótulos "Nome:", "Cliente:", "Qtd:", "Medidas:" e "Destino:" saem sublinhados (ZPL não tem sublinhado de fonte: um filete ^GB
// logo abaixo do rótulo). Campos vazios (medidas, destino) não imprimem linha nem rótulo.
const LOGO = require('./etiqueta_logo'); // bitmap 1-bit gerado por calculo/gerar_logo_zpl.js
const MAX_TEXTO = 200;     // teto de entrada (razão social / cliente final); o que não couber na linha é truncado com "..."
const MAX_QTD = 12;
const LARGURA = 800;
const MARGEM = 20;
const AVANCO = 0.6;        // largura média de um caractere da fonte 0 em negrito = AVANCO x altura (estimativa conservadora)
const AVANCO_ROTULO = 0.55; // idem para o comprimento do filete do rótulo (um pouco menor, para não passar muito do ":")
const MIN_FONTE = 36;      // menor altura de Nome/Cliente/Medidas; abaixo disso trunca com "..."
const Y = { nome: 120, cliente: 200, medidas: 278, qtd: 348, destino: 424 };

// remove ^ ~ \ e troca caracteres de controle por espaço
function sanearZpl(texto) {
  return String(texto ?? '').replace(/[\^~\\]/g, '').replace(/[\x00-\x1f\x7f]/g, ' ');
}

const limpar = texto => sanearZpl(texto).replace(/\s+/g, ' ').trim();
const larguraEstimada = (texto, altura) => Math.ceil(texto.length * AVANCO * altura);

// Uma linha só: usa a maior altura de `alturas` em que "rótulo valor" cabe em larguraMax; se nem na menor couber, trunca
// o VALOR (nunca o rótulo) e termina com "...". Devolve { altura, texto }.
function linhaUnica(rotulo, valor, larguraMax, alturas) {
  const prefixo = rotulo ? rotulo + ' ' : '';
  for (const h of alturas) if (larguraEstimada(prefixo + valor, h) <= larguraMax) return { altura: h, texto: prefixo + valor };
  const h = alturas[alturas.length - 1];
  const cabem = Math.floor(larguraMax / (AVANCO * h)) - prefixo.length; // caracteres do valor
  const manter = cabem - 3;
  return { altura: h, texto: prefixo + (manter > 0 ? valor.slice(0, manter).trimEnd() + '...' : '...') };
}

// negrito simulado: a mesma linha impressa duas vezes, 2 dots deslocada
const negrito = (x, y, altura, texto) =>
  [0, 2].map(d => `^FO${x + d},${y}^A0N,${altura},${altura}^FD${texto}^FS`).join('\n');

// linha única; se tem rótulo, desenha o filete (sublinhado) logo abaixo dele
function linha(x, y, rotulo, valor, larguraMax, alturas) {
  const { altura, texto } = linhaUnica(rotulo, valor, larguraMax, alturas);
  const partes = [negrito(x, y, altura, texto)];
  if (rotulo) partes.push(`^FO${x},${y + altura + 2}^GB${Math.ceil(rotulo.length * AVANCO_ROTULO * altura) + 2},3,3^FS`);
  return partes.join('\n');
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

// dados = { numero, cliente (razão social), clienteFinal, uf (destino geral, opcional),
//           itens: [{ ITEM, QTD, MEDIDAS (opcional), UF (opcional, vale mais que a geral) }] }  →  { zpl, quantidade }
// QTD, MEDIDAS e UF já vêm validados pela rota (calculo/etiqueta_edicao.js); mesmo assim tudo passa por sanearZpl.
function montarEtiquetas({ numero, cliente, clienteFinal, itens, uf }) {
  const lista = itens || [];
  const num = String(numero ?? '').replace(/\D/g, '');
  const nome = limpar(cliente).slice(0, MAX_TEXTO) || '—';
  const final = limpar(clienteFinal).slice(0, MAX_TEXTO) || '—';
  const util = LARGURA - 2 * MARGEM;
  const ALTURAS_NOME = [60, 52, 44, MIN_FONTE];
  const blocos = lista.map(it => {
    const qtd = limpar(it.QTD).slice(0, MAX_QTD) || '1';
    const medidas = limpar(it.MEDIDAS).slice(0, 30);
    const destino = limpar(it.UF || uf).slice(0, 2).toUpperCase();
    return [
      '^XA^CI28^PW800^LL480',
      logo(),
      linha(272, 30, '', `Pedido: ${num}`, LARGURA - 272 - MARGEM, [64, 56, 48, 40, 32]),
      linha(MARGEM, Y.nome, 'Nome:', nome, util, ALTURAS_NOME),
      linha(MARGEM, Y.cliente, 'Cliente:', final, util, ALTURAS_NOME),
      medidas ? linha(MARGEM, Y.medidas, 'Medidas:', medidas, util, [44, 40, MIN_FONTE]) : '',
      linha(MARGEM, Y.qtd, 'Qtd:', qtd, 330, [56, 48, 40, 32]),
      destino ? linha(MARGEM, Y.destino, 'Destino:', destino, 330, [40]) : '',
      codigoDeBarras(num),
      '^XZ'
    ].filter(Boolean).join('\n');
  });
  return { zpl: blocos.join('\n'), quantidade: lista.length };
}

module.exports = { sanearZpl, montarEtiquetas };
