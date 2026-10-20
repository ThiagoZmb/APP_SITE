const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { lerNFe, ErroNFe } = require('../rotas/nfe_xml');

const arquivo = nome => fs.readFileSync(path.join(__dirname, 'apoio', 'nfe', nome), 'utf8');

test('nfeProc com um item: cabeçalho, CNPJ só dígitos e qCom "10.0000" = 10', () => {
  const n = lerNFe(arquivo('um_item.xml'));
  assert.equal(n.numero, '1234');
  assert.equal(n.data, '2026-10-15');
  assert.deepEqual(n.emitente, { cnpj: '12345678000190', nome: 'FORNECEDOR TESTE LTDA' });
  assert.equal(n.itens.length, 1);
  assert.deepEqual(n.itens[0], { item: 1, codFabricante: 'PS-01', nomeFabricante: 'PERFIL SLIM 6M', qtdNota: 10, unidadeNota: 'BR',
    unitarioNota: 12.5, totalNota: 125, observacao: '' });
  assert.ok(Number.isInteger(n.itens[0].qtdNota));
  assert.equal(n.totalNota, 125);
});

test('NFe sem envelope com vários itens e dEmi', () => {
  const n = lerNFe(arquivo('varios_itens.xml'));
  assert.equal(n.numero, '987');
  assert.equal(n.data, '2026-10-14');
  assert.deepEqual(n.itens.map(i => i.item), [1, 2, 3]);
  assert.equal(n.itens[0].observacao, 'COR PRETA');
  assert.equal(n.itens[2].qtdNota, 1.5);
  assert.equal(n.totalNota, 61);
});

test('arquivo que não é NF-e', () => {
  assert.throws(() => lerNFe(arquivo('nao_nfe.xml')), e => e instanceof ErroNFe && e.message === 'Este arquivo não é o XML de uma NF-e.');
  assert.throws(() => lerNFe('não é xml'), ErroNFe);
  assert.throws(() => lerNFe(''), ErroNFe);
});

test('XML com DOCTYPE é recusado (NF-e real não tem; evita entidades maliciosas)', () => {
  assert.throws(() => lerNFe(arquivo('com_entidade.xml')), ErroNFe);
});

test('escapes padrão do XML são decodificados', () => {
  const n = lerNFe(arquivo('com_escapes.xml'));
  assert.equal(n.emitente.nome, 'A & B LTDA');
  assert.equal(n.itens[0].codFabricante, 'P&1');
  assert.equal(n.itens[0].nomeFabricante, 'PARAFUSO 1/4" AçO é'); // &#231; = ç
});

test('tag hostil vira ErroNFe, não erro interno', () => {
  assert.throws(() => lerNFe('<NFe><infNFe><__proto__><x>1</x></__proto__></infNFe></NFe>'), ErroNFe);
});
