// Ajustes da tela de Entregas (2026-11-11): botão Atualizar, aba "A programar", nome do motorista e número do item.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { prepararEntregas } = require('./apoio/bancoEntregas');
const E = require('../entregas.js');
const C = require('../entregas_comum.js');
const M = require('../minhas_entregas.js');

const ler = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

function cenario(banco, extra = {}) {
  banco.pedidos.push({ NUMERO: 701, TIPO: 'Pedido', SITUACAO: 'Pronto', RAZAO_SOCIAL: 'Cliente Teste', DATA: '2026-11-01', DATA_PRONTO: '2026-11-05' });
  banco.itens.push({ NUMERO: 701, TIPO: 'Pedido', ITEM: 6, DESCRICAO: 'Estrutura metálica editável', QTD: 1 },
    { NUMERO: 701, TIPO: 'Pedido', ITEM: 1, DESCRICAO: 'Porta', QTD: 2 });
  return banco.semear.entrega({ numero: 701, status: 'agendada', tipo: 'motorista', motorista_codigo: 21, data_agendada: '2026-11-12', ...extra });
}

// ---------- 3. nome do motorista ----------
test('GET /entregas/:id devolve motoristaNome (só o nome); sem motorista = null', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  const e = cenario(banco);
  const j = await (await chamar(`/entregas/${e.id}`)).json();
  assert.equal(j.entrega.motoristaCodigo, 21);
  assert.equal(j.entrega.motoristaNome, 'Motorista Um');
  assert.ok(!/senha|nivel|salario/i.test(JSON.stringify(j.entrega)));
  const sem = banco.semear.entrega({ numero: 701, sequencia: 2, status: 'a_programar' });
  const j2 = await (await chamar(`/entregas/${sem.id}`)).json();
  assert.equal(j2.entrega.motoristaNome, null);
});

test('GET /entregas/:id: motorista sem a permissão de baixa (fora de /entregas/motoristas) continua com nome', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  const e = cenario(banco, { motorista_codigo: 30 }); // 30 = "Sem Acesso": não é motorista válido hoje
  assert.equal((await (await chamar('/entregas/motoristas')).json()).motoristas.some(m => m.codigo === 30), false);
  const j = await (await chamar(`/entregas/${e.id}`)).json();
  assert.equal(j.entrega.motoristaNome, 'Sem Acesso');
});

test('nomeMotorista: nome do servidor > lista carregada > #id só como último recurso', () => {
  assert.equal(E.nomeMotorista({ motoristaCodigo: 10, motoristaNome: 'João' }, null), 'João');
  assert.equal(E.nomeMotorista({ motoristaCodigo: 10, motorista: 'Maria' }, []), 'Maria');
  assert.equal(E.nomeMotorista({ motoristaCodigo: 10 }, [{ codigo: 10, nome: 'Pedro' }]), 'Pedro');
  assert.equal(E.nomeMotorista({ motoristaCodigo: 10 }, null), '#10');
  assert.equal(E.nomeMotorista({ motoristaCodigo: 10, motoristaNome: '  ' }, []), '#10');
  assert.equal(E.nomeMotorista({ motoristaCodigo: null }, []), '');
});

test('o detalhe usa nomeMotorista (não depende da lista de motoristas já ter sido carregada)', () => {
  const js = ler('entregas.js');
  assert.match(js, /linhaInfo\('Motorista', nomeMotorista\(e, estado\.motoristas\)\)/);
  assert.doesNotMatch(js, /\(estado\.motoristas \|\| \[\]\)\.find\(m => m\.codigo === e\.motoristaCodigo\)\?\.nome \|\|/);
});

// ---------- 4. número do item ----------
test('rotuloItem: "Item N · descrição"; sem número válido, só a descrição; escapado na lista', () => {
  assert.equal(C.rotuloItem({ item: 1, descricao: 'Estrutura metálica editável' }), 'Item 1 · Estrutura metálica editável');
  assert.equal(C.rotuloItem({ item: '6', descricao: 'Porta' }), 'Item 6 · Porta');
  assert.equal(C.rotuloItem({ descricao: 'Porta' }), 'Porta');
  assert.equal(C.rotuloItem({ item: null, descricao: 'Porta' }), 'Porta');
  assert.equal(C.rotuloItem({ item: 'x', descricao: 'Porta' }), 'Porta');
  assert.equal(E.textoItens([{ item: 2, descricao: 'Trilho', qtd: 1.5 }]), 'Item 2 · Trilho × 1,5');
  const js = ler('entregas.js');
  // o detalhe mostra o número do item num chip e a descrição escapada à parte (htmlItemDetalhe, 2026-11-12)
  assert.match(js, /itens\.map\(htmlItemDetalhe\)/);
  assert.equal(E.htmlItemDetalhe({ item: 3, descricao: '<b>Porta</b>', qtd: 2 }),
    '<li class="det-item"><span class="det-chip">Item 3</span><span class="det-item-desc">&lt;b&gt;Porta&lt;/b&gt;</span><span class="det-item-qtd">× 2</span></li>');
});

test('detalhe da equipe: itensDetalhe traz o ITEM de cada item mesmo sem divisão (entrega do pedido inteiro)', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  const e = cenario(banco);
  const j = await (await chamar(`/entregas/${e.id}`)).json();
  assert.deepEqual(j.itensDetalhe.map(i => [i.item, i.descricao, i.qtd]), [[1, 'Porta', 2], [6, 'Estrutura metálica editável', 1]]);
  assert.ok(!/valor|preco/i.test(JSON.stringify(j.itensDetalhe)));
  const js = ler('entregas.js');
  assert.match(js, /estado\.det\.itensDetalhe\.length \? estado\.det\.itensDetalhe/);
});

test('motorista: o detalhe traz o número do item e o cartão mostra "Item N · ..."; sem dinheiro', async t => {
  const equipe = await prepararEntregas(t);
  const e = cenario(equipe.banco);
  const { chamar } = await prepararEntregas(t, { perfil: 'Motorista', usuario: { codigo: 21, nome: 'Motorista Um' }, banco: equipe.banco });
  const d = await (await chamar(`/minhas_entregas/${e.id}`)).json();
  assert.deepEqual(d.itens.map(i => [i.item, i.descricao]), [[1, 'Porta'], [6, 'Estrutura metálica editável']]);
  assert.ok(!/valor|preco/i.test(JSON.stringify(d.itens)));
  assert.equal(M.esc, C.esc);
  assert.match(ler('minhas_entregas.js'), /esc\(rotuloItem\(i\)\)/);
});

// ---------- 1 e 2. Atualizar e A programar ----------
test('aba "A programar": só o rótulo mudou (id, status e textos do histórico ficam)', () => {
  const aba = E.ABAS.find(a => a.id === 'fila');
  assert.equal(aba.rotulo, 'A programar');
  assert.deepEqual(aba.status, ['a_programar']);
  assert.equal(E.rotuloEvento('criada'), 'Entrou na fila');
  const h = ler('entregas.html');
  assert.match(h, /data-aba="fila">A programar<span class="contagem" hidden>/);
  assert.doesNotMatch(h, />Fila</);
  assert.doesNotMatch(ler('entregas.js'), /na fila, A programar|criada na fila/);
});

test('botão Atualizar: visível, acessível, só no clique (sem timer), com estado "Atualizando..."', () => {
  const h = ler('entregas.html'), js = ler('entregas.js');
  assert.match(h, /<button type="button" class="btn btn-secondary" id="btn-atualizar"[^>]*aria-label="[^"]+"/);
  assert.match(h, /class="rot">Atualizar</);
  assert.doesNotMatch(h.match(/<button[^>]*id="btn-atualizar"[^>]*>/)[0], /style=/);
  assert.match(js, /\$\('btn-atualizar'\)\.addEventListener\('click', atualizar\)/);
  assert.match(js, /'Atualizando\.\.\.'/);
  assert.doesNotMatch(js, /setInterval|setTimeout/);
  assert.doesNotMatch(ler('entregas_comum.js'), /setInterval/);
});

test('Atualizar roda o mesmo carregamento da abertura (GET /entregas, que varre) e reabre o detalhe', () => {
  const js = ler('entregas.js');
  const corpo = js.slice(js.indexOf('async function atualizar()'), js.indexOf('async function recarregarTudo'));
  assert.match(corpo, /await carregar\(\)/);
  assert.match(corpo, /await abrirDetalhe\(id\)/);
  assert.match(corpo, /estado\.det = null; mostrar\('vazio-painel'\)/); // entrega que sumiu: fecha o painel
  assert.doesNotMatch(corpo, /estado\.aba =|estado\.busca =/); // aba e busca ficam
  assert.match(js, /chamar\('\/entregas'\)/);
});

test('a varredura continua só por ação do usuário: GET /entregas varre, nada por tempo', async t => {
  const { chamar } = await prepararEntregas(t);
  assert.equal((await chamar('/entregas')).status, 200);
  assert.doesNotMatch(ler('entregas.js'), /setInterval|setTimeout/);
});

test('versões ?v= dos scripts alterados subiram', () => {
  assert.match(ler('entregas.html'), /entregas\.js\?v=202611121200/);
  assert.match(ler('entregas.html'), /entregas_comum\.js\?v=202611112000/);
  assert.match(ler('minhas_entregas.html'), /minhas_entregas\.js\?v=202611121200/);
});
