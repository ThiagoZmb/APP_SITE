// ============================================================
// CONFIRMAÇÃO HUMANA registrada no projeto (tudo ou nada, sem alterar o documento de entrada).
//  - confirmar:  inferido → confirmado (mantém metodo e origem; grava confirmacao);
//  - resolver:   conflitante → candidato escolhido, confirmado (candidatos originais vão para o histórico);
//  - rejeitar:   inferido → ausente (valor null, confianca 0; o valor rejeitado e o motivo vão para o histórico);
//  - informar:   ausente → valor dado por uma pessoa (metodo "informado_humano"; unidade do campo preservada).
// Nunca decide pela pessoa: cada alteração vem de um id citado explicitamente.
// ============================================================
import { confirmarHumano } from './valor.mjs';
import { exigePendencia, ISO_DATA } from './regras.mjs';
import { interpretarCota, lerNumeroBr } from './unidades.mjs';
import { coletarValores } from './validacao.mjs';

// Pendências que a própria confirmação resolve. divergencia e texto_suspeito NUNCA saem daqui.
const TIPOS_RESOLVIVEIS = ['ausente', 'conflitante', 'inferido_sem_confirmacao', 'unidade_ambigua'];
export const VERSAO_SCHEMA_SAIDA = '1.1.0';

const limpo = obj => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== ''));
const trocarConteudo = (alvo, novo) => { for (const k of Object.keys(alvo)) delete alvo[k]; Object.assign(alvo, novo); };

// "79,5" (ou "79,5 cm") para valor de campo em mm; "3" para un/kg/m2; texto livre se sem unidade ("num:2" = número)
export function lerValorInformado(texto, unidade) {
  const t = String(texto ?? '').trim();
  if (!t) throw new Error('valor informado vazio');
  if (unidade === 'mm') {
    const c = interpretarCota(t, { unidadeDeclarada: 'mm' });
    if (c.valorMm === null) throw new Error(`valor "${t}" não é uma cota válida em mm: ${c.pendencias.map(p => p.mensagem).join('; ')}`);
    return c.valorMm;
  }
  if (unidade === null) {
    if (!t.startsWith('num:')) return t;
    const n = lerNumeroBr(t.slice(4));
    if (n.valor === null) throw new Error(`valor "${t}" não é um número: ${n.motivo}`);
    return n.valor;
  }
  const n = lerNumeroBr(t);
  if (n.valor === null) throw new Error(`valor "${t}" não é um número válido para unidade "${unidade}": ${n.motivo}`);
  return n.valor;
}

// → { doc, avisos, historico }. Lança Error (mensagem em pt-BR) em qualquer violação; o documento recebido não muda.
export function aplicarConfirmacoes(docEntrada, { por, em, nota, ids = [], resolver = [], informar = [], rejeitar = [] }) {
  if (typeof por !== 'string' || !por.trim()) throw new Error('informe quem confirmou (--por "Nome")');
  if (!ISO_DATA.test(em ?? '') || Number.isNaN(Date.parse(em))) throw new Error(`data inválida em --em: "${em}" (use ISO, ex.: 2026-10-26T14:30:00-03:00)`);
  if (!ids.length && !resolver.length && !informar.length && !rejeitar.length) throw new Error('nada a fazer: use --ids, --resolver, --informar ou --rejeitar');
  if (rejeitar.length && !String(nota ?? '').trim()) throw new Error('--rejeitar exige --nota com o motivo da rejeição');

  const doc = structuredClone(docEntrada);
  const porId = new Map(coletarValores(doc).map(x => [x.v.id, x.v]));
  const acha = (id, onde) => {
    const v = porId.get(id);
    if (!v) throw new Error(`${onde}: o id "${id}" não existe no documento`);
    return v;
  };
  // um id só pode ser tratado uma vez por execução
  const tocados = [...ids, ...resolver.map(r => r.conflitante), ...informar.map(i => i.id), ...rejeitar];
  const repetido = tocados.find((id, i) => tocados.indexOf(id) !== i);
  if (repetido) throw new Error(`o id "${repetido}" aparece mais de uma vez nesta confirmação`);

  const meta = limpo({ por, em, nota });
  const historico = [];
  const candidatosDescartados = new Set();

  if (ids.length) {
    for (const id of ids) {
      const v = acha(id, '--ids');
      if (v.estado !== 'inferido') throw new Error(`--ids: "${id}" está "${v.estado}"; só valor "inferido" pode ser confirmado (conflitante use --resolver, ausente use --informar)`);
      trocarConteudo(v, confirmarHumano(v, meta));
    }
    historico.push(limpo({ em, por, acao: 'confirmar', ids: [...ids], nota }));
  }

  if (resolver.length) {
    const detalhes = [];
    for (const { conflitante, candidato } of resolver) {
      const v = acha(conflitante, '--resolver');
      if (v.estado !== 'conflitante') throw new Error(`--resolver: "${conflitante}" está "${v.estado}"; só valor "conflitante" pode ser resolvido`);
      const c = v.candidatos.find(x => x.id === candidato);
      if (!c) throw new Error(`--resolver: "${candidato}" não é candidato de "${conflitante}" (candidatos: ${v.candidatos.map(x => x.id).join(', ')})`);
      detalhes.push({ id: conflitante, escolhido: candidato, candidatos: structuredClone(v.candidatos) });
      v.candidatos.forEach(x => candidatosDescartados.add(x.id));
      trocarConteudo(v, { ...structuredClone(c), id: conflitante, estado: 'confirmado', confirmacao: meta });
    }
    historico.push(limpo({ em, por, acao: 'resolver_conflito', ids: resolver.map(r => r.conflitante), nota, detalhes: { resolucoes: detalhes } }));
  }

  if (informar.length) {
    const detalhes = [];
    for (const { id, valor } of informar) {
      const v = acha(id, '--informar');
      if (v.estado !== 'ausente') throw new Error(`--informar: "${id}" está "${v.estado}"; só valor "ausente" aceita informação direta`);
      const novo = lerValorInformado(valor, v.unidade);
      const origem = { ...v.origem };
      delete origem.entradas; // se era calculado, deixa de ser: quem informou foi uma pessoa
      const base = { ...v };
      delete base.regra;
      trocarConteudo(v, { ...base, valor: novo, estado: 'confirmado', confianca: 1, metodo: 'informado_humano', origem, confirmacao: meta });
      detalhes.push({ id, valor: novo, unidade: v.unidade });
    }
    historico.push(limpo({ em, por, acao: 'informar', ids: informar.map(i => i.id), nota, detalhes: { informados: detalhes } }));
  }

  const rejeitados = new Set(rejeitar);
  const novasPendencias = [];
  if (rejeitar.length) {
    const detalhes = [];
    for (const id of rejeitar) {
      const v = acha(id, '--rejeitar');
      if (v.estado !== 'inferido') throw new Error(`--rejeitar: "${id}" está "${v.estado}"; só valor "inferido" pode ser rejeitado (conflitante use --resolver)`);
      detalhes.push({ id, valorRejeitado: v.valor, unidade: v.unidade, confiancaAnterior: v.confianca, metodo: v.metodo, origem: structuredClone(v.origem) });
      const { confirmacao, candidatos, ...base } = v;
      trocarConteudo(v, { ...base, valor: null, estado: 'ausente', confianca: 0 }); // id, unidade, metodo e origem preservados
      novasPendencias.push({ id: `pend-rejeitado-${id}`, tipo: 'ausente', mensagem: `rejeitado por ${por}: ${nota.trim()}`, refs: [id] });
    }
    historico.push(limpo({ em, por, acao: 'rejeitar', ids: [...rejeitar], nota, detalhes: { rejeitados: detalhes } }));
  }

  // pendências resolvidas: tocam um id desta execução e TODAS as refs estão resolvidas agora (rejeitado não é "resolvido": virou ausente)
  const alterados = new Set(tocados.filter(id => !rejeitados.has(id)));
  const resolvida = ref => alterados.has(ref) || candidatosDescartados.has(ref) || (porId.has(ref) && !exigePendencia(porId.get(ref)));
  const removidas = doc.pendencias.filter(p => TIPOS_RESOLVIVEIS.includes(p.tipo) && p.refs.some(r => alterados.has(r) || candidatosDescartados.has(r)) && p.refs.every(resolvida));
  const idsRemovidos = removidas.map(p => p.id);
  doc.pendencias = doc.pendencias.filter(p => !removidas.includes(p));

  // pendências de rejeitado (inferido_sem_confirmacao / unidade_ambigua): trocadas por UMA pendência "ausente" por valor.
  // Regra: com outros refs, a pendência fica (sem o id rejeitado) só se algum ref restante ainda exige pendência
  // (ou nem é valor, e então não dá para saber: mantém); se todos os restantes já estão resolvidos, sai por inteiro.
  if (rejeitar.length) {
    const aindaAberto = ref => !porId.has(ref) || exigePendencia(porId.get(ref));
    for (const p of [...doc.pendencias]) {
      if (!['inferido_sem_confirmacao', 'unidade_ambigua'].includes(p.tipo) || !p.refs.some(r => rejeitados.has(r))) continue;
      const restantes = p.refs.filter(r => !rejeitados.has(r));
      if (restantes.some(aindaAberto)) p.refs = restantes;
      else { doc.pendencias = doc.pendencias.filter(x => x !== p); idsRemovidos.push(p.id); }
    }
    for (const n of novasPendencias) {
      if (doc.pendencias.some(p => p.id === n.id)) throw new Error(`já existe uma pendência com id "${n.id}"`);
      doc.pendencias.push(n);
    }
    historico.find(h => h.acao === 'rejeitar').detalhes.pendenciasCriadas = novasPendencias.map(n => n.id);
  }
  if (idsRemovidos.length) historico.push(limpo({ em, por, acao: 'remover_pendencias', ids: idsRemovidos, nota }));

  // calculado que depende de valor recém-confirmado: o número pode estar desatualizado (não é recalculado aqui)
  const avisos = [];
  const dependentesRejeitados = [];
  const mudou = new Set(tocados);
  for (const { v } of coletarValores(doc)) {
    if (v.metodo !== 'calculado' || mudou.has(v.id)) continue;
    const dep = (v.origem?.entradas ?? []).filter(e => mudou.has(e));
    if (!dep.length) continue;
    const rej = dep.filter(e => rejeitados.has(e));
    const outras = dep.filter(e => !rejeitados.has(e));
    const lista = l => l.map(d => `"${d}"`).join(', ');
    if (outras.length) avisos.push(`valor calculado "${v.id}" (regra "${v.regra}") depende de ${lista(outras)}, recém-confirmado(s): recalcule-o e confira seu estado.`);
    if (rej.length) {
      avisos.push(`valor calculado "${v.id}" (regra "${v.regra}") depende de ${lista(rej)}, recém-rejeitado(s): o cálculo deixou de valer; rejeite-o junto (--rejeitar ${v.id}) ou recalcule-o.`);
      if (v.estado !== 'ausente') dependentesRejeitados.push(v.id);
    }
  }

  doc.versaoSchema = VERSAO_SCHEMA_SAIDA;
  doc.historico = [...(doc.historico ?? []), ...historico];
  return { doc, avisos, historico, dependentesRejeitados };
}
