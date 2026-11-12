// "CHECKLIST EXTERNO – ENTREGAS" (2026-11-12): funções puras (calculo/entrega_checklist.js), PDF de uma página
// (pdf/entrega_checklist.js), rotas (rotas/entrega_checklist.js, banco simulado), migração da permissão, telas
// (entrega_checklist.js, entregas.html/.js, minhas_entregas) e o painel de detalhe redesenhado.
process.env.JWT_SECRET = 'teste';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { prepararEntregas, bancoEntregas, PERFIS } = require('./apoio/bancoEntregas');
const { criarPoolFalso } = require('./apoio/poolFalso');
const { registro } = require('../index.js');
const K = require('../calculo/entrega_checklist');
const { desenharChecklistEntrega, novoDocumento, DECLARACAO } = require('../pdf/entrega_checklist');
const { acrescentarPermissoesChecklistEntregas } = require('../seguranca/instalacao');
const { CATALOGO, PERFIS_INICIAIS } = require('../seguranca/permissoes');
const { REGEX_VALOR } = require('../seguranca/valores');
const TELA = require('../entrega_checklist.js');
const E = require('../entregas.js');

const ler = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const paginas = buf => (buf.toString('latin1').match(/\/Type \/Page\b(?!s)/g) || []).length;
const nomesDeCampos = v => (Array.isArray(v) ? v.flatMap(nomesDeCampos) : v && typeof v === 'object' ? Object.entries(v).flatMap(([k, x]) => [k, ...nomesDeCampos(x)]) : []);

PERFIS['Checklist completo'] = ['entregas.ver', 'entregas.programar', 'entregas.checklist'];
PERFIS['Checklist só imprimir'] = ['entregas.ver', 'entregas.checklist'];

// gera o PDF em memória; devolve { buf, textos }
function gerarPdf(dados, opcoes = {}) {
  return new Promise((ok, falha) => {
    const doc = novoDocumento();
    const partes = [];
    doc.on('data', c => partes.push(c));
    doc.on('end', () => ok({ buf: Buffer.concat(partes), textos }));
    doc.on('error', falha);
    const textos = desenharChecklistEntrega(doc, dados, opcoes);
    doc.end();
  });
}

// ---------- funções puras ----------
test('diaDaSemana e dataBR: dia por extenso em maiúsculas; data inválida ou vazia = vazio', () => {
  assert.equal(K.diaDaSemana('2026-01-01'), 'QUINTA FEIRA');
  assert.equal(K.diaDaSemana('2026-11-15'), 'DOMINGO');
  assert.equal(K.diaDaSemana('2026-11-17 08:00:00'), 'TERÇA FEIRA');
  assert.equal(K.diaDaSemana('2026-11-14'), 'SÁBADO');
  assert.equal(K.diaDaSemana('2026-02-30'), '');
  assert.equal(K.diaDaSemana(''), '');
  assert.equal(K.diaDaSemana(null), '');
  assert.equal(K.dataBR('2026-11-12'), '12/11/2026');
  assert.equal(K.dataBR('lixo'), '');
});

test('montarAutomatico: dados da entrega, "Entrega n de N", quantidade esperada e endereço do cliente só quando a entrega não tem', () => {
  const a = K.montarAutomatico({
    entrega: { numero: 23390, data_agendada: '2026-11-12', endereco_rua: 'Rua A', endereco_numero: '12', endereco_bairro: 'Centro', endereco_cidade: 'Vitória',
      endereco_uf: 'ES', endereco_cep: '29000-000', endereco_ref: 'portão azul', contato_local: 'João (27) 99999-8888', observacao: 'Ligar antes' },
    cliente: 'CLIENTE LTDA', clienteFinal: 'Maria', motoristaNome: 'Carlos', ordem: { ordemEntrega: 1, qtdEntregasPedido: 2 },
    enderecoCliente: { rua: 'NÃO USAR' },
    itens: [{ item: 1, descricao: 'Porta', qtd: 2 }, { item: 3, descricao: 'Janela', qtd: '1.5' }]
  });
  assert.equal(a.dataEntrega, '2026-11-12');
  assert.equal(a.pedido, '23390');
  assert.equal(a.entregaRotulo, 'Entrega 1 de 2');
  assert.equal(a.endereco, 'Rua A, 12 - Centro - Vitória/ES - CEP 29000-000 - Ref.: portão azul');
  assert.equal(a.enderecoOrigem, 'entrega');
  assert.equal(a.contato, 'João (27) 99999-8888');
  assert.equal(a.observacoes, 'Ligar antes');
  assert.equal(a.motorista, 'Carlos');
  assert.equal(a.qtdItensEsperada, 3.5);
  assert.deepEqual(a.itens.map(i => i.item), [1, 3]);
  // sem endereço na entrega: NUNCA o do cadastro do cliente (decisão do dono, 2026-11-12); a folha não pode ser gerada
  const b = K.montarAutomatico({ entrega: { numero: 5 }, enderecoCliente: { rua: 'Rua do Cliente', numero: '7', cidade: 'Serra', uf: 'ES' }, ordem: { ordemEntrega: 1, qtdEntregasPedido: 1 } });
  assert.equal(b.endereco, '');
  assert.equal(b.enderecoOrigem, '');
  assert.equal(K.podeGerar(b), false);
  assert.equal(K.podeGerar(a), true);
  assert.equal(K.podeGerar(K.mesclar(b, { ...K.validarEdicao({ endereco: 'Rua digitada, 1' }).dados })), true);
  assert.equal(K.MSG_SEM_ENDERECO, 'Informe o endereço da entrega para gerar o checklist.');
  assert.doesNotMatch(ler('rotas/entrega_checklist.js'), /c\.ENDERECO|enderecoCliente/);
  assert.equal(b.entregaRotulo, '');
  assert.equal(b.dataEntrega, '');
  assert.equal(b.qtdItensEsperada, null);
  // nenhum nome de campo de dinheiro
  for (const k of nomesDeCampos(a)) assert.doesNotMatch(k, REGEX_VALOR, k);
});

test('validarEdicao: limpa, aceita vazio, recusa acima do limite (nunca corta), data inválida e tipo errado', () => {
  const ok = K.validarEdicao({ dataEntrega: '2026-11-12', pedido: 23390, cliente: '  Cliente\u0007 X  ', endereco: 'Linha 1\r\nLinha 2\n\n\n\nLinha 3', motorista: null });
  assert.equal(ok.ok, true);
  assert.equal(ok.dados.pedido, '23390');
  assert.equal(ok.dados.cliente, 'Cliente X');
  assert.equal(ok.dados.endereco, 'Linha 1\nLinha 2\n\nLinha 3');
  assert.equal(ok.dados.motorista, '');
  assert.deepEqual(Object.keys(ok.dados), K.CHAVES);
  assert.equal(K.validarEdicao({ cliente: 'x'.repeat(191) }).ok, false);
  assert.equal(K.validarEdicao({ dataEntrega: '2026-02-30' }).ok, false);
  assert.equal(K.validarEdicao({ cliente: { a: 1 } }).ok, false);
  assert.equal(K.validarEdicao(null).ok, false);
  assert.equal(K.validarEdicao([]).ok, false);
});

test('mesclar e lerSalvo: o salvo substitui só os campos editáveis; itens e "Entrega n de N" ficam automáticos; JSON ruim = automático', () => {
  const auto = K.montarAutomatico({ entrega: { numero: 9, endereco_rua: 'Rua A' }, cliente: 'C', itens: [{ item: 1, descricao: 'P', qtd: 1 }], ordem: { ordemEntrega: 2, qtdEntregasPedido: 3 } });
  const salvo = K.lerSalvo(JSON.stringify({ ...Object.fromEntries(K.CHAVES.map(k => [k, ''])), cliente: 'Outro', endereco: 'Rua B' }));
  const m = K.mesclar(auto, salvo);
  assert.equal(m.cliente, 'Outro');
  assert.equal(m.endereco, 'Rua B');
  assert.equal(m.enderecoOrigem, 'editado');
  assert.equal(m.pedido, '');            // a edição vale inteira (campo apagado fica apagado)
  assert.equal(m.entregaRotulo, 'Entrega 2 de 3');
  assert.equal(m.itens.length, 1);
  assert.equal(m.editado, true);
  assert.equal(K.mesclar(auto, null).editado, false);
  assert.equal(K.lerSalvo('{quebrado'), null);
  assert.equal(K.lerSalvo(JSON.stringify({ cliente: 'x'.repeat(500) })), null);
});

test('textoPdf: mantém acentos do português, troca o que a Helvetica não escreve, controla quebras', () => {
  assert.equal(K.textoPdf('Ação São João — “ok” €'), 'Ação São João — “ok” €');
  assert.equal(K.textoPdf('Őrség 😀 漢字'), 'Orség ? ??');
  assert.equal(K.textoPdf('a\nb\u0007c'), 'a b c');
  assert.equal(K.textoPdf('a\n\n b ', { multilinha: true }), 'a\n\nb');
  assert.equal(K.textoPdf(null), '');
});

test('quebrarLinhas e ajustarTexto: quebra por largura medida, corta palavra gigante, reduz a fonte antes de cortar com "..."', () => {
  const medir = s => s.length;
  assert.deepEqual(K.quebrarLinhas('aa bb cc dd', 5, medir), ['aa bb', 'cc dd']);
  assert.deepEqual(K.quebrarLinhas('abcdefghij', 4, medir), ['abcd', 'efgh', 'ij']);
  assert.deepEqual(K.quebrarLinhas('a\nb', 10, medir), ['a', 'b']);
  assert.deepEqual(K.quebrarLinhas('', 10, medir), []);
  const porTam = (s, tam) => s.length * tam; // fonte maior = texto mais largo
  const a = K.ajustarTexto('aaaa bbbb', 50, porTam, { tamanhos: [10, 5], maxLinhas: 1 }); // 10 -> 2 linhas; 5 -> cabe em 1
  assert.deepEqual(a, { tamanho: 5, linhas: ['aaaa bbbb'], cortado: false });
  assert.equal(K.ajustarTexto('aa', 50, porTam, { tamanhos: [5, 10], maxLinhas: 1 }).tamanho, 10); // o maior que couber
  const b = K.ajustarTexto('aaaa bbbb cccc dddd', 40, porTam, { tamanhos: [10, 8], maxLinhas: 2 });
  assert.equal(b.cortado, true);
  assert.equal(b.linhas.length, 2);
  assert.match(b.linhas[1], /\.\.\.$/);
  assert.ok(b.linhas.every(l => porTam(l, b.tamanho) <= 40));
  const c = K.ajustarTexto('aa bb cc dd ee ff', 10, s => s.length, { tamanhos: [1], maxLinhas: tam => 5 / tam });
  assert.equal(c.linhas.length, 2); // 'aa bb cc' / 'dd ee ff' cabem em 5 linhas
});

// ---------- PDF ----------
test('PDF: cabeçalho %PDF, UMA página, textos do modelo, dia da semana e esperado ao lado da caixa de itens', async () => {
  const dados = K.mesclar(K.montarAutomatico({ entrega: { numero: 23390, data_agendada: '2026-11-12', contato_local: 'Sr. João', observacao: 'Manhã' },
    cliente: 'CLIENTE', clienteFinal: 'Maria', motoristaNome: 'Carlos', itens: [{ item: 1, descricao: 'Porta', qtd: 3 }], ordem: { ordemEntrega: 1, qtdEntregasPedido: 2 } }), null);
  const { buf, textos } = await gerarPdf(dados, { geradoEm: '12/11/2026 08:00' });
  assert.equal(buf.subarray(0, 5).toString('latin1'), '%PDF-');
  assert.equal(paginas(buf), 1);
  for (const t of ['CHECKLIST EXTERNO', 'ENTREGAS', 'DATA DE ENTREGA:', '12/11/2026', 'QUINTA FEIRA', 'PEDIDO:', '23390', 'Entrega 1 de 2', 'CLIENTE:', 'CLIENTE FINAL:',
    'ENDEREÇO:', 'OBSERVAÇÕES DE ENTREGA:', 'Qualquer dúvida entrar em contato com :', 'Sr. João', 'MOTORISTA', 'Carlos', 'CONFERIDO QUANTIDADE DE ITENS:',
    '(esperado: 3)', 'CONFERIDO QUANTIDADE DE VOLUMES:', 'ITENS DA ENTREGA', 'Item 1 · Porta × 3', 'OBSERVAÇÕES GERAIS DA ENTREGA:', 'DATA DE RECEBIMENTO:',
    'RECEBIDO POR :', 'DOCUMENTO:', 'ASSINATURA:']) assert.ok(textos.includes(t), t);
  assert.ok(textos.join(' ').includes('SEM NENHUMA VIOLAÇÃO DAS EMBALAGENS.'));
  assert.match(DECLARACAO, /^DECLARO QUE RECEBI TODOS OS ITENS RELACIONADOS ACIMA EM PERFEITAS CONDIÇÕES/);
  assert.ok(!textos.some(t => /R\$/.test(t)));
});

test('PDF: campos no limite, 60 itens e texto estranho continuam em UMA página; folha em branco e campos vazios também', async () => {
  const longo = K.montarAutomatico({ entrega: { numero: 1, data_agendada: '2026-11-15', endereco_rua: 'Avenida muito comprida '.repeat(20).slice(0, 190),
    endereco_bairro: 'B'.repeat(120), endereco_cidade: 'C'.repeat(120), endereco_ref: 'R'.repeat(190), observacao: 'Obs '.repeat(125), contato_local: 'x'.repeat(190) },
    cliente: 'C'.repeat(190), clienteFinal: '😀 漢字 '.repeat(30), motoristaNome: 'M'.repeat(120),
    itens: Array.from({ length: 60 }, (_, i) => ({ item: i + 1, descricao: 'Descrição muito longa do item '.repeat(10), qtd: 1.25 })) });
  const salvo = K.validarEdicao({ ...longo, endereco: 'E'.repeat(400), observacoes: 'linha\n'.repeat(80).slice(0, 500) }).dados;
  for (const dados of [longo, K.mesclar(longo, salvo), K.folhaEmBranco(), K.montarAutomatico({}), {}]) {
    const { buf, textos } = await gerarPdf(dados);
    assert.equal(buf.subarray(0, 5).toString('latin1'), '%PDF-');
    assert.equal(paginas(buf), 1, JSON.stringify(Object.keys(dados)));
    assert.ok(textos.includes('ASSINATURA:'));
  }
  const { textos } = await gerarPdf(longo);
  assert.ok(textos.some(t => /^\.\.\. e mais \d+ itens \(ver o pedido\)$/.test(t)), 'lista de itens resumida');
  const branco = (await gerarPdf(K.folhaEmBranco())).textos;
  assert.ok(!branco.some(t => /esperado|ITENS DA ENTREGA|FEIRA|DOMINGO|SÁBADO/.test(t)));
  // sem logo (arquivo ausente) a folha sai igual
  assert.equal(paginas((await gerarPdf(K.folhaEmBranco(), { logo: path.join(__dirname, 'nao_existe.png') })).buf), 1);
});

// ---------- rotas (banco simulado) ----------
function bancoComChecklist() {
  const banco = bancoEntregas();
  const salvos = new Map();
  const { entregas, pedidos, clientes, usuarios } = banco.estado;
  banco.salvos = salvos;
  banco.regras.unshift(
    [/AS ck_cliente/, (sql, params) => {
      const [id, ...resto] = params;
      const e = entregas.find(x => x.id === id); if (!e) return [];
      if (sql.includes('e.motorista_codigo = ?')) { const uid = resto.shift(); if (e.motorista_codigo !== uid || e.tipo !== 'motorista') return []; }
      const ped = pedidos.find(p => p.NUMERO === e.numero && p.TIPO === 'Pedido'); const cli = clientes.find(c => c.RAZAO_SOCIAL === ped?.RAZAO_SOCIAL);
      if (sql.includes('c.ESTADO IN') && !(cli && resto.includes(cli.ESTADO))) return [];
      return [{ ...e, ck_cliente: ped?.RAZAO_SOCIAL ?? null, ck_cliente_final: ped?.CLIENTE_FINAL ?? null, ck_rua: cli?.ENDERECO ?? null, ck_numero: cli?.NUMERO ?? null,
        ck_bairro: cli?.BAIRRO ?? null, ck_cidade: cli?.CIDADE ?? null, ck_uf: cli?.ESTADO ?? null, ck_cep: cli?.CEP ?? null,
        ck_motorista: usuarios.find(u => u.CODIGO === e.motorista_codigo)?.NOME ?? null }];
    }],
    [/^SELECT dados, atualizado_por, CAST\(atualizado_em AS CHAR\) AS atualizado_em FROM web_entrega_checklist WHERE entrega_id = \?$/, (sql, [id]) => (salvos.has(id) ? [salvos.get(id)] : [])],
    [/^INSERT INTO web_entrega_checklist \(entrega_id, dados, atualizado_por, atualizado_em\) VALUES \(\?, \?, \?, \?\) ON DUPLICATE KEY UPDATE/, (sql, [id, dados, por, em]) => {
      salvos.set(id, { dados, atualizado_por: por, atualizado_em: em }); return { affectedRows: 1 };
    }],
    [/^DELETE FROM web_entrega_checklist WHERE entrega_id = \?$/, (sql, [id]) => ({ affectedRows: salvos.delete(id) ? 1 : 0 })]
  );
  banco.semear.cliente({ ESTADO: 'ES', CIDADE: 'Vitória', ENDERECO: 'Rua do Cadastro', NUMERO: '9' });
  banco.semear.pedido({ NUMERO: 100, CLIENTE_FINAL: 'Maria' });
  banco.semear.item({ NUMERO: 100, ITEM: 1, DESCRICAO: 'Porta de giro', QTD: 2 });
  banco.semear.item({ NUMERO: 100, ITEM: 2, DESCRICAO: 'Janela', QTD: 1 });
  banco.semear.entrega({ numero: 100, status: 'agendada', tipo: 'motorista', motorista_codigo: 21, data_agendada: '2026-11-12', contato_local: 'João 27 99999-8888',
    endereco_rua: 'Rua da Obra', endereco_numero: '50', endereco_cidade: 'Serra', endereco_uf: 'ES', observacao: 'Chegar cedo' });
  return banco;
}

test('rotas: GET dos campos (automático), PUT salva com quem/quando e auditoria, PDF usa o salvo, DELETE volta ao automático', async t => {
  const banco = bancoComChecklist();
  const { chamar } = await prepararEntregas(t, { perfil: 'Checklist completo', banco });
  let r = await chamar('/entregas/1/checklist');
  assert.equal(r.status, 200);
  let d = await r.json();
  assert.equal(d.automatico.pedido, '100');
  assert.equal(d.automatico.cliente, 'CLIENTE TESTE LTDA');
  assert.equal(d.automatico.clienteFinal, 'Maria');
  assert.equal(d.automatico.motorista, 'Motorista Um');
  assert.equal(d.automatico.endereco, 'Rua da Obra, 50 - Serra/ES');
  assert.equal(d.automatico.dataEntrega, '2026-11-12');
  assert.equal(d.qtdItensEsperada, 3);
  assert.equal(d.itens.length, 2);
  assert.equal(d.salvo, null);
  for (const k of nomesDeCampos(d)) assert.doesNotMatch(k, REGEX_VALOR, k);

  r = await chamar('/entregas/1/checklist', 'PUT', { ...d.automatico, cliente: 'Cliente Editado', motorista: 'Levar escada' });
  assert.equal(r.status, 200);
  const put = await r.json();
  assert.equal(put.salvo.cliente, 'Cliente Editado');
  assert.equal(put.salvoPor, 'Caio');
  assert.equal(JSON.parse(banco.salvos.get(1).dados).motorista, 'Levar escada');
  assert.ok(banco.auditoria.some(a => a.acao === 'entrega_checklist_editado' && a.alvo === '100'));

  d = await (await chamar('/entregas/1/checklist')).json();
  assert.equal(d.salvo.cliente, 'Cliente Editado');
  assert.equal(d.salvoPor, 'Caio');

  r = await chamar('/entregas/1/checklist.pdf');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'application/pdf');
  assert.match(r.headers.get('content-disposition'), /checklist_entrega_100\.pdf/);
  assert.match(r.headers.get('cache-control'), /no-store/);
  const buf = Buffer.from(await r.arrayBuffer());
  assert.equal(buf.subarray(0, 5).toString('latin1'), '%PDF-');
  assert.equal(paginas(buf), 1);

  r = await chamar('/entregas/1/checklist', 'DELETE');
  assert.deepEqual(await r.json(), { ok: true, removido: true });
  assert.equal(banco.salvos.size, 0);
  assert.ok(banco.auditoria.some(a => a.acao === 'entrega_checklist_automatico'));
  assert.equal((await (await chamar('/entregas/1/checklist')).json()).salvo, null);

  r = await chamar('/entregas/checklist/branco.pdf');
  assert.equal(r.status, 200);
  assert.equal(paginas(Buffer.from(await r.arrayBuffer())), 1);
});

test('rotas: validação (400), entrega inexistente ou fora da região (404) e permissões (403)', async t => {
  const banco = bancoComChecklist();
  const { chamar } = await prepararEntregas(t, { perfil: 'Checklist completo', banco });
  assert.equal((await chamar('/entregas/1/checklist', 'PUT', { cliente: 'x'.repeat(191) })).status, 400);
  assert.equal((await chamar('/entregas/1/checklist', 'PUT', { dataEntrega: '31/12/2026' })).status, 400);
  assert.equal((await chamar('/entregas/99/checklist')).status, 404);
  assert.equal((await chamar('/entregas/99/checklist.pdf')).status, 404);
  assert.equal((await chamar('/entregas/abc/checklist.pdf')).status, 404);
  assert.equal((await chamar('/entregas/99/checklist', 'PUT', {})).status, 404);
  assert.equal(banco.salvos.size, 0);
});

test('rotas: filtro de estados do usuário vale (outra região = 404)', async t => {
  const banco = bancoComChecklist();
  const { chamar } = await prepararEntregas(t, { perfil: 'Checklist completo', banco, estados: ['RJ'] });
  assert.equal((await chamar('/entregas/1/checklist')).status, 404);
  assert.equal((await chamar('/entregas/1/checklist.pdf')).status, 404);
  assert.equal((await chamar('/entregas/1/checklist', 'PUT', {})).status, 404);
});

test('permissões: sem entregas.checklist = 403; só imprimir não salva nem apaga', async t => {
  const banco = bancoComChecklist();
  const { chamar } = await prepararEntregas(t, { perfil: 'Programador', banco });
  assert.equal((await chamar('/entregas/1/checklist.pdf')).status, 403);
  assert.equal((await chamar('/entregas/checklist/branco.pdf')).status, 403);
  assert.equal((await chamar('/entregas/1/checklist', 'PUT', {})).status, 403);
  t.mock.restoreAll();
  const b2 = bancoComChecklist();
  const { chamar: c2 } = await prepararEntregas(t, { perfil: 'Checklist só imprimir', banco: b2 });
  assert.equal((await c2('/entregas/1/checklist.pdf')).status, 200);
  assert.equal((await c2('/entregas/1/checklist', 'PUT', {})).status, 403);
  assert.equal((await c2('/entregas/1/checklist', 'DELETE')).status, 403);
});

test('motorista: abre a folha só da PRÓPRIA entrega (somente leitura); outra = 404 uniforme', async t => {
  const banco = bancoComChecklist();
  banco.semear.entrega({ numero: 100, sequencia: 2, status: 'agendada', tipo: 'motorista', motorista_codigo: 22, data_agendada: '2026-11-12' });
  const { chamar } = await prepararEntregas(t, { perfil: 'Motorista', usuario: { codigo: 21, nome: 'Motorista Um' }, banco });
  const r = await chamar('/minhas_entregas/1/checklist.pdf');
  assert.equal(r.status, 200);
  assert.equal(paginas(Buffer.from(await r.arrayBuffer())), 1);
  assert.equal((await chamar('/minhas_entregas/2/checklist.pdf')).status, 404);
  assert.equal((await chamar('/minhas_entregas/99/checklist.pdf')).status, 404);
  // o motorista não abre as rotas da equipe
  assert.equal((await chamar('/entregas/1/checklist.pdf')).status, 403);
  assert.equal((await chamar('/entregas/1/checklist', 'PUT', {})).status, 403);
});

test('sem endereço da entrega: equipe e motorista recebem 422 (nada é gerado); o cadastro do cliente não serve; com endereço salvo gera; folha em branco livre', async t => {
  const banco = bancoComChecklist();
  // entrega 2: do motorista 21, sem nenhum endereço (o cliente tem endereço no cadastro: não pode ser usado)
  banco.semear.entrega({ numero: 100, sequencia: 2, status: 'agendada', tipo: 'motorista', motorista_codigo: 21, data_agendada: '2026-11-12' });
  const { chamar } = await prepararEntregas(t, { perfil: 'Checklist completo', banco });
  const d = await (await chamar('/entregas/2/checklist')).json();
  assert.equal(d.automatico.endereco, '');
  assert.equal(d.podeGerar, false);
  let r = await chamar('/entregas/2/checklist.pdf');
  assert.equal(r.status, 422);
  assert.deepEqual(await r.json(), { error: 'Informe o endereço da entrega para gerar o checklist.', motivo: 'sem_endereco' });
  // edição salva sem endereço continua bloqueada; com endereço digitado gera
  assert.equal((await chamar('/entregas/2/checklist', 'PUT', { ...d.automatico, cliente: 'X' })).status, 200);
  assert.equal((await chamar('/entregas/2/checklist.pdf')).status, 422);
  assert.equal((await chamar('/entregas/2/checklist', 'PUT', { ...d.automatico, endereco: 'Rua digitada pela equipe, 10' })).status, 200);
  assert.equal((await (await chamar('/entregas/2/checklist')).json()).podeGerar, true);
  r = await chamar('/entregas/2/checklist.pdf');
  assert.equal(r.status, 200);
  assert.equal(paginas(Buffer.from(await r.arrayBuffer())), 1);
  assert.equal((await chamar('/entregas/checklist/branco.pdf')).status, 200);
  // motorista: sem endereço = 422 com a mensagem para falar com a equipe
  banco.salvos.clear();
  t.mock.restoreAll();
  const { chamar: mot } = await prepararEntregas(t, { perfil: 'Motorista', usuario: { codigo: 21, nome: 'Motorista Um' }, banco });
  r = await mot('/minhas_entregas/2/checklist.pdf');
  assert.equal(r.status, 422);
  assert.match((await r.json()).error, /^Informe o endereço da entrega para gerar o checklist\. Fale com a equipe\.$/);
  assert.equal((await mot('/minhas_entregas/1/checklist.pdf')).status, 200);
});

test('sem contato no local a linha "Qualquer dúvida..." sai em branco; volumes não têm valor esperado (só itens)', async () => {
  const dados = K.montarAutomatico({ entrega: { numero: 7, endereco_rua: 'Rua A' }, itens: [{ item: 1, descricao: 'Porta', qtd: 4 }] });
  assert.equal(dados.contato, '');
  const { textos } = await gerarPdf(dados);
  const k = textos.indexOf('Qualquer dúvida entrar em contato com :');
  assert.ok(k >= 0);
  assert.equal(textos[k + 1], 'MOTORISTA'); // nada escrito depois do rótulo do contato
  assert.equal(textos.filter(t => /esperado/.test(t)).length, 1);
  const iItens = textos.indexOf('CONFERIDO QUANTIDADE DE ITENS:'), iVol = textos.indexOf('CONFERIDO QUANTIDADE DE VOLUMES:');
  assert.equal(textos[iItens + 1], '(esperado: 4)');
  assert.ok(!/esperado/.test(textos[iVol + 1] || ''));
});

test('registro: as rotas novas estão registradas e nenhuma é pública', () => {
  const r = registro.rotasAutenticadas().map(x => `${x.metodo.toUpperCase()} ${x.caminho}`);
  for (const c of ['GET /entregas/checklist/branco.pdf', 'GET /entregas/:id/checklist', 'GET /entregas/:id/checklist.pdf', 'PUT /entregas/:id/checklist',
    'DELETE /entregas/:id/checklist', 'GET /minhas_entregas/:id/checklist.pdf']) assert.ok(r.includes(c), c);
  assert.ok(!registro.rotasPublicas().some(x => /checklist/.test(x.caminho)));
});

// ---------- permissão e migração ----------
test('permissão entregas.checklist: no catálogo (área Entregas), no Interno completo, Administrador e Operador; não no motorista', () => {
  const p = CATALOGO.find(x => x.codigo === 'entregas.checklist');
  assert.ok(p); assert.equal(p.area, 'Entregas');
  for (const n of ['Administrador', 'Interno completo', 'Operador']) assert.ok(PERFIS_INICIAIS.find(x => x.nome === n).permissoes.includes('entregas.checklist'), n);
  assert.ok(!PERFIS_INICIAIS.find(x => x.nome === 'Vendedor').permissoes.includes('entregas.checklist'));
});

test('migração: entregas.checklist para todo perfil com entregas.ver e exceções "liberar"; uma vez só, numa transação', async () => {
  const pool = criarPoolFalso([
    [/FROM web_auditoria WHERE acao = 'permissoes_checklist_entregas'/, []],
    [/SELECT DISTINCT perfil_id FROM web_perfil_permissoes WHERE permissao = 'entregas.ver'/, [{ perfil_id: 1 }, { perfil_id: 4 }]],
    [/SELECT DISTINCT usuario_codigo FROM web_usuario_excecoes WHERE permissao = 'entregas.ver' AND tipo = 'liberar'/, [{ usuario_codigo: 30 }]]
  ]);
  assert.deepEqual(await acrescentarPermissoesChecklistEntregas(pool), { feito: true, perfis: 2, usuarios: 1 });
  const ins = pool.chamadas.filter(c => /INSERT IGNORE INTO web_perfil_permissoes/.test(c.sql)).map(c => c.params[0]);
  assert.deepEqual(ins, [1, 4]);
  assert.ok(pool.chamadas.some(c => /INSERT IGNORE INTO web_usuario_excecoes .*'entregas\.checklist', 'liberar'/.test(c.sql) && c.params[0] === 30));
  assert.equal(pool.chamadas.filter(c => c.sql === 'BEGIN').length, 1);
  assert.equal(pool.chamadas.filter(c => c.sql === 'COMMIT').length, 1);
  const feito = criarPoolFalso([[/FROM web_auditoria WHERE acao = 'permissoes_checklist_entregas'/, [{ id: 3 }]]]);
  assert.deepEqual(await acrescentarPermissoesChecklistEntregas(feito), { feito: false });
});

test('instalação: web_entrega_checklist por entrega (chave = entrega_id), sem dinheiro; excluir pedido apaga junto', () => {
  const ins = ler('seguranca/instalacao.js');
  const m = /CREATE TABLE IF NOT EXISTS \\`web_entrega_checklist\\` \(([\s\S]*?)\) \$\{OPCOES\}/.exec(ins);
  assert.ok(m);
  assert.match(m[1], /entrega_id INT NOT NULL PRIMARY KEY/);
  assert.match(m[1], /atualizado_por VARCHAR\(190\) NOT NULL/);
  for (const col of m[1].match(/^\s*(\w+)\s/gm).map(s => s.trim())) assert.doesNotMatch(col, REGEX_VALOR, col);
  assert.match(ler('rotas/ped_orc.js'), /DELETE FROM web_entrega_checklist WHERE entrega_id = \?/);
  assert.doesNotMatch(ins, /ALTER TABLE (?!web_)/);
});

// ---------- telas ----------
test('entrega_checklist.js (tela): mesma lista de campos do servidor, valores iniciais, comparação e validação', () => {
  assert.deepEqual(TELA.CAMPOS.map(c => [c.chave, c.max, !!c.data, !!c.multilinha]), K.CAMPOS.map(c => [c.chave, c.max, !!c.data, !!c.multilinha]));
  const resp = { automatico: { pedido: '1', cliente: 'A', endereco: 'X' }, salvo: { ...Object.fromEntries(K.CHAVES.map(k => [k, ''])), cliente: 'B' } };
  const v = TELA.valoresIniciais(resp);
  assert.equal(v.cliente, 'B'); assert.equal(v.pedido, '');
  assert.equal(TELA.valoresIniciais({ automatico: { cliente: 'A' }, salvo: null }).cliente, 'A');
  assert.ok(TELA.iguais({ cliente: 'A ' }, { cliente: 'A' }));
  assert.ok(!TELA.iguais({ cliente: 'A' }, { cliente: 'B' }));
  assert.equal(TELA.validar({ cliente: 'x'.repeat(191) }), '"Cliente" passa de 190 caracteres.');
  assert.equal(TELA.validar({ dataEntrega: '2026-13-01' }), 'Data de entrega inválida.');
  assert.equal(TELA.validar({ dataEntrega: '2026-11-12' }), '');
  assert.deepEqual(Object.keys(TELA.corpoSalvar({})), K.CHAVES);
  assert.match(TELA.textoOrigem({ salvo: {}, salvoPor: 'Ana', salvoEm: '12/11/2026 10:00' }), /Editado por Ana em 12\/11\/2026 10:00/);
  assert.match(TELA.textoOrigem({ salvo: null }), /dados da entrega/);
  assert.equal(TELA.textoInfo({ entregaRotulo: 'Entrega 1 de 2', qtdItensEsperada: 1.5 }), 'Entrega 1 de 2 · Itens esperados: 1,5');
  // sem endereço: "Gerar PDF" desabilitado com o aviso
  assert.equal(TELA.temEndereco({ endereco: '  ' }), false);
  assert.equal(TELA.temEndereco({ endereco: 'Rua A' }), true);
  assert.equal(TELA.MSG_SEM_ENDERECO, K.MSG_SEM_ENDERECO);
  assert.match(TELA.avisoSemEndereco(true), /Ao preencher, ele fica salvo/);
  assert.match(TELA.avisoSemEndereco(false), /Peça a quem programa/);
  assert.match(ler('entrega_checklist.js'), /\$\('ck-gerar'\)\.disabled = est\.ocupado \|\| !ok;/);
  assert.match(ler('entrega_checklist.js'), /r\.status === 422 \? \(msg \|\| MSG_SEM_ENDERECO\)/);
  assert.match(ler('entregas.html'), /id="ck-aviso-endereco" role="status" hidden/);
  // a aba do PDF abre no clique (antes do await) e o PDF vem com o token
  const js = ler('entrega_checklist.js');
  assert.match(js, /const aba = win\.open\('', '_blank'\);[\s\S]*await cfg\.chamar\(`\/entregas\/\$\{encodeURIComponent\(est\.id\)\}\/checklist`, \{ metodo: 'PUT'/);
  assert.match(js, /Authorization: 'Bearer ' \+ cfg\.token\(\)/);
  assert.doesNotMatch(js, /innerHTML/);
});

test('entregas.html: botão "Checklist de entrega" no detalhe, "Folha em branco" no topo, janela com todos os campos, sem estilo inline nem dinheiro', () => {
  const h = ler('entregas.html');
  assert.match(h, /id="btn-checklist" data-perm="entregas\.checklist">Checklist de entrega</);
  assert.match(h, /id="btn-folha-branco" data-perm="entregas\.checklist"/);
  for (const c of K.CHAVES) assert.match(h, new RegExp(`id="ck-${c}"`), c);
  for (const id of ['ck-janela', 'ck-form', 'ck-gerar', 'ck-branco', 'ck-automatico', 'ck-fechar', 'ck-cancelar', 'ck-origem', 'ck-info', 'ck-somente-leitura', 'erro-ck']) assert.match(h, new RegExp(`id="${id}"`), id);
  assert.match(h, /id="ck-automatico" data-perm="entregas\.programar"/);
  assert.match(h, /role="dialog" aria-modal="true"/);
  assert.match(h, /<script src="entrega_checklist\.js\?v=202611191400" defer><\/script>[\s\S]*<script src="entregas\.js\?v=202611201000" defer>/);
  assert.doesNotMatch(h, /\sstyle="/);
  assert.doesNotMatch(h, /R\$|valor|preço/i);
  assert.match(ler('minhas_entregas.html'), /<script src="entrega_checklist\.js\?v=202611191400" defer><\/script>/);
  const m = ler('minhas_entregas.js');
  assert.match(m, /data-acao="checklist" data-perm="entregas\.baixar">Checklist de entrega \(PDF\)/);
  assert.match(m, /\/minhas_entregas\/\$\{encodeURIComponent\(id\)\}\/checklist\.pdf/);
});

// ---------- Parte B: painel de detalhe ----------
test('painel de detalhe: seções separadas por filete âmbar de 2px, ações agrupadas e cancelamento isolado no fim', () => {
  const h = ler('entregas.html');
  assert.match(h, /\.det-secao \{[^}]*border-top: 2px solid var\(--primary-color\)/);
  const det = h.slice(h.indexOf('id="vista-detalhe"'), h.indexOf('id="vista-agendar"'));
  const ordem = ['d-titulo', 'd-status', 'd-aviso', 'd-info', 'd-acoes-principais', 'btn-agendar', 'd-acoes-secundarias', 'btn-checklist', 'btn-separar', 'd-perigo', 'btn-cancelar',
    'd-itens', 'd-eventos', 'd-anexos'].map(i => det.indexOf(`id="${i}"`));
  assert.ok(ordem.every((p, i) => p > 0 && (i === 0 || p > ordem[i - 1])), JSON.stringify(ordem));
  assert.equal((det.match(/<section class="det-secao/g) || []).length, 5); // Dados, Ações, Itens, Linha do tempo, Comprovantes
  assert.match(det, /<h3 class="det-secao-titulo" id="d-sec-dados">Dados da entrega<\/h3>/);
  // sem faixa lateral colorida maior que 1px; alvos de toque de 44px; reduz movimento
  assert.doesNotMatch(h, /border-left:\s*[2-9]px/);
  assert.match(h, /\.det-mini \{[^}]*min-height: 44px/);
  assert.match(h, /prefers-reduced-motion: reduce/);
  // o cancelamento explica o que acontece antes de confirmar
  assert.match(h, /id="c-aviso"/);
  const js = ler('entregas.js');
  assert.match(js, /\$\('c-aviso'\)\.textContent = avisoCancelamento\(estado\.det\)/);
});

test('linkLigar: só telefone brasileiro válido vira tel:; texto sem telefone, CEP ou número curto não', () => {
  assert.equal(E.linkLigar('João (27) 99876-5432'), 'tel:+5527998765432');
  assert.equal(E.linkLigar('+55 27 3326-7213 recepção'), 'tel:+552733267213');
  assert.equal(E.linkLigar('27 99999.8888'), 'tel:+5527999998888');
  assert.equal(E.linkLigar('Falar com a Ana'), '');
  assert.equal(E.linkLigar('CEP 29090-000'), '');
  assert.equal(E.linkLigar('ramal 1234'), '');
  assert.equal(E.linkLigar('27 89876-5432'), ''); // 9 dígitos sem começar com 9
  assert.equal(E.linkLigar(null), '');
  assert.equal(E.linkLigar('doc 123456789012345'), '');
});

test('avisoCancelamento, htmlEventoDetalhe e htmlItemDetalhe: texto claro e tudo escapado', () => {
  assert.match(E.avisoCancelamento({ entrega: { numero: 5 }, divisao: {} }), /^Cancelar a entrega do pedido 5\? .*não volta sozinho para "A programar"\.$/);
  assert.match(E.avisoCancelamento({ entrega: { numero: 5 }, divisao: { dividido: true, ordemEntrega: 2, qtdEntregasPedido: 3 } }), /pedido 5 \(Entrega 2 de 3\)\?.*Saldo a entregar/);
  assert.equal(E.htmlEventoDetalhe('<x>', '2026-11-12 08:05:00', 'Ana<', 'motivo&'),
    '<li><span class="det-tempo-rot">&lt;x&gt;</span><span class="det-tempo-meta">12/11/2026 08:05 · Ana&lt;</span><div class="det-tempo-txt">motivo&amp;</div></li>');
  assert.equal(E.htmlEventoDetalhe('A', '', '', ''), '<li><span class="det-tempo-rot">A</span><span class="det-tempo-meta"></span></li>');
  assert.match(E.htmlItemDetalhe({ item: null, descricao: '', qtd: 1.5, observacao: '<i>' }), /<span class="det-chip">—<\/span><span class="det-item-desc">Sem descrição<\/span><span class="det-item-qtd">× 1,5<\/span><span class="det-item-obs">Obs\.: &lt;i&gt;<\/span>/);
});
