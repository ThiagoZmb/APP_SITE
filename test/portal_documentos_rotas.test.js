process.env.JWT_SECRET = 'teste';
process.env.NODE_ENV = 'test';
delete process.env.EMPRESA_CNPJ; // o CNPJ da empresa vem do mais frequente entre os DANFE do banco falso
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const { subir } = require('./apoio/servidor');
const { criarBancoPortal } = require('./apoio/bancoPortal');
const { criarPoolDocumentos } = require('./apoio/poolDocumentosPortal');
const { chaveCom, pdfBytes } = require('./apoio/bancoDanfe');
const { criarSessoesPortal } = require('../portal/sessoes');
const { criarAcessoPortal } = require('../portal/acesso');
const { cabecalhosPortal } = require('../portal/cabecalhos');
const { criarRegistro } = require('../seguranca/rotas');
const pdfReal = require('../pdf/ped_orc');
const { registrarPortalDocumentos } = require('../rotas/portal_documentos');

const EMPRESA_CNPJ = '08951388000118';
const chaveA = chaveCom({ numero: 11290 });   // ligada manualmente ao pedido 12 (ACME)
const chaveF = chaveCom({ numero: 22222 });   // ligada ao pedido 13 (ACME) pelo financeiro
const chaveB = chaveCom({ numero: 33333 });   // ligada ao pedido 99 (BETA)
const chaveSolta = chaveCom({ numero: 44444 }); // sem ligação nenhuma
const pdfA = pdfBytes('NOTA-A-BYTES');
const pdfF = pdfBytes('NOTA-F-BYTES');

const S = { TOTAL: 888777.66, SUB_TOTAL: 888555.44, DESCONTO: 77.31, UNITARIO: 555444.33, VALOR_TOTAL: 666333.22, VALOR: 444222.11, OBS: 'NOTA INTERNA SECRETA DO PEDIDO' };
const SENTINELAS = [String(S.TOTAL), String(S.SUB_TOTAL), String(S.DESCONTO), String(S.UNITARIO), String(S.VALOR_TOTAL), String(S.VALOR), S.OBS];

const pedido = (NUMERO, TIPO, RAZAO_SOCIAL) => ({
  NUMERO, TIPO, RAZAO_SOCIAL, CLIENTE_FINAL: 'Cliente Final', DATA: '2026-10-01', DATA_PRONTO: '2026-10-20 10:00:00',
  OBS_GERAL: S.OBS, SUB_TOTAL: S.SUB_TOTAL, TOTAL: S.TOTAL, DESCONTO: S.DESCONTO
});

function dadosPadrao() {
  const base = { NUMERO: 12, TIPO: 'Pedido' };
  return {
    pedidos: [pedido(12, 'Pedido', 'ACME LTDA'), pedido(13, 'Pedido', 'ACME LTDA'), pedido(99, 'Pedido', 'BETA LTDA'), pedido(15, 'Orçamento', 'ACME LTDA')],
    danfe: [
      { chave: chaveA, numero_nf: 11290, serie: 1, modelo: '55', cnpj_emitente: EMPRESA_CNPJ, enviado_em: '2026-10-20 10:00:00', pdf: pdfA },
      { chave: chaveF, numero_nf: 22222, serie: 1, modelo: '55', cnpj_emitente: EMPRESA_CNPJ, enviado_em: '2026-10-21 10:00:00', pdf: pdfF },
      { chave: chaveB, numero_nf: 33333, serie: 1, modelo: '55', cnpj_emitente: EMPRESA_CNPJ, enviado_em: '2026-10-22 10:00:00', pdf: pdfBytes('NOTA-B') },
      { chave: chaveSolta, numero_nf: 44444, serie: 1, modelo: '55', cnpj_emitente: EMPRESA_CNPJ, enviado_em: '2026-10-23 10:00:00', pdf: pdfBytes('SOLTA') }
    ],
    vinculos: [{ id: 1, chave: chaveA, pedido_numero: 12 }, { id: 2, chave: chaveB, pedido_numero: 99 }],
    fluxo: [{ PEDIDO: '13', NOTA_FISCAL: '22222' }],
    corpo: {
      itens: [{ ...base, ITEM: '1', QTD: 2, TIPO_PRODUTO: 'Porta de giro', DESCRICAO: 'Porta social', OBSERVACAO: '', UNITARIO: S.UNITARIO, TOTAL: S.TOTAL, VALOR_TOTAL: S.VALOR_TOTAL }],
      v4: [{ ...base, ITEM: '1', ITEM_PEDIDO: '1', VALOR_TOTAL: S.VALOR_TOTAL, VALOR: S.VALOR }],
      serr: [],
      comps: [{ ...base, ITEM_PEDIDO: '1', VALOR: S.VALOR, VALOR_TOTAL: S.VALOR_TOTAL }],
      compSerr: [{ ...base, ITEM_PEDIDO: '1', VALOR: S.VALOR, VALOR_UNITARIO: S.UNITARIO }],
      furos: [],
      desenhos: [{ tipo: 'Pedido', numero: 12, item: 1, png: Buffer.from('isto nao e um png'), carimbo: 'qualquer' }]
    }
  };
}

// Usuários: 1 Ana (admin_geral, ACME), 2 Caio ('usuario' de ACME só com pedidos.ver), 3 Bia (admin_geral, BETA),
// 4 Dora ('usuario' de ACME com documentos.ver).
async function montar(t, { mutar = false, quebrarBanco = false, quebrarAuditoria = false, limite, gerador } = {}) {
  const banco = criarBancoPortal();
  const d = banco.dados;
  d.clientes.push({ CODIGO: 40, RAZAO_SOCIAL: 'ACME LTDA' }, { CODIGO: 41, RAZAO_SOCIAL: 'BETA LTDA' });
  d.empresas.push({ cliente_codigo: 40, situacao: 'ativa' }, { cliente_codigo: 41, situacao: 'ativa' });
  const u = (id, email, cliente, papel) => ({ id, email, cliente_codigo: cliente, papel, situacao: 'ativo' });
  d.usuarios.push(u(1, 'ana@acme.com', 40, 'admin_geral'), u(2, 'caio@acme.com', 40, 'usuario'),
    u(3, 'bia@beta.com', 41, 'admin_geral'), u(4, 'dora@acme.com', 40, 'usuario'));
  d.permissoes.push({ usuario_id: 2, permissao: 'pedidos.ver' }, { usuario_id: 4, permissao: 'documentos.ver' });

  const dados = dadosPadrao();
  const pool = criarPoolDocumentos({ ...dados, clientes: d.clientes });
  let poolUsado = pool;
  // mutação fiel: tira a condição de empresa do SQL e o seu parâmetro (o MySQL real recusaria a sobra)
  if (mutar) poolUsado = { execute: (sql, params) => (sql.includes('c.CODIGO = ?')
    ? pool.execute(sql.replace('c.CODIGO = ?', '1 = 1'), params.slice(1)) : pool.execute(sql, params)) };
  if (quebrarBanco) poolUsado = { execute: async () => { throw { code: 'ER_X', sqlMessage: 'SEGREDO DO BANCO' }; } };
  if (quebrarAuditoria) {
    poolUsado = { execute: (sql, params) => {
      if (/web_portal_auditoria/.test(sql)) throw { code: 'ER_AUD' };
      return pool.execute(sql, params);
    } };
  }

  const espiadas = [];
  const pdf = {
    ...pdfReal,
    desenharPedOrc: (doc, dd, op) => {
      espiadas.push({ dados: JSON.parse(JSON.stringify({ ...dd, desenhos: undefined })), op });
      if (gerador) return gerador(doc, dd, op);
      return pdfReal.desenharPedOrc(doc, dd, op);
    }
  };

  const config = { ativo: true, baseUrl: 'https://portal.exemplo.com', chaveCripto: '', termoVersao: 'T1' };
  const app = express();
  app.use(cabecalhosPortal);
  const sessoes = criarSessoesPortal({ pool: banco.pool });
  const { portalAtivo, portalAutenticar } = criarAcessoPortal({ pool: banco.pool, sessoes, config });
  const registro = criarRegistro(app, { autenticado: [], portalPublico: [portalAtivo], portalAutenticado: [portalAtivo, portalAutenticar] });
  registrarPortalDocumentos({ portal: registro.portal, pool: poolUsado, pdf, ...(limite ? { limite } : {}) });
  registro.verificar();
  const s = await subir(app);
  t.after(s.fechar);
  const cookieDe = async usuarioId => `__Host-portal=${await sessoes.criar(usuarioId, '1.2.3.4')}`;
  const get = (caminho, { cookie, headers = {} } = {}) => fetch(s.url + caminho, { headers: { ...(cookie ? { Cookie: cookie } : {}), ...headers } });
  return { banco, d, registro, pool, get, cookieDe, espiadas };
}

const consultaPdfNota = pool => pool.chamadas.filter(c => /^SELECT numero_nf, pdf FROM web_danfe/.test(c.sql));
const posses = pool => pool.chamadas.filter(c => /FROM ped_orc p\b/.test(c.sql));
const cabecalhosSemData = r => { const h = Object.fromEntries(r.headers); delete h.date; return h; };

async function afirmarIsolamento(c) {
  const cookie = await c.cookieDe(1); // Ana, ACME
  const r = await c.get('/portal/api/pedidos/99/documentos', { cookie }); // pedido de BETA
  assert.equal(r.status, 404);
  assert.deepEqual(await r.json(), { error: 'Documento não encontrado.' });
}

test('/documentos: lista as notas ligadas (manual e financeiro), com exatamente 3 chaves por nota', async t => {
  const c = await montar(t);
  const cookie = await c.cookieDe(1);
  const r12 = await c.get('/portal/api/pedidos/12/documentos', { cookie });
  assert.equal(r12.status, 200);
  const texto = await r12.text();
  const corpo = JSON.parse(texto);
  assert.deepEqual(corpo, { pdfPedido: true, notas: [{ chave: chaveA, numeroNf: 11290, serie: 1 }] });
  assert.ok(corpo.notas.length > 0);
  for (const n of corpo.notas) assert.deepEqual(Object.keys(n).sort(), ['chave', 'numeroNf', 'serie']);
  for (const proibido of ['origem', 'enviadoEm', 'semArquivo', ...SENTINELAS]) assert.ok(!texto.includes(proibido), `vazou ${proibido}`);

  const r13 = await (await c.get('/portal/api/pedidos/13/documentos', { cookie })).json();
  assert.deepEqual(r13.notas.map(n => n.chave), [chaveF]);
  assert.ok(r13.notas.length > 0);
});

test('/pdf: PDF do pedido 12, cabeçalhos da spec e nada de dinheiro nem OBS_GERAL chega ao gerador', async t => {
  const c = await montar(t);
  const r = await c.get('/portal/api/pedidos/12/pdf', { cookie: await c.cookieDe(1) });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'application/pdf');
  assert.equal(r.headers.get('content-disposition'), 'inline; filename="Pedido-12.pdf"');
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('content-security-policy'), 'sandbox');
  const bytes = Buffer.from(await r.arrayBuffer());
  assert.equal(bytes.subarray(0, 5).toString('latin1'), '%PDF-');

  assert.equal(c.espiadas.length, 1);
  const { dados, op } = c.espiadas[0];
  assert.equal(op.verValores, false);
  assert.equal(op.producao, false);
  assert.equal(dados.tipo, 'Pedido');
  assert.equal(dados.numero, 12);
  assert.ok(dados.itens.length > 0 && dados.v4.length > 0 && dados.complementos.length > 0 && dados.compSerralheria.length > 0);
  const serial = JSON.stringify(dados);
  for (const s of SENTINELAS) assert.ok(!serial.includes(s), `chegou ao gerador: ${s}`);
  assert.equal(dados.cab.OBS_GERAL, '');
  assert.equal(dados.cab.RAZAO_SOCIAL, 'ACME LTDA');
});

test('/danfe/:chave: o PDF da nota ligada ao pedido, byte a byte, com os mesmos cabeçalhos', async t => {
  const c = await montar(t);
  const cookie = await c.cookieDe(1);
  const r = await c.get(`/portal/api/pedidos/12/danfe/${chaveA}`, { cookie });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'application/pdf');
  assert.equal(r.headers.get('content-disposition'), 'inline; filename="NF-11290.pdf"');
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('content-security-policy'), 'sandbox');
  assert.ok(Buffer.from(await r.arrayBuffer()).equals(pdfA));
  // nota ligada pelo financeiro ao 13
  const rf = await c.get(`/portal/api/pedidos/13/danfe/${chaveF}`, { cookie });
  assert.equal(rf.status, 200);
  assert.ok(Buffer.from(await rf.arrayBuffer()).equals(pdfF));
  assert.equal(consultaPdfNota(c.pool).length, 2);
});

test('404 uniforme: pedido alheio, inexistente, orçamento, número ruim, chave de outra empresa, solta, de outro pedido ou malformada', async t => {
  const c = await montar(t);
  const cookie = await c.cookieDe(1);
  const caminhos = [
    '/portal/api/pedidos/99/documentos', '/portal/api/pedidos/99/pdf', `/portal/api/pedidos/99/danfe/${chaveA}`, `/portal/api/pedidos/99/danfe/${chaveB}`,
    '/portal/api/pedidos/777/documentos', '/portal/api/pedidos/777/pdf', `/portal/api/pedidos/777/danfe/${chaveA}`,
    '/portal/api/pedidos/15/documentos', '/portal/api/pedidos/15/pdf', `/portal/api/pedidos/15/danfe/${chaveA}`,
    '/portal/api/pedidos/12abc/documentos', '/portal/api/pedidos/12abc/pdf', `/portal/api/pedidos/12abc/danfe/${chaveA}`,
    `/portal/api/pedidos/12/danfe/${chaveB}`,      // nota de BETA, ligada ao pedido 99
    `/portal/api/pedidos/12/danfe/${chaveSolta}`,  // nota sem ligação
    `/portal/api/pedidos/12/danfe/${chaveF}`,      // nota da mesma empresa, mas ligada ao 13
    `/portal/api/pedidos/13/danfe/${chaveA}`,      // nota da mesma empresa, mas ligada ao 12
    `/portal/api/pedidos/12/danfe/${chaveA.slice(0, 43)}`, '/portal/api/pedidos/12/danfe/' + 'a'.repeat(44),
    `/portal/api/pedidos/12/danfe/${chaveA.slice(0, 43)}${(Number(chaveA[43]) + 1) % 10}` // DV errado
  ];
  const respostas = [];
  for (const caminho of caminhos) {
    const r = await c.get(caminho, { cookie });
    respostas.push({ caminho, status: r.status, corpo: await r.text(), cab: cabecalhosSemData(r) });
  }
  assert.ok(respostas.length === caminhos.length && respostas.length > 0);
  const ref = respostas[0];
  assert.equal(ref.status, 404);
  assert.equal(ref.corpo, JSON.stringify({ error: 'Documento não encontrado.' }));
  for (const r of respostas) {
    assert.equal(r.status, ref.status, r.caminho);
    assert.equal(r.corpo, ref.corpo, r.caminho);
    assert.deepEqual(r.cab, ref.cab, r.caminho);
  }
  assert.equal(c.pool.auditoria.length, 0);
  assert.equal(consultaPdfNota(c.pool).length, 0);
  assert.equal(c.espiadas.length, 0);
});

test('SQL fixo: posse por "c.CODIGO = ?" e TIPO Pedido, empresa só da sessão, sem OR', async t => {
  const c = await montar(t);
  const cookie = await c.cookieDe(1);
  const extras = { headers: { 'X-Empresa': '41', 'X-Cliente': 'BETA LTDA' } };
  for (const caminho of ['/portal/api/pedidos/12/documentos', '/portal/api/pedidos/12/pdf', `/portal/api/pedidos/12/danfe/${chaveA}`]) {
    const r = await c.get(`${caminho}?empresa=41&cliente=BETA%20LTDA&codigo=41`, { cookie, ...extras });
    assert.equal(r.status, 200, caminho);
  }
  const q = posses(c.pool);
  assert.equal(q.length, 3);
  for (const x of q) {
    assert.match(x.sql, /c\.CODIGO = \?/);
    assert.match(x.sql, /p\.TIPO = 'Pedido'/);
    assert.match(x.sql, /p\.NUMERO = \?/);
    assert.doesNotMatch(x.sql, /\bOR\b/i);
    assert.deepEqual(x.params, [40, 12]);
  }
});

test('prova de mutação: sem "c.CODIGO = ?" (trocado por "1 = 1") o isolamento FALHA, logo o pool falso aplica o filtro de verdade', async t => {
  const bom = await montar(t);
  await afirmarIsolamento(bom); // controle
  const ruim = await montar(t, { mutar: true });
  const r = await ruim.get('/portal/api/pedidos/99/documentos', { cookie: await ruim.cookieDe(1) });
  assert.equal(r.status, 200, 'a mutação deveria deixar o pedido 99 de BETA abrir');
  await assert.rejects(() => afirmarIsolamento(ruim), assert.AssertionError);
});

test('auditoria: 1 linha por abertura 200 de pdf e danfe, sem chave inteira; nenhuma em /documentos, 404, 403; falha de gravação mantém o arquivo', async t => {
  const c = await montar(t);
  const cookie = await c.cookieDe(1);
  assert.equal((await c.get('/portal/api/pedidos/12/documentos', { cookie })).status, 200);
  assert.equal(c.pool.auditoria.length, 0);
  assert.equal((await c.get('/portal/api/pedidos/12/pdf', { cookie })).status, 200);
  assert.equal(c.pool.auditoria.length, 1);
  assert.equal((await c.get(`/portal/api/pedidos/12/danfe/${chaveA}`, { cookie })).status, 200);
  assert.equal(c.pool.auditoria.length, 2);
  const [p, n] = c.pool.auditoria;
  assert.deepEqual([p.evento, p.usuario_id, p.cliente_codigo, p.detalhe], ['documento_aberto', 1, 40, 'tipo=pdf;pedido=12']);
  assert.deepEqual([n.evento, n.usuario_id, n.cliente_codigo, n.detalhe], ['documento_aberto', 1, 40, 'tipo=danfe;pedido=12;nf=11290']);
  assert.ok(typeof p.ip === 'string' && p.ip.length > 0);
  assert.ok(!JSON.stringify(c.pool.auditoria).includes(chaveA));
  assert.ok(!JSON.stringify(c.pool.auditoria).includes(chaveA.slice(0, 20)));

  assert.equal((await c.get('/portal/api/pedidos/99/pdf', { cookie })).status, 404);
  assert.equal((await c.get('/portal/api/pedidos/12/pdf')).status, 401);
  assert.equal((await c.get('/portal/api/pedidos/12/pdf', { cookie: await c.cookieDe(2) })).status, 403);
  assert.equal(c.pool.auditoria.length, 2);

  const q = await montar(t, { quebrarAuditoria: true });
  const original = console.error;
  const logs = [];
  console.error = (...a) => logs.push(a.join(' '));
  try {
    const rp = await q.get(`/portal/api/pedidos/12/danfe/${chaveA}`, { cookie: await q.cookieDe(1) });
    assert.equal(rp.status, 200);
    assert.ok(Buffer.from(await rp.arrayBuffer()).equals(pdfA));
    const rd = await q.get('/portal/api/pedidos/12/pdf', { cookie: await q.cookieDe(1) });
    assert.equal(rd.status, 200);
  } finally { console.error = original; }
  assert.ok(logs.some(l => l.includes('ER_AUD')));
});

test('limite: a 31ª abertura do mesmo usuário em 10 min dá 429; outro usuário não é afetado; /documentos não conta', async t => {
  const c = await montar(t); // limite padrão real: 30 em 10 minutos
  const cookie = await c.cookieDe(1);
  for (let i = 0; i < 40; i++) assert.equal((await c.get('/portal/api/pedidos/12/documentos', { cookie })).status, 200);
  for (let i = 1; i <= 30; i++) {
    const r = await c.get(`/portal/api/pedidos/12/danfe/${chaveA}`, { cookie });
    assert.equal(r.status, 200, `abertura ${i}`);
    await r.arrayBuffer();
  }
  const bloqueada = await c.get(`/portal/api/pedidos/12/danfe/${chaveA}`, { cookie });
  assert.equal(bloqueada.status, 429);
  assert.deepEqual(await bloqueada.json(), { error: 'Muitas aberturas de documento. Aguarde alguns minutos.' });
  assert.equal(c.pool.auditoria.length, 30);
  assert.equal((await c.get('/portal/api/pedidos/12/pdf', { cookie })).status, 429); // o contador é por usuário, vale nas duas rotas
  assert.equal((await c.get('/portal/api/pedidos/12/documentos', { cookie })).status, 200);
  const outro = await c.get('/portal/api/pedidos/12/pdf', { cookie: await c.cookieDe(4) }); // Dora, mesma empresa
  assert.equal(outro.status, 200);
  const beta = await c.get('/portal/api/pedidos/99/pdf', { cookie: await c.cookieDe(3) });
  assert.equal(beta.status, 200);
});

test('limite injetável: o 429 vem depois da autenticação (sem cookie continua 401)', async t => {
  const c = await montar(t, { limite: { janelaMs: 60000, max: 2 } });
  const cookie = await c.cookieDe(1);
  for (let i = 0; i < 2; i++) assert.equal((await c.get(`/portal/api/pedidos/12/danfe/${chaveA}`, { cookie })).status, 200);
  assert.equal((await c.get(`/portal/api/pedidos/12/danfe/${chaveA}`, { cookie })).status, 429);
  assert.equal((await c.get(`/portal/api/pedidos/12/danfe/${chaveA}`)).status, 401);
});

test('permissão e sessão: sem cookie 401; JWT de funcionário 401; sem documentos.ver 403 sem consulta; empresa suspensa 401', async t => {
  const c = await montar(t);
  const rotas = ['/portal/api/pedidos/12/documentos', '/portal/api/pedidos/12/pdf', `/portal/api/pedidos/12/danfe/${chaveA}`];
  const jwtFunc = jwt.sign({ id: 1, nome: 'Func', v: 2, tipo: 'funcionario', sid: 'a'.repeat(32) }, 'teste');
  for (const rota of rotas) {
    assert.equal((await c.get(rota)).status, 401, rota);
    assert.equal((await c.get(rota, { cookie: `__Host-portal=${jwtFunc}` })).status, 401, rota);
    assert.equal((await c.get(rota, { cookie: await c.cookieDe(2) })).status, 403, rota); // Caio: só pedidos.ver
  }
  assert.equal(c.pool.chamadas.length, 0);
  for (const rota of rotas) assert.equal((await c.get(rota, { cookie: await c.cookieDe(4) })).status, 200, rota); // Dora: documentos.ver
  assert.ok(c.pool.chamadas.length > 0);
  const cookie = await c.cookieDe(1);
  c.d.empresas.find(e => e.cliente_codigo === 40).situacao = 'suspensa';
  for (const rota of rotas) assert.equal((await c.get(rota, { cookie })).status, 401, rota);
});

test('erros: gerador que lança e banco que lança dão 500 genérico, sem vazar dado, e o servidor continua de pé', async t => {
  const original = console.error;
  const logs = [];
  console.error = (...a) => logs.push(a.join(' '));
  try {
    const g = await montar(t, { gerador: () => { throw new Error('GERADOR SEGREDO ACME LTDA'); } });
    const cookie = await g.cookieDe(1);
    const r = await g.get('/portal/api/pedidos/12/pdf', { cookie });
    assert.equal(r.status, 500);
    assert.deepEqual(await r.json(), { error: 'Erro de servidor' });
    assert.equal(g.pool.auditoria.length, 0);
    assert.equal((await g.get('/portal/api/pedidos/12/documentos', { cookie })).status, 200); // continua respondendo

    const b = await montar(t, { quebrarBanco: true });
    for (const rota of ['/portal/api/pedidos/12/documentos', '/portal/api/pedidos/12/pdf', `/portal/api/pedidos/12/danfe/${chaveA}`]) {
      const rb = await b.get(rota, { cookie: await b.cookieDe(1) });
      assert.equal(rb.status, 500, rota);
      assert.deepEqual(await rb.json(), { error: 'Erro de servidor' });
    }
  } finally { console.error = original; }
  assert.ok(logs.length > 0);
  assert.ok(logs.some(l => l.includes('ER_X')));
  assert.ok(!logs.some(l => /SEGREDO|ACME|NOTA INTERNA/.test(l)));
});

test('desenho corrompido não derruba: o PDF sai sem a imagem', async t => {
  const c = await montar(t);
  const r = await c.get('/portal/api/pedidos/12/pdf', { cookie: await c.cookieDe(1) });
  assert.equal(r.status, 200);
  assert.equal(Buffer.from(await r.arrayBuffer()).subarray(0, 5).toString('latin1'), '%PDF-');
  assert.equal((await c.get('/portal/api/pedidos/12/documentos', { cookie: await c.cookieDe(1) })).status, 200);
});

test('registro: as 3 rotas estão em rotasPortal e verificar() não lança', async t => {
  const c = await montar(t);
  const lista = c.registro.rotasPortal().map(r => `${r.metodo} ${r.caminho}`);
  for (const rota of ['get /portal/api/pedidos/:numero/documentos', 'get /portal/api/pedidos/:numero/pdf', 'get /portal/api/pedidos/:numero/danfe/:chave']) {
    assert.ok(lista.includes(rota), rota);
  }
  assert.doesNotThrow(() => c.registro.verificar());
});
