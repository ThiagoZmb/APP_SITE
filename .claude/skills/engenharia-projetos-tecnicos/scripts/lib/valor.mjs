// ============================================================
// CONSTRUTORES DE ValorRastreavel — não deixam criar valor inválido.
// Todos devolvem objetos novos e lançam Error se violarem o contrato.
// ============================================================
import { errosDoValor, ISO_DATA, piorEstado } from './regras.mjs';

function montar(valor) {
  const erros = errosDoValor(valor, valor?.id ?? '(sem id)');
  if (erros.length) throw new Error(`ValorRastreavel inválido: ${erros.map(x => x.mensagem).join('; ')}`);
  return valor;
}

const limpo = obj => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));

// confirmado: leitura direta e confiável. confianca padrão 1; OCR/leitura visual exigem confirmacao
export function confirmado({ id, valor, unidade = null, metodo, origem, confianca = 1, confirmacao }) {
  return montar(limpo({ id, valor, unidade, estado: 'confirmado', confianca, metodo, origem, confirmacao }));
}

// inferido: confianca explícita (não há padrão honesto); vira pendência no documento
export function inferido({ id, valor, unidade = null, metodo, origem, confianca }) {
  return montar({ id, valor, unidade, estado: 'inferido', confianca, metodo, origem });
}

// ausente: valor null, confianca 0
export function ausente({ id, unidade = null, metodo = 'texto_vetorial', origem }) {
  return montar({ id, valor: null, unidade, estado: 'ausente', confianca: 0, metodo, origem });
}

// conflitante: valor null + candidatos; nunca escolhe um. Opções: id (obrigatório), origem, metodo, unidade
export function conflitante(candidatos, { id, origem, metodo, unidade } = {}) {
  if (!Array.isArray(candidatos) || candidatos.length < 2) throw new Error('conflitante exige pelo menos 2 candidatos');
  const primeiro = candidatos[0];
  return montar({
    id, valor: null, unidade: unidade ?? primeiro.unidade ?? null, estado: 'conflitante', confianca: 0,
    metodo: metodo ?? primeiro.metodo, origem: origem ?? primeiro.origem, candidatos,
  });
}

// calculado: o estado nunca é melhor que o pior estado das entradas.
// Entrada ausente/conflitante ⇒ resultado ausente (o valor passado é descartado).
export function calculado({ id, regra, entradas, estadoEntradas, valor, unidade = null, origem, confianca }) {
  if (!Array.isArray(entradas) || entradas.length === 0) throw new Error('calculado exige entradas (ids)');
  if (!Array.isArray(estadoEntradas) || estadoEntradas.length !== entradas.length) {
    throw new Error('estadoEntradas deve ter um estado por entrada');
  }
  const pior = piorEstado(estadoEntradas);
  const orig = { arquivo: origem?.arquivo, pagina: origem?.pagina ?? null, trecho: origem?.trecho ?? regra, entradas };
  const base = { id, unidade, metodo: 'calculado', origem: orig, regra };
  if (pior === 'ausente' || pior === 'conflitante') return montar({ ...base, valor: null, estado: 'ausente', confianca: 0 });
  if (pior === 'inferido' && confianca === undefined) throw new Error('calculado a partir de entrada inferida exige confianca explícita');
  return montar({ ...base, valor, estado: pior, confianca: confianca ?? 1 });
}

// Registra a confirmação humana: só inferido → confirmado
export function confirmarHumano(v, { por, em, nota } = {}) {
  if (v?.estado !== 'inferido') throw new Error(`confirmarHumano só vale para estado "inferido" (atual: "${v?.estado}")`);
  if (typeof por !== 'string' || !por.trim()) throw new Error('confirmarHumano exige "por" (quem confirmou)');
  if (!ISO_DATA.test(em ?? '') || Number.isNaN(Date.parse(em))) throw new Error('confirmarHumano exige "em" como data ISO válida');
  return montar({ ...v, estado: 'confirmado', confirmacao: limpo({ por, em, nota }) });
}
