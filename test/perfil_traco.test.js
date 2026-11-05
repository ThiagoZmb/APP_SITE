// Traçador de seções de perfil (calculo/perfil_traco.js): parte pura. O mouse em si (canvas) só se confere no navegador.
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../calculo/perfil_traco.js');
const PS = require('../calculo/perfil_secoes.js');
const D3 = require('../desenho3d.js');

const perto = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`);
const COM_IMA = { tolMm: 0.5, ima: true };

test('lerMm / formatarMm: vírgula ou ponto, lixo vira NaN', () => {
  assert.equal(T.lerMm('12,5'), 12.5);
  assert.equal(T.lerMm('12.5 mm'), 12.5);
  assert.equal(T.lerMm(' 7 '), 7);
  assert.equal(T.lerMm('-1,2'), -1.2);
  for (const ruim of ['', 'abc', '1,2,3', '1e3', null, undefined]) assert.ok(Number.isNaN(T.lerMm(ruim)), String(ruim));
  assert.equal(T.formatarMm(18.9), '18,9');
  assert.equal(T.formatarMm(NaN), '');
});

test('calibração: dois pontos + distância real dão mm por pixel; entradas ruins são recusadas', () => {
  // cota de 45 mm que ocupa 90 px na horizontal
  const r = T.calibrar({ px: 100, py: 50 }, { px: 190, py: 50 }, '45');
  assert.equal(r.ok, true);
  perto(r.mmPorPx, 0.5);
  // em diagonal também vale (distância euclidiana): 3-4-5 => 50 px
  perto(T.calibrar({ px: 0, py: 0 }, { px: 30, py: 40 }, '25').mmPorPx, 0.5);
  assert.match(T.calibrar({ px: 1, py: 1 }, { px: 2, py: 1 }, '45').erro, /muito próximos/);
  assert.match(T.calibrar({ px: 0, py: 0 }, { px: 100, py: 0 }, '0').erro, /distância real/);
  assert.match(T.calibrar({ px: 0, py: 0 }, { px: 100, py: 0 }, 'abc').erro, /distância real/);
  assert.match(T.calibrar(null, { px: 1, py: 1 }, '5').erro, /dois pontos/);
});

test('origem no canto inferior esquerdo e y PARA CIMA: pxParaMm / mmParaPx são inversas', () => {
  const cal = { mmPorPx: 0.5, origem: { px: 10, py: 300 } };
  assert.equal(T.calibracaoCompleta(cal), true);
  assert.equal(T.calibracaoCompleta({ mmPorPx: 0.5, origem: null }), false);
  assert.deepEqual(T.pxParaMm(cal, 10, 300), [0, 0]);                 // a própria origem
  assert.deepEqual(T.pxParaMm(cal, 10 + 36, 300 - 90), [18, 45]);       // à direita e ACIMA na imagem => x e y positivos
  assert.deepEqual(T.pxParaMm(cal, 10 - 4, 300 + 6), [-2, -3]);         // abaixo/esquerda da origem => negativo
  const p = T.mmParaPx(cal, 18, 45);
  assert.deepEqual([p.px, p.py], [46, 210]);
  const volta = T.pxParaMm(cal, p.px, p.py);
  assert.deepEqual(volta, [18, 45]);
  assert.equal(T.calibracaoCompleta(T.calibracaoPadrao()), true);
});

test('ímã: alinha a pontos de referência (ângulo reto) e arredonda a múltiplos de 0,1 mm', () => {
  // sem referência: 0,1 mm
  assert.deepEqual(T.encaixar([3.14159, 2.71828], [], { tolMm: 0.5, incluirOrigem: false }), [3.1, 2.7]);
  assert.deepEqual(T.encaixar([-0.04, 0.06], [], { tolMm: 0.5, incluirOrigem: false }), [0, 0.1]);
  // alinha x ao ponto anterior (vertical) e y ao outro (horizontal), mantendo o valor exato da referência
  assert.deepEqual(T.encaixar([18.93, 20.31], [[18.9, 0]], { tolMm: 0.5, incluirOrigem: false }), [18.9, 20.3]);
  assert.deepEqual(T.encaixar([5.04, 45.2], [[18.9, 45], [0, 7.8]], { tolMm: 0.5, incluirOrigem: false }), [5, 45]);
  // fora da tolerância não alinha
  assert.deepEqual(T.encaixar([19.9, 20.3], [[18.9, 0]], { tolMm: 0.5, incluirOrigem: false }), [19.9, 20.3]);
  // a origem entra como referência (encosta nos eixos)
  assert.deepEqual(T.encaixar([0.2, 0.3], [], { tolMm: 0.5 }), [0, 0]);
  // sem ímã: só limpa o excesso de casas
  assert.deepEqual(T.encaixar([3.14159, 2.71828], [[3, 2]], { ima: false }), [3.14, 2.72]);
});

test('contorno: cliques viram vértices e o clique perto do 1º ponto fecha o polígono', () => {
  let e = T.novoEstado();
  const clicar = (modo, pt) => { const r = T.aplicarClique(e, modo, pt, COM_IMA); e = r.estado; return r; };
  clicar('contorno', [0, 0]); clicar('contorno', [10, 0.1]); clicar('contorno', [10.05, 20]); clicar('contorno', [0, 20.02]);
  assert.deepEqual(e.contorno.pontos, [[0, 0], [10, 0], [10, 20], [0, 20]]); // ímã deixou tudo em ângulo reto
  assert.equal(e.contorno.fechado, false);
  const fecha = clicar('contorno', [0.2, 0.1]); // perto do 1º ponto
  assert.equal(fecha.fechou, true);
  assert.equal(e.contorno.fechado, true);
  assert.equal(e.contorno.pontos.length, 4, 'fechar não acrescenta ponto');
  const depois = T.aplicarClique(e, 'contorno', [30, 30], COM_IMA);
  assert.match(depois.aviso, /já está fechado/);
  assert.equal(depois.estado.contorno.pontos.length, 4);
  // com menos de 3 pontos, clicar no 1º não fecha: vira outro ponto
  let f = T.novoEstado();
  f = T.aplicarClique(f, 'contorno', [0, 0], COM_IMA).estado;
  f = T.aplicarClique(f, 'contorno', [5, 0], COM_IMA).estado;
  const r3 = T.aplicarClique(f, 'contorno', [0, 0.1], COM_IMA);
  assert.equal(r3.fechou, undefined);
  assert.equal(r3.estado.contorno.pontos.length, 3);
  // ponto repetido é ignorado com aviso
  const rep = T.aplicarClique(f, 'contorno', [5, 0], COM_IMA);
  assert.match(rep.aviso, /repete/);
  // o estado de entrada nunca é alterado
  assert.equal(f.contorno.pontos.length, 2);
});

test('vazados: só depois do contorno fechado; cada polígono fechado é um vazado e o seguinte começa outro', () => {
  const base = T.estadoDaSecao({ contorno: [[0, 0], [20, 0], [20, 40], [0, 40]], vazados: [], canalVidro: null });
  assert.equal(base.contorno.fechado, true);
  let e = T.novoEstado();
  assert.match(T.aplicarClique(e, 'vazado', [1, 1], COM_IMA).aviso, /Feche o contorno/);
  const clicar = pt => { const r = T.aplicarClique(e, 'vazado', pt, COM_IMA); e = r.estado; return r; };
  e = base;
  [[2, 2], [8, 2], [8, 12], [2, 12]].forEach(clicar);
  assert.equal(clicar([2.1, 2.1]).fechou, true);
  assert.equal(e.vazados.length, 1);
  assert.equal(e.vazados[0].fechado, true);
  [[12, 2], [18, 2], [18, 12]].forEach(clicar); // segundo vazado (nervura)
  assert.equal(e.vazados.length, 2);
  assert.equal(e.vazados[1].fechado, false);
  assert.equal(clicar([12, 2]).fechou, true);
  assert.equal(e.vazados[1].fechado, true);
  assert.equal(PS.validar(T.secaoDoEditor(e, { parede: 1, junta: 'reta', corPadrao: '', cores: [], estimada: [] }, { codigo: 1, modelo: 'X' })).some(x => /vazado/.test(x)), false);
});

test('canal do vidro: dois cliques dão x0/x1 (qualquer ordem) e y0 do 1º clique', () => {
  let e = T.novoEstado();
  let r = T.aplicarClique(e, 'canal', [6, 1.5], { ima: false, tolMm: 0.5 });
  assert.ok(r.estado.canalPendente && !r.estado.canal);
  r = T.aplicarClique(r.estado, 'canal', [1.5, 9], { ima: false, tolMm: 0.5 });
  assert.deepEqual(r.estado.canal, { x0: 1.5, x1: 6, y0: 1.5 });
  assert.equal(r.estado.canalPendente, null);
  // mesma lateral: recusa e mantém o pendente
  const a = T.aplicarClique(e, 'canal', [3, 2], { ima: false, tolMm: 0.5 });
  const b = T.aplicarClique(a.estado, 'canal', [3, 8], { ima: false, tolMm: 0.5 });
  assert.match(b.aviso, /mesmo x/);
  assert.ok(b.estado.canalPendente);
  assert.deepEqual(T.editarCanal(r.estado, 'y0', '2,5').canal, { x0: 1.5, x1: 6, y0: 2.5 });
  assert.equal(T.editarCanal(r.estado, 'y0', 'abc'), null);
  assert.equal(T.limparCanal(r.estado).canal, null);
});

test('edição de pontos: mover, editar na tabela, inserir no meio, apagar (reabre abaixo de 3) e encostar na origem', () => {
  let e = T.estadoDaSecao({ contorno: [[1, 2], [11, 2], [11, 12], [1, 12]], vazados: [[[3, 4], [5, 4], [5, 6]]], canalVidro: { x0: 2, x1: 4, y0: 3 } });
  e = T.moverPonto(e, { tipo: 'contorno' }, 2, [12.345, 13]);
  assert.deepEqual(e.contorno.pontos[2], [12.35, 13]);
  assert.equal(T.editarCoordenada(e, { tipo: 'vazado', i: 0 }, 1, 'x', 'xx'), null);
  e = T.editarCoordenada(e, { tipo: 'vazado', i: 0 }, 1, 'x', '5,5');
  assert.deepEqual(e.vazados[0].pontos[1], [5.5, 4]);
  e = T.inserirDepois(e, { tipo: 'contorno' }, 3); // aresta [1,12] -> [1,2] (volta ao 1º)
  assert.deepEqual(e.contorno.pontos[4], [1, 7]);
  assert.equal(e.contorno.pontos.length, 5);
  let v = T.apagarPonto(e, { tipo: 'vazado', i: 0 }, 0);
  assert.equal(v.vazados[0].pontos.length, 2);
  assert.equal(v.vazados[0].fechado, false, 'com menos de 3 pontos deixa de ser polígono fechado');
  const c = T.encostarNaOrigem(e);
  assert.deepEqual(c.contorno.pontos[0], [0, 0]);
  assert.deepEqual(c.canal, { x0: 1, x1: 3, y0: 1 });
  assert.deepEqual(c.vazados[0].pontos[0], [2, 2]);
  assert.equal(T.limparPoligono(e, { tipo: 'vazado', i: 0 }).vazados.length, 0);
  assert.equal(T.limparPoligono(e, { tipo: 'contorno' }).contorno.pontos.length, 0);
  const n = T.novoVazado(T.novoVazado(e));
  assert.equal(n.vazados.length, 2, 'não empilha vazados vazios');
});

test('pontoMaisProximo: acha o vértice dentro do raio e ignora o que está longe', () => {
  const lista = [{ alvo: { tipo: 'contorno' }, idx: 0, px: 100, py: 100 }, { alvo: { tipo: 'contorno' }, idx: 1, px: 104, py: 100 }];
  assert.equal(T.pontoMaisProximo(lista, 103, 101, 9).idx, 1);
  assert.equal(T.pontoMaisProximo(lista, 300, 300, 9), null);
});

test('histórico: desfazer e refazer; registrar descarta o "futuro"; estado igual não registra', () => {
  const h = T.criarHistorico(T.novoEstado());
  assert.equal(h.podeDesfazer(), false);
  let e = T.aplicarClique(T.novoEstado(), 'contorno', [0, 0], COM_IMA).estado;
  assert.equal(h.registrar(e), true);
  assert.equal(h.registrar(e), false);
  e = T.aplicarClique(e, 'contorno', [5, 0], COM_IMA).estado;
  h.registrar(e);
  assert.equal(h.atual().contorno.pontos.length, 2);
  assert.equal(h.desfazer().contorno.pontos.length, 1);
  assert.equal(h.podeRefazer(), true);
  assert.equal(h.refazer().contorno.pontos.length, 2);
  h.desfazer();
  h.registrar(T.aplicarClique(h.atual(), 'contorno', [0, 9], COM_IMA).estado); // novo ramo
  assert.equal(h.podeRefazer(), false);
  assert.equal(h.desfazer().contorno.pontos.length, 1);
  assert.equal(h.desfazer().contorno.pontos.length, 0);
  assert.equal(h.desfazer().contorno.pontos.length, 0, 'não passa do início');
});

// ---- ida e volta com o 1036: traça pelos pixels da "imagem" e confere com a semente cadastrada ----
test('traçar o 1036 por cliques em pixels (0,1 mm por px) reproduz a semente e valida sem erros', () => {
  const sem = PS.semente1036();
  const cal = { mmPorPx: 0.1, origem: { px: 40, py: 600 } };
  const clique = (modo, [x, y]) => { const p = T.mmParaPx(cal, x, y); return T.aplicarClique(est, modo, T.pxParaMm(cal, Math.round(p.px), Math.round(p.py)), { tolMm: 0.8, ima: true }); };
  let est = T.novoEstado();
  const passos = [];
  sem.contorno.forEach(p => passos.push(['contorno', p]));
  passos.push(['contorno', sem.contorno[0]]); // fecha
  sem.vazados[0].forEach(p => passos.push(['vazado', p]));
  passos.push(['vazado', sem.vazados[0][0]]);
  passos.push(['canal', [sem.canalVidro.x0, sem.canalVidro.y0]]);
  passos.push(['canal', [sem.canalVidro.x1, 30]]);
  for (const [modo, pt] of passos) est = clique(modo, pt).estado;
  assert.deepEqual(est.contorno.pontos, sem.contorno);
  assert.deepEqual(est.vazados.map(v => v.pontos), sem.vazados);
  assert.deepEqual(est.canal, sem.canalVidro);
  assert.equal(est.contorno.fechado && est.vazados[0].fechado, true);
  const cfg = T.configDaSecao(sem);
  const v = T.validarEditor(est, cfg, { codigo: 13, modelo: '1036' });
  assert.deepEqual(v.erros, []);
  assert.equal(v.secao.largura, 18.9);
  assert.equal(v.secao.altura, 45);
  assert.equal(v.secao.junta, 'meia_esquadria');
  assert.deepEqual(v.secao.estimada, sem.estimada);
  assert.deepEqual(PS.validar(PS.normalizar(v.secao)), []);
});

test('validarEditor: mensagens em português ligadas ao ponto/campo certo', () => {
  const sem = PS.semente1036();
  const cfg = T.configDaSecao(sem);
  const meta = { codigo: 13, modelo: '1036' };
  const onde = (v, tipo) => v.erros.filter(e => e.onde.tipo === tipo).map(e => e.texto);

  // vazio
  let v = T.validarEditor(T.novoEstado(), T.configPadrao(), meta);
  assert.ok(onde(v, 'contorno')[0].includes('Desenhe o contorno externo'));
  assert.equal(v.erros.length, 1, 'vazio: uma instrução só, sem lista de erros técnicos');
  assert.ok(!v.erros.some(e => /largura|altura/i.test(e.texto)), 'sem ruído de largura/altura antes de ter contorno');

  // contorno aberto
  let est = T.estadoDaSecao(sem); est.contorno.fechado = false;
  assert.match(onde(T.validarEditor(est, cfg, meta), 'contorno')[0], /não está fechado/);

  // vazado fora do contorno => erro no vazado 1 (índice 0)
  est = T.estadoDaSecao(sem);
  est = T.moverPonto(est, { tipo: 'vazado', i: 0 }, 2, [30, 20]);
  v = T.validarEditor(est, cfg, meta);
  assert.ok(v.erros.some(e => e.onde.tipo === 'vazado' && e.onde.i === 0 && /Vazado 1/.test(e.texto)), JSON.stringify(v.erros));
  assert.deepEqual(T.errosDe(v.erros, 'vazado', 0).length > 0, true);
  assert.deepEqual(T.errosDe(v.erros, 'vazado', 1), []);

  // coordenada negativa
  est = T.moverPonto(T.estadoDaSecao(sem), { tipo: 'contorno' }, 0, [-0.5, 0]);
  assert.ok(onde(T.validarEditor(est, cfg, meta), 'contorno').some(t => /x negativo.*Encostar na origem/.test(t)));

  // canal, parede, cores
  est = T.editarCanal(T.estadoDaSecao(sem), 'x1', '99');
  assert.ok(onde(T.validarEditor(est, cfg, meta), 'canal')[0].includes('Canal do vidro inválido'));
  assert.ok(onde(T.validarEditor(T.estadoDaSecao(sem), { ...cfg, parede: 40 }, meta), 'parede')[0].includes('Parede inválida'));
  const cores = { ...cfg, cores: [{ nome: 'Anodizado Fosco', cor: '#aaaaaa' }, { nome: 'ANODIZADO  fosco', cor: '#bbbbbb' }] };
  assert.ok(onde(T.validarEditor(T.estadoDaSecao(sem), cores, meta), 'cores')[0].includes('repetido'));
  const corRuim = { ...cfg, corPadrao: 'vermelho' };
  assert.ok(onde(T.validarEditor(T.estadoDaSecao(sem), corRuim, meta), 'cores').length >= 1);

  // linha de cor sem nome é ignorada; padrão e porAcabamento vão para a seção
  const ok = T.validarEditor(T.estadoDaSecao(sem), { ...cfg, corPadrao: '#112233', cores: [{ nome: '', cor: '#000000' }, { nome: 'Preto', cor: '#101010' }] }, meta);
  assert.deepEqual(ok.erros, []);
  assert.deepEqual(ok.secao.cores, { porAcabamento: { Preto: '#101010' }, padrao: '#112233' });
});

test('config padrão de perfil novo: parede 1,5 estimada e junta reta; editar a seção carrega tudo de volta', () => {
  const c = T.configPadrao();
  assert.deepEqual([c.parede, c.junta, c.estimada], [1.5, 'reta', ['parede']]);
  const sem = PS.semente1036();
  sem.cores = { padrao: '#abcdef', porAcabamento: { Preto: '#111111' } };
  const cfg = T.configDaSecao(sem);
  assert.deepEqual(cfg.cores, [{ nome: 'Preto', cor: '#111111' }]);
  assert.equal(cfg.corPadrao, '#abcdef');
  const volta = T.secaoDoEditor(T.estadoDaSecao(sem), cfg, { codigo: 13, modelo: '1036' });
  assert.deepEqual(PS.normalizar(volta), PS.normalizar({ ...sem, estimada: sem.estimada }));
});

test('prévia 3D: moldura de ~150 mm monta as 4 peças com meia-esquadria e a cor do acabamento escolhido', () => {
  const sem = PS.semente1036();
  sem.cores = { padrao: '#abcdef', porAcabamento: { Preto: '#111111' } };
  const g = T.geometriaPrevia(sem, { acabamento: 'preto' });
  assert.ok(g.altura >= 150 && g.largura === g.altura);
  const r = D3.montarCaixas(g);
  assert.equal(r.ok, true);
  const pecas = r.caixas.filter(c => c.tipo === 'perfil');
  assert.equal(pecas.length, 4);
  assert.ok(pecas.every(p => p.junta === 'meia_esquadria' && p.cor === '#111111'));
  const vidro = r.caixas.filter(c => c.tipo === 'vidro');
  assert.equal(vidro.length, 1);
  assert.equal(vidro[0].d, 4, 'vidro sempre 4 mm');
  const sem2 = D3.montarCaixas(T.geometriaPrevia(sem, { acabamento: '' }));
  assert.ok(sem2.caixas.filter(c => c.tipo === 'perfil').every(p => p.cor === '#abcdef'), 'sem acabamento usa a cor padrão');
  // perfil grande: a moldura cresce para as peças caberem
  assert.ok(T.geometriaPrevia({ ...sem, altura: 100 }).altura >= 260);
});
