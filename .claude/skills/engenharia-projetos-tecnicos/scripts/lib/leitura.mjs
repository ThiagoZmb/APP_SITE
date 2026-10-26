// ============================================================
// LEITURA DO MODELO → projeto-tecnico (usada pela leitura de PDF na web).
//
// O modelo (API do Claude, saída estruturada) devolve uma "leitura" no formato de esquemaLeitura(mapa):
// cada valor com o TEXTO LITERAL do desenho, página, trecho, confiança e a unidade que ele acha que vale.
// Esta função transforma a leitura num projeto-tecnico válido, aplicando as regras da skill:
//  - todo valor lido pelo modelo é "inferido" (metodo leitura_visual): só uma pessoa confirma (regra 2);
//  - cotas viram mm com interpretarCota; unidade não escrita é SEMPRE inferida → pendência unidade_ambigua;
//  - número ambíguo ("2.100") ou sem unidade nenhuma → ausente + pendência (nunca adivinha);
//  - leituras diferentes da mesma coisa → conflitante com candidatos (nunca escolhe);
//  - campo do mapa não encontrado → ausente + pendência (para a pessoa poder informar);
//  - todo texto devolvido passa por detectarInstrucoes (alertasSeguranca); o que o modelo apontou também.
// Não conhece "porta": os campos vêm do mapa do domínio (origem, tipo e "unidade": "mm").
// ============================================================
import Ajv from 'ajv';
import { interpretarCota, lerNumeroBr, UNIDADES_COMPRIMENTO } from './unidades.mjs';
import { detectarInstrucoes } from './seguranca.mjs';
import { inferido, ausente, conflitante } from './valor.mjs';

export const LIMITES_LEITURA = Object.freeze({ itens: 200, texto: 190, trecho: 300, candidatos: 5, cotas: 50, parciais: 40, contagens: 50, alertas: 50, observacoes: 2000 });
const UNIDADES_LEITURA = [...UNIDADES_COMPRIMENTO, 'desconhecida', 'nao_se_aplica'];
const METODO = 'leitura_visual';

const ehObjeto = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const curto = (t, n) => { const s = String(t ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };
const limitar = c => (typeof c === 'number' && Number.isFinite(c) ? Math.min(1, Math.max(0, c)) : 0.5);

// ---------- campos do domínio ----------
// → [{ campo, raiz, tipo, conversao }] na ordem do mapa; conversao: comprimento | lista_comprimento | inteiro | numero | texto
export function camposLeitura(mapa) {
  return mapa.campos.filter(c => /^(dimensoes|atributos)\.[^.]/.test(c.origem)).map(c => {
    const [raiz, ...resto] = c.origem.split('.');
    let conversao = 'texto';
    if (c.tipo === 'numero') conversao = c.unidade === 'mm' ? 'comprimento' : 'numero';
    else if (c.tipo === 'inteiro') conversao = 'inteiro';
    else if (c.tipo === 'lista' && c.itemTipo === 'numero') conversao = c.unidade === 'mm' ? 'lista_comprimento' : 'lista_numero';
    return { campo: resto.join('.'), raiz, tipo: c.tipo, obrigatorio: c.obrigatorio === true, destino: c.destino, conversao };
  });
}
const categoriasDo = mapa => [...(mapa.categorias ?? []), ...(mapa.foraDoEscopo?.tipos ?? [])];
const unidadeSaida = conversao => (conversao === 'comprimento' ? 'mm' : conversao === 'inteiro' ? 'un' : null);

// ---------- schema da leitura (compatível com saída estruturada: sem recursão, sem min/max, additionalProperties false) ----------
const STR = { type: 'string' };
const PAGINA = { anyOf: [{ type: 'integer' }, { type: 'null' }] };
const objeto = properties => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
const CANDIDATO = objeto({ texto: STR, pagina: PAGINA, trecho: STR, confianca: { type: 'number' } });
const valorLido = extra => objeto({
  ...extra, texto: STR, pagina: PAGINA, trecho: STR, confianca: { type: 'number' },
  unidadeSeNumero: { type: 'string', enum: UNIDADES_LEITURA }, motivoUnidade: STR,
  candidatos: { type: 'array', items: CANDIDATO },
});

export function esquemaLeitura(mapa) {
  const valor = valorLido({});
  return objeto({
    itens: {
      type: 'array',
      items: objeto({
        id: STR,
        categoria: { type: 'string', enum: categoriasDo(mapa) },
        legenda: STR,
        quantidade: valor,
        valores: { type: 'array', items: valorLido({ campo: { type: 'string', enum: camposLeitura(mapa).map(c => c.campo) } }) },
      }),
    },
    contagens: { type: 'array', items: objeto({ item: STR, descricao: STR, declarado: valor, contado: valor }) },
    cotas: { type: 'array', items: objeto({ item: STR, descricao: STR, total: valor, parciais: { type: 'array', items: valor } }) },
    textoSuspeito: { type: 'array', items: objeto({ pagina: PAGINA, trecho: STR, motivo: STR }) },
    observacoes: STR,
  });
}

// Confere a leitura com o mesmo schema enviado ao modelo (a API garante o formato, mas a resposta pode vir
// truncada ou de um cliente falso). → { ok, erros: [texto] }
const validadores = new WeakMap();
export function validarLeitura(leitura, mapa) {
  if (!validadores.has(mapa)) validadores.set(mapa, new Ajv({ allErrors: true, strict: false }).compile(esquemaLeitura(mapa)));
  const v = validadores.get(mapa);
  if (v(leitura)) return { ok: true, erros: [] };
  return { ok: false, erros: v.errors.slice(0, 20).map(e => `${e.instancePath || '(raiz)'}: ${e.message}`) };
}

// ---------- conversão de um texto lido ----------
// → { vazio } | { ok: true, valor, unidadeInferida, aviso } | { ok: false, motivo, deUnidade }
function interpretar(l, conversao) {
  const texto = String(l?.texto ?? '').trim();
  if (!texto) return { vazio: true };
  const decl = UNIDADES_COMPRIMENTO.includes(l.unidadeSeNumero) ? { unidade: l.unidadeSeNumero, inferida: true } : undefined;
  const cota = t => {
    const c = interpretarCota(t, { unidadeDeclarada: decl });
    return c.valorMm === null
      ? { ok: false, deUnidade: true, motivo: c.pendencias.map(p => p.mensagem).join('; ') || `cota "${t}" não reconhecida` }
      : { ok: true, valor: c.valorMm, unidadeInferida: c.estadoUnidade === 'inferido', aviso: c.pendencias.map(p => p.mensagem).join('; ') };
  };
  if (conversao === 'comprimento') return cota(texto);
  if (conversao === 'lista_comprimento' || conversao === 'lista_numero') {
    const partes = texto.split(';').map(p => p.trim()).filter(Boolean);
    if (!partes.length) return { vazio: true };
    const lidos = partes.map(p => (conversao === 'lista_comprimento' ? cota(p) : (n => (n.valor === null ? { ok: false, motivo: n.motivo } : { ok: true, valor: n.valor }))(lerNumeroBr(p))));
    const ruim = lidos.find(x => !x.ok);
    if (ruim) return ruim;
    // lista vira texto "100;900" com ponto decimal (formato que o mapa lê); unidade fica no mapa (mm)
    return { ok: true, valor: lidos.map(x => String(x.valor)).join(';'), unidadeInferida: lidos.some(x => x.unidadeInferida), aviso: lidos.map(x => x.aviso).filter(Boolean).join('; ') };
  }
  if (conversao === 'inteiro' || conversao === 'numero') {
    const n = lerNumeroBr(texto);
    if (n.valor === null) return { ok: false, motivo: n.motivo };
    if (conversao === 'inteiro' && !Number.isInteger(n.valor)) return { ok: false, motivo: `"${texto}" não é um número inteiro` };
    return { ok: true, valor: n.valor };
  }
  return { ok: true, valor: curto(texto, LIMITES_LEITURA.texto) };
}

// ---------- montagem do documento ----------
export function leituraParaProjeto(leitura, { arquivo, sha256, paginas, mapa }) {
  const nomeArquivo = curto(arquivo, 120) || 'projeto.pdf';
  const pendencias = [];
  const alertas = [];
  const usados = new Set();
  const paginaValida = p => (Number.isInteger(p) && p >= 1 && (!paginas || p <= paginas) ? p : null);
  const origemDe = (l, padrao) => ({ arquivo: nomeArquivo, pagina: paginaValida(l?.pagina), trecho: curto(l?.trecho, LIMITES_LEITURA.trecho) || curto(l?.texto, LIMITES_LEITURA.trecho) || padrao });
  const pend = (id, tipo, mensagem, refs, pagina) => pendencias.push({ id, tipo, mensagem: curto(mensagem, 500), refs, ...(pagina ? { pagina } : {}) });
  const vigiar = (texto, pagina) => { if (texto) alertas.push(...detectarInstrucoes(texto, paginaValida(pagina))); };
  const vigiarLido = l => { if (ehObjeto(l)) { vigiar(l.texto, l.pagina); vigiar(l.trecho, l.pagina); vigiar(l.motivoUnidade, l.pagina); (l.candidatos || []).forEach(c => { vigiar(c?.texto, c?.pagina); vigiar(c?.trecho, c?.pagina); }); } };

  // valor lido → ValorRastreavel (+ pendências). rotulo: para as mensagens
  function montarValor(l, id, conversao, rotulo) {
    vigiarLido(l);
    const unidade = unidadeSaida(conversao);
    const origem = origemDe(l, `${rotulo}: não encontrado na leitura`);
    const r = interpretar(l, conversao);
    if (r.vazio) {
      pend(`pend-${id}`, 'ausente', `${rotulo}: não encontrado na leitura do PDF.`, [id]);
      return ausente({ id, unidade, metodo: METODO, origem });
    }
    // leituras divergentes da mesma coisa → conflitante (nunca escolhe)
    const outras = (Array.isArray(l.candidatos) ? l.candidatos : []).slice(0, LIMITES_LEITURA.candidatos)
      .map(c => ({ c, r: interpretar({ ...c, unidadeSeNumero: l.unidadeSeNumero }, conversao) })).filter(x => x.r.ok);
    if (r.ok && outras.some(x => JSON.stringify(x.r.valor) !== JSON.stringify(r.valor))) {
      const todas = [{ c: l, r }, ...outras];
      const vistos = new Set();
      const unicas = todas.filter(x => { const k = JSON.stringify(x.r.valor); return !vistos.has(k) && vistos.add(k); });
      const candidatos = unicas.map((x, i) => inferido({ id: `${id}.c${i + 1}`, valor: x.r.valor, unidade, metodo: METODO, origem: origemDe(x.c, rotulo), confianca: limitar(x.c.confianca) }));
      const paginasCand = [...new Set(candidatos.map(c => c.origem.pagina).filter(Boolean))];
      pend(`pend-${id}`, 'conflitante', `${rotulo}: o desenho mostra valores diferentes (${candidatos.map(c => `${c.valor}${unidade === 'mm' ? ' mm' : ''}`).join(' x ')}); escolha o correto.`, [id], paginasCand[0]);
      if (unicas.some(x => x.r.unidadeInferida)) pend(`pend-un-${id}`, 'unidade_ambigua', `${rotulo}: unidade das cotas inferida (${l.motivoUnidade ? curto(l.motivoUnidade, 120) : 'não escrita no desenho'}).`, [id], paginasCand[0]);
      return conflitante(candidatos, { id, origem, metodo: METODO, unidade });
    }
    if (!r.ok) {
      pend(`pend-${id}`, r.deUnidade ? 'unidade_ambigua' : 'ausente', `${rotulo}: leitura "${curto(l.texto, 60)}" não pôde ser convertida (${curto(r.motivo, 200)}); informe o valor.`, [id], origem.pagina);
      return ausente({ id, unidade, metodo: METODO, origem });
    }
    pend(`pend-${id}`, 'inferido_sem_confirmacao', `${rotulo}: lido "${curto(l.texto, 60)}" (leitura visual, não confirmado).`, [id], origem.pagina);
    if (r.unidadeInferida) pend(`pend-un-${id}`, 'unidade_ambigua', `${rotulo}: unidade inferida (${l.motivoUnidade ? curto(l.motivoUnidade, 120) : 'não escrita no desenho'}); ${curto(r.aviso, 160)}.`, [id], origem.pagina);
    return inferido({ id, valor: r.valor, unidade, metodo: METODO, origem, confianca: limitar(l.confianca) });
  }

  const idUnico = (bruto, padrao) => {
    let id = String(bruto ?? '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24);
    if (!id || usados.has(id)) id = padrao;
    let k = 2;
    const base = id;
    while (usados.has(id)) id = `${base}_${k++}`;
    usados.add(id);
    return id;
  };

  const campos = camposLeitura(mapa);
  const porConversao = new Map(campos.map(c => [c.campo, c]));
  const categoriasMapa = new Set(mapa.categorias ?? []);
  const extras = { legendas: {}, observacoes: [] };
  const itens = (leitura.itens || []).slice(0, LIMITES_LEITURA.itens).map((it, n) => {
    const id = idUnico(it.id, `P${n + 1}`);
    vigiar(it.legenda, null);
    if (it.legenda) extras.legendas[id] = curto(it.legenda, 300);
    const item = { id, tipo: String(it.categoria || 'desconhecida'), quantidade: montarValor(it.quantidade, `${id}.qtd`, 'inteiro', `${id} quantidade`), dimensoes: {}, atributos: {} };
    // leituras repetidas do mesmo campo viram candidatos da primeira (nunca escolhe)
    const lidos = new Map();
    for (const v of it.valores || []) {
      if (!porConversao.has(v.campo)) continue;
      if (!lidos.has(v.campo)) lidos.set(v.campo, { ...v, candidatos: [...(v.candidatos || [])] });
      else lidos.get(v.campo).candidatos.push({ texto: v.texto, pagina: v.pagina, trecho: v.trecho, confianca: v.confianca });
    }
    // porta (categoria do domínio): todos os campos do mapa existem (ausente se não lido), para a pessoa poder informar.
    // fora do escopo: só o que foi lido.
    const completo = categoriasMapa.has(item.tipo);
    for (const c of campos) {
      if (!completo && !lidos.has(c.campo)) continue;
      item[c.raiz][c.campo] = montarValor(lidos.get(c.campo) ?? null, `${id}.${c.campo}`, c.conversao, `${id} ${c.campo}`);
    }
    return item;
  });

  // verificações cruzadas: ids prefixados pelo item quando a leitura diz a qual item se referem
  const prefixo = ref => { const alvo = itens.find(i => i.id === String(ref ?? '').trim()); return alvo ? `${alvo.id}.` : ''; };
  const cotas = (leitura.cotas || []).slice(0, LIMITES_LEITURA.cotas).map((c, n) => {
    const id = `${prefixo(c.item)}${idUnico(`cota${n + 1}`, `cota${n + 1}`)}`;
    vigiar(c.descricao, null);
    return {
      id, descricao: curto(c.descricao, 200),
      total: montarValor(c.total, `${id}.total`, 'comprimento', `cota ${id} (total)`),
      parciais: (c.parciais || []).slice(0, LIMITES_LEITURA.parciais).map((p, k) => montarValor(p, `${id}.p${k + 1}`, 'comprimento', `cota ${id} (parcial ${k + 1})`)),
    };
  });
  const contagens = (leitura.contagens || []).slice(0, LIMITES_LEITURA.contagens).map((c, n) => {
    const id = `${prefixo(c.item)}${idUnico(`contagem${n + 1}`, `contagem${n + 1}`)}`;
    vigiar(c.descricao, null);
    return {
      id, descricao: curto(c.descricao, 200),
      declarado: montarValor(c.declarado, `${id}.declarado`, 'inteiro', `contagem ${id} (declarado)`),
      contado: montarValor(c.contado, `${id}.contado`, 'inteiro', `contagem ${id} (contado)`),
    };
  });

  for (const s of leitura.textoSuspeito || []) alertas.push({ trecho: curto(s?.trecho, 300), pagina: paginaValida(s?.pagina), motivo: `apontado pela leitura: ${curto(s?.motivo, 120) || 'texto que parece instrução'}` });
  vigiar(leitura.observacoes, null);
  if (leitura.observacoes) extras.observacoes.push(curto(leitura.observacoes, LIMITES_LEITURA.observacoes));
  const vistos = new Set();
  const alertasSeguranca = alertas.filter(a => { const k = `${a.pagina}|${a.trecho}|${a.motivo}`; return !vistos.has(k) && vistos.add(k); }).slice(0, LIMITES_LEITURA.alertas);

  const documento = { arquivo: nomeArquivo };
  if (sha256) documento.sha256 = sha256;
  if (Number.isInteger(paginas) && paginas >= 1) documento.paginas = paginas;
  const doc = { versaoSchema: '1.1.0', dominio: mapa.dominio, documento, itens, pendencias, alertasSeguranca };
  if (cotas.length) doc.cotas = cotas;
  if (contagens.length) doc.contagens = contagens;
  return { doc, extras };
}
