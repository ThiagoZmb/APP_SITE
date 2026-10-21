// ============================================================
// MOTOR FINANCEIRO — PORTAS + SERRALHERIA + AVULSO (fiel ao VB)
// Colunas confirmadas no VB + DESCRIBE: VALOR_CHEIO, VALOR_FIXO,
// DESCONTO_VIDRO, TIPO_PUXADOR, DESC_PERF_PUX
// O cadastro chega por um "leitor" (criarLeitor) → as contas são testáveis sem banco.
// ============================================================
class ErroPreco extends Error {}

function criarLeitor(pool) {
  return {
    async produto(nome) {
      if (!nome) return null;
      const [rows] = await pool.execute(
        `SELECT CODIGO, MODELO, VALOR_CHEIO, VALOR_FIXO, DESCONTO_VIDRO, TIPO_PUXADOR, DESC_PERF_PUX
         FROM cadastro_de_produtos WHERE TRIM(MODELO) = TRIM(?) AND SITUACAO = 'Ativo' LIMIT 1`, [nome]);
      if (!rows.length) return null;
      return {
        valorFixo: parseFloat(rows[0].VALOR_FIXO) || 0,
        valorCheio: parseFloat(rows[0].VALOR_CHEIO) || 0,
        descontoVidro: parseFloat(rows[0].DESCONTO_VIDRO) || 0,
        descontoPerfilPux: parseFloat(rows[0].DESC_PERF_PUX) || 0,
        tipoPuxador: String(rows[0].TIPO_PUXADOR || '')
      };
    },
    async taxaAcabamento(nome) {
      if (!nome) return 0;
      try {
        const [rows] = await pool.execute(
          'SELECT VALOR FROM acabamentos WHERE TRIM(ACABAMENTO) = TRIM(?) LIMIT 1', [nome]);
        return rows.length ? (parseFloat(rows[0].VALOR) || 0) : 0;
      } catch { return 0; }
    },
    async fixoSerralheria(nome) {
      const [prod] = await pool.execute(
        'SELECT COALESCE(fixo,0) AS fixo FROM serralheria_produtos WHERE TRIM(nome_modelo) = TRIM(?) LIMIT 1',
        [nome || '']);
      return prod.length ? (parseFloat(prod[0].fixo) || 0) : 0;
    },
    // Solda: produto "Solda" no cadastro (VALOR_FIXO, senão VALOR_CHEIO)
    async valorSolda() {
      try {
        const [sol] = await pool.execute(
          `SELECT COALESCE(NULLIF(VALOR_FIXO,0), NULLIF(VALOR_CHEIO,0), 0) AS v
           FROM cadastro_de_produtos WHERE TRIM(MODELO) = 'Solda' LIMIT 1`);
        return parseFloat(sol[0]?.v) || 0;
      } catch { return 0; } // Solda sem cadastro → 0
    }
  };
}

// Política comercial do cliente — por CODIGO (preciso) com reserva por nome
async function lerCliente(pool, { clienteCodigo, cliente } = {}) {
  const campos = 'SELECT CODIGO, RAZAO_SOCIAL, MEDICAO, TIPO_DESCONTO, DESCONTO, COMISSAO, REPRESENTANTE FROM cadastro_clientes';
  let rows = [];
  if (clienteCodigo) [rows] = await pool.execute(`${campos} WHERE CODIGO = ? LIMIT 1`, [clienteCodigo]);
  else if (cliente) [rows] = await pool.execute(`${campos} WHERE TRIM(RAZAO_SOCIAL) = TRIM(?) LIMIT 1`, [cliente]);
  if (!rows.length) return null;
  const c = rows[0];
  return {
    codigo: c.CODIGO,
    razaoSocial: c.RAZAO_SOCIAL,
    medicao: c.MEDICAO ?? '',
    isFixo: String(c.TIPO_DESCONTO || '').toUpperCase().includes('FIXO'),
    desconto: parseFloat(c.DESCONTO) || 0,
    // frm_Pedido2.cmb_Cliente_SelectedIndexChanged: sem comissão → "Nenhum"
    representante: (parseFloat(c.COMISSAO) || 0) !== 0 ? c.REPRESENTANTE : 'Nenhum'
  };
}

// auxiliares
const precoBase = (d, isFixo) => isFixo ? d.valorFixo : d.valorCheio;
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
function precoAcessorio(dados, cliente, origem) {
  if (!dados) return 0;
  if (origem === 'SISTEMA DE CORRER') return cliente.isFixo ? dados.valorFixo * (100 - cliente.desconto) / 100 : dados.valorCheio;
  return cliente.isFixo ? dados.valorFixo : dados.valorCheio;
}

async function calcularPrecoItem(b, cliente, leitor) {
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

    const material = metragem * precoBase(dadosMat, isFixo);
    subtotal += material;
    subtotal += (await leitor.valorSolda()) * (parseFloat(b.soldas) || 0);
    const pctAcab = await leitor.taxaAcabamento(b.acabamento);
    subtotal += material * (pctAcab / 100);
    (Array.isArray(b.complementos) ? b.complementos : []).forEach(c => {
      subtotal += (parseFloat(c.qtd) || 0) * (parseFloat(c.valorUnit) || 0);
    });
    subtotal += valorFixoProduto;

    let final = subtotal * qtd;
    if (descontoCliente > 0) final *= (100 - descontoCliente) / 100;
    final = aplicarPercentuais(final, b.percentuais);

    diag.serralheria = { metragem, precoM: Math.round(material / (metragem || 1) * 100) / 100, valorFixoProduto };
    return { unitario: Math.round((final / qtd) * 100) / 100, total: Math.round(final * 100) / 100, diag };
  }

  // ============ VENDA AVULSA (MotorFinanceiro.CalcularValorVendaAvulsa) ============
  if (b.frente === 'Avulso') {
    const categoria = String(b.categoria || '');
    const dados = await leitor.produto(b.produto);
    if (!dados) throw new ErroPreco(`Produto '${b.produto}' não encontrado ou sem preços.`);
    let base = precoBase(dados, isFixo);
    // Serviço e Acessório usam o valor fixo quando ele existe
    if ((categoria === 'Serviço' || categoria === 'Acessório') && dados.valorFixo > 0) base = dados.valorFixo;
    const precoAcab = comAcab(base, await leitor.taxaAcabamento(b.acabamento));
    let unit = 0;
    if (['Perfil', 'Trilhos', 'Puxador'].includes(categoria)) unit = precoAcab * (alturaS(b) / 1000);
    else if (categoria === 'Revestimento') unit = precoAcab * (alturaS(b) / 1000) * (largS(b) / 1000);
    else if (categoria === 'Serviço' || categoria === 'Acessório') unit = precoAcab;
    else throw new ErroPreco('Categoria inválida');
    // desconto do cliente só na tabela FIXO (na tabela CHEIO o desconto é no fechamento)
    if (isFixo && descontoCliente > 0) unit *= (100 - descontoCliente) / 100;
    unit = aplicarPercentuais(unit, b.percentuais);
    return { unitario: Math.round(unit * 100) / 100, total: Math.round(unit * qtd * 100) / 100, diag };
  }

  // ============ FRENTE PORTAS (MotorFinanceiro.CalcularValorVendaPorta) ============
  const altura = parseFloat(b.altura) || 0;
  const largura = parseFloat(b.largura) || 0;

  const dadosPerfil = await leitor.produto(b.perfil);
  if (!dadosPerfil) throw new ErroPreco(`Perfil '${b.perfil}' não encontrado ou sem preços.`);
  const dadosPux = b.puxador ? await leitor.produto(b.puxador) : null;
  const dadosRev = b.revestimento ? await leitor.produto(b.revestimento) : null;
  const dadosDiv = b.divisor ? await leitor.produto(b.divisor) : null;

  const taxaPerfil = await leitor.taxaAcabamento(b.acabPerfil);
  const taxaPux = dadosPux ? await leitor.taxaAcabamento(b.acabPuxador) : 0;
  const taxaRev = dadosRev ? await leitor.taxaAcabamento(b.acabRevest) : 0;

  const temPux = !!dadosPux;
  const posPux = String(b.posicaoPuxador || '').toUpperCase();
  // VB usa porta.TipoPuxador (já com " Total" quando toda extensão); o cadastro é o reserva
  const tipoPux = String(b.tipoPuxador || dadosPux?.tipoPuxador || '').toUpperCase();
  const qtdPux = posPux ? posPux.split(',').filter(p => p.trim()).length : 0;
  const isSobreposto = tipoPux.includes('SOBREPOSTO');
  const isEmbutido = tipoPux.includes('EMBUTIDO');
  const isTotal = tipoPux.includes('TOTAL') || posPux.includes('TOTAL');

  // 1. PERFIL (puxador Total desconta o lado dele)
  const ladoPux = (posPux.includes('TOPO') || posPux.includes('BASE')) ? largura : altura;
  const ladoOp  = (posPux.includes('TOPO') || posPux.includes('BASE')) ? altura : largura;
  const perimetro = (temPux && isTotal && !isSobreposto && !isEmbutido)
    ? 2 * ladoOp + ladoPux * Math.max(0, 2 - qtdPux)
    : 2 * altura + 2 * largura;
  const precoMPerfil = comAcab(precoBase(dadosPerfil, isFixo), taxaPerfil);
  subtotal += (perimetro / 1000) * precoMPerfil;

  // 2. PUXADOR (mínimo R$ 20/un — fiel ao VB)
  if (dadosPux) {
    const compUnit = isTotal ? ladoPux : (parseFloat(b.tamanhoPuxador) || 0);
    const custo = (compUnit * qtdPux / 1000) * comAcab(precoBase(dadosPux, isFixo), taxaPux);
    subtotal += Math.max(20 * qtdPux, custo);
  }

  // 3. DIVISORES (qtdDivH = horizontais, qtdDivV = verticais — fiel ao VB)
  let compDiv = 0;
  if (dadosDiv) {
    const largV = Math.max(0, largura - dadosPerfil.descontoVidro);
    const altV  = Math.max(0, altura - dadosPerfil.descontoVidro);
    compDiv = (parseInt(b.qtdDivH) || 0) * largV + (parseInt(b.qtdDivV) || 0) * altV;
    subtotal += (compDiv / 1000) * comAcab(precoBase(dadosDiv, isFixo), taxaPerfil);
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
    subtotal += Math.max(0, area - areaDiv) * comAcab(precoBase(dadosRev, isFixo), taxaRev);
  }

  // 5. Desconto do cliente + percentuais da linha
  let final = subtotal;
  if (descontoCliente > 0) final *= (100 - descontoCliente) / 100;
  final = aplicarPercentuais(final, b.percentuais);

  diag.perfil = {
    fixo: dadosPerfil.valorFixo, cheio: dadosPerfil.valorCheio,
    taxaAcab: taxaPerfil, precoM: Math.round(precoMPerfil * 100) / 100
  };
  diag.perimetroMm = perimetro;
  return { unitario: Math.round(final * 100) / 100, total: Math.round(final * qtd * 100) / 100, diag };
}

// Porta + acessórios (frmPortasAbrir.vb:2096-2110): base = portas + acessórios; unitário = base / folhas.
// acessorios: [{ nome, qtd, tamanho?, origem }] já validados; devolve cada um com valorUnitario.
async function precoComAcessorios(entrada, cliente, leitor, acessorios = []) {
  const r = await calcularPrecoItem(entrada, cliente, leitor);
  // sem acessórios: exatamente o que o /calcular_preco devolve à tela (mesmo arredondamento)
  if (!acessorios.length) return { unitario: r.unitario, total: r.total, acessorios: [], diag: r.diag };
  const qtd = parseFloat(entrada.qtd) > 0 ? parseFloat(entrada.qtd) : 1;
  const precificados = [];
  let somaAc = 0;
  for (const a of acessorios) {
    const dados = await leitor.produto(a.nome);
    if (!dados) throw new ErroPreco(`Acessório '${a.nome}' não encontrado ou sem preços.`);
    const valorUnitario = Math.round(precoAcessorio(dados, cliente || { isFixo: false, desconto: 0 }, a.origem) * 100) / 100;
    somaAc += valorUnitario * (parseInt(a.qtd) || 0);
    precificados.push({ ...a, valorUnitario });
  }
  const base = Math.round((r.total + somaAc) * 100) / 100;
  return { unitario: Math.round(base / qtd * 100) / 100, total: base, acessorios: precificados, diag: r.diag };
}

module.exports = { precoComAcessorios, ErroPreco, criarLeitor, lerCliente, calcularPrecoItem, precoAcessorio, fatorHistorico, aplicarPercentuais };
