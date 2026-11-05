// Seções transversais dos perfis (calculo/perfil_secoes.js) e seu uso no 3D (desenho3d.js).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const PS = require('../calculo/perfil_secoes.js');
const D3 = require('../desenho3d.js');

const perto = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`);
const por = (r, tipo) => r.caixas.filter(c => c.tipo === tipo);
const giro1 = (extra = {}) => ({
  correr: false, altura: 2100, largura: 800,
  folhas: [{ largura: 800, posicoes: [], puxadorTotal: false, ladoFuro: '' }],
  gap: 0, sobraVao: 0, divH: 0, divV: 0,
  puxador: { tem: false, tipo: 'sobreposto', tamanho: 0 },
  furos: { lista: [], referenciaInvertida: false },
  trilhoSup: null, trilhoInf: null, ...extra
});

test('seção do 1036: 45 x 18,9, contorno e vazado coerentes com as cotas', () => {
  const s = PS.porModelo('1036');
  assert.ok(s); assert.equal(s.codigo, 13); assert.equal(PS.porCodigo(13), s); assert.equal(PS.porModelo(' 1036 '), s);
  assert.equal(s.largura, 18.9); assert.equal(s.altura, 45); assert.equal(s.parede, 1.5);
  const xs = s.contorno.map(p => p[0]), ys = s.contorno.map(p => p[1]);
  perto(Math.max(...xs) - Math.min(...xs), 18.9); perto(Math.max(...ys) - Math.min(...ys), 45);
  // caixa 12,9 x 45 + base 6 x 1,5 + aba 1,5 x 6,3
  perto(PS.areaPoligono(s.contorno), 12.9 * 45 + 6 * 1.5 + 1.5 * 6.3);
  // oco = caixa recuada 1,5 de cada lado
  perto(PS.areaPoligono(s.vazados[0]), (12.9 - 3) * (45 - 3));
  perto(PS.areaSolida(s), 598.95 - 415.8);
  assert.deepEqual(PS.validar(s), []);
  // vazado dentro do contorno; pé de 7,8 mm
  assert.ok(s.vazados[0].every(([x, y]) => x > 6 && x < 18.9 && y > 0 && y < 45));
  assert.equal(Math.max(...s.contorno.filter(p => p[0] < 2).map(p => p[1])), 7.8);
  // canal do vidro 4,5 mm, a partir de y = 1,5, entre a aba e a caixa
  perto(s.canalVidro.x1 - s.canalVidro.x0, 4.5); assert.equal(s.canalVidro.y0, 1.5);
  assert.equal(s.canalVidro.x0, 1.5); assert.equal(s.canalVidro.x1, 6);
  assert.equal(PS.porModelo('9999'), null);
});

test('validar recusa seção que não fecha', () => {
  const s = JSON.parse(JSON.stringify(PS.porModelo('1036')));
  s.vazados[0][0] = [-5, 0];
  assert.ok(PS.validar(s).length > 0);
  assert.throws(() => PS.registrar({ ...s, modelo: 'X' }));
});

test('porta de giro com 1036: espessura 18,9, perfis em seção, vidro no canal', () => {
  const r = D3.montarCaixas(giro1({ perfil: '1036' }));
  assert.equal(r.ok, true); assert.equal(r.secao, '1036'); perto(r.espessuraPorta, 18.9);
  const perfis = por(r, 'perfil');
  assert.equal(perfis.length, 4);
  perfis.forEach(p => { assert.ok(p.secao); perto(p.d, 18.9); });
  const [esq, dir, topo, base] = perfis;
  perto(esq.comprimento, 2100); perto(topo.comprimento, 800); // 1036 = meia-esquadria: comprimento externo
  // limites: porta 800 x 2100 x 18,9, centrada em z
  perto(r.limites.tamanho.x, 800); perto(r.limites.tamanho.y, 2100); perto(r.limites.tamanho.z, 18.9);
  perto(r.limites.min.z, -9.45); assert.equal(r.limites.min.y, 0);
  // vidro: 4,5 mm no canal (x 1,5..6 -> z centro = -9,45 + 3,75), y a partir de 1,5 mm da borda
  const v = por(r, 'vidro')[0];
  perto(v.d, 4); perto(v.z, -9.45 + 3.75); perto(v.w, 800 - 3); perto(v.h, 2100 - 3);
  // eixos formam rotação própria (determinante +1) e o pé (x=0) fica no lado -z nos quatro lados
  perfis.forEach(p => {
    const { sx, sy, sz } = p.eixos;
    const cr = [sy[1] * sz[2] - sy[2] * sz[1], sy[2] * sz[0] - sy[0] * sz[2], sy[0] * sz[1] - sy[1] * sz[0]];
    perto(sx[0] * cr[0] + sx[1] * cr[1] + sx[2] * cr[2], 1);
    assert.deepEqual(sx, [0, 0, 1]);
  });
  // y=0 na borda externa: início de cada peça fica na borda da folha
  assert.deepEqual(esq.origem.slice(0, 2), [-400, 0]);
  assert.deepEqual(dir.origem.slice(0, 2), [400, 2100]);
  assert.deepEqual(topo.origem.slice(0, 2), [-400, 2100]);
  assert.deepEqual(base.origem.slice(0, 2), [400, 0]);
});

test('perfil sem seção cadastrada: comportamento antigo (blocos de 45 x 40, vidro de 8)', () => {
  const sem = D3.montarCaixas(giro1());
  const outro = D3.montarCaixas(giro1({ perfil: '1099' }));
  assert.deepEqual(outro.caixas, sem.caixas);
  assert.equal(sem.secao, null);
  por(sem, 'perfil').forEach(p => { assert.equal(p.d, 40); assert.ok(!p.secao); });
  assert.equal(por(sem, 'vidro')[0].d, 4);
});

test('orcamentos.html liga o perfil à seção e carrega o módulo antes do 3D', () => {
  const h = fs.readFileSync(path.join(__dirname, '..', 'orcamentos.html'), 'utf8');
  assert.ok(h.indexOf('calculo/perfil_secoes.js') > 0 && h.indexOf('calculo/perfil_secoes.js') < h.indexOf('<script src="desenho3d.js'));
  assert.ok(h.includes("perfil: val('f-perfil')"));
});

// ----- junta: meia-esquadria (45°) x reta -----
const pontosDaSecao = s => s.contorno.concat(...s.vazados);

test('junta: 1036 = meia_esquadria; padrão = reta; valor inválido é recusado', () => {
  assert.equal(PS.porModelo('1036').junta, 'meia_esquadria');
  const base = { codigo: 99, modelo: 'TESTE-JUNTA', largura: 10, altura: 20, parede: 1, contorno: [[0, 0], [10, 0], [10, 20], [0, 20]], vazados: [], canalVidro: { x0: 1, x1: 5, y0: 1 } };
  assert.deepEqual(PS.validar(base), []);
  assert.equal(PS.registrar(base).junta, 'reta');
  assert.deepEqual(PS.validar({ ...base, junta: 'reta' }), []);
  assert.deepEqual(PS.validar({ ...base, junta: 'meia_esquadria' }), []);
  assert.ok(PS.validar({ ...base, junta: 'curva' }).some(e => e.includes('junta')));
  assert.ok(PS.validar({ ...base, junta: null }).some(e => e.includes('junta')));
});

test('pontasPeca: 45° desloca cada ponto pelo próprio y; reta não desloca', () => {
  const s = PS.porModelo('1036');
  const [a0, a1] = PS.pontasPeca(s, 0, 800), [b0, b1] = PS.pontasPeca(s, 45, 800);
  perto(a0, 0); perto(a1, 800);               // y = 0: comprimento externo inteiro
  perto(b0, 45); perto(b1, 755);              // y = 45: recua 45 mm em cada ponta
  perto(b0 - a0, 45); perto(a1 - b1, 45);     // 45 mm entre os dois pontos ao longo do eixo
  assert.deepEqual(PS.pontasPeca({ junta: 'reta' }, 30, 800), [0, 800]);
  assert.deepEqual(PS.pontasPeca({}, 30, 800), [0, 800]);
  // nenhum ponto da seção passa do comprimento externo nem inverte a peça
  pontosDaSecao(s).forEach(([, y]) => { const [i, f] = PS.pontasPeca(s, y, 800); assert.ok(i >= 0 && f <= 800 && f > i); });
});

test('1036 em 3D: 4 peças com comprimento externo e pontas vizinhas coincidindo nos 4 cantos', () => {
  const r = D3.montarCaixas(giro1({ perfil: '1036' }));
  const s = r.caixas.find(c => c.secao).secao;
  const [esq, dir, topo, base] = por(r, 'perfil');
  [esq, dir].forEach(p => { perto(p.comprimento, 2100); assert.equal(p.junta, 'meia_esquadria'); });
  [topo, base].forEach(p => { perto(p.comprimento, 800); assert.equal(p.junta, 'meia_esquadria'); });
  // posição no mundo de um ponto (y da seção; sx=0 basta) numa das pontas: 0 = início, 1 = fim
  const mundo = (p, y, ponta) => {
    const s2 = PS.pontasPeca(p.secao, y, p.comprimento)[ponta], e = p.eixos;
    return [0, 1].map(k => p.origem[k] + e.sy[k] * y + e.sz[k] * s2);
  };
  const igual = (a, b) => { perto(a[0], b[0]); perto(a[1], b[1]); };
  for (const [, y] of pontosDaSecao(s)) {
    igual(mundo(esq, y, 0), mundo(base, y, 1));   // canto inferior esquerdo
    igual(mundo(esq, y, 1), mundo(topo, y, 0));   // canto superior esquerdo
    igual(mundo(dir, y, 0), mundo(topo, y, 1));   // canto superior direito
    igual(mundo(dir, y, 1), mundo(base, y, 0));   // canto inferior direito
  }
  // contorno externo (y = 0) fecha exatamente nos cantos da folha
  igual(mundo(esq, 0, 0), [-400, 0]); igual(mundo(topo, 0, 0), [-400, 2100]);
  igual(mundo(dir, 0, 0), [400, 2100]); igual(mundo(base, 0, 0), [400, 0]);
  // limites externos = tamanho da porta; área livre do vidro e divisores não mudam
  perto(r.limites.tamanho.x, 800); perto(r.limites.tamanho.y, 2100);
  const v = por(r, 'vidro')[0]; perto(v.w, 797); perto(v.h, 2097);
  const rd = D3.montarCaixas(giro1({ perfil: '1036', divH: 1, divV: 1 }));
  perto(por(rd, 'divisor').find(d => d.id.includes('divh')).w, 710);
  perto(por(rd, 'divisor').find(d => d.id.includes('divv')).h, 2010);
});

test('junta reta (seção injetada): idêntico ao esquadro simples de antes', () => {
  const s = { ...PS.porModelo('1036'), junta: 'reta' };
  const r = D3.montarCaixas(giro1({ secao: s }));
  const [, , topo, base] = por(r, 'perfil');
  perto(topo.comprimento, 710); perto(base.comprimento, 710);
  assert.deepEqual(topo.origem.slice(0, 2), [-355, 2100]);
  assert.deepEqual(base.origem.slice(0, 2), [355, 0]);
  const semJunta = { ...s }; delete semJunta.junta;
  assert.deepEqual(D3.montarCaixas(giro1({ secao: semJunta })).caixas.map(c => ({ ...c, junta: undefined, secao: undefined })), r.caixas.map(c => ({ ...c, junta: undefined, secao: undefined })));
});

test('montarMalhaPeca: malha fechada (volume bate com a área x comprimento médio) em reta e em 45°', () => {
  // seção retangular 10 x 20 (y = 0 externo), triangulação em leque (convexa)
  const sec = j => ({ junta: j, contorno: [[0, 0], [10, 0], [10, 20], [0, 20]], vazados: [] });
  const leque = c => c.slice(2).map((_, i) => [0, i + 1, i + 2]);
  const volume = pos => { let v = 0; for (let i = 0; i < pos.length; i += 9) { const a = pos.slice(i, i + 3), b = pos.slice(i + 3, i + 6), c = pos.slice(i + 6, i + 9);
    v += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6; } return v; };
  perto(volume(D3.montarMalhaPeca(sec('reta'), 100, leque).posicoes), 10 * 20 * 100, 1e-6);
  // 45°: comprimento médio = 100 - 2 * (y médio = 10) = 80
  perto(volume(D3.montarMalhaPeca(sec('meia_esquadria'), 100, leque).posicoes), 10 * 20 * 80, 1e-6);
});


// ----- esquema versão 2: validação, cores, nervuras, biblioteca -----
const base2 = (extra = {}) => ({
  versao: 2, codigo: 501, modelo: 'V2-TESTE', largura: 20, altura: 40, parede: 1.5,
  contorno: [[0, 0], [20, 0], [20, 40], [0, 40]],
  vazados: [[[2, 2], [18, 2], [18, 38], [2, 38]]],
  canalVidro: { x0: 1, x1: 5, y0: 1 }, junta: 'reta',
  cores: { padrao: '#aabbcc', porAcabamento: { 'Anodizado Fosco': '#112233' } }, estimada: [], ...extra
});
const clone = o => JSON.parse(JSON.stringify(o));

test('esquema 2: seção boa passa; o 1036 ganhou versao 2 e cores.padrao #c3c8cd', () => {
  assert.deepEqual(PS.validar(base2()), []);
  const s = PS.porModelo('1036');
  assert.equal(s.versao, 2); assert.equal(s.cores.padrao, '#c3c8cd'); assert.deepEqual(s.cores.porAcabamento, {});
  assert.deepEqual(PS.validar(PS.semente1036()), []);
  // seção sem versao/cores (esquema 1) segue valendo e vira versão 2
  const v1 = clone(base2()); delete v1.versao; delete v1.cores;
  assert.deepEqual(PS.validar(v1), []);
  const n = PS.normalizar(v1); assert.equal(n.versao, 2); assert.equal(n.junta, 'reta');
});

test('esquema 2: validar recusa seção quebrada (cada defeito com mensagem própria)', () => {
  const erra = (mut, trecho) => {
    const s = clone(base2()); mut(s);
    const e = PS.validar(s);
    assert.ok(e.some(m => m.includes(trecho)), `${trecho} em ${JSON.stringify(e)}`);
  };
  erra(s => { s.contorno = [[0, 0], [20, 10], [20, 0], [0, 40]]; }, 'contorno cruza');
  erra(s => { s.contorno = [[0, 0], [20, 0], [20, 0], [20, 40], [0, 40]]; }, 'repetidos');
  erra(s => { s.vazados = [[[2, 2], [30, 2], [30, 38], [2, 38]]]; }, 'vazado 0 fora do contorno');
  erra(s => { s.vazados = [[[-1, 2], [10, 2], [10, 38]]]; }, 'vazado 0 fora do contorno');
  erra(s => { s.vazados = [[[2, 2], [12, 10], [12, 2], [2, 30]]]; }, 'vazado 0 cruza');
  erra(s => { s.vazados.push([[10, 10], [14, 10], [14, 14], [10, 14]]); }, 'se cruzam ou se sobrepõem');
  erra(s => { s.vazados = [[[2, 2], [12, 2], [12, 20], [2, 20]], [[8, 10], [18, 10], [18, 30], [8, 30]]]; }, 'se cruzam');
  erra(s => { s.canalVidro = { x0: 5, x1: 25, y0: 1 }; }, 'canal do vidro');
  erra(s => { s.canalVidro = { x0: 5, x1: 3, y0: 1 }; }, 'canal do vidro');
  erra(s => { s.junta = 'curva'; }, 'junta');
  erra(s => { s.cores.padrao = 'azul'; }, 'cor padrão');
  erra(s => { s.cores.padrao = '#abc'; }, 'cor padrão');
  erra(s => { s.cores.porAcabamento.Preto = 'preto'; }, 'cor inválida');
  erra(s => { s.cores.porAcabamento.PRETO = '#000000'; s.cores.porAcabamento.preto = '#111111'; }, 'repetido');
  erra(s => { s.largura = 0; }, 'largura');
  erra(s => { s.largura = 301; }, 'largura');
  erra(s => { s.altura = 0.5; }, 'altura');
  erra(s => { s.parede = 0; }, 'parede');
  erra(s => { s.codigo = -3; }, 'código');
  erra(s => { s.versao = 3; }, 'versão');
  erra(s => { s.contorno = Array.from({ length: 201 }, (_, i) => [i % 2 ? 20 : 0, i * 0.19]); }, 'pontos demais');
  assert.ok(PS.validar(null).length && PS.validar([]).length);
});

test('esquema 2: nervuras (vários vazados disjuntos) são aceitas, inclusive encostadas no contorno', () => {
  const s = base2({ vazados: [[[2, 2], [9, 2], [9, 38], [2, 38]], [[11, 2], [18, 2], [18, 20], [11, 20]]] });
  assert.deepEqual(PS.validar(s), []);
  assert.deepEqual(PS.validar(base2({ vazados: [[[0, 0], [10, 0], [10, 10], [0, 10]]] })), []);
});

test('cor por acabamento: acabamento -> padrão da seção -> cinza de sempre (sem seção)', () => {
  PS.registrar(base2());
  const s = PS.porModelo('V2-TESTE');
  assert.equal(PS.corDoPerfil(s, 'Anodizado Fosco'), '#112233');
  assert.equal(PS.corDoPerfil(s, 'ANODIZADO  fosco'), '#112233');
  assert.equal(PS.corDoPerfil(s, 'Pintura'), '#aabbcc');
  assert.equal(PS.corDoPerfil(s, ''), '#aabbcc');
  assert.equal(PS.corDoPerfil({ largura: 1 }, 'x'), null);
  const com = D3.montarCaixas(giro1({ perfil: 'V2-TESTE', acabamento: 'anodizado fosco' }));
  assert.ok(por(com, 'perfil').length === 4 && por(com, 'perfil').every(p => p.cor === '#112233'));
  assert.ok(por(D3.montarCaixas(giro1({ perfil: 'V2-TESTE', acabamento: 'Outro' })), 'perfil').every(p => p.cor === '#aabbcc'));
  assert.ok(por(D3.montarCaixas(giro1({ perfil: 'V2-TESTE' })), 'perfil').every(p => p.cor === '#aabbcc'));
  PS.registrar(base2({ modelo: 'V2-SEM-COR', codigo: 502, cores: undefined }));
  assert.ok(por(D3.montarCaixas(giro1({ perfil: 'V2-SEM-COR', acabamento: 'x' })), 'perfil').every(p => p.cor === D3.CORES.perfil));
  assert.ok(por(D3.montarCaixas(giro1({ perfil: '1099', acabamento: 'x' })), 'perfil').every(p => p.cor === D3.CORES.perfil));
  // o vidro continua com 4 mm e a própria cor
  assert.equal(por(com, 'vidro')[0].d, 4); assert.equal(por(com, 'vidro')[0].cor, D3.CORES.vidro);
});

test('substituirTodas: a biblioteca do servidor vira a verdade; inválidas são ignoradas', () => {
  const guardadas = PS.lista().map(clone);
  try {
    const r = PS.substituirTodas([base2({ modelo: 'LIB-A', codigo: 601 }), { modelo: 'RUIM', contorno: [] }, base2({ modelo: 'LIB-B', codigo: 602 })]);
    assert.equal(r.registradas, 2); assert.equal(r.ignoradas.length, 1); assert.equal(r.ignoradas[0].modelo, 'RUIM');
    assert.ok(PS.porModelo('LIB-A') && PS.porModelo('lib-b') && PS.porCodigo(602));
    assert.equal(PS.porModelo('1036'), null);
    assert.equal(PS.substituirTodas([]).registradas, 0);
    assert.equal(PS.lista().length, 0);
  } finally { PS.substituirTodas(guardadas); }
  assert.ok(PS.porModelo('1036'));
});

test('nervuras entram na extrusão e na meia-esquadria (malha da peça)', () => {
  const sem = { junta: 'meia_esquadria', contorno: [[0, 0], [20, 0], [20, 40], [0, 40]], vazados: [[[2, 2], [18, 2], [18, 38], [2, 38]]] };
  const nerv = { ...sem, vazados: [[[2, 2], [9, 2], [9, 38], [2, 38]], [[11, 2], [18, 2], [18, 20], [11, 20]]] };
  const nada = () => [];   // só as laterais (2 triângulos por aresta de cada anel)
  const A = D3.montarMalhaPeca(sem, 500, nada).posicoes, B = D3.montarMalhaPeca(nerv, 500, nada).posicoes;
  assert.equal(A.length, 2 * (4 + 4) * 9);
  assert.equal(B.length, 2 * (4 + 4 + 4) * 9);
  // vértice (11, 20) da nervura: recua 20 mm em cada ponta (corte de 45°) -> z em 20 e 480
  const zs = []; for (let i = 0; i < B.length; i += 3) if (B[i + 1] === 20 && B[i] === 11) zs.push(B[i + 2]);
  assert.ok(zs.includes(20) && zs.includes(480), JSON.stringify(zs));
  // junta reta: pontas só em 0 e no comprimento
  const C = D3.montarMalhaPeca({ ...nerv, junta: 'reta' }, 500, nada).posicoes;
  const zr = new Set(); for (let i = 2; i < C.length; i += 3) zr.add(C[i]);
  assert.deepEqual([...zr].sort((a, b) => a - b), [0, 500]);
});

test('orcamentos.html: carrega GET /perfil_secoes uma vez, antes do 3D, com reserva embutida e acabamento no 3D', () => {
  const h = fs.readFileSync(path.join(__dirname, '..', 'orcamentos.html'), 'utf8');
  assert.ok(h.includes('/perfil_secoes'));
  assert.ok(h.includes('function carregarSecoesPerfis'));
  assert.ok(h.indexOf('await carregarSecoesPerfis()') > 0 && h.indexOf('await carregarSecoesPerfis()') < h.indexOf('await viz3d.ctl.mostrar()'));
  assert.ok(h.includes('PerfilSecoes.substituirTodas'));
  assert.ok(h.includes("acabamento: val('f-acab')"));
  assert.ok(/function aoMudarAcabPerfil\(\) \{[^}]*agendar3D\(\)/.test(h));
});
