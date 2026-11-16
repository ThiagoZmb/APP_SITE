// Captura de foto ao vivo (camera_captura.js): logica pura testada sem navegador, mais o fluxo de tela com um DOM/camera de mentira.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const K = require('../camera_captura.js');

const ler = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('planoReducao: do mais nitido ao mais leve, sem ampliar e sem repetir a mesma escala', () => {
  const p = K.planoReducao(4000, 3000);
  assert.deepEqual(p[0], { largura: 2000, altura: 1500, qualidade: 0.85 });
  assert.deepEqual(p.map(x => x.qualidade).slice(0, 4), [0.85, 0.72, 0.6, 0.5]);
  const maiores = p.map(x => Math.max(x.largura, x.altura));
  assert.deepEqual([...new Set(maiores)], [2000, 1600, 1200, 900, 600]);
  // foto pequena: nao amplia e nao repete a escala
  const q = K.planoReducao(800, 600);
  assert.equal(Math.max(q[0].largura, q[0].altura), 800);
  assert.deepEqual([...new Set(q.map(x => x.largura + 'x' + x.altura))], ['800x600', '600x450']);
  // retrato e valores ruins
  assert.deepEqual(K.escala(3000, 4000, 2000), { largura: 1500, altura: 2000 });
  assert.deepEqual(K.escala(0, undefined, 1000), { largura: 1, altura: 1 });
});

test('reduzirParaCaber: pega a primeira combinacao que cabe em 1 MB e erra em portugues se nenhuma couber', async () => {
  const chamadas = [];
  const blob = await K.reduzirParaCaber(4000, 3000, async (l, a, q) => { chamadas.push([l, q]); return { size: l >= 1600 ? 1500000 : 900000 }; });
  assert.equal(blob.size, 900000);
  assert.deepEqual(chamadas.at(-1), [1200, 0.85]);
  assert.equal(chamadas.length, 9); // 2000x4 + 1600x4 + 1200x1
  await assert.rejects(K.reduzirParaCaber(4000, 3000, async () => ({ size: 2000000 })), /grande demais/);
  await assert.rejects(K.reduzirParaCaber(100, 100, async () => null), /grande demais/); // canvas sem blob
  assert.equal(K.LIMITE_BYTES, 1000 * 1000);
});

test('restricoes: camera traseira ideal e resolucao alta, sem audio', () => {
  assert.deepEqual(K.RESTRICOES.video.facingMode, { ideal: 'environment' });
  assert.ok(K.RESTRICOES.video.width.ideal >= 1920);
  assert.equal(K.RESTRICOES.audio, false);
});

test('suportaCamera: exige getUserMedia e contexto seguro', () => {
  const gum = () => {};
  assert.equal(K.suportaCamera({ navigator: { mediaDevices: { getUserMedia: gum } }, isSecureContext: true }), true);
  assert.equal(K.suportaCamera({ navigator: { mediaDevices: { getUserMedia: gum } } }), true); // sem a propriedade (teste)
  assert.equal(K.suportaCamera({ navigator: { mediaDevices: { getUserMedia: gum } }, isSecureContext: false }), false); // http
  assert.equal(K.suportaCamera({ navigator: {}, isSecureContext: true }), false);
  assert.equal(K.suportaCamera({ navigator: { mediaDevices: {} }, isSecureContext: true }), false);
  assert.equal(K.suportaCamera(null), false);
});

test('mensagemErroCamera: permissao negada explicada em portugues claro, e os outros motivos', () => {
  const negada = K.mensagemErroCamera({ name: 'NotAllowedError' });
  assert.match(negada, /negado/);
  assert.match(negada, /configurações do navegador/);
  assert.match(negada, /câmera do aparelho/);
  assert.match(K.mensagemErroCamera({ name: 'NotFoundError' }), /Não encontrei uma câmera/);
  assert.match(K.mensagemErroCamera({ name: 'NotReadableError' }), /em uso/);
  assert.match(K.mensagemErroCamera(new Error('x')), /câmera do aparelho/);
  assert.match(K.mensagemErroCamera(null), /câmera do aparelho/);
});

test('pararStream: para todos os tracks, tolera nulo e track que falha', () => {
  const parados = [];
  const track = (n, quebra) => ({ stop() { if (quebra) throw new Error('ja parado'); parados.push(n); } });
  assert.equal(K.pararStream({ getTracks: () => [track(1), track(2, true), track(3)] }), 2);
  assert.deepEqual(parados, [1, 3]);
  assert.equal(K.pararStream(null), 0);
  assert.equal(K.pararStream({}), 0);
});

test('novaChave: formato aceito pelo servidor (8 a 64 letras, numeros e hifen), diferente a cada foto, com ou sem crypto', () => {
  const ok = /^[A-Za-z0-9-]{8,64}$/;
  const a = K.novaChave({ crypto: { randomUUID: () => '123e4567-e89b-42d3-a456-426614174000' } });
  assert.match(a, ok);
  assert.match(K.novaChave({ crypto: { getRandomValues: v => v.fill(171) } }), ok);
  const sem1 = K.novaChave({}), sem2 = K.novaChave(null);
  assert.match(sem1, ok); assert.match(sem2, ok); assert.notEqual(sem1, sem2);
});

test('hora e erro: HH:MM, data local do detalhe e quando vale tentar de novo', () => {
  const d = new Date(2026, 10, 16, 9, 5, 7);
  assert.equal(K.horaHHMM(d), '09:05');
  assert.equal(K.agoraTexto(d), '2026-11-16 09:05:07');
  assert.equal(K.podeTentarDeNovo(new Error('Sem conexão. Tente de novo.')), true); // sem status = rede
  assert.equal(K.podeTentarDeNovo({ status: 500 }), true);
  assert.equal(K.podeTentarDeNovo({ status: 503 }), true);
  assert.equal(K.podeTentarDeNovo({ status: 429 }), true);
  for (const s of [400, 403, 404, 409, 413]) assert.equal(K.podeTentarDeNovo({ status: s }), false, String(s));
});

test('maquina de estados: caminho feliz, tirar outra, falha com nova tentativa, e eventos fora de hora sao ignorados', () => {
  const m = K.criarMaquina();
  assert.equal(m.estado, 'abrindo');
  assert.equal(m.enviar('enviar'), false); // nao envia sem foto
  assert.equal(m.estado, 'abrindo');
  m.enviar('prontaAoVivo'); assert.equal(m.estado, 'previa');
  m.enviar('capturou'); assert.equal(m.estado, 'capturada');
  m.enviar('outra'); assert.equal(m.estado, 'previa');
  m.enviar('capturou'); m.enviar('enviar'); assert.equal(m.estado, 'enviando');
  assert.equal(m.enviar('enviar'), false); // clique duplo durante o envio
  assert.equal(m.enviar('cancelar'), false); // nao cancela no meio do envio
  m.enviar('erro'); assert.equal(m.estado, 'falhou');
  m.enviar('enviar'); assert.equal(m.estado, 'enviando'); // tentar de novo
  m.enviar('ok'); assert.equal(m.estado, 'registrada');
  m.enviar('outra'); assert.equal(m.estado, 'previa');
  m.enviar('cancelar'); assert.equal(m.estado, 'encerrada');
  assert.equal(m.enviar('capturou'), false);
});

test('maquina de estados: sem camera ao vivo vai para o seletor do aparelho e volta', () => {
  const m = K.criarMaquina();
  m.enviar('sempreCamera'); assert.equal(m.estado, 'semcamera');
  m.enviar('escolheu'); assert.equal(m.estado, 'capturada');
  m.enviar('outraArquivo'); assert.equal(m.estado, 'semcamera');
  m.enviar('ao_vivo'); assert.equal(m.estado, 'abrindo');
  m.enviar('prontaAoVivo'); m.enviar('falhouCamera'); assert.equal(m.estado, 'semcamera');
  m.enviar('escolheu'); m.enviar('enviar'); m.enviar('erro'); m.enviar('descartarArquivo'); assert.equal(m.estado, 'semcamera');
});

// ---------- fluxo de tela com DOM e camera de mentira ----------
function elementoFalso(tag) {
  const e = {
    tag, className: '', hidden: false, disabled: false, textContent: '', children: [], attrs: {}, ouvintes: {}, removido: false, src: undefined, value: '', files: [],
    classList: { _e: null, toggle() {}, add(c) { e.className += ' ' + c; } },
    setAttribute(k, v) { e.attrs[k] = v; }, removeAttribute(k) { if (k === 'src') e.src = undefined; delete e.attrs[k]; },
    append(...f) { f.forEach(x => e.children.push(x)); }, appendChild(x) { e.children.push(x); return x; },
    addEventListener(n, fn) { e.ouvintes[n] = fn; }, remove() { e.removido = true; },
    focus() {}, click() { e.clicado = (e.clicado || 0) + 1; },
    querySelector(sel) { return todos(e).find(x => x.tag === 'button' && !x.disabled) || null; },
    getContext: () => ({ drawImage() {} }), toBlob(cb) { cb({ size: 123456, type: 'image/jpeg' }); },
    play: async () => {}
  };
  Object.defineProperty(e, 'textContent', {
    get() { return e._t ?? ''; }, set(v) { e._t = v; if (v === '') e.children = []; }, configurable: true
  });
  return e;
}
const todos = e => e.children.flatMap(c => [c, ...todos(c)]);
function ambiente({ gum } = {}) {
  const doc = {
    criados: [], body: elementoFalso('body'),
    createElement(t) { const e = elementoFalso(t); doc.criados.push(e); return e; },
    addEventListener() {}, removeEventListener() {}
  };
  const win = {
    document: doc, isSecureContext: true, addEventListener() {}, removeEventListener() {},
    navigator: gum ? { mediaDevices: { getUserMedia: gum } } : {},
    URL: { createObjectURL: () => 'blob:falso', revokeObjectURL() {} }, Image: function () {}, crypto: { randomUUID: (() => { let n = 0; return () => 'uuid-uuid-uuid-' + (++n); })() }
  };
  return { win, doc };
}
const botoes = doc => doc.criados.filter(e => e.tag === 'button' && !e.removido);
const textoBotoes = doc => todos(doc.body).filter(e => e.tag === 'button').map(e => e.textContent);
const pausa = () => new Promise(r => setImmediate(r));
function streamFalso() {
  const s = { parou: 0, getTracks: () => [{ stop() { s.parou++; } }, { stop() { s.parou++; } }] };
  return s;
}
const clicar = (doc, texto) => { const b = todos(doc.body).find(e => e.tag === 'button' && e.textContent === texto); assert.ok(b, 'botao ' + texto + ' em ' + textoBotoes(doc)); b.ouvintes.click(); };

test('fluxo: abre a camera, tira a foto (tracks param), usa, envia com chave e mostra "Registrado as HH:MM"; cancelar/concluir param tudo', async () => {
  const stream = streamFalso();
  const pedidos = [];
  const { win, doc } = ambiente({ gum: async c => { pedidos.push(c); return stream; } });
  const enviados = [], registrados = [];
  let fechadoCom = null;
  const painel = K.capturar(win, {
    titulo: 'Checklist assinado · Pedido 601',
    enviar: async (blob, chave) => { enviados.push({ blob, chave }); return { anexoId: 9, qtdChecklistAssinado: 1 }; },
    aoRegistrar: r => registrados.push(r), aoFechar: q => { fechadoCom = q; }
  });
  await pausa(); await pausa();
  assert.equal(pedidos.length, 1);
  assert.deepEqual(pedidos[0].video.facingMode, { ideal: 'environment' });
  assert.equal(painel.estado, 'previa');
  assert.ok(textoBotoes(doc).includes('Tirar foto'));
  const video = doc.criados.find(e => e.tag === 'video');
  video.videoWidth = 1920; video.videoHeight = 1080;
  clicar(doc, 'Tirar foto');
  await pausa(); await pausa();
  assert.equal(stream.parou, 2, 'a camera apaga ao tirar a foto');
  assert.equal(painel.estado, 'capturada');
  assert.deepEqual(textoBotoes(doc).filter(Boolean), ['Cancelar', 'Usar esta foto', 'Tirar outra']);
  clicar(doc, 'Usar esta foto');
  await pausa(); await pausa();
  assert.equal(painel.estado, 'registrada');
  assert.equal(enviados.length, 1);
  assert.match(enviados[0].chave, /^[A-Za-z0-9-]{8,64}$/);
  assert.deepEqual(registrados, [{ anexoId: 9, qtdChecklistAssinado: 1 }]);
  const msg = doc.criados.find(e => e.className.startsWith('cc-msg'));
  assert.match(msg.textContent, /^Registrado às \d\d:\d\d\. 1 foto enviada agora\.$/);
  clicar(doc, 'Concluir');
  assert.equal(painel.estado, 'encerrada');
  assert.equal(fechadoCom, 1);
  assert.equal(doc.criados.find(e => e.className === 'cc-fundo').removido, true);
});

test('fluxo: falha de rede mantem a foto e reenvia com a MESMA chave; recusa definitiva do servidor so oferece descartar', async () => {
  const stream = streamFalso();
  const { win, doc } = ambiente({ gum: async () => stream });
  const chaves = [];
  let tentativa = 0;
  const painel = K.capturar(win, {
    enviar: async (blob, chave) => {
      chaves.push(chave); tentativa++;
      if (tentativa === 1) throw new Error('Sem conexão. Tente de novo.');
      if (tentativa === 3) { const e = new Error('Esta entrega já tem 6 fotos do checklist assinado.'); e.status = 409; throw e; }
      return { anexoId: tentativa, qtdChecklistAssinado: tentativa };
    }
  });
  await pausa(); await pausa();
  const video = doc.criados.find(e => e.tag === 'video'); video.videoWidth = 1000; video.videoHeight = 700;
  clicar(doc, 'Tirar foto'); await pausa(); await pausa();
  clicar(doc, 'Usar esta foto'); await pausa(); await pausa();
  assert.equal(painel.estado, 'falhou');
  assert.ok(textoBotoes(doc).includes('Tentar enviar de novo'));
  const msg = doc.criados.find(e => e.className.startsWith('cc-msg'));
  assert.match(msg.textContent, /não se perdeu/);
  clicar(doc, 'Tentar enviar de novo'); await pausa(); await pausa();
  assert.equal(painel.estado, 'registrada');
  assert.equal(chaves[0], chaves[1], 'mesma chave: o servidor nao duplica');
  // outra foto -> chave nova; 409 nao oferece "tentar de novo"
  doc.criados.find(e => e.tag === 'video').videoWidth = 1000;
  clicar(doc, 'Tirar outra foto'); await pausa(); await pausa();
  assert.equal(painel.estado, 'previa');
  clicar(doc, 'Tirar foto'); await pausa(); await pausa();
  clicar(doc, 'Usar esta foto'); await pausa(); await pausa();
  assert.notEqual(chaves[2], chaves[0]);
  assert.equal(painel.estado, 'falhou');
  assert.ok(!textoBotoes(doc).includes('Tentar enviar de novo'));
  assert.ok(textoBotoes(doc).includes('Descartar e tirar outra'));
  painel.fechar();
  assert.equal(painel.estado, 'encerrada');
});

test('fluxo: cancelar na previa e cancelar enquanto o aparelho ainda pede permissao tambem param os tracks', async () => {
  const s1 = streamFalso();
  const a = ambiente({ gum: async () => s1 });
  const p1 = K.capturar(a.win, { enviar: async () => ({}) });
  await pausa(); await pausa();
  p1.fechar();
  assert.equal(s1.parou, 2);
  // fecha antes de a permissao ser concedida: o stream que chega depois e parado na hora
  const s2 = streamFalso();
  let liberar;
  const b = ambiente({ gum: () => new Promise(r => { liberar = () => r(s2); }) });
  const p2 = K.capturar(b.win, { enviar: async () => ({}) });
  p2.fechar();
  liberar(); await pausa(); await pausa();
  assert.equal(s2.parou, 2);
});

test('fluxo: permissao negada cai para o seletor do aparelho (input capture=environment) com a explicacao', async () => {
  const { win, doc } = ambiente({ gum: async () => { const e = new Error('x'); e.name = 'NotAllowedError'; throw e; } });
  const painel = K.capturar(win, { enviar: async () => ({}) });
  await pausa(); await pausa();
  assert.equal(painel.estado, 'semcamera');
  const msg = doc.criados.find(e => e.className.startsWith('cc-msg'));
  assert.match(msg.textContent, /negado/);
  assert.ok(textoBotoes(doc).includes('Abrir a câmera do aparelho'));
  const input = doc.criados.find(e => e.tag === 'input');
  assert.equal(input.attrs.capture, 'environment');
  assert.equal(input.accept, 'image/*');
  clicar(doc, 'Abrir a câmera do aparelho');
  assert.equal(input.clicado, 1);
  painel.fechar();
});

test('fluxo: sem getUserMedia (http ou navegador antigo) abre o seletor do aparelho no mesmo clique', async () => {
  const { win, doc } = ambiente({});
  const painel = K.capturar(win, { enviar: async () => ({}) });
  assert.equal(painel.estado, 'semcamera');
  const input = doc.criados.find(e => e.tag === 'input');
  assert.equal(input.clicado, 1, 'o clique do usuario ainda vale como gesto');
  assert.match(doc.criados.find(e => e.className.startsWith('cc-msg')).textContent, /https/);
  painel.fechar();
});

test('paginas: CSP ja cobre blob: e a camera; modulo carregado antes dos scripts das telas; sem geolocalizacao', () => {
  for (const f of ['entregas.html', 'minhas_entregas.html']) {
    const h = ler(f);
    const csp = /Content-Security-Policy" content="([^"]+)"/.exec(h)[1];
    assert.match(csp, /img-src [^;]*blob:/); // miniatura/prévia da foto
    assert.doesNotMatch(csp, /media-src/); // MediaStream em srcObject nao passa por media-src
    assert.doesNotMatch(h, /Permissions-Policy/); // nenhuma politica bloqueando camera nas paginas
    assert.match(h, /camera_captura\.css\?v=\d+/);
  }
  const js = ler('camera_captura.js');
  assert.doesNotMatch(js, /geolocation|getCurrentPosition/);
  assert.match(js, /playsinline/); assert.match(js, /muted/);
  const idx = ler('index.js');
  assert.doesNotMatch(idx, /Permissions-Policy|permissionsPolicy/); // a API nao serve as paginas; nada a ajustar no helmet
});
