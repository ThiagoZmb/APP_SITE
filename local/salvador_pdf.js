// Serviço local do PC da empresa: grava os PDFs do sistema web nas pastas do VB (Module1.vb), sem perguntar nada.
//   C:\Programa Elegance\Pedidos(PDF) | Orçamentos(PDF) | Produção | Vidros_Produção   (criadas se não existirem)
// Só escuta em 127.0.0.1 e só aceita pedidos vindos do site do sistema. node local/salvador_pdf.js
// A gravação de PDF não tem dependências; as notas de compra pela SEFAZ (sefaz.js) usam as de local/package.json.
// Variáveis opcionais: ELEGANCE_RAIZ (padrão C:\Programa Elegance), ELEGANCE_PORTA_PDF (padrão 3917).
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');

const RAIZ = process.env.ELEGANCE_RAIZ || 'C:\\Programa Elegance';
const PORTA = Number(process.env.ELEGANCE_PORTA_PDF) || 3917;
const LIMITE = 25 * 1024 * 1024;
// mesmas pastas de Caminho_PDF_* do Module1.vb (a web manda só o nome da pasta; qualquer outro valor é recusado)
const PASTAS = new Set(['Pedidos(PDF)', 'Orçamentos(PDF)', 'Produção', 'Vidros_Produção']);
const ORIGENS = new Set(['https://thiagozmb.github.io', 'http://localhost:3000', 'http://127.0.0.1:3000']);
// Notas de compra pela SEFAZ (local/sefaz.js, rotas /sefaz/*). O certificado e a senha ficam só neste PC.
// Se o módulo faltar (instalação antiga), o salvador de PDF continua funcionando e /sefaz/* responde 503.
let sefaz = null;
try { sefaz = require('./sefaz').criarSefaz({ raiz: RAIZ }); } catch { sefaz = null; }

function nomeValido(nome) {
  return typeof nome === 'string' && nome.length > 4 && nome.length <= 200 && /\.pdf$/i.test(nome)
    && !/[\\/:*?"<>|\x00-\x1f]/.test(nome) && nome !== '.' && !nome.startsWith('..');
}

function cabecalhos(res, origem) {
  res.setHeader('Access-Control-Allow-Origin', origem);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
}

function responder(res, status, corpo) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(corpo));
}

function lerCorpo(req) {
  return new Promise((ok, falha) => {
    const partes = []; let total = 0;
    req.on('data', c => {
      total += c.length;
      if (total > LIMITE) { falha(Object.assign(new Error('PDF grande demais'), { status: 413 })); req.destroy(); return; }
      partes.push(c);
    });
    req.on('end', () => ok(Buffer.concat(partes)));
    req.on('error', falha);
  });
}

const servidor = http.createServer(async (req, res) => {
  const origem = req.headers.origin || '';
  if (origem && !ORIGENS.has(origem)) return responder(res, 403, { error: 'Origem não permitida' });
  if (origem) cabecalhos(res, origem);
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  const url = new URL(req.url, 'http://127.0.0.1');
  try {
    if (url.pathname.startsWith('/sefaz/')) {
      if (!sefaz) return responder(res, 503, { error: 'O módulo da SEFAZ não está instalado neste PC. Rode de novo o instalador do serviço local.' });
      return await sefaz.tratar(req, res, url, { origemPermitida: !!origem && ORIGENS.has(origem) });
    }
    if (req.method === 'GET' && url.pathname === '/ping') return responder(res, 200, { ok: true, raiz: RAIZ, sefaz: !!sefaz });
    if (req.method === 'PUT' && url.pathname === '/pdf') {
      const pasta = url.searchParams.get('pasta'), nome = url.searchParams.get('nome');
      if (!PASTAS.has(pasta)) return responder(res, 400, { error: 'Pasta não permitida' });
      if (!nomeValido(nome)) return responder(res, 400, { error: 'Nome de arquivo inválido' });
      const corpo = await lerCorpo(req);
      if (corpo.length < 5 || corpo.subarray(0, 5).toString('latin1') !== '%PDF-') return responder(res, 400, { error: 'O arquivo não é um PDF' });
      const dir = path.join(RAIZ, pasta);
      await fs.mkdir(dir, { recursive: true });
      const destino = path.join(dir, nome);
      await fs.writeFile(destino, corpo);
      return responder(res, 200, { ok: true, caminho: destino });
    }
    responder(res, 404, { error: 'Rota não encontrada' });
  } catch (e) {
    responder(res, e.status || 500, { error: e.status ? e.message : 'Não foi possível gravar o PDF: ' + (e.code || e.message) });
  }
});

if (require.main === module) {
  servidor.on('error', e => { console.error(e.code === 'EADDRINUSE' ? `A porta ${PORTA} já está em uso (o serviço já está rodando?).` : e.message); process.exit(1); });
  servidor.listen(PORTA, '127.0.0.1', () => console.log(`Salvador de PDF ativo em http://127.0.0.1:${PORTA} → ${RAIZ}`));
}

module.exports = { servidor, nomeValido, PASTAS, RAIZ, sefaz };
