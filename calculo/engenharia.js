// ============================================================
// ENGENHARIA DAS PORTAS — regras do VB (ModPedOrc.ProcessarPortasNoBanco,
// AgruparFolhasIdenticas, frmPortasCorrer). Funções puras: o cadastro chega pronto.
// ============================================================
class ErroEngenharia extends Error {}

const txt = v => String(v ?? '').trim();
// CInt do VB: arredonda para o inteiro mais próximo e, no empate, para o par (12,5 → 12; 13,5 → 14)
function cint(v) {
  const n = Number(v) || 0, f = Math.floor(n), d = n - f;
  if (Math.abs(d - 0.5) < 1e-9) return f % 2 === 0 ? f : f + 1;
  return Math.round(n);
}
const num = v => parseFloat(String(v ?? '').replace(',', '.')) || 0;

// "Revestimento", "Vidro", "Acessório", "Kit", "Trilho" não exigem perfil
function exigePerfil(tipoProduto) {
  const t = txt(tipoProduto).toUpperCase();
  return !['REVESTIMENTO', 'VIDRO', 'ACES', 'KIT', 'TRILHO'].some(p => t.includes(p));
}

const furosUnicos = lista => [...new Set((lista || []).map(Number).filter(f => f > 0))].sort((a, b) => a - b);

const temSistemaCorrer = sistema => !!txt(sistema) && txt(sistema) !== 'Sem sistema';

// larguras individuais das portas de correr: n números inteiros (0 = automática)
function larguraEditadas(lista, n) {
  const l = Array.isArray(lista) ? lista : [];
  return Array.from({ length: n }, (_, i) => { const v = Math.round(num(l[i])); return v > 0 ? v : 0; });
}

// Vão que os trilhos cobrem quando há largura editada (frmPortasCorrer.EditarTamanho: soma das folhas − transpasse × (n − 1));
// sem edição vale o vão digitado
function larguraRealDoVao(item, folhas) {
  const d = item.detalhes || {};
  // uma porta só: os trilhos cobrem o vão digitado, mesmo com a porta menor (largura própria)
  if (folhas.length === 1 || !larguraEditadas(d.largurasFolhas, folhas.length).some(v => v > 0)) return num(item.largura);
  return folhas.reduce((t, f) => t + f.largura, 0) - num(d.transpasse) * Math.max(folhas.length - 1, 0);
}

// Item da tela → uma Folha por porta (item.qtd folhas)
function folhasDoItem(item, { descontoAlturaSistema = 0 } = {}) {
  const d = item.detalhes || {};
  const n = Math.max(1, parseInt(item.qtd) || 1);
  let altura = num(item.altura), larguraPadrao = num(item.largura), alturaVao = null, larguraVao = null;
  if (item.frente === 'Porta de Correr' && temSistemaCorrer(d.sistema)) {
    // frmPortasCorrer: a medida é o vão; porta = vão − desconto do sistema; largura com transpasse
    alturaVao = altura; larguraVao = larguraPadrao;
    const transp = num(d.transpasse);
    altura = Math.round(alturaVao - num(descontoAlturaSistema));
    larguraPadrao = Math.round(n > 1 ? (larguraVao + transp * (n - 1)) / n : larguraVao);
  }
  // frmPortasCorrer (LarguraEditada): cada porta de correr pode ter largura própria; 0/ausente = a automática
  const editadas = item.frente === 'Porta de Correr' ? larguraEditadas(d.largurasFolhas, n) : [];
  const furos = furosUnicos(item.furos?.lista);
  // divisor: acabamento/cor do perfil e tamanho da folha (frmPortasCorrer.vb:1519)
  const divH = parseInt(d.divH) || 0, divV = parseInt(d.divV) || 0, temDiv = divH > 0 || divV > 0;
  const posicoes = Array.isArray(d.posicoesFolhas) ? d.posicoesFolhas : [];
  const lados = item.furos?.lados || [];
  const folhas = [];
  for (let i = 0; i < n; i++) {
    const pos = txt(posicoes[i] ?? posicoes[0] ?? '');
    const puxador = txt(d.puxador);
    const largura = editadas[i] > 0 ? editadas[i] : larguraPadrao;
    folhas.push({
      altura, largura, alturaVao, larguraVao,
      perfil: txt(d.perfil), acabPerfil: txt(d.acabamento), corPerfil: txt(d.cor), usinagemPerfil: '',
      revestimento: txt(d.revestimento), corRevestimento: txt(d.corRevest),
      puxador, acabPuxador: txt(d.acabPux), corPuxador: txt(d.corPux), tamanhoPuxador: num(d.tamanhoPux),
      usinagemPuxador: '', tipoPuxador: puxador ? txt(d.tipoPuxador) : '',
      qtdPuxador: puxador && pos ? pos.split(',').filter(p => p.trim()).length : 0,
      posicaoPuxador: puxador ? pos : '',
      divisor: txt(d.divisor), acabDivisor: temDiv ? txt(d.acabamento) : '', corDivisor: temDiv ? txt(d.cor) : '',
      qtdDivH: divH, qtdDivV: divV, tamDivH: divH > 0 ? largura : 0, tamDivV: divV > 0 ? altura : 0,
      posicaoFuros: furos.length ? (txt(lados[i]) || 'Esquerdo') : '',
      furos, obs: txt(item.obs), valorUnitario: 0
    });
  }
  return folhas;
}

// ChaveAssinaturaPorta: folhas iguais ⇒ mesma chave
const CAMPOS_CHAVE = ['altura', 'largura', 'perfil', 'acabPerfil', 'corPerfil', 'usinagemPerfil', 'revestimento', 'corRevestimento',
  'puxador', 'acabPuxador', 'corPuxador', 'tipoPuxador', 'posicaoPuxador', 'qtdPuxador', 'tamanhoPuxador', 'usinagemPuxador',
  'divisor', 'acabDivisor', 'corDivisor', 'qtdDivH', 'qtdDivV', 'tamDivH', 'tamDivV', 'posicaoFuros', 'obs'];
const chaveFolha = f => CAMPOS_CHAVE.map(c => String(f[c] ?? '')).join('|') + '|' + (f.furos || []).join(',');

function agruparFolhas(folhas) {
  const mapa = new Map();
  for (const f of folhas) {
    const k = chaveFolha(f);
    if (mapa.has(k)) mapa.get(k).qtd++;
    else mapa.set(k, { folha: f, qtd: 1 });
  }
  return [...mapa.values()];
}

// Situação do puxador na folha (posição normalizada, fatores por eixo)
function situacao(f) {
  const posicoes = txt(f.posicaoPuxador).split(',').map(p => p.trim().toUpperCase()).filter(Boolean);
  const fatorPux = f.qtdPuxador >= 2 ? 2 : f.qtdPuxador === 1 ? 1 : 0;
  const lat = posicoes.filter(p => p.startsWith('LATERAL')).length;
  const tb = posicoes.filter(p => p.startsWith('TOPO') || p.startsWith('BASE')).length;
  return {
    semPuxador: !txt(f.puxador) || txt(f.tipoPuxador).toLowerCase() === 'embutido',
    temLateral: lat > 0, temTopoBase: tb > 0,
    ehTotal: posicoes.some(p => p.endsWith(' TOTAL')),
    fatorLateral: lat > 0 ? Math.max(fatorPux, Math.min(lat, 2)) : 0,
    fatorTopoBase: tb > 0 ? Math.max(fatorPux, Math.min(tb, 2)) : 0
  };
}

function medidasVidro(f, perfil, puxador) {
  if (!txt(f.revestimento)) return null;
  // ModPedOrc.vb:400-445: descontos e medidas são Integer no VB
  const dvPerfil = perfil ? cint(perfil.descontoVidro) : 0;
  const dvPux = puxador ? cint(puxador.descontoVidro) : 0;
  const dPerfPux = puxador ? cint(puxador.descontoPerfilPux) : 0;
  const s = situacao(f);
  const A = cint(f.altura), L = cint(f.largura);
  f = { ...f, altura: A, largura: L };
  let a = 0, l = 0;
  // posição do puxador não reconhecida (nem lateral nem topo/base): não bloqueia, vale só o desconto do perfil
  if (s.semPuxador || (!s.temLateral && !s.temTopoBase)) { a = f.altura - dvPerfil * 2; l = f.largura - dvPerfil * 2; }
  else {
    if (s.ehTotal) {
      if (s.temLateral) { a = f.altura - dvPerfil * 2; l = f.largura - dPerfPux - dvPux * s.fatorLateral; }
      if (s.temTopoBase) { a = f.altura - dvPerfil - dvPux * s.fatorTopoBase; l = f.largura - dvPerfil * 2; }
    } else if (s.temLateral) { a = f.altura - dvPerfil * 2; l = f.largura - dvPerfil * 2 - dvPux * s.fatorLateral; }
    else if (s.temTopoBase) { a = f.altura - dvPerfil * 2 - dvPux * s.fatorTopoBase; l = f.largura - dvPerfil * 2; }
  }
  return { altura: a, largura: l };
}

function medidasPerfil(f, puxador) {
  const dPerfPux = puxador ? cint(puxador.descontoPerfilPux) : 0;
  const s = situacao(f);
  f = { ...f, altura: cint(f.altura), largura: cint(f.largura) };
  if (s.semPuxador || (!s.temLateral && !s.temTopoBase)) return { qtdAltura: 2, tamAltura: f.altura, qtdLargura: 2, tamLargura: f.largura };
  let r = { qtdAltura: 0, tamAltura: 0, qtdLargura: 0, tamLargura: 0 };
  if (s.ehTotal && s.temLateral) r = { qtdAltura: s.fatorLateral >= 2 ? 0 : 1, tamAltura: f.altura, qtdLargura: 2, tamLargura: f.largura - dPerfPux * s.fatorLateral };
  else if (s.ehTotal && s.temTopoBase) r = { qtdAltura: s.fatorTopoBase >= 2 ? 0 : 2, tamAltura: f.altura - dPerfPux * s.fatorTopoBase, qtdLargura: 2, tamLargura: f.largura - dPerfPux * s.fatorTopoBase };
  else if (s.temLateral) r = { qtdAltura: 2, tamAltura: f.altura, qtdLargura: 2, tamLargura: f.largura - dPerfPux * s.fatorLateral };
  else if (s.temTopoBase) r = { qtdAltura: 2, tamAltura: f.altura - dPerfPux * s.fatorTopoBase, qtdLargura: 2, tamLargura: f.largura };
  return r;
}

// frmPortasCorrer.CarregarItensDoSistemaNaMemoria
function acessoriosDoSistema(itensSistema, config, { larguraVao, folhas, incluirDesempenador }) {
  const multSup = config?.qtdTrilhoSup ?? 1, multInf = config?.qtdTrilhoInf ?? 1;
  const n = folhas > 0 ? folhas : 2;
  const saida = [];
  for (const it of itensSistema || []) {
    const classe = txt(it.classe), nome = txt(it.modelo), C = classe.toUpperCase(), N = nome.toUpperCase();
    if (classe === 'Desempenador' && !incluirDesempenador) continue;
    const qtdBase = parseInt(it.qtd) || 0;
    const mult = txt(it.multiplicador).toUpperCase();
    const multAtivo = ['SIM', 'PORTA', 'X'].includes(mult);
    const trilhoOuBandeira = C.includes('TRILHO') || N.includes('TRILHO') || C.includes('BANDEIRA') || N.includes('BANDEIRA');
    let qtd = multAtivo || !trilhoOuBandeira ? qtdBase * n : qtdBase;
    let tamanho = 0;
    if (C.includes('TRILHO') && (C.includes('SUP') || N.includes('SUP'))) { tamanho = larguraVao; qtd = qtdBase * multSup; }
    else if (C.includes('TRILHO') && (C.includes('INF') || N.includes('INF'))) { tamanho = larguraVao; qtd = qtdBase * multInf; }
    else if (C.includes('BANDEIRA') || N.includes('BANDEIRA')) { tamanho = larguraVao; qtd = qtdBase * multSup; }
    if (qtd > 0) saida.push({ nome, classe, qtd, tamanho }); // qtd 0 (config ou receita) não entra: nem na tela nem na gravação
  }
  return saida;
}

// O VB grava, nas portas de correr, QTD = nº de folhas em CADA linha (3 portas = 3 linhas, uma por folha, todas com QTD 3), quando o certo
// é QTD 1 por linha. Reconhecido pela descrição "Portas: N": N linhas, todas com QTD = N. A web nunca grava assim (nos grupos de folhas
// iguais a soma das QTD é N), então não há confusão. Devolve true quando as QTD devem ser lidas como 1.
function qtdInfladaVB(linhas, descricao) {
  const m = /Portas:\s*(\d+)/.exec(String(descricao ?? ''));
  const n = m ? parseInt(m[1], 10) : 0;
  const ls = Array.isArray(linhas) ? linhas : [];
  return n > 1 && ls.length === n && ls.every(r => num(r.QTD) === n);
}

module.exports = { qtdInfladaVB, larguraEditadas, larguraRealDoVao, cint, ErroEngenharia, exigePerfil, furosUnicos, temSistemaCorrer, folhasDoItem, chaveFolha, agruparFolhas, medidasVidro, medidasPerfil, acessoriosDoSistema };
