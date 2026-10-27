// Desenho da porta na coluna Imagem do PDF (Pedido, Orçamento e Guia de Produção).
process.env.JWT_SECRET = 'teste';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { subir } = require('./apoio/servidor');
const { criarPoolFalso } = require('./apoio/poolFalso');
const { pngSolido, pngComIdatCorrompido } = require('./apoio/png');
const pdf = require('../pdf/ped_orc');
const { carimboItens } = require('../calculo/leitura_vb');

const contarImagens = buf => (buf.toString('latin1').match(/\/Subtype \/Image/g) || []).length;

const dados = (extra = {}) => ({
  tipo: 'Pedido', numero: '23425',
  cab: { RAZAO_SOCIAL: 'CLI', CLIENTE_FINAL: 'Final', DATA: '2026-10-05', DATA_PRONTO: '2026-10-05', OBS_GERAL: '', SUB_TOTAL: '10', TOTAL: '10', DESCONTO: '0' },
  itens: [{ ITEM: 1, QTD: 1, TIPO_PRODUTO: 'Porta de giro', OBSERVACAO: '', UNITARIO: '10', TOTAL: '10' },
          { ITEM: 2, QTD: 1, TIPO_PRODUTO: 'Porta de giro', OBSERVACAO: '', UNITARIO: '10', TOTAL: '10' }],
  v4: [{ ITEM_PEDIDO: 1, ITEM: 1, PORTA: 'Folha 1', ALTURA: 2100, LARGURA: 900, PERFIL: 'P' }, { ITEM_PEDIDO: 2, ITEM: 1, PORTA: 'Folha 1', ALTURA: 2000, LARGURA: 800, PERFIL: 'P' }],
  complementos: [], serralheria: [], compSerralheria: [], furos: [], ...extra
});
// o pdfkit entrega o PDF de forma assíncrona: espera o fim do fluxo
function gerar(d, opcoes = {}) {
  return new Promise((ok, falha) => {
    const doc = pdf.novoDocumento();
    const partes = [];
    doc.on('data', p => partes.push(p));
    doc.on('end', () => ok(Buffer.concat(partes)));
    doc.on('error', falha);
    pdf.desenharPedOrc(doc, d, { logo: false, ...opcoes });
    doc.end();
  });
}

// ---------------- caixa da imagem (contain) ----------------

test('ajustarImagem: cabe inteira na largura da célula e na altura máxima, mantendo a proporção', () => {
  const { ajustarImagem } = pdf;
  let r = ajustarImagem(300, 500, 72, 170);        // limitada pela largura
  assert.ok(Math.abs(r.w - 72) < 1e-9 && Math.abs(r.h - 120) < 1e-9, JSON.stringify(r));
  r = ajustarImagem(50, 1000, 72, 170);            // alta e estreita: limitada pela altura
  assert.ok(Math.abs(r.h - 170) < 1e-9 && Math.abs(r.w - 8.5) < 1e-9, JSON.stringify(r));
  r = ajustarImagem(200, 100, 72);                 // sem altura máxima (logo): só pela largura
  assert.ok(Math.abs(r.w - 72) < 1e-9 && Math.abs(r.h - 36) < 1e-9, JSON.stringify(r));
});

// ---------------- desenho ----------------

test('desenharPedOrc: o desenho do item entra na coluna Imagem; sem desenho a célula fica vazia', async () => {
  const sem = contarImagens(await gerar(dados()));
  const com = contarImagens(await gerar(dados({ desenhos: { 1: pngSolido(120, 240) } })));
  assert.equal(com, sem + 1);
  assert.equal(contarImagens(await gerar(dados({ desenhos: { 1: pngSolido(120, 240), 2: pngSolido(100, 300) } }))), sem + 2);
});

test('desenharPedOrc: bytes que não são imagem não derrubam o PDF (célula vazia)', async () => {
  const sem = contarImagens(await gerar(dados()));
  const buf = await gerar(dados({ desenhos: { 1: Buffer.from('isto não é um PNG') } }));
  assert.equal(buf.subarray(0, 4).toString(), '%PDF');
  assert.equal(contarImagens(buf), sem);
});

test('desenharPedOrc: Guia de Produção e orçamento também mostram o desenho', async () => {
  const sem = contarImagens(await gerar(dados(), { producao: true }));
  assert.equal(contarImagens(await gerar(dados({ desenhos: { 1: pngSolido(60, 200) } }), { producao: true })), sem + 1);
  const orc = dados({ tipo: 'Orçamento' });
  assert.equal(contarImagens(await gerar({ ...orc, desenhos: { 2: pngSolido(60, 200) } }, { verValores: true })), contarImagens(await gerar(orc, { verValores: true })) + 1);
});

// ---------------- rota ----------------

const { app, pool, acesso } = require('../index.js');
const USUARIOS = {
  1: { nome: 'Ana', permissoes: new Set(['pedidos.pdf', 'valores.ver']) },
  2: { nome: 'Bia', permissoes: new Set(['pedidos.pdf']) }
};
const token = id => jwt.sign({ id, nome: USUARIOS[id].nome, v: 2 }, 'teste', { issuer: 'elegance-api', expiresIn: '1h' });

async function preparar(t, { carimbo, imagens = 'ok' } = {}) {
  const d = dados();
  const certo = carimboItens({ lista: d.itens, itensV4: d.v4, furacao: [] });
  const f = criarPoolFalso([
    [/FROM ped_orc WHERE NUMERO/, [d.cab]],
    [/FROM ped_orc_lista_itens/, d.itens],
    [/FROM ped_orc_itens_v4/, d.v4],
    [/SELECT MEDICAO FROM cadastro_clientes/, [{ MEDICAO: 'Vão' }]],
    [/FROM web_item_desenhos/, () => {
      if (imagens === 'erro') throw new Error('tabela inexistente');
      const png = imagens === 'corrompida' ? pngComIdatCorrompido(120, 240, 6) : pngSolido(120, 240);
      return [{ item: 1, png, carimbo: carimbo ?? certo }];
    }]
  ]);
  pool.execute = f.execute; pool.getConnection = f.getConnection;
  t.mock.method(acesso, 'carregar', async id => ({ codigo: id, nome: USUARIOS[id].nome, cargo: '', empresa: 'ELEGANCE',
    perfil: { id, nome: 'X' }, estados: [], ativo: true, permissoes: USUARIOS[id].permissoes }));
  t.mock.method(console, 'error', () => {});
  const s = await subir(app);
  t.after(s.fechar);
  const chamar = async (id, caminho) => { const r = await fetch(s.url + caminho, { headers: { Authorization: 'Bearer ' + token(id) } }); return { r, buf: Buffer.from(await r.arrayBuffer()) }; };
  return { f, chamar, certo };
}

test('GET /dados_pdf usa o desenho quando o carimbo bate, e só então (com e sem valores.ver)', async t => {
  // cada preparar() troca o banco simulado global: prepara e chama em sequência
  for (const id of [1, 2]) {
    const { r, buf } = await (await preparar(t)).chamar(id, '/dados_pdf?numero=23425&tipo=Pedido');
    assert.equal(r.status, 200);
    const base = await (await preparar(t, { carimbo: 'x'.repeat(64) })).chamar(id, '/dados_pdf?numero=23425&tipo=Pedido');
    assert.equal(contarImagens(buf), contarImagens(base.buf) + 1, 'usuário ' + id);
  }
});

test('GET /dados_pdf: carimbo diferente (VB mudou os itens) ou erro ao ler as imagens → PDF normal, sem imagem', async t => {
  const a = await (await preparar(t, { carimbo: 'x'.repeat(64) })).chamar(1, '/dados_pdf?numero=23425&tipo=Pedido');
  assert.equal(a.r.status, 200);
  const b = await (await preparar(t, { imagens: 'erro' })).chamar(1, '/dados_pdf?numero=23425&tipo=Pedido');
  assert.equal(b.r.status, 200);
  assert.equal(b.buf.subarray(0, 4).toString(), '%PDF');
  assert.equal(contarImagens(a.buf), contarImagens(b.buf));
});

test('GET /dados_pdf?producao=1 (Guia de Produção) também usa o desenho', async t => {
  const com = await (await preparar(t)).chamar(2, '/dados_pdf?numero=23425&tipo=Pedido&producao=1');
  const sem = await (await preparar(t, { carimbo: 'x'.repeat(64) })).chamar(2, '/dados_pdf?numero=23425&tipo=Pedido&producao=1');
  assert.equal(com.r.status, 200);
  assert.equal(contarImagens(com.buf), contarImagens(sem.buf) + 1);
});

test('GET /dados_pdf: imagem já guardada com dados corrompidos (RGBA) é ignorada, o PDF sai e o servidor não cai', async t => {
  const boa = await (await preparar(t, { carimbo: 'x'.repeat(64) })).chamar(1, '/dados_pdf?numero=23425&tipo=Pedido');
  const r = await (await preparar(t, { imagens: 'corrompida' })).chamar(1, '/dados_pdf?numero=23425&tipo=Pedido');
  assert.equal(r.r.status, 200);
  assert.equal(r.buf.subarray(0, 4).toString(), '%PDF');
  assert.equal(contarImagens(r.buf), contarImagens(boa.buf));
  await new Promise(ok => setTimeout(ok, 100));   // o decodificador do pdfkit é assíncrono: se algo estivesse errado, a exceção apareceria aqui
});
