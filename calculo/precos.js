// ============================================================
// MOTOR FINANCEIRO — PORTAS + SERRALHERIA + AVULSO (fiel ao VB)
// Colunas usadas: VALOR_FIXO, DESCONTO_VIDRO, TIPO_PUXADOR, DESC_PERF_PUX.
// Preço de tabela = VALOR_FIXO para todo cliente (decisão do Thiago, 2026-10-22: o VALOR_CHEIO não é usado na web).
// O cadastro chega por um "leitor" (criarLeitor) → as contas são testáveis sem banco.
// ============================================================
class ErroPreco extends Error {}
// Falha REAL ao ler o cadastro (conexão, tabela, consulta): o cálculo para; nunca vira preço 0 (decisão do dono, 2026-11-11).
// Registro que simplesmente não existe (acabamento ou "Solda" sem linha) continua valendo 0, como sempre.
class ErroCadastro extends Error {
  constructor(origem, causa) { super(`Erro ao ler o cadastro (${origem}).`); this.origem = origem; this.codigoBanco = causa && causa.code; }
}
const lerOuFalhar = async (origem, fn) => { try { return await fn(); } catch (err) { throw new ErroCadastro(origem, err); } };

function criarLeitor(pool) {
  return {
    async produto(nome) {
      if (!nome) return null;
      const [rows] = await lerOuFalhar('produtos', () => pool.execute(
        `SELECT CODIGO, MODELO, VALOR_FIXO, DESCONTO_VIDRO, TIPO_PUXADOR, DESC_PERF_PUX
         FROM cadastro_de_produtos WHERE TRIM(MODELO) = TRIM(?) AND SITUACAO IN ('Ativo', 'Inativo')
         ORDER BY (SITUACAO = 'Ativo') DESC LIMIT 1`, [nome]));
      // Prefere o ativo, mas aceita o inativo: o orçamento/pedido já feito com um material que depois foi inativado
      // precisa continuar abrindo e salvando (as listas da tela seguem mostrando só os ativos).
      if (!rows.length) return null;
      return {
        // codigo/modelo: só para a auditoria do cálculo (nenhuma conta usa)
        codigo: rows[0].CODIGO ?? null,
        modelo: rows[0].MODELO ?? null,
        valorFixo: parseFloat(rows[0].VALOR_FIXO) || 0,
        descontoVidro: parseFloat(rows[0].DESCONTO_VIDRO) || 0,
        descontoPerfilPux: parseFloat(rows[0].DESC_PERF_PUX) || 0,
        tipoPuxador: String(rows[0].TIPO_PUXADOR || '')
      };
    },
    async taxaAcabamento(nome) {
      if (!nome) return 0;
      const [rows] = await lerOuFalhar('acabamentos', () => pool.execute(
        'SELECT VALOR FROM acabamentos WHERE TRIM(ACABAMENTO) = TRIM(?) LIMIT 1', [nome]));
      return rows.length ? (parseFloat(rows[0].VALOR) || 0) : 0; // acabamento sem linha no cadastro → 0%
    },
    async fixoSerralheria(nome) {
      const [prod] = await lerOuFalhar('serralheria_produtos', () => pool.execute(
        'SELECT COALESCE(fixo,0) AS fixo FROM serralheria_produtos WHERE TRIM(nome_modelo) = TRIM(?) LIMIT 1',
        [nome || '']));
      return prod.length ? (parseFloat(prod[0].fixo) || 0) : 0;
    },
    // Complementos da serralheria (frmSelecaoComplementos): os do modelo; "Produto editável" vê todos
    async componentesSerralheria(produto) {
      const campos = 'SELECT id, tipo_componente, descricao_componente, unidade_medida, valor_unitario FROM serralheria_modelos_componentes';
      const ordem = 'ORDER BY tipo_componente, descricao_componente';
      const [rows] = await lerOuFalhar('complementos da serralheria', () => String(produto || '').trim() === 'Produto editável'
        ? pool.execute(`${campos} WHERE ativo = 1 ${ordem}`)
        : pool.execute(`${campos} WHERE ativo = 1 AND modelo_padrao_id = (SELECT id FROM serralheria_produtos WHERE TRIM(nome_modelo) = TRIM(?) LIMIT 1) ${ordem}`, [produto || '']));
      return rows.map(r => ({ id: Number(r.id), tipo: r.tipo_componente, descricao: r.descricao_componente, unidade: r.unidade_medida, valorUnitario: parseFloat(r.valor_unitario) || 0 }));
    },
    // Solda: produto "Solda" no cadastro (VALOR_FIXO)
    async valorSolda() {
      const [sol] = await lerOuFalhar('solda', () => pool.execute(
        `SELECT COALESCE(VALOR_FIXO, 0) AS v
         FROM cadastro_de_produtos WHERE TRIM(MODELO) = 'Solda' LIMIT 1`));
      return parseFloat(sol[0]?.v) || 0; // Solda sem cadastro (sem linha) → 0
    }
  };
}

// Política comercial do cliente — por CODIGO (preciso) com reserva por nome
async function lerCliente(pool, { clienteCodigo, cliente } = {}) {
  const campos = 'SELECT CODIGO, RAZAO_SOCIAL, MEDICAO, TIPO_DESCONTO, DESCONTO, COMISSAO, REPRESENTANTE, ESTADO FROM cadastro_clientes';
  let rows = [];
  if (clienteCodigo) [rows] = await pool.execute(`${campos} WHERE CODIGO = ? LIMIT 1`, [clienteCodigo]);
  else if (cliente) [rows] = await pool.execute(`${campos} WHERE TRIM(RAZAO_SOCIAL) = TRIM(?) LIMIT 1`, [cliente]);
  if (!rows.length) return null;
  const c = rows[0];
  return {
    codigo: c.CODIGO,
    razaoSocial: c.RAZAO_SOCIAL,
    medicao: c.MEDICAO ?? '',
    estado: String(c.ESTADO ?? '').trim().toUpperCase(),
    isFixo: String(c.TIPO_DESCONTO || '').toUpperCase().includes('FIXO'),
    desconto: parseFloat(c.DESCONTO) || 0,
    // frm_Pedido2.cmb_Cliente_SelectedIndexChanged: sem comissão → "Nenhum"
    representante: (parseFloat(c.COMISSAO) || 0) !== 0 ? c.REPRESENTANTE : 'Nenhum'
  };
}

// ============================================================
// AUDITORIA DO CÁLCULO (painel lateral de orcamentos.html; docs/regras/auditoria-calculo.md)
// O rastro só ANOTA o que as contas já fizeram: nenhuma conta lê o rastro, e sem ele (null) nada muda.
// `leitorRegistrado` embrulha o leitor e anota cada leitura do cadastro com o que voltou.
// ============================================================
function novoRastro() { return { passos: [], leituras: [] }; }
function anotar(aud, etapa, dados) { if (aud) aud.passos.push({ etapa, ...dados }); }
const r2a = v => (Number.isFinite(v) ? Math.round(v * 10000) / 10000 : v); // só para exibir (4 casas), nunca para conta
function leitorRegistrado(leitor, aud) {
  const registra = (fonte, fn) => async (...args) => {
    const resultado = await fn(...args);
    aud.leituras.push({ fonte, chave: args.length ? args[0] ?? null : null, resultado: resultado ?? null });
    return resultado;
  };
  const embrulhado = {};
  for (const [nome, fn] of Object.entries(leitor)) embrulhado[nome] = typeof fn === 'function' ? registra(nome, fn.bind(leitor)) : fn;
  return embrulhado;
}

// auxiliares
const precoBase = d => d.valorFixo; // todo cliente parte do VALOR_FIXO
const comAcab = (base, taxa) => base + base * (taxa / 100);
const alturaS = b => parseFloat(b.altura) || 0;
const largS = b => parseFloat(b.largura) || 0;
const profS = b => parseFloat(b.profundidade) || 0;

// "+10;-5" composto (rota /calcular_preco, campo percentuais — a tela manda vazio)
function aplicarPercentuais(valor, texto) {
  let v = valor;
  for (const parte of String(texto || '').split(';')) {
    let t = parte.trim(); if (!t) continue;
    let sinal = '+', num = t;
    if (t.startsWith('+') || t.startsWith('-')) { sinal = t[0]; num = t.slice(1); }
    const pct = parseFloat(num.replace(/%/g, '').replace(',', '.'));
    if (!isNaN(pct)) v = sinal === '+' ? v * (1 + pct / 100) : v * (1 - pct / 100);
  }
  return v;
}

// MotorPercentual do VB (ModoComposto = False): % sempre sobre a BASE → "+100;+10" = ×2,1
function fatorHistorico(h) {
  const partes = String(h || '').split(';').map(t => t.trim()).filter(Boolean).map(t => {
    const sinal = t.startsWith('-') ? -1 : 1;
    const n = parseFloat(t.replace(/[+\-\s%]/g, '').replace(',', '.'));
    return isNaN(n) ? null : sinal * n;
  }).filter(n => n !== null);
  return 1 + partes.reduce((s, p) => s + p, 0) / 100;
}

// Acessórios: frm_Acessorios_Portas (MANUAL) e frmPortasCorrer.CarregarItensDoSistemaNaMemoria (SISTEMA)
// VALOR_FIXO; o desconto do cliente entra no item só para quem é de desconto fixo (mesma regra p/ manual e sistema)
function precoAcessorio(dados, cliente) {
  if (!dados) return 0;
  return cliente.isFixo ? dados.valorFixo * (100 - (cliente.desconto || 0)) / 100 : dados.valorFixo;
}

// Acessório com tamanho (trilho, bandeira) é cobrado por metro: qtd × tamanho/1000 × preço; sem tamanho, qtd × preço
function valoresAcessorio(dados, cliente, { qtd, tamanho }) {
  const tabela = precoAcessorio(dados, cliente);
  const fator = tamanho > 0 ? tamanho / 1000 : 1;
  const r2 = v => Math.round(v * 100) / 100;
  return { valorTabela: r2(tabela), valorUnitario: r2(tabela * fator), valorTotal: r2(qtd * fator * tabela) };
}

// O que a posição do puxador muda na conta da porta (bloco das portas abaixo): eixo (Topo/Base x lateral),
// nº de puxadores (posições separadas por vírgula) e "Total". Lado (esquerda/direita) e altura (superior/centro)
// não mudam o preço; por isso folhas espelhadas (pares) dão a mesma chave.
function chavePosicaoPreco(pos) {
  const u = String(pos || '').toUpperCase();
  return `${u.includes('TOPO') || u.includes('BASE') ? 'TB' : 'L'}|${u.split(',').filter(p => p.trim()).length}|${u.includes('TOTAL') ? 'T' : ''}`;
}

// Regra do dono: o acabamento do puxador é SEMPRE o do perfil (a tela já trava o campo; aqui vale para
// qualquer cliente da API). Sem acabamento no perfil, mantém o que veio. Não recusa nem bloqueia.
function acabamentoDoPuxador(acabPerfil, acabPuxador) {
  const perfil = String(acabPerfil ?? '').trim();
  return perfil || String(acabPuxador ?? '').trim();
}

async function calcularPrecoItem(b, cliente, leitor, aud = null) {
  const isFixo = !!cliente?.isFixo;
  const descontoCliente = cliente ? (cliente.desconto || 0) : 0;
  let subtotal = 0; // base ANTES do desconto do cliente
  const diag = { clienteEncontrado: !!cliente, isFixo, descontoCliente };
  const qtd = parseFloat(b.qtd) > 0 ? parseFloat(b.qtd) : 1;

  // ============ FRENTE SERRALHERIA (MotorPrecificacaoSerralheria.vb) ============
  if (b.frente === 'Serralheria') {
    const valorFixoProduto = await leitor.fixoSerralheria(b.produto);
    const dadosMat = await leitor.produto(b.material);
    if (!dadosMat) throw new ErroPreco(`Material '${b.material}' não encontrado ou sem preços.`);

    const qtdA = parseFloat(b.qtdAltura) > 0 ? parseFloat(b.qtdAltura) : 1;
    const qtdL = parseFloat(b.qtdLargura) > 0 ? parseFloat(b.qtdLargura) : 1;
    const qtdP = parseFloat(b.qtdProfundidade) > 0 ? parseFloat(b.qtdProfundidade) : 1;
    const metragem = (alturaS(b) / 1000) * qtdA + (largS(b) / 1000) * qtdL + (profS(b) / 1000) * qtdP;
    aud && anotar(aud, 'metragem', { titulo: 'Metragem da peça', formula: `${alturaS(b)}/1000 × ${qtdA} + ${largS(b)}/1000 × ${qtdL} + ${profS(b)}/1000 × ${qtdP}`, resultado: r2a(metragem), unidade: 'm' });

    const material = metragem * precoBase(dadosMat);
    subtotal += material;
    aud && anotar(aud, 'material', { titulo: `Material ${b.material || ''}`.trim(), formula: `${r2a(metragem)} m × ${precoBase(dadosMat)} (VALOR_FIXO)`, resultado: r2a(material) });
    const valorSolda = await leitor.valorSolda();
    const soldas = parseFloat(b.soldas) || 0;
    subtotal += valorSolda * soldas;
    aud && anotar(aud, 'solda', { titulo: 'Solda', formula: `${soldas} solda(s) × ${valorSolda} (VALOR_FIXO do produto "Solda"; sem cadastro = 0)`, resultado: r2a(valorSolda * soldas) });
    const pctAcab = await leitor.taxaAcabamento(b.acabamento);
    subtotal += material * (pctAcab / 100);
    aud && anotar(aud, 'acabamento', { titulo: `Acabamento ${b.acabamento || '(nenhum)'}`, formula: `${r2a(material)} × ${pctAcab}%`, resultado: r2a(material * (pctAcab / 100)) });
    // complementos: fora daqui (precoSerralheria), com o valor do cadastro e sem o desconto do cliente
    subtotal += valorFixoProduto;
    aud && anotar(aud, 'fixo_produto', { titulo: `Fixo do produto ${b.produto || ''}`.trim(), formula: 'serralheria_produtos.fixo', resultado: r2a(valorFixoProduto) });
    aud && anotar(aud, 'subtotal', { titulo: 'Subtotal de 1 peça (antes do desconto)', formula: 'material + solda + acabamento + fixo', resultado: r2a(subtotal) });

    let final = subtotal * qtd;
    aud && anotar(aud, 'quantidade', { titulo: 'Quantidade', formula: `${r2a(subtotal)} × ${qtd}`, resultado: r2a(final) });
    if (descontoCliente > 0) final *= (100 - descontoCliente) / 100;
    aud && anotar(aud, 'desconto_cliente', { titulo: 'Desconto do cliente', formula: descontoCliente > 0 ? `× (100 − ${descontoCliente})/100 (serralheria: vale para todo cliente com desconto)` : 'sem desconto', resultado: r2a(final) });
    const antesPct = final;
    final = aplicarPercentuais(final, b.percentuais);
    if (aud && String(b.percentuais || '').trim()) anotar(aud, 'percentuais', { titulo: 'Percentuais da linha (compostos)', formula: `${r2a(antesPct)} com "${b.percentuais}"`, resultado: r2a(final) });

    diag.serralheria = { metragem, precoM: Math.round(material / (metragem || 1) * 100) / 100, valorFixoProduto };
    const res = { unitario: Math.round((final / qtd) * 100) / 100, total: Math.round(final * 100) / 100, diag };
    aud && anotar(aud, 'final', { titulo: 'Resultado da peça', formula: `unitário = arred2(${r2a(final)} ÷ ${qtd}); total = arred2(${r2a(final)})`, unitario: res.unitario, total: res.total });
    return res;
  }

  // ============ VENDA AVULSA (MotorFinanceiro.CalcularValorVendaAvulsa) ============
  if (b.frente === 'Avulso') {
    const categoria = String(b.categoria || '');
    const dados = await leitor.produto(b.produto);
    if (!dados) throw new ErroPreco(`Produto '${b.produto}' não encontrado ou sem preços.`);
    const base = precoBase(dados);
    const taxaAv = await leitor.taxaAcabamento(b.acabamento);
    const precoAcab = comAcab(base, taxaAv);
    aud && anotar(aud, 'preco_acabado', { titulo: `Preço de ${b.produto} com acabamento`, formula: `${base} (VALOR_FIXO) × (1 + ${taxaAv}% ${b.acabamento ? `"${b.acabamento}"` : '(sem acabamento)'})`, resultado: r2a(precoAcab) });
    let unit = 0;
    if (['Perfil', 'Trilhos', 'Puxador'].includes(categoria)) unit = precoAcab * (alturaS(b) / 1000);
    else if (categoria === 'Revestimento') unit = precoAcab * (alturaS(b) / 1000) * (largS(b) / 1000);
    else if (categoria === 'Serviço' || categoria === 'Acessório') unit = precoAcab;
    else throw new ErroPreco('Categoria inválida');
    aud && anotar(aud, 'categoria', { titulo: `Categoria ${categoria}`,
      formula: ['Perfil', 'Trilhos', 'Puxador'].includes(categoria) ? `${r2a(precoAcab)} × ${alturaS(b)}/1000 m`
        : categoria === 'Revestimento' ? `${r2a(precoAcab)} × ${alturaS(b)}/1000 × ${largS(b)}/1000 m²` : `${r2a(precoAcab)} (por unidade)`,
      resultado: r2a(unit) });
    // desconto do cliente no item só para quem é de desconto fixo (os demais: no fechamento)
    if (isFixo && descontoCliente > 0) unit *= (100 - descontoCliente) / 100;
    aud && anotar(aud, 'desconto_cliente', { titulo: 'Desconto do cliente', formula: isFixo && descontoCliente > 0 ? `× (100 − ${descontoCliente})/100 (cliente de desconto fixo)` : (descontoCliente > 0 ? 'cliente não é de desconto fixo: desconto fica para o fechamento' : 'sem desconto'), resultado: r2a(unit) });
    const antesPct = unit;
    unit = aplicarPercentuais(unit, b.percentuais);
    if (aud && String(b.percentuais || '').trim()) anotar(aud, 'percentuais', { titulo: 'Percentuais da linha (compostos)', formula: `${r2a(antesPct)} com "${b.percentuais}"`, resultado: r2a(unit) });
    const res = { unitario: Math.round(unit * 100) / 100, total: Math.round(unit * qtd * 100) / 100, diag };
    aud && anotar(aud, 'final', { titulo: 'Resultado', formula: `unitário = arred2(${r2a(unit)}); total = arred2(${r2a(unit)} × ${qtd})`, unitario: res.unitario, total: res.total });
    return res;
  }

  // ============ FRENTE PORTAS (MotorFinanceiro.CalcularValorVendaPorta) ============
  // Preço POR FOLHA (MotorFinanceiro.CalcularValorVendaPorta é por porta; frmPortasCorrer soma porta a porta).
  // Cada folha pode ter largura própria (correr, LarguraEditada) e posição do puxador própria (`posicoesFolhas`,
  // uma por folha, definida clicando no desenho). Quando todas as folhas dão a mesma conta, segue o caminho de sempre
  // (preço de uma porta × qtd, sem mudar o arredondamento); quando alguma difere, cada configuração é calculada como
  // uma porta e o total é a soma (unitário = média).
  const largs = Array.isArray(b.largurasFolhas) ? b.largurasFolhas.slice(0, 200).map(v => parseFloat(v) || 0) : [];
  const poss = Array.isArray(b.posicoesFolhas) ? b.posicoesFolhas.slice(0, 200).map(p => String(p ?? '')) : [];
  const nFolhas = largs.length > 1 ? largs.length : Math.min(200, Math.max(1, parseInt(b.qtd) || 1));
  const posDaFolha = i => poss[i] ?? poss[0];   // como folhasDoItem (calculo/engenharia.js)
  const largDaFolha = i => largs.length > 1 ? largs[i] : b.largura;
  const largVaria = largs.length > 1 && new Set(largs).size > 1;
  const posVaria = poss.length > 0 && new Set(Array.from({ length: nFolhas }, (_, i) => chavePosicaoPreco(posDaFolha(i)))).size > 1;
  aud && anotar(aud, 'folhas', { titulo: 'Folhas', formula: largVaria || posVaria
      ? `${nFolhas} folha(s); ${largVaria ? 'larguras diferentes' : ''}${largVaria && posVaria ? ' e ' : ''}${posVaria ? 'posições do puxador que mudam a conta' : ''}: cada configuração é calculada como 1 porta e o total é a soma (unitário = média)`
      : `${nFolhas} folha(s) com a mesma conta: preço de 1 porta × qtd`,
    nFolhas, largVaria, posVaria, largurasFolhas: largs.length ? largs.slice(0, nFolhas) : null,
    posicoesFolhas: poss.length ? Array.from({ length: nFolhas }, (_, i) => posDaFolha(i)) : null,
    chavesPreco: poss.length ? Array.from({ length: nFolhas }, (_, i) => chavePosicaoPreco(posDaFolha(i))) : null });
  if (largVaria || posVaria) {
    const grupos = new Map();
    for (let i = 0; i < nFolhas; i++) {
      const w = largDaFolha(i), p = poss.length ? posDaFolha(i) : b.posicaoPuxador;
      const k = `${w}|${chavePosicaoPreco(p)}`;
      if (grupos.has(k)) grupos.get(k).q++; else grupos.set(k, { w, p, q: 1 });
    }
    let total = 0, ultimo = null;
    for (const { w, p, q } of grupos.values()) {
      const sub = aud ? novoRastro() : null;
      ultimo = await calcularPrecoItem({ ...b, largura: w, posicaoPuxador: p, largurasFolhas: null, posicoesFolhas: null, qtd: 1 }, cliente, leitor, sub);
      total += ultimo.total * q;
      aud && anotar(aud, 'grupo', { titulo: `Grupo: ${q} folha(s) de largura ${w}, puxador "${p || '(sem posição)'}"`, formula: `${ultimo.total} × ${q}`,
        resultado: r2a(ultimo.total * q), largura: w, posicao: p || '', qtd: q, unitarioGrupo: ultimo.total, passos: sub ? sub.passos : [] });
    }
    total = Math.round(total * 100) / 100;
    const res = { unitario: Math.round(total / nFolhas * 100) / 100, total,
      diag: { ...ultimo.diag, ...(largVaria ? { largurasFolhas: largs } : {}), ...(posVaria ? { posicoesFolhas: poss.slice(0, nFolhas) } : {}) } };
    aud && anotar(aud, 'final', { titulo: 'Resultado (soma dos grupos)', formula: `total = arred2(Σ grupos) = ${total}; unitário = arred2(${total} ÷ ${nFolhas})`, unitario: res.unitario, total: res.total });
    return res;
  }
  if (poss.length) b = { ...b, posicaoPuxador: posDaFolha(0) }; // a lista por folha é a fonte; todas dão a mesma conta
  // várias folhas de larguras IGUAIS: a lista por folha é a fonte (a tela manda em `largura` a automática do vão)
  if (largs.length > 1) b = { ...b, largura: largs[0] };
  const altura = parseFloat(b.altura) || 0;
  const largura = parseFloat(b.largura) || 0;

  const dadosPerfil = await leitor.produto(b.perfil);
  if (!dadosPerfil) throw new ErroPreco(`Perfil '${b.perfil}' não encontrado ou sem preços.`);
  const dadosPux = b.puxador ? await leitor.produto(b.puxador) : null;
  const dadosRev = b.revestimento ? await leitor.produto(b.revestimento) : null;
  const dadosDiv = b.divisor ? await leitor.produto(b.divisor) : null;

  const taxaPerfil = await leitor.taxaAcabamento(b.acabPerfil);
  const taxaPux = dadosPux ? await leitor.taxaAcabamento(acabamentoDoPuxador(b.acabPerfil, b.acabPuxador)) : 0;
  const taxaRev = dadosRev ? await leitor.taxaAcabamento(b.acabRevest) : 0;
  aud && anotar(aud, 'medidas', { titulo: 'Medidas usadas na conta (1 porta)', formula: `altura ${altura} mm × largura ${largura} mm`, altura, largura });
  aud && anotar(aud, 'acabamentos', { titulo: 'Taxas de acabamento', formula: `perfil "${b.acabPerfil || ''}" = ${taxaPerfil}%` +
      (dadosPux ? `; puxador "${acabamentoDoPuxador(b.acabPerfil, b.acabPuxador)}" = ${taxaPux}% (regra: acabamento do puxador = o do perfil)` : '') +
      (dadosRev ? `; revestimento "${b.acabRevest || ''}" = ${taxaRev}%` : ''),
    taxaPerfil, taxaPux, taxaRev });

  const temPux = !!dadosPux;
  const posPux = String(b.posicaoPuxador || '').toUpperCase();
  // VB usa porta.TipoPuxador (já com " Total" quando toda extensão); o cadastro é o reserva
  const tipoPux = String(b.tipoPuxador || dadosPux?.tipoPuxador || '').toUpperCase();
  const qtdPux = posPux ? posPux.split(',').filter(p => p.trim()).length : 0;
  const isSobreposto = tipoPux.includes('SOBREPOSTO');
  const isEmbutido = tipoPux.includes('EMBUTIDO');
  const isTotal = tipoPux.includes('TOTAL') || posPux.includes('TOTAL');
  if (aud && b.puxador) anotar(aud, 'puxador_tipo', { titulo: 'Puxador: tipo e posição', formula: `tipo "${tipoPux || '(vazio)'}" (${b.tipoPuxador ? 'da tela' : 'do cadastro'}); posição "${posPux || '(sem posição)'}" → ${qtdPux} puxador(es)` +
      `; sobreposto=${isSobreposto ? 'sim' : 'não'}, embutido=${isEmbutido ? 'sim' : 'não'}, total=${isTotal ? 'sim' : 'não'}` + (dadosPux ? '' : ' — puxador NÃO encontrado no cadastro: fica fora da conta'),
    tipo: tipoPux, posicao: posPux, qtdPux, isSobreposto, isEmbutido, isTotal });

  // 1. PERFIL (puxador Total desconta o lado dele)
  const ladoPux = (posPux.includes('TOPO') || posPux.includes('BASE')) ? largura : altura;
  const ladoOp  = (posPux.includes('TOPO') || posPux.includes('BASE')) ? altura : largura;
  const perimetro = (temPux && isTotal && !isSobreposto && !isEmbutido)
    ? 2 * ladoOp + ladoPux * Math.max(0, 2 - qtdPux)
    : 2 * altura + 2 * largura;
  const precoMPerfil = comAcab(precoBase(dadosPerfil), taxaPerfil);
  subtotal += (perimetro / 1000) * precoMPerfil;
  aud && anotar(aud, 'perimetro', { titulo: 'Perímetro do perfil', formula: (temPux && isTotal && !isSobreposto && !isEmbutido)
      ? `puxador Total (não sobreposto/embutido) desconta o lado dele: 2 × ${ladoOp} + ${ladoPux} × max(0, 2 − ${qtdPux})`
      : `2 × ${altura} + 2 × ${largura}`, resultado: perimetro, unidade: 'mm', ladoPux, ladoOp });
  aud && anotar(aud, 'perfil', { titulo: `Perfil ${b.perfil}`, formula: `preço/m = ${precoBase(dadosPerfil)} × (1 + ${taxaPerfil}/100) = ${r2a(precoMPerfil)}; ${perimetro}/1000 m × ${r2a(precoMPerfil)}`,
    resultado: r2a((perimetro / 1000) * precoMPerfil), precoM: r2a(precoMPerfil) });

  // 2. PUXADOR (mínimo R$ 20/un — fiel ao VB)
  if (dadosPux) {
    const compUnit = isTotal ? ladoPux : (parseFloat(b.tamanhoPuxador) || 0);
    const custo = (compUnit * qtdPux / 1000) * comAcab(precoBase(dadosPux), taxaPux);
    subtotal += Math.max(20 * qtdPux, custo);
    aud && anotar(aud, 'puxador', { titulo: `Puxador ${b.puxador}`, formula: `comprimento ${compUnit} mm (${isTotal ? 'Total: lado inteiro' : 'tamanho digitado'}) × ${qtdPux} un /1000 × ${precoBase(dadosPux)} × (1 + ${taxaPux}/100) = ${r2a(custo)}; mínimo R$ 20 × ${qtdPux} = ${20 * qtdPux}` +
        (qtdPux === 0 ? ' — SEM posição: o puxador não entra no preço' : ''),
      resultado: r2a(Math.max(20 * qtdPux, custo)), comprimento: compUnit, qtdPux, custo: r2a(custo), minimo: 20 * qtdPux, usouMinimo: 20 * qtdPux > custo });
  }

  // 3. DIVISORES (qtdDivH = horizontais, qtdDivV = verticais — fiel ao VB)
  let compDiv = 0;
  if (dadosDiv) {
    const largV = Math.max(0, largura - dadosPerfil.descontoVidro);
    const altV  = Math.max(0, altura - dadosPerfil.descontoVidro);
    compDiv = (parseInt(b.qtdDivH) || 0) * largV + (parseInt(b.qtdDivV) || 0) * altV;
    subtotal += (compDiv / 1000) * comAcab(precoBase(dadosDiv), taxaPerfil);
    aud && anotar(aud, 'divisor', { titulo: `Divisor ${b.divisor}`, formula: `${parseInt(b.qtdDivH) || 0} H × ${largV} + ${parseInt(b.qtdDivV) || 0} V × ${altV} = ${compDiv} mm; ${compDiv}/1000 × ${precoBase(dadosDiv)} × (1 + ${taxaPerfil}/100)`,
      resultado: r2a((compDiv / 1000) * comAcab(precoBase(dadosDiv), taxaPerfil)), comprimento: compDiv });
  }

  // 4. REVESTIMENTO (área líquida, com dedução do divisor)
  if (dadosRev) {
    let descX = dadosPerfil.descontoVidro, descY = dadosPerfil.descontoVidro;
    if (temPux && isSobreposto) {
      if (posPux.includes('TOPO') || posPux.includes('BASE')) descY += dadosPerfil.descontoPerfilPux * qtdPux;
      else descX += dadosPerfil.descontoPerfilPux * qtdPux;
    }
    const area = Math.max(0, (Math.max(0, altura - descY) / 1000) * (Math.max(0, largura - descX) / 1000));
    const areaDiv = (compDiv / 1000) * 0.015;
    subtotal += Math.max(0, area - areaDiv) * comAcab(precoBase(dadosRev), taxaRev);
    aud && anotar(aud, 'revestimento', { titulo: `Revestimento ${b.revestimento}`,
      formula: `área = (${altura} − ${descY})/1000 × (${largura} − ${descX})/1000 = ${r2a(area)} m²` + (areaDiv ? ` − divisor ${r2a(areaDiv)} m²` : '') +
        `; × ${precoBase(dadosRev)} × (1 + ${taxaRev}/100)`,
      resultado: r2a(Math.max(0, area - areaDiv) * comAcab(precoBase(dadosRev), taxaRev)), descX, descY, area: r2a(area), areaDivisor: r2a(areaDiv), areaLiquida: r2a(Math.max(0, area - areaDiv)) });
  }
  aud && anotar(aud, 'subtotal', { titulo: 'Subtotal de 1 porta (antes do desconto)', formula: 'perfil + puxador + divisor + revestimento', resultado: r2a(subtotal) });

  // 5. Desconto do cliente + percentuais da linha
  let final = subtotal;
  if (descontoCliente > 0) final *= (100 - descontoCliente) / 100;
  aud && anotar(aud, 'desconto_cliente', { titulo: 'Desconto do cliente', formula: descontoCliente > 0 ? `${r2a(subtotal)} × (100 − ${descontoCliente})/100 (portas: vale para todo cliente com desconto)` : 'sem desconto', resultado: r2a(final) });
  const antesPct = final;
  final = aplicarPercentuais(final, b.percentuais);
  if (aud && String(b.percentuais || '').trim()) anotar(aud, 'percentuais', { titulo: 'Percentuais da linha (compostos)', formula: `${r2a(antesPct)} com "${b.percentuais}"`, resultado: r2a(final) });

  diag.perfil = {
    fixo: dadosPerfil.valorFixo,
    taxaAcab: taxaPerfil, precoM: Math.round(precoMPerfil * 100) / 100
  };
  diag.perimetroMm = perimetro;
  const res = { unitario: Math.round(final * 100) / 100, total: Math.round(final * qtd * 100) / 100, diag };
  aud && anotar(aud, 'final', { titulo: 'Resultado', formula: `unitário = arred2(${r2a(final)}); total = arred2(${r2a(final)} × ${qtd})`, unitario: res.unitario, total: res.total });
  return res;
}

// Porta + acessórios (frmPortasAbrir.vb:2096-2110): base = portas + acessórios; unitário = base / folhas.
// acessorios: [{ nome, qtd, tamanho?, origem }] já validados; devolve cada um com valorUnitario.
async function precificarAcessorios(cliente, leitor, acessorios, aud = null) {
  const precificados = [];
  let somaAc = 0;
  for (const a of acessorios) {
    const dados = await leitor.produto(a.nome);
    if (!dados) throw new ErroPreco(`Acessório '${a.nome}' não encontrado ou sem preços.`);
    const tamanho = parseFloat(a.tamanho) || 0;
    const v = valoresAcessorio(dados, cliente || { isFixo: false, desconto: 0 }, { qtd: parseInt(a.qtd) || 0, tamanho });
    somaAc += v.valorTotal;
    precificados.push({ ...a, tamanho, ...v });
    aud && anotar(aud, 'acessorio', { titulo: `Acessório ${a.nome} (${a.origem || 'MANUAL'})`,
      formula: `tabela = ${dados.valorFixo} (VALOR_FIXO)${cliente && cliente.isFixo ? ` × (100 − ${cliente.desconto || 0})/100 (cliente de desconto fixo)` : ''} = ${v.valorTabela}` +
        (tamanho > 0 ? `; por metro: × ${tamanho}/1000 = ${v.valorUnitario}` : '') + `; × ${parseInt(a.qtd) || 0} un = ${v.valorTotal}`,
      resultado: v.valorTotal, valorTabela: v.valorTabela, valorUnitario: v.valorUnitario, qtd: parseInt(a.qtd) || 0, tamanho });
  }
  aud && anotar(aud, 'acessorios_soma', { titulo: 'Soma dos acessórios', formula: `${acessorios.length} acessório(s)`, resultado: r2a(somaAc) });
  return { precificados, somaAc };
}

async function precoComAcessorios(entrada, cliente, leitor, acessorios = [], aud = null) {
  const r = await calcularPrecoItem(entrada, cliente, leitor, aud);
  // sem acessórios: exatamente o que o /calcular_preco devolve à tela (mesmo arredondamento)
  if (!acessorios.length) return { unitario: r.unitario, total: r.total, acessorios: [], diag: r.diag };
  const qtd = parseFloat(entrada.qtd) > 0 ? parseFloat(entrada.qtd) : 1;
  const { precificados, somaAc } = await precificarAcessorios(cliente, leitor, acessorios, aud);
  const base = Math.round((r.total + somaAc) * 100) / 100;
  const res = { unitario: Math.round(base / qtd * 100) / 100, total: base, acessorios: precificados, diag: r.diag };
  aud && anotar(aud, 'final_acessorios', { titulo: 'Resultado com acessórios', formula: `total = arred2(${r.total} portas + ${r2a(somaAc)} acessórios) = ${base}; unitário = arred2(${base} ÷ ${qtd})`, unitario: res.unitario, total: res.total });
  return res;
}

// frmSerralheria: Total Geral = custo das peças (motor, com desconto do cliente) + custo dos complementos (qtd × valor, sem desconto)
// frmSerralheria: o conjunto é a lista de peças (cada uma com produto, material, medidas e soldas) + complementos;
// sem `pecas`, a própria entrada é a única peça (forma antiga)
async function precoSerralheria(entrada, cliente, leitor, complementos = [], aud = null) {
  const lista = Array.isArray(entrada.pecas) && entrada.pecas.length ? entrada.pecas : null;
  let r;
  if (lista) {
    const detalhe = [];
    for (const [i, p] of lista.entries()) {
      try {
        const qtdPeca = parseFloat(p.qtd) > 0 ? parseFloat(p.qtd) : entrada.qtd;
        const sub = aud ? novoRastro() : null;
        const rp = await calcularPrecoItem({ ...p, frente: 'Serralheria', acabamento: p.acabamento ?? p.acabSerr, qtd: qtdPeca, percentuais: entrada.percentuais }, cliente, leitor, sub);
        detalhe.push({ unitario: rp.unitario, total: rp.total });
        aud && anotar(aud, 'peca', { titulo: `Peça ${i + 1}: ${p.produto || ''} / ${p.material || ''}`, formula: `${p.altura || 0} × ${p.largura || 0} × ${p.profundidade || 0} mm, qtd ${qtdPeca}`,
          resultado: rp.total, unitarioPeca: rp.unitario, passos: sub ? sub.passos : [] });
      } catch (err) { if (err instanceof ErroPreco) throw new ErroPreco(`Peça ${i + 1}: ${err.message}`); throw err; }
    }
    const total = Math.round(detalhe.reduce((s, p) => s + p.total, 0) * 100) / 100;
    const qtdItem = parseFloat(entrada.qtd) > 0 ? parseFloat(entrada.qtd) : 1;
    r = { unitario: Math.round(total / qtdItem * 100) / 100, total, detalhe, diag: { pecas: detalhe.length } };
    aud && anotar(aud, 'pecas_soma', { titulo: 'Soma das peças', formula: `arred2(Σ totais das peças) = ${total}; ÷ ${qtdItem} conjunto(s)`, resultado: total });
  } else {
    const rp = await calcularPrecoItem(entrada, cliente, leitor, aud);
    r = { ...rp, detalhe: [{ unitario: rp.unitario, total: rp.total }] };
  }
  const produtoComp = lista ? lista[0].produto : entrada.produto;
  if (!complementos.length) return { unitario: r.unitario, total: r.total, pecas: r.total, pecasDetalhe: r.detalhe, complementos: [], diag: r.diag };
  const doProduto = await leitor.componentesSerralheria(produtoComp);
  const precificados = [];
  let soma = 0;
  for (const c of complementos) {
    const comp = doProduto.find(x => x.id === Number(c.id));
    if (!comp) throw new ErroPreco(`O complemento ${c.id} não pertence ao produto '${produtoComp}'.`);
    const qtd = parseFloat(c.qtd) > 0 ? parseFloat(c.qtd) : 1;
    const valorTotal = Math.round(qtd * comp.valorUnitario * 100) / 100;
    soma += valorTotal;
    precificados.push({ ...comp, qtd, valorTotal });
    aud && anotar(aud, 'complemento', { titulo: `Complemento ${comp.descricao || comp.id}`, formula: `${qtd} ${comp.unidade || ''} × ${comp.valorUnitario} (sem desconto do cliente)`, resultado: valorTotal });
  }
  const qtdItem = parseFloat(entrada.qtd) > 0 ? parseFloat(entrada.qtd) : 1;
  const total = Math.round((r.total + soma) * 100) / 100;
  const res = { unitario: Math.round(total / qtdItem * 100) / 100, total, pecas: r.total, pecasDetalhe: r.detalhe, complementos: precificados, diag: r.diag };
  aud && anotar(aud, 'final_conjunto', { titulo: 'Resultado do conjunto', formula: `total = arred2(${r.total} peças + ${r2a(soma)} complementos) = ${total}; unitário = arred2(${total} ÷ ${qtdItem})`, unitario: res.unitario, total: res.total });
  return res;
}

module.exports = { ErroCadastro, novoRastro, leitorRegistrado, acabamentoDoPuxador, precoSerralheria, valoresAcessorio, precoComAcessorios, precificarAcessorios, ErroPreco, criarLeitor, lerCliente, calcularPrecoItem, precoAcessorio, fatorHistorico, aplicarPercentuais, chavePosicaoPreco };
