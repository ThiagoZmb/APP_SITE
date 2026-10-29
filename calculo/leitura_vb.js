// ============================================================
// LEITURA banco → tela (caminho inverso do ModPedOrc; carregador do VB:
// Modulo_Pedido_Orçamento.Carregar_Pedido_Com_DNA). Puro: recebe as linhas lidas.
// Item que a tela não representa sem perder dado vem 🔒 travado e é copiado como está ao salvar.
// ============================================================
const crypto = require('crypto');
const { folhasDoItem, agruparFolhas, furosUnicos } = require('./engenharia');
const { fatorHistorico } = require('./precos');

const FRENTE_DA_TELA = { 'Porta de giro': 'Porta de giro', 'Porta basculante': 'Porta basculante', 'Frente de gaveta': 'Frente de gaveta', 'Porta de correr': 'Porta de Correr' };
const CATEGORIAS_AVULSO = ['Serviço', 'Perfil', 'Puxador', 'Revestimento', 'Trilhos', 'Acessório'];
const ORIGEM_SIS = 'SISTEMA DE CORRER';
// o que a tela guarda uma vez só por item: precisa ser igual em todas as configurações de folha
const CAMPOS_COMUNS = ['ALTURA', 'LARGURA', 'ALTURA_VAO', 'LARGURA_VAO', 'PERFIL', 'ACABAMENTO_PERFIL', 'COR_PERFIL', 'REVESTIMENTO', 'COR_REVESTIMENTO',
  'PUXADOR', 'ACABAMENTO_PUXADOR', 'COR_PUXADOR', 'TAM_PUXADOR', 'TIPO_PUXADOR', 'DIVISOR', 'QTD_HORIZONTAL', 'QTD_VERTICAL', 'OBS'];
// coluna de itens_v4 ↔ campo da Folha (engenharia.js) para a conferência de ida e volta
const IDA_VOLTA = { QTD: 'qtd', ALTURA: 'altura', LARGURA: 'largura', PERFIL: 'perfil', ACABAMENTO_PERFIL: 'acabPerfil', COR_PERFIL: 'corPerfil',
  REVESTIMENTO: 'revestimento', COR_REVESTIMENTO: 'corRevestimento', PUXADOR: 'puxador', ACABAMENTO_PUXADOR: 'acabPuxador', COR_PUXADOR: 'corPuxador',
  TAM_PUXADOR: 'tamanhoPuxador', TIPO_PUXADOR: 'tipoPuxador', QTD_PUXADOR: 'qtdPuxador', POSICAO_PUXADOR: 'posicaoPuxador', DIVISOR: 'divisor',
  QTD_HORIZONTAL: 'qtdDivH', QTD_VERTICAL: 'qtdDivV' };

const txt = v => String(v ?? '').trim();
const num = v => parseFloat(v) || 0;
const igual = (a, b) => (typeof a === 'number' || typeof b === 'number') ? num(a) === num(b) : txt(a) === txt(b);
const arred2 = v => Math.round(v * 100) / 100;
const porItem = (lista, n, campo = 'ITEM_PEDIDO') => lista.filter(r => Number(r[campo]) === n);

class Trava extends Error {}

function cabecalhoDe(c) {
  return {
    tipo: c.TIPO, numero: Number(c.NUMERO), razaoSocial: c.RAZAO_SOCIAL, clienteFinal: txt(c.CLIENTE_FINAL), obsGeral: txt(c.OBS_GERAL),
    descontoPct: num(c.DESCONTO), data: txt(c.DATA), dataEntrega: txt(c.DATA_PRONTO).slice(0, 10), situacao: txt(c.SITUACAO), financeiro: txt(c.FINANCEIRO)
  };
}

const detalhesVazios = () => ({ perfil: '', acabamento: '', cor: '', puxador: '', tipoPuxador: '', posicao: '', posicoesFolhas: [], acabPux: '', corPux: '',
  tamanhoPux: '', revestimento: '', corRevest: '', divisor: '', divH: 0, divV: 0, pares: false, todaExt: false, sistema: '', transpasse: '', desempenador: false,
  produto: '', material: '', acabSerr: '', corSerr: '', categoria: '', avProduto: '', avAcab: '', avCor: '' });

// furação do item: nova sequência a cada FURO = 1 (como o carregador do VB)
function sequenciasDeFuros(furacao) {
  const seqs = [];
  for (const f of furacao) {
    if (Number(f.FURO) === 1 || !seqs.length) seqs.push({ lado: txt(f.LADO) || 'Esquerdo', medidas: [] });
    seqs[seqs.length - 1].medidas.push(num(f.TAMANHO));
  }
  return seqs;
}

function traduzirPorta(l, linhas, sistemas) {
  const n = Number(l.ITEM);
  const cfgs = porItem(linhas.itensV4, n).sort((a, b) => num(a.ITEM) - num(b.ITEM));
  if (!cfgs.length) throw new Trava('item antigo, sem as folhas gravadas');
  if (cfgs.some(c => txt(c.USINAGEM_PERFIL) || txt(c.USINAGEM_PUXADOR))) throw new Trava('tem usinagem gravada');
  const c0 = cfgs[0];
  // porta de correr: cada folha pode ter largura própria (LarguraEditada do VB); o resto continua igual em todas
  const correr = FRENTE_DA_TELA[l.TIPO_PRODUTO] === 'Porta de Correr';
  const comuns = correr ? CAMPOS_COMUNS.filter(k => k !== 'LARGURA') : CAMPOS_COMUNS;
  if (cfgs.some(c => comuns.some(k => !igual(c[k], c0[k])))) throw new Trava('folhas com medidas ou materiais diferentes entre si');
  const seqs = sequenciasDeFuros(porItem(linhas.furacao, n, 'ITEM'));
  if (seqs.length && (seqs.length !== cfgs.length || seqs.some(s => s.medidas.join() !== seqs[0].medidas.join())))
    throw new Trava('furos diferentes entre as folhas');

  const frente = FRENTE_DA_TELA[l.TIPO_PRODUTO];
  const posicoes = [], lados = [];
  cfgs.forEach((c, k) => { for (let i = 0; i < num(c.QTD); i++) { posicoes.push(txt(c.POSICAO_PUXADOR)); lados.push(seqs[k]?.lado || 'Esquerdo'); } });
  const qtd = posicoes.length;
  const d = { ...detalhesVazios(), perfil: txt(c0.PERFIL), acabamento: txt(c0.ACABAMENTO_PERFIL), cor: txt(c0.COR_PERFIL), puxador: txt(c0.PUXADOR),
    tipoPuxador: txt(c0.TIPO_PUXADOR), posicao: posicoes[0] || '', posicoesFolhas: posicoes, acabPux: txt(c0.ACABAMENTO_PUXADOR), corPux: txt(c0.COR_PUXADOR),
    tamanhoPux: num(c0.TAM_PUXADOR) ? String(num(c0.TAM_PUXADOR)) : '', revestimento: txt(c0.REVESTIMENTO), corRevest: txt(c0.COR_REVESTIMENTO),
    divisor: txt(c0.DIVISOR), divH: num(c0.QTD_HORIZONTAL), divV: num(c0.QTD_VERTICAL), todaExt: /total/i.test(txt(c0.TIPO_PUXADOR)) };

  const larguras = cfgs.flatMap(c => Array.from({ length: num(c.QTD) }, () => num(c.LARGURA)));
  const desiguais = correr && larguras.some(w => w !== larguras[0]);
  let altura = num(c0.ALTURA), largura = num(c0.LARGURA), sistema = null;
  if (frente === 'Porta de Correr') {
    if (num(c0.ALTURA_VAO) > 0 && num(c0.LARGURA_VAO) > 0) {
      const m = /Sist:\s*([^|]*?)\s*(\||$)/.exec(txt(l.DESCRICAO));
      if (!m || !m[1] || m[1] === 'Sem sistema') throw new Trava('sistema de correr não identificado na descrição');
      sistema = sistemas[m[1]];
      if (!sistema) throw new Trava(`sistema de correr '${m[1]}' não está no cadastro`);
      d.sistema = m[1];
      altura = num(c0.ALTURA_VAO); largura = num(c0.LARGURA_VAO);
      if (!desiguais) d.transpasse = String(qtd > 1 ? Math.round((num(c0.LARGURA) * qtd - largura) / (qtd - 1)) : 0);
      else {
        // larguras diferentes: o transpasse não se deduz das folhas, a gravação o deixa na descrição ("Transp: N")
        const t = /Transp:\s*(\d+(?:[.,]\d+)?)/.exec(txt(l.DESCRICAO));
        if (!t) throw new Trava('larguras diferentes sem o transpasse na descrição');
        d.transpasse = String(num(t[1].replace(',', '.')));
        const auto = Math.round((largura + num(d.transpasse) * (qtd - 1)) / qtd);
        d.largurasFolhas = larguras.map(w => w === auto ? 0 : w);
      }
      // uma porta só mais estreita que o vão (trilho pelo vão): a largura da porta volta como largura própria da folha
      if (!desiguais && qtd === 1 && larguras[0] > 0 && larguras[0] !== largura) d.largurasFolhas = [larguras[0]];
    } else {
      d.sistema = 'Sem sistema';
      if (desiguais) { largura = larguras[0]; d.largurasFolhas = larguras.map(w => w === larguras[0] ? 0 : w); } // a da 1ª folha é a da tela
    }
  }
  const doSistema = new Map((sistema?.itens || []).map(i => [i.modelo, i.classe]));
  const acessorios = porItem(linhas.complementos, n).sort((a, b) => num(a.ITEM) - num(b.ITEM)).map(a => ({
    nome: a.COMPLEMENTO, qtd: num(a.QTD), tamanho: num(a.TAMANHO), origem: doSistema.has(a.COMPLEMENTO) ? ORIGEM_SIS : 'MANUAL' }));
  d.desempenador = acessorios.some(a => a.origem === ORIGEM_SIS && doSistema.get(a.nome) === 'Desempenador');

  const item = { frente, qtd, altura, largura, profundidade: 0, soldas: 0,
    furos: { lista: seqs.length ? [...seqs[0].medidas] : [], lados: seqs.length ? lados : [], referenciaInvertida: false },
    detalhes: d, acessorios, obs: txt(l.OBSERVACAO) };

  // ida e volta: o que a gravação geraria a partir da tradução precisa ser o que está no banco
  const grupos = agruparFolhas(folhasDoItem(item, { descontoAlturaSistema: sistema?.descontoAltura || 0 }));
  const bate = grupos.length === cfgs.length && grupos.every((g, k) => {
    const f = { ...g.folha, qtd: g.qtd };
    return Object.entries(IDA_VOLTA).every(([col, campo]) => igual(f[campo], cfgs[k][col])) &&
      (seqs.length ? f.furos.join() === furosUnicos(seqs[k].medidas).join() && seqs[k].medidas.join() === f.furos.join() && f.posicaoFuros === seqs[k].lado : !f.furos.length);
  });
  if (!bate) throw new Trava('a tradução não reproduz o que está gravado');
  return item;
}

function traduzirSerralheria(l, linhas, componentesSerr) {
  const n = Number(l.ITEM);
  // frmSerralheria.listaItens: uma linha por peça (ITEM 1..n); a 1ª também vai nos campos do item (forma antiga)
  const subs = porItem(linhas.serralheria, n).sort((a, b) => num(a.ITEM) - num(b.ITEM));
  if (!subs.length) throw new Trava('serralheria sem peças gravadas');
  const s = subs[0];
  // complementos: a tela trabalha com o id do cadastro; o banco guarda tipo + descrição
  const doProduto = componentesSerr[s.PRODUTO] || [];
  const fator = fatorHistorico(txt(l.PORCENTAGEM)) || 1;
  const complementos = porItem(linhas.serralheriaComp, n).sort((a, b) => num(a.SUB_ITEM) - num(b.SUB_ITEM)).map(c => {
    const comp = doProduto.find(x => txt(x.tipo) === txt(c.TIPO_COMPONENTE) && txt(x.descricao) === txt(c.DESCRICAO));
    if (!comp) throw new Trava(`complemento '${txt(c.DESCRICAO)}' não está mais no cadastro do produto`);
    return { ...comp, qtd: num(c.QUANTIDADE), valorTotal: arred2(num(c.VALOR_UNITARIO) / fator * num(c.QUANTIDADE)) };
  });
  const eixo = v => Math.max(1, num(v) || 1);
  const pecas = subs.map(x => ({ produto: txt(x.PRODUTO), material: txt(x.MATERIAL), acabSerr: txt(x.ACABAMENTO), corSerr: txt(x.COR),
    altura: num(x.ALTURA), largura: num(x.LARGURA), profundidade: num(x.PROFUNDIDADE), soldas: num(x.QTD_SOLDAS),
    qtdAltura: eixo(x.QTD_ALTURA), qtdLargura: eixo(x.QTD_LARGURA), qtdProfundidade: eixo(x.QTD_PROFUNDIDADE) }));
  return { frente: 'Serralheria', qtd: num(l.QTD), pecas, altura: num(s.ALTURA), largura: num(s.LARGURA), profundidade: num(s.PROFUNDIDADE), soldas: num(s.QTD_SOLDAS),
    qtdAltura: eixo(s.QTD_ALTURA), qtdLargura: eixo(s.QTD_LARGURA), qtdProfundidade: eixo(s.QTD_PROFUNDIDADE), complementos,
    furos: { lista: [], lados: [], referenciaInvertida: false }, acessorios: [],
    detalhes: { ...detalhesVazios(), produto: txt(s.PRODUTO), material: txt(s.MATERIAL), acabSerr: txt(s.ACABAMENTO), corSerr: txt(s.COR) }, obs: txt(s.OBS) };
}

function traduzirAvulso(l, linhas) {
  const cfgs = porItem(linhas.itensV4, Number(l.ITEM));
  if (cfgs.length !== 1) throw new Trava('item avulso fora do formato da web');
  const c = cfgs[0];
  return { frente: 'Avulso', qtd: num(l.QTD), altura: num(c.ALTURA), largura: num(c.LARGURA), profundidade: 0, soldas: 0,
    furos: { lista: [], lados: [], referenciaInvertida: false }, acessorios: [],
    detalhes: { ...detalhesVazios(), categoria: l.TIPO_PRODUTO, avProduto: txt(c.PERFIL), avAcab: txt(c.ACABAMENTO_PERFIL), avCor: txt(c.COR_PERFIL) }, obs: txt(l.OBSERVACAO) };
}

function traduzirDocumento(linhas, { sistemas = {}, componentesSerr = {} } = {}) {
  const itens = [...linhas.lista].sort((a, b) => num(a.ITEM) - num(b.ITEM)).map(l => {
    const origem = { item: Number(l.ITEM), estado: 'intacto' };
    const historico = txt(l.PORCENTAGEM);
    try {
      let it;
      if (FRENTE_DA_TELA[l.TIPO_PRODUTO]) it = traduzirPorta(l, linhas, sistemas);
      else if (l.TIPO_PRODUTO === 'Metalons') it = traduzirSerralheria(l, linhas, componentesSerr);
      else if (CATEGORIAS_AVULSO.includes(l.TIPO_PRODUTO)) it = traduzirAvulso(l, linhas);
      else throw new Trava('tipo de produto que só o VB edita');
      // porta de correr: a lista guarda o conjunto (QTD 1); a tela mostra por folha
      const valor = it.frente === 'Porta de Correr' ? arred2(num(l.UNITARIO) / it.qtd) : num(l.UNITARIO);
      const fator = fatorHistorico(historico) || 1;
      return { ...it, valor, valorBase: arred2(valor / fator), historico, descricao: String(l.DESCRICAO ?? ''), origem };
    } catch (err) {
      if (!(err instanceof Trava)) throw err;
      return { travado: true, motivo: err.message, frente: l.TIPO_PRODUTO, qtd: num(l.QTD), descricao: String(l.DESCRICAO ?? ''),
        valor: num(l.UNITARIO), historico, obs: txt(l.OBSERVACAO), origem: { ...origem, estado: 'travado' } };
    }
  });
  return { cabecalho: cabecalhoDe(linhas.cab), itens };
}

// SHA-256 de todas as linhas do documento (colunas em ordem alfabética, linhas por id) — detecta edição por outra pessoa
function impressaoDigital(linhas, tipo) {
  const tabelas = ['cab', 'lista', 'itensV4', 'complementos', 'furacao', 'serralheria', 'serralheriaComp', ...(tipo === 'Pedido' ? ['vidros', 'perfis'] : [])];
  const canon = r => Object.keys(r).sort().map(k => [k, r[k] === null || r[k] === undefined ? null : String(r[k])]);
  const idDe = r => num(r.id ?? r.ID);
  const dados = tabelas.map(t => [t, (t === 'cab' ? [linhas.cab] : [...(linhas[t] || [])].sort((a, b) => idDe(a) - idDe(b))).map(canon)]);
  return crypto.createHash('sha256').update(JSON.stringify(dados)).digest('hex');
}

// Carimbo do conteúdo dos itens: serve para saber se um desenho guardado ainda é o desta porta.
// Só entra o que define a porta (medidas, puxador, furos, tipo e quantidade); cabeçalho, descrição e dinheiro ficam de fora,
// então mudar situação, data ou preço não esconde os desenhos. Recebe as linhas cruas (SELECT *) e não depende da ordem.
const COLUNAS_LISTA_CARIMBO = ['ITEM', 'QTD', 'TIPO_PRODUTO'];
const PRECO_CARIMBO = ['UNITARIO', 'TOTAL'];   // itensV4 também guarda o preço da linha
function carimboItens(linhas = {}) {
  const canon = (r, colunas) => JSON.stringify(Object.keys(r).filter(k => k !== 'id' && k !== 'ID' && !PRECO_CARIMBO.includes(k) && (!colunas || colunas.includes(k))).sort()
    .map(k => [k, r[k] === null || r[k] === undefined ? null : String(r[k])]));
  const tabela = (rows, colunas) => (rows || []).map(r => canon(r, colunas)).sort();
  return crypto.createHash('sha256').update(JSON.stringify([
    tabela(linhas.lista, COLUNAS_LISTA_CARIMBO), tabela(linhas.itensV4), tabela(linhas.furacao)])).digest('hex');
}

module.exports = { traduzirDocumento, impressaoDigital, carimboItens };
