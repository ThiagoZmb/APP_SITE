// PDF de Vidros (Gerar_PDF_Vidros do VB): desenho, nome/pasta e rota GET /dados_pdf_vidros.
process.env.JWT_SECRET = 'teste';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const jwt = require('jsonwebtoken');
const { subir } = require('./apoio/servidor');
const { criarPoolFalso } = require('./apoio/poolFalso');
const pdf = require('../pdf/ped_orc');

const VIDROS = [
  { ITEM: 1, QTD: 2, MODELO: 'Vidro Incolor 8mm', COR_REVESTIMENTO: 'Bronze', TAMANHO: '2086x435', MEDICAO: 'Vão' },
  { ITEM: 2, QTD: 1, MODELO: 'Vidro Fumê', COR_REVESTIMENTO: null, TAMANHO: '2100x900', MEDICAO: 'Vão' }
];

function desenhar(numero, medicao, linhas) {
  const doc = pdf.novoDocumento({ bufferPages: true, margin: 2 });
  doc.on('data', () => {});
  const t = pdf.desenharVidros(doc, { numero, medicao, linhas });
  const paginas = doc.bufferedPageRange().count;
  doc.end();
  return { t, paginas };
}

test('destinoPdf: Vidros vai para Vidros_Produção com sufixo _V (como o VB)', () => {
  assert.deepEqual(pdf.destinoPdf({ tipo: 'Pedido', numero: 7, razaoSocial: 'Ação & Cia', vidros: true }), { pasta: 'Vidros_Produção', nome: '7_Ação & Cia_V.PDF' });
  assert.deepEqual(pdf.destinoPdf({ tipo: 'Pedido', numero: 7, razaoSocial: 'Ação & Cia', producao: true }), { pasta: 'Produção', nome: '7_Ação & Cia_P.PDF' });
});

test('desenho: medição, nº do pedido, cabeçalho Item/Qtd/Vidro/Cor/Tamanho e uma linha por vidro', () => {
  const { t } = desenhar('23425', 'Vão', VIDROS);
  assert.ok(t.includes('Medição: Vão'));
  assert.ok(t.join(' ').includes('Nº Pedido'));
  for (const c of ['Item', 'Qtd', 'Vidro', 'Cor', 'Tamanho']) assert.ok(t.includes(c), c);
  for (const s of ['Vidro Incolor 8mm', 'Bronze', '2086x435', 'Vidro Fumê', '2100x900']) assert.ok(t.includes(s), s);
  assert.ok(!t.some(s => /R\$|mm\b.*x/.test(s)), 'sem dinheiro');
});

test('muitos vidros: quebra de página sem repetir o cabeçalho (o VB não define HeaderRows)', () => {
  const linhas = Array.from({ length: 150 }, (_, i) => ({ ITEM: i + 1, QTD: 1, MODELO: 'Vidro ' + i, COR_REVESTIMENTO: 'Bronze', TAMANHO: '2000x500' }));
  const { t, paginas } = desenhar('1', 'Vão', linhas);
  assert.ok(paginas > 1);
  assert.equal(t.filter(s => s === 'Item').length, 1);
  assert.ok(t.includes('Vidro 149'));
});

// ---------------- rota ----------------

const { app, pool, acesso } = require('../index.js');
const USUARIOS = {
  1: { nome: 'Ana', permissoes: new Set(['pedidos.pdf']), estados: [] },
  2: { nome: 'Bia', permissoes: new Set(['pedidos.ver']), estados: [] },
  3: { nome: 'Caio', permissoes: new Set(['pedidos.pdf']), estados: ['SP'] }
};
const token = id => jwt.sign({ id, nome: USUARIOS[id].nome, v: 2 }, 'teste', { issuer: 'elegance-api', expiresIn: '1h' });

async function preparar(t, { pedido = [{ RAZAO_SOCIAL: 'CLI Ltda' }], vidros = VIDROS, estado = 'RJ' } = {}) {
  const f = criarPoolFalso([
    [/FROM ped_orc WHERE NUMERO/, pedido],
    [/FROM vidros WHERE NUMERO/, vidros],
    [/SELECT ESTADO FROM cadastro_clientes/, [{ ESTADO: estado }]],
    [/SELECT MEDICAO FROM cadastro_clientes/, [{ MEDICAO: 'Cadastro' }]]
  ]);
  pool.execute = f.execute; pool.getConnection = f.getConnection;
  t.mock.method(acesso, 'carregar', async id => ({ codigo: id, nome: USUARIOS[id].nome, cargo: '', empresa: 'ELEGANCE',
    perfil: { id, nome: 'X' }, estados: USUARIOS[id].estados, ativo: true, permissoes: USUARIOS[id].permissoes }));
  t.mock.method(console, 'error', () => {});
  const s = await subir(app);
  t.after(s.fechar);
  const chamar = (id, caminho) => fetch(s.url + caminho, { headers: { Authorization: 'Bearer ' + token(id) } });
  return { f, chamar };
}

test('GET /dados_pdf_vidros devolve o PDF em Vidros_Produção (_V.PDF) e só lê o banco', async t => {
  const { f, chamar } = await preparar(t);
  const r = await chamar(1, '/dados_pdf_vidros?numero=23425');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'application/pdf');
  assert.equal(Buffer.from(await r.arrayBuffer()).subarray(0, 4).toString(), '%PDF');
  assert.equal(decodeURIComponent(r.headers.get('x-pdf-pasta')), 'Vidros_Produção');
  assert.equal(decodeURIComponent(r.headers.get('x-pdf-nome')), '23425_CLI Ltda_V.PDF');
  assert.match(r.headers.get('content-disposition'), /_V.PDF"/);
  assert.ok(f.chamadas.every(c => /^\s*SELECT/i.test(c.sql)), 'PDF não pode gravar nada');
  assert.ok(f.chamadas.some(c => /FROM vidros WHERE NUMERO/.test(c.sql) && /TIPO|Pedido/.test(c.sql) === false));
});

test('vidros: sem permissão pedidos.pdf 403; sem número 400; pedido inexistente 404', async t => {
  const { chamar } = await preparar(t);
  assert.equal((await chamar(2, '/dados_pdf_vidros?numero=23425')).status, 403);
  assert.equal((await chamar(1, '/dados_pdf_vidros')).status, 400);
  const { chamar: c2 } = await preparar(t, { pedido: [] });
  assert.equal((await c2(1, '/dados_pdf_vidros?numero=999')).status, 404);
});

test('vidros: pedido sem vidros responde 404 com mensagem clara (em vez de PDF vazio)', async t => {
  const { chamar } = await preparar(t, { vidros: [] });
  const r = await chamar(1, '/dados_pdf_vidros?numero=23425');
  assert.equal(r.status, 404);
  assert.match((await r.json()).error, /não tem vidros/i);
});

test('vidros: usuário restrito a outros estados não abre o PDF (403)', async t => {
  const { chamar } = await preparar(t, { estado: 'RJ' });
  assert.equal((await chamar(3, '/dados_pdf_vidros?numero=23425')).status, 403);
});

test('vidros: medição vazia nos vidros cai para a do cadastro do cliente', async t => {
  const { f, chamar } = await preparar(t, { vidros: VIDROS.map(v => ({ ...v, MEDICAO: '' })) });
  assert.equal((await chamar(1, '/dados_pdf_vidros?numero=23425')).status, 200);
  assert.ok(f.chamadas.some(c => /SELECT MEDICAO FROM cadastro_clientes/.test(c.sql)));
});

test('menu de Pedidos tem "Vidros (PDF)" só para pedido e o arquivo de tela usa a rota nova', () => {
  const h = fs.readFileSync(path.join(__dirname, '..', 'painel_inicial.html'), 'utf8');
  assert.match(h, /Vidros \(PDF\)/);
  assert.match(h, /dados_pdf_vidros/);
});
