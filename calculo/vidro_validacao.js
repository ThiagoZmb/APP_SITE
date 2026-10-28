// ============================================================
// PLANO DE CORTE DE VIDROS — validação das entradas das rotas. Funções puras: devolvem { ok, dados | erro }.
// Medidas em mm inteiros, até 20000 mm. Plano no formato de otimizarVidros (calculo/vidro_otimizacao.js).
// ============================================================
const LIMITE_MM = 20000;
const PADRAO_SERRA = 0;
const PADRAO_SOBRA_MINIMA = 300;

const txt = v => String(v ?? '').trim();
// inteiro de `min` até o limite; aceita número ou texto só com dígitos
function inteiro(v, min) {
  const s = txt(v);
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return n >= min && n <= LIMITE_MM ? n : null;
}

// campo em branco assume o padrão
function validarConfigVidros(corpo = {}) {
  const serraBruta = txt(corpo.serra) === '' ? PADRAO_SERRA : corpo.serra;
  const sobraBruta = txt(corpo.sobraMinima) === '' ? PADRAO_SOBRA_MINIMA : corpo.sobraMinima;
  const serra = inteiro(serraBruta, 0);
  if (serra === null) return { ok: false, erro: `Serra deve ser um número inteiro de 0 a ${LIMITE_MM} mm.` };
  const sobraMinima = inteiro(sobraBruta, 1);
  if (sobraMinima === null) return { ok: false, erro: `Sobra mínima deve ser um número inteiro de 1 a ${LIMITE_MM} mm.` };
  return { ok: true, dados: { serra, sobraMinima } };
}

function validarRetalhoVidro(corpo = {}) {
  const produtoCodigo = inteiro(corpo.produtoCodigo, 1);
  if (produtoCodigo === null) return { ok: false, erro: 'Produto (vidro) é obrigatório.' };
  const altura = inteiro(corpo.altura, 1);
  if (altura === null) return { ok: false, erro: `Altura deve ser um número inteiro de 1 a ${LIMITE_MM} mm.` };
  const largura = inteiro(corpo.largura, 1);
  if (largura === null) return { ok: false, erro: `Largura deve ser um número inteiro de 1 a ${LIMITE_MM} mm.` };
  return { ok: true, dados: { produtoCodigo, altura, largura } };
}

// corpo.sobras: [{ grupo (chave), chapa (índice), sobra (índice), destino: 'guardar'|'descartar', altura, largura }].
// A medida real nunca pode passar da calculada em nenhum lado. Descartar não exige medida (devolve 0 x 0).
function validarConferenciaVidros(corpo = {}, plano = {}) {
  if (corpo.sobras !== undefined && !Array.isArray(corpo.sobras)) return { ok: false, erro: 'Lista de sobras inválida.' };
  const citadas = new Set();
  const sobras = [];
  for (const s of corpo.sobras || []) {
    const grupo = (plano.grupos || []).find(g => g.chave === s?.grupo);
    const chapa = grupo && Number.isInteger(s.chapa) ? grupo.chapas[s.chapa] : null;
    const calculada = chapa && Number.isInteger(s.sobra) ? (chapa.sobras || [])[s.sobra] : null;
    if (!calculada) return { ok: false, erro: 'Sobra informada para uma chapa ou sobra que não existe no plano.' };
    const chave = `${s.grupo}#${s.chapa}#${s.sobra}`;
    if (citadas.has(chave)) return { ok: false, erro: 'Sobra informada mais de uma vez na conferência.' };
    citadas.add(chave);
    if (s.destino !== 'guardar' && s.destino !== 'descartar') return { ok: false, erro: 'Destino da sobra deve ser guardar ou descartar.' };
    const ref = { grupo: s.grupo, chapa: s.chapa, sobra: s.sobra, destino: s.destino };
    if (s.destino === 'descartar') { sobras.push({ ...ref, altura: 0, largura: 0 }); continue; }
    const altura = inteiro(s.altura, 1);
    const largura = inteiro(s.largura, 1);
    if (altura === null || largura === null) return { ok: false, erro: 'Altura e largura reais da sobra devem ser números inteiros maiores que zero.' };
    if (altura > calculada.altura) return { ok: false, erro: `Altura real (${altura} mm) maior que a calculada (${calculada.altura} mm).` };
    if (largura > calculada.largura) return { ok: false, erro: `Largura real (${largura} mm) maior que a calculada (${calculada.largura} mm).` };
    sobras.push({ ...ref, altura, largura });
  }
  return { ok: true, sobras };
}

module.exports = { LIMITE_MM, validarConfigVidros, validarRetalhoVidro, validarConferenciaVidros };
