// ============================================================
// REGRAS LOCAIS de um ValorRastreavel (não dependem do documento).
// Usadas pelos construtores (valor.mjs) e pela validação (validacao.mjs).
// ============================================================
export const ESTADOS = ['confirmado', 'inferido', 'ausente', 'conflitante'];
export const METODOS = ['texto_vetorial', 'ocr', 'leitura_visual', 'calculado', 'configuracao'];
export const UNIDADES = ['mm', 'un', 'kg', 'm2'];

// Quanto maior, pior. ausente e conflitante são igualmente "inutilizáveis"
export const POSICAO = { confirmado: 0, inferido: 1, ausente: 2, conflitante: 2 };

export const piorEstado = estados => estados.reduce((p, e) => (POSICAO[e] > POSICAO[p] ? e : p), 'confirmado');

export const ISO_DATA = /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/;

// Exige pendência registrada: ausente, conflitante ou inferido sem confirmação humana
export const exigePendencia = v => v.estado === 'ausente' || v.estado === 'conflitante' || (v.estado === 'inferido' && !v.confirmacao);

const textoVazio = t => typeof t !== 'string' || t.trim() === '';

export function errosDoValor(v, caminho) {
  const erros = [];
  const e = mensagem => erros.push({ caminho, mensagem });
  if (!v || typeof v !== 'object' || Array.isArray(v)) { e('deve ser um objeto ValorRastreavel'); return erros; }
  if (textoVazio(v.id)) e('id obrigatório (texto não vazio)');
  if (!ESTADOS.includes(v.estado)) e(`estado inválido "${v.estado}" (aceitos: ${ESTADOS.join(', ')})`);
  if (!METODOS.includes(v.metodo)) e(`metodo inválido "${v.metodo}" (aceitos: ${METODOS.join(', ')})`);
  if (!(typeof v.confianca === 'number' && v.confianca >= 0 && v.confianca <= 1)) e('confianca deve ser número entre 0 e 1');
  if (!v.origem || typeof v.origem !== 'object' || textoVazio(v.origem.arquivo)) e('origem.arquivo obrigatório');
  if (v.unidade !== null && !UNIDADES.includes(v.unidade)) {
    e(`unidade "${v.unidade}" inválida; permitidas: ${UNIDADES.join(', ')} ou null (comprimento deve ser convertido para mm)`);
  }
  if (v.unidade !== null && v.valor !== null && typeof v.valor !== 'number') e(`valor com unidade "${v.unidade}" deve ser número`);

  if (v.estado === 'ausente') {
    if (v.valor !== null) e('estado "ausente" proíbe valor: use null');
    if (v.confianca !== 0) e('estado "ausente" exige confianca 0');
  }
  if (v.estado === 'confirmado' || v.estado === 'inferido') {
    if (v.valor === null || v.valor === undefined) e(`estado "${v.estado}" exige valor; sem valor o estado é "ausente"`);
  }
  if (v.estado === 'confirmado' && (v.metodo === 'ocr' || v.metodo === 'leitura_visual') && !v.confirmacao) {
    e(`estado "confirmado" com metodo "${v.metodo}" exige confirmacao humana registrada (por, em); sem ela o estado é "inferido"`);
  }
  if (v.confirmacao && (textoVazio(v.confirmacao.por) || !ISO_DATA.test(v.confirmacao.em ?? ''))) {
    e('confirmacao exige "por" (quem) e "em" (data ISO)');
  }
  if (v.metodo === 'calculado') {
    if (textoVazio(v.regra)) e('valor calculado exige "regra"');
    if (!Array.isArray(v.origem?.entradas) || v.origem.entradas.length === 0) e('valor calculado exige origem.entradas (ids das entradas)');
  }
  erros.push(...errosDosCandidatos(v, caminho));
  return erros;
}

function errosDosCandidatos(v, caminho) {
  if (v.estado !== 'conflitante') return [];
  const c = v.candidatos;
  const erros = [];
  if (v.valor !== null) erros.push({ caminho, mensagem: 'estado "conflitante" exige valor null: nunca escolha um candidato' });
  if (!Array.isArray(c) || c.length < 2) {
    erros.push({ caminho, mensagem: 'estado "conflitante" exige "candidatos" com pelo menos 2 valores' });
    return erros;
  }
  c.forEach((cand, i) => {
    const cc = `${caminho}.candidatos[${i}]`;
    erros.push(...errosDoValor(cand, cc));
    if (cand?.estado === 'ausente' || cand?.estado === 'conflitante') erros.push({ caminho: cc, mensagem: `candidato não pode estar "${cand.estado}"` });
  });
  if (new Set(c.map(x => JSON.stringify(x?.valor ?? null))).size < 2) erros.push({ caminho, mensagem: 'os candidatos devem ter valores diferentes (senão não há conflito)' });
  return erros;
}
