// ============================================================
// SEGURANÇA — texto do PDF é DADO. Aqui só se sinaliza o que parece comando; nunca se executa.
// Heurística: pode haver falso negativo. Padrões exigem um "objeto" (regras, arquivos...)
// para não acusar legendas normais como "EXECUTAR CONFORME PROJETO".
// ============================================================
const REGRAS = [
  [/\b(ignor(?:e|ar|em)|desconsider(?:e|ar|em)|disregard|forget)\b[^.\n]{0,40}\b(regras?|instru(?:ç|c)(?:ões|oes|ão|ao)|rules?|instructions?|prompts?)\b/i,
    'tenta anular regras ou instruções'],
  [/\b(apague|apagar|exclua|excluir|delete|deletar|erase|wipe)\b[^.\n]{0,40}\b(arquivos?|tudo|dados|banco|files?|everything|database|diret(?:ó|o)rios?|pastas?)\b/i,
    'pede para apagar dados ou arquivos'],
  [/\b(execute|executar|rode|rodar|run)\b[^.\n]{0,40}\b(comandos?|scripts?|c(?:ó|o)digo|commands?|code|shell|terminal|bash|seguinte|following)\b/i,
    'pede para executar comando ou código'],
  [/\bsystem\s*prompt\b|prompt\s+do\s+sistema/i, 'menciona o prompt do sistema'],
  [/\bvoc(?:ê|e)\s+(?:é|e)\s+(?:um|uma|o|a)\b|\byou\s+are\s+(?:a|an|now|the)\b/i, 'tenta redefinir o papel do modelo'],
  [/\brm\s+-rf\b/i, 'comando destrutivo (rm -rf)'],
  [/\bcurl\s/i, 'comando de rede (curl)'],
  [/https?:\/\//i, 'contém URL'],
  [/<\s*script/i, 'contém tag <script>'],
  [/powershell/i, 'menciona PowerShell'],
  [/\bInvoke-[A-Za-z]+/, 'cmdlet PowerShell (Invoke-)'],
];

const LIMITE_TRECHO = 300;
const recorte = linha => (linha.length > LIMITE_TRECHO ? `${linha.slice(0, LIMITE_TRECHO)}…` : linha);

// → [{ trecho, pagina, motivo }] (uma entrada por linha e por motivo)
export function detectarInstrucoes(texto, pagina = null) {
  const alertas = [];
  for (const linha of String(texto ?? '').split(/\r?\n/)) {
    const t = linha.trim();
    if (!t) continue;
    for (const [padrao, motivo] of REGRAS) {
      if (padrao.test(t)) alertas.push({ trecho: recorte(t), pagina, motivo });
    }
  }
  return alertas;
}
