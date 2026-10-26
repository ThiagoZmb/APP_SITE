// ============================================================
// RELATÓRIO em Markdown (pt-BR), determinístico. Inferido NUNCA aparece como fato.
// Ordem estável: documento na ordem do JSON; chaves de dimensoes/atributos em ordem alfabética.
// ============================================================
import { ESTADOS } from './regras.mjs';

const limpar = t => String(t ?? '').replace(/\s+/g, ' ').trim();
const ordenadas = mapa => Object.entries(mapa || {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

function textoValor(v) {
  if (v.valor === null) return '—';
  const n = typeof v.valor === 'number' ? String(v.valor).replace('.', ',') : `"${limpar(v.valor)}"`;
  return v.unidade ? `${n} ${v.unidade}` : n;
}

const textoPagina = p => (Number.isInteger(p) ? `p. ${p}` : 'página não informada');
const textoOrigem = o => `${o.arquivo}, ${textoPagina(o.pagina)}, trecho "${limpar(o.trecho)}"`;

// Lista plana de valores de primeiro nível, com rótulo legível
function listarValores(doc) {
  const lista = [];
  const add = (v, rotulo) => lista.push({ v, rotulo: `${rotulo} [${v.id}]` });
  for (const it of doc.itens) {
    const b = `Item ${it.id} (${it.tipo})`;
    add(it.quantidade, `${b} › quantidade`);
    ordenadas(it.dimensoes).forEach(([k, v]) => add(v, `${b} › dimensoes.${k}`));
    ordenadas(it.atributos).forEach(([k, v]) => add(v, `${b} › atributos.${k}`));
  }
  for (const c of doc.cotas || []) {
    const b = `Cota ${c.id} (${limpar(c.descricao)})`;
    add(c.total, `${b} › total`);
    c.parciais.forEach((p, i) => add(p, `${b} › parcial ${i + 1}`));
  }
  for (const c of doc.contagens || []) {
    const b = `Contagem ${c.id} (${limpar(c.descricao)})`;
    add(c.declarado, `${b} › declarado`);
    add(c.contado, `${b} › contado`);
  }
  return lista;
}

function linhaValor({ v, rotulo }, prefixo = '') {
  const partes = [`- ${prefixo}${rotulo}: ${textoValor(v)}`, `confiança ${String(v.confianca).replace('.', ',')}`, `origem: ${textoOrigem(v.origem)}`];
  if (v.regra) partes.push(`calculado por: ${limpar(v.regra)}`);
  if (v.confirmacao) partes.push(`confirmado por ${limpar(v.confirmacao.por)} em ${v.confirmacao.em}${v.confirmacao.nota ? ` (${limpar(v.confirmacao.nota)})` : ''}`);
  return partes.join(' — ');
}

const secao = (titulo, linhas, vazio) => [`## ${titulo}`, '', ...(linhas.length ? linhas : [vazio]), ''];

function linhasPendencia(p, porId) {
  const pag = Array.isArray(p.paginas) && p.paginas.length ? `páginas ${p.paginas.join(', ')}` : Number.isInteger(p.pagina) ? `página ${p.pagina}` : 'página não informada';
  const linhas = [`- [${p.tipo}] ${limpar(p.mensagem)} (${pag}) — refs: ${p.refs.length ? p.refs.join(', ') : '—'}`];
  for (const ref of p.refs) {
    const v = porId.get(ref);
    if (v?.estado === 'conflitante') {
      const cands = v.candidatos.map(c => `${textoValor(c)} (${textoPagina(c.origem.pagina)})`).join('; ');
      linhas.push(`  - Candidatos de ${ref}: ${cands} — nenhum foi escolhido`);
    }
  }
  return linhas;
}

// Itens de tipos reconhecidos mas sem mapeamento (ver "foraDoEscopo" no mapa do domínio)
function linhasForaDoEscopo(doc, foraDoEscopo) {
  const tipos = new Set((foraDoEscopo?.tipos ?? []).map(t => limpar(t).toLowerCase()));
  return doc.itens.filter(it => tipos.has(limpar(it.tipo).toLowerCase()))
    .map(it => `- Item ${it.id} (${it.tipo}): fora do escopo atual (sem mapeamento); registrado, não será lançado no orçamento/pedido.`);
}

const linhasHistorico = doc => (doc.historico || []).map(h => `- ${h.em} — ${limpar(h.por)}: ${h.acao} (${h.ids.length ? h.ids.join(', ') : '—'})${h.nota ? ` — ${limpar(h.nota)}` : ''}`);

// opcoes.foraDoEscopo: { tipos } do mapa do domínio (a seção só aparece se houver item desses tipos)
export function gerarRelatorio(doc, opcoes = {}) {
  const fora = linhasForaDoEscopo(doc, opcoes.foraDoEscopo);
  const hist = linhasHistorico(doc);
  const valores = listarValores(doc);
  const porId = new Map(valores.map(x => [x.v.id, x.v]));
  const contagem = Object.fromEntries(ESTADOS.map(e => [e, valores.filter(x => x.v.estado === e).length]));
  const doEstado = e => valores.filter(x => x.v.estado === e);

  const linhas = [
    '# Relatório de projeto técnico', '',
    `- Arquivo: ${doc.documento.arquivo}`,
    `- Domínio: ${doc.dominio}`,
    `- Versão do schema: ${doc.versaoSchema}`, '',
    ...secao('Resumo', [
      ...ESTADOS.map(e => `- ${e}: ${contagem[e]}`),
      `- Pendências: ${doc.pendencias.length}`,
      `- Alertas de segurança: ${doc.alertasSeguranca.length}`,
    ]),
    ...secao('Confirmado', doEstado('confirmado').map(x => linhaValor(x)), 'Nenhum valor confirmado.'),
    ...secao('Inferido', doEstado('inferido').map(x => linhaValor(x, 'INFERIDO — conferir: ')), 'Nenhum valor inferido.'),
    ...secao('Pendências', doc.pendencias.flatMap(p => linhasPendencia(p, porId)), 'Nenhuma pendência.'),
    ...secao('Alertas de segurança', doc.alertasSeguranca.map(a => `- ${textoPagina(a.pagina)}: "${limpar(a.trecho)}" — ${limpar(a.motivo)}`), 'Nenhum alerta.'),
    ...(fora.length ? secao('Fora do escopo atual (sem mapeamento)', fora) : []),
    ...(hist.length ? secao('Histórico de confirmações', hist) : []),
  ];
  return `${linhas.join('\n').trimEnd()}\n`;
}
