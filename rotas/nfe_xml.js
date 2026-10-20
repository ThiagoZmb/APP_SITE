// ==========================================================================
// Leitura do XML da NF-e para a entrada de estoque (função pura, sem banco).
// XML com DOCTYPE é recusado (NF-e não tem DOCTYPE): nenhuma entidade declarada é expandida.
// Os escapes padrão (&amp; &quot; &#231; …) são decodificados normalmente.
// ==========================================================================
const { XMLParser, XMLValidator } = require('fast-xml-parser');

class ErroNFe extends Error {
  constructor() { super('Este arquivo não é o XML de uma NF-e.'); this.name = 'ErroNFe'; }
}

const parser = new XMLParser({
  ignoreAttributes: false, attributeNamePrefix: '@', processEntities: false, parseTagValue: false,
  removeNSPrefix: true, isArray: nome => nome === 'det'
});
// os 5 escapes do XML e as referências numéricas, numa passada só (não decodifica duas vezes)
const ESCAPES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decodificar = t => t.replace(/&(amp|lt|gt|quot|apos|#(\d{1,7})|#x([0-9a-fA-F]{1,6}));/g, (todo, nome, dec, hex) => {
  if (ESCAPES[nome]) return ESCAPES[nome];
  const cp = dec ? Number(dec) : parseInt(hex, 16);
  return cp > 0 && cp <= 0x10FFFF ? String.fromCodePoint(cp) : todo;
});
const texto = v => decodificar(v == null || typeof v === 'object' ? '' : String(v)).trim();
const numero = v => { const n = Number(texto(v)); return Number.isFinite(n) ? n : 0; };

function lerNFe(xml) {
  const conteudo = String(xml || '');
  if (!conteudo.trim() || /<!DOCTYPE/i.test(conteudo) || XMLValidator.validate(conteudo) !== true) throw new ErroNFe();
  let raiz;
  try { raiz = parser.parse(conteudo); } catch { throw new ErroNFe(); } // inclui as recusas de segurança da própria biblioteca
  const inf = (raiz.nfeProc?.NFe || raiz.NFe)?.infNFe;
  if (!inf || typeof inf !== 'object') throw new ErroNFe();
  const ide = inf.ide || {}, emit = inf.emit || {};
  return {
    numero: texto(ide.nNF),
    data: texto(ide.dhEmi || ide.dEmi).slice(0, 10),
    emitente: { cnpj: texto(emit.CNPJ).replace(/\D/g, ''), nome: texto(emit.xNome) },
    itens: (inf.det || []).map(d => {
      const p = d.prod || {};
      return {
        item: numero(d['@nItem']), codFabricante: texto(p.cProd), nomeFabricante: texto(p.xProd),
        qtdNota: numero(p.qCom), unidadeNota: texto(p.uCom),
        unitarioNota: numero(p.vUnCom), totalNota: numero(p.vProd), observacao: texto(d.infAdProd)
      };
    }),
    totalNota: numero(inf.total?.ICMSTot?.vNF)
  };
}

module.exports = { lerNFe, ErroNFe };
