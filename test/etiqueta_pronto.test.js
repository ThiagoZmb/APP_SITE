// Pergunta "imprimir as etiquetas?" depois que um pedido passa a Pronto (etiqueta_zebra.js) e as telas que a chamam.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const L = require('../calendario_lote.js');
const ler = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');

// ---------- função compartilhada ----------
// `abertas` = números cuja janela foi pedida (GET /itens). A API responde 404 nos itens, então cada "janela" termina com um alerta e sem DOM.
function carregar({ confirmar = () => true, servico = true, pode } = {}) {
  const perguntas = [], abertas = [], avisos = [];
  const janela = { Acesso: { pode: () => true } };
  vm.runInNewContext(ler('etiqueta_zebra.js'), { window: janela, AbortController, setTimeout, clearTimeout, location: {}, localStorage: { removeItem() {} },
    alert: m => avisos.push(m), confirm: t => { perguntas.push(t); return confirmar(t, perguntas.length); },
    fetch: async url => {
      if (url.endsWith('/ping')) { if (!servico) throw new Error('recusado'); return { ok: true, status: 200 }; }
      abertas.push(/pedido\/(\d+)\/itens/.exec(url)[1]);
      return { ok: false, status: 404, json: async () => ({ error: 'sem itens' }) };
    } });
  const cfg = { apiBase: 'https://api', loginUrl: 'login.html', token: () => 'tk', ...(pode ? { pode } : {}) };
  return { perguntas, abertas, avisos, perguntar: n => janela.EtiquetaZebra.perguntarDepoisDePronto(n, cfg) };
}

test('um pedido: pergunta com o número; Sim abre o fluxo de etiquetas dele', async () => {
  const t = carregar();
  await t.perguntar('123');
  assert.deepEqual(t.perguntas, ['Pedido 123 marcado como Pronto. Imprimir as etiquetas agora?']);
  assert.deepEqual(t.abertas, ['123']);
});

test('Não: nada acontece', async () => {
  const t = carregar({ confirmar: () => false });
  await t.perguntar(123);
  assert.equal(t.perguntas.length, 1);
  assert.deepEqual(t.abertas, []);
});

test('sem pedidos.pdf (ou sem pedido) não pergunta; sem cfg.pode usa window.Acesso', async () => {
  const sem = carregar({ pode: p => p !== 'pedidos.pdf' });
  await sem.perguntar('1');
  assert.deepEqual(sem.perguntas, []);
  const vazio = carregar();
  await vazio.perguntar([]);
  assert.deepEqual(vazio.perguntas, []);
  const acesso = carregar();
  await acesso.perguntar('5');
  assert.deepEqual(acesso.abertas, ['5']);
});

test('lote: UMA pergunta com os números; depois um pedido por vez, confirmando antes do próximo', async () => {
  const t = carregar();
  await t.perguntar(['10', '11', '12']);
  assert.equal(t.perguntas[0], 'Pedidos 10, 11, 12 marcados como Pronto. Imprimir as etiquetas agora?');
  assert.match(t.perguntas[1], /pedido 11 \(2 de 3\)/);
  assert.match(t.perguntas[2], /pedido 12 \(3 de 3\)/);
  assert.equal(t.perguntas.length, 3);
  assert.deepEqual(t.abertas, ['10', '11', '12']);
});

test('lote: dá para parar no meio', async () => {
  const t = carregar({ confirmar: (_, n) => n < 2 });
  await t.perguntar(['10', '11', '12']);
  assert.deepEqual(t.abertas, ['10']);
  assert.equal(t.perguntas.length, 2);
});

test('lote sem o serviço local: avisa uma vez e não insiste nos outros', async () => {
  const t = carregar({ servico: false });
  await t.perguntar(['10', '11']);
  assert.equal(t.perguntas.length, 1);
  assert.equal(t.avisos.length, 1);
});

test('duas chamadas seguidas esperam uma pela outra (nunca duas janelas juntas)', async () => {
  const t = carregar();
  await Promise.all([t.perguntar('1'), t.perguntar('2')]);
  assert.deepEqual(t.abertas, ['1', '2']);
});

test('numerosAlterados: só os que deram certo; sessão expirada = nenhum', () => {
  assert.deepEqual(L.numerosAlterados([1, 2, 3], { numerosFalha: ['2'], falhas: [{ numero: '2', erro: 'x' }] }), ['1', '3']);
  assert.deepEqual(L.numerosAlterados([1, 2], { numerosFalha: ['2'], falhas: [{ numero: '2', erro: 'Sessão expirada' }] }), []);
});

// ---------- menu do botão direito (inicio_menu.js: Início, calendário mês e dia) ----------
function menuInicio({ status = 200, confirmar = true } = {}) {
  const log = [];
  const window = { addEventListener() {}, EscolhaDataEntrega: { perguntar: async () => 'hoje' },
    EtiquetaZebra: { perguntarDepoisDePronto: async (n, cfg) => { log.push(['etiquetas', n, typeof cfg.pode, cfg.apiBase]); } } };
  vm.runInNewContext(ler('inicio_menu.js'), { window, document: { addEventListener() {} }, confirm: () => confirmar, alert: m => log.push(['alerta', m]),
    encodeURIComponent, fetch: async () => ({ ok: status < 400, status, json: async () => ({ error: 'falhou' }) }), localStorage: {}, location: {} });
  const m = window.InicioMenu.iniciar({ apiBase: 'https://api', loginUrl: 'login', token: () => 't', docDe: () => null, esc: s => s,
    pode: () => true, recarregar: async () => { log.push(['recarregar']); } });
  const mudar = nome => m.itensDoMenu({ numero: 7, cliente: 'X', situacao: 'Em Produção' }).find(i => i.rotulo === nome).fn();
  return { log, mudar };
}

test('menu: Pronto com sucesso recarrega e depois pergunta', async () => {
  const t = menuInicio();
  await t.mudar('Pronto');
  assert.deepEqual(t.log.map(x => x[0]), ['recarregar', 'etiquetas']);
  assert.deepEqual(t.log[1], ['etiquetas', 7, 'function', 'https://api']);
});

test('menu: falha, cancelamento ou outra situação não perguntam', async () => {
  for (const [opcoes, nome] of [[{ status: 500 }, 'Pronto'], [{ confirmar: false }, 'Pronto'], [{}, 'Entregue']]) {
    const t = menuInicio(opcoes);
    await t.mudar(nome);
    assert.ok(!t.log.some(x => x[0] === 'etiquetas'), nome + JSON.stringify(opcoes));
  }
});

// ---------- menu da lista de Pedidos (painel_inicial.html) ----------
function menuPainel({ falha = false, confirmar = true } = {}) {
  const h = ler('painel_inicial.html');
  const ini = h.indexOf('async function mudarSituacao(numero, nome)'), fim = h.indexOf('// Imprimir sem sair da tela', ini);
  const log = [];
  const ctx = { docDe: () => ({ cliente: 'X' }), confirm: () => confirmar, alert: m => log.push(['alerta', m]), encodeURIComponent,
    window: { EscolhaDataEntrega: { perguntar: async () => 'hoje' }, EtiquetaZebra: { perguntarDepoisDePronto: async n => { log.push(['etiquetas', n]); } } },
    api: async () => { if (falha) throw new Error('x'); }, carregar: async () => { log.push(['recarregar']); },
    API_BASE: 'https://api', LOGIN_URL: 'login', getToken: () => 't', Acesso: { pode: () => true } };
  vm.runInNewContext(h.slice(ini, fim) + '\nthis.mudarSituacao = mudarSituacao;', ctx);
  return { log, mudar: nome => ctx.mudarSituacao('9', nome) };
}

test('lista de Pedidos: Pronto com sucesso pergunta depois de recarregar; falha, cancelamento e outra situação não', async () => {
  const ok = menuPainel();
  await ok.mudar('Pronto');
  assert.deepEqual(ok.log, [['recarregar'], ['etiquetas', '9']]);
  for (const [o, nome] of [[{ falha: true }, 'Pronto'], [{ confirmar: false }, 'Pronto'], [{}, 'Retirado']]) {
    const t = menuPainel(o);
    await t.mudar(nome);
    assert.ok(!t.log.some(x => x[0] === 'etiquetas'), nome);
  }
});

// ---------- lote do calendário, etapas e entregas (ligações) ----------
test('lote do calendário, lote da lista, etapas e baixa com marcarPronto chamam a pergunta só depois do sucesso', () => {
  const cal = ler('calendario.js');
  assert.match(cal, /const r = await executarAcao\(/);
  assert.match(cal, /nome === 'Pronto'[^\n]*perguntarDepoisDePronto\(L\.numerosAlterados\(numeros, r\)/);
  assert.match(ler('painel_inicial.html'), /aoPronto: [^\n]*perguntarDepoisDePronto/);
  const etapas = ler('etapas_producao.js');
  assert.match(etapas, /ficouPronto = !!d\.situacaoMudou && d\.situacao === 'Pronto'/);
  assert.match(etapas, /if \(ficouPronto[^\n]*perguntarDepoisDePronto\(p\.numero/);
  const entregas = ler('entregas.js');
  assert.match(entregas, /marcarPronto: true \} \}\);\n\s+marcouPronto = true;/);
  assert.match(entregas, /if \(marcouPronto[^\n]*perguntarDepoisDePronto\(e\.numero/);
});

test('todas as páginas que marcam Pronto carregam etiqueta_zebra.js (?v= novo) e a CSP libera o serviço local', () => {
  for (const f of ['inicio.html', 'painel_inicial.html', 'calendario.html', 'calendario_dia.html', 'etapas_producao.html', 'entregas.html']) {
    const h = ler(f);
    assert.match(h, /etiqueta_zebra\.js\?v=202612021000/, f);
    const csp = /Content-Security-Policy" content="([^"]+)"/.exec(h)[1];
    assert.match(csp, /connect-src[^;]*http:\/\/127\.0\.0\.1:3917/, f);
    assert.doesNotMatch(csp, /upgrade-insecure-requests/, f);
  }
});
