// ============================================================
// PESO DAS PORTAS (etapa 1) — funções puras, sem banco.
// O banco do VB não tem peso: o peso por produto é cadastrado na web (`web_pesos`).
//  - perfil, divisor e puxador: kg por metro (`kg_m`) × comprimento total das peças;
//  - vidro (REVESTIMENTO): kg por m² por mm de espessura (`kg_m2_mm`) × área da folha × espessura lida do nome ("Reflecta Bronze 4mm" -> 4);
//  - acessório: kg por unidade (`kg_un`) — ainda não entra no cálculo da porta (etapa 1).
// Peso sem cadastro (ou sem espessura, ou sem medida) NUNCA vira zero: vira pendência e o resultado fica `parcial`.
// Folha = formato de calculo/engenharia.js `folhasDoItem` (altura, largura, perfil, puxador, tamanhoPuxador, qtdPuxador, revestimento,
// divisor, qtdDivH, qtdDivV, tamDivH, tamDivV), mais as quantidades/medidas de perfil já calculadas (as mesmas que o pedido grava
// em `perfis`, ver calculo/corte_pecas.js): qtdAltura, qtdLargura (peças POR PORTA), tamAltura e tamLargura (mm; padrão = altura/largura).
// ============================================================
const TIPOS_PESO = ['perfil', 'puxador', 'vidro', 'acessorio'];
const UNIDADES_PESO = ['kg_m', 'kg_m2_mm', 'kg_un'];
// unidade aceita por tipo (acessório também pode ser vendido por metro)
const UNIDADES_POR_TIPO = { perfil: ['kg_m'], puxador: ['kg_m'], vidro: ['kg_m2_mm'], acessorio: ['kg_un', 'kg_m'] };
const LIMITE_PRODUTO = 190;
const LIMITE_VALOR = 99999999; // DECIMAL(12,4)

const txt = v => String(v ?? '').trim();
const arred3 = n => Math.round((n + Number.EPSILON) * 1000) / 1000;
const medida = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const chaveProduto = s => txt(s).toLowerCase().replace(/\s+/g, ' ');
const chaveTabela = (tipo, produto) => `${tipo}|${chaveProduto(produto)}`;

// número > 0 com vírgula OU ponto decimal; "1.234,56", milhar "1.500", texto e negativo = NaN (mesma regra de calculo/tintas.js)
function numeroPositivo(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  const s = txt(v);
  if (!/^\d+([.,]\d+)?$/.test(s) || /^\d{1,3}(\.\d{3})+$/.test(s)) return NaN;
  return Number(s.replace(',', '.'));
}

// Valida um cadastro de peso. Entrada: { tipo, produto, unidadePeso, kgPorUnidade }
function validarPeso(b = {}) {
  const erros = [];
  const tipo = txt(b.tipo), produto = txt(b.produto), unidadePeso = txt(b.unidadePeso);
  if (!TIPOS_PESO.includes(tipo)) erros.push('Tipo inválido (perfil, puxador, vidro ou acessorio).');
  if (!produto) erros.push('Produto é obrigatório.');
  else if (produto.length > LIMITE_PRODUTO) erros.push(`Produto muito longo (máximo ${LIMITE_PRODUTO} caracteres).`);
  if (!UNIDADES_PESO.includes(unidadePeso)) erros.push('Unidade de peso inválida (kg_m, kg_m2_mm ou kg_un).');
  else if (TIPOS_PESO.includes(tipo) && !UNIDADES_POR_TIPO[tipo].includes(unidadePeso)) erros.push(`A unidade ${unidadePeso} não vale para o tipo ${tipo}.`);
  const valor = numeroPositivo(b.kgPorUnidade);
  if (!(valor > 0) || valor > LIMITE_VALOR) erros.push('Peso inválido (número maior que zero, com vírgula ou ponto decimal).');
  return { erros, dados: { tipo, produto, unidadePeso, kgPorUnidade: erros.length ? 0 : Math.round(valor * 10000) / 10000 } };
}

// Espessura em mm lida do nome: "Reflecta Bronze 4mm" -> 4; "Incolor 8,0 MM" -> 8; sem número seguido de mm = null
function espessuraDoNome(nome) {
  const m = txt(nome).match(/(\d+(?:[.,]\d+)?)\s*mm\b/i);
  if (!m) return null;
  const n = Number(m[1].replace(',', '.'));
  return n > 0 ? n : null;
}

// Monta o mapa a partir de linhas { tipo, produto, unidadePeso, kgPorUnidade }
function montarTabela(linhas = []) {
  const mapa = new Map();
  for (const l of linhas) mapa.set(chaveTabela(txt(l.tipo), l.produto), { unidadePeso: txt(l.unidadePeso), kgPorUnidade: Number(l.kgPorUnidade) });
  return mapa;
}
// `tabela` pode ser Map (montarTabela), objeto { 'tipo|produto': {...} } ou lista de linhas
function buscar(tabela, tipo, produto) {
  const k = chaveTabela(tipo, produto);
  if (tabela instanceof Map) return tabela.get(k) || null;
  if (Array.isArray(tabela)) return tabela.find(l => chaveTabela(txt(l.tipo), l.produto) === k) || null;
  return (tabela && tabela[k]) || null;
}

// Peso de uma folha (UMA porta). Retorna { pesoKg, partes:[{tipo,produto,kg}], pendencias:[{tipo,produto,motivo}], parcial }
function pesoFolha(folha = {}, tabela) {
  const partes = [], pendencias = [];
  const pend = (tipo, produto, motivo) => pendencias.push({ tipo, produto: txt(produto), motivo });
  // devolve o cadastro se existir e tiver a unidade certa; senão registra a pendência
  const cadastro = (tipo, produto, unidade) => {
    const c = buscar(tabela, tipo, produto);
    if (!c || !(Number(c.kgPorUnidade) > 0)) { pend(tipo, produto, 'Peso não cadastrado.'); return null; }
    if (c.unidadePeso !== unidade) { pend(tipo, produto, `Peso cadastrado em ${c.unidadePeso}, esperado ${unidade}.`); return null; }
    return Number(c.kgPorUnidade);
  };
  const somar = (tipo, produto, kg) => partes.push({ tipo, produto, kg: arred3(kg) });

  const altura = medida(folha.altura), largura = medida(folha.largura);

  // perfil da porta: peças de altura e de largura (quantidades POR PORTA)
  const perfil = txt(folha.perfil);
  const trechos = [['altura', folha.qtdAltura, folha.tamAltura ?? folha.altura], ['largura', folha.qtdLargura, folha.tamLargura ?? folha.largura]];
  const qtdInformada = folha.qtdAltura !== undefined || folha.qtdLargura !== undefined;
  if (perfil) {
    if (!qtdInformada) pend('perfil', perfil, 'Quantidade de peças do perfil não informada.');
    else {
      let metros = 0, ok = true;
      for (const [rotulo, qtd, tam] of trechos) {
        const q = Math.round(medida(qtd));
        if (q <= 0) continue;
        if (!(medida(tam) > 0)) { pend('perfil', perfil, `Perfil sem tamanho de ${rotulo}.`); ok = false; continue; }
        metros += q * medida(tam) / 1000;
      }
      if (ok && metros > 0) {
        const kgm = cadastro('perfil', perfil, 'kg_m');
        if (kgm !== null) somar('perfil', perfil, metros * kgm);
      }
    }
  } else if (medida(folha.qtdAltura) > 0 || medida(folha.qtdLargura) > 0) pend('perfil', '', 'Folha com peças de perfil mas sem o nome do perfil.');

  // puxador: tamanho de cada peça × quantidade
  const puxador = txt(folha.puxador), qtdPux = Math.round(medida(folha.qtdPuxador));
  if (puxador && qtdPux > 0) {
    if (!(medida(folha.tamanhoPuxador) > 0)) pend('puxador', puxador, 'Puxador sem tamanho.');
    else {
      const kgm = cadastro('puxador', puxador, 'kg_m');
      if (kgm !== null) somar('puxador', puxador, qtdPux * medida(folha.tamanhoPuxador) / 1000 * kgm);
    }
  }

  // divisor: perfil à parte; horizontal = largura da porta, vertical = altura (engenharia.js folhasDoItem)
  const divisor = txt(folha.divisor), divH = Math.round(medida(folha.qtdDivH)), divV = Math.round(medida(folha.qtdDivV));
  if (divisor && (divH > 0 || divV > 0)) {
    const tamH = folha.tamDivH !== undefined && medida(folha.tamDivH) > 0 ? medida(folha.tamDivH) : largura;
    const tamV = folha.tamDivV !== undefined && medida(folha.tamDivV) > 0 ? medida(folha.tamDivV) : altura;
    let metros = 0, ok = true;
    for (const [rotulo, qtd, tam] of [['horizontal', divH, tamH], ['vertical', divV, tamV]]) {
      if (qtd <= 0) continue;
      if (!(tam > 0)) { pend('perfil', divisor, `Divisor ${rotulo} sem tamanho.`); ok = false; continue; }
      metros += qtd * tam / 1000;
    }
    if (ok && metros > 0) {
      const kgm = cadastro('perfil', divisor, 'kg_m');
      if (kgm !== null) somar('perfil', divisor, metros * kgm);
    }
  }

  // vidro (revestimento): área da folha (ou da medida do vidro, se informada) × espessura × kg/m²/mm
  const vidro = txt(folha.revestimento);
  if (vidro) {
    const alturaV = medida(folha.alturaVidro) > 0 ? medida(folha.alturaVidro) : altura;
    const larguraV = medida(folha.larguraVidro) > 0 ? medida(folha.larguraVidro) : largura;
    const esp = espessuraDoNome(vidro);
    if (!esp) pend('vidro', vidro, 'Espessura não encontrada no nome do vidro (esperado algo como "4mm").');
    else if (!(alturaV > 0 && larguraV > 0)) pend('vidro', vidro, 'Vidro sem altura ou largura.');
    else {
      const k = cadastro('vidro', vidro, 'kg_m2_mm');
      if (k !== null) somar('vidro', vidro, (alturaV / 1000) * (larguraV / 1000) * esp * k);
    }
  }

  return fechar(partes, pendencias);
}

function fechar(partes, pendencias) {
  const pesoKg = arred3(partes.reduce((t, p) => t + p.kg, 0));
  return { pesoKg, partes, pendencias, parcial: pendencias.length > 0 };
}

// junta partes do mesmo tipo+produto (somando) e pendências repetidas
function consolidar(partes, pendencias) {
  const mapa = new Map();
  for (const p of partes) {
    const k = `${p.tipo}|${p.produto}`;
    if (mapa.has(k)) mapa.get(k).kg = arred3(mapa.get(k).kg + p.kg); else mapa.set(k, { ...p });
  }
  const vistas = new Set(), pend = [];
  for (const p of pendencias) {
    const k = `${p.item ?? ''}|${p.tipo}|${p.produto}|${p.motivo}`;
    if (!vistas.has(k)) { vistas.add(k); pend.push(p); }
  }
  return fechar([...mapa.values()], pend);
}

// Peso de um item. `folhas` = lista de folhas (cada uma vale `qtdPortas` portas, padrão 1) OU de grupos { folha, qtd } (saída de agruparFolhas;
// o `qtd` do grupo manda e `qtdPortas` é ignorado para ele). Uma folha também pode trazer o próprio `qtd` (QTD_PORTAS de `perfis`).
function pesoItem(folhas = [], qtdPortas = 1, tabela) {
  const partes = [], pendencias = [];
  for (const g of folhas) {
    const f = g && g.folha ? g.folha : g;
    const qtd = Math.round(medida(g?.qtd ?? (g?.folha ? 1 : (qtdPortas ?? 1))));
    if (!(qtd > 0)) continue;
    const r = pesoFolha(f, tabela);
    for (const p of r.partes) partes.push({ ...p, kg: arred3(p.kg * qtd) });
    pendencias.push(...r.pendencias);
  }
  return consolidar(partes, pendencias);
}

// Peso do documento: itens = [{ item, folhas, qtdPortas }]. Devolve também o peso de cada item.
function pesoDocumento(itens = [], tabela) {
  const partes = [], pendencias = [], porItem = [];
  for (const it of itens) {
    const r = pesoItem(it.folhas || [], it.qtdPortas ?? 1, tabela);
    porItem.push({ item: it.item, pesoKg: r.pesoKg, parcial: r.parcial, partes: r.partes, pendencias: r.pendencias.map(p => ({ ...p, item: it.item })) });
    partes.push(...r.partes);
    pendencias.push(...r.pendencias.map(p => ({ ...p, item: it.item })));
  }
  return { ...consolidar(partes, pendencias), itens: porItem };
}

module.exports = { TIPOS_PESO, UNIDADES_PESO, UNIDADES_POR_TIPO, validarPeso, espessuraDoNome, montarTabela, pesoFolha, pesoItem, pesoDocumento };
