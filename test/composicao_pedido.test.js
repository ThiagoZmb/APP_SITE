process.env.JWT_SECRET = 'teste';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { compor, SEM_COMPOSICAO } = require('../calculo/composicao_pedido');
const { REGEX_VALOR } = require('../seguranca/valores');

const it = (NUMERO, ITEM, o = {}) => ({ NUMERO, ITEM, ITEM_PEDIDO: ITEM, PERFIL: '', ACABAMENTO_PERFIL: null, REVESTIMENTO: null, ...o });

test('perfil e vidro: só contam com perfil preenchido / linha em vidros ligada ao item', () => {
  const m = compor({ itens: [it(1, 1, { PERFIL: '1036', ACABAMENTO_PERFIL: 'Anodizado Natural', REVESTIMENTO: 'Incolor 4mm' }), it(2, 1, { REVESTIMENTO: 'Incolor 4mm' })], vidros: [{ NUMERO: 1, ITEM: 1 }] });
  assert.deepEqual(m.get(1), { comPerfil: true, comVidro: true, comSerralheria: false, comPintura: false });
  assert.deepEqual(m.get(2), SEM_COMPOSICAO);   // revestimento sem linha em vidros não é vidro
});

test('pintura: acabamento de perfil "Pintura ..." ou vidro "Pintado ..."; anodizado não conta', () => {
  const m = compor({
    itens: [it(1, 1, { PERFIL: '1036', ACABAMENTO_PERFIL: 'Pintura Metálica Alumínio' }), it(2, 1, { PERFIL: '1036', ACABAMENTO_PERFIL: 'Anodizado Bronze' }),
      it(3, 1, { PERFIL: '1036', ACABAMENTO_PERFIL: 'Anodizado Preto', REVESTIMENTO: 'Pintado Sólido (Extra Clear) 4mm' }), it(4, 1, { REVESTIMENTO: 'Chapa Perfurada (0,9mm) Pintado Sólido' })],
    vidros: [{ NUMERO: 3, ITEM: 1 }]
  });
  assert.equal(m.get(1).comPintura, true);
  assert.equal(m.get(2).comPintura, false);
  assert.equal(m.get(3).comPintura, true);
  assert.equal(m.get(3).comVidro, true);
  assert.equal(m.get(4).comPintura, false);     // não é vidro (sem linha em vidros)
});

test('serviço de pintura avulso (nome no campo PERFIL) é Pintura e não Perfil; vidro também liga por ITEM_PEDIDO', () => {
  const m = compor({ itens: [it(1, 1, { PERFIL: 'Pintura Metálica Kit Box' }), it(2, 5, { ITEM_PEDIDO: 1, REVESTIMENTO: 'Incolor 4mm' })], vidros: [{ NUMERO: 2, ITEM: 1 }] });
  assert.deepEqual(m.get(1), { comPerfil: false, comVidro: false, comSerralheria: false, comPintura: true });
  assert.equal(m.get(2).comVidro, true);
});

test('serralheria: linha em ped_orc_serralheria ou tipo Metalons; tipo Perfil sozinho não marca Perfil (inclui serviços de pintura)', () => {
  const m = compor({ serralheria: [5], tipos: [{ NUMERO: 6, TIPO_PRODUTO: 'Metalons' }, { NUMERO: 7, TIPO_PRODUTO: 'Perfil' }, { NUMERO: 8, TIPO_PRODUTO: 'Serviço' }] });
  assert.equal(m.get(5).comSerralheria, true);
  assert.equal(m.get(6).comSerralheria, true);
  assert.equal(m.get(7), undefined);
  assert.equal(m.get(8), undefined);   // tipo sem ícone não cria entrada
});

test('serralheria com acabamento de pintura liga Pintura (e Serralheria); galvanizado, sem acabamento e negação não ligam', () => {
  const m = compor({ serralheria: [
    { NUMERO: 23378, ACABAMENTO: 'Pintura Metálica Aço Carbono' }, { NUMERO: 23378, ACABAMENTO: 'Galvanizado' },
    { NUMERO: 2, ACABAMENTO: 'Galvanizado' }, { NUMERO: 3, ACABAMENTO: '' }, { NUMERO: 4, ACABAMENTO: null }, { NUMERO: 5 }, 6,
    { NUMERO: 7, ACABAMENTO: 'Sem pintura' }, { NUMERO: 8, ACABAMENTO: 'Não pintar' }, { NUMERO: 9, ACABAMENTO: 'PINTURA eletrostática' }
  ] });
  assert.deepEqual(m.get(23378), { comPerfil: false, comVidro: false, comSerralheria: true, comPintura: true });
  for (const n of [2, 3, 4, 5, 6, 7, 8]) assert.deepEqual(m.get(n), { comPerfil: false, comVidro: false, comSerralheria: true, comPintura: false }, 'pedido ' + n);
  assert.equal(m.get(9).comPintura, true);
  // perfil e vidro continuam como antes, e a serralheria soma no mesmo pedido
  const mix = compor({ itens: [it(1, 1, { PERFIL: 'P1', ACABAMENTO_PERFIL: 'Anodizado' })], serralheria: [{ NUMERO: 1, ACABAMENTO: 'Pintura Metálica Aço Carbono' }] });
  assert.deepEqual(mix.get(1), { comPerfil: true, comVidro: false, comSerralheria: true, comPintura: true });
  assert.equal(compor({ itens: [it(1, 1, { PERFIL: 'P1', ACABAMENTO_PERFIL: 'Anodizado' })] }).get(1).comPintura, false);
});

test('carregarComposicao: o ACABAMENTO de ped_orc_serralheria chega ao compor (ícone de Pintura da serralheria)', async () => {
  const { carregarComposicao } = require('../calculo/composicao_documentos');
  const pool = { async execute(sql) {
    if (/FROM ped_orc_serralheria/.test(sql)) { assert.match(sql, /ACABAMENTO/); return [[{ NUMERO: 23378, ACABAMENTO: 'Pintura Metálica Aço Carbono' }], []]; }
    if (/FROM ped_orc_lista_itens/.test(sql)) return [[{ NUMERO: 23378, TIPO_PRODUTO: 'Metalons' }], []];
    return [[], []];
  } };
  assert.deepEqual((await carregarComposicao(pool, 'Pedido', [23378])).get(23378), { comPerfil: false, comVidro: false, comSerralheria: true, comPintura: true });
});

test('os nomes dos campos não casam com REGEX_VALOR (senão o filtro de dinheiro os apaga)', () => {
  for (const k of Object.keys(SEM_COMPOSICAO)) assert.equal(REGEX_VALOR.test(k), false, k);
});

test('painel_inicial: lista sem botões de ação na linha (só botão direito) e com os ícones dos itens', () => {
  const h = fs.readFileSync(path.join(__dirname, '..', 'painel_inicial.html'), 'utf8');
  assert.doesNotMatch(h, /class="acao-doc|class="editar"|data-acao="(cancelar|excluir|menu)"/);
  assert.match(h, /iconesItens\(x\)/);
  for (const [campo, nome] of [['comPerfil', 'Perfil'], ['comVidro', 'Vidro'], ['comSerralheria', 'Serralheria'], ['comPintura', 'Pintura']]) assert.ok(h.includes(`'${campo}'`) && h.includes(`'${nome}'`), campo);
  assert.match(h, /addEventListener\('contextmenu'/);
});
