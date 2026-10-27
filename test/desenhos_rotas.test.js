// PUT /ped_orc/:tipo/:numero/desenho/:item — guarda o desenho da porta para o PDF.
const test = require('node:test');
const assert = require('node:assert/strict');
const { bancoPedOrc, prepararPedOrc } = require('./apoio/bancoPedOrc');
const { carimboItens } = require('../calculo/leitura_vb');

const ASSINATURA = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const png = (extra = 40) => Buffer.concat([ASSINATURA, Buffer.alloc(extra, 7)]);

// pedido 23425 com 2 itens de porta (cliente "CLIENTE TESTE")
function comPedido() {
  const banco = bancoPedOrc();
  banco.pedOrc.push({ TIPO: 'Pedido', NUMERO: 23425, RAZAO_SOCIAL: 'CLIENTE TESTE', SITUACAO: 'Em Produção' });
  banco.listaItens.push({ id: 1, NUMERO: 23425, TIPO: 'Pedido', ITEM: 1, QTD: 1, TIPO_PRODUTO: 'Porta de giro', DESCRICAO: 'a' },
    { id: 2, NUMERO: 23425, TIPO: 'Pedido', ITEM: 2, QTD: 2, TIPO_PRODUTO: 'Porta de giro', DESCRICAO: 'b' });
  banco.itensV4.push({ ID: 1, NUMERO: 23425, TIPO: 'Pedido', ITEM_PEDIDO: 1, ITEM: 1, PORTA: 'Folha 1', ALTURA: 2100, LARGURA: 900 });
  return banco;
}
const put = (c, item, corpo, tipoConteudo = 'image/png', tipo = 'Pedido', numero = 23425) =>
  c.chamarBruto(`/ped_orc/${encodeURIComponent(tipo)}/${numero}/desenho/${item}`, 'PUT', corpo, tipoConteudo);

test('desenho: PNG válido é gravado com o carimbo do documento; reenviar substitui (upsert)', async t => {
  const banco = comPedido();
  const c = await prepararPedOrc(t, { banco });
  let r = await put(c, 1, png());
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true });
  assert.equal(banco.desenhos.length, 1);
  assert.equal(banco.desenhos[0].item, 1);
  assert.equal(banco.desenhos[0].carimbo, carimboItens({ lista: banco.listaItens, itensV4: banco.itensV4, furacao: banco.furacao }));
  r = await put(c, 1, png(90));
  assert.equal(r.status, 200);
  assert.equal(banco.desenhos.length, 1);
  assert.equal(banco.desenhos[0].png.length, png(90).length);
  assert.equal((await put(c, 2, png())).status, 200);
  assert.equal(banco.desenhos.length, 2);
});

test('desenho: arquivo que não é PNG, corpo vazio ou grande demais é recusado e nada é gravado', async t => {
  const banco = comPedido();
  const c = await prepararPedOrc(t, { banco });
  assert.equal((await put(c, 1, Buffer.from('<html>oi</html>'))).status, 400);
  assert.equal((await put(c, 1, Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(50)]))).status, 400);
  assert.equal((await put(c, 1, Buffer.alloc(0))).status, 400);
  const grande = await put(c, 1, png(150 * 1024 + 10));
  assert.ok([400, 413].includes(grande.status), 'status ' + grande.status);
  assert.match(grande.headers.get('content-type'), /json/);
  assert.match((await grande.json()).error, /150 kb/);
  assert.equal((await put(c, 1, png(), 'text/plain')).status, 400);
  assert.equal(banco.desenhos.length, 0);
});

test('desenho: item, documento ou tipo inexistentes/inválidos', async t => {
  const banco = comPedido();
  const c = await prepararPedOrc(t, { banco });
  assert.equal((await put(c, 9, png())).status, 404);
  assert.equal((await put(c, 1, png(), 'image/png', 'Pedido', 999)).status, 404);
  assert.equal((await put(c, 1, png(), 'image/png', 'Outro')).status, 400);
  assert.equal((await put(c, 'abc', png())).status, 400);
  assert.equal((await put(c, 0, png())).status, 400);
  assert.equal(banco.desenhos.length, 0);
});

test('desenho: sem permissão de salvar 403; usuário restrito a outro estado 403', async t => {
  const banco = comPedido();
  let c = await prepararPedOrc(t, { banco, perfil: 'Estoquista' });
  assert.equal((await put(c, 1, png())).status, 403);
  c = await prepararPedOrc(t, { banco, perfil: 'Representante SP' });
  assert.equal((await put(c, 1, png())).status, 403);
  assert.equal(banco.desenhos.length, 0);
});

test('desenho: perfil que monta sem ver valores também envia (o desenho não é dinheiro)', async t => {
  const banco = comPedido();
  const c = await prepararPedOrc(t, { banco, perfil: 'Monta sem valores' });
  assert.equal((await put(c, 1, png())).status, 200);
});
