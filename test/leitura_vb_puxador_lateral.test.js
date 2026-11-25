// Formato antigo do VB em TIPO_PUXADOR: "LATERAL Esquerda Total" / "LATERAL DIREITA Total" (Orçamento 21186, itens 10 e 11).
// O lado mora em POSICAO_PUXADOR; o tipo certo é o do cadastro do puxador + " Total".
const test = require('node:test');
const assert = require('node:assert/strict');
const { traduzirDocumento } = require('../calculo/leitura_vb');

const cab = { id: 1, TIPO: 'Orçamento', NUMERO: 21186, RAZAO_SOCIAL: 'CLIENTE TESTE', DATA: '2026-09-16 16:17:08' };
const folha = (k, mudar = {}) => ({ ID: k, TIPO: 'Orçamento', NUMERO: 21186, TIPO_PRODUTO: 'Porta de correr', ITEM_PEDIDO: 1, ITEM: k, PORTA: `Folha ${k}`,
  QTD: 1, ALTURA_VAO: 0, LARGURA_VAO: 0, ALTURA: 2290, LARGURA: 1000, PERFIL: '3345', ACABAMENTO_PERFIL: 'Anodizado Bronze', COR_PERFIL: null,
  REVESTIMENTO: 'Vidro V', COR_REVESTIMENTO: null, PUXADOR: '2010/20', ACABAMENTO_PUXADOR: 'Anodizado Bronze', COR_PUXADOR: null, TAM_PUXADOR: 2290,
  TIPO_PUXADOR: k === 1 ? 'LATERAL Esquerda Total' : 'LATERAL DIREITA Total', QTD_PUXADOR: 1,
  POSICAO_PUXADOR: k === 1 ? 'LATERAL ESQUERDA TOTAL' : 'LATERAL DIREITA TOTAL',
  DIVISOR: null, QTD_HORIZONTAL: 0, QTD_VERTICAL: 0, OBS: null, ...mudar });
const doc = (um = {}, dois = {}, tipoProduto = 'Porta de correr') => ({ cab,
  lista: [{ id: 1, ITEM: 1, TIPO_PRODUTO: tipoProduto, QTD: 1, UNITARIO: '4531.18', TOTAL: '4531.18', PORCENTAGEM: '', OBSERVACAO: null,
    DESCRICAO: 'Tam: 2290x1000mm | Sist: Sem sistema | Portas: 2' }],
  itensV4: [folha(1, { TIPO_PRODUTO: tipoProduto, ...um }), folha(2, { TIPO_PRODUTO: tipoProduto, ...dois })],
  complementos: [], furacao: [], serralheria: [], serralheriaComp: [], vidros: [], perfis: [] });
const abrir = (linhas, cadastro = 'Sobreposto') => traduzirDocumento(linhas, { puxadores: cadastro === null ? {} : { '2010/20': cadastro } }).itens[0];
const travado = (linhas, cadastro) => assert.equal(abrir(linhas, cadastro).travado, true, 'devia travar');

test('folhas com "LATERAL <lado> Total" abrem como o tipo do cadastro + Total, com o lado de cada folha', () => {
  const it = abrir(doc());
  assert.equal(it.travado, undefined, `${it.motivo} ${it.detalheTecnico || ''}`);
  assert.equal(it.detalhes.tipoPuxador, 'Sobreposto Total');
  assert.deepEqual(it.detalhes.posicoesFolhas, ['LATERAL ESQUERDA TOTAL', 'LATERAL DIREITA TOTAL']);
  assert.equal(it.detalhes.todaExt, true);
  assert.equal(it.origem.estado, 'intacto');
});

test('não altera as linhas lidas do banco (a cópia do item intacto grava o que estava)', () => {
  const linhas = doc();
  abrir(linhas);
  assert.deepEqual(linhas.itensV4.map(c => c.TIPO_PUXADOR), ['LATERAL Esquerda Total', 'LATERAL DIREITA Total']);
});

test('dois puxadores por folha e mistura com o formato atual', () => {
  const dupla = { POSICAO_PUXADOR: 'LATERAL ESQUERDA TOTAL, LATERAL DIREITA TOTAL', QTD_PUXADOR: 2 };
  const it = abrir(doc({ ...dupla, TIPO_PUXADOR: 'lateral esquerda total' }, { ...dupla, TIPO_PUXADOR: 'Sobreposto Total' }));
  assert.equal(it.travado, undefined, `${it.motivo} ${it.detalheTecnico || ''}`);
  assert.equal(it.qtd, 2);
  assert.equal(it.detalhes.tipoPuxador, 'Sobreposto Total');
});

test('cadastro "Total": correr vira "Sobreposto Total" e giro vira "Total", como a tela grava (tipoPuxadorDaPorta)', () => {
  assert.equal(abrir(doc(), 'Total').detalhes.tipoPuxador, 'Sobreposto Total');
  assert.equal(abrir(doc({}, {}, 'Porta de giro'), 'Total').detalhes.tipoPuxador, 'Total');
});

test('continua travando: tipo realmente diferente entre as folhas', () => {
  travado(doc({}, { TIPO_PUXADOR: 'Sobreposto' }));
  travado(doc({}, { TIPO_PUXADOR: 'Embutido' }));
  travado(doc({}, { TIPO_PUXADOR: 'Total' }));
});

test('continua travando: posição que não é lateral total (o lado/total só estaria no tipo)', () => {
  travado(doc({}, { POSICAO_PUXADOR: 'LATERAL DIREITA CENTRO' }));
  travado(doc({}, { POSICAO_PUXADOR: '', QTD_PUXADOR: 0 }));
});

test('continua travando: sem tipo no cadastro, embutido no cadastro ou folha sem nome de puxador', () => {
  travado(doc(), null);
  travado(doc(), '');
  travado(doc(), 'Embutido');
  travado(doc({ PUXADOR: '', TIPO_PUXADOR: 'Sobreposto' }, { PUXADOR: '' }));
});

test('continua travando: outra diferença real entre as folhas', () => {
  travado(doc({}, { ALTURA: 2200 }));
  travado(doc({}, { TAM_PUXADOR: 150 }));
});
