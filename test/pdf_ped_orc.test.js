process.env.JWT_SECRET = 'teste';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { subir } = require('./apoio/servidor');
const { criarPoolFalso } = require('./apoio/poolFalso');
const pdf = require('../pdf/ped_orc');
const { descricaoItem, blocosDeFuros, colunasPdf, textoVB, moedaBR, numeroBR, formatarQuantidade, dataVB, dataHoraVB } = pdf;

const textos = linhas => linhas.map(l => l.texto);

// ---------------- descrição do item (bloco 11 do VB) ----------------

test('porta de correr: Folha 1 traz perfil/revestimento; as demais só a medida; puxador só com PUXADOR e QTD preenchidos', () => {
  const v4 = [
    { PORTA: 'Folha 1', ALTURA: 2286, LARGURA: 635, PERFIL: 'Sottile', ACABAMENTO_PERFIL: 'Pintura', COR_PERFIL: 'Preto',
      REVESTIMENTO: 'Vidro', COR_REVESTIMENTO: 'Bronze', PUXADOR: null, QTD_PUXADOR: 0 },
    { PORTA: 'Folha 2', ALTURA: 2286, LARGURA: 635, PUXADOR: 'Alça', QTD_PUXADOR: 1, COR_PUXADOR: 'Preto', POSICAO_PUXADOR: 'Centro', TAM_PUXADOR: 300 }
  ];
  const d = descricaoItem('Porta de correr', { v4 });
  assert.deepEqual(textos(d), [
    'Tipo de produto: Porta de correr',
    ' ', 'Perfil: Sottile Pintura | Cor: Preto', 'Revestimento: Vidro(Bronze)', ' ', 'Folha 1: H = 2286 x L = 635 mm',
    ' ', 'Folha 2: H = 2286 x L = 635 mm', 'Puxador: 1 - Alça Preto', 'Posição: Centro', 'Tamanho: 300 mm', ' '
  ]);
  assert.equal(d[0].estilo, 'sublinhado');
  assert.equal(d.find(l => l.texto.startsWith('Folha 1')).estilo, 'sublinhado');
  assert.equal(d.find(l => l.texto.startsWith('Perfil')).estilo, 'negrito');
  assert.equal(d.find(l => l.texto.startsWith('Puxador')).estilo, 'normal');
});

test('porta de giro: furação por folha (FURO=1 abre o bloco), lado por extenso e revestimento com espaço antes da cor', () => {
  const folha = { ALTURA: 2100, LARGURA: 450, PERFIL: '1036', ACABAMENTO_PERFIL: 'Anodizado', COR_PERFIL: '', REVESTIMENTO: 'Vidro', COR_REVESTIMENTO: 'Bronze',
    PUXADOR: 'Ponto', ACABAMENTO_PUXADOR: 'Anodizado', QTD_PUXADOR: 1, POSICAO_PUXADOR: 'Lateral', TAM_PUXADOR: 300 };
  const furos = [{ FURO: 1, LADO: 'Direito' }, { FURO: 2 }, { FURO: null }, { FURO: 3 }, { FURO: 1, LADO: 'Superior' }];
  const d = descricaoItem('Porta de giro', { v4: [folha, { ...folha, PUXADOR: '' }], furos });
  assert.deepEqual(textos(d), [
    'Tipo de produto: Porta de giro',
    ' ', 'Perfil: 1036 Anodizado', 'Revestimento: Vidro (Bronze)', 'Puxador: 1 - Ponto Anodizado', 'Posição: Lateral   |   Tamanho: 300 mm',
    ' ', 'Tamanho: 2100 x 450', 'Porta direita: 3 furos', ' ',
    ' ', 'Perfil: 1036 Anodizado', 'Revestimento: Vidro (Bronze)', ' ', 'Tamanho: 2100 x 450', 'Porta superior: 1 furos', ' '
  ]);
  assert.equal(d.find(l => l.texto.startsWith('Revestimento')).estilo, 'normal');
});

test('blocosDeFuros: ignora FURO nulo e furos antes do primeiro FURO=1; lado vazio vira "esquerda" na descrição', () => {
  assert.deepEqual(blocosDeFuros([{ FURO: 2 }, { FURO: '1', LADO: ' E ' }, { FURO: '2' }, { FURO: null }]), [{ lado: 'E', qtd: 2 }]);
  const d = descricaoItem('Frente de gaveta', { v4: [{ ALTURA: 1, LARGURA: 2 }], furos: [{ FURO: 1, LADO: '' }] });
  assert.ok(textos(d).includes('Porta esquerda: 1 furos'));
});

test('venda avulsa: Perfil, Puxador, Trilhos, Revestimento e Serviço no texto do VB; Acessório só o tipo', () => {
  const v = { PERFIL: 'P1', ACABAMENTO_PERFIL: 'Anod', COR_PERFIL: 'Preto', ALTURA: 3000, LARGURA: 500, REVESTIMENTO: 'MDF', COR_REVESTIMENTO: '' };
  assert.deepEqual(textos(descricaoItem('Perfil', { v4: [v] })), ['Tipo de produto: Perfil', ' ', 'Perfil: P1 Anod - COR: Preto', 'Tamanho: 3000 mm', ' ']);
  assert.equal(textos(descricaoItem('Puxador', { v4: [v] }))[2], 'Puxador: P1 Anod - COR: Preto');
  assert.equal(textos(descricaoItem('Trilhos', { v4: [v] }))[2], 'Trilho: P1 Anod - COR: Preto');
  assert.deepEqual(textos(descricaoItem('Revestimento', { v4: [v] })).slice(2, 4), ['Revestimento: MDF', 'Tamanho: 3000 x 500 mm']);
  assert.equal(textos(descricaoItem('Revestimento', { v4: [{ ...v, COR_REVESTIMENTO: 'Branco' }] }))[2], 'Revestimento: MDF - COR: Branco');
  assert.deepEqual(textos(descricaoItem('Serviço', { v4: [v] })), ['Tipo de produto: Serviço', ' ', 'Serviço: P1', ' ']);
  assert.deepEqual(textos(descricaoItem('Acessório', { v4: [v] })), ['Tipo de produto: Acessório']);
});

test('complementos entram em qualquer item; serralheria só em "Metalons", com quantidade formatada', () => {
  const comp = [{ QTD: 2, COMPLEMENTO: 'KIT AL86' }];
  assert.deepEqual(textos(descricaoItem('Porta de correr', { complementos: comp })), ['Complementos: ', '2 - KIT AL86']);
  const serralheria = [{ PRODUTO: 'Mesa', MATERIAL: 'Metalon', ACABAMENTO: 'Pintura', COR: 'Preto', ALTURA: 750, LARGURA: 1200, PROFUNDIDADE: 600 }];
  const compSerralheria = [{ QUANTIDADE: '2.00', DESCRICAO: 'Sapata' }, { QUANTIDADE: '2.26', DESCRICAO: 'Tampo' }];
  const d = descricaoItem('Metalons', { serralheria, compSerralheria });
  assert.deepEqual(textos(d), ['Produto: Mesa', 'Material: Metalon', 'Acabamento: Pintura', 'Cor: Preto', 'Tamanho: H=750 x L=1200 x P=600', ' ',
    ' ', 'Complementos: ', '2 - Sapata', ' ', 'Complementos: ', '2,26 - Tampo']);
  assert.equal(d[0].estilo, 'sublinhado');
  assert.deepEqual(descricaoItem('Perfil', { serralheria, compSerralheria }), []);
});

// ---------------- formatos (cultura pt-BR do VB) ----------------

test('formatos: moeda C2, N2, quantidade, datas e decimais do banco', () => {
  assert.equal(moedaBR('17143.23'), 'R$ 17.143,23');
  assert.equal(moedaBR(-1), '-R$ 1,00');
  assert.equal(moedaBR(null), 'R$ 0,00');
  assert.equal(numeroBR('0.00'), '0,00');
  assert.equal(numeroBR('1234.5'), '1.234,50');
  assert.equal(formatarQuantidade('2.00'), '2');
  assert.equal(formatarQuantidade('2,26'), '2,26');
  assert.equal(dataVB('2026-10-05'), '05/10/2026');
  assert.equal(dataVB('5/1/2026'), '05/01/2026');
  assert.equal(dataHoraVB('2026-10-05'), '05/10/2026 00:00:00');
  assert.equal(dataHoraVB('2026-10-05 14:30:00'), '05/10/2026 14:30:00');
  assert.equal(dataHoraVB('05/10/2026'), '05/10/2026');
  assert.equal(textoVB('2286.00'), '2286,00');
  assert.equal(textoVB(2286), '2286');
  assert.equal(textoVB(null), '');
  assert.equal(textoVB('Perfil 1.5 mm'), 'Perfil 1.5 mm');
});

test('colunasPdf: pesos do VB (2,2,7,21,11,5,5); sem valores = 5 colunas da Guia de Produção', () => {
  assert.deepEqual(colunasPdf(true).map(c => c.label), ['Item', 'Qtd', 'Imagem', 'Descrição', 'Observação', 'Unitário', 'Total']);
  assert.deepEqual(colunasPdf(false).map(c => c.label), ['Item', 'Qtd', 'Imagem', 'Descrição', 'Observação']);
  assert.ok(Math.abs(colunasPdf(true, 530).reduce((s, c) => s + c.w, 0) - 530) < 1e-9);
  assert.ok(Math.abs(colunasPdf(true, 53)[3].w - 21) < 1e-9);
});

// ---------------- desenho ----------------

const dadosExemplo = (tipo = 'Orçamento', nItens = 1) => ({
  tipo, numero: '21280',
  cab: { RAZAO_SOCIAL: 'CLI', CLIENTE_FINAL: 'Final', DATA: '2026-10-05', DATA_PRONTO: '2026-10-05', OBS_GERAL: 'Obs geral',
    SUB_TOTAL: '17143.23', TOTAL: '17143.23', DESCONTO: '0.00' },
  itens: Array.from({ length: nItens }, (_, i) => ({ ITEM: i + 1, QTD: 1, TIPO_PRODUTO: 'Porta de correr', OBSERVACAO: '', UNITARIO: '17143.23', TOTAL: '17143.23' })),
  v4: Array.from({ length: nItens }, (_, i) => ({ ITEM_PEDIDO: i + 1, ITEM: 1, PORTA: 'Folha 1', ALTURA: 2286, LARGURA: 635, PERFIL: 'Sottile' })),
  complementos: [], serralheria: [], compSerralheria: [], furos: []
});

function desenhar(dados, opcoes) {
  const doc = pdf.novoDocumento({ bufferPages: true });
  doc.on('data', () => {});
  const t = pdf.desenharPedOrc(doc, dados, opcoes);
  const paginas = doc.bufferedPageRange().count;
  doc.end();
  return { t, paginas };
}

test('orçamento com valores: cabeçalho, validade, datas no formato do VB e totais', () => {
  const { t } = desenhar(dadosExemplo(), { verValores: true });
  // "Orçamento n°:21280" quebra em duas linhas na caixa estreita, como no VB
  for (const s of ['Orçamento', 'n°:21280', 'Cliente: CLI', 'Data do orçamento: 05/10/2026', 'Cliente Final: Final', 'Pronto em: 05/10/2026 00:00:00',
    'Este orçamento têm validade de 10DD á partir da data discriminada acima', 'Unitário', 'R$ 17.143,23', 'Observação:', 'Obs geral',
    'Subtotal: R$ 17.143,23', 'Desconto: 0,00 %', 'Total: R$ 17.143,23']) assert.ok(t.includes(s), `faltou "${s}"`);
});

test('pedido: sem a linha de validade e com "Data do pedido"', () => {
  const { t } = desenhar(dadosExemplo('Pedido'), { verValores: true });
  assert.ok(t.includes('Pedido'));
  assert.ok(t.some(s => s.startsWith('Data do pedido: ')));
  assert.ok(!t.some(s => /validade/.test(s)));
});

test('sem valores.ver: nenhum dinheiro no PDF (sem Unitário, Total, Subtotal, Desconto)', () => {
  const { t } = desenhar(dadosExemplo('Pedido'), { verValores: false });
  assert.ok(!t.some(s => /R\$|Unitário|Subtotal|Desconto|^Total/.test(s)), JSON.stringify(t));
  assert.ok(t.includes('Descrição'));
});

test('guia de produção: título, medição, sem preços nem validade', () => {
  const { t } = desenhar({ ...dadosExemplo('Pedido'), medicao: 'Vão' }, { verValores: true, producao: true });
  assert.ok(t.includes('Guia de Produção'));
  assert.ok(t.includes('Medição: Vão'));
  assert.ok(!t.some(s => /R\$|Subtotal|validade/.test(s)));
});

test('muitos itens: quebra de página repetindo o cabeçalho da tabela; item enorme é cortado sem travar', () => {
  const { t, paginas } = desenhar(dadosExemplo('Pedido', 40), { verValores: true });
  assert.ok(paginas > 1);
  assert.equal(t.filter(s => s === 'Descrição').length, paginas);
  const grande = dadosExemplo('Pedido', 1);
  grande.complementos = Array.from({ length: 200 }, (_, i) => ({ ITEM_PEDIDO: 1, QTD: 1, COMPLEMENTO: 'Peça ' + i }));
  const r = desenhar(grande, { verValores: true });
  assert.ok(r.paginas >= 3);
  assert.ok(r.t.includes('1 - Peça 199'));
});

// ---------------- rota ----------------

const { app, pool, acesso } = require('../index.js');
const USUARIOS = {
  1: { nome: 'Ana', permissoes: new Set(['pedidos.pdf', 'valores.ver']) },
  2: { nome: 'Bia', permissoes: new Set(['pedidos.pdf']) }
};
const token = id => jwt.sign({ id, nome: USUARIOS[id].nome, v: 2 }, 'teste', { issuer: 'elegance-api', expiresIn: '1h' });

async function preparar(t) {
  const d = dadosExemplo('Pedido', 2);
  const f = criarPoolFalso([
    [/FROM ped_orc WHERE NUMERO/, [d.cab]],
    [/FROM ped_orc_lista_itens/, d.itens],
    [/FROM ped_orc_itens_v4/, d.v4],
    [/SELECT MEDICAO FROM cadastro_clientes/, [{ MEDICAO: 'Vão' }]]
  ]);
  pool.execute = f.execute; pool.getConnection = f.getConnection;
  t.mock.method(acesso, 'carregar', async id => ({ codigo: id, nome: USUARIOS[id].nome, cargo: '', empresa: 'ELEGANCE',
    perfil: { id, nome: 'X' }, estados: [], ativo: true, permissoes: USUARIOS[id].permissoes }));
  const s = await subir(app);
  t.after(s.fechar);
  const chamar = (id, caminho) => fetch(s.url + caminho, { headers: { Authorization: 'Bearer ' + token(id) } });
  return { f, chamar };
}

test('GET /dados_pdf devolve PDF (com e sem valores.ver) e só lê o banco', async t => {
  const { f, chamar } = await preparar(t);
  for (const id of [1, 2]) {
    const r = await chamar(id, '/dados_pdf?numero=23425&tipo=Pedido');
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'application/pdf');
    const b = Buffer.from(await r.arrayBuffer());
    assert.equal(b.subarray(0, 4).toString(), '%PDF');
  }
  assert.ok(f.chamadas.every(c => /^\s*SELECT/i.test(c.sql)), 'PDF não pode gravar nada');
  assert.ok(!f.chamadas.some(c => /MEDICAO/.test(c.sql)));
});

test('GET /dados_pdf?producao=1: Guia de Produção só para Pedido (lê MEDICAO, arquivo _P)', async t => {
  const { f, chamar } = await preparar(t);
  const r = await chamar(1, '/dados_pdf?numero=23425&tipo=Pedido&producao=1');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-disposition'), /_P\.pdf"$/);
  assert.ok(f.chamadas.some(c => /SELECT MEDICAO/.test(c.sql)));
  const n = f.chamadas.length;
  const o = await chamar(1, '/dados_pdf?numero=21280&tipo=' + encodeURIComponent('Orçamento') + '&producao=1');
  await o.arrayBuffer();
  assert.ok(!f.chamadas.slice(n).some(c => /MEDICAO/.test(c.sql)));
  assert.doesNotMatch(o.headers.get('content-disposition') || '', /_P\.pdf/);
});
