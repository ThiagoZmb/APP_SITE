// Captura e envio do desenho da porta na tela de orçamentos: funções puras de desenhos.js e ligações no HTML.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const D = require('../desenhos.js');

const ler = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const blob = bytes => new Blob([new Uint8Array(bytes)]);

test('caixaDoDesenho: cabe em 300×500 mantendo a proporção', () => {
  const retrato = D.caixaDoDesenho(900, 2100);
  assert.ok(retrato.h <= 500 && retrato.w <= 300);
  assert.ok(Math.abs(retrato.w / retrato.h - 900 / 2100) < 0.01);
  assert.deepEqual(D.caixaDoDesenho(4000, 500), { w: 300, h: 38 });
  assert.deepEqual(D.caixaDoDesenho(100, 100, { maxW: 50, maxH: 80 }), { w: 50, h: 50 });
  const minimo = D.caixaDoDesenho(1, 100000);
  assert.ok(minimo.w >= 1 && minimo.h >= 1);
});

test('reduzirAteCaber: reduz a escala até o PNG caber no limite', async () => {
  const tamanhos = [200, 120, 60];
  const chamadas = [];
  const gerar = async escala => { chamadas.push(escala); return blob(new Array(tamanhos[chamadas.length - 1] * 1024).fill(1)); };
  const b = await D.reduzirAteCaber(gerar, 150 * 1024);
  assert.equal(b.size, 120 * 1024);
  assert.equal(chamadas.length, 2);
  assert.equal(chamadas[0], 1);
  assert.ok(Math.abs(chamadas[1] - 0.8) < 1e-9);
});

test('reduzirAteCaber: devolve null quando nenhuma escala serve ou quando não há desenho; nunca lança', async () => {
  assert.equal(await D.reduzirAteCaber(async () => blob(new Array(500 * 1024).fill(1)), 150 * 1024), null);
  assert.equal(await D.reduzirAteCaber(async () => null, 150 * 1024), null);
  assert.equal(await D.reduzirAteCaber(async () => { throw new Error('canvas'); }, 150 * 1024), null);
});

test('enviarDesenhos: PUT de cada item com desenho na posição certa; falha de um não impede os outros nem lança', async () => {
  const chamadas = [];
  const chamar = async (caminho, opc) => { chamadas.push([caminho, opc.metodo, opc.tipoConteudo]); if (caminho.endsWith('/desenho/2')) throw new Error('HTTP 500'); };
  const itens = [{ desenho: blob([1]) }, { desenho: blob([2]) }, { desenho: null }, { desenho: blob([3]) },
    { desenho: blob([4]), origem: { item: 9, estado: 'intacto' } }];
  const r = await D.enviarDesenhos(chamar, 'Pedido', 23425, itens);
  assert.deepEqual(r, { enviados: 2, falhas: 1 });
  assert.deepEqual(chamadas.map(c => c[0]), ['/ped_orc/Pedido/23425/desenho/1', '/ped_orc/Pedido/23425/desenho/2', '/ped_orc/Pedido/23425/desenho/4']);
  assert.ok(chamadas.every(c => c[1] === 'PUT' && c[2] === 'image/png'));
  assert.equal((await D.enviarDesenhos(chamar, 'Orçamento', 7, [{ desenho: blob([1]) }])).enviados, 1);
  assert.equal(chamadas.at(-1)[0], '/ped_orc/Or%C3%A7amento/7/desenho/1');
  assert.deepEqual(await D.enviarDesenhos(chamar, 'Pedido', 1, []), { enviados: 0, falhas: 0 });
});

test('FRENTES_COM_DESENHO: só as portas que têm desenho na tela', () => {
  assert.deepEqual(D.FRENTES_COM_DESENHO, ['Porta de giro', 'Porta basculante', 'Porta de Correr', 'Frente de gaveta']);
});

test('orcamentos.html: carrega desenhos.js, captura ao adicionar o item e envia depois do salvar e antes de reabrir', () => {
  const h = ler('orcamentos.html');
  assert.ok(h.includes('<script src="desenhos.js'));
  assert.match(h, /desenharVisualizacao\(opcoes = \{\}\)/);
  assert.match(h, /desenharVisualizacao\(\{ alvo: [a-z]+, limpo: true \}\)/);
  assert.ok(h.includes('desenhoPronto'));
  const envia = h.indexOf('Desenhos.enviarDesenhos(');
  const reabre = h.indexOf('await abrirDocumento(json.tipo, json.numero');
  assert.ok(envia > 0 && reabre > 0 && envia < reabre, 'enviar os desenhos antes de reabrir o documento');
  assert.match(h, /desenho\(s\) não foram enviados/);
});
