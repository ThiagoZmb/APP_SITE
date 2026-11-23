'use strict';
// "Ver desenho": PDFs dos desenhos do SketchUp de cada pedido, numa pasta de rede da empresa. Só o serviço local do PC enxerga
// essa pasta (o servidor da API no Render não). Somente LEITURA: lista os arquivos do pedido e entrega o PDF escolhido.
//   GET /desenhos?numero=22125              -> { ok, pasta, origem, arquivos: [{ nome, pasta, caminho, tamanho, modificado }] } (mais recente primeiro)
//   GET /desenhos/ver?numero=22125          -> página única com todos os desenhos do pedido empilhados
//   GET /desenhos/arquivo?caminho=Prontos/Com nº de Pedido/22125 1.pdf  -> o PDF (inline)
// Onde procura: a raiz "Exportados" tem "Para conferir PDF" (pedidos em andamento), "Prontos" (com subpastas) e "Outros". Primeiro só em
// "Para conferir PDF" (com a subpasta PARTICULARES); se NÃO achar nada, procura em todas as outras pastas e subpastas (pedido já entregue).
// Um arquivo é do pedido quando o nome começa com o número e logo depois NÃO vem outro dígito (22125.pdf, 22125(2).pdf,
// 22125 1.pdf, 22125_Cliente.pdf; "221" nunca pega 2210). O caminho pedido é percorrido pasta por pasta contra a listagem real: nunca vira caminho livre.
// Variáveis opcionais: ELEGANCE_DESENHOS (raiz; padrão = pasta "Exportados" do servidor da empresa), ELEGANCE_DESENHOS_PRINCIPAL (padrão "Para conferir PDF").
const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const path = require('node:path');

const RAIZ_PADRAO = '\\\\pc-serverdell\\SERVIDOR ELEGANCE\\ELEGANCE\\DESENHOS SKETCHUP\\Exportados';
const PRINCIPAL_PADRAO = 'Para conferir PDF';
const MAX_ARQUIVOS = 50;
const MAX_PROFUNDIDADE = 3; // pastas abaixo da raiz (Prontos > Com nº de Pedido já é 2)
const MAX_PASTAS = 200;     // teto de pastas lidas numa busca (proteção contra árvore enorme)

const numeroValido = v => typeof v === 'string' && /^\d{1,9}$/.test(v);
const ehPdf = nome => /\.pdf$/i.test(nome);
const doPedido = (nome, numero) => ehPdf(nome) && nome.startsWith(numero) && !/^\d/.test(nome.slice(numero.length));
const segmentoValido = s => typeof s === 'string' && s.length > 0 && s.length <= 200 && s !== '.' && s !== '..' && !/[\\/:*?"<>|\x00-\x1f]/.test(s);

function criarDesenhos({ pasta = process.env.ELEGANCE_DESENHOS || RAIZ_PADRAO, principal = process.env.ELEGANCE_DESENHOS_PRINCIPAL || PRINCIPAL_PADRAO } = {}) {
  const semAbrir = e => Object.assign(new Error('Não foi possível abrir a pasta dos desenhos neste PC (' + (e.code || e.message) + '). Confira se o servidor da empresa está acessível.'), { status: 503 });

  // Lê UMA pasta (segmentos relativos à raiz): nomes dos arquivos e das subpastas.
  async function lerPasta(relSegmentos) {
    const entradas = await fs.readdir(path.join(pasta, ...relSegmentos), { withFileTypes: true });
    return { arquivos: entradas.filter(e => e.isFile()).map(e => e.name), pastas: entradas.filter(e => e.isDirectory()).map(e => e.name) };
  }

  // Procura os PDFs do pedido em `inicio` (segmentos relativos à raiz) e abaixo; `ignorar` = nome de pasta de 1º nível a pular.
  async function buscar(numero, inicio, { ignorar = '' } = {}) {
    const achados = [];
    let lidas = 0;
    async function visitar(rel, nivel) {
      if (lidas++ >= MAX_PASTAS) return;
      let conteudo;
      try { conteudo = await lerPasta(rel); } catch (e) { if (rel.length === inicio.length && !rel.length) throw semAbrir(e); return; } // subpasta ilegível: segue
      for (const nome of conteudo.arquivos.filter(n => doPedido(n, numero))) {
        try {
          const s = await fs.stat(path.join(pasta, ...rel, nome));
          if (s.isFile()) achados.push({ nome, pasta: rel.join('/'), caminho: [...rel, nome].join('/'), tamanho: s.size, modificado: s.mtime.toISOString() });
        } catch { /* sumiu entre a lista e o stat */ }
      }
      if (nivel >= MAX_PROFUNDIDADE) return;
      for (const sub of conteudo.pastas) { if (rel.length === 0 && sub === ignorar) continue; await visitar([...rel, sub], nivel + 1); }
    }
    await visitar(inicio, inicio.length);
    return achados;
  }

  const ordenar = lista => lista.sort((a, b) => b.modificado.localeCompare(a.modificado) || a.caminho.localeCompare(b.caminho, 'pt-BR', { numeric: true }));

  // { arquivos, origem }: origem = 'conferir' (achou em "Para conferir PDF") | 'outras' (só nas outras pastas) | 'nenhuma'
  async function listarTudo(numero) {
    if (!numeroValido(numero)) throw Object.assign(new Error('Número de pedido inválido'), { status: 400 });
    try { await fs.access(path.join(pasta, principal)); } catch (e) { throw semAbrir(e); }
    const aqui = await buscar(numero, [principal]);
    if (aqui.length) return { arquivos: ordenar(aqui).slice(0, MAX_ARQUIVOS), origem: 'conferir' };
    const fora = await buscar(numero, [], { ignorar: principal });
    return { arquivos: ordenar(fora).slice(0, MAX_ARQUIVOS), origem: fora.length ? 'outras' : 'nenhuma' };
  }
  const listar = async numero => (await listarTudo(numero)).arquivos;

  // Resolve o caminho relativo ("Prontos/Com nº de Pedido/x.pdf") para o caminho real SÓ percorrendo a listagem de cada pasta.
  async function resolver(caminho) {
    if (typeof caminho !== 'string' || caminho.length > 600) return null;
    const partes = caminho.split('/');
    if (partes.length < 1 || partes.length > MAX_PROFUNDIDADE + 1 || !partes.every(segmentoValido) || !ehPdf(partes[partes.length - 1])) return null;
    let atual = pasta;
    for (let i = 0; i < partes.length; i++) {
      let entradas;
      try { entradas = await fs.readdir(atual, { withFileTypes: true }); } catch { return null; }
      const ultimo = i === partes.length - 1;
      const achada = entradas.find(e => e.name === partes[i] && (ultimo ? e.isFile() : e.isDirectory()));
      if (!achada) return null;
      atual = path.join(atual, achada.name);
    }
    return atual;
  }

  async function tratar(req, res, url, { responder }) {
    if (req.method !== 'GET') return responder(res, 405, { error: 'Método não permitido' });
    try {
      if (url.pathname === '/desenhos') {
        const r = await listarTudo(url.searchParams.get('numero'));
        return responder(res, 200, { ok: true, pasta, origem: r.origem, arquivos: r.arquivos });
      }
      if (url.pathname === '/desenhos/ver') { // uma única aba com TODOS os desenhos do pedido (o navegador bloqueia várias abas de um clique só)
        const numero = url.searchParams.get('numero');
        const { arquivos } = await listarTudo(numero);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'none'; frame-src 'self'; style-src 'unsafe-inline'" });
        return res.end(paginaTodos(numero, arquivos));
      }
      if (url.pathname === '/desenhos/arquivo') {
        const caminho = await resolver(url.searchParams.get('caminho'));
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

  return { listar, listarTudo, resolver, tratar, pasta };
}

const html = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Página com todos os PDFs do pedido empilhados (cada um num quadro de tela cheia, o mais recente primeiro). Só texto escapado; sem script.
function paginaTodos(numero, arquivos) {
  const quadros = arquivos.map(a => {
    const rotulo = a.pasta ? `${a.nome}  ·  pasta: ${a.pasta}` : a.nome;
    return `<section><h2>${html(rotulo)}</h2><iframe src="/desenhos/arquivo?caminho=${encodeURIComponent(a.caminho ?? a.nome)}" title="${html(a.nome)}"></iframe></section>`;
  }).join('\n');
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Desenhos do pedido ${html(numero)}</title>
<style>body{margin:0;background:#1c1c1e;color:#f2f2f7;font:14px system-ui,sans-serif}h1{margin:0;padding:10px 14px;font-size:16px}
section{padding:0 14px 14px}h2{margin:10px 0 6px;font-size:14px;font-weight:600}iframe{width:100%;height:calc(100vh - 70px);border:0;background:#fff;border-radius:6px}</style></head>
<body><h1>Pedido ${html(numero)} · ${arquivos.length} desenho(s)</h1>
${quadros || '<p style="padding:14px">Nenhum desenho encontrado.</p>'}</body></html>`;
}

module.exports = { criarDesenhos, paginaTodos, doPedido, numeroValido, RAIZ_PADRAO, PRINCIPAL_PADRAO };
