// Validação PURA dos ajustes da janela de etiquetas (calculo/etiqueta_edicao.js). Sem banco.
const test = require('node:test');
const assert = require('node:assert/strict');
const { UFS, MAX_ETIQUETAS, normalizarUf, normalizarQtd, normalizarMedidas, validarEdicao, sugerirMedidas } = require('../calculo/etiqueta_edicao');

const ITENS = ['1', '2'];
const erro = corpo => { const v = validarEdicao(corpo, ITENS); assert.equal(v.ok, false, JSON.stringify(corpo)); return v.erro; };

test('são exatamente as 27 UFs', () => {
  assert.equal(UFS.length, 27);
  assert.equal(new Set(UFS).size, 27);
  for (const uf of ['ES', 'RJ', 'SP', 'DF', 'TO']) assert.ok(UFS.includes(uf));
});

test('UF: sigla válida (maiúscula ou não, com espaços) ou vazio; o resto é inválido', () => {
  assert.equal(normalizarUf('es'), 'ES');
  assert.equal(normalizarUf(' SP '), 'SP');
  for (const v of [undefined, null, '', '  ']) assert.equal(normalizarUf(v), '');
  for (const v of ['XX', 'E', 'ESP', 'Espírito Santo', 'E^', 5, {}, ['ES']]) assert.equal(normalizarUf(v), null, String(v));
});

test('qtd: inteiro de 1 a 999; vazio = padrão (undefined); o resto é inválido', () => {
  assert.equal(normalizarQtd(1), 1);
  assert.equal(normalizarQtd('999'), 999);
  assert.equal(normalizarQtd(undefined), undefined);
  assert.equal(normalizarQtd(''), undefined);
  for (const v of [0, -1, 1000, 1.5, '1.5', '1,5', 'abc', '1e2', '0999999', NaN, {}, [1], true]) assert.equal(normalizarQtd(v), null, String(v));
});

test('medidas: só dígitos, x, X, ×, ponto, vírgula, espaço, hífen e mm; até 30 caracteres', () => {
  for (const ok of ['2287 × 706', '2287x706', '2287 X 706 mm', '1.500,5 - 700', '2287mm']) assert.equal(normalizarMedidas(ok), ok);
  assert.equal(normalizarMedidas('  2287   ×   706 '), '2287 × 706');
  assert.equal(normalizarMedidas(''), '');
  assert.equal(normalizarMedidas(undefined), '');
  for (const ruim of ['^FO10', '10; DROP', '10~20', '10\20', 'abc', '10 cm', '10 * 20', 'x', 'mm', '12<b>', '1'.repeat(31), 5, {}]) assert.equal(normalizarMedidas(ruim), null, String(ruim));
  assert.equal(normalizarMedidas('1'.repeat(30)), '1'.repeat(30));
});

test('validarEdicao: sem corpo = padrões; devolve UF geral, ajustes por item e o total de etiquetas', () => {
  for (const c of [undefined, null]) { const v = validarEdicao(c, ITENS); assert.ok(v.ok); assert.equal(v.uf, ''); assert.equal(v.porItem.size, 0); }
  assert.equal(validarEdicao(undefined, ITENS).total, 2);
  const v = validarEdicao({ uf: 'es', itens: [{ item: 1, qtd: '3', incluirMedidas: true, medidas: '2287 × 706', uf: 'rj' }, { item: '2' }] }, ITENS);
  assert.equal(v.total, 4, '3 volumes + 1 (padrão)');
  assert.ok(v.ok);
  assert.equal(v.uf, 'ES');
  assert.deepEqual(v.porItem.get('1'), { qtd: 3, medidas: '2287 × 706' });
  assert.deepEqual(v.porItem.get('2'), { qtd: undefined, medidas: '' });
});

test('validarEdicao: medidas só valem com "incluirMedidas: true" (desligadas são ignoradas, mesmo com texto)', () => {
  const v = validarEdicao({ itens: [{ item: '1', incluirMedidas: false, medidas: '10 cm ruim' }, { item: '2', medidas: '2287 x 706' }] }, ITENS);
  assert.ok(v.ok);
  assert.equal(v.porItem.get('1').medidas, '');
  assert.equal(v.porItem.get('2').medidas, '');
  const ligadaVazia = validarEdicao({ itens: [{ item: '1', incluirMedidas: true, medidas: '' }] }, ITENS);
  assert.ok(ligadaVazia.ok);
  assert.equal(ligadaVazia.porItem.get('1').medidas, '');
});

test('validarEdicao: mensagens claras de 400', () => {
  assert.match(erro('texto'), /Corpo inválido/);
  assert.match(erro([]), /Corpo inválido/);
  assert.match(erro({ uf: 'XX' }), /27 UFs/);
  assert.match(erro({ itens: {} }), /"itens"/);
  assert.match(erro({ itens: [1] }), /objeto/);
  assert.match(erro({ itens: [{ item: '7' }] }), /item 7 não existe/);
  assert.match(erro({ itens: [{}] }), /não existe/);
  assert.match(erro({ itens: [{ item: '1' }, { item: 1 }] }), /repetido/);
  assert.match(erro({ itens: [{ item: '1', qtd: 1000 }] }), /Qtd de etiquetas \(volumes\) do item 1.*1 a 999/);
  assert.match(erro({ itens: [{ item: '1', incluirMedidas: 'sim' }] }), /incluirMedidas/);
  assert.match(erro({ itens: [{ item: '2', incluirMedidas: true, medidas: '^XZ' }] }), /Medidas do item 2.*30 caracteres/);
  assert.match(erro({ itens: Array.from({ length: 501 }, (_, i) => ({ item: String(i) })) }), /até 500/);
});

test('sugerirMedidas: ALTURA × LARGURA quando legível e igual em todas as folhas; senão vazio (não inventa)', () => {
  assert.equal(sugerirMedidas([{ ALTURA: '2287', LARGURA: '706' }]), '2287 × 706');
  assert.equal(sugerirMedidas([{ ALTURA: '2287.00', LARGURA: '706,5' }]), '2287 × 706,5');
  assert.equal(sugerirMedidas([{ ALTURA: '2287', LARGURA: '706' }, { ALTURA: '2287', LARGURA: '706' }]), '2287 × 706');
  assert.equal(sugerirMedidas([{ ALTURA: '2287', LARGURA: '706' }, { ALTURA: '2287', LARGURA: '800' }]), '');
  for (const linhas of [undefined, [], [{ ALTURA: '', LARGURA: '706' }], [{ ALTURA: null, LARGURA: null }], [{ ALTURA: '0', LARGURA: '5' }], [{ ALTURA: 'abc', LARGURA: '5' }], [{ ALTURA: '2287', LARGURA: '7x' }]]) assert.equal(sugerirMedidas(linhas), '');
  // a sugestão sempre passa na própria validação
  assert.equal(normalizarMedidas(sugerirMedidas([{ ALTURA: '2287', LARGURA: '706' }])), '2287 × 706');
});

test('UF por item (formato antigo) é ignorada sem erro, mesmo inválida; só vale a UF geral', () => {
  const v = validarEdicao({ uf: 'ES', itens: [{ item: '1', uf: 'ZZ' }] }, ITENS);
  assert.ok(v.ok);
  assert.equal(v.uf, 'ES');
  assert.ok(!('uf' in v.porItem.get('1')));
});

test('teto de etiquetas: soma dos volumes de todos os itens até 200; acima disso é recusado com mensagem clara', () => {
  assert.equal(MAX_ETIQUETAS, 200);
  const ok = validarEdicao({ itens: [{ item: '1', qtd: 199 }] }, ITENS); // 199 + 1 (item 2, padrão) = 200
  assert.ok(ok.ok);
  assert.equal(ok.total, 200);
  assert.match(erro({ itens: [{ item: '1', qtd: 100 }, { item: '2', qtd: 101 }] }), /Total de 201 etiquetas passa do limite de 200/);
  assert.match(erro({ itens: [{ item: '1', qtd: 999 }] }), /limite de 200/);
});
