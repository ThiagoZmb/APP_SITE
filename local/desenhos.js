'use strict';
// "Ver desenho": PDFs dos desenhos do SketchUp de cada pedido, numa pasta de rede da empresa. Só o serviço local do PC enxerga
// essa pasta (o servidor da API no Render não). Somente LEITURA: lista os arquivos do pedido e entrega o PDF escolhido.
//   GET /desenhos?numero=22125            -> { ok, pasta, arquivos: [{ nome, tamanho, modificado }] } (mais recente primeiro)
//   GET /desenhos/arquivo?nome=22125(1).pdf -> o PDF (inline)
// Um arquivo é do pedido quando o nome começa com o número e logo depois NÃO vem outro dígito (22125.pdf, 22125(2).pdf,
// 22125_Cliente.pdf; "221" nunca pega 2210). O nome pedido precisa existir na listagem da pasta: nunca vira caminho.
// Variável opcional: ELEGANCE_DESENHOS (padrão = a pasta "Para conferir PDF" do servidor da empresa).
const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const path = require('node:path');

const PASTA_PADRAO = '\\\\pc-serverdell\\SERVIDOR ELEGANCE\\ELEGANCE\\DESENHOS SKETCHUP\\Exportados\\Para conferir PDF';
const MAX_ARQUIVOS = 50;

const numeroValido = v => typeof v === 'string' && /^\d{1,9}$/.test(v);
const ehPdf = nome => /\.pdf$/i.test(nome);
const doPedido = (nome, numero) => ehPdf(nome) && nome.startsWith(numero) && !/^\d/.test(nome.slice(numero.length));

const html = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Página com todos os PDFs do pedido empilhados (cada um num quadro de tela cheia, o mais recente primeiro). Só texto escapado; sem script.
function paginaTodos(numero, arquivos) {
  const quadros = arquivos.map(a => `<section><h2>${html(a.nome)}</h2><iframe src="/desenhos/arquivo?nome=${encodeURIComponent(a.nome)}" title="${html(a.nome)}"></iframe></section>`).join('\n');
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Desenhos do pedido ${html(numero)}</title>
<style>body{margin:0;background:#1c1c1e;color:#f2f2f7;font:14px system-ui,sans-serif}h1{margin:0;padding:10px 14px;font-size:16px}
section{padding:0 14px 14px}h2{margin:10px 0 6px;font-size:14px;font-weight:600}iframe{width:100%;height:calc(100vh - 70px);border:0;background:#fff;border-radius:6px}</style></head>
<body><h1>Pedido ${html(numero)} · ${arquivos.length} desenho(s)</h1>
${quadros || '<p style="padding:14px">Nenhum desenho encontrado.</p>'}</body></html>`;
}

function criarDesenhos({ pasta = process.env.ELEGANCE_DESENHOS || PASTA_PADRAO } = {}) {
  async function listar(numero) {
    if (!numeroValido(numero)) throw Object.assign(new Error('Número de pedido inválido'), { status: 400 });
    let nomes;
    try { nomes = await fs.readdir(pasta); }
    catch (e) { throw Object.assign(new Error('Não foi possível abrir a pasta dos desenhos neste PC (' + (e.code || e.message) + '). Confira se o servidor da empresa está acessível.'), { status: 503 }); }
    const achados = [];
    for (const nome of nomes.filter(n => doPedido(n, numero))) {
      try { const s = await fs.stat(path.join(pasta, nome)); if (s.isFile()) achados.push({ nome, tamanho: s.size, modificado: s.mtime.toISOString() }); } catch { /* sumiu entre a lista e o stat */ }
    }
    achados.sort((a, b) => b.modificado.localeCompare(a.modificado) || a.nome.localeCompare(b.nome, 'pt-BR', { numeric: true }));
    return achados.slice(0, MAX_ARQUIVOS);
  }

  // Resolve o nome para o caminho SÓ se ele constar na pasta (nada de "..", barras ou unidades vindos da tela).
  async function resolver(nome) {
    if (typeof nome !== 'string' || !ehPdf(nome) || nome.length > 200 || /[\\/:*?"<>|\x00-\x1f]/.test(nome)) return null;
    let nomes;
    try { nomes = await fs.readdir(pasta); } catch { return null; }
    const achado = nomes.find(n => n === nome);
    return achado ? path.join(pasta, achado) : null;
  }

  async function tratar(req, res, url, { responder }) {
    if (req.method !== 'GET') return responder(res, 405, { error: 'Método não permitido' });
    try {
      if (url.pathname === '/desenhos') {
        return responder(res, 200, { ok: true, pasta, arquivos: await listar(url.searchParams.get('numero')) });
      }
      if (url.pathname === '/desenhos/ver') { // uma única aba com TODOS os desenhos do pedido (o navegador bloqueia várias abas de um clique só)
        const numero = url.searchParams.get('numero');
        const arquivos = await listar(numero);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'none'; frame-src 'self'; style-src 'unsafe-inline'" });
        return res.end(paginaTodos(numero, arquivos));
      }
      if (url.pathname === '/desenhos/arquivo') {
        const caminho = await resolver(url.searchParams.get('nome'));
        if (!caminho) return responder(res, 404, { error: 'Desenho não encontrado' });
        const s = await fs.stat(caminho);
        res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': s.size, 'Content-Disposition': 'inline', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
        const fluxo = createReadStream(caminho);
        fluxo.on('error', () => res.destroy());
        return fluxo.pipe(res);
      }
      return responder(res, 404, { error: 'Rota não encontrada' });
    } catch (e) {
      return responder(res, e.status || 500, { error: e.status ? e.message : 'Não foi possível ler o desenho: ' + (e.code || e.message) });
    }
  }

  return { listar, resolver, tratar, pasta };
}

module.exports = { criarDesenhos, paginaTodos, doPedido, numeroValido, PASTA_PADRAO };
