// Notas de compra pela SEFAZ (local/sefaz.js): montagem e leitura dos XML, assinatura do evento de ciência,
// regras de consumo (137/138/656, 1 hora, 20 por hora), índice local e o fluxo contra um servidor HTTPS FALSO da SEFAZ
// com certificado do cliente (mTLS). Nenhum certificado real e nenhuma chamada à SEFAZ real.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const S = require('../local/sefaz');
const A = require('./apoio/sefazFalsa');
const { lerNFe } = require('../rotas/nfe_xml');

const CNPJ = '33000167000101';                 // empresa (destinatária) de teste
const CHAVE_A = A.gerarChave({ numero: 501 });
const CHAVE_B = A.gerarChave({ numero: 502 });
const pfxTeste = A.gerarPfx({ cnpj: CNPJ });

// ---------------------------------------------------------------- funções puras
test('chave de acesso: 44 dígitos com DV módulo 11; partes da chave', () => {
  assert.equal(S.chaveValida(CHAVE_A), true);
  assert.equal(S.chaveValida(CHAVE_A.slice(0, 43) + ((Number(CHAVE_A[43]) + 1) % 10)), false);
  assert.equal(S.chaveValida('../../windows'), false);
  assert.equal(S.chaveValida(CHAVE_A + '0'), false);
  assert.deepEqual(S.partesChave(CHAVE_A), { cnpjEmitente: '11222333000181', modelo: '55', serie: '1', numero: '501' });
});

test('distDFeInt 1.01: distNSU e consChNFe no leiaute, dentro do envelope SOAP 1.2', () => {
  assert.equal(S.montarDistDFe({ tpAmb: 2, cUF: 35, cnpj: CNPJ, ultNSU: '12' }),
    `<distDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01"><tpAmb>2</tpAmb><cUFAutor>35</cUFAutor><CNPJ>${CNPJ}</CNPJ>` +
    '<distNSU><ultNSU>000000000000012</ultNSU></distNSU></distDFeInt>');
  assert.equal(S.montarDistDFe({ tpAmb: 1, cUF: 33, cnpj: CNPJ, chave: CHAVE_A }),
    `<distDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01"><tpAmb>1</tpAmb><cUFAutor>33</cUFAutor><CNPJ>${CNPJ}</CNPJ>` +
    `<consChNFe><chNFe>${CHAVE_A}</chNFe></consChNFe></distDFeInt>`);
  assert.throws(() => S.montarDistDFe({ tpAmb: 1, cUF: 33, cnpj: '123', ultNSU: 0 }));
  const env = S.envelopeDist('<x/>');
  assert.match(env, /<soap12:Envelope xmlns:soap12="http:\/\/www\.w3\.org\/2003\/05\/soap-envelope">/);
  assert.match(env, /<nfeDistDFeInteresse xmlns="http:\/\/www\.portalfiscal\.inf\.br\/nfe\/wsdl\/NFeDistribuicaoDFe"><nfeDadosMsg><x\/><\/nfeDadosMsg>/);
  assert.equal(S.codigoUF('sp'), 35); assert.equal(S.codigoUF('33'), 33); assert.equal(S.codigoUF('XX'), null);
});

test('dhEvento em horário de Brasília (-03:00), 1 minuto antes do relógio; horaBR', () => {
  const t = Date.UTC(2026, 9, 29, 15, 30, 0);      // 12:30 em Brasília
  assert.equal(S.dhEventoBR(t), '2026-10-29T12:29:00-03:00');
  assert.equal(S.horaBR(t), '12:30');
});

test('docZip: base64 + gzip; lixo e documento grande demais são recusados', () => {
  assert.equal(S.descompactarDocZip(A.zip('<a>ç</a>')), '<a>ç</a>');
  assert.throws(() => S.descompactarDocZip('não é base64!'), /formato inesperado/);
  assert.throws(() => S.descompactarDocZip(Buffer.from('abc').toString('base64')), /formato inesperado/);
  const grande = require('node:zlib').gzipSync(Buffer.alloc(6 * 1024 * 1024, 32)).toString('base64');
  assert.throws(() => S.descompactarDocZip(grande), /formato inesperado/);
});

test('retDistDFeInt: cStat, ultNSU/maxNSU e documentos; DOCTYPE e SOAP Fault recusados', () => {
  const r = S.interpretarRetDist(A.retDist({ cStat: '138', xMotivo: 'Documento localizado', ultNSU: '000000000000002', maxNSU: '000000000000009',
    docs: [{ nsu: '000000000000001', schema: 'resNFe_v1.01.xsd', xml: A.resNFe({ chave: CHAVE_A }) }, { nsu: '000000000000002', schema: 'procNFe_v4.00.xsd', xml: A.procNFe({ chave: CHAVE_B }) }] }));
  assert.equal(r.cStat, '138'); assert.equal(r.ultNSU, '000000000000002'); assert.equal(r.maxNSU, '000000000000009');
  assert.equal(r.docs.length, 2); assert.equal(r.docs[0].schema, 'resNFe_v1.01.xsd');
  assert.equal(S.lerDocumento(r.docs[0].xml).emitente, 'FORNECEDOR & CIA');
  assert.equal(S.interpretarRetDist(A.retDist({ cStat: '137' })).docs.length, 0);
  assert.throws(() => S.interpretarRetDist('<!DOCTYPE x [<!ENTITY a "b">]><x>&a;</x>'), /formato inesperado/);
  const fault = '<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body><soap:Fault><soap:Reason><soap:Text>Schema invalido</soap:Text></soap:Reason></soap:Fault></soap:Body></soap:Envelope>';
  assert.throws(() => S.interpretarRetDist(fault), /recusou o pedido: Schema invalido/);
});

test('documentos: resNFe, procNFe (chave conferida com o Id) e resEvento; o procNFe é aceito pela leitura da entrada de estoque', () => {
  const res = S.lerDocumento(A.resNFe({ chave: CHAVE_A, sit: '3' }));
  assert.deepEqual([res.tipo, res.chave, res.valor, res.dataEmissao, res.sitNFe], ['resNFe', CHAVE_A, 1500.25, '2026-10-20', '3']);
  const proc = S.lerDocumento(A.procNFe({ chave: CHAVE_B, dest: CNPJ }));
  assert.deepEqual([proc.tipo, proc.chave, proc.numero, proc.cnpjDestinatario, proc.valor], ['procNFe', CHAVE_B, '123', CNPJ, 1500.25]);
  assert.equal(S.xmlNFeValido(A.procNFe({ chave: CHAVE_B }), CHAVE_B), true);
  assert.equal(S.xmlNFeValido(A.procNFe({ chave: CHAVE_B }), CHAVE_A), false);
  assert.equal(S.xmlNFeValido('<!DOCTYPE x><nfeProc/>', CHAVE_B), false);
  const trocado = A.procNFe({ chave: CHAVE_B }).replace(`<chNFe>${CHAVE_B}</chNFe>`, `<chNFe>${CHAVE_A}</chNFe>`);
  assert.throws(() => S.lerDocumento(trocado), /chave inconsistente/);
  assert.equal(S.lerDocumento(A.resEvento({ chave: CHAVE_A })).tpEvento, '110111');
  assert.equal(lerNFe(A.procNFe({ chave: CHAVE_B })).itens.length, 1);   // mesmo XML que a tela manda para /estoque/entrada/xml
});

test('índice: resumo → ciência → completa → importada nunca regride; cancelamento marca a nota', () => {
  const notas = {};
  const op = { cnpjEmpresa: CNPJ, agoraIso: '2026-10-29T00:00:00.000Z' };
  assert.equal(S.aplicarDocumento(notas, S.lerDocumento(A.resNFe({ chave: CHAVE_A })), op), 'nova');
  assert.equal(notas[CHAVE_A].situacao, 'resumo');
  S.aplicarDocumento(notas, { tipo: 'procEvento', chave: CHAVE_A, tpEvento: '210210', descricao: 'Ciencia', data: '2026-10-29' }, op);
  assert.equal(notas[CHAVE_A].situacao, 'ciencia');
  S.aplicarDocumento(notas, S.lerDocumento(A.procNFe({ chave: CHAVE_A, dest: CNPJ })), op);
  assert.equal(notas[CHAVE_A].situacao, 'completa'); assert.equal(notas[CHAVE_A].paraEmpresa, true);
  notas[CHAVE_A].situacao = 'importada';
  assert.equal(S.aplicarDocumento(notas, S.lerDocumento(A.resNFe({ chave: CHAVE_A })), op), 'atualizada');
  assert.equal(notas[CHAVE_A].situacao, 'importada');
  S.aplicarDocumento(notas, S.lerDocumento(A.resEvento({ chave: CHAVE_A })), op);
  assert.equal(notas[CHAVE_A].cancelada, true);
  assert.equal(S.aplicarDocumento(notas, { tipo: 'resNFe', chave: '123' }, op), null);
});

// ---------------------------------------------------------------- configuração e certificado
function pastaTemp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'elegance-sefaz-')); }

test('configuração: sem arquivo, campos inválidos e senha pela variável de ambiente (a senha nunca aparece no motivo)', () => {
  const dir = pastaTemp();
  const arq = path.join(dir, 'sefaz.config.json');
  assert.match(S.lerConfig(arq, {}).motivo, /SEFAZ não configurada/);
  const grava = c => fs.writeFileSync(arq, JSON.stringify(c));
  const base = { cnpj: '33.000.167/0001-01', uf: 'RJ', ambiente: 'homologacao', certificado: path.join(dir, 'a.pfx'), senha: 'SEGREDO-123' };
  grava(base);
  const ok = S.lerConfig(arq, {});
  assert.equal(ok.ok, true); assert.equal(ok.config.cnpj, CNPJ); assert.equal(ok.config.cUF, 33); assert.equal(ok.config.tpAmb, 2);
  assert.equal(S.lerConfig(arq, { ELEGANCE_SEFAZ_SENHA: 'OUTRA' }).config.senha, 'OUTRA');
  for (const [mudanca, re] of [[{ cnpj: '123' }, /CNPJ/], [{ uf: 'XX' }, /UF/], [{ ambiente: 'teste' }, /Ambiente/], [{ certificado: 'a.pfx' }, /caminho completo/], [{ senha: '' }, /senha/]]) {
    grava({ ...base, ...mudanca });
    const r = S.lerConfig(arq, {});
    assert.equal(r.ok, false); assert.match(r.motivo, re);
    assert.ok(!r.motivo.includes('SEGREDO-123'));
  }
  fs.writeFileSync(arq, '{ isto não é json');
  assert.match(S.lerConfig(arq, {}).motivo, /JSON válido/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('certificado .pfx de teste: abre com a senha, recusa senha errada sem expor nada', () => {
  const c = S.lerCertificado(pfxTeste.pfx, pfxTeste.senha);
  assert.equal(c.cnpjCert, CNPJ);
  assert.match(c.chavePem, /BEGIN RSA PRIVATE KEY/);
  assert.ok(c.validoAte > Date.now());
  assert.throws(() => S.lerCertificado(pfxTeste.pfx, 'errada'), e => e instanceof S.ErroSefaz && /Senha do certificado incorreta/.test(e.message) && !e.message.includes('errada'));
  assert.throws(() => S.lerCertificado(Buffer.from('lixo'), 'x'), /Não foi possível abrir o certificado/);
});

// ---------------------------------------------------------------- assinatura do evento
function conferirAssinatura(eventoXml, certPem) {
  const inf = /<infEvento [\s\S]*<\/infEvento>/.exec(eventoXml)[0];
  const canonico = inf.replace(/^<infEvento /, '<infEvento xmlns="http://www.portalfiscal.inf.br/nfe" ');
  const digest = crypto.createHash('sha1').update(canonico).digest('base64');
  assert.equal(/<DigestValue>([^<]+)<\/DigestValue>/.exec(eventoXml)[1], digest, 'DigestValue = SHA-1 da forma canônica de infEvento');
  const si = /<SignedInfo>[\s\S]*<\/SignedInfo>/.exec(eventoXml)[0].replace('<SignedInfo>', '<SignedInfo xmlns="http://www.w3.org/2000/09/xmldsig#">');
  const valor = /<SignatureValue>([^<]+)<\/SignatureValue>/.exec(eventoXml)[1];
  const certDoXml = new crypto.X509Certificate(Buffer.from(/<X509Certificate>([^<]+)<\/X509Certificate>/.exec(eventoXml)[1], 'base64'));
  assert.ok(certDoXml.publicKey.equals(new crypto.X509Certificate(certPem).publicKey), 'KeyInfo leva o certificado do .pfx');
  return crypto.createVerify('RSA-SHA1').update(si).verify(certDoXml.publicKey, valor, 'base64');
}

test('evento 210210 (Ciência da Operação): leiaute 1.00 e assinatura XML-DSig RSA-SHA1 válida', () => {
  const cert = S.lerCertificado(pfxTeste.pfx, pfxTeste.senha);
  const inf = S.montarInfCiencia({ tpAmb: 2, cnpj: CNPJ, chave: CHAVE_A, dhEvento: '2026-10-29T10:00:00-03:00' });
  assert.equal(inf.id, `ID210210${CHAVE_A}01`); assert.equal(inf.id.length, 54);
  assert.equal(inf.xml, `<infEvento Id="${inf.id}"><cOrgao>91</cOrgao><tpAmb>2</tpAmb><CNPJ>${CNPJ}</CNPJ><chNFe>${CHAVE_A}</chNFe>` +
    '<dhEvento>2026-10-29T10:00:00-03:00</dhEvento><tpEvento>210210</tpEvento><nSeqEvento>1</nSeqEvento><verEvento>1.00</verEvento>' +
    '<detEvento versao="1.00"><descEvento>Ciencia da Operacao</descEvento></detEvento></infEvento>');
  const ev = S.assinarEvento(inf, cert);
  assert.match(ev, /^<evento xmlns="http:\/\/www\.portalfiscal\.inf\.br\/nfe" versao="1\.00"><infEvento [\s\S]*<\/infEvento><Signature xmlns="http:\/\/www\.w3\.org\/2000\/09\/xmldsig#">/);
  for (const alg of ['xml-c14n-20010315', 'xmldsig#rsa-sha1', 'xmldsig#enveloped-signature', 'xmldsig#sha1']) assert.ok(ev.includes(alg), alg);
  assert.ok(ev.includes(`<Reference URI="#${inf.id}">`));
  assert.equal(conferirAssinatura(ev, pfxTeste.certPem), true);
  // adulterar o conteúdo assinado quebra o digest
  assert.throws(() => conferirAssinatura(ev.replace('<tpAmb>2</tpAmb>', '<tpAmb>1</tpAmb>'), pfxTeste.certPem), /DigestValue/);
  const env = S.montarEnvEvento('123', [ev]);
  assert.match(env, /^<envEvento xmlns="http:\/\/www\.portalfiscal\.inf\.br\/nfe" versao="1\.00"><idLote>123<\/idLote><evento /);
  assert.throws(() => S.montarInfCiencia({ tpAmb: 2, cnpj: CNPJ, chave: '1', dhEvento: '2026-10-29T10:00:00-03:00' }));
});

test('assinatura conferida também pelo .NET (SignedXml do Windows), verificador independente', t => {
  if (process.platform !== 'win32') return t.skip('só no Windows');
  const dir = pastaTemp();
  const arq = path.join(dir, 'evento.xml');
  const cert = S.lerCertificado(pfxTeste.pfx, pfxTeste.senha);
  const ev = S.assinarEvento(S.montarInfCiencia({ tpAmb: 2, cnpj: CNPJ, chave: CHAVE_A, dhEvento: '2026-10-29T10:00:00-03:00' }), cert);
  fs.writeFileSync(arq, S.montarEnvEvento('1', [ev]));
  const script = "Add-Type -AssemblyName System.Security; $d = New-Object System.Xml.XmlDocument; $d.PreserveWhitespace = $true; $d.Load($env:ARQ_EVENTO); " +
    "$s = New-Object System.Security.Cryptography.Xml.SignedXml($d); $s.LoadXml($d.GetElementsByTagName('Signature','http://www.w3.org/2000/09/xmldsig#')[0]); [Console]::Out.Write($s.CheckSignature())";
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { env: { ...process.env, ARQ_EVENTO: arq }, encoding: 'utf8', timeout: 60000 });
  fs.rmSync(dir, { recursive: true, force: true });
  if (r.error || r.status !== 0) return t.skip('PowerShell indisponível: ' + (r.error ? r.error.code : r.stderr));
  assert.equal(r.stdout.trim(), 'True');
});

// ---------------------------------------------------------------- fluxo contra a SEFAZ falsa (HTTPS + certificado do cliente)
async function preparar(t, { pfx = pfxTeste, configExtra = {} } = {}) {
  const dir = pastaTemp();
  const falsa = await A.criarSefazFalsa({ caCliente: pfx.certPem });
  const pfxArq = path.join(dir, 'empresa.pfx');
  fs.writeFileSync(pfxArq, pfx.pfx);
  const cadeia = path.join(dir, 'cadeia.pem');
  fs.writeFileSync(cadeia, falsa.certServidorPem);
  const config = path.join(dir, 'Servico', 'sefaz.config.json');
  fs.mkdirSync(path.dirname(config), { recursive: true });
  fs.writeFileSync(config, JSON.stringify({ cnpj: CNPJ, uf: 'RJ', ambiente: 'homologacao', certificado: pfxArq, senha: pfx.senha, cadeiaSefaz: cadeia, ...configExtra }));
  const relogio = { t: Date.UTC(2026, 9, 29, 13, 0, 0) };
  const sefaz = S.criarSefaz({ raiz: dir, arquivoConfig: config, env: {}, agora: () => relogio.t, urls: { homologacao: falsa.urls } });
  t.after(async () => { await falsa.fechar(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { dir, falsa, sefaz, relogio, config };
}
const doc = (nsu, xml) => ({ nsu, schema: 'x.xsd', xml });

test('sincronizar: 138 em dois lotes até ultNSU = maxNSU, guarda resumo, XML completo e evento; depois espera 1 hora', async t => {
  const { falsa, sefaz, relogio, dir } = await preparar(t);
  falsa.filas.dist.push({ corpo: A.retDist({ cStat: '138', ultNSU: '000000000000002', maxNSU: '000000000000003',
    docs: [doc('000000000000001', A.resNFe({ chave: CHAVE_A })), doc('000000000000002', A.resEvento({ chave: CHAVE_A, tpEvento: '210210', xEvento: 'Ciencia' }))] }) });
  falsa.filas.dist.push({ corpo: A.retDist({ cStat: '138', ultNSU: '000000000000003', maxNSU: '000000000000003',
    docs: [doc('000000000000003', A.procNFe({ chave: CHAVE_B, dest: CNPJ }))] }) });
  const r = await sefaz.sincronizar();
  assert.equal(r.ok, true); assert.equal(r.novas, 2); assert.equal(r.ultNSU, '000000000000003'); assert.equal(r.haMais, false);
  assert.equal(r.proximaConsultaHora, '11:00');
  // pedidos: mTLS com o certificado do .pfx, SOAP 1.2 com action, ultNSU 0 e depois o ultNSU devolvido
  assert.equal(falsa.pedidos.length, 2);
  assert.ok(falsa.pedidos.every(p => p.autorizado && p.cnCliente === `EMPRESA DE TESTE LTDA:${CNPJ}`));
  assert.match(falsa.pedidos[0].headers['content-type'], /application\/soap\+xml; charset=utf-8; action="http:\/\/www\.portalfiscal\.inf\.br\/nfe\/wsdl\/NFeDistribuicaoDFe\/nfeDistDFeInteresse"/);
  assert.ok(falsa.pedidos[0].corpo.includes(`<tpAmb>2</tpAmb><cUFAutor>33</cUFAutor><CNPJ>${CNPJ}</CNPJ><distNSU><ultNSU>000000000000000</ultNSU>`));
  assert.ok(falsa.pedidos[1].corpo.includes('<ultNSU>000000000000002</ultNSU>'));
  // índice e arquivos
  const { notas } = await sefaz.notas();
  const a = notas.find(n => n.chave === CHAVE_A), b = notas.find(n => n.chave === CHAVE_B);
  assert.equal(a.situacao, 'ciencia'); assert.equal(a.emitente, 'FORNECEDOR & CIA'); assert.equal(a.valor, 1500.25);
  assert.equal(b.situacao, 'completa'); assert.equal(b.numero, '123');
  assert.ok(fs.existsSync(path.join(dir, 'NFe', 'Entrada_Homologacao', `${CHAVE_B}.xml`)));
  assert.ok(!fs.existsSync(path.join(dir, 'NFe', 'Entrada_Homologacao', `${CHAVE_A}.xml`)));
  assert.equal(lerNFe(await sefaz.xml(CHAVE_B)).numero, '123');
  await assert.rejects(sefaz.xml(CHAVE_A), /ainda não foi baixado/);
  // nova sincronização antes de 1 hora: recusada SEM consultar a SEFAZ
  await assert.rejects(sefaz.sincronizar(), e => e.status === 429 && /Próxima consulta liberada às 11:00/.test(e.message));
  assert.equal(falsa.pedidos.length, 2);
  const st = await sefaz.status();
  assert.equal(st.configurada, true); assert.equal(st.ultNSU, '000000000000003'); assert.equal(st.proximaConsultaHora, '11:00');
  assert.equal(st.qtdNotas, 2);
  assert.ok(!JSON.stringify(st).includes(pfxTeste.senha) && !JSON.stringify(st).includes('empresa.pfx'), 'status sem senha nem caminho do .pfx');
  // passou 1 hora: consulta de novo com o último NSU; 137 = nada novo → mais 1 hora
  relogio.t += S.HORA + 1000;
  falsa.filas.dist.push({ corpo: A.retDist({ cStat: '137', xMotivo: 'Nenhum documento localizado', ultNSU: '000000000000003', maxNSU: '000000000000003' }) });
  const r2 = await sefaz.sincronizar();
  assert.equal(r2.cStat, '137'); assert.equal(r2.novas, 0);
  assert.ok(falsa.pedidos[2].corpo.includes('<ultNSU>000000000000003</ultNSU>'));
  await assert.rejects(sefaz.sincronizar(), e => e.status === 429);
  assert.equal(falsa.pedidos.length, 3);
});

test('656 (consumo indevido): bloqueia sincronizar e baixar por 1 hora e informa o horário', async t => {
  const { falsa, sefaz, relogio } = await preparar(t);
  falsa.filas.dist.push({ corpo: A.retDist({ cStat: '656', xMotivo: 'Rejeicao: Consumo Indevido', ultNSU: '000000000000010', maxNSU: '000000000000020' }) });
  await assert.rejects(sefaz.sincronizar(), e => e.status === 429 && /consumo indevido/.test(e.message) && /11:00/.test(e.message));
  await assert.rejects(sefaz.sincronizar(), e => e.status === 429 && /Próxima consulta liberada às 11:00/.test(e.message));
  await assert.rejects(sefaz.baixar(CHAVE_A), e => e.status === 429);
  assert.equal(falsa.pedidos.length, 1);
  const st = await sefaz.status();
  assert.equal(st.bloqueado, true); assert.equal(st.ultNSU, '000000000000010');
  relogio.t += S.HORA + 1000;
  falsa.filas.dist.push({ corpo: A.retDist({ cStat: '137', ultNSU: '000000000000020', maxNSU: '000000000000020' }) });
  await sefaz.sincronizar();
  assert.ok(falsa.pedidos[1].corpo.includes('<ultNSU>000000000000010</ultNSU>'));
});

test('outro cStat vira mensagem clara; erro HTTP 403 explica o certificado', async t => {
  const { falsa, sefaz } = await preparar(t);
  falsa.filas.dist.push({ corpo: A.retDist({ cStat: '593', xMotivo: 'Rejeicao: CNPJ-Base consultado difere do CNPJ-Base do Certificado Digital' }) });
  await assert.rejects(sefaz.sincronizar(), e => e.status === 502 && /593: Rejeicao: CNPJ-Base/.test(e.message));
  falsa.filas.dist.push({ status: 403, corpo: 'Forbidden' });
  await assert.rejects(sefaz.sincronizar(), /recusou o certificado digital \(HTTP 403\)/);
});

test('baixar por chave: XML completo vai para o disco; só resumo pede ciência; limite de 20 consultas por hora', async t => {
  const { falsa, sefaz, relogio } = await preparar(t);
  await assert.rejects(sefaz.baixar('123'), e => e.status === 400);
  falsa.filas.dist.push({ corpo: A.retDist({ cStat: '138', docs: [doc('000000000000000', A.resNFe({ chave: CHAVE_A }))] }) });
  const r1 = await sefaz.baixar(CHAVE_A);
  assert.equal(r1.completa, false); assert.match(r1.mensagem, /Ciência da operação/);
  assert.ok(falsa.pedidos[0].corpo.includes(`<consChNFe><chNFe>${CHAVE_A}</chNFe></consChNFe>`));
  falsa.filas.dist.push({ corpo: A.retDist({ cStat: '138', docs: [doc('000000000000000', A.procNFe({ chave: CHAVE_A, dest: CNPJ }))] }) });
  const r2 = await sefaz.baixar(CHAVE_A);
  assert.equal(r2.completa, true); assert.equal(r2.nota.situacao, 'completa');
  falsa.filas.dist.push({ corpo: A.retDist({ cStat: '137', xMotivo: 'Nenhum documento localizado' }) });
  await assert.rejects(sefaz.baixar(CHAVE_B), e => e.status === 404 && /ainda não tem documento/.test(e.message));
  falsa.filas.dist.push({ corpo: A.retDist({ cStat: '640', xMotivo: 'Rejeicao: CNPJ/CPF do interessado nao possui permissao' }) });
  await assert.rejects(sefaz.baixar(CHAVE_B), /640: Rejeicao/);
  for (let i = 0; i < 16; i++) falsa.filas.dist.push({ corpo: A.retDist({ cStat: '137' }) });
  for (let i = 0; i < 16; i++) await assert.rejects(sefaz.baixar(CHAVE_B), e => e.status === 404);
  await assert.rejects(sefaz.baixar(CHAVE_B), e => e.status === 429 && /Limite de 20 consultas/.test(e.message) && /11:00/.test(e.message));
  assert.equal(falsa.pedidos.length, 20);
  // marca como importada (só nota completa)
  assert.equal((await sefaz.importada(CHAVE_A)).nota.situacao, 'importada');
  await assert.rejects(sefaz.importada(CHAVE_B), e => e.status === 409);
  relogio.t += S.HORA + 1;
  falsa.filas.dist.push({ corpo: A.retDist({ cStat: '137' }) });
  await assert.rejects(sefaz.baixar(CHAVE_B), e => e.status === 404);   // passou a hora: libera de novo
});

test('ciência da operação: evento assinado chega à SEFAZ; 135/573 marcam a nota; lote recusado vira erro', async t => {
  const { falsa, sefaz } = await preparar(t);
  falsa.filas.evento.push({ corpo: A.retEvento({ eventos: [{ chave: CHAVE_A, cStat: '135' }, { chave: CHAVE_B, cStat: '650', xMotivo: 'Rejeicao: Evento de Ciencia para NF-e cancelada' }] }) });
  const r = await sefaz.ciencia([CHAVE_A, CHAVE_B]);
  assert.deepEqual(r.resultados.map(x => [x.chave, x.ok]), [[CHAVE_A, true], [CHAVE_B, false]]);
  assert.match(r.resultados[1].mensagem, /650/);
  const p = falsa.pedidos[0];
  assert.equal(p.servico, 'evento');
  assert.match(p.headers['content-type'], /action="http:\/\/www\.portalfiscal\.inf\.br\/nfe\/wsdl\/NFeRecepcaoEvento4\/nfeRecepcaoEvento"/);
  assert.match(p.corpo, /<nfeDadosMsg xmlns="http:\/\/www\.portalfiscal\.inf\.br\/nfe\/wsdl\/NFeRecepcaoEvento4"><envEvento /);
  const eventos = p.corpo.match(/<evento [\s\S]*?<\/evento>/g);
  assert.equal(eventos.length, 2);
  for (const ev of eventos) assert.equal(conferirAssinatura(ev, pfxTeste.certPem), true);
  assert.ok(eventos[0].includes('<dhEvento>2026-10-29T09:59:00-03:00</dhEvento>'));
  const { notas } = await sefaz.notas();
  assert.equal(notas.find(n => n.chave === CHAVE_A).situacao, 'ciencia');
  assert.equal(notas.find(n => n.chave === CHAVE_B), undefined);
  falsa.filas.evento.push({ corpo: A.retEvento({ eventos: [{ chave: CHAVE_A, cStat: '573', xMotivo: 'Duplicidade de evento' }] }) });
  assert.match((await sefaz.ciencia([CHAVE_A])).resultados[0].mensagem, /já estava registrada/);
  falsa.filas.evento.push({ corpo: A.retEvento({ cStat: '215', eventos: [] }) });
  await assert.rejects(sefaz.ciencia([CHAVE_A]), /não processou o lote \(215/);
  await assert.rejects(sefaz.ciencia(Array.from({ length: 21 }, (_, i) => A.gerarChave({ numero: i + 1 }))), e => e.status === 400);
  await assert.rejects(sefaz.ciencia(['123']), e => e.status === 400);
});

test('sem configuração, senha errada e certificado vencido: status explica e as operações respondem 503', async t => {
  const { sefaz, config, falsa } = await preparar(t);
  const original = fs.readFileSync(config, 'utf8');
  fs.writeFileSync(config, JSON.stringify({ ...JSON.parse(original), senha: 'errada' }));
  const st = await sefaz.status();
  assert.equal(st.configurada, false); assert.match(st.motivo, /Senha do certificado incorreta/);
  await assert.rejects(sefaz.sincronizar(), e => e.status === 503);
  fs.rmSync(config);
  assert.match((await sefaz.status()).motivo, /SEFAZ não configurada/);
  await assert.rejects(sefaz.notas(), e => e.status === 503);
  assert.equal(falsa.pedidos.length, 0);
});

test('certificado vencido não consulta a SEFAZ', async t => {
  const vencido = A.gerarPfx({ cnpj: CNPJ, inicio: Date.UTC(2020, 0, 1), dias: 30 });
  const { sefaz, falsa } = await preparar(t, { pfx: vencido });
  await assert.rejects(sefaz.sincronizar(), e => e.status === 503 && /venceu/.test(e.message));
  assert.ok((await sefaz.status()).avisos.some(a => /vencido/.test(a)));
  assert.equal(falsa.pedidos.length, 0);
});

test('sem a cadeia do servidor da SEFAZ o TLS é recusado (a verificação nunca é desligada)', async t => {
  const { sefaz, falsa, config } = await preparar(t);
  const c = JSON.parse(fs.readFileSync(config, 'utf8')); delete c.cadeiaSefaz;
  fs.writeFileSync(config, JSON.stringify(c));
  await assert.rejects(sefaz.sincronizar(), e => e.status === 502 && /não foi reconhecido neste PC/.test(e.message));
  assert.equal(falsa.pedidos.length, 0);
});

test('duas operações ao mesmo tempo: a segunda é recusada (uma consulta por vez)', async t => {
  const { sefaz, falsa } = await preparar(t);
  falsa.filas.dist.push({ corpo: A.retDist({ cStat: '137' }) });
  const primeira = sefaz.sincronizar();
  await assert.rejects(sefaz.baixar(CHAVE_A), e => e.status === 409);
  await primeira;
});
