// ==========================================================================
// Notas de compra pela SEFAZ — módulo do serviço local do PC da empresa (carregado por salvador_pdf.js, mesma porta 3917).
//
// O certificado A1 (.pfx) e a senha NUNCA saem deste PC: ficam em sefaz.config.json (ou na variável de ambiente
// ELEGANCE_SEFAZ_SENHA) e só este processo os lê. Nada aqui grava log; nenhuma resposta traz caminho do .pfx nem senha.
//
// Serviços do Ambiente Nacional usados (leiautes conferidos):
//   - NFeDistribuicaoDFe, distDFeInt versão 1.01 (NT 2014.002): distNSU (por último NSU) e consChNFe (por chave).
//     Regras de consumo da NT: cStat 137 (nada novo) ou ultNSU = maxNSU => aguardar 1 hora; 656 (consumo indevido)
//     => bloqueio de 1 hora; no máximo 20 consultas por chave/NSU por hora; sempre usar o ultNSU devolvido.
//   - NFeRecepcaoEvento4 (NF-e 4.00), envEvento/evento versão 1.00, evento 210210 "Ciencia da Operacao"
//     (manifestação do destinatário, NT 2012.002), cOrgao 91 (Ambiente Nacional), assinatura XML-DSig enveloped,
//     C14N 2001-03-15 (inclusiva, sem comentários), RSA-SHA1 e SHA-1, como exige o leiaute da NF-e 4.00.
//
// A assinatura é montada sem biblioteca de XML: o XML do evento é gerado aqui, sem espaços, sem caracteres que
// precisem de escape e já na forma canônica (tags de abertura e fechamento, atributos em ordem), então a forma
// canônica C14N de infEvento é o próprio texto com o xmlns herdado na raiz. Os testes conferem a assinatura.
// Dependências (local/package.json): node-forge (só para abrir o .pfx, inclusive os antigos com RC2) e fast-xml-parser.
// ==========================================================================
'use strict';
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const https = require('node:https');
const http = require('node:http');
const tls = require('node:tls');
const zlib = require('node:zlib');
const crypto = require('node:crypto');

const NS_NFE = 'http://www.portalfiscal.inf.br/nfe';
const NS_DS = 'http://www.w3.org/2000/09/xmldsig#';
const C14N = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315';
const NS_SOAP = 'http://www.w3.org/2003/05/soap-envelope';
const WSDL_DIST = 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe';
const WSDL_EVENTO = 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4';

const LEIAUTE = {
  distribuicao: 'NFeDistribuicaoDFe, distDFeInt 1.01 (NT 2014.002)',
  evento: 'NFeRecepcaoEvento4, envEvento 1.00, evento 210210 1.00 (NT 2012.002, NF-e 4.00), XML-DSig C14N + RSA-SHA1'
};
const URLS = {
  producao: {
    dist: 'https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx',
    evento: 'https://www.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx'
  },
  homologacao: {
    dist: 'https://hom1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx',
    evento: 'https://hom1.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx'
  }
};

const HORA = 60 * 60 * 1000;
const LIMITE_CONSULTAS_CHAVE = 20;       // por hora (NT 2014.002); contamos todas as consultas por chave juntas, por cautela
const MAX_LOTES_POR_SINCRONIZACAO = 10;  // cada lote traz até 50 documentos; o resto vem no próximo clique (sem esperar)
const MAX_CHAVES_CIENCIA = 20;           // um envEvento aceita até 20 eventos
const LIMITE_RESPOSTA = 20 * 1024 * 1024;
const LIMITE_DOC = 5 * 1024 * 1024;      // documento descompactado (docZip)
const LIMITE_CORPO = 4 * 1024;           // corpo JSON vindo da página
const LIMITE_CONFIG = 64 * 1024;
const TEMPO_LIMITE = 60 * 1000;

const UFS = { RO: 11, AC: 12, AM: 13, RR: 14, PA: 15, AP: 16, TO: 17, MA: 21, PI: 22, CE: 23, RN: 24, PB: 25, PE: 26, AL: 27,
  SE: 28, BA: 29, MG: 31, ES: 32, RJ: 33, SP: 35, PR: 41, SC: 42, RS: 43, MS: 50, MT: 51, GO: 52, DF: 53 };

class ErroSefaz extends Error {
  constructor(status, mensagem, extra) { super(mensagem); this.name = 'ErroSefaz'; this.status = status; this.extra = extra || {}; }
}

// ---------------------------------------------------------------- validações puras
function chaveValida(chave) {
  const s = String(chave ?? '');
  if (!/^\d{44}$/.test(s)) return false;
  let soma = 0, peso = 2;
  for (let i = 42; i >= 0; i--) { soma += Number(s[i]) * peso; peso = peso === 9 ? 2 : peso + 1; }
  const r = soma % 11;
  return Number(s[43]) === (r < 2 ? 0 : 11 - r);
}
function cnpjValido(v) {
  const d = String(v ?? '');
  if (!/^\d{14}$/.test(d) || /^(\d)\1{13}$/.test(d)) return false;
  for (const t of [12, 13]) {
    const pesos = t === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let soma = 0;
    for (let i = 0; i < t; i++) soma += Number(d[i]) * pesos[i];
    const resto = soma % 11;
    if ((resto < 2 ? 0 : 11 - resto) !== Number(d[t])) return false;
  }
  return true;
}
// partes da chave de acesso: cUF(2) AAMM(4) CNPJ(14) modelo(2) série(3) número(9) tpEmis(1) código(8) DV(1)
const partesChave = chave => ({ cnpjEmitente: chave.slice(6, 20), modelo: chave.slice(20, 22),
  serie: String(Number(chave.slice(22, 25))), numero: String(Number(chave.slice(25, 34))) });
const nsuValido = v => /^\d{1,15}$/.test(String(v ?? ''));
const nsu15 = v => String(v ?? '0').padStart(15, '0');

// hora de Brasília (UTC-3, sem horário de verão desde 2019) — "HH:MM" para as mensagens
function horaBR(ms) {
  const d = new Date(ms - 3 * HORA);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}
// AAAA-MM-DDThh:mm:ss-03:00 (1 minuto antes do relógio do PC: a SEFAZ recusa evento com data no futuro)
function dhEventoBR(ms) {
  return new Date(ms - 60 * 1000 - 3 * HORA).toISOString().slice(0, 19) + '-03:00';
}

// ---------------------------------------------------------------- configuração e certificado
function codigoUF(uf) {
  const s = String(uf ?? '').trim().toUpperCase();
  if (UFS[s]) return UFS[s];
  const n = Number(s);
  return Object.values(UFS).includes(n) ? n : null;
}

// Lê sefaz.config.json. Devolve { ok: true, config } ou { ok: false, motivo } — o motivo nunca contém a senha.
function lerConfig(arquivo, env = process.env) {
  let bruto;
  try {
    const st = fs.statSync(arquivo);
    if (st.size > LIMITE_CONFIG) return { ok: false, motivo: 'O arquivo sefaz.config.json é grande demais.' };
    bruto = fs.readFileSync(arquivo, 'utf8').replace(/^\uFEFF/, '');
  } catch {
    return { ok: false, motivo: `SEFAZ não configurada: crie o arquivo ${arquivo} (veja docs/sefaz_configuracao.md).` };
  }
  let c;
  try { c = JSON.parse(bruto); } catch { return { ok: false, motivo: 'O arquivo sefaz.config.json não é um JSON válido.' }; }
  if (!c || typeof c !== 'object' || Array.isArray(c)) return { ok: false, motivo: 'O arquivo sefaz.config.json não é um JSON válido.' };
  const cnpj = String(c.cnpj ?? '').replace(/\D/g, '');
  if (!cnpjValido(cnpj)) return { ok: false, motivo: 'CNPJ inválido em sefaz.config.json.' };
  const cUF = codigoUF(c.uf);
  if (!cUF) return { ok: false, motivo: 'UF inválida em sefaz.config.json (use a sigla, ex.: "SP").' };
  const ambiente = String(c.ambiente ?? '').trim().toLowerCase();
  if (ambiente !== 'producao' && ambiente !== 'homologacao') return { ok: false, motivo: 'Ambiente inválido em sefaz.config.json (use "homologacao" ou "producao").' };
  const certificado = typeof c.certificado === 'string' ? c.certificado.trim() : '';
  if (!certificado || !path.isAbsolute(certificado) || !/\.(pfx|p12)$/i.test(certificado)) {
    return { ok: false, motivo: 'Informe em "certificado" o caminho completo do arquivo .pfx.' };
  }
  const senha = typeof env.ELEGANCE_SEFAZ_SENHA === 'string' && env.ELEGANCE_SEFAZ_SENHA !== '' ? env.ELEGANCE_SEFAZ_SENHA
    : (typeof c.senha === 'string' ? c.senha : '');
  if (!senha) return { ok: false, motivo: 'Falta a senha do certificado (campo "senha" ou variável ELEGANCE_SEFAZ_SENHA).' };
  let cadeiaSefaz = '';
  if (c.cadeiaSefaz != null && c.cadeiaSefaz !== '') {
    cadeiaSefaz = String(c.cadeiaSefaz).trim();
    if (!path.isAbsolute(cadeiaSefaz)) return { ok: false, motivo: 'Em "cadeiaSefaz" informe o caminho completo do arquivo .pem.' };
  }
  return { ok: true, config: { cnpj, cUF, uf: String(c.uf).trim().toUpperCase(), ambiente, tpAmb: ambiente === 'producao' ? 1 : 2, certificado, senha, cadeiaSefaz } };
}

// Abre o .pfx com node-forge (aceita os antigos com RC2/3DES, que o OpenSSL 3 do Node recusa) e devolve chave/cadeia em PEM.
function lerCertificado(pfx, senha, forge = require('node-forge')) {
  let p12;
  try {
    const asn1 = forge.asn1.fromDer(forge.util.createBuffer(pfx.toString('binary')));
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, senha);
  } catch (e) {
    if (/MAC could not be verified|Invalid password/i.test(String(e && e.message))) {
      throw new ErroSefaz(400, 'Senha do certificado incorreta (confira sefaz.config.json ou ELEGANCE_SEFAZ_SENHA).');
    }
    throw new ErroSefaz(400, 'Não foi possível abrir o certificado (.pfx). Confira se o arquivo é o certificado A1 da empresa.');
  }
  const bolsas = tipo => (p12.getBags({ bagType: tipo })[tipo] || []);
  const chaves = [...bolsas(forge.pki.oids.pkcs8ShroudedKeyBag), ...bolsas(forge.pki.oids.keyBag)].map(b => b.key).filter(Boolean);
  const certs = bolsas(forge.pki.oids.certBag).map(b => b.cert).filter(Boolean);
  if (!chaves.length || !certs.length) throw new ErroSefaz(400, 'O arquivo .pfx não tem a chave privada e o certificado.');
  const chave = chaves[0];
  const proprio = certs.find(c => c.publicKey && c.publicKey.n && chave.n && c.publicKey.n.equals(chave.n)) || null;
  if (!proprio) throw new ErroSefaz(400, 'O certificado do .pfx não corresponde à chave privada.');
  const der = Buffer.from(forge.asn1.toDer(forge.pki.certificateToAsn1(proprio)).getBytes(), 'binary');
  const cn = (proprio.subject.getField('CN') || {}).value || '';
  const cnpjCert = (/(\d{14})\s*$/.exec(cn) || [])[1] || '';
  return {
    chavePem: forge.pki.privateKeyToPem(chave),
    certPem: forge.pki.certificateToPem(proprio),
    cadeiaPem: certs.filter(c => c !== proprio).map(c => forge.pki.certificateToPem(c)),
    certDerB64: der.toString('base64'),
    titular: cn, cnpjCert,
    validoDe: proprio.validity.notBefore.getTime(), validoAte: proprio.validity.notAfter.getTime()
  };
}

// ---------------------------------------------------------------- XML (montagem)
const soDigitos = (v, n) => { const s = String(v ?? ''); if (!new RegExp(`^\\d{${n}}$`).test(s)) throw new Error('valor fora do formato'); return s; };

// distDFeInt 1.01: { tpAmb, cUF, cnpj } + { ultNSU } (distNSU) ou { chave } (consChNFe)
function montarDistDFe({ tpAmb, cUF, cnpj, ultNSU, chave }) {
  const pedido = chave != null ? `<consChNFe><chNFe>${soDigitos(chave, 44)}</chNFe></consChNFe>`
    : `<distNSU><ultNSU>${soDigitos(nsu15(ultNSU), 15)}</ultNSU></distNSU>`;
  return `<distDFeInt xmlns="${NS_NFE}" versao="1.01"><tpAmb>${Number(tpAmb) === 1 ? 1 : 2}</tpAmb>` +
    `<cUFAutor>${soDigitos(String(cUF), 2)}</cUFAutor><CNPJ>${soDigitos(cnpj, 14)}</CNPJ>${pedido}</distDFeInt>`;
}
const envelopeDist = dist => `<?xml version="1.0" encoding="utf-8"?><soap12:Envelope xmlns:soap12="${NS_SOAP}"><soap12:Body>` +
  `<nfeDistDFeInteresse xmlns="${WSDL_DIST}"><nfeDadosMsg>${dist}</nfeDadosMsg></nfeDistDFeInteresse></soap12:Body></soap12:Envelope>`;
const envelopeEvento = env => `<?xml version="1.0" encoding="utf-8"?><soap12:Envelope xmlns:soap12="${NS_SOAP}"><soap12:Body>` +
  `<nfeDadosMsg xmlns="${WSDL_EVENTO}">${env}</nfeDadosMsg></soap12:Body></soap12:Envelope>`;

// infEvento da Ciência da Operação (210210), sem xmlns (herda o de evento). Id = "ID" + tpEvento + chave + nSeqEvento(2).
function montarInfCiencia({ tpAmb, cnpj, chave, dhEvento }) {
  if (!chaveValida(chave)) throw new Error('chave inválida');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(dhEvento)) throw new Error('dhEvento inválido');
  const id = `ID210210${chave}01`;
  const xml = `<infEvento Id="${id}"><cOrgao>91</cOrgao><tpAmb>${Number(tpAmb) === 1 ? 1 : 2}</tpAmb><CNPJ>${soDigitos(cnpj, 14)}</CNPJ>` +
    `<chNFe>${chave}</chNFe><dhEvento>${dhEvento}</dhEvento><tpEvento>210210</tpEvento><nSeqEvento>1</nSeqEvento>` +
    `<verEvento>1.00</verEvento><detEvento versao="1.00"><descEvento>Ciencia da Operacao</descEvento></detEvento></infEvento>`;
  return { id, xml };
}

// Forma canônica (C14N inclusiva) de infEvento dentro de <evento xmlns="...nfe">: o texto é gerado já canônico; falta só o
// namespace herdado, que a C14N escreve no elemento raiz do trecho (antes dos atributos).
const canonicoInf = infXml => infXml.replace(/^<infEvento /, `<infEvento xmlns="${NS_NFE}" `);
function signedInfo(id, digest) {
  return `<SignedInfo><CanonicalizationMethod Algorithm="${C14N}"></CanonicalizationMethod>` +
    `<SignatureMethod Algorithm="${NS_DS}rsa-sha1"></SignatureMethod><Reference URI="#${id}"><Transforms>` +
    `<Transform Algorithm="${NS_DS}enveloped-signature"></Transform><Transform Algorithm="${C14N}"></Transform></Transforms>` +
    `<DigestMethod Algorithm="${NS_DS}sha1"></DigestMethod><DigestValue>${digest}</DigestValue></Reference></SignedInfo>`;
}
// <evento> assinado (XML-DSig enveloped: a Signature fica dentro de evento, depois de infEvento)
function assinarEvento({ id, xml }, { chavePem, certDerB64 }) {
  const digest = crypto.createHash('sha1').update(canonicoInf(xml), 'utf8').digest('base64');
  const si = signedInfo(id, digest);
  const valor = crypto.createSign('RSA-SHA1').update(si.replace('<SignedInfo>', `<SignedInfo xmlns="${NS_DS}">`), 'utf8').sign(chavePem, 'base64');
  return `<evento xmlns="${NS_NFE}" versao="1.00">${xml}<Signature xmlns="${NS_DS}">${si}<SignatureValue>${valor}</SignatureValue>` +
    `<KeyInfo><X509Data><X509Certificate>${certDerB64}</X509Certificate></X509Data></KeyInfo></Signature></evento>`;
}
const montarEnvEvento = (idLote, eventos) => `<envEvento xmlns="${NS_NFE}" versao="1.00"><idLote>${soDigitos(String(idLote), String(idLote).length)}</idLote>${eventos.join('')}</envEvento>`;

// ---------------------------------------------------------------- XML (leitura)
let _parser = null;
function parser() {
  if (_parser) return _parser;
  const { XMLParser } = require('fast-xml-parser');
  _parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', removeNSPrefix: true, parseTagValue: false,
    processEntities: false, isArray: nome => nome === 'docZip' || nome === 'retEvento' || nome === 'det' });
  return _parser;
}
// XML de fora (SEFAZ ou documento): DOCTYPE recusado, como em rotas/nfe_xml.js (nenhuma entidade é expandida)
function lerXml(texto) {
  const s = String(texto ?? '');
  if (!s.trim() || /<!DOCTYPE/i.test(s) || /<!ENTITY/i.test(s)) throw new ErroSefaz(502, 'Resposta da SEFAZ em formato inesperado.');
  const { XMLValidator } = require('fast-xml-parser');
  if (XMLValidator.validate(s) !== true) throw new ErroSefaz(502, 'Resposta da SEFAZ em formato inesperado.');
  try { return parser().parse(s); } catch { throw new ErroSefaz(502, 'Resposta da SEFAZ em formato inesperado.'); }
}
function acharNo(obj, nome, prof = 0) {
  if (!obj || typeof obj !== 'object' || prof > 12) return null;
  if (Object.prototype.hasOwnProperty.call(obj, nome)) return obj[nome];
  for (const v of Object.values(obj)) { const r = acharNo(v, nome, prof + 1); if (r != null) return r; }
  return null;
}
const ESCAPES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const texto = v => String(v == null || typeof v === 'object' ? (v && typeof v['#text'] === 'string' ? v['#text'] : '') : v)
  .replace(/&(amp|lt|gt|quot|apos|#(\d{1,7})|#x([0-9a-fA-F]{1,6}));/g, (todo, n, d, h) => {
    if (ESCAPES[n]) return ESCAPES[n];
    const cp = d ? Number(d) : parseInt(h, 16);
    return cp > 0 && cp <= 0x10FFFF ? String.fromCodePoint(cp) : todo;
  }).trim();

// SOAP Fault da SEFAZ → mensagem
function falhaSoap(raiz) {
  const f = acharNo(raiz, 'Fault');
  if (!f) return null;
  const motivo = texto(acharNo(f, 'Text')) || texto(acharNo(f, 'faultstring')) || 'erro SOAP';
  return motivo.slice(0, 300);
}

// docZip = base64 de um XML compactado com gzip
function descompactarDocZip(b64) {
  const s = String(b64 ?? '').replace(/\s+/g, '');
  if (!s || !/^[A-Za-z0-9+/]+={0,2}$/.test(s)) throw new ErroSefaz(502, 'Documento da SEFAZ em formato inesperado.');
  try { return zlib.gunzipSync(Buffer.from(s, 'base64'), { maxOutputLength: LIMITE_DOC }).toString('utf8'); }
  catch { throw new ErroSefaz(502, 'Documento da SEFAZ em formato inesperado.'); }
}

// retDistDFeInt → { cStat, xMotivo, ultNSU, maxNSU, docs: [{ nsu, schema, xml }] }
function interpretarRetDist(xmlResposta) {
  const raiz = lerXml(xmlResposta);
  const fault = falhaSoap(raiz);
  if (fault) throw new ErroSefaz(502, `A SEFAZ recusou o pedido: ${fault}`);
  const ret = acharNo(raiz, 'retDistDFeInt');
  if (!ret || typeof ret !== 'object') throw new ErroSefaz(502, 'Resposta da SEFAZ em formato inesperado.');
  const cStat = texto(ret.cStat), ultNSU = texto(ret.ultNSU), maxNSU = texto(ret.maxNSU);
  const docs = ((ret.loteDistDFeInt && ret.loteDistDFeInt.docZip) || []).map(d => ({
    nsu: texto(d['@NSU']), schema: texto(d['@schema']), xml: descompactarDocZip(texto(d))
  }));
  return { cStat, xMotivo: texto(ret.xMotivo).slice(0, 300), ultNSU: nsuValido(ultNSU) ? nsu15(ultNSU) : '',
    maxNSU: nsuValido(maxNSU) ? nsu15(maxNSU) : '', docs };
}

const dataDe = v => (/^\d{4}-\d{2}-\d{2}/.exec(texto(v)) || [''])[0];
const valorDe = v => { const n = Number(texto(v)); return Number.isFinite(n) ? n : null; };

// documento descompactado → { tipo, ... } (resNFe, procNFe, resEvento, procEvento); outro tipo = { tipo: 'outro' }
function lerDocumento(xml) {
  const raiz = lerXml(xml);
  if (raiz.resNFe) {
    const r = raiz.resNFe;
    return { tipo: 'resNFe', chave: texto(r.chNFe), cnpjEmitente: texto(r.CNPJ) || texto(r.CPF), emitente: texto(r.xNome),
      dataEmissao: dataDe(r.dhEmi), valor: valorDe(r.vNF), sitNFe: texto(r.cSitNFe) };
  }
  const proc = raiz.nfeProc || null;
  if (proc && proc.NFe && proc.NFe.infNFe) {
    const inf = proc.NFe.infNFe, prot = (proc.protNFe && proc.protNFe.infProt) || {};
    const doId = texto(inf['@Id']).replace(/^NFe/, '');
    const chave = texto(prot.chNFe) || doId;
    if (doId && chave !== doId) throw new ErroSefaz(502, 'Documento da SEFAZ com chave inconsistente.');
    const emit = inf.emit || {}, ide = inf.ide || {}, dest = inf.dest || {};
    return { tipo: 'procNFe', chave, cnpjEmitente: texto(emit.CNPJ) || texto(emit.CPF), emitente: texto(emit.xNome),
      dataEmissao: dataDe(ide.dhEmi || ide.dEmi), valor: valorDe(inf.total && inf.total.ICMSTot && inf.total.ICMSTot.vNF),
      numero: texto(ide.nNF), serie: texto(ide.serie), cnpjDestinatario: texto(dest.CNPJ) || texto(dest.CPF), cStatProt: texto(prot.cStat) };
  }
  if (raiz.resEvento) {
    const r = raiz.resEvento;
    return { tipo: 'resEvento', chave: texto(r.chNFe), tpEvento: texto(r.tpEvento), descricao: texto(r.xEvento), data: dataDe(r.dhEvento) };
  }
  const pe = raiz.procEventoNFe;
  if (pe && pe.evento && pe.evento.infEvento) {
    const i = pe.evento.infEvento;
    return { tipo: 'procEvento', chave: texto(i.chNFe), tpEvento: texto(i.tpEvento),
      descricao: texto(i.detEvento && i.detEvento.descEvento), data: dataDe(i.dhEvento) };
  }
  return { tipo: 'outro' };
}

// XML completo da NF-e que vai para o disco (e depois para a entrada de estoque): precisa ser nfeProc/NFe com infNFe
function xmlNFeValido(xml, chave) {
  const s = String(xml ?? '');
  if (!s.trim() || /<!DOCTYPE/i.test(s) || Buffer.byteLength(s, 'utf8') > LIMITE_DOC) return false;
  try { const d = lerDocumento(s); return d.tipo === 'procNFe' && d.chave === chave; } catch { return false; }
}

// retEnvEvento → { cStat, xMotivo, eventos: [{ chave, cStat, xMotivo, nProt }] }
function interpretarRetEvento(xmlResposta) {
  const raiz = lerXml(xmlResposta);
  const fault = falhaSoap(raiz);
  if (fault) throw new ErroSefaz(502, `A SEFAZ recusou o pedido: ${fault}`);
  const ret = acharNo(raiz, 'retEnvEvento');
  if (!ret || typeof ret !== 'object') throw new ErroSefaz(502, 'Resposta da SEFAZ em formato inesperado.');
  return {
    cStat: texto(ret.cStat), xMotivo: texto(ret.xMotivo).slice(0, 300),
    eventos: (ret.retEvento || []).map(r => { const i = r.infEvento || {}; return { chave: texto(i.chNFe), cStat: texto(i.cStat), xMotivo: texto(i.xMotivo).slice(0, 300), nProt: texto(i.nProt) }; })
  };
}
// 135 = registrado e vinculado; 136 = registrado sem vínculo; 573 = duplicidade (a ciência já existia)
const CIENCIA_OK = new Set(['135', '136', '573']);

// ---------------------------------------------------------------- arquivos locais (índice e estado)
async function lerJson(arquivo, padrao) {
  try { return JSON.parse(await fsp.readFile(arquivo, 'utf8')); } catch { return padrao; }
}
// grava num temporário e troca (o índice nunca fica pela metade se o PC desligar)
async function gravarJson(arquivo, dados) {
  await fsp.mkdir(path.dirname(arquivo), { recursive: true });
  const tmp = `${arquivo}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(dados, null, 1));
  await fsp.rename(tmp, arquivo);
}

const SITUACOES = ['resumo', 'ciencia', 'completa', 'importada'];
const ordem = s => SITUACOES.indexOf(s);

// Aplica um documento da SEFAZ no índice (função pura sobre o objeto `notas`); devolve 'nova' | 'atualizada' | null
function aplicarDocumento(notas, doc, { cnpjEmpresa, agoraIso }) {
  if (!doc || !chaveValida(doc.chave)) return null;
  const antes = notas[doc.chave];
  const n = antes ? { ...antes } : { chave: doc.chave, ...partesChave(doc.chave), situacao: 'resumo', eventos: [] };
  if (doc.tipo === 'resNFe' || doc.tipo === 'procNFe') {
    for (const k of ['emitente', 'cnpjEmitente', 'dataEmissao']) if (doc[k]) n[k] = doc[k];
    if (doc.valor != null) n.valor = doc.valor;
    if (doc.sitNFe) n.sitNFe = doc.sitNFe;                  // 1 autorizada, 2 denegada, 3 cancelada
    if (doc.sitNFe === '3') n.cancelada = true;
  }
  if (doc.tipo === 'procNFe') {
    if (doc.numero) n.numero = String(Number(doc.numero) || doc.numero);
    if (doc.serie) n.serie = String(Number(doc.serie) || doc.serie);
    n.paraEmpresa = !!cnpjEmpresa && doc.cnpjDestinatario === cnpjEmpresa;
    if (ordem(n.situacao) < ordem('completa')) n.situacao = 'completa';
  }
  if (doc.tipo === 'resEvento' || doc.tipo === 'procEvento') {
    n.eventos = (n.eventos || []).filter(e => e.tpEvento !== doc.tpEvento).concat({ tpEvento: doc.tpEvento, descricao: doc.descricao, data: doc.data });
    if (doc.tpEvento === '110111' || doc.tpEvento === '110112') n.cancelada = true;     // cancelamento
    if (doc.tpEvento === '210210' && ordem(n.situacao) < ordem('ciencia')) n.situacao = 'ciencia';
  }
  n.atualizadoEm = agoraIso;
  notas[doc.chave] = n;
  return antes ? 'atualizada' : 'nova';
}

// ---------------------------------------------------------------- transporte (mTLS)
function criarAgente(cert, cadeiaExtraPem) {
  let sistema = [];
  try { if (typeof tls.getCACertificates === 'function') sistema = tls.getCACertificates('system'); } catch { sistema = []; }
  const ca = [...tls.rootCertificates, ...sistema, ...(cadeiaExtraPem ? [cadeiaExtraPem] : [])];
  // chave e certificado em PEM (o .pfx já foi aberto pelo node-forge); a verificação do servidor nunca é desligada
  return new https.Agent({ key: cert.chavePem, cert: [cert.certPem, ...cert.cadeiaPem].join(''), ca, minVersion: 'TLSv1.2', keepAlive: false });
}

const ERROS_TLS = /CERT|SELF_SIGNED|UNABLE_TO|ISSUER|LEAF_SIGNATURE/;
function postarSoap(url, envelope, action, { agente, tempoLimite = TEMPO_LIMITE }) {
  return new Promise((ok, falha) => {
    const u = new URL(url);
    const modulo = u.protocol === 'https:' ? https : http;   // http só nos testes (URL injetada por código, nunca pela config)
    const corpo = Buffer.from(envelope, 'utf8');
    const req = modulo.request(u, {
      method: 'POST', agent: u.protocol === 'https:' ? agente : undefined, timeout: tempoLimite,
      headers: { 'Content-Type': `application/soap+xml; charset=utf-8; action="${action}"`, 'Content-Length': corpo.length }
    }, res => {
      const partes = []; let total = 0;
      res.on('data', c => {
        total += c.length;
        if (total > LIMITE_RESPOSTA) { req.destroy(); falha(new ErroSefaz(502, 'Resposta da SEFAZ grande demais.')); return; }
        partes.push(c);
      });
      res.on('end', () => ok({ status: res.statusCode, corpo: Buffer.concat(partes).toString('utf8') }));
      res.on('error', () => falha(new ErroSefaz(502, 'A conexão com a SEFAZ caiu no meio da resposta. Tente de novo.')));
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('tempo esgotado'), { code: 'ETIMEDOUT' })));
    req.on('error', e => {
      if (e instanceof ErroSefaz) return falha(e);
      const codigo = String(e.code || '');
      if (ERROS_TLS.test(codigo)) return falha(new ErroSefaz(502, 'O certificado do servidor da SEFAZ não foi reconhecido neste PC. ' +
        'Informe em "cadeiaSefaz" (sefaz.config.json) o arquivo .pem com a cadeia ICP-Brasil (veja docs/sefaz_configuracao.md).'));
      falha(new ErroSefaz(502, `Sem conexão com a SEFAZ (${codigo || 'erro de rede'}). Confira a internet e tente de novo.`));
    });
    req.end(corpo);
  });
}
function conferirHttp(r) {
  if (r.status === 403) throw new ErroSefaz(502, 'A SEFAZ recusou o certificado digital (HTTP 403). Confira se é o e-CNPJ A1 da empresa e se está válido.');
  if (r.status >= 400 && !/Fault/.test(r.corpo)) throw new ErroSefaz(502, `A SEFAZ respondeu com erro HTTP ${r.status}. Tente mais tarde.`);
}

// ---------------------------------------------------------------- o serviço
function criarSefaz({ raiz, arquivoConfig, env = process.env, agora = () => Date.now(), urls = null, tempoLimite = TEMPO_LIMITE } = {}) {
  const RAIZ = raiz || 'C:\\Programa Elegance';
  const CONFIG = arquivoConfig || env.ELEGANCE_SEFAZ_CONFIG || path.join(RAIZ, 'Servico', 'sefaz.config.json');
  const ESTADO = path.join(path.dirname(CONFIG), 'sefaz.estado.json');
  const pastaNotas = amb => path.join(RAIZ, 'NFe', amb === 'producao' ? 'Entrada' : 'Entrada_Homologacao');
  let cache = null;      // { marca, cert, agente }
  let ocupado = false;

  // configuração + certificado + agente mTLS (lido de novo só quando o arquivo de config ou o .pfx mudam)
  function contexto() {
    const lida = lerConfig(CONFIG, env);
    if (!lida.ok) throw new ErroSefaz(503, lida.motivo, { configurada: false });
    const cfg = lida.config;
    let stPfx;
    try { stPfx = fs.statSync(cfg.certificado); } catch { throw new ErroSefaz(503, 'Não encontrei o arquivo do certificado indicado em sefaz.config.json.', { configurada: false }); }
    const stCfg = fs.statSync(CONFIG);
    const marca = [stCfg.mtimeMs, stCfg.size, cfg.certificado, stPfx.mtimeMs, stPfx.size, cfg.cadeiaSefaz,
      crypto.createHash('sha256').update(cfg.senha).digest('hex')].join('|');
    if (!cache || cache.marca !== marca) {
      let forge;
      try { forge = require('node-forge'); } catch { throw new ErroSefaz(503, 'Componente node-forge não instalado: rode de novo o instalador do serviço local.', { configurada: false }); }
      let cert;
      try { cert = lerCertificado(fs.readFileSync(cfg.certificado), cfg.senha, forge); }
      catch (e) { throw e instanceof ErroSefaz ? new ErroSefaz(503, e.message, { configurada: false }) : e; }
      let cadeia = '';
      if (cfg.cadeiaSefaz) {
        try { cadeia = fs.readFileSync(cfg.cadeiaSefaz, 'utf8'); } catch { throw new ErroSefaz(503, 'Não encontrei o arquivo indicado em "cadeiaSefaz".', { configurada: false }); }
      }
      cache = { marca, cert, agente: criarAgente(cert, cadeia) };
    }
    const url = (urls && urls[cfg.ambiente]) || URLS[cfg.ambiente];
    return { cfg, cert: cache.cert, agente: cache.agente, url };
  }
  function conferirValidade(cert) {
    if (agora() > cert.validoAte) throw new ErroSefaz(503, `O certificado digital venceu em ${new Date(cert.validoAte).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}.`, { configurada: false });
  }

  const chaveEstado = cfg => `${cfg.cnpj}-${cfg.ambiente}`;
  async function lerEstado(cfg) {
    const todos = await lerJson(ESTADO, {});
    const e = (todos && typeof todos === 'object' && todos[chaveEstado(cfg)]) || {};
    return { ultNSU: nsuValido(e.ultNSU) ? nsu15(e.ultNSU) : nsu15(0), maxNSU: nsuValido(e.maxNSU) ? nsu15(e.maxNSU) : '',
      liberadoEm: Number(e.liberadoEm) || 0, bloqueadoAte: Number(e.bloqueadoAte) || 0, motivoBloqueio: String(e.motivoBloqueio || ''),
      consultasChave: Array.isArray(e.consultasChave) ? e.consultasChave.map(Number).filter(Number.isFinite) : [],
      ultimaSincronizacao: Number(e.ultimaSincronizacao) || 0 };
  }
  async function gravarEstado(cfg, est) {
    const todos = await lerJson(ESTADO, {});
    const base = todos && typeof todos === 'object' && !Array.isArray(todos) ? todos : {};
    base[chaveEstado(cfg)] = est;
    await gravarJson(ESTADO, base);
  }
  const arquivoIndice = cfg => path.join(pastaNotas(cfg.ambiente), 'indice.json');
  async function lerIndice(cfg) {
    const d = await lerJson(arquivoIndice(cfg), null);
    return d && typeof d === 'object' && d.notas && typeof d.notas === 'object' ? d : { versao: 1, notas: {} };
  }
  const gravarIndice = (cfg, ind) => gravarJson(arquivoIndice(cfg), ind);
  const arquivoXml = (cfg, chave) => {
    if (!chaveValida(chave)) throw new ErroSefaz(400, 'Chave de acesso inválida.');
    return path.join(pastaNotas(cfg.ambiente), `${chave}.xml`);      // nome montado só com a chave validada
  };

  async function exclusivo(fn) {
    if (ocupado) throw new ErroSefaz(409, 'Já há uma operação com a SEFAZ em andamento. Aguarde terminar.');
    ocupado = true;
    try { return await fn(); } finally { ocupado = false; }
  }
  function conferirBloqueio(est) {
    const t = agora();
    if (est.bloqueadoAte > t) throw new ErroSefaz(429, `A SEFAZ bloqueou novas consultas por consumo indevido. Próxima consulta liberada às ${horaBR(est.bloqueadoAte)}.`, { liberadaEm: est.bloqueadoAte });
  }

  // grava os documentos recebidos (XML completo no disco, resumo/eventos no índice)
  async function guardarDocumentos(cfg, docs) {
    const ind = await lerIndice(cfg);
    let novas = 0, atualizadas = 0;
    const ignorados = { ilegivel: 0, tipoDesconhecido: 0, xmlInvalido: 0 };   // nada é descartado em silêncio: a tela mostra a contagem
    const agoraIso = new Date(agora()).toISOString();
    for (const d of docs) {
      let doc;
      try { doc = lerDocumento(d.xml); } catch { ignorados.ilegivel++; continue; }       // documento ilegível: ignorado (não derruba o lote)
      if (doc.tipo === 'outro' || !chaveValida(doc.chave)) { ignorados.tipoDesconhecido++; continue; }
      if (doc.tipo === 'procNFe') {
        if (!xmlNFeValido(d.xml, doc.chave)) { ignorados.xmlInvalido++; continue; }
        await fsp.mkdir(pastaNotas(cfg.ambiente), { recursive: true });
        await fsp.writeFile(arquivoXml(cfg, doc.chave), d.xml, 'utf8');
      }
      const r = aplicarDocumento(ind.notas, doc, { cnpjEmpresa: cfg.cnpj, agoraIso });
      if (r === 'nova') novas++; else if (r === 'atualizada') atualizadas++;
    }
    await gravarIndice(cfg, ind);
    return { novas, atualizadas, recebidos: docs.length, ignorados, indice: ind };
  }

  async function consultarDist(ctx, pedido) {
    const env = envelopeDist(montarDistDFe({ tpAmb: ctx.cfg.tpAmb, cUF: ctx.cfg.cUF, cnpj: ctx.cfg.cnpj, ...pedido }));
    const r = await postarSoap(ctx.url.dist, env, `${WSDL_DIST}/nfeDistDFeInteresse`, { agente: ctx.agente, tempoLimite });
    conferirHttp(r);
    return interpretarRetDist(r.corpo);
  }

  // ---------- operações ----------
  async function status() {
    let ctx;
    try { ctx = contexto(); }
    catch (e) { if (e instanceof ErroSefaz) return { configurada: false, motivo: e.message, leiaute: LEIAUTE }; throw e; }
    const { cfg, cert } = ctx;
    const est = await lerEstado(cfg);
    const ind = await lerIndice(cfg);
    const t = agora();
    const avisos = [];
    if (t > cert.validoAte) avisos.push('O certificado digital está vencido.');
    else if (cert.validoAte - t < 30 * 24 * HORA) avisos.push('O certificado digital vence em menos de 30 dias.');
    if (cert.cnpjCert && cert.cnpjCert.slice(0, 8) !== cfg.cnpj.slice(0, 8)) avisos.push('O CNPJ do certificado não é da mesma empresa do CNPJ configurado.');
    const recentes = est.consultasChave.filter(x => x > t - HORA);
    const proxima = Math.max(est.liberadoEm, est.bloqueadoAte);
    return {
      configurada: true, ambiente: cfg.ambiente, cnpj: cfg.cnpj, uf: cfg.uf, leiaute: LEIAUTE,
      certificado: { titular: cert.titular, validoAte: new Date(cert.validoAte).toISOString(), diasRestantes: Math.floor((cert.validoAte - t) / (24 * HORA)) },
      avisos, ultNSU: est.ultNSU, maxNSU: est.maxNSU,
      ultimaSincronizacao: est.ultimaSincronizacao ? new Date(est.ultimaSincronizacao).toISOString() : null,
      proximaConsulta: proxima > t ? new Date(proxima).toISOString() : null, proximaConsultaHora: proxima > t ? horaBR(proxima) : null,
      bloqueado: est.bloqueadoAte > t, consultasChaveNaHora: recentes.length, limiteConsultasChave: LIMITE_CONSULTAS_CHAVE,
      ocupado, qtdNotas: Object.keys(ind.notas).length, pasta: pastaNotas(cfg.ambiente)
    };
  }

  // reiniciar = true: volta o ponteiro para o NSU 0 e busca de novo todo o histórico que a SEFAZ ainda guarda (só quando pedido de propósito)
  function sincronizar({ reiniciar = false } = {}) {
    return exclusivo(async () => {
      const ctx = contexto(); conferirValidade(ctx.cert);
      const est = await lerEstado(ctx.cfg);
      conferirBloqueio(est);
      if (est.liberadoEm > agora()) {
        throw new ErroSefaz(429, `A última consulta não trouxe nada novo; a SEFAZ exige esperar 1 hora. Próxima consulta liberada às ${horaBR(est.liberadoEm)}.`, { liberadaEm: est.liberadoEm });
      }
      if (reiniciar) { est.ultNSU = nsu15(0); est.maxNSU = ''; await gravarEstado(ctx.cfg, est); }
      let novas = 0, atualizadas = 0, lotes = 0, ultimo = null, recebidos = 0;
      const ignorados = { ilegivel: 0, tipoDesconhecido: 0, xmlInvalido: 0 };
      while (lotes < MAX_LOTES_POR_SINCRONIZACAO) {
        lotes++;
        const r = await consultarDist(ctx, { ultNSU: est.ultNSU });
        ultimo = r;
        est.ultimaSincronizacao = agora();
        if (r.cStat === '656') {
          // NÃO adota o ultNSU que a SEFAZ devolve no 656: ele é a posição final da fila e pularia documentos que nunca foram baixados
          est.bloqueadoAte = agora() + HORA; est.motivoBloqueio = r.xMotivo;
          await gravarEstado(ctx.cfg, est);
          throw new ErroSefaz(429, `A SEFAZ informou consumo indevido (656: ${r.xMotivo}). Novas consultas bloqueadas; próxima liberada às ${horaBR(est.bloqueadoAte)}.`, { liberadaEm: est.bloqueadoAte, novas, atualizadas });
        }
        if (r.cStat === '137') {
          if (r.ultNSU) est.ultNSU = r.ultNSU;
          if (r.maxNSU) est.maxNSU = r.maxNSU;
          est.liberadoEm = agora() + HORA;
          await gravarEstado(ctx.cfg, est);
          break;
        }
        if (r.cStat !== '138') {
          await gravarEstado(ctx.cfg, est);
          throw new ErroSefaz(502, `A SEFAZ respondeu ${r.cStat || 'sem código'}: ${r.xMotivo || 'sem motivo'}.`);
        }
        const g = await guardarDocumentos(ctx.cfg, r.docs);
        novas += g.novas; atualizadas += g.atualizadas; recebidos += g.recebidos;
        for (const k of Object.keys(ignorados)) ignorados[k] += g.ignorados[k];
        if (r.ultNSU) est.ultNSU = r.ultNSU;
        if (r.maxNSU) est.maxNSU = r.maxNSU;
        const fim = !r.ultNSU || !r.maxNSU || est.ultNSU >= est.maxNSU;
        if (fim) est.liberadoEm = agora() + HORA;          // ultNSU = maxNSU: nada mais a buscar agora (NT 2014.002)
        await gravarEstado(ctx.cfg, est);
        if (fim) break;
      }
      const haMais = !!(est.maxNSU && est.ultNSU < est.maxNSU);
      return { ok: true, cStat: ultimo.cStat, mensagem: ultimo.xMotivo, novas, atualizadas, recebidos, ignorados, reiniciado: !!reiniciar, ultNSU: est.ultNSU, maxNSU: est.maxNSU, haMais,
        proximaConsulta: est.liberadoEm > agora() ? new Date(est.liberadoEm).toISOString() : null,
        proximaConsultaHora: est.liberadoEm > agora() ? horaBR(est.liberadoEm) : null };
    });
  }

  function baixar(chave) {
    if (!chaveValida(chave)) return Promise.reject(new ErroSefaz(400, 'Chave de acesso inválida (44 números com dígito verificador).'));
    return exclusivo(async () => {
      const ctx = contexto(); conferirValidade(ctx.cert);
      const est = await lerEstado(ctx.cfg);
      conferirBloqueio(est);
      const t = agora();
      est.consultasChave = est.consultasChave.filter(x => x > t - HORA);
      if (est.consultasChave.length >= LIMITE_CONSULTAS_CHAVE) {
        const libera = Math.min(...est.consultasChave) + HORA;
        throw new ErroSefaz(429, `Limite de ${LIMITE_CONSULTAS_CHAVE} consultas por chave em 1 hora atingido. Próxima consulta liberada às ${horaBR(libera)}.`, { liberadaEm: libera });
      }
      est.consultasChave.push(t);
      await gravarEstado(ctx.cfg, est);
      const r = await consultarDist(ctx, { chave });
      if (r.cStat === '656') {
        est.bloqueadoAte = agora() + HORA; est.motivoBloqueio = r.xMotivo;
        await gravarEstado(ctx.cfg, est);
        throw new ErroSefaz(429, `A SEFAZ informou consumo indevido (656: ${r.xMotivo}). Próxima consulta liberada às ${horaBR(est.bloqueadoAte)}.`, { liberadaEm: est.bloqueadoAte });
      }
      if (r.cStat === '137') throw new ErroSefaz(404, 'A SEFAZ ainda não tem documento desta nota para a empresa (137). Se acabou de dar a ciência, tente de novo em alguns minutos.');
      if (r.cStat !== '138') throw new ErroSefaz(502, `A SEFAZ respondeu ${r.cStat || 'sem código'}: ${r.xMotivo || 'sem motivo'}.`);
      const g = await guardarDocumentos(ctx.cfg, r.docs);
      const nota = g.indice.notas[chave] || null;
      const completa = !!nota && (nota.situacao === 'completa' || nota.situacao === 'importada');
      return { ok: true, completa, nota,
        mensagem: completa ? 'XML completo baixado.' : 'A SEFAZ só liberou o resumo: faça a Ciência da operação e tente de novo depois.' };
    });
  }

  function ciencia(chaves) {
    const lista = [...new Set((Array.isArray(chaves) ? chaves : []).map(String))];
    if (!lista.length) return Promise.reject(new ErroSefaz(400, 'Informe a chave da nota.'));
    if (lista.length > MAX_CHAVES_CIENCIA) return Promise.reject(new ErroSefaz(400, `No máximo ${MAX_CHAVES_CIENCIA} notas por vez.`));
    if (lista.some(c => !chaveValida(c))) return Promise.reject(new ErroSefaz(400, 'Chave de acesso inválida (44 números com dígito verificador).'));
    return exclusivo(async () => {
      const ctx = contexto(); conferirValidade(ctx.cert);
      const dh = dhEventoBR(agora());
      const eventos = lista.map(chave => assinarEvento(montarInfCiencia({ tpAmb: ctx.cfg.tpAmb, cnpj: ctx.cfg.cnpj, chave, dhEvento: dh }), ctx.cert));
      const idLote = String(agora()).slice(-15);
      const r = await postarSoap(ctx.url.evento, envelopeEvento(montarEnvEvento(idLote, eventos)), `${WSDL_EVENTO}/nfeRecepcaoEvento`, { agente: ctx.agente, tempoLimite });
      conferirHttp(r);
      const ret = interpretarRetEvento(r.corpo);
      if (ret.cStat !== '128') throw new ErroSefaz(502, `A SEFAZ não processou o lote (${ret.cStat || 'sem código'}: ${ret.xMotivo || 'sem motivo'}).`);
      const ind = await lerIndice(ctx.cfg);
      const agoraIso = new Date(agora()).toISOString();
      const resultados = lista.map(chave => {
        const e = ret.eventos.find(x => x.chave === chave);
        if (!e) return { chave, ok: false, mensagem: 'A SEFAZ não devolveu o resultado desta nota.' };
        const ok = CIENCIA_OK.has(e.cStat);
        if (ok) aplicarDocumento(ind.notas, { tipo: 'procEvento', chave, tpEvento: '210210', descricao: 'Ciencia da Operacao', data: dh.slice(0, 10) }, { cnpjEmpresa: ctx.cfg.cnpj, agoraIso });
        return { chave, ok, cStat: e.cStat, mensagem: ok ? (e.cStat === '573' ? 'A ciência já estava registrada.' : 'Ciência registrada.') : `${e.cStat}: ${e.xMotivo}` };
      });
      await gravarIndice(ctx.cfg, ind);
      return { ok: true, resultados };
    });
  }

  async function notas() {
    const { cfg } = contexto();
    const ind = await lerIndice(cfg);
    const lista = Object.values(ind.notas).filter(n => n && chaveValida(n.chave))
      .sort((a, b) => String(b.dataEmissao || '').localeCompare(String(a.dataEmissao || '')) || a.chave.localeCompare(b.chave));
    return { ambiente: cfg.ambiente, notas: lista };
  }
  async function xml(chave) {
    if (!chaveValida(chave)) throw new ErroSefaz(400, 'Chave de acesso inválida.');
    const { cfg } = contexto();
    const n = (await lerIndice(cfg)).notas[chave];
    if (!n || (n.situacao !== 'completa' && n.situacao !== 'importada')) throw new ErroSefaz(404, 'O XML completo desta nota ainda não foi baixado.');
    let conteudo;
    try { conteudo = await fsp.readFile(arquivoXml(cfg, chave), 'utf8'); } catch { throw new ErroSefaz(404, 'O arquivo XML desta nota não está mais na pasta.'); }
    if (!xmlNFeValido(conteudo, chave)) throw new ErroSefaz(422, 'O arquivo XML desta nota está danificado. Baixe de novo.');
    return conteudo;
  }
  async function importada(chave) {
    if (!chaveValida(chave)) throw new ErroSefaz(400, 'Chave de acesso inválida.');
    const { cfg } = contexto();
    const ind = await lerIndice(cfg);
    const n = ind.notas[chave];
    if (!n || (n.situacao !== 'completa' && n.situacao !== 'importada')) throw new ErroSefaz(409, 'Só nota com XML completo pode ser marcada como importada.');
    if (n.situacao !== 'importada') { n.situacao = 'importada'; n.importadaEm = new Date(agora()).toISOString(); await gravarIndice(cfg, ind); }
    return { ok: true, nota: n };
  }

  // ---------- HTTP (chamado por salvador_pdf.js depois do controle de origem) ----------
  function responder(res, status, corpo) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(corpo));
  }
  function lerCorpoJson(req) {
    return new Promise((ok, falha) => {
      if (!/^application\/json\b/i.test(String(req.headers['content-type'] || ''))) { falha(new ErroSefaz(415, 'Envie JSON.')); return; }
      const partes = []; let total = 0, parou = false;
      req.on('data', c => {
        if (parou) return;
        total += c.length;
        if (total > LIMITE_CORPO) { parou = true; falha(new ErroSefaz(413, 'Pedido grande demais.')); return; }
        partes.push(c);
      });
      req.on('end', () => {
        if (parou) return;
        try { const d = JSON.parse(Buffer.concat(partes).toString('utf8') || '{}'); ok(d && typeof d === 'object' && !Array.isArray(d) ? d : {}); }
        catch { falha(new ErroSefaz(400, 'JSON inválido.')); }
      });
      req.on('error', () => falha(new ErroSefaz(400, 'Pedido interrompido.')));
    });
  }

  // origem já conferida por quem chama (só o site do sistema); aqui: Origin obrigatório e Host local (contra DNS rebinding)
  async function tratar(req, res, url, { origemPermitida }) {
    try {
      if (!origemPermitida) throw new ErroSefaz(403, 'Origem não permitida.');
      if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/i.test(String(req.headers.host || ''))) throw new ErroSefaz(403, 'Host não permitido.');
      const p = url.pathname, m = req.method;
      if (m === 'GET' && p === '/sefaz/status') return responder(res, 200, await status());
      if (m === 'GET' && p === '/sefaz/notas') return responder(res, 200, await notas());
      if (m === 'GET' && p.startsWith('/sefaz/xml/')) {
        const conteudo = await xml(p.slice('/sefaz/xml/'.length));
        res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(conteudo);
      }
      if (m === 'POST' && p === '/sefaz/sincronizar') { const b = await lerCorpoJson(req); return responder(res, 200, await sincronizar({ reiniciar: !!b && b.reiniciarHistorico === true })); }
      if (m === 'POST' && p === '/sefaz/ciencia') {
        const b = await lerCorpoJson(req);
        return responder(res, 200, await ciencia(Array.isArray(b.chaves) ? b.chaves : [b.chave]));
      }
      if (m === 'POST' && p === '/sefaz/baixar') { const b = await lerCorpoJson(req); return responder(res, 200, await baixar(String(b.chave ?? ''))); }
      if (m === 'POST' && p === '/sefaz/importada') { const b = await lerCorpoJson(req); return responder(res, 200, await importada(String(b.chave ?? ''))); }
      return responder(res, 404, { error: 'Rota não encontrada' });
    } catch (e) {
      if (e instanceof ErroSefaz) return responder(res, e.status, { error: e.message, ...e.extra });
      return responder(res, 500, { error: 'Erro interno do serviço local da SEFAZ.' });   // sem detalhes: nada de caminho, senha ou pilha
    }
  }

  return { tratar, status, sincronizar, baixar, ciencia, notas, xml, importada, arquivoConfig: CONFIG, arquivoEstado: ESTADO, pastaNotas };
}

module.exports = {
  criarSefaz, ErroSefaz, LEIAUTE, URLS, LIMITE_CONSULTAS_CHAVE, MAX_CHAVES_CIENCIA, HORA,
  chaveValida, cnpjValido, codigoUF, partesChave, horaBR, dhEventoBR, lerConfig, lerCertificado,
  montarDistDFe, envelopeDist, envelopeEvento, montarInfCiencia, canonicoInf, signedInfo, assinarEvento, montarEnvEvento,
  descompactarDocZip, interpretarRetDist, interpretarRetEvento, lerDocumento, xmlNFeValido, aplicarDocumento
};
