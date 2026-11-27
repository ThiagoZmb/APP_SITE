// Etiqueta de pedido/produção para a Zebra (ZPL), 100 x 60 mm a 203 dpi (8 dots/mm = 800 x 480 dots). Função pura, sem banco.
// N etiquetas por item do Pedido (N = volumes, 1 a 999), cada uma com "VOL i/N" (sempre, também "VOL 1/1"). Nenhum campo de dinheiro. Todo texto do banco ou digitado passa por sanearZpl: ^, ~ e \ são
// caracteres de comando do ZPL, então o conteúdo do pedido nunca pode chegar à impressora com eles.
// Layout (2026-11-12): logo + "Pedido: N", "Nome: razão social", "Cliente: cliente final", [Medidas: ...], "Qtd: n" (QTD do item),
// [Destino: UF], "VOL i/N" (x 520, y 324, acima do código de barras) e o código de barras do nº do pedido. Nome, Cliente e Medidas SEMPRE numa linha só (fonte menor até 36; depois trunca com "...").
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
const Y = { nome: 120, cliente: 200, medidas: 278, qtd: 348, destino: 424, vol: 324 };
const MAX_VOLUMES = 999;
const X_VOL = 520; // "VOL i/N": à direita de Qtd (até x 350), abaixo de Medidas (y 278 + 44) e acima do código de barras (y 368)

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
const negrito = (x, y, altura, texto, largura = altura) =>
  [0, 2].map(d => `^FO${x + d},${y}^A0N,${altura},${largura}^FD${texto}^FS`).join('\n');

// filete (sublinhado) do rótulo, logo abaixo do texto; `largura` = largura do caractere na fonte
const filete = (x, y, rotulo, altura, largura = altura) =>
  `^FO${x},${y + altura + 2}^GB${Math.ceil(rotulo.length * AVANCO_ROTULO * largura) + 2},3,3^FS`;

// linha única; se tem rótulo, desenha o filete (sublinhado) logo abaixo dele
function linha(x, y, rotulo, valor, larguraMax, alturas) {
  const { altura, texto } = linhaUnica(rotulo, valor, larguraMax, alturas);
  const partes = [negrito(x, y, altura, texto)];
  if (rotulo) partes.push(filete(x, y, rotulo, altura));
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

const logo = (dados = LOGO.hex) => [
  '^FO14,14^GB240,94,3,B,3^FS', // caixa arredondada em volta do logo
  `^FO22,20^GFA,${LOGO.bytesPorLinha * LOGO.altura},${LOGO.bytesPorLinha * LOGO.altura},${LOGO.bytesPorLinha},${dados}^FS`
].join('\n');

// Compactação ASCII do ^GFA (ZPL II): "," completa a linha com zeros e ":" repete a linha anterior. O desenho é o mesmo.
// Usada só nas etiquetas do Rio, para 200 etiquetas (o logo se repete em cada uma) caberem no 1 MB do serviço local.
function compactarGfa(hex, bytesPorLinha) {
  const n = bytesPorLinha * 2;
  let anterior = '', saida = '';
  for (let i = 0; i < hex.length; i += n) {
    const l = hex.slice(i, i + n);
    const semZeros = l.replace(/0+$/, '');
    saida += l === anterior ? ':' : (semZeros.length < n ? semZeros + ',' : l);
    anterior = l;
  }
  return saida;
}
const LOGO_COMPACTO = compactarGfa(LOGO.hex, LOGO.bytesPorLinha);

// volumes válidos: inteiro 1 a 999; qualquer outra coisa = 1
const volumesDe = v => { const n = Number(v); return Number.isInteger(n) && n >= 1 && n <= MAX_VOLUMES ? n : 1; };

// dados = { numero, cliente (razão social), clienteFinal, uf (destino geral, opcional),
//           itens: [{ ITEM, QTD (quantidade do item, impressa em "Qtd:"), MEDIDAS (opcional), VOLUMES (N etiquetas; padrão 1) }] }
//   →  { zpl, quantidade } (quantidade = TOTAL de etiquetas = soma dos volumes)
// Cada item gera VOLUMES blocos ^XA...^XZ, com "VOL 1/N" ... "VOL N/N". MEDIDAS e VOLUMES já vêm validados pela rota
// (calculo/etiqueta_edicao.js); mesmo assim tudo passa por sanearZpl.
function montarEtiquetas({ numero, cliente, clienteFinal, itens, uf }) {
  const lista = itens || [];
  const num = String(numero ?? '').replace(/\D/g, '');
  const nome = limpar(cliente).slice(0, MAX_TEXTO) || '—';
  const final = limpar(clienteFinal).slice(0, MAX_TEXTO) || '—';
  const util = LARGURA - 2 * MARGEM;
  const ALTURAS_NOME = [60, 52, 44, MIN_FONTE];
  const destino = limpar(uf).slice(0, 2).toUpperCase();
  const blocos = [];
  for (const it of lista) {
    const qtd = limpar(it.QTD).slice(0, MAX_QTD) || '1';
    const medidas = limpar(it.MEDIDAS).slice(0, 30);
    const n = volumesDe(it.VOLUMES);
    for (let i = 1; i <= n; i++) blocos.push([
      '^XA^CI28^PW800^LL480',
      logo(),
      linha(272, 30, '', `Pedido: ${num}`, LARGURA - 272 - MARGEM, [64, 56, 48, 40, 32]),
      linha(MARGEM, Y.nome, 'Nome:', nome, util, ALTURAS_NOME),
      linha(MARGEM, Y.cliente, 'Cliente:', final, util, ALTURAS_NOME),
      medidas ? linha(MARGEM, Y.medidas, 'Medidas:', medidas, util, [44, 40, MIN_FONTE]) : '',
      linha(MARGEM, Y.qtd, 'Qtd:', qtd, 330, [56, 48, 40, 32]),
      destino ? linha(MARGEM, Y.destino, 'Destino:', destino, 330, [40]) : '',
      linha(X_VOL, Y.vol, 'VOL', `${i}/${n}`, LARGURA - X_VOL - MARGEM, [38]),
      codigoDeBarras(num),
      '^XZ'
    ].filter(Boolean).join('\n'));
  }
  return { zpl: blocos.join('\n'), quantidade: blocos.length };
}

// ---------- Rio de Janeiro ----------
// Um PAR por volume, nesta ordem: etiqueta do pedido (igual em todos os volumes) e etiqueta de destino ("Volume i/N"),
// para cada caixa receber o seu par. Mesmo tamanho e mesma caixa do logo; sem código de barras e sem dinheiro.
// Etiqueta 1 em posições fixas; Cliente e Cliente Final reservam espaço para duas linhas (40 + 6 + 40 = 86 dots).
const Y_RJ = { cliente: 114, final: 208, oc: 306, consultor: 364, volumes: 422, destino: 150, nfe: 250, volume: 340 };
const MAX_VOLUMES_RJ = 100;
const MAX_NOME_RJ = 255; // teto do cadastro (razão social 255, cliente final 190): na prática nada é cortado

// quebra entre palavras em linhas de até `cap` caracteres (só parte a palavra que não cabe numa linha); null se passar de duas
function emDuasLinhas(texto, cap) {
  const linhas = [''];
  for (let palavra of texto.split(' ')) {
    const atual = linhas[linhas.length - 1];
    const junta = atual ? `${atual} ${palavra}` : palavra;
    if (junta.length <= cap) linhas[linhas.length - 1] = junta;
    else if (palavra.length <= cap) linhas.push(palavra);
    else {
      const sobra = cap - atual.length - (atual ? 1 : 0);
      if (sobra > 0) {
        linhas[linhas.length - 1] = (atual ? atual + ' ' : '') + palavra.slice(0, sobra);
        palavra = palavra.slice(sobra);
      }
      for (let i = 0; i < palavra.length; i += cap) linhas.push(palavra.slice(i, i + cap));
    }
    if (linhas.length > 2) return null;
  }
  return linhas;
}

// Nome SEMPRE completo (regra do dono): uma linha em 60/52/44/36; senão duas linhas em 40 ou 36; senão duas linhas de
// altura 36 com o caractere mais estreito (condensado). Nunca trunca nem põe "...".
function nomeCompleto(y, rotulo, valor, larguraMax, alturas) {
  const texto = `${rotulo} ${valor}`;
  if (alturas.some(h => larguraEstimada(texto, h) <= larguraMax)) return linha(MARGEM, y, rotulo, valor, larguraMax, alturas);
  let w = 40, linhas;
  while (!(linhas = emDuasLinhas(texto, Math.floor(larguraMax / (AVANCO * w))))) w = w > MIN_FONTE ? MIN_FONTE : w - 1;
  const h = Math.max(MIN_FONTE, w);
  return [
    ...linhas.map((l, i) => negrito(MARGEM, y + i * (h + 6), h, l, w)),
    filete(MARGEM, y, rotulo, h, w)
  ].join('\n');
}

// Consultor também é nome: uma linha, estreitando o caractere quando nem a menor altura couber (nunca "...").
function consultorCompleto(y, valor, larguraMax) {
  const rotulo = 'Consultor:';
  const texto = `${rotulo} ${valor}`;
  const alturas = [48, 44, 40, MIN_FONTE];
  if (alturas.some(h => larguraEstimada(texto, h) <= larguraMax)) return linha(MARGEM, y, rotulo, valor, larguraMax, alturas);
  const w = Math.floor(larguraMax / (AVANCO * texto.length));
  return [negrito(MARGEM, y, MIN_FONTE, texto, w), filete(MARGEM, y, rotulo, MIN_FONTE, w)].join('\n');
}

// dados = { numero, cliente (razão social), clienteFinal, oc, consultor, nfe (opcionais), volumes (1 a 100) }
//   →  { zpl, quantidade } (quantidade = 2 x volumes). Campo opcional vazio não imprime linha.
function montarEtiquetasRj({ numero, cliente, clienteFinal, oc, consultor, nfe, volumes }) {
  const num = String(numero ?? '').replace(/\D/g, '');
  const util = LARGURA - 2 * MARGEM;
  const ALTURAS = [60, 52, 44, MIN_FONTE];
  const texto = v => limpar(v).slice(0, MAX_TEXTO);
  const opcional = (y, rotulo, valor, alturas) => (texto(valor) ? linha(MARGEM, y, rotulo, texto(valor), util, alturas) : '');
  const nome = (y, rotulo, v) => nomeCompleto(y, rotulo, limpar(v).slice(0, MAX_NOME_RJ).trim() || '—', util, ALTURAS);
  const n = Math.min(MAX_VOLUMES_RJ, volumesDe(volumes));
  const bloco = partes => ['^XA^CI28^PW800^LL480', logo(LOGO_COMPACTO), ...partes, '^XZ'].filter(Boolean).join('\n');

  const pedido = bloco([
    linha(272, 30, '', `Pedido: ${num}`, LARGURA - 272 - MARGEM, [64, 56, 48, 40, 32]),
    nome(Y_RJ.cliente, 'Cliente:', cliente),
    nome(Y_RJ.final, 'Cliente Final:', clienteFinal),
    opcional(Y_RJ.oc, 'OC:', oc, [48, 44, 40, MIN_FONTE]),
    texto(consultor) ? consultorCompleto(Y_RJ.consultor, texto(consultor), util) : '',
    linha(MARGEM, Y_RJ.volumes, 'Volumes totais:', String(n), util, [48])
  ]);
  const blocos = [];
  for (let i = 1; i <= n; i++) blocos.push(pedido, bloco([
    linha(MARGEM, Y_RJ.destino, 'Destino:', 'Rio de Janeiro', util, [52]),
    opcional(Y_RJ.nfe, 'NFe:', nfe, ALTURAS),
    linha(MARGEM, Y_RJ.volume, 'Volume', `${i}/${n}`, util, [90])
  ]));
  return { zpl: blocos.join('\n'), quantidade: blocos.length };
}

module.exports = { sanearZpl, montarEtiquetas, montarEtiquetasRj };
