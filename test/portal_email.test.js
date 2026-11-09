process.env.JWT_SECRET = 'teste';
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const { criarEmail } = require('../portal/email');

const SENHA = 'senha-smtp-secreta';
const LINK = 'https://portal.exemplo.com.br/convite?t=TOKEN-SECRETO-123';
const smtp = (extra = {}) => ({ host: 'smtp.exemplo.com', port: 465, user: 'envio@exemplo.com', pass: SENHA, from: 'Elegance <envio@exemplo.com>', ...extra });

// transporte falso: guarda as opções de criação e os e-mails enviados
function falso({ falhar } = {}) {
  const estado = { criados: [], enviados: [] };
  const criarTransporte = (opcoes) => {
    estado.criados.push(opcoes);
    return {
      sendMail: async (msg) => {
        if (falhar) throw Object.assign(new Error(`falha com ${LINK} e ${SENHA}`), falhar === true ? {} : falhar);
        estado.enviados.push(msg);
        return { messageId: 'x' };
      },
    };
  };
  return { estado, criarTransporte };
}

function capturarErros(fn) {
  const original = console.error;
  const linhas = [];
  console.error = (...args) => linhas.push(args.map(String).join(' '));
  return fn().then(
    (r) => { console.error = original; return { r, linhas }; },
    (e) => { console.error = original; throw e; },
  );
}

test('sem smtp: não configurado, não cria transporte e não envia', async () => {
  const f = falso();
  const email = criarEmail({ smtp: undefined, criarTransporte: f.criarTransporte });
  assert.equal(email.configurado, false);
  assert.deepEqual(await email.enviarConvite({ para: 'a@b.com', link: LINK, razaoSocial: 'X' }), { enviado: false });
  assert.equal(f.estado.criados.length, 0);
  assert.equal(f.estado.enviados.length, 0);
});

test('envio ok: to, from, assunto, link, validade e texto simples', async () => {
  const f = falso();
  const email = criarEmail({ smtp: smtp(), criarTransporte: f.criarTransporte });
  assert.equal(email.configurado, true);
  assert.deepEqual(await email.enviarConvite({ para: 'cliente@empresa.com.br', link: LINK, razaoSocial: 'Empresa Ltda' }), { enviado: true });
  assert.equal(f.estado.enviados.length, 1);
  const m = f.estado.enviados[0];
  assert.equal(m.to, 'cliente@empresa.com.br');
  assert.equal(m.from, 'Elegance <envio@exemplo.com>');
  assert.equal(m.subject, 'Convite para o portal Elegance');
  assert.ok(m.text.includes(LINK));
  assert.ok(m.text.includes('48 horas'));
  assert.ok(/ignore/i.test(m.text));
  assert.ok(m.text.includes('Empresa Ltda'));
  assert.equal(m.html, undefined);
  assert.ok(!m.text.includes(SENHA));
});

test('transporte criado uma vez em dois envios, com timeouts e tls estrito', async () => {
  const f = falso();
  const email = criarEmail({ smtp: smtp(), criarTransporte: f.criarTransporte });
  await email.enviarConvite({ para: 'a@b.com', link: LINK, razaoSocial: 'A' });
  await email.enviarConvite({ para: 'c@d.com', link: LINK, razaoSocial: 'B' });
  assert.equal(f.estado.criados.length, 1);
  const o = f.estado.criados[0];
  assert.equal(o.host, 'smtp.exemplo.com');
  assert.deepEqual(o.auth, { user: 'envio@exemplo.com', pass: SENHA });
  assert.equal(o.tls.rejectUnauthorized, true);
  for (const k of ['connectionTimeout', 'greetingTimeout', 'socketTimeout']) assert.ok(o[k] > 0 && o[k] <= 20000, k);
});

test('secure só na porta 465', () => {
  const a = falso();
  criarEmail({ smtp: smtp({ port: 465 }), criarTransporte: a.criarTransporte });
  assert.equal(a.estado.criados[0].secure, true);
  const b = falso();
  criarEmail({ smtp: smtp({ port: 587 }), criarTransporte: b.criarTransporte });
  assert.equal(b.estado.criados[0].secure, false);
  assert.equal(b.estado.criados[0].port, 587);
});

test('fora da 465 o STARTTLS é obrigatório (sem downgrade) e o TLS mínimo é 1.2', () => {
  const a = falso();
  criarEmail({ smtp: smtp({ port: 465 }), criarTransporte: a.criarTransporte });
  assert.equal(a.estado.criados[0].requireTLS, false);
  for (const port of [587, 25, 2525]) {
    const b = falso();
    criarEmail({ smtp: smtp({ port }), criarTransporte: b.criarTransporte });
    assert.equal(b.estado.criados[0].requireTLS, true, String(port));
    assert.equal(b.estado.criados[0].tls.minVersion, 'TLSv1.2');
    assert.equal(b.estado.criados[0].tls.rejectUnauthorized, true);
  }
});

test('erro do transporte: não lança, devolve enviado false e o log só tem o código', async () => {
  const f = falso({ falhar: { code: 'ECONNREFUSED' } });
  const email = criarEmail({ smtp: smtp(), criarTransporte: f.criarTransporte });
  const { r, linhas } = await capturarErros(() => email.enviarConvite({ para: 'a@b.com', link: LINK, razaoSocial: 'A' }));
  assert.deepEqual(r, { enviado: false });
  const log = linhas.join('\n');
  assert.ok(log.includes('ECONNREFUSED'));
  assert.ok(!log.includes(LINK) && !log.includes('TOKEN-SECRETO') && !log.includes(SENHA));
  assert.ok(!log.includes('falha com'));
});

test('erro sem código: loga "sem código"', async () => {
  const f = falso({ falhar: true });
  const email = criarEmail({ smtp: smtp(), criarTransporte: f.criarTransporte });
  const { r, linhas } = await capturarErros(() => email.enviarConvite({ para: 'a@b.com', link: LINK, razaoSocial: 'A' }));
  assert.deepEqual(r, { enviado: false });
  assert.ok(linhas.join('\n').includes('sem código'));
  assert.ok(!linhas.join('\n').includes(SENHA));
});

test('destinatário inválido: não tenta enviar', async () => {
  const f = falso();
  const email = criarEmail({ smtp: smtp(), criarTransporte: f.criarTransporte });
  for (const para of ['a@b.com\nbcc: x@y.com', 'a@b.com,c@d.com', 'a@b.com;c@d.com', '', undefined, 'sem-arroba', 'a b@c.com', 'ç@b.com']) {
    assert.deepEqual(await email.enviarConvite({ para, link: LINK, razaoSocial: 'A' }), { enviado: false }, String(para));
  }
  assert.equal(f.estado.enviados.length, 0);
});

test('razão social com quebras de linha é sanitizada e limitada', async () => {
  const f = falso();
  const email = criarEmail({ smtp: smtp(), criarTransporte: f.criarTransporte });
  await email.enviarConvite({ para: 'a@b.com', link: LINK, razaoSocial: 'Empresa\r\nBcc: x@y.com\u0007 Ltda' });
  const m = f.estado.enviados[0];
  assert.ok(!/[\r\n]/.test(m.subject));
  assert.ok(!/[\r\n]/.test(m.to));
  assert.ok(!/[\r\u0007]/.test(m.text));
  assert.ok(m.text.includes('Empresa Bcc: x@y.com Ltda'));
  await email.enviarConvite({ para: 'a@b.com', link: LINK, razaoSocial: 'Z'.repeat(500) });
  assert.ok(!f.estado.enviados[1].text.includes('Z'.repeat(121)));
  assert.ok(f.estado.enviados[1].text.includes('Z'.repeat(120)));
});
