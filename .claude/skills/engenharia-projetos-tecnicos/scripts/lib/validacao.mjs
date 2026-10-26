// ============================================================
// VALIDAÇÃO DO projeto-tecnico: JSON Schema (ajv) + regras semânticas.
// Só roda as regras semânticas se o schema passar (evita erros em cascata).
// ============================================================
import { readFileSync } from 'node:fs';
import Ajv from 'ajv';
import { errosDoValor, exigePendencia, piorEstado, POSICAO } from './regras.mjs';

const SCHEMA = JSON.parse(readFileSync(new URL('../../schemas/projeto-tecnico.schema.json', import.meta.url), 'utf8'));
let validadorSchema = null;
const schema = () => (validadorSchema ??= new Ajv({ allErrors: true, strict: true, strictRequired: false, allowUnionTypes: true }).compile(SCHEMA));

const chave = k => (/^[A-Za-z_]\w*$/.test(k) ? `.${k}` : `["${k}"]`);

// "/itens/0/quantidade" → "itens[0].quantidade"
function caminhoJson(ponteiro) {
  return ponteiro.split('/').slice(1).map(s => s.replace(/~1/g, '/').replace(/~0/g, '~'))
    .reduce((acc, s) => (/^\d+$/.test(s) ? `${acc}[${s}]` : acc ? `${acc}${chave(s)}` : s), '') || '(raiz)';
}

function mensagemAjv(e) {
  const p = e.params || {};
  if (e.keyword === 'required') return { caminho: `${caminhoJson(e.instancePath)}${chave(p.missingProperty)}`.replace(/^\(raiz\)\./, ''), mensagem: 'propriedade obrigatória ausente' };
  if (e.keyword === 'additionalProperties') return { caminho: `${caminhoJson(e.instancePath)}${chave(p.additionalProperty)}`.replace(/^\(raiz\)\./, ''), mensagem: 'propriedade não prevista no schema' };
  let mensagem = e.message;
  if (e.keyword === 'enum') mensagem = `valor inválido; permitidos: ${p.allowedValues.map(v => JSON.stringify(v)).join(', ')}` +
    (e.instancePath.endsWith('/unidade') ? ' (comprimento deve ser convertido para mm antes)' : '');
  return { caminho: caminhoJson(e.instancePath), mensagem };
}

function errosDoSchema(doc) {
  const v = schema();
  if (v(doc)) return [];
  const vistos = new Set();
  return v.errors.filter(e => e.keyword !== 'if').map(mensagemAjv)
    .filter(x => { const k = `${x.caminho}|${x.mensagem}`; return !vistos.has(k) && vistos.add(k); });
}

// Lista todos os valores rastreáveis "de primeiro nível" com caminho e papel
export function coletarValores(doc) {
  const lista = [];
  const add = (v, caminho, papel) => lista.push({ v, caminho, papel });
  doc.itens.forEach((it, i) => {
    const b = `itens[${i}]`;
    add(it.quantidade, `${b}.quantidade`, 'quantidade');
    for (const [k, v] of Object.entries(it.dimensoes)) add(v, `${b}.dimensoes${chave(k)}`, 'dimensao');
    for (const [k, v] of Object.entries(it.atributos)) add(v, `${b}.atributos${chave(k)}`, 'atributo');
  });
  (doc.cotas || []).forEach((c, i) => {
    add(c.total, `cotas[${i}].total`, 'cotaTotal');
    c.parciais.forEach((p, j) => add(p, `cotas[${i}].parciais[${j}]`, 'cotaParcial'));
  });
  (doc.contagens || []).forEach((c, i) => {
    add(c.declarado, `contagens[${i}].declarado`, 'contagem');
    add(c.contado, `contagens[${i}].contado`, 'contagem');
  });
  return lista;
}

const UNIDADES_DO_PAPEL = {
  quantidade: ['un'], contagem: ['un'], cotaTotal: ['mm'], cotaParcial: ['mm'], dimensao: ['mm', 'm2', 'kg'],
};

// Regra 1: comprimentos sempre em mm; quantidades sempre em "un"
function errosDeUnidade(v, caminho, papel) {
  const permitidas = UNIDADES_DO_PAPEL[papel];
  if (!permitidas) return [];
  const alvos = v.estado === 'conflitante' ? (v.candidatos || []).map((c, i) => [c, `${caminho}.candidatos[${i}]`]) : [[v, caminho]];
  const erros = [];
  for (const [x, c] of alvos) {
    if (x.valor === null || x.valor === undefined) continue;
    if (x.unidade === null && papel !== 'dimensao') erros.push({ caminho: c, mensagem: `unidade ausente; esperado "${permitidas.join('" ou "')}"` });
    else if (x.unidade === null) erros.push({ caminho: c, mensagem: 'dimensão numérica sem unidade; use "mm" (comprimento) ou outra unidade válida' });
    else if (!permitidas.includes(x.unidade)) erros.push({ caminho: c, mensagem: `unidade "${x.unidade}" não permitida aqui; esperado "${permitidas.join('" ou "')}" (comprimento interno é mm)` });
  }
  return erros;
}

// Regra 5: o calculado não pode ser "melhor" que o pior estado das entradas
function errosDoCalculado(v, caminho, porId) {
  if (v.metodo !== 'calculado' || !Array.isArray(v.origem?.entradas)) return [];
  const erros = [];
  const estados = [];
  for (const id of v.origem.entradas) {
    const entrada = porId.get(id);
    if (!entrada) erros.push({ caminho: `${caminho}.origem.entradas`, mensagem: `entrada "${id}" não existe no documento` });
    else if (entrada === v) erros.push({ caminho: `${caminho}.origem.entradas`, mensagem: `valor "${id}" não pode depender de si mesmo` });
    else estados.push(entrada.estado);
  }
  if (erros.length || estados.length === 0) return erros;
  const pior = piorEstado(estados);
  if (POSICAO[pior] === 2 && v.estado !== 'ausente') {
    erros.push({ caminho, mensagem: `calculado com entrada "${pior}" deve ser "ausente", mas está "${v.estado}"` });
  } else if (POSICAO[v.estado] < POSICAO[pior]) {
    erros.push({ caminho, mensagem: `calculado "${v.estado}" é melhor que o pior estado das entradas ("${pior}")` });
  }
  return erros;
}

// Regra 7: ids únicos em todo o documento (itens, cotas, contagens, pendências, valores e candidatos)
function errosDeIds(doc, valores) {
  const vistos = new Map();
  const erros = [];
  const ver = (id, caminho) => {
    if (vistos.has(id)) erros.push({ caminho, mensagem: `id "${id}" repetido (já usado em ${vistos.get(id)})` });
    else vistos.set(id, caminho);
  };
  doc.itens.forEach((x, i) => ver(x.id, `itens[${i}].id`));
  (doc.cotas || []).forEach((x, i) => ver(x.id, `cotas[${i}].id`));
  (doc.contagens || []).forEach((x, i) => ver(x.id, `contagens[${i}].id`));
  doc.pendencias.forEach((x, i) => ver(x.id, `pendencias[${i}].id`));
  for (const { v, caminho } of valores) {
    ver(v.id, `${caminho}.id`);
    (v.candidatos || []).forEach((c, i) => ver(c.id, `${caminho}.candidatos[${i}].id`));
  }
  return { erros, ids: new Set(vistos.keys()) };
}

// Regra 6: todo valor ausente/conflitante/inferido-sem-confirmação aparece em pendencias
function errosDePendencias(doc, valores, ids) {
  const erros = [];
  const cobertos = new Set();
  doc.pendencias.forEach((p, i) => p.refs.forEach((r, j) => {
    if (!ids.has(r)) erros.push({ caminho: `pendencias[${i}].refs[${j}]`, mensagem: `referência "${r}" não existe no documento` });
    cobertos.add(r);
  }));
  for (const { v, caminho } of valores) {
    if (exigePendencia(v) && !cobertos.has(v.id)) {
      const motivo = v.estado === 'inferido' ? 'inferido sem confirmação humana' : v.estado;
      erros.push({ caminho, mensagem: `valor "${v.id}" (${motivo}) não consta em pendencias; registre uma pendência com refs ["${v.id}"]` });
    }
  }
  return erros;
}

function errosSemanticos(doc) {
  const valores = coletarValores(doc);
  const porId = new Map(valores.map(x => [x.v.id, x.v]));
  const { erros: errosIds, ids } = errosDeIds(doc, valores);
  const erros = [...errosIds];
  for (const { v, caminho, papel } of valores) {
    erros.push(...errosDoValor(v, caminho), ...errosDeUnidade(v, caminho, papel), ...errosDoCalculado(v, caminho, porId));
  }
  erros.push(...errosDePendencias(doc, valores, ids));
  return erros;
}

// → { ok, erros: [{ caminho, mensagem }] }
export function validarProjeto(doc) {
  let erros = errosDoSchema(doc);
  if (erros.length === 0) erros = errosSemanticos(doc);
  return { ok: erros.length === 0, erros };
}
