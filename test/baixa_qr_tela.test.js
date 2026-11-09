// Tela de baixa de estoque por QR (baixa_qr.html + baixa_qr.js): lógica pura (node:test) e conferência do HTML estático.
// A câmera e o jsQR reais não são testáveis no Node: aqui só a lógica pura e o HTML.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const B = require('../baixa_qr.js');

const ler = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const ITEM = { codigo: 3, nome: 'Perfil 1036', unidade: 'BR', qtd: 10 };

// api falsa: respostas em fila; guarda as chamadas
function apiFalsa(...respostas) {
  const chamadas = [];
  const api = async (caminho, opcoes) => {
    chamadas.push({ caminho, opcoes });
    const r = respostas.length > 1 ? respostas.shift() : respostas[0];
    return typeof r === 'function' ? r() : r;
  };
  api.chamadas = chamadas;
  return api;
}
const ok = (corpo, status = 200) => ({ ok: true, status, corpo });
const falha = (status, error) => ({ ok: false, status, corpo: { error } });
const fluxo = (api, extra = {}) => {
  let n = 0;
  return B.criarFluxo({ api, hoje: () => '2026-11-09', chave: () => 'k' + (++n), ...extra });
};

test('ajustarQtd respeita 1 e o saldo inteiro', () => {
  assert.equal(B.ajustarQtd(1, -1, 10), 1);
  assert.equal(B.ajustarQtd(10, 1, 10), 10);
  assert.equal(B.ajustarQtd(3, 1, 10), 4);
  assert.equal(B.ajustarQtd(1, 1, 0.5), 1);
});

test('novaChave, corpoDaBaixa e dataLocal', () => {
  const a = B.novaChave(), b = B.novaChave();
  assert.notEqual(a, b);
  assert.ok(a.length <= 64 && a.startsWith('qr-'));
  assert.deepEqual(B.corpoDaBaixa({ codigo: 3 }, 4, 'k', '2026-11-09'), { chave: 'k', data: '2026-11-09', itens: [{ produtoCodigo: 3, qtd: 4 }] });
  assert.equal(B.dataLocal(new Date(2026, 10, 9, 23, 59)), '2026-11-09');
});

test('mensagemDeErro', () => {
  assert.equal(B.mensagemDeErro(404, {}), 'Item não encontrado.');
  assert.equal(B.mensagemDeErro(403, {}), 'Sem permissão para dar baixa.');
  assert.equal(B.mensagemDeErro(409, { error: 'Este lançamento já foi gravado.' }), 'Esta baixa já foi registrada. Confira no histórico antes de repetir.');
  assert.equal(B.mensagemDeErro(400, { error: 'saldo baixo' }), 'saldo baixo');
  assert.equal(B.mensagemDeErro(500, {}), 'Erro de servidor.');
});

test('lerQr devolve o texto do QR ou null', () => {
  const img = { data: new Uint8ClampedArray(4), width: 1, height: 1 };
  assert.equal(B.lerQr(img, () => ({ data: 'ABC' })), 'ABC');
  assert.equal(B.lerQr(img, () => null), null);
});

test('fluxo: leitura 200 abre o cartão com qtd 1', async () => {
  const api = apiFalsa(ok(ITEM));
  const f = fluxo(api);
  assert.equal(f.estado.fase, 'lendo');
  await f.lerCodigo('ABC123');
  assert.equal(f.estado.fase, 'cartao');
  assert.equal(f.estado.qtd, 1);
  assert.equal(f.estado.item.codigo, 3);
  assert.equal(api.chamadas[0].caminho, '/estoque/por_codigo/ABC123');
});

test('fluxo: leitura 404 vira erro e nunca faz POST', async () => {
  const api = apiFalsa(falha(404, 'Item não encontrado.'));
  const f = fluxo(api);
  await f.lerCodigo('XYZ');
  assert.equal(f.estado.fase, 'erro');
  assert.equal(f.estado.mensagem, 'Item não encontrado.');
  assert.ok(api.chamadas.every(c => !c.opcoes || c.opcoes.metodo !== 'POST'));
});

test('fluxo: QR com 500 caracteres é recusado sem chamar a api', async () => {
  const api = apiFalsa(ok(ITEM));
  const f = fluxo(api);
  await f.lerCodigo('A'.repeat(500));
  assert.equal(f.estado.fase, 'erro');
  assert.equal(api.chamadas.length, 0);
  await f.lerCodigo('');
  assert.equal(f.estado.fase, 'erro');
  assert.equal(api.chamadas.length, 0);
});

test('fluxo: confirmar duas vezes seguidas sem esperar faz um único POST', async () => {
  let liberar;
  const lenta = () => new Promise(r => { liberar = () => r(ok({ itens: [{ produto: 3, antes: 10, depois: 9 }] }, 201)); });
  const api = apiFalsa(ok(ITEM), lenta);
  const f = fluxo(api);
  await f.lerCodigo('ABC');
  const p1 = f.confirmar();
  const p2 = f.confirmar();
  assert.equal(f.estado.fase, 'gravando');
  liberar();
  await Promise.all([p1, p2]);
  assert.equal(api.chamadas.filter(c => c.opcoes && c.opcoes.metodo === 'POST').length, 1);
  assert.equal(f.estado.fase, 'feito');
  assert.equal(f.estado.depois, 9);
});

test('fluxo: erro de saldo mantém o cartão, a quantidade e a MESMA chave na nova tentativa', async () => {
  const api = apiFalsa(ok(ITEM), falha(400, "A quantidade do item 'X' é menor que 0! (estoque: 1, saída: 5)"), ok({ itens: [{ produto: 3, antes: 10, depois: 5 }] }, 201));
  const f = fluxo(api);
  await f.lerCodigo('ABC');
  f.mudarQtd(1); f.mudarQtd(1); f.mudarQtd(1); f.mudarQtd(1);
  assert.equal(f.estado.qtd, 5);
  await f.confirmar();
  assert.equal(f.estado.fase, 'cartao');
  assert.equal(f.estado.qtd, 5);
  assert.match(f.estado.mensagem, /menor que 0/);
  await f.confirmar();
  const posts = api.chamadas.filter(c => c.opcoes && c.opcoes.metodo === 'POST');
  assert.equal(posts.length, 2);
  assert.equal(posts[0].opcoes.corpo.chave, posts[1].opcoes.corpo.chave);
  assert.equal(f.estado.fase, 'feito');
});

test('fluxo: 409 vira "já registrada" e mantém o cartão', async () => {
  const api = apiFalsa(ok(ITEM), falha(409, 'Este lançamento já foi gravado.'));
  const f = fluxo(api);
  await f.lerCodigo('ABC');
  await f.confirmar();
  assert.equal(f.estado.mensagem, 'Esta baixa já foi registrada. Confira no histórico antes de repetir.');
  assert.equal(f.estado.fase, 'cartao');
});

test('fluxo: queda de rede (api lança ou status 0) mantém o cartão; nova tentativa usa a MESMA chave e o 409 vira "já registrada"', async () => {
  const lanca = () => { throw new Error('rede'); };
  for (const queda of [lanca, { ok: false, status: 0, corpo: { error: 'Sem conexão. Tente de novo.' } }]) {
    const api = apiFalsa(ok(ITEM), queda, falha(409, 'Este lançamento já foi gravado.'));
    const f = fluxo(api);
    await f.lerCodigo('ABC');
    await f.confirmar();
    assert.equal(f.estado.fase, 'cartao');
    assert.equal(f.estado.mensagem, 'Sem conexão. Tente de novo.');
    await f.confirmar();
    assert.equal(f.estado.fase, 'cartao');
    assert.equal(f.estado.mensagem, 'Esta baixa já foi registrada. Confira no histórico antes de repetir.');
    const posts = api.chamadas.filter(c => c.opcoes && c.opcoes.metodo === 'POST');
    assert.equal(posts.length, 2);
    assert.equal(posts[0].opcoes.corpo.chave, posts[1].opcoes.corpo.chave);
  }
});

test('fluxo: lerCodigo com api que lança vira erro "Sem conexão" e nunca faz POST', async () => {
  const api = apiFalsa(() => { throw new Error('rede'); });
  const f = fluxo(api);
  await f.lerCodigo('ABC');
  assert.equal(f.estado.fase, 'erro');
  assert.equal(f.estado.mensagem, 'Sem conexão. Tente de novo.');
  assert.ok(api.chamadas.every(c => !c.opcoes || c.opcoes.metodo !== 'POST'));
});

test('fluxo: sucesso mostra o saldo novo e a leitura seguinte usa chave diferente; cancelar volta a lendo', async () => {
  const api = apiFalsa(ok(ITEM), ok({ itens: [{ produto: 3, antes: 10, depois: 9 }] }, 201));
  const f = fluxo(api);
  await f.lerCodigo('ABC');
  const k1 = f.estado.chave;
  await f.confirmar();
  assert.equal(f.estado.fase, 'feito');
  assert.equal(f.estado.depois, 9);
  await f.lerCodigo('ABC');   // leitura seguinte, depois do sucesso
  assert.equal(f.estado.fase, 'cartao');
  assert.notEqual(f.estado.chave, k1);
  f.cancelar();
  assert.equal(f.estado.fase, 'lendo');
  assert.equal(f.estado.item, null);
});

test('HTML: CSP, ordem dos scripts, tema por último, campo de código, sem onclick nem cor solta', () => {
  const h = ler('baixa_qr.html');
  assert.match(h, /<meta http-equiv="Content-Security-Policy"/);
  const iJs = h.indexOf('vendor/jsQR.js'), iApp = h.indexOf('baixa_qr.js');
  assert.ok(iJs > 0 && iApp > iJs, 'jsQR antes de baixa_qr.js');
  assert.ok(h.lastIndexOf('tema.css') > h.indexOf('<style') && h.lastIndexOf('tema.css') > h.lastIndexOf('</style>'), 'tema.css depois do style');
  assert.ok(h.indexOf('tema.css') < h.indexOf('</head>'));
  assert.match(h, /id="codigo-manual"/);
  assert.ok(!/onclick=/i.test(h));
  const estilo = (h.match(/<style[\s\S]*?<\/style>/g) || []).join('');
  assert.ok(!/#[0-9a-f]{3,8}\b/i.test(estilo), 'sem cor hexadecimal solta no <style>');
});

test('vendor/jsQR.js existe, não está vazio e tem LEIA-ME', () => {
  assert.ok(ler('vendor/jsQR.js').length > 100000);
  assert.match(ler('vendor/LEIA-ME.txt'), /1\.4\.0/);
});

// ---- câmera: gestor do stream (sem trava, duas chamadas de getUserMedia vazavam a câmera) ----
function streamFalso() {
  const s = { paradas: 0 };
  s.getTracks = () => [{ stop() { s.paradas++; } }, { stop() { s.paradas++; } }];
  return s;
}
function abrirControlavel() {
  const pend = [];
  const abrir = () => new Promise((res, rej) => { pend.push({ res, rej }); });
  abrir.pend = pend;
  return abrir;
}

test('câmera: duas chamadas de ligar() seguidas abrem UM stream só', async () => {
  const abrir = abrirControlavel();
  const g = B.criarGestorStream(abrir, () => true);
  const p1 = g.ligar();
  const p2 = g.ligar();
  assert.equal(abrir.pend.length, 1, 'getUserMedia chamado uma vez');
  assert.equal((await p2).estado, 'ocupado');
  const s1 = streamFalso();
  abrir.pend[0].res(s1);
  assert.equal((await p1).estado, 'ok');
  assert.equal(g.stream, s1);
  assert.equal(s1.paradas, 0);
  assert.equal((await g.ligar()).estado, 'ocupado');
  g.parar();
  assert.equal(s1.paradas, 2);
  assert.equal(g.stream, null);
});

test('câmera: se a página deixou de querer a câmera durante o prompt, as faixas do stream novo são paradas', async () => {
  const abrir = abrirControlavel();
  let quer = true;
  const g = B.criarGestorStream(abrir, () => quer);
  const p = g.ligar();
  quer = false;
  const s = streamFalso();
  abrir.pend[0].res(s);
  assert.equal((await p).estado, 'descartado');
  assert.equal(s.paradas, 2);
  assert.equal(g.stream, null);
});

test('câmera: falha do getUserMedia devolve "falha" e libera a trava para nova tentativa', async () => {
  const abrir = abrirControlavel();
  const g = B.criarGestorStream(abrir, () => true);
  const p = g.ligar();
  abrir.pend[0].rej(new Error('negado'));
  assert.equal((await p).estado, 'falha');
  const p2 = g.ligar();
  assert.equal(abrir.pend.length, 2);
  abrir.pend[1].res(streamFalso());
  assert.equal((await p2).estado, 'ok');
});

test('iniciar: página não liberada para o usuário não toca na câmera nem na API', () => {
  let chamadas = 0;
  const win = {
    Acesso: { paginaLiberada: () => false },
    document: { getElementById() { throw new Error('não deveria mexer na tela'); } },
    navigator: { mediaDevices: { getUserMedia() { chamadas++; return Promise.resolve(streamFalso()); } } },
    fetch() { chamadas++; return Promise.resolve({}); }
  };
  B.iniciar(win);
  assert.equal(chamadas, 0);
});
