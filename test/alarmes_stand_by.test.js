// Alarmes EM STAND BY (window.ALARMES_ATIVOS = false em layout.js): nada de alarme na tela, nada enviado, alarme gravado intacto.
// Aqui globalThis.ALARMES_ATIVOS fica sem definir (desligado); os testes do estado ligado estão em alarmes_tela.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const T = require('../tarefas.js');
const A = require('../tarefas_admin.js');

const ler = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const QUANDO = '2026-11-25 14:30';

// layout.js até o fim da carga dos scripts auxiliares: o que ele põe no <head> e o que expõe em window
function carregarLayout(fonte) {
  const scripts = [];
  const document = { createElement: () => ({}), head: { appendChild: s => scripts.push(String(s.src)) }, currentScript: { src: 'https://x/APP_SITE/layout.js?v=1' } };
  const window = {};
  const trecho = fonte.slice(0, fonte.indexOf('const LOGIN_URL')) + '\n})();';
  vm.runInNewContext(trecho, { window, document, location: { href: 'https://x/APP_SITE/a.html' }, URL });
  return { window, scripts };
}

test('layout.js: chave única desligada; alarmes.js não é carregado (religada, volta a carregar)', () => {
  const fonte = ler('layout.js');
  assert.equal(fonte.match(/const ALARMES_ATIVOS = (true|false);/g).join(), 'const ALARMES_ATIVOS = false;');
  const desligado = carregarLayout(fonte);
  assert.equal(desligado.window.ALARMES_ATIVOS, false);
  assert.deepEqual(desligado.scripts.filter(s => /alarmes\.js/.test(s)), []);
  const ligado = carregarLayout(fonte.replace('const ALARMES_ATIVOS = false;', 'const ALARMES_ATIVOS = true;'));
  assert.equal(ligado.window.ALARMES_ATIVOS, true);
  assert.deepEqual(ligado.scripts.filter(s => /alarmes\.js/.test(s)), ['https://x/APP_SITE/alarmes.js?v=1']);
});

test('as duas telas: sem sino (e, com ele, sem horário nem editor)', () => {
  for (const f of ['tarefas.js', 'tarefas_admin.js'])
    assert.match(ler(f), /if \(alarmesAtivos\(\) && q\.quadro !== 'notas'\) item\.sino = criarSino\(item\);/, f);
});

// servidor falso: uma linha com alarme gravado; só muda o que vier no corpo, como as rotas
function servidor() {
  const linha = { id: 1, quadro: 'tarefas', data: null, texto: 'ligar', feita: false, alarme: QUANDO, versao: 1, criadaPor: 'Ana', feitaPor: null };
  const chamadas = [];
  const estado = { apagada: false };
  let id = 1;
  const erro = (status, dados) => { const e = new Error('x'); e.status = status; e.dados = dados; return e; };
  async function chamar(caminho, { metodo = 'GET', corpo } = {}) {
    chamadas.push([metodo, corpo]);
    if (metodo === 'POST') return { id: ++id, ...corpo, feita: false, alarme: null, versao: 1, criadaPor: 'Ana', feitaPor: null };
    if (estado.apagada && caminho.endsWith('/1')) throw erro(404);
    const { versao, ...mudanca } = corpo;
    const compartilhada = caminho.startsWith('/semana_admin');
    if (compartilhada && caminho.endsWith('/1') && versao !== linha.versao) throw erro(409, { atual: { ...linha } });
    if (caminho.endsWith('/1')) Object.assign(linha, mudanca, { versao: linha.versao + 1 });
    return compartilhada ? { ...linha } : { ok: true };
  }
  const semAlarme = () => assert.deepEqual(chamadas.filter(c => c[1] && 'alarme' in c[1]), [], 'o campo alarme nunca é enviado');
  return { linha, chamadas, chamar, estado, semAlarme };
}
function armazem() {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
}

for (const [nome, lib] of [['pessoal', T], ['compartilhada', A]]) {
  test(`${nome}: editar e marcar uma linha com alarme gravado não envia nem altera o alarme`, async () => {
    const s = servidor();
    const l = lib.criarLinha(s.chamar, { ...s.linha });
    assert.equal(l.alarme, null);
    await l.salvarTexto('ligar cedo');
    await l.marcar(true);
    await l.alarmar(null);
    await l.alarmar('2027-01-01 08:00');
    s.semAlarme();
    assert.equal(s.linha.alarme, QUANDO);
    assert.deepEqual([l.alarme, l.pendente()], [null, false]);
  });

  test(`${nome}: rascunho com mudança de alarme, gravado quando estava ligado, não mexe no alarme`, async () => {
    for (const alarme of [null, '2027-01-01 08:00']) {
      const s = servidor();
      const rascunhos = lib.criarRascunhos(() => armazem(), 7);
      const entrada = { id: 1, quadro: 'tarefas', data: null, texto: 'novo texto', feita: false, alarme, versao: 1, base: { texto: 'ligar', feita: false, alarme: QUANDO } };
      const [c] = lib.casarRascunhos({ k: entrada }, [{ ...s.linha }], '2026-11-23', 'Ana');
      const x = lib.retomar(s.chamar, c, rascunhos);
      await x.pronto;
      s.semAlarme();
      assert.deepEqual([s.linha.texto, s.linha.alarme, x.linha.erro, x.linha.pendente()], ['novo texto', QUANDO, false, false]);
    }
  });
}

test('compartilhada: rascunho em que só o alarme mudou é descartado, sem gravar nada', () => {
  const entrada = { id: 1, quadro: 'tarefas', data: null, texto: 'ligar', feita: false, alarme: null, versao: 1, base: { texto: 'ligar', feita: false, alarme: QUANDO } };
  assert.equal(A.casarRascunhos({ k: entrada }, [servidor().linha], '2026-11-23', 'Ana')[0].descartar, true);
});

test('compartilhada: conflito 409 e "Manter o meu" ou "Usar o atual" deixam o alarme como está', async () => {
  for (const decisao of ['manterMeu', 'usarAtual']) {
    const s = servidor();
    const l = A.criarLinha(s.chamar, { ...s.linha });
    Object.assign(s.linha, { texto: 'de outro', versao: 2, alarme: '2026-12-01 10:00' });
    await l.salvarTexto('meu');
    assert.deepEqual([l.conflito.texto, l.conflito.alarme], ['de outro', null]);
    await l[decisao]();
    s.semAlarme();
    assert.equal(s.linha.alarme, '2026-12-01 10:00');
    assert.deepEqual([l.conflito, l.pendente()], [null, false]);
  }
});

test('linha apagada por fora e recriada: nasce sem enviar alarme', async () => {
  const p = servidor();
  p.estado.apagada = true;
  const pessoal = T.criarLinha(p.chamar, { ...p.linha });
  await pessoal.salvarTexto('de novo');
  assert.deepEqual(p.chamadas.map(c => c[0]), ['PUT', 'POST']);
  p.semAlarme();

  const a = servidor();
  a.estado.apagada = true;
  const compartilhada = A.criarLinha(a.chamar, { ...a.linha });
  await compartilhada.salvarTexto('de novo');
  assert.equal(compartilhada.apagada, true);
  await compartilhada.recriar();
  assert.deepEqual(a.chamadas.map(c => c[0]), ['PUT', 'POST']);
  a.semAlarme();
});
