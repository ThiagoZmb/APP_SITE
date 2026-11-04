// Configuração do portal do cliente, lida das variáveis de ambiente.
// Sem URL base e chave de cifra válidas o portal fica inativo (o resto do sistema não é afetado).
// O `motivo` nunca repete o valor de uma variável: só diz qual está faltando ou inválida.

const TERMO_PADRAO = '2026-11-rascunho';

// https://host[:porta], sem caminho, query, âncora nem barra final; http só para localhost fora de production
function urlBaseValida(valor, env) {
  if (/^https:\/\/[^/?#\s@]+$/.test(valor)) return true;
  return env.NODE_ENV !== 'production' && /^http:\/\/localhost(:\d{1,5})?$/.test(valor);
}

// base64 canônico de exatamente 32 bytes (AES-256)
function chaveValida(valor) {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(valor)) return false;
  const bytes = Buffer.from(valor, 'base64');
  return bytes.length === 32 && bytes.toString('base64') === valor;
}

// O navegador sempre manda o Origin em minúsculas e sem a porta padrão; a base é comparada com ele letra por letra.
// Por isso aceitamos maiúsculas, a barra final e :443 (https) / :80 (http) e guardamos a forma canônica.
// Não há caminho na base, então minúsculas no valor todo é seguro.
function normalizarUrlBase(valor) {
  let v = String(valor || '').trim().toLowerCase().replace(/\/+$/, '');
  if (v.startsWith('https://')) v = v.replace(/:443$/, '');
  else if (v.startsWith('http://')) v = v.replace(/:80$/, '');
  return v;
}

function lerConfigPortal(env = process.env) {
  const termoVersao = env.PORTAL_TERMO_VERSAO || TERMO_PADRAO;
  const base = normalizarUrlBase(env.PORTAL_URL_BASE);
  const chave = (env.PORTAL_CHAVE_CRIPTO || '').trim();

  const config = { ativo: false, termoVersao };
  if (!base) config.motivo = 'Portal do cliente desativado: falta definir PORTAL_URL_BASE.';
  else if (!urlBaseValida(base, env)) config.motivo = 'Portal do cliente desativado: PORTAL_URL_BASE inválida (use https://dominio, sem caminho nem barra no final).';
  else if (!chave) config.motivo = 'Portal do cliente desativado: falta definir PORTAL_CHAVE_CRIPTO.';
  else if (!chaveValida(chave)) config.motivo = 'Portal do cliente desativado: PORTAL_CHAVE_CRIPTO inválida (precisa ser base64 de exatamente 32 bytes).';
  else {
    config.ativo = true;
    config.baseUrl = base;
    config.chaveCripto = chave;
  }

  if (env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS) {
    config.smtp = {
      host: env.SMTP_HOST,
      port: Number(env.SMTP_PORT) || 465,
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
      from: env.SMTP_FROM || env.SMTP_USER
    };
  }
  return config;
}

// Na subida: com o portal desativado, UMA linha diz o motivo (o texto é fixo e nunca traz valores de variáveis),
// senão o dono não sabe qual variável está errada. Nunca nos testes. Devolve true se avisou.
function avisarPortalDesativado(config, { env = process.env, aviso = console.warn } = {}) {
  if (config.ativo || env.NODE_ENV === 'test') return false;
  aviso('[portal] desativado:', config.motivo);
  return true;
}

module.exports = { lerConfigPortal, avisarPortalDesativado };
