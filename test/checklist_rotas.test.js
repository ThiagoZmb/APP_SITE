// Checklist de produção em PDF guardado no banco (rotas/checklist.js, calculo/checklist.js, web_checklist). Banco simulado nesta mesma tela.
process.env.JWT_SECRET = 'teste';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { subir } = require('./apoio/servidor');
const { criarPoolFalso } = require('./apoio/poolFalso');
const { app, pool, acesso, sessoes } = require('../index.js');
const { SID_TESTE, aceitarSidDeTeste } = require('./apoio/sessaoFalsa');
const { instalarTabelas } = require('../seguranca/instalacao');
const { validarPdf, nomeDoArquivo, MAX_PDF } = require('../calculo/checklist');
const { REGEX_VALOR } = require('../seguranca/valores');
aceitarSidDeTeste(sessoes);

const PERFIS = { Admin: ['pedidos.checklist', 'checklist.enviar'], 'Só abrir': ['pedidos.checklist'], 'Só enviar': ['checklist.enviar'], 'Sem acesso': ['pedidos.ver'] };
const pdf = (t = 'x') => Buffer.from('%PDF-1.4\n' + t + '\n%%EOF');
const nomesDeCampos = v => (Array.isArray(v) ? v.flatMap(nomesDeCampos) : v && typeof v === 'object' ? Object.entries(v).flatMap(([k, x]) => [k, ...nomesDeCampos(x)]) : []);

async function preparar(t, perfil = 'Admin') {
  const estado = { linha: null, auditoria: [] };
  const f = criarPoolFalso([
    [/INSERT INTO web_auditoria/, (sql, [quando, quem, acao, alvo, detalhe]) => { estado.auditoria.push({ quem, acao, alvo, detalhe: JSON.parse(detalhe) }); return { affectedRows: 1 }; }],
    [/^SELECT nome_arquivo, conteudo FROM web_checklist/, () => (estado.linha ? [estado.linha] : [])],
    [/^SELECT nome_arquivo, tamanho, enviado_por, enviado_em FROM web_checklist/, () => (estado.linha ? [estado.linha] : [])],
    [/^SELECT id FROM web_checklist WHERE id = \? FOR UPDATE/, () => (estado.linha ? [{ id: 1 }] : [])],
    [/^INSERT INTO web_checklist/, (sql, [id, nome_arquivo, conteudo, tamanho, enviado_por, enviado_em]) => {
      assert.equal(id, 1); assert.match(sql, /ON DUPLICATE KEY UPDATE/);
      estado.linha = { nome_arquivo, conteudo, tamanho, enviado_por, enviado_em }; return { affectedRows: 1 };
    }]
  ]);
  pool.execute = f.execute; pool.getConnection = f.getConnection;
  t.mock.method(acesso, 'carregar', async id => ({ codigo: id, nome: 'Caio', cargo: '', empresa: 'ELEGANCE', perfil: { id: 1, nome: perfil },
    estados: [], ativo: true, permissoes: new Set(PERFIS[perfil]) }));
  t.mock.method(console, 'warn', () => {}); t.mock.method(console, 'error', () => {});
  const s = await subir(app);
  t.after(s.fechar);
  const cab = { Authorization: 'Bearer ' + jwt.sign({ id: 7, nome: 'Caio', v: 2, tipo: 'funcionario', sid: SID_TESTE }, 'teste', { issuer: 'elegance-api', expiresIn: '1h' }) };
  return {
    estado,
    get: caminho => fetch(s.url + caminho, { headers: cab }),
    enviar: (corpo, nome, tipo = 'application/pdf') => fetch(s.url + '/checklist' + (nome === undefined ? '' : '?nome=' + encodeURIComponent(nome)), { method: 'PUT', headers: { ...cab, 'Content-Type': tipo }, body: corpo })
  };
}

test('calculo/checklist: valida pelos bytes (assinatura, vazio, tamanho) e limpa o nome', () => {
  assert.equal(validarPdf(pdf()).ok, true);
  assert.equal(validarPdf(Buffer.alloc(0)).ok, false);
  assert.equal(validarPdf(Buffer.from('<html>')).ok, false);
  assert.equal(validarPdf('texto').ok, false);
  assert.equal(validarPdf(Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(MAX_PDF)])).ok, false);
  assert.equal(nomeDoArquivo('C:\\rede\\CheckList de Produção 2.PDF'), 'CheckList de Produção 2.PDF');
  assert.equal(nomeDoArquivo('../../etc/x\u0000y.pdf'), 'xy.pdf');
  assert.equal(nomeDoArquivo(''), 'checklist.pdf');
  assert.equal(nomeDoArquivo(undefined), 'checklist.pdf');
  assert.equal(nomeDoArquivo('a'.repeat(400)).length, 150);
});

test('GET /checklist/pdf: 404 claro sem arquivo; depois devolve o PDF sem cache', async t => {
  const { get, enviar } = await preparar(t);
  let r = await get('/checklist/pdf');
  assert.equal(r.status, 404);
  assert.match((await r.json()).error, /O checklist ainda não foi enviado\. Peça a quem tem permissão para enviá-lo\./);
  assert.equal((await enviar(pdf('conteudo'), 'CheckList de Produção 2.PDF')).status, 200);
  r = await get('/checklist/pdf');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'application/pdf');
  assert.match(r.headers.get('cache-control'), /no-store/);
  assert.deepEqual(Buffer.from(await r.arrayBuffer()), pdf('conteudo'));
});

test('PUT /checklist: grava com nome, substitui o vigente e audita só nome e tamanho', async t => {
  const { estado, get, enviar } = await preparar(t);
  let r = await enviar(pdf('um'), 'CheckList.PDF');
  let j = await r.json();
  assert.deepEqual([r.status, j.ok, j.substituido, j.nome, j.tamanho], [200, true, false, 'CheckList.PDF', pdf('um').length]);
  assert.equal(estado.auditoria[0].acao, 'checklist_enviado');
  assert.deepEqual(estado.auditoria[0].detalhe, { nome: 'CheckList.PDF', tamanho: pdf('um').length });
  r = await enviar(pdf('dois diferente'), 'Novo.pdf');
  j = await r.json();
  assert.deepEqual([j.substituido, j.nome], [true, 'Novo.pdf']);
  assert.equal(estado.auditoria[1].acao, 'checklist_substituido');
  const info = await (await get('/checklist/info')).json();
  assert.deepEqual([info.existe, info.nome, info.tamanho, info.enviadoPor], [true, 'Novo.pdf', pdf('dois diferente').length, 'Caio']);
  assert.match(info.enviadoEm, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  assert.ok(!nomesDeCampos([j, info]).some(k => REGEX_VALOR.test(k)), 'checklist não é dinheiro');
  assert.equal((await enviar(pdf('sem nome'))).status, 200);
  assert.equal(estado.linha.nome_arquivo, 'checklist.pdf');
});

test('PUT /checklist: recusa não-PDF, vazio, tipo errado e mais de 5 MB sem tocar no vigente', async t => {
  const { estado, enviar } = await preparar(t);
  assert.equal((await enviar(Buffer.from('<html>nao e pdf</html>'), 'a.pdf')).status, 400);
  assert.equal((await enviar(Buffer.alloc(0), 'a.pdf')).status, 400);
  assert.equal((await enviar(Buffer.from('%PDF-1.4'), 'a.pdf', 'text/plain')).status, 400);
  const grande = Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(5 * 1024 * 1024 + 10)]);
  const r = await enviar(grande, 'a.pdf');
  assert.equal(r.status, 413);
  assert.match((await r.json()).error, /5 MB/);
  assert.equal(estado.linha, null);
  assert.equal(estado.auditoria.length, 0);
});

test('permissões das rotas: abrir exige pedidos.checklist; enviar e info exigem checklist.enviar', async t => {
  for (const [perfil, abre, envia] of [['Admin', 200, 200], ['Só abrir', 200, 403], ['Só enviar', 403, 200], ['Sem acesso', 403, 403]]) {
    await t.test(perfil, async tt => {
      const { estado, get, enviar } = await preparar(tt, perfil);
      estado.linha = { nome_arquivo: 'a.pdf', conteudo: pdf(), tamanho: pdf().length, enviado_por: 'Caio', enviado_em: '2026-11-05 10:00:00' };
      assert.equal((await get('/checklist/pdf')).status, abre);
      assert.equal((await get('/checklist/info')).status, envia);
      assert.equal((await enviar(pdf('novo'), 'b.pdf')).status, envia);
    });
  }
});

test('instalarTabelas cria web_checklist (id fixo, LONGBLOB), sem FK e sem mexer em tabela do VB', async () => {
  const p = criarPoolFalso();
  await instalarTabelas(p);
  const ddl = p.chamadas.map(c => c.sql).find(s => s.includes('`web_checklist`'));
  assert.ok(ddl, 'DDL web_checklist ausente');
  for (const trecho of ['id INT NOT NULL PRIMARY KEY', 'nome_arquivo VARCHAR(150)', 'conteudo LONGBLOB', 'tamanho INT', 'enviado_por', 'enviado_em DATETIME']) assert.ok(ddl.includes(trecho), trecho);
  assert.ok(!/FOREIGN KEY|REFERENCES/i.test(ddl));
});
