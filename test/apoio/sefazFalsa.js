// Apoio dos testes das notas de compra pela SEFAZ: certificados de TESTE gerados na hora (nunca um certificado real),
// documentos de exemplo e um servidor HTTPS falso da SEFAZ que exige certificado do cliente (mTLS), como o real.
const https = require('node:https');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const forge = require('node-forge');

// chave de acesso com DV módulo 11 correto
function gerarChave({ cUF = '35', aamm = '2610', cnpj = '11222333000181', modelo = '55', serie = 1, numero = 123, codigo = 12345678 } = {}) {
  const base = `${cUF}${aamm}${cnpj}${modelo}${String(serie).padStart(3, '0')}${String(numero).padStart(9, '0')}1${String(codigo).padStart(8, '0')}`;
  let soma = 0, peso = 2;
  for (let i = 42; i >= 0; i--) { soma += Number(base[i]) * peso; peso = peso === 9 ? 2 : peso + 1; }
  const r = soma % 11;
  return base + (r < 2 ? 0 : 11 - r);
}

function certificado({ cn, chave, emissor, emissorChave, dias = 365, ip = null, inicio = Date.now() - 24 * 3600e3 }) {
  const c = forge.pki.createCertificate();
  c.publicKey = forge.pki.publicKeyFromPem(crypto.createPublicKey(chave).export({ type: 'spki', format: 'pem' }));
  c.serialNumber = '0' + crypto.randomBytes(8).toString('hex');
  c.validity.notBefore = new Date(inicio);
  c.validity.notAfter = new Date(inicio + dias * 24 * 3600e3);
  c.setSubject([{ name: 'commonName', value: cn }]);
  c.setIssuer((emissor || c).subject.attributes);
  const ext = [{ name: 'basicConstraints', cA: !ip && !emissor }];
  if (ip) ext.push({ name: 'subjectAltName', altNames: [{ type: 7, ip }] });
  c.setExtensions(ext);
  c.sign(forge.pki.privateKeyFromPem(emissorChave || chave), forge.md.sha256.create());
  return c;
}
const novaChave = () => crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' });

// .pfx de teste do "e-CNPJ" (CN = RAZÃO:CNPJ, como os certificados ICP-Brasil), protegido por senha
function gerarPfx({ cnpj = '11222333000181', senha = 'senha-de-teste', dias = 365, inicio } = {}) {
  const chavePem = novaChave();
  const cert = certificado({ cn: `EMPRESA DE TESTE LTDA:${cnpj}`, chave: chavePem, dias, inicio });
  const p12 = forge.pkcs12.toPkcs12Asn1(forge.pki.privateKeyFromPem(chavePem), [cert], senha, { algorithm: '3des' });
  return { pfx: Buffer.from(forge.asn1.toDer(p12).getBytes(), 'binary'), chavePem, certPem: forge.pki.certificateToPem(cert), senha };
}
// certificado do servidor falso (127.0.0.1)
function gerarServidor() {
  const chavePem = novaChave();
  const cert = certificado({ cn: '127.0.0.1', chave: chavePem, ip: '127.0.0.1' });
  return { key: chavePem, cert: forge.pki.certificateToPem(cert) };
}

const zip = xml => zlib.gzipSync(Buffer.from(xml, 'utf8')).toString('base64');
const NFE = 'http://www.portalfiscal.inf.br/nfe';
const soap = corpo => `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body>${corpo}</soap:Body></soap:Envelope>`;

function retDist({ cStat, xMotivo = 'motivo', ultNSU = '000000000000000', maxNSU = '000000000000000', docs = [] }) {
  const lote = docs.length ? `<loteDistDFeInt>${docs.map(d => `<docZip NSU="${d.nsu}" schema="${d.schema}">${zip(d.xml)}</docZip>`).join('')}</loteDistDFeInt>` : '';
  return soap(`<nfeDistDFeInteresseResponse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe"><nfeDistDFeInteresseResult>` +
    `<retDistDFeInt xmlns="${NFE}" versao="1.01"><tpAmb>2</tpAmb><verAplic>T</verAplic><cStat>${cStat}</cStat><xMotivo>${xMotivo}</xMotivo>` +
    `<dhResp>2026-10-29T10:00:00-03:00</dhResp><ultNSU>${ultNSU}</ultNSU><maxNSU>${maxNSU}</maxNSU>${lote}</retDistDFeInt>` +
    `</nfeDistDFeInteresseResult></nfeDistDFeInteresseResponse>`);
}
function retEvento({ cStat = '128', eventos = [] }) {
  return soap(`<nfeRecepcaoEventoNFResult xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4"><retEnvEvento xmlns="${NFE}" versao="1.00">` +
    `<idLote>1</idLote><tpAmb>2</tpAmb><verAplic>T</verAplic><cOrgao>91</cOrgao><cStat>${cStat}</cStat><xMotivo>Lote processado</xMotivo>` +
    eventos.map(e => `<retEvento versao="1.00"><infEvento><tpAmb>2</tpAmb><verAplic>T</verAplic><cOrgao>91</cOrgao><cStat>${e.cStat}</cStat>` +
      `<xMotivo>${e.xMotivo || 'Evento registrado e vinculado a NF-e'}</xMotivo><chNFe>${e.chave}</chNFe><tpEvento>210210</tpEvento><nProt>191000000000001</nProt></infEvento></retEvento>`).join('') +
    `</retEnvEvento></nfeRecepcaoEventoNFResult>`);
}

const resNFe = ({ chave, cnpj = '11222333000181', nome = 'FORNECEDOR &amp; CIA', valor = '1500.25', dhEmi = '2026-10-20T09:00:00-03:00', sit = '1' }) =>
  `<resNFe xmlns="${NFE}" versao="1.01"><chNFe>${chave}</chNFe><CNPJ>${cnpj}</CNPJ><xNome>${nome}</xNome><IE>1</IE><dhEmi>${dhEmi}</dhEmi>` +
  `<tpNF>1</tpNF><vNF>${valor}</vNF><digVal>x</digVal><dhRecbto>${dhEmi}</dhRecbto><nProt>1</nProt><cSitNFe>${sit}</cSitNFe></resNFe>`;
const procNFe = ({ chave, cnpj = '11222333000181', dest = '33000167000101', numero = '123', valor = '1500.25' }) =>
  `<?xml version="1.0" encoding="UTF-8"?><nfeProc xmlns="${NFE}" versao="4.00"><NFe xmlns="${NFE}"><infNFe Id="NFe${chave}" versao="4.00">` +
  `<ide><nNF>${numero}</nNF><serie>1</serie><dhEmi>2026-10-20T09:00:00-03:00</dhEmi></ide>` +
  `<emit><CNPJ>${cnpj}</CNPJ><xNome>FORNECEDOR TESTE</xNome></emit><dest><CNPJ>${dest}</CNPJ></dest>` +
  `<det nItem="1"><prod><cProd>A1</cProd><xProd>PERFIL TESTE</xProd><uCom>UN</uCom><qCom>2.0000</qCom><vUnCom>10.00</vUnCom><vProd>20.00</vProd></prod></det>` +
  `<total><ICMSTot><vNF>${valor}</vNF></ICMSTot></total></infNFe></NFe>` +
  `<protNFe versao="4.00"><infProt><chNFe>${chave}</chNFe><cStat>100</cStat></infProt></protNFe></nfeProc>`;
const resEvento = ({ chave, tpEvento = '110111', xEvento = 'Cancelamento' }) =>
  `<resEvento xmlns="${NFE}" versao="1.01"><cOrgao>35</cOrgao><CNPJ>11222333000181</CNPJ><chNFe>${chave}</chNFe>` +
  `<dhEvento>2026-10-21T09:00:00-03:00</dhEvento><tpEvento>${tpEvento}</tpEvento><nSeqEvento>1</nSeqEvento><xEvento>${xEvento}</xEvento>` +
  `<dhRecbto>2026-10-21T09:00:00-03:00</dhRecbto><nProt>1</nProt></resEvento>`;

// Servidor falso: respostas em fila por serviço ('dist' | 'evento'); guarda cada pedido (corpo, cabeçalhos, certificado do cliente)
async function criarSefazFalsa({ caCliente }) {
  const tlsServidor = gerarServidor();
  const filas = { dist: [], evento: [] };
  const pedidos = [];
  const servidor = https.createServer({ key: tlsServidor.key, cert: tlsServidor.cert, ca: caCliente, requestCert: true, rejectUnauthorized: false }, (req, res) => {
    const partes = [];
    req.on('data', c => partes.push(c));
    req.on('end', () => {
      const servico = req.url.includes('Distribuicao') ? 'dist' : 'evento';
      const autorizado = req.socket.authorized;
      const peer = req.socket.getPeerCertificate();
      pedidos.push({ servico, url: req.url, corpo: Buffer.concat(partes).toString('utf8'), headers: req.headers, autorizado, cnCliente: peer && peer.subject && peer.subject.CN });
      if (!autorizado) { res.writeHead(403); return res.end('sem certificado'); }
      const resposta = filas[servico].shift();
      if (!resposta) { res.writeHead(500); return res.end('fila vazia'); }
      res.writeHead(resposta.status || 200, { 'Content-Type': 'application/soap+xml; charset=utf-8' });
      res.end(resposta.corpo);
    });
  });
  await new Promise(ok => servidor.listen(0, '127.0.0.1', ok));
  const base = `https://127.0.0.1:${servidor.address().port}`;
  return {
    servidor, pedidos, filas, certServidorPem: tlsServidor.cert,
    urls: { dist: `${base}/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx`, evento: `${base}/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx` },
    fechar: () => new Promise(ok => servidor.close(ok))
  };
}

module.exports = { gerarChave, gerarPfx, gerarServidor, retDist, retEvento, resNFe, procNFe, resEvento, zip, criarSefazFalsa };
