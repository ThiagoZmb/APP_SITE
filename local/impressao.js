// Impressão automática de PDF pelo PC da empresa: recebe o PDF pronto do site (POST /imprimir, corpo %PDF-) e o envia à impressora
// pelo SumatraPDF (-print-to-default / -print-to), sem abrir janela nem diálogo. Sem dependências npm.
// Só funciona se o dono instalar o SumatraPDF e criar impressao.config.json ao lado do serviço (exemplo: impressao.config.exemplo.json):
//   { "sumatra": "C:\\Program Files\\SumatraPDF\\SumatraPDF.exe", "impressora": "nome no Windows (opcional; sem ele, a padrão)" }
// A impressora e o programa vêm SÓ deste arquivo, nunca da requisição. Sem o arquivo, /imprimir responde 503 e o site usa a
// impressão do navegador (iframe oculto + print(), com a caixa de impressão do sistema).
// O processo carrega este módulo em salvador_pdf.js; se faltar, o resto continua e /imprimir responde 503.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

const LIMITE = 25 * 1024 * 1024;
const TEMPO = 60 * 1000;
const NOME_VIRTUAL = /print to pdf|xps|onenote|fax|for developers/i;

// Confere o conteúdo do arquivo de configuração e devolve { sumatra, impressora } ou { erro }.
function validarConfig(cfg, existe = fs.existsSync) {
  if (!cfg || typeof cfg !== 'object') return { erro: 'impressao.config.json ausente ou inválido.' };
  const sumatra = typeof cfg.sumatra === 'string' ? cfg.sumatra.trim() : '';
  if (!sumatra || !path.isAbsolute(sumatra) || !/(^|[\\/])sumatrapdf[^\\/]*\.exe$/i.test(sumatra)) return { erro: 'O campo "sumatra" de impressao.config.json deve ser o caminho completo do SumatraPDF.exe.' };
  if (!existe(sumatra)) return { erro: `O SumatraPDF não foi encontrado em ${sumatra}.` };
  const impressora = cfg.impressora == null ? '' : String(cfg.impressora).trim();
  if (impressora && (impressora.startsWith('-') || /[\x00-\x1f"]/.test(impressora))) return { erro: 'Nome de impressora inválido em impressao.config.json.' };
  if (impressora && NOME_VIRTUAL.test(impressora)) return { erro: `A impressora "${impressora}" é virtual (gera arquivo), não imprime no papel.` };
  return { sumatra, impressora };
}

// Argumentos do SumatraPDF (execFile, sem shell): impressora padrão ou a do arquivo de configuração.
const argumentos = (impressora, arquivo) => [...(impressora ? ['-print-to', impressora] : ['-print-to-default']), '-silent', arquivo];

function criarImpressao({ lerConfig, executar, tmp = os.tmpdir() } = {}) {
  const ler = lerConfig || (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'impressao.config.json'), 'utf8')); } catch { return null; } });
  const rodar = executar || ((exe, args) => new Promise((ok, falha) => execFile(exe, args, { timeout: TEMPO, windowsHide: true }, e => (e ? falha(e) : ok()))));
  const configurada = () => !validarConfig(ler()).erro;

  // devolve { status, corpo }
  async function imprimir(pdf) {
    const c = validarConfig(ler());
    if (c.erro) return { status: 503, corpo: { error: 'Impressão automática não configurada neste PC. ' + c.erro, configurada: false } };
    if (!Buffer.isBuffer(pdf) || pdf.length < 5 || pdf.subarray(0, 5).toString('latin1') !== '%PDF-') return { status: 400, corpo: { error: 'O arquivo não é um PDF' } };
    if (pdf.length > LIMITE) return { status: 413, corpo: { error: 'PDF grande demais' } };
    let dir = null;
    try {
      dir = await fs.promises.mkdtemp(path.join(tmp, 'elegance-imp-'));
      const arquivo = path.join(dir, 'documento.pdf');
      await fs.promises.writeFile(arquivo, pdf);
      await rodar(c.sumatra, argumentos(c.impressora, arquivo));
      return { status: 200, corpo: { ok: true, impressora: c.impressora || '(padrão do Windows)' } };
    } catch (e) {
      return { status: 500, corpo: { error: 'Não foi possível enviar à impressora: ' + (e.code || e.message) } };
    } finally { if (dir) fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {}); }
  }
  return { imprimir, configurada };
}

module.exports = { criarImpressao, validarConfig, argumentos, LIMITE };
