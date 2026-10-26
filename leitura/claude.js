// ==========================================================================
// Chamada à API do Claude para ler o PDF (SDK oficial @anthropic-ai/sdk).
//  - PDF vai como bloco "document" base64 (a API extrai texto e imagem de cada página; sem poppler);
//  - saída estruturada (output_config.format json_schema) com o schema da skill (leitura.mjs);
//  - streaming + finalMessage: a leitura pode passar de vários minutos sem estourar o tempo do HTTP;
//  - fallbacks "default": se o modelo recusar por política, a API tenta outro modelo na mesma chamada;
//  - o SDK repete sozinho 429/5xx/529 (maxRetries 2).
// A chave vem só do ambiente (ANTHROPIC_API_KEY) e nunca aparece em resposta nem em log:
// os erros viram mensagens fixas (ErroLeitura) e o log só leva classe, status e request id.
// ==========================================================================
const Anthropic = require('@anthropic-ai/sdk');

const MODELO_PADRAO = 'claude-sonnet-5-5';
// modelos em que o parâmetro fallbacks:"default" é aceito na API do Claude
const ACEITAM_FALLBACK = new Set(['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-opus-5', 'claude-fable-5-1']);
const BETA_FALLBACK = 'server-side-fallback-2026-07-01';
const MAX_TOKENS = 64000;
const TEMPO_SDK_MS = 12 * 60 * 1000;

class ErroLeitura extends Error {
  constructor(codigo, mensagem) { super(mensagem); this.codigo = codigo; }
}

const MENSAGENS = {
  nao_configurada: 'Leitura de PDF não configurada no servidor.',
  config: 'A leitura de PDF está mal configurada no servidor (chave ou modelo da API). Avise o administrador.',
  limite: 'O limite de uso da API de leitura foi atingido. Tente de novo mais tarde.',
  grande: 'O PDF é grande demais para a leitura. Envie só as pranchas com as portas.',
  recusado: 'A API não aceitou este PDF (arquivo corrompido, protegido ou com páginas demais).',
  indisponivel: 'O serviço de leitura está indisponível no momento. Tente de novo em alguns minutos.',
  tempo: 'A leitura demorou demais e foi interrompida. Tente de novo ou envie menos páginas.',
  cancelada: 'Leitura cancelada.',
  recusa: 'O modelo se recusou a ler este arquivo.',
  resposta_grande: 'O projeto gerou uma resposta grande demais. Envie menos pranchas por vez.',
  formato: 'A resposta da leitura veio fora do formato esperado.',
};
const erro = codigo => new ErroLeitura(codigo, MENSAGENS[codigo]);

// erro do SDK → ErroLeitura (mensagem fixa, sem detalhes internos)
function traduzirErro(e, sinal) {
  if (e instanceof ErroLeitura) return e;
  if (e instanceof Anthropic.APIUserAbortError || sinal?.aborted) return erro(sinal?.reason === 'tempo' ? 'tempo' : 'cancelada');
  if (e instanceof Anthropic.APIConnectionTimeoutError) return erro('tempo');
  if (e instanceof Anthropic.APIConnectionError) return erro('indisponivel');
  if (e instanceof Anthropic.APIError) {
    const s = e.status;
    if (s === 401 || s === 402 || s === 403 || s === 404) return erro('config');
    if (s === 413) return erro('grande');
    if (s === 429) return erro('limite');
    if (s === 400 || s === 422) return erro('recusado');
    return erro('indisponivel');   // 500, 529 e afins (o SDK já tentou de novo)
  }
  return erro('indisponivel');
}

// texto curto para o log: nunca mensagem do SDK (pode ecoar dados do pedido), nunca a chave
const resumoParaLog = e => `${e?.constructor?.name || 'Erro'}${e?.status ? ` status=${e.status}` : ''}${e?.requestID ? ` request_id=${e.requestID}` : ''}`;

function criarClienteSdk(apiKey) {
  return new Anthropic({ apiKey, maxRetries: 2, timeout: TEMPO_SDK_MS });
}

function montarPedido({ modelo, sistema, esquema, pdfBase64, paginas, errosAnteriores }) {
  const texto = [
    `Leia o projeto técnico anexo${paginas ? ` (${paginas} página(s))` : ''} seguindo as instruções e devolva o JSON no formato pedido.`,
    ...(errosAnteriores?.length ? [
      'Uma leitura anterior deste mesmo arquivo foi recusada pela validação do sistema pelos motivos abaixo. Leia de novo e evite esses erros:',
      ...errosAnteriores.slice(0, 10).map(m => `- ${String(m).slice(0, 300)}`),
    ] : []),
  ].join('\n');
  const pedido = {
    model: modelo,
    max_tokens: MAX_TOKENS,
    system: [{ type: 'text', text: sistema, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: [
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
      { type: 'text', text: texto },
    ] }],
    output_config: { effort: 'high', format: { type: 'json_schema', schema: esquema } },
  };
  // recurso beta: só liga com ANTHROPIC_FALLBACK=1 (sem isso, uma organização sem o beta liberado receberia erro 400 na primeira leitura)
  if (process.env.ANTHROPIC_FALLBACK === '1' && ACEITAM_FALLBACK.has(modelo)) { pedido.betas = [BETA_FALLBACK]; pedido.fallbacks = 'default'; }
  return pedido;
}

const usoDe = u => ({
  entrada: (Number(u?.input_tokens) || 0) + (Number(u?.cache_creation_input_tokens) || 0) + (Number(u?.cache_read_input_tokens) || 0),
  saida: Number(u?.output_tokens) || 0,
});

// → { json (ou null se não for JSON), uso: { entrada, saida }, modelo }. Lança ErroLeitura.
async function lerComClaude({ cliente, modelo, sistema, esquema, pdfBase64, paginas, errosAnteriores, sinal }) {
  let msg;
  try {
    const stream = cliente.beta.messages.stream(montarPedido({ modelo, sistema, esquema, pdfBase64, paginas, errosAnteriores }), { signal: sinal });
    msg = await stream.finalMessage();
  } catch (e) {
    const traduzido = traduzirErro(e, sinal);
    if (!['cancelada'].includes(traduzido.codigo)) console.error(`[leitura_pdf] falha na API: ${resumoParaLog(e)}`);
    throw traduzido;
  }
  const uso = usoDe(msg?.usage);
  if (msg?.stop_reason === 'refusal') throw Object.assign(erro('recusa'), { uso });
  if (msg?.stop_reason === 'max_tokens') throw Object.assign(erro('resposta_grande'), { uso });
  const texto = (Array.isArray(msg?.content) ? msg.content : []).filter(b => b?.type === 'text').map(b => b.text).join('');
  let json = null;
  try { json = JSON.parse(texto); } catch { json = null; }
  return { json, uso, modelo: typeof msg?.model === 'string' ? msg.model : modelo };
}

module.exports = { MODELO_PADRAO, MENSAGENS, ErroLeitura, criarClienteSdk, montarPedido, lerComClaude, traduzirErro };
