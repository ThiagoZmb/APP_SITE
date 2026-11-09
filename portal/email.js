// Envio do convite do portal por e-mail (SMTP via nodemailer).
// O `smtp` vem de lerConfigPortal (não lê o ambiente aqui). Sem ele o e-mail fica desligado.
// Nunca lança e nunca registra link, senha SMTP ou err.message: o log só leva err.code.

const nodemailer = require('nodemailer');

const ASSUNTO = 'Convite para o portal Elegance';
const LIMITE_RAZAO = 120;
const TIMEOUT_MS = 10000;

// um só destinatário, ASCII simples, sem espaço, vírgula, ponto e vírgula nem quebra de linha
const REGEX_EMAIL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;

// tira caracteres de controle (inclui \r e \n), junta espaços e limita o tamanho
function sanitizarTexto(valor) {
  return String(valor ?? '')
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, LIMITE_RAZAO);
}

function montarTexto({ link, razaoSocial }) {
  const nome = sanitizarTexto(razaoSocial);
  return [
    nome ? `Olá, ${nome}!` : 'Olá!',
    '',
    'Você foi convidado para acessar o portal do cliente Elegance.',
    'Para criar seu acesso, abra o link abaixo:',
    '',
    link,
    '',
    'Este convite vale por 48 horas.',
    'Se você não esperava esta mensagem, ignore-a: nenhum acesso será criado.',
    '',
  ].join('\n');
}

function criarEmail({ smtp, criarTransporte = nodemailer.createTransport } = {}) {
  if (!smtp) {
    return { configurado: false, enviarConvite: async () => ({ enviado: false }) };
  }

  // criado uma vez e reaproveitado em todos os envios
  const transporte = criarTransporte({
    host: smtp.host,
    port: smtp.port,
    secure: Number(smtp.port) === 465,
    // fora da 465 (TLS direto) o STARTTLS é OBRIGATÓRIO: sem isto quem estiver na rede remove o anúncio do STARTTLS e
    // o link do convite e a senha do SMTP seguiriam em texto claro (downgrade).
    requireTLS: Number(smtp.port) !== 465,
    auth: { user: smtp.user, pass: smtp.pass },
    connectionTimeout: TIMEOUT_MS,
    greetingTimeout: TIMEOUT_MS,
    socketTimeout: TIMEOUT_MS,
    tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
  });

  async function enviarConvite({ para, link, razaoSocial } = {}) {
    if (typeof para !== 'string' || !REGEX_EMAIL.test(para) || typeof link !== 'string' || !link) {
      return { enviado: false };
    }
    try {
      await transporte.sendMail({
        from: smtp.from,
        to: para,
        subject: ASSUNTO,
        text: montarTexto({ link, razaoSocial }),
      });
      return { enviado: true };
    } catch (err) {
      console.error('Falha ao enviar o convite do portal:', (err && err.code) || 'sem código');
      return { enviado: false };
    }
  }

  return { configurado: true, enviarConvite };
}

module.exports = { criarEmail };
