const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { CODIGOS, PERFIS_INICIAIS } = require('../seguranca/permissoes');
const { acrescentarPermissoesChecklist } = require('../seguranca/instalacao');
const { criarPoolFalso } = require('./apoio/poolFalso');
const DanfeEnvio = require('../danfe_envio.js');

const ler = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('permissões: pedidos.checklist e checklist.enviar para Administrador e Interno completo, não para Vendedor/Representante', () => {
  for (const c of ['pedidos.checklist', 'checklist.enviar']) {
    assert.ok(CODIGOS.has(c), c);
    const tem = n => PERFIS_INICIAIS.find(p => p.nome === n).permissoes.includes(c);
    assert.ok(tem('Administrador') && tem('Interno completo') && !tem('Vendedor') && !tem('Representante'), c);
  }
});

test('migração: pedidos.checklist a todos os perfis do VB; checklist.enviar só Administrador e Interno completo; uma vez só', async () => {
  const mk = ({ jaFeito = false } = {}) => criarPoolFalso([
    [/FROM web_auditoria WHERE acao = 'permissoes_checklist'/, jaFeito ? [{ id: 9 }] : []],
    [/SELECT id, nome FROM web_perfis WHERE nome IN/, [{ id: 1, nome: 'Administrador' }, { id: 2, nome: 'Interno completo' }, { id: 3, nome: 'Auxiliar de escritório' }]],
    [/INSERT IGNORE INTO web_perfil_permissoes/, () => ({ affectedRows: 1 })],
    [/INSERT INTO web_auditoria/, () => ({ insertId: 1 })]
  ]);
  const pool = mk();
  assert.deepEqual(await acrescentarPermissoesChecklist(pool), { feito: true });
  assert.deepEqual(pool.chamadas.filter(c => /INSERT IGNORE/.test(c.sql)).map(c => c.params.join(':')).sort(),
    ['1:checklist.enviar', '1:pedidos.checklist', '2:checklist.enviar', '2:pedidos.checklist', '3:pedidos.checklist']);
  assert.ok(/Auxiliar financeiro/.test(pool.chamadas.find(c => /FROM web_perfis/.test(c.sql)).sql));
  assert.deepEqual(await acrescentarPermissoesChecklist(mk({ jaFeito: true })), { feito: false });
});

// carrega checklist_pedido.js com window/fetch/alert falsos
function carregar() {
  const avisos = [];
  const st = { avisos, aba: null, abertas: [], removeu: false };
  const novaAba = () => (st.aba = { fechada: false, location: {}, close() { this.fechada = true; } });
  global.window = { open: (u) => { st.abertas.push(u); return st.aba; }, location: {} };
  global.localStorage = { removeItem: () => { st.removeu = true; } };
  global.alert = m => avisos.push(m);
  global.setTimeout = () => 0; // o aviso de 5 min para liberar o blob não pode manter o processo de teste vivo
  global.URL = Object.assign(Object.create(URL), { createObjectURL: () => 'blob:x', revokeObjectURL() {} });
  delete require.cache[require.resolve('../checklist_pedido.js')];
  require('../checklist_pedido.js');
  novaAba();
  return { st, novaAba, abrir: () => global.window.ChecklistPedido.abrir({ apiBase: 'https://api.teste', loginUrl: 'login.html', token: () => 'TOK' }) };
}

test('checklist_pedido.js busca GET /checklist/pdf na API com o token, sem o serviço local', async () => {
  const src = ler('checklist_pedido.js');
  assert.ok(src.includes("'/checklist/pdf'") && !src.includes('127.0.0.1') && !src.includes('3917'));
  const { st, novaAba, abrir } = carregar();
  const chamadas = [];
  global.fetch = async (url, op) => { chamadas.push([url, op.headers.Authorization]); return { ok: true, status: 200, blob: async () => ({}) }; };
  await abrir();
  assert.deepEqual(chamadas, [['https://api.teste/checklist/pdf', 'Bearer TOK']]);
  assert.equal(st.aba.location.href, 'blob:x'); assert.ok(!st.aba.fechada);
  assert.equal(st.abertas[0], ''); // a aba abre no clique, antes da resposta

  novaAba();
  global.fetch = async () => ({ ok: false, status: 404, json: async () => ({ error: 'qualquer' }) });
  await abrir();
  assert.equal(st.avisos.at(-1), 'O checklist ainda não foi enviado. Peça a quem tem permissão para enviá-lo.'); assert.ok(st.aba.fechada);

  novaAba();
  global.fetch = async () => ({ ok: false, status: 403, json: async () => ({ error: 'Acesso restrito' }) });
  await abrir();
  assert.equal(st.avisos.at(-1), 'Acesso restrito.'); assert.ok(st.aba.fechada);

  novaAba();
  global.fetch = async () => { throw new Error('rede'); };
  await abrir();
  assert.match(st.avisos.at(-1), /Sem conexão/); assert.ok(st.aba.fechada);

  novaAba();
  global.fetch = async () => ({ ok: false, status: 401, json: async () => ({}) });
  await abrir();
  assert.ok(st.removeu && st.aba.fechada && global.window.location.href === 'login.html');
});

test('envio na tela: validarChecklist confere extensão, vazio e 5 MB; o servidor não depende do serviço local', () => {
  assert.equal(DanfeEnvio.validarChecklist({ name: 'Check.PDF', size: 1000 }).ok, true);
  assert.equal(DanfeEnvio.validarChecklist({ name: 'foto.png', size: 1000 }).ok, false);
  assert.equal(DanfeEnvio.validarChecklist({ name: 'a.pdf', size: 0 }).ok, false);
  assert.equal(DanfeEnvio.validarChecklist({ name: 'a.pdf', size: 5 * 1024 * 1024 + 1 }).ok, false);
  assert.equal(DanfeEnvio.MAX_CHECKLIST, 5 * 1024 * 1024);
  const js = ler('danfe_envio.js');
  assert.ok(js.includes("'/checklist/info'") && js.includes("'/checklist?nome='") && js.includes("metodo: 'PUT'"));
  // nada do checklist ficou no serviço local
  assert.ok(!/checklist/i.test(ler('local/salvador_pdf.js')));
  assert.ok(!fs.existsSync(path.join(__dirname, '..', 'docs', 'regras', 'servico-local.md')) || !/ELEGANCE_CHECKLIST_PDF/.test(ler('docs/regras/servico-local.md')));
});
