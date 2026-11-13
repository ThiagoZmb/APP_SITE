// Impressão direta: serviço local (local/impressao.js, POST /imprimir) e site (impressao_pdf.js, opções do pedido recém-criado).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const ler = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const PDF = Buffer.from('%PDF-1.4\nconteudo');

// ---------- serviço local ----------
const { criarImpressao, validarConfig, argumentos } = require('../local/impressao');
const SUMATRA = path.join(os.tmpdir(), 'SumatraPDF', 'SumatraPDF.exe');
const existe = () => true;

test('local: validarConfig exige caminho absoluto do SumatraPDF existente e recusa impressora virtual ou com formato de opção', () => {
  assert.equal(validarConfig({ sumatra: SUMATRA }, existe).sumatra, SUMATRA);
  assert.ok(validarConfig(null).erro && validarConfig({}).erro);
  assert.ok(validarConfig({ sumatra: 'SumatraPDF.exe' }, existe).erro, 'caminho relativo');
  assert.ok(validarConfig({ sumatra: path.join(os.tmpdir(), 'cmd.exe') }, existe).erro, 'só SumatraPDF');
  assert.ok(validarConfig({ sumatra: SUMATRA }, () => false).erro, 'não instalado');
  assert.ok(validarConfig({ sumatra: SUMATRA, impressora: '-print-settings' }, existe).erro);
  assert.ok(validarConfig({ sumatra: SUMATRA, impressora: 'Microsoft Print to PDF' }, existe).erro);
  assert.equal(validarConfig({ sumatra: SUMATRA, impressora: 'HP Sala' }, existe).impressora, 'HP Sala');
  assert.deepEqual(argumentos('', 'a.pdf'), ['-print-to-default', '-silent', 'a.pdf']);
  assert.deepEqual(argumentos('HP Sala', 'a.pdf'), ['-print-to', 'HP Sala', '-silent', 'a.pdf']);
});

test('local: sem configuração responde 503 e nada é executado; PDF inválido 400', async () => {
  let rodou = false;
  const sem = criarImpressao({ lerConfig: () => null, executar: async () => { rodou = true; } });
  assert.equal(sem.configurada(), false);
  const r = await sem.imprimir(PDF);
  assert.equal(r.status, 503); assert.equal(r.corpo.configurada, false); assert.equal(rodou, false);
  const com = criarImpressao({ lerConfig: () => ({ sumatra: __filename.replace(/[^\\/]+$/, 'SumatraPDF.exe') }), executar: async () => { rodou = true; } });
  assert.equal((await com.imprimir(Buffer.from('MZ...'))).status, 503, 'o SumatraPDF de mentira não existe');
});

test('local: imprime pelo SumatraPDF com a impressora do arquivo de configuração, usa arquivo temporário e apaga depois', async () => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'elegance-imp-teste-'));
  const exe = path.join(pasta, 'SumatraPDF.exe'); fs.writeFileSync(exe, '');
  const chamadas = [];
  const imp = criarImpressao({ lerConfig: () => ({ sumatra: exe, impressora: 'HP Sala' }), tmp: pasta,
    executar: async (programa, args) => { chamadas.push({ programa, args, conteudo: fs.readFileSync(args[args.length - 1]) }); } });
  assert.equal(imp.configurada(), true);
  const r = await imp.imprimir(PDF);
  assert.equal(r.status, 200); assert.equal(r.corpo.ok, true); assert.equal(r.corpo.impressora, 'HP Sala');
  assert.equal(chamadas.length, 1); assert.equal(chamadas[0].programa, exe);
  assert.deepEqual(chamadas[0].args.slice(0, 3), ['-print-to', 'HP Sala', '-silent']);
  assert.deepEqual(chamadas[0].conteudo, PDF);
  await new Promise(ok => setTimeout(ok, 50));
  assert.deepEqual(fs.readdirSync(pasta).filter(n => n.startsWith('elegance-imp-')), [], 'o temporário foi removido');
  // falha do programa vira 500 em português, sem vazar caminho
  const falha = criarImpressao({ lerConfig: () => ({ sumatra: exe }), tmp: pasta, executar: async () => { throw Object.assign(new Error('x'), { code: 'ENOENT' }); } });
  const f = await falha.imprimir(PDF);
  assert.equal(f.status, 500); assert.match(f.corpo.error, /impressora/);
  assert.equal((await falha.imprimir(Buffer.from('MZ....'))).status, 400);
  fs.rmSync(pasta, { recursive: true, force: true });
});

test('local: a rota POST /imprimir existe, só aceita a origem do site e /ping informa imprimir', async t => {
  process.env.ELEGANCE_RAIZ = path.join(os.tmpdir(), 'elegance-imp-raiz');
  const { servidor } = require('../local/salvador_pdf');
  await new Promise(ok => servidor.listen(0, '127.0.0.1', ok));
  t.after(() => servidor.close());
  const base = `http://127.0.0.1:${servidor.address().port}`;
  const ping = await (await fetch(base + '/ping')).json();
  assert.equal(typeof ping.imprimir, 'boolean');
  assert.equal((await fetch(base + '/imprimir', { method: 'POST', body: PDF, headers: { Origin: 'https://site-estranho.com' } })).status, 403);
  const r = await fetch(base + '/imprimir', { method: 'POST', body: PDF, headers: { Origin: 'https://thiagozmb.github.io' } });
  // sem impressao.config.json neste ambiente de teste: 503 ("não configurada"); com ele, 200 ou 500; nunca 404
  assert.notEqual(r.status, 404);
  if (!ping.imprimir) assert.equal(r.status, 503);
  assert.match(ler('local/instalar_salvador_pdf.ps1'), /'impressao\.js'[^\n]*'impressao\.config\.exemplo\.json'/);
});

// ---------- site ----------
function carregar({ respostas = {}, criados = [] } = {}) {
  const chamadas = [];
  const janela = {};
  const fetch = async (url, opcoes = {}) => {
    chamadas.push({ url: String(url), metodo: opcoes.method || 'GET' });
    const r = respostas[String(url).replace(/\?.*$/, '')] || respostas.padrao;
    if (!r) throw new Error('sem rede');
    return r;
  };
  const quadro = { className: '', setAttribute() {}, remove() {}, addEventListener(ev, f) { if (ev === 'load') quadro.aoCarregar = f; },
    contentWindow: { focus() {}, print() { criados.push('print'); } } };
  Object.defineProperty(quadro, 'src', { set() { setTimeout(() => quadro.aoCarregar && quadro.aoCarregar(), 0); } });
  const doc = { createElement: () => quadro, body: { appendChild() {} } };
  const ctx = { window: janela, document: doc, fetch, location: {}, localStorage: { removeItem() {} }, alert() {}, AbortSignal, URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
    setTimeout: (f, ms) => setTimeout(f, Math.min(ms, 5)), clearTimeout, encodeURIComponent, Blob };
  vm.runInNewContext(ler('impressao_pdf.js'), ctx);
  return { I: janela.ImpressaoPdf, chamadas, criados };
}
const resp = (status, corpo, json) => ({ status, ok: status >= 200 && status < 300, blob: async () => new Blob([corpo]), json: async () => json || {} });
const cfg = { apiBase: 'https://api.teste', loginUrl: 'login.html', token: () => 'tok' };

test('opções: Imprimir o pedido, Guia, Vidros e Checklist, cada uma só com a permissão; URLs das rotas existentes', () => {
  const { I } = carregar();
  assert.deepEqual(Array.from(I.opcoesDisponiveis(() => true).map(o => o.rotulo)), ['Imprimir o pedido', 'Guia de produção', 'Vidros', 'Checklist']);
  assert.deepEqual(Array.from(I.opcoesDisponiveis(p => p === 'pedidos.pdf').map(o => o.id)), ['pedido', 'guia', 'vidros']);
  assert.deepEqual(Array.from(I.opcoesDisponiveis(p => p === 'pedidos.checklist').map(o => o.id)), ['checklist']);
  assert.equal(I.opcoesDisponiveis(() => false).length, 0);
  assert.equal(I.urlDaOpcao('pedido', 12, 'https://a'), 'https://a/dados_pdf?numero=12&tipo=Pedido');
  assert.equal(I.urlDaOpcao('guia', 12, 'https://a'), 'https://a/dados_pdf?numero=12&tipo=Pedido&producao=1');
  assert.equal(I.urlDaOpcao('vidros', 12, 'https://a'), 'https://a/dados_pdf_vidros?numero=12');
  assert.equal(I.urlDaOpcao('checklist', 12, 'https://a'), 'https://a/checklist/pdf');
});

test('imprimir: com o serviço do PC pronto envia a ele (sem iframe nem diálogo); sem ele cai no iframe oculto + print()', async () => {
  const pdf = resp(200, '%PDF-1.4 x');
  let c = carregar({ respostas: { 'https://api.teste/dados_pdf': pdf, 'http://127.0.0.1:3917/ping': resp(200, '', { ok: true, imprimir: true }), 'http://127.0.0.1:3917/imprimir': resp(200, '', { ok: true }) } });
  let r = await c.I.imprimir('https://api.teste/dados_pdf?numero=1&tipo=Pedido', cfg);
  assert.equal(JSON.stringify({ ok: r.ok, via: r.via }), JSON.stringify({ ok: true, via: 'local' }));
  assert.ok(c.chamadas.some(x => x.url.endsWith('/imprimir') && x.metodo === 'POST'));
  assert.equal(c.criados.length, 0, 'nenhuma caixa de impressão do navegador');
  // serviço do PC sem impressão configurada: navegador
  c = carregar({ respostas: { 'https://api.teste/dados_pdf': pdf, 'http://127.0.0.1:3917/ping': resp(200, '', { ok: true, imprimir: false }) } });
  r = await c.I.imprimir('https://api.teste/dados_pdf?numero=1', cfg);
  assert.equal(JSON.stringify({ ok: r.ok, via: r.via }), JSON.stringify({ ok: true, via: 'navegador' }));
  assert.equal(c.criados.join(), 'print');
  // serviço do PC falha: cai no navegador e conta o motivo
  c = carregar({ respostas: { 'https://api.teste/dados_pdf': pdf, 'http://127.0.0.1:3917/ping': resp(200, '', { imprimir: true }), 'http://127.0.0.1:3917/imprimir': resp(500, '', { error: 'Sem papel' }) } });
  r = await c.I.imprimir('https://api.teste/dados_pdf?numero=1', cfg);
  assert.equal(r.via, 'navegador'); assert.equal(r.aviso, 'Sem papel'); assert.equal(c.criados.join(), 'print');
});

test('imprimir: pedido sem vidros (404) é "nada a imprimir", erro do servidor e arquivo que não é PDF são erros; o token vai no cabeçalho', async () => {
  const c = carregar({ respostas: {
    'https://api.teste/dados_pdf_vidros': resp(404, '', { error: 'Este pedido não tem vidros.' }),
    'https://api.teste/dados_pdf': resp(500, ''), 'https://api.teste/checklist/pdf': resp(200, '<html>'), 'http://127.0.0.1:3917/ping': resp(500, '') } });
  let r = await c.I.imprimir('https://api.teste/dados_pdf_vidros?numero=1', cfg);
  assert.equal(JSON.stringify({ ok: r.ok, semDocumento: r.semDocumento }), JSON.stringify({ ok: false, semDocumento: true }));
  assert.match(c.I.textoResultado(r), /^Nada a imprimir: Este pedido não tem vidros/);
  r = await c.I.imprimir('https://api.teste/dados_pdf?numero=1', cfg);
  assert.equal(r.ok, false); assert.match(c.I.textoResultado(r), /^Erro: Erro 500/);
  r = await c.I.imprimir('https://api.teste/checklist/pdf', cfg);
  assert.equal(r.ok, false); assert.match(r.erro, /não devolveu um PDF/);
  assert.equal(c.criados.length, 0);
});

test('impressao_pdf.js: sem innerHTML, sem window.open, sem estilo solto; estilos ip-* no tema.css', () => {
  const src = ler('impressao_pdf.js');
  assert.ok(!/innerHTML|window\.open|style\.|cssText/.test(src));
  for (const c of ['.ip-caixa', '.ip-linha', '.ip-estado', '.ip-oculto', '.ip-ok', '.ip-erro']) assert.ok(ler('tema.css').includes(c), c);
  for (const t of ['Imprimir selecionados', 'Concluir']) assert.ok(src.includes(t), t);
});

test('telas: script carregado onde há impressão, CSP de orcamentos.html libera frame blob:, menus imprimem direto (checklist inclusive)', () => {
  for (const f of ['orcamentos.html', 'painel_inicial.html', 'inicio.html', 'calendario.html', 'calendario_dia.html']) assert.ok(ler(f).includes('<script src="impressao_pdf.js'), f);
  const csp = ler('orcamentos.html').match(/Content-Security-Policy" content="([^"]+)"/)[1];
  assert.match(csp, /frame-src blob:/); assert.match(csp, /connect-src[^;]*http:\/\/127\.0\.0\.1:3917/);
  for (const f of ['inicio_menu.js', 'painel_inicial.html']) {
    const s = ler(f);
    assert.ok(/'Imprimir checklist', \(\) => imprimirPdf\(`\$\{(cfg\.apiBase|API_BASE)\}\/checklist\/pdf`\)\)/.test(s), f + ': checklist imprime direto');
    assert.ok(s.includes('window.ImpressaoPdf.imprimirComAviso('), f);
  }
});

test('orcamentos.html: orçamento virou pedido = tela vai para o Pedido (abrirDocumento) e abre as opções de impressão; salvar pedido novo também; sem navegação', () => {
  const o = ler('orcamentos.html');
  assert.ok(o.includes('aoEditar: n => abrirPedidoCriado(n, numeroOrc, cliente)') && o.includes('aoEnviar: n => abrirPedidoCriado(n, numeroOrc, cliente)'));
  assert.match(o, /async function abrirPedidoCriado[\s\S]{0,400}abrirDocumento\('Pedido', n, \{ confirmar: false, silencioso: true \}\)[\s\S]{0,400}await opcoesImpressao\(n, cliente\)/);
  assert.match(o, /window\.ImpressaoPdf\.painel\(\{ numero: n, cliente,[^\n]*pode: p => window\.Acesso\.pode\(p\)/);
  assert.match(o, /if \(json\.tipo === 'Pedido' && \(modo === 'novo' \|\| converte\)\) await opcoesImpressao\(/);
  // o abrirDocumento põe o alternador em Pedido e o número na caixa
  assert.ok(o.includes("escolherOpcao('ped-tipo', c.tipo)") && o.includes('sincronizarTipoToggle();') && o.includes("$s('ped-numero').value = docAberto ? String(docAberto.numero) : '';"));
  const gravar = o.slice(o.indexOf('async function gravar(modo)'), o.indexOf('Aviso do servidor (avisos.precoDivergente)'));
  assert.ok(!/location\.href\s*=(?!\s*LOGIN_URL)/.test(gravar), 'salvar não navega para outra página');
});

test('painel_inicial.html: ao gerar pedido a partir de orçamento oferece as mesmas opções; "enviar" fica na lista e "editar" só abre o pedido depois', () => {
  const p = ler('painel_inicial.html');
  assert.ok(p.includes('const opcoesImpressao = (n, cliente) => window.ImpressaoPdf.painel('));
  assert.ok(p.includes('aoEnviar: async n => { carregar(); await opcoesImpressao(n, x.cliente); }'));
  assert.match(p, /aoEditar: async n => \{ await opcoesImpressao\(n, x\.cliente\); location\.href = `orcamentos\.html\?abrir=Pedido\//);
  assert.ok(ler('virar_pedido.js').includes('await aoEnviar(numeroNovo)'));
});
