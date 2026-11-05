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
  perto(esq.comprimento, 2100); perto(topo.comprimento, 800 - 90);
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
  assert.deepEqual(topo.origem.slice(0, 2), [-355, 2100]);
  assert.deepEqual(base.origem.slice(0, 2), [355, 0]);
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
