// ============================================================
// VERIFICAÇÃO CRUZADA — soma de cotas e contagens declaradas x contadas.
// Valor ausente/conflitante NUNCA vira 0: gera pendência de "não verificado".
// ============================================================
const utilizavel = v => (v.estado === 'confirmado' || v.estado === 'inferido') && typeof v.valor === 'number';

// diferenças abaixo disso são ruído de ponto flutuante, não tolerância de engenharia
const RUIDO = 1e-9;

const paginasDe = valores => [...new Set(valores.map(v => v.origem?.pagina).filter(p => Number.isInteger(p)))].sort((a, b) => a - b);
const textoPaginas = ps => (ps.length === 0 ? 'página não informada' : ps.length === 1 ? `página ${ps[0]}` : `páginas ${ps.join(', ')}`);

function pendenciaNaoVerificavel(id, rotulo, valores) {
  const ruins = valores.filter(v => !utilizavel(v));
  const tipo = ruins.some(v => v.estado === 'ausente') ? 'ausente' : 'conflitante';
  const paginas = paginasDe(valores);
  return {
    id, tipo, refs: ruins.map(v => v.id), ...(paginas.length ? { pagina: paginas[0], paginas } : {}),
    mensagem: `${rotulo} não pôde ser verificado: valor(es) ${ruins.map(v => `"${v.id}" (${v.estado})`).join(', ')} sem número utilizável`,
  };
}

// → pendência "divergencia" | pendência de não verificação | null (tudo certo ou nada a verificar)
export function verificarSoma(cota, { toleranciaMm = 0 } = {}) {
  const todos = [cota.total, ...cota.parciais];
  const id = `pend-soma-${cota.id}`;
  const rotulo = `Soma da cota "${cota.id}" (${cota.descricao})`;
  if (cota.parciais.length === 0) return null;
  if (!todos.every(utilizavel)) return pendenciaNaoVerificavel(id, rotulo, todos);
  const soma = cota.parciais.reduce((s, p) => s + p.valor, 0);
  const diferenca = Math.abs(soma - cota.total.valor);
  if (diferenca <= toleranciaMm + RUIDO) return null;
  const paginas = paginasDe(todos);
  return {
    id, tipo: 'divergencia', refs: todos.map(v => v.id), ...(paginas.length ? { pagina: paginas[0], paginas } : {}),
    mensagem: `${rotulo}: parciais somam ${soma} mm, total declarado ${cota.total.valor} mm (diferença ${diferenca} mm, tolerância ${toleranciaMm} mm; ${textoPaginas(paginas)})`,
  };
}

export function verificarContagem(contagem) {
  const todos = [contagem.declarado, contagem.contado];
  const id = `pend-contagem-${contagem.id}`;
  const rotulo = `Contagem "${contagem.id}" (${contagem.descricao})`;
  if (!todos.every(utilizavel)) return pendenciaNaoVerificavel(id, rotulo, todos);
  if (contagem.declarado.valor === contagem.contado.valor) return null;
  const paginas = paginasDe(todos);
  return {
    id, tipo: 'divergencia', refs: todos.map(v => v.id), ...(paginas.length ? { pagina: paginas[0], paginas } : {}),
    mensagem: `${rotulo}: declarado ${contagem.declarado.valor}, contado ${contagem.contado.valor} (${textoPaginas(paginas)})`,
  };
}

// Devolve cópia do documento com as pendências das verificações (sem duplicar ids, sem mutar a entrada)
export function aplicarVerificacoes(doc, config = {}) {
  const novo = structuredClone(doc);
  const toleranciaMm = config?.tolerancias?.somaCotasMm ?? 0;
  const achadas = [
    ...(novo.cotas || []).map(c => verificarSoma(c, { toleranciaMm })),
    ...(novo.contagens || []).map(c => verificarContagem(c)),
  ].filter(Boolean);
  const ids = new Set((novo.pendencias || []).map(p => p.id));
  novo.pendencias = [...(novo.pendencias || []), ...achadas.filter(p => !ids.has(p.id))];
  return novo;
}
