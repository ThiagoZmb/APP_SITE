// ============================================================
// PLANO DE CORTE — validação das entradas das rotas. Funções puras: devolvem { ok, dados | erro }.
// Medidas em mm inteiros; vara até 20000 mm.
// ============================================================
const LIMITE_MM = 20000;

const txt = v => String(v ?? '').trim();
// inteiro positivo até o limite; aceita número ou texto só com dígitos
function inteiroMm(v) {
  const s = txt(v);
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return n >= 1 && n <= LIMITE_MM ? n : null;
}

const ROTULOS = { comprimentoVara: 'Comprimento da vara', serra: 'Serra', sobraMinima: 'Sobra mínima' };

// perfil vazio = padrão (exige os três valores); perfil informado = exceção (campos em branco herdam o padrão, mas não todos)
function validarConfig(corpo = {}) {
  const perfil = txt(corpo.perfil);
  if (perfil.length > 190) return { ok: false, erro: 'Perfil com mais de 190 caracteres.' };
  const dados = { perfil };
  let preenchidos = 0;
  for (const campo of ['comprimentoVara', 'serra', 'sobraMinima']) {
    const bruto = corpo[campo];
    if (txt(bruto) === '') {
      if (!perfil) return { ok: false, erro: `${ROTULOS[campo]} é obrigatório no padrão.` };
      dados[campo] = null;
      continue;
    }
    const n = inteiroMm(bruto);
    if (n === null) return { ok: false, erro: `${ROTULOS[campo]} deve ser um número inteiro de 1 a ${LIMITE_MM} mm.` };
    dados[campo] = n; preenchidos++;
  }
  if (perfil && !preenchidos) return { ok: false, erro: 'Informe ao menos um valor para a exceção do perfil.' };
  return { ok: true, dados };
}

function validarRetalho(corpo = {}) {
  const dados = { perfil: txt(corpo.perfil), acabamento: txt(corpo.acabamento), cor: txt(corpo.cor) };
  // só o perfil é obrigatório: acabamento e cor podem ficar vazios, como no pedido (acabamento sem lista de cores não tem cor)
  if (!dados.perfil) return { ok: false, erro: 'Perfil é obrigatório.' };
  for (const [campo, rotulo] of [['perfil', 'Perfil'], ['acabamento', 'Acabamento'], ['cor', 'Cor']]) {
    if (dados[campo].length > 190) return { ok: false, erro: `${rotulo} com mais de 190 caracteres.` };
  }
  const comprimento = inteiroMm(corpo.comprimento);
  if (comprimento === null) return { ok: false, erro: `Comprimento deve ser um número inteiro de 1 a ${LIMITE_MM} mm.` };
  return { ok: true, dados: { ...dados, comprimento } };
}

// corpo.sobras: [{ grupo, barra, destino: 'guardar'|'descartar', medidaReal }] — plano.grupos[].barras[] traz a sobra calculada.
// Barras não citadas ficam como o plano sugeriu. A medida real nunca pode passar da calculada.
function validarConferencia(corpo = {}, plano) {
  const lista = Array.isArray(corpo.sobras) ? corpo.sobras : [];
  const citadas = new Map();
  for (const s of lista) {
    const grupo = (plano.grupos || []).find(g => g.chave === s.grupo);
    const barra = grupo && Number.isInteger(s.barra) ? grupo.barras[s.barra] : null;
    if (!barra) return { ok: false, erro: 'Sobra informada para uma barra que não existe no plano.' };
    const chave = `${s.grupo}#${s.barra}`;
    if (citadas.has(chave)) return { ok: false, erro: 'Barra informada mais de uma vez na conferência.' };
    if (s.destino !== 'guardar' && s.destino !== 'descartar') return { ok: false, erro: 'Destino da sobra deve ser guardar ou descartar.' };
    if (s.destino === 'descartar') { citadas.set(chave, { grupo: s.grupo, barra: s.barra, destino: 'descartar', medidaReal: 0 }); continue; }
    const medida = inteiroMm(s.medidaReal);
    if (barra.sobra <= 0) return { ok: false, erro: 'Esta barra não tem sobra para guardar.' };
    if (medida === null) return { ok: false, erro: 'Medida real da sobra deve ser um número inteiro maior que zero.' };
    if (medida > barra.sobra) return { ok: false, erro: `Medida real (${medida} mm) maior que a sobra calculada (${barra.sobra} mm).` };
    citadas.set(chave, { grupo: s.grupo, barra: s.barra, destino: 'guardar', medidaReal: medida });
  }
  const sobras = [];
  for (const g of plano.grupos || []) g.barras.forEach((b, i) => {
    sobras.push(citadas.get(`${g.chave}#${i}`) || { grupo: g.chave, barra: i, destino: b.destinoSobra, medidaReal: b.destinoSobra === 'guardar' ? b.sobra : 0 });
  });
  return { ok: true, sobras };
}

module.exports = { LIMITE_MM, validarConfig, validarRetalho, validarConferencia };
