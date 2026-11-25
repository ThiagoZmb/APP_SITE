// Alarmes na tela: alarmes.js (janela em qualquer tela) e o sino das duas semanas (tarefas.js, tarefas_admin.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const L = require('../alarmes.js');
const T = require('../tarefas.js');
const A = require('../tarefas_admin.js');

const ler = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const alarme = (id, quando, extra = {}) => ({ origem: 'pessoal', id, texto: 't' + id, alarme: quando, quando, ...extra });
const tique = () => new Promise(r => setImmediate(r));

// controle com relógio, servidor e janela falsos
function montar({ lista = [], agora = new Date(2026, 10, 25, 14, 30) } = {}) {
  const estado = { lista, agora, falhar: null, retido: false, quem: 'token-1', janela: null, chamadas: [], eventos: [], timers: [], outras: 0 };
  const chamar = async (caminho, { metodo = 'GET', corpo } = {}) => {
    estado.chamadas.push([metodo, caminho, corpo]);
    if (estado.falhar) { const e = new Error('x'); e.status = estado.falhar; throw e; }
    if (metodo === 'GET') return { alarmes: estado.lista.map(a => ({ ...a })) };
    return { ok: true };
  };
  const controle = L.criarControle({
    chamar,
    agora: () => estado.agora,
    retido: () => estado.retido,
    quem: () => estado.quem,
    mostrar: a => { assert.equal(estado.janela, null, 'uma janela por vez'); estado.janela = a; estado.eventos.push('abre ' + a.origem + a.id); },
    fechar: () => { estado.eventos.push('fecha ' + estado.janela.origem + estado.janela.id); estado.janela = null; },
    avisarOutras: () => { estado.outras++; },
    agendar: (fn, ms) => { estado.timers.push({ fn, ms }); return estado.timers.length; },
    cancelar: () => {}
  });
  return { estado, controle };
}

test('vencido = quando <= agora no relógio do aparelho; o mais antigo primeiro', () => {
  const lista = [alarme(1, '2026-11-25 14:31'), alarme(2, '2026-11-25 14:30'), alarme(3, '2026-11-24 23:59'), alarme(4, '2026-12-01 08:00')];
  assert.deepEqual(L.vencidos(lista, new Date(2026, 10, 25, 14, 30, 59)).map(a => a.id), [3, 2]);
  assert.deepEqual(L.vencidos(lista, new Date(2026, 10, 24, 0, 0)).map(a => a.id), []);
  assert.doesNotMatch(ler('alarmes.js'), /toISOString|innerHTML|insertAdjacentHTML|outerHTML/);
});

test('"Adiar 10 minutos" = agora + 10 min, cruzando a meia-noite, o mês e o ano', async () => {
  assert.equal(L.maisMinutos(new Date(2026, 10, 25, 23, 55), 10), '2026-11-26 00:05');
  assert.equal(L.maisMinutos(new Date(2026, 11, 31, 23, 50), 10), '2027-01-01 00:00');
  const { estado, controle } = montar({ lista: [alarme(7, '2026-11-25 08:00', { origem: 'admin' })], agora: new Date(2026, 10, 25, 23, 55) });
  await controle.consultar();
  await controle.responder('adiar');
  assert.deepEqual(estado.chamadas.filter(c => c[0] === 'POST'), [['POST', '/alarmes/admin/7/adiar', { alarme: '2026-11-25 08:00', ate: '2026-11-26 00:05' }]]);
});

test('vários vencidos juntos: uma janela por vez; OK passa para o próximo e avisa as outras abas', async () => {
  const { estado, controle } = montar({ lista: [alarme(2, '2026-11-25 10:00'), alarme(1, '2026-11-25 09:00')] });
  await controle.consultar();
  await controle.consultar();
  assert.deepEqual(estado.eventos, ['abre pessoal1']);
  const p = controle.responder('ok');
  estado.lista = [alarme(2, '2026-11-25 10:00')];
  await p;
  assert.deepEqual(estado.eventos, ['abre pessoal1', 'fecha pessoal1', 'abre pessoal2']);
  assert.deepEqual(estado.chamadas.find(c => c[0] === 'POST'), ['POST', '/alarmes/pessoal/1/ok', { alarme: '2026-11-25 09:00' }]);
  assert.equal(estado.outras, 1);
});

test('respondido em outra aba (ou apagado, concluído): a janela fecha na consulta seguinte e não reaparece', async () => {
  const { estado, controle } = montar({ lista: [alarme(1, '2026-11-25 09:00')] });
  await controle.consultar();
  estado.lista = [];
  await controle.consultar();
  await controle.consultar();
  assert.deepEqual(estado.eventos, ['abre pessoal1', 'fecha pessoal1']);
});

test('alarme trocado depois do OK volta a aparecer; o mesmo ainda na resposta não reaparece', async () => {
  const { estado, controle } = montar({ lista: [alarme(1, '2026-11-25 09:00')] });
  await controle.consultar();
  await controle.responder('ok');   // o servidor falso continua devolvendo: resposta atrasada
  await controle.consultar();
  assert.equal(estado.janela, null);
  estado.lista = [alarme(1, '2026-11-25 14:00')];
  await controle.consultar();
  assert.equal(estado.janela.alarme, '2026-11-25 14:00');
});

test('modo atendimento retém o aviso; desligado, aparece', async () => {
  const { estado, controle } = montar({ lista: [alarme(1, '2026-11-25 09:00')] });
  estado.retido = true;
  await controle.consultar();
  assert.deepEqual(estado.eventos, []);
  estado.retido = false;
  await controle.consultar();
  assert.deepEqual(estado.eventos, ['abre pessoal1']);
  estado.retido = true;
  await controle.consultar();
  assert.deepEqual(estado.eventos.at(-1), 'fecha pessoal1');
});

test('o que ainda não venceu é agendado pelo relógio do aparelho e dispara sem nova consulta', async () => {
  const { estado, controle } = montar({ lista: [alarme(1, '2026-11-25 14:30')], agora: new Date(2026, 10, 25, 14, 29, 30) });
  await controle.consultar();
  assert.equal(estado.janela, null);
  const t = estado.timers.at(-1);
  assert.ok(t.ms >= 30000 && t.ms <= 31000, String(t.ms));
  estado.agora = new Date(2026, 10, 25, 14, 30, 0);
  t.fn();
  assert.equal(estado.janela.id, 1);
  assert.equal(estado.chamadas.length, 1);
});

test('erro na consulta (401, sem rede, 500) é ignorado: nada lança, nada redireciona', async () => {
  const { estado, controle } = montar({ lista: [alarme(1, '2026-11-25 14:40')] });
  await controle.consultar();
  for (const s of [401, 500, undefined]) { estado.falhar = s || 0; if (s) await controle.consultar(); }
  estado.falhar = 401;
  await assert.doesNotReject(controle.consultar());
  estado.agora = new Date(2026, 10, 25, 14, 41);
  await assert.doesNotReject(controle.consultar());
  assert.equal(estado.janela.id, 1, 'o que já tinha sido lido continua valendo');
  assert.doesNotMatch(ler('alarmes.js'), /location\.(href|assign|replace|reload)|location =|removeItem\('auth'\)|LOGIN_URL/);
  let ligou = 0;
  L.iniciar({ location: { pathname: '/APP_SITE/login.html' }, document: { readyState: 'loading', addEventListener: () => { ligou++; } } });
  assert.equal(ligou, 0, 'na tela de login não há aviso');
});

test('OK que falha: a janela fecha e volta na próxima consulta', async () => {
  const { estado, controle } = montar({ lista: [alarme(1, '2026-11-25 09:00')] });
  await controle.consultar();
  estado.falhar = 500;
  await controle.responder('ok');
  assert.equal(estado.janela, null);
  estado.falhar = null;
  await controle.consultar();
  assert.equal(estado.janela.id, 1);
});

test('sair ou entrar outro usuário no navegador: a janela do anterior fecha', async () => {
  const { estado, controle } = montar({ lista: [alarme(1, '2026-11-25 09:00')] });
  await controle.consultar();
  estado.quem = null;
  await controle.consultar();
  assert.deepEqual(estado.eventos, ['abre pessoal1', 'fecha pessoal1']);
  assert.equal(estado.chamadas.length, 1, 'sem login não consulta');
});

test('layout.js carrega alarmes.js e não mostra indicador nas consultas automáticas', () => {
  const fonte = ler('layout.js');
  assert.match(fonte, /new URL\("alarmes\.js"/);
  const linha = fonte.split(/\r?\n/).find(l => l.trim().startsWith('const SEGUNDO_PLANO ='));
  const re = vm.runInNewContext(linha.trim().replace(/^const SEGUNDO_PLANO =\s*/, '').replace(/;\s*$/, ''));
  for (const u of ['https://x/alarmes', 'https://x/semana_admin?inicio=2026-11-23&auto=1']) assert.ok(re.test(u), u);
  for (const u of ['https://x/semana_admin?inicio=2026-11-23', 'https://x/semana_admin', 'https://x/alarmes/pessoal/1/ok']) assert.ok(!re.test(u), u);
});

// ---------- o sino nas linhas ----------
function apiFalsa(rota) {
  const chamadas = [];
  const estado = { falhar: 0 };
  let id = 0;
  async function chamar(caminho, { metodo = 'GET', corpo } = {}) {
    chamadas.push([metodo, caminho.replace(rota, ''), corpo]);
    if (estado.falhar > 0) { estado.falhar--; throw new Error('Sem conexão.'); }
    if (metodo === 'POST') return { id: ++id, ...corpo, feita: false, alarme: null, versao: 1, criadaPor: 'Ana', feitaPor: null };
    return { ok: true, ...(rota === '/semana_admin' && metodo === 'PUT' ? { ...corpo, versao: corpo.versao + 1 } : {}) };
  }
  return { chamar, chamadas, estado };
}
function armazem() {
  const m = new Map();
  return { m, getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
}
const QUANDO = '2026-11-25 14:30';

for (const [nome, lib, rota, versao] of [['pessoal', T, '/minha_semana', () => ({})], ['compartilhada', A, '/semana_admin', v => ({ versao: v })]]) {
  const dados = { quadro: 'tarefas', data: null, texto: '', feita: false };
  test(`${nome}: linha nova salva o texto antes do alarme, pela mesma fila; remover; apagar o texto leva o alarme`, async () => {
    const api = apiFalsa(rota);
    const l = lib.criarLinha(api.chamar, dados);
    const a = l.salvarTexto('ligar');
    const b = l.alarmar(QUANDO);
    await Promise.all([a, b]);
    assert.deepEqual(api.chamadas, [['POST', '', { quadro: 'tarefas', data: null, texto: 'ligar' }], ['PUT', '/1', { alarme: QUANDO, ...versao(1) }]]);
    assert.deepEqual([l.alarme, l.dados.alarme, l.pendente()], [QUANDO, QUANDO, false]);
    await l.alarmar(null);
    assert.deepEqual(api.chamadas.at(-1), ['PUT', '/1', { alarme: null, ...versao(2) }]);
    await l.alarmar(QUANDO);
    await l.salvarTexto('');
    assert.equal(api.chamadas.at(-1)[0], 'DELETE');
    assert.deepEqual([l.alarme, l.dados.alarme], [null, null]);
    await l.salvarTexto('outra');
    assert.equal(api.chamadas.at(-1)[0], 'POST', 'o alarme antigo não passa para a próxima');
  });

  test(`${nome}: alarme que falhou fica no rascunho e volta`, async () => {
    const api = apiFalsa(rota), r = lib.criarRascunhos(() => armazem(), 7);
    const st = armazem(), rascunhos = lib.criarRascunhos(() => st, 7);
    const l = lib.criarLinha(api.chamar, dados, { rascunhos, chave: 'k' });
    await l.salvarTexto('ligar');
    api.estado.falhar = 1;
    await l.alarmar(QUANDO);
    assert.equal(l.erro, true);
    assert.equal(rascunhos.ler().k.alarme, QUANDO);
    const servidor = [{ id: 1, quadro: 'tarefas', data: null, texto: 'ligar', feita: false, alarme: null, versao: 1, criadaPor: 'Ana' }];
    const [c] = lib.casarRascunhos(rascunhos.ler(), servidor, '2026-11-23', 'Ana');
    assert.equal(c.descartar, false);
    const depois = apiFalsa(rota);
    const x = lib.retomar(depois.chamar, c, rascunhos);
    await x.pronto;
    await tique();
    assert.deepEqual(depois.chamadas, [['PUT', '/1', { alarme: QUANDO, ...versao(1) }]]);
    assert.deepEqual(rascunhos.ler(), {});
  });
}

test('sino: só nos dias e em Tarefas, nas duas telas; hora mostrada como 25/11 14:30; sugestão de data', () => {
  assert.equal(T.horaCurta(QUANDO), '25/11 14:30');
  assert.equal(A.horaCurta(QUANDO), '25/11 14:30');
  const agora = new Date(2026, 10, 25, 14, 10);
  for (const lib of [T, A]) {
    assert.equal(lib.sugestaoDeAlarme('2026-11-27', agora), '2026-11-27 09:00');
    assert.equal(lib.sugestaoDeAlarme('2026-11-25', agora), '2026-11-25 15:00');
    assert.equal(lib.sugestaoDeAlarme(null, agora), '2026-11-25 15:00');
    assert.equal(lib.sugestaoDeAlarme('2026-11-23', new Date(2026, 10, 25, 23, 10)), '2026-11-26 00:00', 'dia passado: próxima hora cheia');
  }
  for (const f of ['tarefas.js', 'tarefas_admin.js']) {
    const js = ler(f);
    assert.match(js, /q\.quadro !== 'notas'\) item\.sino/);
    assert.match(js, /datetime-local/);
    assert.match(js, /alarmes-mudou/);
    assert.match(js, /'Remover'/);
  }
});

// ---------- com o alarme aberto, o teclado não chega à tela de baixo ----------
function teclado({ aberta = true } = {}) {
  const ouvintes = [];
  const win = { addEventListener: (tipo, fn, captura) => ouvintes.push({ tipo, fn, captura }) };
  const botao = { closest: () => janela };
  const janela = { open: aberta };
  L.blindarTeclado(win, () => janela);
  const apertar = (key, extra = {}) => {
    const ev = { key, target: botao, parou: false, impedido: false, stopImmediatePropagation() { this.parou = true; }, preventDefault() { this.impedido = true; }, ...extra };
    ouvintes[0].fn(ev);
    return [ev.parou, ev.impedido];
  };
  return { ouvintes, apertar, janela };
}

test('alarme aberto: nenhuma tecla chega aos modais da tela (window em captura vem antes de document); Tab, Enter e Espaço seguem valendo', () => {
  const { ouvintes, apertar } = teclado();
  assert.deepEqual(ouvintes.map(o => [o.tipo, o.captura]), [['keydown', true]]);
  assert.deepEqual(apertar('Escape'), [true, true], 'Esc não fecha o alarme nem o modal de baixo');
  for (const k of ['Tab', 'Enter', ' ', 'a']) assert.deepEqual(apertar(k), [true, false], 'a ação do navegador continua: ' + k);
  assert.deepEqual(apertar('F5'), [true, true], 'F5 não recarrega a tela, que perderia o que estava digitado');
  assert.deepEqual(apertar('F5', { ctrlKey: true }), [true, false]);
});

test('sem alarme aberto, ou com outra janela por cima dele, o teclado segue normal', () => {
  assert.deepEqual(teclado({ aberta: false }).apertar('Escape'), [false, false]);
  const { apertar } = teclado();
  assert.deepEqual(apertar('Escape', { target: { closest: () => ({ open: true }) } }), [false, false]);
  assert.deepEqual(apertar('Escape', { target: { closest: () => null } }), [true, true], 'foco no body');
});

test('ligar e desligar o modo atendimento esconde e mostra o aviso na hora', () => {
  assert.match(ler('layout.js'), /alternar: \(\) => \{[^}]*atendimento-mudou/);
  assert.match(ler('alarmes.js'), /addEventListener\('atendimento-mudou', \(\) => controle\.avaliar\(\)\)/);
});
