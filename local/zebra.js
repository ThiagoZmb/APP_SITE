// Impressão de etiquetas na Zebra (USB, instalada no Windows): recebe o ZPL pronto do site e o envia RAW ao spooler.
// Sem dependências npm. A impressora vem SÓ de zebra.config.json ({ "impressora": "nome no Windows" }) ou, sem ele, da única
// Zebra/ZDesigner em porta real (USB de preferência); impressora de arquivo/virtual é sempre recusada; nunca do corpo da requisição.
// O processo carrega este módulo em salvador_pdf.js; se faltar, o salvador de PDF segue funcionando e /etiqueta responde 503.
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const LIMITE_ZPL = 1024 * 1024;
const LIMITE_CORPO = 2 * 1024 * 1024; // o JSON escapa o ZPL, então o corpo pode passar um pouco do limite do ZPL

function validarZpl(zpl) {
  if (typeof zpl !== 'string') return { ok: false, motivo: 'Informe o zpl.' };
  if (Buffer.byteLength(zpl, 'utf8') > LIMITE_ZPL) return { ok: false, motivo: 'ZPL grande demais.' };
  const t = zpl.trim();
  if (!t.startsWith('^XA') || !t.endsWith('^XZ')) return { ok: false, motivo: 'O texto não é uma etiqueta ZPL (^XA…^XZ).' };
  return { ok: true };
}

// Impressoras que NÃO imprimem de verdade: porta de arquivo/virtual (FILE:, PORTPROMPT:, .prn/.txt/.pdf/.xps) ou nome de
// impressora virtual. Foi o que aconteceu em 2026-11-12: "ZDesigner for Developers - Generic Printer" (porta FILE:) gravou
// Documentos\Etiqueta Elegance.prn e nada saiu na Zebra.
const PORTA_VIRTUAL = /^(file:|portprompt:|nul:?)|\.(prn|txt|pdf|xps|oxps)$/i;
const NOME_VIRTUAL = /print to pdf|xps|onenote|fax|for developers|generic \/ text only/i;
const ehVirtual = p => PORTA_VIRTUAL.test(p.porta) || NOME_VIRTUAL.test(p.nome) || NOME_VIRTUAL.test(p.driver);
const ehZebra = p => /zebra|zdesigner|zpl/i.test(p.nome) || /zebra|zdesigner|zpl/i.test(p.driver);
const ehUsb = p => /^usb/i.test(p.porta);
const estaPronta = p => !p.offline && !/offline|error|paused|pendingdeletion|notavailable|unknown/i.test(p.status);

// aceita nome puro (formato antigo) ou { nome, porta, driver, status, offline }
function normalizar(lista) {
  return (lista || []).map(i => (typeof i === 'string' ? { nome: i } : i || {})).map(i => ({
    nome: String(i.nome ?? '').trim(), porta: String(i.porta ?? '').trim(), driver: String(i.driver ?? '').trim(),
    status: String(i.status ?? '').trim(), offline: i.offline === true
  })).filter(i => i.nome);
}
const descrever = lista => lista.map(p => `"${p.nome}" (porta ${p.porta || '?'})`).join('; ');

// Devolve { impressora } (com nome e porta) ou { erro }. Nunca devolve impressora virtual/de arquivo e nunca adivinha entre
// várias candidatas.
function escolherImpressora(itens, config) {
  const lista = normalizar(itens);
  const pedida = String(config?.impressora ?? '').trim();
  if (pedida) {
    const p = lista.find(i => i.nome.toLowerCase() === pedida.toLowerCase());
    if (!p) return { erro: `A impressora "${pedida}" de zebra.config.json não está instalada neste PC. Instaladas: ${descrever(lista) || 'nenhuma'}.` };
    if (ehVirtual(p)) return { erro: `A impressora "${p.nome}" (porta ${p.porta || '?'}) é virtual ou imprime em arquivo, não na Zebra. Troque o nome em zebra.config.json pela Zebra USB real (veja http://127.0.0.1:3917/impressoras).` };
    return { impressora: p };
  }
  const candidatas = lista.filter(p => ehZebra(p) && !ehVirtual(p));
  let pool = candidatas.filter(p => ehUsb(p) && estaPronta(p));
  if (!pool.length) pool = candidatas.filter(estaPronta);
  if (pool.length === 1) return { impressora: pool[0] };
  if (pool.length > 1) return { erro: `Há mais de uma impressora Zebra possível: ${descrever(pool)}. Fixe a correta em zebra.config.json ({ "impressora": "nome" }); veja http://127.0.0.1:3917/impressoras.` };
  return { erro: `Nenhuma impressora Zebra USB encontrada; instaladas: ${descrever(lista) || 'nenhuma'}. Ligue a Zebra ou informe o nome dela em zebra.config.json (veja http://127.0.0.1:3917/impressoras).` };
}

// Diagnóstico somente leitura (GET /impressoras): cada impressora com os critérios e a escolha que seria feita.
function diagnosticar(itens, config) {
  const lista = normalizar(itens);
  const escolha = escolherImpressora(lista, config);
  return {
    impressoras: lista.map(p => ({
      nome: p.nome, porta: p.porta, driver: p.driver, status: p.status, offline: p.offline,
      virtual: ehVirtual(p), zebra: ehZebra(p), usb: ehUsb(p), pronta: estaPronta(p), candidata: ehZebra(p) && !ehVirtual(p)
    })),
    configurada: String(config?.impressora ?? '').trim() || null,
    escolhida: escolha.impressora ? { nome: escolha.impressora.nome, porta: escolha.impressora.porta } : null,
    problema: escolha.erro || null
  };
}

function lerConfig() {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'zebra.config.json'), 'utf8')); } catch { return {}; }
}

// ---- PowerShell (só roda no Windows do PC da empresa; os testes trocam por falsos) ----
const SCRIPT_ENVIO = `
[Console]::OutputEncoding = [Text.Encoding]::UTF8; $ErrorActionPreference = 'Stop'; $ProgressPreference = 'SilentlyContinue'
try {
$src = @"
using System; using System.Runtime.InteropServices;
public class RawPrn {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DOCINFO { public string pDocName; public string pOutputFile; public string pDataType; }
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool OpenPrinter(string n, out IntPtr h, IntPtr d);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool StartDocPrinter(IntPtr h, int l, [In] DOCINFO di);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool WritePrinter(IntPtr h, byte[] b, int c, out int w);
  public static void Send(string printer, byte[] bytes) {
    IntPtr h;
    if (!OpenPrinter(printer, out h, IntPtr.Zero)) throw new Exception("OpenPrinter falhou: " + Marshal.GetLastWin32Error());
    try {
      DOCINFO di = new DOCINFO(); di.pDocName = "Etiqueta Elegance"; di.pDataType = "RAW";
      if (!StartDocPrinter(h, 1, di)) throw new Exception("StartDocPrinter falhou: " + Marshal.GetLastWin32Error());
      try {
        StartPagePrinter(h);
        int w;
        if (!WritePrinter(h, bytes, bytes.Length, out w) || w != bytes.Length) throw new Exception("WritePrinter falhou: " + Marshal.GetLastWin32Error());
        EndPagePrinter(h);
      } finally { EndDocPrinter(h); }
    } finally { ClosePrinter(h); }
  }
}
"@
Add-Type -TypeDefinition $src
$b64 = [Console]::In.ReadToEnd().Trim()
[RawPrn]::Send($env:ELEGANCE_IMPRESSORA, [Convert]::FromBase64String($b64))
} catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }
`;

// Roda um programa e devolve o texto da saída. Se o filho sair sem ler a entrada (Add-Type falhou, timeout), a escrita no
// stdin dá EPIPE/EOF; sem este tratador isso seria um 'error' sem dono e derrubaria o serviço inteiro (PDF e SEFAZ junto).
// O erro de verdade chega pelo callback do execFile.
function executar(exe, args, { entrada, env } = {}) {
  return new Promise((ok, falha) => {
    const filho = execFile(exe, args,
      { windowsHide: true, timeout: 30000, env: { ...process.env, ...env } },
      (erro, saida, saidaErro) => (erro ? falha(new Error((String(saidaErro).trim() || erro.message).split('\n')[0])) : ok(String(saida))));
    filho.stdin.on('error', () => {});
    if (entrada !== undefined) filho.stdin.end(entrada); else filho.stdin.end();
  });
}
const powershell = (args, opcoes) => executar('powershell.exe',
  ['-NoProfile', '-NonInteractive', '-OutputFormat', 'Text', '-ExecutionPolicy', 'Bypass', ...args], opcoes);

// o ZPL vai por stdin em base64 (UTF-8) e o nome da impressora por variável de ambiente: nada do site vira linha de comando
const enviarPadrao = (impressora, zpl) => powershell(
  ['-EncodedCommand', Buffer.from(SCRIPT_ENVIO, 'utf16le').toString('base64')],
  { entrada: Buffer.from(zpl, 'utf8').toString('base64'), env: { ELEGANCE_IMPRESSORA: impressora } }).then(() => {});
const SCRIPT_LISTA = `[Console]::OutputEncoding = [Text.Encoding]::UTF8; @(Get-Printer | ForEach-Object { [pscustomobject]@{ nome = $_.Name; porta = $_.PortName; driver = $_.DriverName; status = [string]$_.PrinterStatus; offline = [bool]$_.WorkOffline } }) | ConvertTo-Json -Compress`;
const listarPadrao = async () => {
  const t = (await powershell(['-Command', SCRIPT_LISTA])).trim();
  if (!t) return [];
  const j = JSON.parse(t);
  return Array.isArray(j) ? j : [j];
};

function responder(res, status, corpo) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(corpo));
}

function lerJson(req) {
  return new Promise((ok, falha) => {
    const partes = []; let total = 0;
    req.on('data', c => {
      total += c.length;
      if (total > LIMITE_CORPO) { falha(Object.assign(new Error('Corpo grande demais'), { status: 413 })); req.destroy(); return; }
      partes.push(c);
    });
    req.on('end', () => { try { ok(JSON.parse(Buffer.concat(partes).toString('utf8') || '{}')); } catch { falha(Object.assign(new Error('JSON inválido'), { status: 400 })); } });
    req.on('error', falha);
  });
}

// Devolve o objeto com `enviar`, `listar` e `config` trocáveis (os testes injetam falsos; em produção valem os padrões).
function criarZebra() {
  const api = {
    enviar: enviarPadrao,
    listar: listarPadrao,
    async diagnostico() { return diagnosticar(await api.listar(), api.config ?? lerConfig()); },
    config: null, // null = lê zebra.config.json a cada impressão (o dono pode editar sem reiniciar)
    async tratar(req, res) {
      try {
        const corpo = await lerJson(req);
        const v = validarZpl(corpo?.zpl);
        if (!v.ok) return responder(res, 400, { error: v.motivo });
        let nomes = [];
        try { nomes = await api.listar(); } catch (e) { return responder(res, 500, { error: 'Não foi possível listar as impressoras do Windows: ' + e.message, impressoras: [] }); }
        const escolha = escolherImpressora(nomes, api.config ?? lerConfig());
        const todas = normalizar(nomes).map(p => ({ nome: p.nome, porta: p.porta }));
        if (!escolha.impressora) return responder(res, 500, { error: escolha.erro, impressoras: todas });
        const { nome, porta } = escolha.impressora;
        try { await api.enviar(nome, corpo.zpl); } catch (e) { return responder(res, 500, { error: 'Não foi possível imprimir: ' + e.message, impressoras: todas }); }
        responder(res, 200, { ok: true, impressora: nome, porta });
      } catch (e) {
        responder(res, e.status || 500, { error: e.status ? e.message : 'Erro ao imprimir: ' + (e.code || e.message) });
      }
    }
  };
  return api;
}

module.exports = { criarZebra, validarZpl, escolherImpressora, diagnosticar, executar };
