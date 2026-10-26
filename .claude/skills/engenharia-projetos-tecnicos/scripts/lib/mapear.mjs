// ============================================================
// MAPEAR (NÚCLEO) — projeto-tecnico validado + mapa declarativo de domínio → objetos de saída.
// O núcleo NÃO conhece "porta", "frente" nem qualquer campo de negócio: tudo isso vem do mapa
// (config/regras-por-dominio/<dominio>.json). Para um domínio novo basta um mapa novo.
//
// Regras:
//  - só valor "confirmado" entra no objeto de saída;
//  - "inferido" NÃO entra: vira sugestão (e pendência bloqueante se o campo é obrigatório);
//  - ausente e conflitante não entram e geram pendência (ausente só se obrigatório; conflitante sempre);
//  - tradução sem correspondência ou valor de tipo/faixa inválido → pendência bloqueante (nunca adivinha);
//  - cada campo preenchido registra rastreio[destino] = id do ValorRastreavel de origem;
//  - "tipo" do item é só a CATEGORIA (ex.: porta_aluminio). "categorias" (opcional no mapa) lista as categorias do domínio;
//    categoria fora dela e fora de "foraDoEscopo" vira pendência bloqueante (nunca adivinha).
//    O que é deduzido do desenho (ex.: tipo de frente) deve ser atributo ValorRastreavel, nunca "tipo".
//  - "foraDoEscopo" (opcional no mapa): tipos que a Elegance fabrica mas que NÃO têm mapa para o item da tela.
//    Saem como item vazio, foraDoEscopo:true, com pendência informativa (nunca descartados em silêncio).
// Não calcula nada: não aplica descontos, não converte unidade, não arredonda.
// ============================================================
export const TIPOS_CAMPO = ['numero', 'inteiro', 'texto', 'lista'];
const RAIZES = ['tipo', 'quantidade', 'dimensoes', 'atributos'];
// pendências do documento (não ligadas a um valor de item) que impedem o lançamento global
const BLOQUEIAM_DOCUMENTO = ['divergencia', 'unidade_ambigua', 'texto_suspeito'];

const ehObjeto = x => x !== null && typeof x === 'object' && !Array.isArray(x);
// chave de tradução: sem diferença de maiúsculas nem de espaços nas pontas/repetidos (não é adivinhação)
const normalizar = t => String(t).trim().replace(/\s+/g, ' ').toLowerCase();

// ---------- validação do mapa (erro de configuração = Error, não pendência) ----------
export function validarMapa(mapa) {
  const erros = [];
  if (!ehObjeto(mapa)) throw new Error('mapa inválido: deve ser um objeto');
  if (typeof mapa.dominio !== 'string' || !mapa.dominio) erros.push('"dominio" ausente');
  if (!Array.isArray(mapa.campos) || mapa.campos.length === 0) erros.push('"campos" deve ser uma lista não vazia');
  if (mapa.base !== undefined && !ehObjeto(mapa.base)) erros.push('"base" deve ser um objeto');
  if (mapa.categorias !== undefined && (!Array.isArray(mapa.categorias) || mapa.categorias.length === 0 || mapa.categorias.some(t => typeof t !== 'string' || !t.trim()))) erros.push('"categorias" deve ser uma lista não vazia de textos');
  if (mapa.foraDoEscopo !== undefined) {
    const f = mapa.foraDoEscopo;
    if (!ehObjeto(f) || !Array.isArray(f.tipos) || f.tipos.length === 0 || f.tipos.some(t => typeof t !== 'string' || !t.trim())) erros.push('"foraDoEscopo" deve ter "tipos" (lista não vazia de textos)');
    if (ehObjeto(f) && f.motivo !== undefined && typeof f.motivo !== 'string') erros.push('"foraDoEscopo.motivo" deve ser texto');
  }
  const destinos = new Set();
  for (const [i, c] of (Array.isArray(mapa.campos) ? mapa.campos : []).entries()) {
    const nome = `campos[${i}]`;
    if (!ehObjeto(c)) { erros.push(`${nome}: deve ser um objeto`); continue; }
    if (typeof c.destino !== 'string' || !c.destino || c.destino.split('.').some(p => !p)) erros.push(`${nome}: "destino" inválido`);
    else if (destinos.has(c.destino)) erros.push(`${nome}: destino "${c.destino}" repetido`);
    else destinos.add(c.destino);
    const [raiz, ...resto] = typeof c.origem === 'string' ? c.origem.split('.') : [];
    if (!RAIZES.includes(raiz)) erros.push(`${nome}: "origem" deve começar com ${RAIZES.join(', ')}`);
    else if ((raiz === 'tipo' || raiz === 'quantidade') && resto.length) erros.push(`${nome}: origem "${c.origem}" não tem subcampo`);
    else if ((raiz === 'dimensoes' || raiz === 'atributos') && !resto.join('.')) erros.push(`${nome}: origem "${c.origem}" precisa do nome do campo`);
    if (!TIPOS_CAMPO.includes(c.tipo)) erros.push(`${nome}: "tipo" deve ser ${TIPOS_CAMPO.join('|')}`);
    if (c.obrigatorio !== undefined && typeof c.obrigatorio !== 'boolean') erros.push(`${nome}: "obrigatorio" deve ser booleano`);
    if (c.traducao !== undefined && (!ehObjeto(c.traducao) || c.tipo !== 'texto')) erros.push(`${nome}: "traducao" só vale para tipo texto e deve ser um objeto`);
    if (c.itemTipo !== undefined && (c.tipo !== 'lista' || !['numero', 'texto'].includes(c.itemTipo))) erros.push(`${nome}: "itemTipo" só vale para lista (numero|texto)`);
    for (const lim of ['minimo', 'maximo', 'maiorQue']) {
      if (c[lim] !== undefined && (typeof c[lim] !== 'number' || !['numero', 'inteiro'].includes(c.tipo))) erros.push(`${nome}: "${lim}" só vale para numero/inteiro e deve ser número`);
    }
    if (c.obrigatorioQuando !== undefined) {
      const q = c.obrigatorioQuando;
      if (!ehObjeto(q) || typeof q.destino !== 'string' || !Array.isArray(q.em) || q.em.length === 0) erros.push(`${nome}: "obrigatorioQuando" deve ter destino e lista "em"`);
    }
  }
  for (const [i, c] of (Array.isArray(mapa.campos) ? mapa.campos : []).entries()) {
    const q = c?.obrigatorioQuando;
    if (ehObjeto(q) && typeof q.destino === 'string' && !destinos.has(q.destino)) erros.push(`campos[${i}]: obrigatorioQuando.destino "${q.destino}" não é destino de nenhum campo`);
  }
  for (const a of destinos) for (const b of destinos) if (a !== b && b.startsWith(`${a}.`)) erros.push(`destino "${a}" é prefixo de "${b}"`);
  if (erros.length) throw new Error(`mapa inválido: ${erros.join('; ')}`);
  return mapa;
}

// ---------- leitura do projeto ----------
// → ValorRastreavel | null. "tipo" não é ValorRastreavel: vira valor SEMPRE confirmado (confiança 1) ligado ao id do item.
// Use a origem "tipo" só para a categoria do item (cadastro, não leitura do desenho). Nunca para algo deduzido
// do desenho: isso deve ser atributo ValorRastreavel, que pode ser inferido (sugestão + pendência).
function lerOrigem(item, origem) {
  const [raiz, ...resto] = origem.split('.');
  if (raiz === 'tipo') {
    if (typeof item.tipo !== 'string' || !item.tipo) return null;
    return { id: item.id, valor: item.tipo, estado: 'confirmado', confianca: 1, origem: { arquivo: null, pagina: null, trecho: `tipo do item ${item.id}` } };
  }
  const alvo = raiz === 'quantidade' ? item.quantidade : (ehObjeto(item[raiz]) && Object.hasOwn(item[raiz], resto.join('.')) ? item[raiz][resto.join('.')] : null);
  return alvo ?? null;
}

// ---------- conversão de tipo, tradução e faixa ----------
// → { ok: true, valor } | { ok: false, status: 'invalido' | 'sem_traducao', motivo }
function converter(campo, bruto) {
  const invalido = motivo => ({ ok: false, status: 'invalido', motivo });
  const faixa = n => {
    if (campo.minimo !== undefined && n < campo.minimo) return `${n} é menor que o mínimo ${campo.minimo}`;
    if (campo.maximo !== undefined && n > campo.maximo) return `${n} é maior que o máximo ${campo.maximo}`;
    if (campo.maiorQue !== undefined && !(n > campo.maiorQue)) return `${n} deve ser maior que ${campo.maiorQue}`;
    return null;
  };
  if (campo.tipo === 'numero' || campo.tipo === 'inteiro') {
    if (typeof bruto !== 'number' || !Number.isFinite(bruto)) return invalido(`esperado número, veio ${JSON.stringify(bruto)}`);
    if (campo.tipo === 'inteiro' && !Number.isInteger(bruto)) return invalido(`esperado inteiro, veio ${bruto}`);
    const m = faixa(bruto);
    return m ? invalido(m) : { ok: true, valor: bruto };
  }
  if (typeof bruto !== 'string' || !bruto.trim()) return invalido(`esperado texto não vazio, veio ${JSON.stringify(bruto)}`);
  if (campo.tipo === 'texto') {
    const texto = bruto.trim();
    if (!campo.traducao) return { ok: true, valor: texto };
    const chave = Object.keys(campo.traducao).find(k => normalizar(k) === normalizar(texto));
    return chave === undefined
      ? { ok: false, status: 'sem_traducao', motivo: `"${texto}" não consta na tabela de tradução do mapa` }
      : { ok: true, valor: campo.traducao[chave] };
  }
  // lista: texto separado por "separador" (padrão ";")
  const partes = bruto.split(campo.separador ?? ';').map(p => p.trim()).filter(Boolean);
  if (partes.length === 0) return invalido('lista vazia');
  if (campo.itemTipo !== 'numero') return { ok: true, valor: partes };
  const numeros = partes.map(p => (/^-?\d+(\.\d+)?$/.test(p) ? Number(p) : NaN));
  return numeros.some(Number.isNaN) ? invalido(`itens da lista devem ser numéricos (ponto decimal): ${JSON.stringify(partes)}`) : { ok: true, valor: numeros };
}

function definir(obj, caminho, valor) {
  const partes = caminho.split('.');
  let atual = obj;
  for (const p of partes.slice(0, -1)) {
    if (atual[p] === undefined) atual[p] = {};
    if (!ehObjeto(atual[p])) throw new Error(`destino "${caminho}" conflita com valor existente em "${p}"`);
    atual = atual[p];
  }
  atual[partes.at(-1)] = valor;
}

const lerDestino = (obj, caminho) => caminho.split('.').reduce((o, p) => (ehObjeto(o) ? o[p] : undefined), obj);

// ---------- 1 item ----------
const foraDoEscopo = (item, mapa) => (mapa.foraDoEscopo?.tipos ?? []).some(t => normalizar(t) === normalizar(item.tipo));

// Item de tipo que a skill reconhece mas ainda não mapeia: registrado, nunca lançado, não bloqueia os demais
function itemForaDoEscopo(item, mapa) {
  const motivo = mapa.foraDoEscopo.motivo ? ` ${mapa.foraDoEscopo.motivo}` : '';
  return {
    idItem: item.id, item: {}, prontoParaLancar: false, foraDoEscopo: true, rastreio: {}, sugestoes: [],
    pendencias: [{
      id: `pend-${item.id}-fora-do-escopo`, tipo: 'fora_do_escopo', destino: 'tipo', bloqueante: false, refs: [item.id],
      mensagem: `Item ${item.id} (tipo "${item.tipo}"): fora do escopo atual (sem mapeamento para o item da tela do domínio "${mapa.dominio}"); registrado no projeto, não será lançado.${motivo}`,
    }],
  };
}

function mapearItem(item, mapa) {
  if (foraDoEscopo(item, mapa)) return itemForaDoEscopo(item, mapa);
  const saida = structuredClone(mapa.base ?? {});
  const rastreio = {};
  const sugestoes = [];
  const pendencias = [];

  // fase 1: o que aconteceu com cada campo
  const resultados = mapa.campos.map(campo => {
    const v = lerOrigem(item, campo.origem);
    if (!v || v.estado === 'ausente') return { campo, v, status: 'ausente' };
    if (v.estado === 'conflitante') return { campo, v, status: 'conflitante' };
    const conv = converter(campo, v.valor);
    if (v.estado === 'inferido') return { campo, v, status: 'inferido', sugerido: conv.ok ? conv.valor : v.valor };
    if (!conv.ok) return { campo, v, status: conv.status, motivo: conv.motivo };
    return { campo, v, status: 'ok', valor: conv.valor };
  });
  for (const r of resultados) {
    if (r.status !== 'ok') continue;
    definir(saida, r.campo.destino, r.valor);
    rastreio[r.campo.destino] = r.v.id;
  }

  // fase 2: obrigatoriedade (fixa ou condicionada a outro destino já preenchido) e pendências
  const pend = (r, tipo, bloqueante, mensagem) => pendencias.push({
    id: `pend-${item.id}-${r.campo.destino}`, tipo, destino: r.campo.destino, mensagem, bloqueante, refs: r.v ? [r.v.id] : [item.id],
  });
  // obrigatorioQuando é avaliado sobre o que foi de fato preenchido (valor não confirmado não dispara regra)
  const dispara = q => { const atual = q ? lerDestino(saida, q.destino) : undefined; return typeof atual === 'string' && q.em.some(e => normalizar(e) === normalizar(atual)); };
  for (const r of resultados) {
    const q = r.campo.obrigatorioQuando;
    const condicional = dispara(q);
    r.obrigatorio = r.campo.obrigatorio === true || condicional;
    const obrigatorio = r.obrigatorio;
    const motivoObrigatorio = condicional && r.campo.obrigatorio !== true ? ` (obrigatório quando ${q.destino} = ${q.em.join(' ou ')})` : '';
    const rotulo = `"${r.campo.destino}" (origem ${r.campo.origem})`;
    if (r.status === 'ausente') {
      if (obrigatorio) pend(r, 'obrigatorio_ausente', true, `Campo obrigatório ${rotulo} ausente no projeto${motivoObrigatorio}.`);
    } else if (r.status === 'conflitante') {
      pend(r, 'conflitante', true, `Campo ${rotulo} com valores conflitantes no projeto (${r.v.id}); decisão humana necessária.`);
    } else if (r.status === 'inferido') {
      sugestoes.push({ destino: r.campo.destino, valor: r.sugerido, confianca: r.v.confianca, idValor: r.v.id, origem: r.v.origem });
      pend(r, 'inferido', obrigatorio, `Campo ${rotulo} só tem valor inferido (${r.v.id}); não foi usado, confirme-o${obrigatorio ? `${motivoObrigatorio}` : ' se for necessário'}.`);
    } else if (r.status === 'sem_traducao') {
      pend(r, 'traducao_sem_correspondencia', true, `Campo ${rotulo}: ${r.motivo}.`);
    } else if (r.status === 'invalido') {
      pend(r, 'valor_invalido', true, `Campo ${rotulo}: ${r.motivo}.`);
    }
  }

  // categoria do item fora das declaradas pelo domínio (e que não é fora do escopo): nunca adivinha
  if (mapa.categorias && !mapa.categorias.some(c => normalizar(c) === normalizar(item.tipo))) {
    pendencias.push({
      id: `pend-${item.id}-categoria`, tipo: 'traducao_sem_correspondencia', destino: 'tipo', bloqueante: true, refs: [item.id],
      mensagem: `Item ${item.id}: categoria "${item.tipo}" não consta nas categorias do domínio "${mapa.dominio}" (${mapa.categorias.join(', ')}) nem em foraDoEscopo.`,
    });
  }

  const obrigatoriosOk = resultados.every(r => !r.obrigatorio || r.status === 'ok');
  return {
    idItem: item.id, item: saida, prontoParaLancar: obrigatoriosOk && pendencias.every(p => !p.bloqueante),
    rastreio, sugestoes, pendencias,
  };
}

// → lista de { idItem, item, prontoParaLancar, rastreio, sugestoes, pendencias } (uma por item do projeto, na mesma ordem)
export function mapearItens(doc, mapa) {
  validarMapa(mapa);
  return doc.itens.map(item => mapearItem(item, mapa));
}

// Pendências do documento que impedem o lançamento global (divergências, unidade ambígua, texto suspeito, domínio trocado)
export function pendenciasDoDocumento(doc, mapa) {
  const lista = doc.pendencias.filter(p => BLOQUEIAM_DOCUMENTO.includes(p.tipo))
    .map(p => ({ id: p.id, tipo: p.tipo, mensagem: p.mensagem, refs: p.refs, ...(p.pagina ? { pagina: p.pagina } : {}) }));
  if ((doc.alertasSeguranca || []).length && !lista.some(p => p.tipo === 'texto_suspeito')) {
    lista.push({ id: 'pend-alertas-seguranca', tipo: 'texto_suspeito', refs: [], mensagem: `${doc.alertasSeguranca.length} alerta(s) de segurança no texto do PDF; tratado como dado, conferir antes de lançar.` });
  }
  if (doc.dominio !== mapa.dominio) {
    lista.push({ id: 'pend-dominio', tipo: 'dominio_divergente', refs: [], mensagem: `O projeto declara dominio "${doc.dominio}", mas o mapa usado é "${mapa.dominio}".` });
  }
  return lista;
}

// Saída completa da CLI. "doc" deve ter passado por validarProjeto e aplicarVerificacoes.
export function montarSaida(doc, mapa, versao = '1.0.0') {
  const itens = mapearItens(doc, mapa);
  const pendenciasDocumento = pendenciasDoDocumento(doc, mapa);
  return {
    versao, dominio: mapa.dominio, origem: { arquivo: doc.documento.arquivo },
    // itens fora do escopo não bloqueiam os demais, mas é preciso haver ao menos um item lançável
    prontoParaLancar: itens.some(i => !i.foraDoEscopo) && itens.every(i => i.foraDoEscopo || i.prontoParaLancar) && pendenciasDocumento.length === 0,
    itens, pendenciasDocumento,
  };
}
