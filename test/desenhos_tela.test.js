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
  assert.deepEqual(r, { enviados: 2, falhas: 1, bytes: 2 });
  assert.deepEqual(chamadas.map(c => c[0]), ['/ped_orc/Pedido/23425/desenho/1', '/ped_orc/Pedido/23425/desenho/2', '/ped_orc/Pedido/23425/desenho/4']);
  assert.ok(chamadas.every(c => c[1] === 'PUT' && c[2] === 'image/png'));
  assert.equal((await D.enviarDesenhos(chamar, 'Orçamento', 7, [{ desenho: blob([1]) }])).enviados, 1);
  assert.equal(chamadas.at(-1)[0], '/ped_orc/Or%C3%A7amento/7/desenho/1');
  assert.deepEqual(await D.enviarDesenhos(chamar, 'Pedido', 1, []), { enviados: 0, falhas: 0, bytes: 0 });
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

test('orcamentos.html: os desenhos enviados são os dos itens que foram salvos (cópia da lista tirada ao montar o corpo), não os da lista de agora', () => {
  const h = ler('orcamentos.html');
  assert.match(h, /const itensSalvos = itens\.slice\(\);/);
  assert.match(h, /Desenhos\.enviarDesenhos\(chamarDesenho, json\.tipo, json\.numero, itensSalvos\)/);
  assert.match(h, /itensSalvos\.map\(it => it\.desenhoPronto\)/);
  // a cópia é tirada antes do fetch do salvar
  assert.ok(h.indexOf('const itensSalvos = itens.slice();') < h.indexOf('/ped_orc/salvar`, { method'));
});

test('orcamentos.html: o desenho limpo do PDF mostra os furos (círculos, maiores) mas não os números das medidas', () => {
  const h = ler('orcamentos.html');
  assert.match(h, /if \(ehPortaComFuros\(\) && furosLista\.length\) \{/);       // sem "!limpo": os furos entram também no desenho limpo
  assert.doesNotMatch(h, /!limpo && ehPortaComFuros\(\)/);
  assert.match(h, /const raioBase = Math\.max\(35 \* esc, 12\) \/ 2;/);
  assert.match(h, /const raio = limpo \? Math\.min\(Math\.max\(raioBase \* 2, 6\), perfilPx \* 0\.34\) : raioBase;/);   // no PDF o furo nunca passa de 68% do perfil; na tela segue igual
  assert.match(h, /ctx\.fillStyle = limpo \? '#1f2d2d' : '#f5f5f5';/);   // escuro no PDF: o quadro da porta é fino e o furo claro sumia no cinza
  assert.match(h, /if \(limpo\) return;\s*\n\s*ctx\.fillStyle = '#8b0000';/);        // números das medidas só na tela
});

test('formatarKb e resumoEnvio: tamanho legível e total enviado', async () => {
  assert.equal(D.formatarKb(7578), '7,4 kb');
  assert.equal(D.resumoEnvio({ enviados: 0, falhas: 0, bytes: 0 }), '');
  const r = await D.enviarDesenhos(async () => {}, 'Pedido', 1, [{ desenho: blob(new Array(2048).fill(1)) }, { desenho: blob(new Array(1024).fill(1)) }, {}]);
  assert.deepEqual(r, { enviados: 2, falhas: 0, bytes: 3072 });
  assert.equal(D.resumoEnvio(r), '2 desenho(s), 3,0 kb.');
});
test('orcamentos.html: tamanho do desenho aparece na lista e no aviso do salvar; o Blob continua fora do JSON', () => {
  const h = ler('orcamentos.html');
  assert.match(h, /Desenhos\.formatarKb\(it\.desenho\.size\)/);
  assert.match(h, /Desenhos\.resumoEnvio\(env\)/);
  assert.match(h, /Object\.defineProperty\(item, 'desenho', \{ value: null, writable: true, enumerable: false/);
});
