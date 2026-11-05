// ==========================================================================
// Traçador de seções de perfil (Parte 2 da biblioteca de seções). Módulo PURO: roda no Node (testes) e no navegador
// (global PerfilTraco). Sem DOM, sem rede. Quem desenha na tela e fala com a API é perfil_editor.js.
//
// Ideia: a imagem do perfil é só REFERÊNCIA. O dono calibra (dois cliques + distância real em mm) e marca a origem (canto
// inferior esquerdo EXTERNO da seção). Dali em diante tudo é mm, com y PARA CIMA (o mesmo sistema de calculo/perfil_secoes.js:
// x = espessura, y = 0 na borda externa). Os dados salvos são só os pontos em mm.
//
// Estado do traçado: { contorno:{pontos,fechado}, vazados:[{pontos,fechado}], canal:{x0,x1,y0}|null, canalPendente:[x,y]|null }
// Config (campos que não são desenho): { parede, junta, corPadrao:'#rrggbb'|'', cores:[{nome,cor}], estimada:[] }
// Todas as operações devolvem um estado NOVO (nada é alterado no lugar), o que torna desfazer/refazer trivial.
// ==========================================================================
(function (raiz, fabrica) {
  const lib = fabrica(raiz);
  if (typeof module === 'object' && module.exports) module.exports = lib;
  else raiz.PerfilTraco = lib;
})(typeof self !== 'undefined' ? self : this, function (raiz) {
  'use strict';

  let SECOES = raiz.PerfilSecoes || null;
  if (!SECOES && typeof require === 'function') { try { SECOES = require('./perfil_secoes.js'); } catch (_) { SECOES = null; } }

  const PASSO_MM = 0.1;            // o ímã encaixa em múltiplos de 0,1 mm
  const TOL_ALINHAR_PX = 8;        // distância (em pixels de tela) para o ímã alinhar a outro ponto e para fechar o polígono
  const PREVIA_MIN_MM = 150;       // lado mínimo da moldura da prévia 3D
  const COR_PADRAO_INICIAL = '#c3c8cd';
  const PAREDE_INICIAL = 1.5;
  const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const arred = (v, casas = 2) => { const f = Math.pow(10, casas); const r = Math.round(v * f) / f; return r === 0 ? 0 : r; };
  const ehNum = v => typeof v === 'number' && Number.isFinite(v);

  // ----- leitura/formatação de mm (aceita vírgula ou ponto) -----
  function lerMm(texto) {
    if (typeof texto === 'number') return Number.isFinite(texto) ? texto : NaN;
    const s = String(texto == null ? '' : texto).trim().replace(/\s/g, '').replace(/mm$/i, '');
    if (!s || !/^-?\d+([.,]\d+)?$/.test(s)) return NaN;
    return Number(s.replace(',', '.'));
  }
  const formatarMm = v => (ehNum(v) ? String(arred(v, 2)).replace('.', ',') : '');

  // ----- calibração: pixels da imagem <-> mm -----
  // Dois pontos da imagem (px) + a distância real entre eles (mm) => mm por pixel.
  function calibrar(p1, p2, distanciaMm) {
    const mm = lerMm(distanciaMm);
    if (!p1 || !p2 || !ehNum(p1.px) || !ehNum(p1.py) || !ehNum(p2.px) || !ehNum(p2.py)) return { ok: false, erro: 'Marque os dois pontos na imagem.' };
    const dpx = Math.hypot(p2.px - p1.px, p2.py - p1.py);
    if (dpx < 2) return { ok: false, erro: 'Os dois pontos estão muito próximos. Marque os extremos da cota.' };
    if (!(mm > 0) || mm > 1000) return { ok: false, erro: 'Informe a distância real em mm (maior que zero).' };
    return { ok: true, mmPorPx: mm / dpx, distanciaPx: dpx, distanciaMm: mm };
  }
  // Calibração sem imagem (grade em branco): 8 px por mm, origem no canto inferior esquerdo da área.
  const calibracaoPadrao = () => ({ mmPorPx: 1 / 8, origem: { px: 48, py: 420 } });
  const calibracaoCompleta = cal => !!(cal && ehNum(cal.mmPorPx) && cal.mmPorPx > 0 && cal.origem && ehNum(cal.origem.px) && ehNum(cal.origem.py));
  // pixel da imagem -> [x, y] em mm. A origem é (0,0); y cresce PARA CIMA (py cresce para baixo na imagem).
  function pxParaMm(cal, px, py) {
    return [arred((px - cal.origem.px) * cal.mmPorPx), arred((cal.origem.py - py) * cal.mmPorPx)];
  }
  // [x, y] em mm -> pixel da imagem
  function mmParaPx(cal, x, y) {
    return { px: cal.origem.px + x / cal.mmPorPx, py: cal.origem.py - y / cal.mmPorPx };
  }

  // ----- ímã -----
  // Encaixa um ponto (mm): alinha x e/ou y ao de um ponto de referência (ou à origem) dentro da tolerância -> ângulos retos;
  // eixo que não alinhou arredonda para múltiplo de 0,1 mm. Sem ímã, só arredonda a 0,01.
  function encaixar(ponto, refs, opcoes) {
    const o = opcoes || {};
    const x = ponto[0], y = ponto[1];
    if (o.ima === false) return [arred(x), arred(y)];
    const tol = ehNum(o.tolMm) ? o.tolMm : 1;
    const passo = o.passo || PASSO_MM;
    const lista = (refs || []).slice();
    if (o.incluirOrigem !== false) lista.push([0, 0]);
    const melhor = (eixo, v) => {
      let alvo = null, d = Infinity;
      for (const r of lista) { const dd = Math.abs(r[eixo] - v); if (dd <= tol && dd < d) { d = dd; alvo = r[eixo]; } }
      return alvo;
    };
    const ax = melhor(0, x), ay = melhor(1, y);
    const quant = v => arred(Math.round(v / passo) * passo, 4);
    return [ax !== null ? arred(ax) : arred(quant(x)), ay !== null ? arred(ay) : arred(quant(y))];
  }

  // ----- estado -----
  const poligonoVazio = () => ({ pontos: [], fechado: false });
  const novoEstado = () => ({ contorno: poligonoVazio(), vazados: [], canal: null, canalPendente: null });
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const igual = (a, b) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
  const poligonoDe = (est, alvo) => (alvo.tipo === 'contorno' ? est.contorno : est.vazados[alvo.i]);

  // Clique perto do 1º ponto (com pelo menos 3 pontos) fecha o polígono.
  const pertoDoPrimeiro = (pontos, pt, tolMm) => pontos.length >= 3 && dist(pontos[0], pt) <= tolMm;

  // Conversão de um clique (já em mm) conforme o modo. Devolve { estado, aviso?, fechou? }.
  // modo: 'contorno' | 'vazado' | 'canal'. opcoes: { tolMm (tolerância de fechar/alinhar), ima }
  function aplicarClique(estado, modo, ptMm, opcoes) {
    const o = opcoes || {};
    const tolMm = ehNum(o.tolMm) ? o.tolMm : 1;
    const est = clone(estado);
    const ima = o.ima !== false;
    if (modo === 'contorno' || modo === 'vazado') {
      let poli, nome;
      if (modo === 'contorno') {
        poli = est.contorno; nome = 'contorno';
        if (poli.fechado) return { estado: est, aviso: 'O contorno já está fechado. Arraste os pontos, use a tabela ou “Refazer contorno”.' };
      } else {
        if (!est.contorno.fechado) return { estado: est, aviso: 'Feche o contorno externo antes de traçar os vazados.' };
        let ult = est.vazados[est.vazados.length - 1];
        if (!ult || ult.fechado) { ult = poligonoVazio(); est.vazados.push(ult); }
        poli = ult; nome = 'vazado';
      }
      if (pertoDoPrimeiro(poli.pontos, ptMm, tolMm)) { poli.fechado = true; return { estado: est, fechou: true }; }
      const refs = est.contorno.pontos.concat(...est.vazados.map(v => v.pontos));
      const p = encaixar(ptMm, refs, { tolMm, ima });
      if (poli.pontos.length && igual(poli.pontos[poli.pontos.length - 1], p)) return { estado: estado ? clone(estado) : est, aviso: 'Esse ponto repete o anterior.' };
      poli.pontos.push(p);
      return { estado: est };
    }
    if (modo === 'canal') {
      const refs = est.contorno.pontos.concat(...est.vazados.map(v => v.pontos));
      const p = encaixar(ptMm, refs, { tolMm, ima });
      if (!est.canalPendente) { est.canalPendente = p; return { estado: est, aviso: 'Agora clique na outra lateral do canal (define x0 e x1).' }; }
      const a = est.canalPendente;
      if (Math.abs(p[0] - a[0]) < 1e-9) return { estado: est, aviso: 'As duas laterais do canal não podem ter o mesmo x. Clique em outro lugar.' };
      est.canal = { x0: Math.min(a[0], p[0]), x1: Math.max(a[0], p[0]), y0: a[1] }; // y0 vem do 1º clique
      est.canalPendente = null;
      return { estado: est, canalDefinido: true };
    }
    return { estado: est, aviso: 'Modo de traçado desconhecido.' };
  }

  // fecha/refaz/mexe em polígonos ------------------------------------------------------------------------------------
  function fecharPoligono(estado, alvo) {
    const est = clone(estado);
    const poli = poligonoDe(est, alvo);
    if (!poli) return { estado: est, aviso: 'Polígono inexistente.' };
    if (poli.pontos.length < 3) return { estado: est, aviso: 'Faltam pontos: um polígono precisa de pelo menos 3.' };
    poli.fechado = true;
    return { estado: est, fechou: true };
  }
  function limparPoligono(estado, alvo) {
    const est = clone(estado);
    if (alvo.tipo === 'contorno') est.contorno = poligonoVazio();
    else est.vazados.splice(alvo.i, 1);
    return est;
  }
  function novoVazado(estado) {
    const est = clone(estado);
    const ult = est.vazados[est.vazados.length - 1];
    if (!ult || ult.pontos.length) est.vazados.push(poligonoVazio());
    return est;
  }
  function moverPonto(estado, alvo, idx, ptMm) {
    const est = clone(estado);
    const poli = poligonoDe(est, alvo);
    if (!poli || !poli.pontos[idx]) return est;
    poli.pontos[idx] = [arred(ptMm[0]), arred(ptMm[1])];
    return est;
  }
  function editarCoordenada(estado, alvo, idx, eixo, valor) {
    const v = lerMm(valor);
    if (!Number.isFinite(v)) return null; // valor ilegível: quem chama mantém o que estava
    const est = clone(estado);
    const poli = poligonoDe(est, alvo);
    if (!poli || !poli.pontos[idx]) return est;
    poli.pontos[idx][eixo === 'y' ? 1 : 0] = arred(v);
    return est;
  }
  function apagarPonto(estado, alvo, idx) {
    const est = clone(estado);
    const poli = poligonoDe(est, alvo);
    if (!poli || !poli.pontos[idx]) return est;
    poli.pontos.splice(idx, 1);
    if (poli.pontos.length < 3) poli.fechado = false; // sem 3 pontos não é mais polígono: volta a aceitar cliques
    return est;
  }
  // insere um ponto no meio da aresta que sai do ponto idx
  function inserirDepois(estado, alvo, idx) {
    const est = clone(estado);
    const poli = poligonoDe(est, alvo);
    if (!poli || !poli.pontos[idx]) return est;
    const a = poli.pontos[idx];
    const b = poli.pontos[(idx + 1) % poli.pontos.length];
    const meio = [arred((a[0] + b[0]) / 2), arred((a[1] + b[1]) / 2)];
    poli.pontos.splice(idx + 1, 0, meio);
    return est;
  }
  function editarCanal(estado, campo, valor) {
    const v = lerMm(valor);
    if (!Number.isFinite(v)) return null;
    const est = clone(estado);
    est.canal = { x0: 0, x1: 0, y0: 0, ...(est.canal || {}) };
    est.canal[campo] = arred(v);
    return est;
  }
  const limparCanal = estado => { const e = clone(estado); e.canal = null; e.canalPendente = null; return e; };

  // desloca tudo para que o menor x e o menor y do contorno fiquem em 0 (corrige origem clicada um pouco fora)
  function encostarNaOrigem(estado) {
    const est = clone(estado);
    const pts = est.contorno.pontos;
    if (!pts.length) return est;
    const dx = Math.min(...pts.map(p => p[0])), dy = Math.min(...pts.map(p => p[1]));
    const mv = p => [arred(p[0] - dx), arred(p[1] - dy)];
    est.contorno.pontos = pts.map(mv);
    est.vazados.forEach(v => { v.pontos = v.pontos.map(mv); });
    if (est.canal) est.canal = { x0: arred(est.canal.x0 - dx), x1: arred(est.canal.x1 - dx), y0: arred(est.canal.y0 - dy) };
    return est;
  }

  // ----- toque no ponto (arrastar/apagar) -----
  // candidatos: [{ alvo, idx, px, py }] já em pixels de TELA; devolve o mais próximo dentro do raio, ou null.
  function pontoMaisProximo(candidatos, px, py, raio) {
    let melhor = null, d = Infinity;
    for (const c of candidatos) {
      const dd = Math.hypot(c.px - px, c.py - py);
      if (dd <= raio && dd < d) { d = dd; melhor = c; }
    }
    return melhor;
  }

  // ----- histórico (desfazer/refazer) -----
  function criarHistorico(inicial, limite) {
    const max = limite || 100;
    let pilha = [clone(inicial)], pos = 0;
    return {
      atual: () => clone(pilha[pos]),
      registrar(estado) {
        if (JSON.stringify(estado) === JSON.stringify(pilha[pos])) return false;
        pilha = pilha.slice(0, pos + 1); pilha.push(clone(estado));
        if (pilha.length > max) pilha.shift();
        pos = pilha.length - 1;
        return true;
      },
      desfazer() { if (pos > 0) pos--; return clone(pilha[pos]); },
      refazer() { if (pos < pilha.length - 1) pos++; return clone(pilha[pos]); },
      podeDesfazer: () => pos > 0,
      podeRefazer: () => pos < pilha.length - 1,
      reiniciar(estado) { pilha = [clone(estado)]; pos = 0; }
    };
  }

  // ----- estado/config <-> seção salva -----
  function estadoDaSecao(secao) {
    const est = novoEstado();
    if (!secao || typeof secao !== 'object') return est;
    est.contorno = { pontos: clone(secao.contorno || []), fechado: Array.isArray(secao.contorno) && secao.contorno.length >= 3 };
    est.vazados = (Array.isArray(secao.vazados) ? secao.vazados : []).map(v => ({ pontos: clone(v), fechado: Array.isArray(v) && v.length >= 3 }));
    est.canal = secao.canalVidro && typeof secao.canalVidro === 'object' ? { x0: secao.canalVidro.x0, x1: secao.canalVidro.x1, y0: secao.canalVidro.y0 } : null;
    return est;
  }
  function configPadrao() {
    return { parede: PAREDE_INICIAL, junta: 'reta', corPadrao: '', cores: [], estimada: ['parede'] };
  }
  function configDaSecao(secao) {
    if (!secao || typeof secao !== 'object') return configPadrao();
    const cores = secao.cores && typeof secao.cores === 'object' ? secao.cores : {};
    return {
      parede: ehNum(secao.parede) ? secao.parede : PAREDE_INICIAL,
      junta: secao.junta === 'meia_esquadria' ? 'meia_esquadria' : 'reta',
      corPadrao: typeof cores.padrao === 'string' ? cores.padrao : '',
      cores: Object.keys(cores.porAcabamento || {}).map(nome => ({ nome, cor: cores.porAcabamento[nome] })),
      estimada: Array.isArray(secao.estimada) ? clone(secao.estimada) : []
    };
  }
  // Largura x altura saem do contorno (maior x, maior y), como o servidor espera: a caixa começa em (0,0).
  function caixaDoContorno(pontos) {
    if (!pontos.length) return { largura: 0, altura: 0 };
    return { largura: arred(Math.max(...pontos.map(p => p[0]))), altura: arred(Math.max(...pontos.map(p => p[1]))) };
  }
  function secaoDoEditor(estado, config, meta) {
    const m = meta || {};
    const cx = caixaDoContorno(estado.contorno.pontos);
    const secao = {
      versao: 2, codigo: m.codigo, modelo: m.modelo || '',
      largura: cx.largura, altura: cx.altura,
      contorno: clone(estado.contorno.pontos),
      vazados: estado.vazados.map(v => clone(v.pontos)),
      canalVidro: estado.canal ? { x0: estado.canal.x0, x1: estado.canal.x1, y0: estado.canal.y0 } : undefined,
      parede: config.parede, junta: config.junta,
      estimada: clone(config.estimada || [])
    };
    const porAcabamento = {};
    const vistas = new Set();
    for (const c of config.cores || []) {
      const nome = String(c.nome || '').trim();
      if (!nome) continue; // linha sem nome é ignorada
      const ch = SECOES ? SECOES.chaveAcabamento(nome) : nome.toUpperCase();
      if (vistas.has(ch)) continue; // repetida: o erro aparece em validarEditor
      vistas.add(ch);
      porAcabamento[nome] = c.cor;
    }
    if (config.corPadrao || Object.keys(porAcabamento).length) {
      secao.cores = { porAcabamento };
      if (config.corPadrao) secao.cores.padrao = config.corPadrao;
    }
    return secao;
  }

  // ----- validação em tempo real -----
  // Devolve { secao, erros:[{ onde:{tipo,i?}, texto }] }. tipo: contorno | vazado | canal | parede | junta | cores | geral.
  // Inclui o que o servidor valida (PerfilSecoes.validar, em português) e o que só o editor sabe (polígono aberto, ponto negativo).
  function validarEditor(estado, config, meta) {
    const erros = [];
    const add = (tipo, texto, i) => erros.push({ onde: i === undefined ? { tipo } : { tipo, i }, texto });
    const secao = secaoDoEditor(estado, config, meta);
    const c = estado.contorno;
    if (c.pontos.length < 3) add('contorno', 'Desenhe o contorno externo (mínimo 3 pontos) e feche o polígono.');
    else if (!c.fechado) add('contorno', 'O contorno ainda não está fechado: clique no primeiro ponto ou use “Fechar contorno”.');
    estado.vazados.forEach((v, i) => {
      if (v.pontos.length < 3) add('vazado', `Vazado ${i + 1}: desenhe pelo menos 3 pontos (ou remova este vazado).`, i);
      else if (!v.fechado) add('vazado', `Vazado ${i + 1} ainda não está fechado: clique no primeiro ponto ou use “Fechar”.`, i);
    });
    const negativo = (pontos, tipo, i, rotulo) => pontos.forEach((p, k) => {
      if (p[0] < 0) add(tipo, `${rotulo}, ponto ${k + 1}: x negativo (a origem é o canto inferior esquerdo externo). Use “Encostar na origem”.`, i);
      if (p[1] < 0) add(tipo, `${rotulo}, ponto ${k + 1}: y negativo (a origem é o canto inferior esquerdo externo). Use “Encostar na origem”.`, i);
    });
    negativo(c.pontos, 'contorno', undefined, 'Contorno');
    estado.vazados.forEach((v, i) => negativo(v.pontos, 'vazado', i, `Vazado ${i + 1}`));
    // cores por acabamento repetidas (o objeto da seção esconderia a repetição)
    const vistas = new Set();
    for (const cr of config.cores || []) {
      const nome = String(cr.nome || '').trim();
      if (!nome) continue;
      const ch = SECOES.chaveAcabamento(nome);
      if (vistas.has(ch)) add('cores', `Acabamento repetido nas cores: “${nome}”.`);
      vistas.add(ch);
    }
    if (!SECOES) { add('geral', 'Biblioteca de seções indisponível.'); return { secao, erros }; }
    const brutos = SECOES.validar(SECOES.normalizar(secao));
    const incompleto = c.pontos.length < 3;
    for (const e of brutos) {
      if (/^(largura|altura) inválida/.test(e) && incompleto) continue; // já dito: desenhe o contorno
      if (/^contorno inválido \(mínimo 3 pontos/.test(e)) continue;
      let m;
      if ((m = /^vazados (\d+) e (\d+) /.exec(e))) { add('vazado', `Vazados ${Number(m[1]) + 1} e ${Number(m[2]) + 1} se cruzam ou se sobrepõem.`, Number(m[1])); continue; }
      if ((m = /^vazado (\d+) (.*)$/.exec(e))) {
        if (/inválido \(mínimo 3 pontos/.test(e)) continue; // já dito acima
        add('vazado', `Vazado ${Number(m[1]) + 1} ${m[2]}`, Number(m[1])); continue;
      }
      if (/^contorno /.test(e)) { add('contorno', e[0].toUpperCase() + e.slice(1)); continue; }
      if (/canal do vidro/.test(e)) { add('canal', 'Canal do vidro inválido: defina x0, x1 (maior que x0) e y0 dentro da seção.'); continue; }
      if (/^parede/.test(e)) { add('parede', 'Parede inválida: informe um valor maior que 0 e até a metade do menor lado.'); continue; }
      if (/^junta/.test(e)) { add('junta', 'Junta inválida.'); continue; }
      if (/cor|acabamento/i.test(e)) { add('cores', e[0].toUpperCase() + e.slice(1)); continue; }
      if (/^(largura|altura)/.test(e)) { add('geral', e[0].toUpperCase() + e.slice(1)); continue; }
      add('geral', e[0].toUpperCase() + e.slice(1));
    }
    return { secao, erros };
  }

  // Textos de erro de um ponto "onde" (para mostrar ao lado do polígono/campo)
  const errosDe = (erros, tipo, i) => erros.filter(e => e.onde.tipo === tipo && (i === undefined || e.onde.i === i)).map(e => e.texto);

  // ----- prévia 3D -----
  // Geometria de uma moldura pequena (quatro peças de ~150 mm, com cantos e vidro de 4 mm) para o Desenho3D.montarCaixas/criar.
  function geometriaPrevia(secao, opcoes) {
    const o = opcoes || {};
    const lado = Math.max(PREVIA_MIN_MM, 2 * secao.altura + 60);
    return {
      perfil: secao.modelo, secao, acabamento: String(o.acabamento || ''),
      correr: false, altura: lado, largura: lado, folhas: [{ largura: lado, posicoes: [], puxadorTotal: false, ladoFuro: '' }],
      gap: 0, sobraVao: 0, divH: 0, divV: 0, puxador: { tem: false, tipo: 'outro', tamanho: 0 }, furos: { lista: [], referenciaInvertida: false },
      trilhoSup: null, trilhoInf: null
    };
  }

  return {
    PASSO_MM, TOL_ALINHAR_PX, PREVIA_MIN_MM, COR_PADRAO_INICIAL, PAREDE_INICIAL,
    lerMm, formatarMm, arred,
    calibrar, calibracaoPadrao, calibracaoCompleta, pxParaMm, mmParaPx,
    encaixar, pertoDoPrimeiro, aplicarClique, pontoMaisProximo,
    novoEstado, fecharPoligono, limparPoligono, novoVazado, moverPonto, editarCoordenada, apagarPonto, inserirDepois, editarCanal, limparCanal, encostarNaOrigem,
    criarHistorico, estadoDaSecao, configPadrao, configDaSecao, caixaDoContorno, secaoDoEditor, validarEditor, errosDe, geometriaPrevia
  };
});
