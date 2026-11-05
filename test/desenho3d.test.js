// Visualizador 3D da porta: parte pura de desenho3d.js (caixas em mm, câmera) e ligações no HTML.
// O render WebGL em si não é testável no Node.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const D3 = require('../desenho3d.js');

const por = (r, tipo) => r.caixas.filter(c => c.tipo === tipo);
const perto = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`);

const giro1 = (extra = {}) => ({
  correr: false, altura: 2100, largura: 800,
  folhas: [{ largura: 800, posicoes: [], puxadorTotal: false, ladoFuro: '' }],
  gap: 0, sobraVao: 0, divH: 0, divV: 0,
  puxador: { tem: false, tipo: 'sobreposto', tamanho: 0 },
  furos: { lista: [], referenciaInvertida: false },
  trilhoSup: null, trilhoInf: null, ...extra
});

test('porta de giro 1 folha: 4 perfis de 45 mm, vidro translúcido e limites = tamanho da porta', () => {
  const r = D3.montarCaixas(giro1());
  assert.equal(r.ok, true);
  assert.equal(por(r, 'perfil').length, 4);
  assert.equal(por(r, 'vidro').length, 1);
  assert.equal(por(r, 'puxador').length, 0);
  const [esq] = por(r, 'perfil');
  assert.equal(esq.w, 45); assert.equal(esq.h, 2100); assert.equal(esq.cor, '#c3c8cd');
  const v = por(r, 'vidro')[0];
  assert.equal(v.cor, '#5fc9e8'); assert.ok(v.opacidade < 1);
  perto(v.w, 800 - 90); perto(v.h, 2100 - 90);
  perto(r.limites.tamanho.x, 800); perto(r.limites.tamanho.y, 2100);
  perto(r.limites.centro.x, 0); // centralizada
  assert.equal(r.limites.min.y, 0);
});

test('sem altura/largura não monta nada', () => {
  assert.equal(D3.montarCaixas(giro1({ altura: 0 })).ok, false);
  assert.equal(D3.montarCaixas(null).ok, false);
});

test('divisores: 15 mm, igualmente espaçados na área do vidro', () => {
  const r = D3.montarCaixas(giro1({ divH: 2, divV: 1 }));
  const dh = por(r, 'divisor').filter(c => c.id.includes('divh'));
  const dv = por(r, 'divisor').filter(c => c.id.includes('divv'));
  assert.equal(dh.length, 2); assert.equal(dv.length, 1);
  dh.forEach(c => { assert.equal(c.h, 15); perto(c.w, 710); });
  // vidro de 45 a 2055 (de cima): terços; em y de baixo para cima
  const gh = 2100 - 90;
  perto(dh[0].y, 2100 - (45 + gh / 3)); perto(dh[1].y, 2100 - (45 + 2 * gh / 3));
  assert.equal(dv[0].w, 15); perto(dv[0].h, gh); perto(dv[0].x, 0);
});

test('puxador sobreposto lateral esquerda centro: tamanho informado, recuado para fora, sai das faces', () => {
  const r = D3.montarCaixas(giro1({
    folhas: [{ largura: 800, posicoes: ['LATERAL ESQUERDA CENTRO'], puxadorTotal: false, ladoFuro: '' }],
    puxador: { tem: true, tipo: 'sobreposto', tamanho: 300 }
  }));
  const p = por(r, 'puxador');
  assert.equal(p.length, 1);
  const esp = D3.espessuraPuxador('sobreposto');
  perto(p[0].w, esp); perto(p[0].h, 300); perto(p[0].y, 1050);
  perto(p[0].x, -400 + (-esp / 2) + esp / 2); // x0 - recuo (esp/2) + esp/2 = x0
  assert.equal(p[0].cor, '#2b2f33');
  assert.ok(p[0].d > D3.ESP_PORTA_MM, 'sobreposto sai das faces');
});

test('puxador embutido não tem recuo e não sai das faces; total ocupa o lado inteiro', () => {
  const emb = D3.montarCaixas(giro1({
    folhas: [{ largura: 800, posicoes: ['TOPO CENTRO'], puxadorTotal: false, ladoFuro: '' }],
    puxador: { tem: true, tipo: 'embutido', tamanho: 200 }
  }));
  const pe = por(emb, 'puxador')[0];
  perto(pe.w, 200); perto(pe.x, 0);
  perto(pe.y, 2100 - D3.espessuraPuxador('embutido') / 2);
  assert.ok(pe.d <= D3.ESP_PORTA_MM + 2.0001);
  const tot = D3.montarCaixas(giro1({
    folhas: [{ largura: 800, posicoes: ['LATERAL DIREITA TOTAL'], puxadorTotal: true, ladoFuro: '' }],
    puxador: { tem: true, tipo: 'outro', tamanho: 120 }
  }));
  const pt = por(tot, 'puxador')[0];
  perto(pt.h, 2100); perto(pt.y, 1050);
});

test('puxador por folha: cada folha tem o seu (esquerda na 1, direita na 2, espelhadas)', () => {
  const r = D3.montarCaixas(giro1({
    folhas: [
      { largura: 700, posicoes: ['LATERAL DIREITA CENTRO'], puxadorTotal: false, ladoFuro: '' },
      { largura: 700, posicoes: ['LATERAL ESQUERDA CENTRO'], puxadorTotal: false, ladoFuro: '' }
    ],
    gap: 150, puxador: { tem: true, tipo: 'sobreposto', tamanho: 150 }
  }));
  const p = por(r, 'puxador');
  assert.equal(p.length, 2);
  assert.equal(p[0].folha, 0); assert.equal(p[1].folha, 1);
  assert.ok(p[0].x < p[1].x);
  // largura total = 700 + 150 + 700, centrada
  perto(r.limites.centro.x, 0, 30);
  const f1 = por(r, 'perfil').filter(c => c.folha === 0), f2 = por(r, 'perfil').filter(c => c.folha === 1);
  perto(Math.min(...f2.map(c => c.x - c.w / 2)) - Math.max(...f1.map(c => c.x + c.w / 2)), 150);
});

test('porta de correr 2 folhas com trilhos: trilhos cobrem o conjunto, folhas em planos diferentes', () => {
  const r = D3.montarCaixas({
    correr: true, altura: 2000, largura: 900,
    folhas: [{ largura: 900, posicoes: [], puxadorTotal: false, ladoFuro: '' }, { largura: 900, posicoes: [], puxadorTotal: false, ladoFuro: '' }],
    gap: 150, sobraVao: 0, divH: 0, divV: 0,
    puxador: { tem: false, tipo: 'sobreposto', tamanho: 0 }, furos: { lista: [], referenciaInvertida: false },
    trilhoSup: { nome: '1 Trilho superior' }, trilhoInf: { nome: '1 Trilho inferior' }
  });
  const tr = por(r, 'trilho');
  assert.equal(tr.length, 2);
  const sup = tr.find(t => t.id === 'trilho-sup'), inf = tr.find(t => t.id === 'trilho-inf');
  perto(sup.w, 900 * 2 + 150); perto(sup.h, 60);
  perto(sup.y, 2000 + 45 + 30); perto(inf.y, -(45 + 30));
  const z = new Set(por(r, 'perfil').map(c => c.z));
  assert.equal(z.size, 2, 'folhas em trilhos diferentes');
  assert.equal(sup.nome, '1 Trilho superior');
  assert.ok(r.limites.min.y < 0 && r.limites.max.y > 2000);
});

test('correr com 1 folha menor que o vão: o trilho cobre o vão inteiro', () => {
  const r = D3.montarCaixas({
    correr: true, altura: 2000, largura: 900,
    folhas: [{ largura: 900, posicoes: [], puxadorTotal: false, ladoFuro: '' }],
    gap: 0, sobraVao: 300, divH: 0, divV: 0,
    puxador: { tem: false, tipo: 'sobreposto', tamanho: 0 }, furos: { lista: [], referenciaInvertida: false },
    trilhoSup: { nome: 'x' }, trilhoInf: null
  });
  perto(por(r, 'trilho')[0].w, 1200);
  assert.equal(por(r, 'trilho').length, 1);
});

test('furos: lado Esquerda a partir do topo, referência invertida a partir da base, e fora da porta é ignorado', () => {
  const g = (inv) => D3.montarCaixas(giro1({
    folhas: [{ largura: 800, posicoes: [], puxadorTotal: false, ladoFuro: 'Esquerda' }],
    furos: { lista: [100, 5000], referenciaInvertida: inv }
  }));
  const a = por(g(false), 'furo'), b = por(g(true), 'furo');
  assert.equal(a.length, 1); // 5000 > altura
  perto(a[0].y, 2100 - 100); perto(a[0].x, -400 + 22.5); perto(a[0].raio, 17.5);
  perto(b[0].y, 100);
  const base = D3.montarCaixas(giro1({
    folhas: [{ largura: 800, posicoes: [], puxadorTotal: false, ladoFuro: 'Base' }],
    furos: { lista: [200], referenciaInvertida: false }
  }));
  const f = por(base, 'furo')[0];
  perto(f.x, -400 + 200); perto(f.y, 22.5);
});

test('retanguloPuxador / comprimentoPuxador seguem o 2D', () => {
  assert.equal(D3.comprimentoPuxador(300, 2100, false), 300);
  assert.equal(D3.comprimentoPuxador(10, 2100, false), 210); // piso de 10% do lado
  assert.equal(D3.comprimentoPuxador(5000, 2100, false), 2100);
  assert.equal(D3.comprimentoPuxador(150, 2100, true), 2100);
  assert.equal(D3.retanguloPuxador('FOO', 800, 2100, 16, 8, 150), null);
  const r = D3.retanguloPuxador('LATERAL ESQUERDA INFERIOR', 800, 2100, 16, 8, 300);
  assert.deepEqual(r, [-8, 1800, 16, 300]);
});

test('câmera: frontal olha de +z; enquadramento cresce com a cena e diminui com a tela larga', () => {
  const c0 = D3.posicaoCamera({ x: 0, y: 1000, z: 0 }, 0, 0, 3000);
  perto(c0.x, 0); perto(c0.y, 1000); perto(c0.z, 3000);
  const c90 = D3.posicaoCamera({ x: 0, y: 0, z: 0 }, 90, 0, 1000);
  perto(c90.x, 1000); perto(c90.z, 0, 1e-9);
  const lim = D3.montarCaixas(giro1()).limites;
  const d1 = D3.distanciaEnquadrar(lim, 35, 1), d2 = D3.distanciaEnquadrar(lim, 35, 2);
  assert.ok(d1 > 2100 && d2 < d1 + 1e-9);
  assert.ok(D3.distanciaEnquadrar(null, 35, 1) > 0);
});

test('orcamentos.html: 3D só leitura, carregado sob demanda com versão fixa e SRI; 2D e captura intactos', () => {
  const h = fs.readFileSync(path.join(__dirname, '..', 'orcamentos.html'), 'utf8');
  assert.ok(h.includes('<script src="desenho3d.js'));
  assert.ok(h.includes('id="cv-visualizacao"') && h.includes('id="aba-3d"') && h.includes('id="btn-3d-reset"'));
  assert.match(h, /desenharVisualizacao\(opcoes = \{\}\)/);
  assert.ok(h.includes("agendar3D()"));
  // o hook do 3D não roda na captura limpa do PDF
  assert.match(h, /if \(!limpo\) \{ atualizarResumoPuxador\(\); agendar3D\(\); \}/);
  const js = fs.readFileSync(path.join(__dirname, '..', 'desenho3d.js'), 'utf8');
  assert.match(D3.BIBLIOTECAS.three.url, /^https:\/\/cdn\.jsdelivr\.net\/npm\/three@\d+\.\d+\.\d+\/build\/three\.min\.js$/);
  assert.match(D3.BIBLIOTECAS.three.integrity, /^sha384-[A-Za-z0-9+/]{64}$/);
  assert.ok(js.includes('sc.integrity') && js.includes("crossOrigin = 'anonymous'"));
  assert.ok(!/fetch\(|XMLHttpRequest|localStorage/.test(js), 'o 3D não envia nem guarda nada');
});
