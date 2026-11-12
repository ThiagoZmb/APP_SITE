// Editar entrega (PUT /entregas/:id, entrega_editar.js) e menu do botão direito de consulta (entregas.js, itensMenuEntrega).
// Banco falso (test/apoio/bancoEntregas.js); nada de MySQL.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { prepararEntregas, PERFIS } = require('./apoio/bancoEntregas');
const { validarEdicao, aplicarEdicao } = require('../calculo/entregas');
const E = require('../entregas.js');
const EE = require('../entrega_editar.js');

const ler = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const ENDERECO = { rua: 'Rua B', numero: '20', bairro: 'Icaraí', cidade: 'Niterói', uf: 'rj', cep: '24220-000', ref: 'Portão verde' };

function cenario(banco, extra = {}) {
  banco.semear.cliente({ ENDERECO: 'Rua do Cliente', NUMERO: '99', TELEFONE: '21999990000' });
  banco.semear.pedido({ NUMERO: 601 });
  return banco.semear.entrega({ numero: 601, status: 'agendada', tipo: 'motorista', motorista_codigo: 21, data_agendada: '2026-11-20', ...extra });
}
const put = (chamar, id, corpo) => chamar(`/entregas/${id}`, 'PUT', corpo);

// ---------- validação e regras puras ----------
test('validarEdicao: só os 6 campos editáveis; pedido, itens, status e situação são recusados', () => {
  for (const campo of ['status', 'numero', 'itens', 'situacao', 'sequencia', 'pedido', 'id']) {
    const r = validarEdicao({ [campo]: 'x' });
    assert.match(r.erro, /Campo não editável/, campo);
  }
  assert.match(validarEdicao({}).erro, /ao menos um campo/);
  assert.match(validarEdicao(null).erro, /inválido/);
  assert.match(validarEdicao({ tipo: 'foguete' }).erro, /Tipo/);
  assert.match(validarEdicao({ dataAgendada: '2026-02-30' }).erro, /Data/);
  assert.match(validarEdicao({ motoristaCodigo: 'abc' }).erro, /motorista/);
  assert.match(validarEdicao({ endereco: { ...ENDERECO, uf: 'RJX' } }).erro, /UF/);
  assert.match(validarEdicao({ endereco: { rua: 'A', pais: 'BR' } }).erro, /desconhecido/);
  assert.match(validarEdicao({ observacao: 'x'.repeat(501) }).erro, /Observação/);
  assert.match(validarEdicao({ contatoLocal: 'x'.repeat(191) }).erro, /Contato/);
  assert.match(validarEdicao({ observacao: 5 }).erro, /inválido/);
  const ok = validarEdicao({ tipo: 'retirada', dataAgendada: ' 2026-11-21 ', motoristaCodigo: '21', endereco: ENDERECO, contatoLocal: '  Ana  ', observacao: '' });
  assert.deepEqual(ok.edicao.tipo, 'retirada');
  assert.equal(ok.edicao.dataAgendada, '2026-11-21');
  assert.equal(ok.edicao.motoristaCodigo, 21);
  assert.equal(ok.edicao.endereco.uf, 'RJ');
  assert.equal(ok.edicao.contatoLocal, 'Ana');
  assert.equal(ok.edicao.observacao, null);
});

test('aplicarEdicao: concluída/cancelada recusada; em rota trava tipo/data/motorista; só o que mudou entra', () => {
  for (const status of ['entregue', 'retirado', 'cancelada']) assert.equal(aplicarEdicao({ status }, { observacao: 'x' }).erro.status, 409, status);
  const emRota = { status: 'em_rota', tipo: 'motorista', motorista_codigo: 21, data_agendada: '2026-11-20' };
  assert.equal(aplicarEdicao(emRota, { dataAgendada: '2026-11-22' }, [21]).erro.status, 409);
  assert.equal(aplicarEdicao({ ...emRota, status: 'enviada', tipo: 'outro_estado' }, { tipo: 'retirada' }, []).erro.status, 409);
  const r = aplicarEdicao(emRota, { observacao: 'Cuidado com o degrau', contatoLocal: null }, [21]);
  assert.deepEqual(Object.keys(r.cols).sort(), ['observacao']); // contato já era vazio: sem mudança
  const agendada = { status: 'agendada', tipo: 'motorista', motorista_codigo: 21, data_agendada: '2026-11-20', endereco_rua: 'Rua A', endereco_uf: 'RJ' };
  assert.equal(aplicarEdicao(agendada, { dataAgendada: null }, [21]).erro.status, 400); // programada precisa de data
  assert.equal(aplicarEdicao(agendada, { motoristaCodigo: 99 }, [21]).erro.status, 400);
  assert.equal(aplicarEdicao(agendada, { observacao: null }, [21]).erro.msg, 'Nenhuma alteração para gravar.');
  const r2 = aplicarEdicao(agendada, { tipo: 'retirada' }, [21]);
  assert.equal(r2.cols.tipo, 'retirada');
  assert.equal(r2.cols.motorista_codigo, null);
  assert.deepEqual(r2.antes, { tipo: 'motorista', motoristaCodigo: 21 });
  assert.equal(aplicarEdicao(agendada, { tipo: 'retirada', motoristaCodigo: 21 }, [21]).erro.status, 400); // motorista só no tipo Entrega
  const r3 = aplicarEdicao(agendada, { endereco: { ...validarEdicao({ endereco: ENDERECO }).edicao.endereco } }, [21]);
  assert.equal(r3.cols.endereco_rua, 'Rua B');
  assert.equal('endereco_uf' in r3.cols, false);
  assert.equal(aplicarEdicao({ status: 'a_programar', tipo: null }, { dataAgendada: '2026-12-01' }, []).cols.data_agendada, '2026-12-01');
});

// ---------- rota ----------
test('PUT /entregas/:id edita campos sem mudar status, pedido nem itens; evento "editada" e auditoria com antes/depois', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  const e = cenario(banco);
  const pedidoAntes = JSON.stringify(banco.pedidos);
  const r = await put(chamar, e.id, { tipo: 'outro_estado', dataAgendada: '2026-11-25', endereco: ENDERECO, contatoLocal: 'Ana 21 98888-0000', observacao: 'Ligar antes' });
  assert.equal(r.status, 200);
  const { entrega } = await r.json();
  assert.equal(entrega.status, 'agendada'); // status intocado
  assert.equal(entrega.tipo, 'outro_estado');
  assert.equal(entrega.motoristaCodigo, null); // saiu do tipo Entrega
  assert.equal(entrega.dataAgendada, '2026-11-25');
  assert.equal(e.endereco_rua, 'Rua B');
  assert.equal(e.endereco_uf, 'RJ');
  assert.equal(e.contato_local, 'Ana 21 98888-0000');
  assert.equal(e.observacao, 'Ligar antes');
  assert.equal(JSON.stringify(banco.pedidos), pedidoAntes, 'o pedido não é tocado');
  assert.equal(banco.eventos.length, 1);
  assert.equal(banco.eventos[0].tipo, 'editada');
  assert.equal(banco.eventos[0].usuario, 'Caio');
  const det = JSON.parse(banco.eventos[0].detalhe);
  assert.equal(det.antes.tipo, 'motorista');
  assert.equal(det.depois.tipo, 'outro_estado');
  assert.equal(det.antes.dataAgendada, '2026-11-20');
  assert.equal(banco.auditoria.length, 1);
  assert.equal(banco.auditoria[0].acao, 'entrega_editada');
  assert.equal(banco.auditoria[0].alvo, '601');
  assert.equal(banco.auditoria[0].quem, 'Caio');
  const aud = JSON.parse(banco.auditoria[0].detalhe);
  assert.equal(aud.entregaId, e.id);
  assert.equal(aud.depois.observacao, 'Ligar antes');
});

test('PUT /entregas/:id troca o motorista só por um motorista válido e a_programar aceita definir a data', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  const e = cenario(banco);
  assert.equal((await put(chamar, e.id, { motoristaCodigo: 30 })).status, 400); // sem entregas.baixar
  assert.equal((await put(chamar, e.id, { motoristaCodigo: 999 })).status, 400);
  assert.equal(e.motorista_codigo, 21);
  assert.equal(banco.eventos.length, 0);
  assert.equal((await put(chamar, e.id, { motoristaCodigo: 22 })).status, 200);
  assert.equal(e.motorista_codigo, 22);
  const f = banco.semear.entrega({ numero: 601, id: 9, sequencia: 2 });
  assert.equal((await put(chamar, f.id, { dataAgendada: '2026-12-01' })).status, 200);
  assert.equal(f.status, 'a_programar');
  assert.equal(f.data_agendada, '2026-12-01');
});

test('PUT /entregas/:id recusa entrega concluída ou cancelada (409) e não grava nada', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  banco.semear.pedido({ NUMERO: 602 });
  for (const [n, status] of [[602, 'entregue'], [602, 'retirado'], [602, 'cancelada']]) {
    const e = banco.semear.entrega({ numero: n, sequencia: banco.entregas.length + 1, status, tipo: 'motorista', motorista_codigo: 21, data_agendada: '2026-11-20' });
    const r = await put(chamar, e.id, { observacao: 'tarde demais' });
    assert.equal(r.status, 409, status);
    assert.match((await r.json()).error, /não pode mais ser alterado/);
    assert.equal(e.observacao ?? null, null);
  }
  assert.equal(banco.eventos.length, 0);
  assert.equal(banco.auditoria.length, 0);
});

test('PUT /entregas/:id em rota: tipo, data e motorista travados (409), o resto edita sem tirar do status', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  const e = cenario(banco, { status: 'em_rota' });
  const r = await put(chamar, e.id, { dataAgendada: '2026-11-30' });
  assert.equal(r.status, 409);
  assert.equal(e.data_agendada, '2026-11-20');
  const ok = await put(chamar, e.id, { contatoLocal: 'Zé 21 97777-0000', endereco: ENDERECO });
  assert.equal(ok.status, 200);
  assert.equal(e.status, 'em_rota');
  assert.equal(e.contato_local, 'Zé 21 97777-0000');
});

test('PUT /entregas/:id: corpo inválido = 400; inexistente = 404; edição só desta entrega (outra sequência do pedido intocada)', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  const e = cenario(banco);
  const outra = banco.semear.entrega({ numero: 601, id: 12, sequencia: 2, status: 'agendada', tipo: 'retirada', data_agendada: '2026-11-21' });
  for (const corpo of [{ status: 'entregue' }, { itens: [] }, { numero: 5 }, { tipo: 'x' }, { dataAgendada: 'amanhã' }, {}, { endereco: { ...ENDERECO, uf: 'R1' } }, { observacao: 'x'.repeat(501) }]) {
    assert.equal((await put(chamar, e.id, corpo)).status, 400, JSON.stringify(corpo).slice(0, 40));
  }
  assert.equal((await put(chamar, 9999, { observacao: 'a' })).status, 404);
  assert.equal((await put(chamar, 'abc', { observacao: 'a' })).status, 404);
  assert.equal((await put(chamar, e.id, { observacao: 'Só esta' })).status, 200);
  assert.equal(e.observacao, 'Só esta');
  assert.equal(outra.observacao ?? null, null);
  assert.equal(outra.data_agendada, '2026-11-21');
  assert.equal(banco.eventos.length, 1);
  assert.equal(banco.eventos[0].entrega_id, e.id);
});

for (const perfil of ['Somente ver', 'Motorista', 'Motorista com valores']) {
  test(`PUT /entregas/:id exige entregas.programar: perfil "${perfil}" recebe 403 e nada é gravado`, async t => {
    const { banco, chamar } = await prepararEntregas(t, { perfil });
    const e = cenario(banco);
    const r = await put(chamar, e.id, { observacao: 'x' });
    assert.equal(r.status, 403);
    assert.equal(e.observacao ?? null, null);
    assert.equal(banco.eventos.length, 0);
    assert.equal(banco.auditoria.length, 0);
  });
}

test('PUT /entregas/:id sem token = 401 e o motorista não ganha rota de edição em /minhas_entregas', async t => {
  const { banco, chamar } = await prepararEntregas(t);
  const e = cenario(banco);
  const semToken = await chamar(`/entregas/${e.id}`, 'PUT', { observacao: 'x' }, { Authorization: '' });
  assert.equal(semToken.status, 401);
  const { registro } = require('../index.js');
  const rotas = registro.rotasAutenticadas().map(r => `${r.metodo.toUpperCase()} ${r.caminho}`);
  assert.ok(rotas.includes('PUT /entregas/:id'));
  assert.equal(rotas.includes('PUT /minhas_entregas/:id'), false);
  assert.match(ler('rotas/entregas.js'), /rota\('put', '\/entregas\/:id', PROGRAMAR,/);
});

test('a rota de edição só escreve em tabelas web_* e não chama a varredura nem mexe em ped_orc', () => {
  const src = ler('rotas/entregas.js');
  const bloco = src.slice(src.indexOf("rota('put', '/entregas/:id', PROGRAMAR"), src.indexOf('// ---- anexos (foto/assinatura) ----'));
  assert.ok(bloco.length > 100);
  assert.doesNotMatch(bloco, /ped_orc|sincronizarFila|fluxo_de_caixa|estoque/);
  assert.match(bloco, /'editada'/);
});

// ---------- janela de edição (puras) ----------
test('corpoEdicao manda só o que mudou; endereço vai inteiro; em rota ignora tipo/data/motorista', () => {
  const e = { numero: 601, status: 'agendada', tipo: 'motorista', dataAgendada: '2026-11-20', motoristaCodigo: 21, endereco: { rua: 'Rua A', uf: 'RJ' }, contatoLocal: 'Ana', observacao: '' };
  const f = EE.formularioInicial(e);
  assert.equal(EE.corpoEdicao(f, e), null);
  assert.deepEqual(EE.corpoEdicao({ ...f, observacao: ' nova ' }, e), { observacao: 'nova' });
  assert.deepEqual(EE.corpoEdicao({ ...f, dataAgendada: '2026-11-22' }, e), { dataAgendada: '2026-11-22' });
  const b = EE.corpoEdicao({ ...f, tipo: 'retirada' }, e);
  assert.deepEqual(b, { tipo: 'retirada' });
  const c = EE.corpoEdicao({ ...f, rua: 'Rua Z', uf: 'rj' }, e);
  assert.equal(c.endereco.rua, 'Rua Z');
  assert.equal(c.endereco.uf, 'RJ');
  assert.equal(c.endereco.cidade, '');
  assert.deepEqual(EE.corpoEdicao({ ...f, motoristaCodigo: '22' }, e), { motoristaCodigo: 22 });
  const rota = { ...e, status: 'em_rota' };
  assert.deepEqual(EE.corpoEdicao({ ...EE.formularioInicial(rota), dataAgendada: '2030-01-01', tipo: 'retirada', observacao: 'x' }, rota), { observacao: 'x' });
  assert.deepEqual(EE.validarFormulario({ ...f, tipo: 'motorista', motoristaCodigo: '' }, e), ['Escolha o motorista.']);
  assert.deepEqual(EE.validarFormulario({ ...f, dataAgendada: '' }, e), ['A entrega já está programada: informe a data.']);
  assert.deepEqual(EE.validarFormulario({ ...f, dataAgendada: '' }, { ...e, status: 'a_programar' }), []);
  assert.deepEqual(EE.validarFormulario({ ...f, uf: 'RJX' }, e), ['UF deve ter 2 letras.']);
});

// ---------- menu do botão direito: permissão por opção ----------
const podeCom = (...codigos) => { const s = new Set(codigos); return perm => String(perm).split(/\s+/).filter(Boolean).every(c => s.has(c)); };
const ids = (e, pode) => E.itensMenuEntrega(e, pode).filter(i => !i.sep).map(i => i.id);
const ENTREGA = { id: 1, numero: 601, cliente: 'CLIENTE TESTE LTDA', status: 'agendada' };

test('menu: cada opção só aparece com a permissão da rota que usa (valores só com valores.ver)', () => {
  assert.deepEqual(ids(ENTREGA, podeCom()), []);
  assert.deepEqual(ids(ENTREGA, podeCom('entregas.ver')), ['detalhe', 'linha_tempo', 'copiar_endereco', 'copiar_contato', 'ligar']);
  assert.ok(ids(ENTREGA, podeCom('entregas.ver', 'pedidos.pdf')).includes('pdf_pedido'));
  assert.deepEqual(ids(ENTREGA, podeCom('pedidos.pdf')), ['pdf_pedido', 'pdf_producao', 'pdf_vidros']);
  assert.deepEqual(ids(ENTREGA, podeCom('danfe.ver')), ['danfe']);
  assert.deepEqual(ids(ENTREGA, podeCom('pedidos.ver')), ['historico_pedido']);
  assert.deepEqual(ids(ENTREGA, podeCom('etapas.ver')), ['etapas']);
  assert.deepEqual(ids(ENTREGA, podeCom('entregas.checklist')), []); // checklist exige entregas.ver também
  assert.deepEqual(ids(ENTREGA, podeCom('entregas.ver', 'entregas.checklist')).filter(i => i === 'checklist'), ['checklist']);
  // financeiro do cliente: clientes.receber E valores.ver (dinheiro); uma só não basta
  assert.equal(ids(ENTREGA, podeCom('clientes.receber')).includes('financeiro_cliente'), false);
  assert.equal(ids(ENTREGA, podeCom('valores.ver')).includes('financeiro_cliente'), false);
  assert.equal(ids(ENTREGA, podeCom('clientes.receber', 'valores.ver')).includes('financeiro_cliente'), true);
  // administrador vê tudo
  const tudo = podeCom('entregas.ver', 'entregas.checklist', 'pedidos.pdf', 'danfe.ver', 'pedidos.ver', 'etapas.ver', 'clientes.receber', 'valores.ver');
  assert.equal(ids(ENTREGA, tudo).length, E.MENU_ENTREGA.filter(i => !i.sep).length);
  assert.deepEqual(E.itensMenuEntrega(null, tudo), []);
  assert.deepEqual(E.itensMenuEntrega(ENTREGA, null), []);
});

test('menu: sem separadores soltos (começo, fim ou dobrados) e nada que altere pedido ou entrega', () => {
  for (const perms of [['entregas.ver'], ['pedidos.pdf', 'danfe.ver'], ['etapas.ver', 'pedidos.ver'], ['danfe.ver']]) {
    const L = E.itensMenuEntrega(ENTREGA, podeCom(...perms));
    assert.ok(L.length === 0 || !L[0].sep, 'não começa com separador');
    assert.ok(L.length === 0 || !L[L.length - 1].sep, 'não termina com separador');
    L.forEach((it, i) => assert.ok(!(it.sep && L[i + 1] && L[i + 1].sep), 'separador dobrado'));
  }
  const PROIBIDOS = /situa|data_pronto|desconto|excluir|cancelar|editar|reagendar|agendar|baixa|retirada|separar|criar|salvar/i;
  for (const it of E.MENU_ENTREGA.filter(i => !i.sep)) {
    assert.doesNotMatch(it.id, PROIBIDOS, it.id);
    assert.match(it.rota, /^GET /, `${it.id}: o menu só usa rotas de leitura`);
  }
  // o menu do motorista não existe: minhas_entregas não carrega nem chama nada disso
  assert.doesNotMatch(ler('minhas_entregas.js'), /itensMenuEntrega|contextmenu|ent-menu/);
  assert.doesNotMatch(ler('minhas_entregas.html'), /entrega_editar|ent-menu|btn-editar/);
});

// permissão de cada opção = a que a rota registrada exige (o menu nunca é mais permissivo do que a rota)
function exigeDaRota(arquivo, metodo, caminho) {
  const src = ler(arquivo);
  const re = new RegExp(`(?:registro\\.rota|rota)\\('${metodo}',\\s*'${caminho.replace(/[/:.]/g, c => '\\' + c)}',\\s*(\\[[^\\]]*\\]|[A-Z_]+)`);
  const m = re.exec(src);
  assert.ok(m, `${metodo} ${caminho} não encontrada em ${arquivo}`);
  let lista = m[1];
  if (!lista.startsWith('[')) lista = new RegExp(`const ${lista} = (\\[[^\\]]*\\])`).exec(src)[1];
  return JSON.parse(lista.replace(/'/g, '"'));
}
test('menu: a permissão de cada opção cobre tudo o que a rota correspondente exige', () => {
  const ONDE = {
    'GET /entregas/:id': ['rotas/entregas.js', 'get', '/entregas/:id'],
    'GET /dados_pdf': ['index.js', 'get', '/dados_pdf'],
    'GET /dados_pdf_vidros': ['index.js', 'get', '/dados_pdf_vidros'],
    'GET /danfe/pedido/:numero': ['rotas/danfe.js', 'get', '/danfe/pedido/:numero'],
    'GET /entregas/:id/checklist.pdf': ['rotas/entrega_checklist.js', 'get', '/entregas/:id/checklist.pdf'],
    'GET /ped_orc/Pedido/:numero/historico': ['rotas/ped_orc.js', 'get', '/ped_orc/Pedido/:numero/historico'],
    'GET /etapas/fila': ['rotas/etapas_producao.js', 'get', '/etapas/fila'],
    'GET /clientes/financeiro/:codigo': ['index.js', 'get', '/clientes/financeiro/:codigo']
  };
  for (const it of E.MENU_ENTREGA.filter(i => !i.sep)) {
    const onde = ONDE[it.rota];
    assert.ok(onde, `${it.id}: rota ${it.rota} sem conferência`);
    const exige = exigeDaRota(...onde);
    const tem = new Set(it.perm.split(/\s+/));
    for (const c of exige) assert.ok(tem.has(c), `${it.id}: a rota exige ${c}, o menu não`);
  }
});

// ---------- telas ----------
test('entregas.html/js: botão Editar entrega (só entregas.programar), menu de consulta, scripts e versões', () => {
  const h = ler('entregas.html'), js = ler('entregas.js');
  assert.match(h, /<button[^>]*id="btn-editar"[^>]*data-perm="entregas\.programar"[^>]*hidden>Editar entrega<\/button>/);
  assert.ok(h.indexOf('id="btn-reagendar"') < h.indexOf('id="btn-editar"'), 'ao lado do Reagendar');
  assert.match(h, /id="btn-mais"[^>]*aria-haspopup="menu"/);
  for (const s of ['danfe_pedido.js', 'historico_pedido_tela.js', 'entrega_editar.js', 'entregas.js']) assert.match(h, new RegExp(`<script src="${s.replace('.', '\\.')}\\?v=\\d+" defer></script>`), s);
  assert.match(h, /entrega_editar\.js\?v=202611191800/);
  assert.doesNotMatch(h, /\sstyle=/i);
  assert.match(js, /\$\('btn-editar'\)\.hidden = !podeEditarEntrega\(e\)/);
  assert.match(js, /lista'\)\.addEventListener\('contextmenu'/);
  assert.match(js, /data-mais/);
  assert.match(js, /metodo: 'PUT', corpo/);
  assert.match(js, /abrirMenu\(ev\.currentTarget\)/);
  // o menu não chama nenhuma rota de escrita
  const menu = js.slice(js.indexOf('// ---------- Menu do botão direito'), js.indexOf('// ---------- Cancelar ----------'));
  assert.doesNotMatch(menu, /metodo: 'P(OST|UT)'|DELETE/);
  // a janela de edição carrega pelo tema (.dp-*) e escapa dados da API só por value/textContent
  const ed = ler('entrega_editar.js');
  assert.doesNotMatch(ed, /innerHTML|insertAdjacentHTML|eval\(|style\.cssText/);
  assert.match(ed, /dp-fundo/);
  assert.match(ler('etapas_producao.js'), /get\('busca'\)/);
});

test('botão Editar entrega só em entrega aberta e tipos de evento têm rótulo e resumo', () => {
  for (const s of ['a_programar', 'agendada', 'em_rota', 'ocorrencia', 'enviada']) assert.equal(E.podeEditarEntrega({ status: s }), true, s);
  for (const s of ['entregue', 'retirado', 'cancelada']) assert.equal(E.podeEditarEntrega({ status: s }), false, s);
  assert.equal(E.rotuloEvento('editada'), 'Entrega editada');
  const txt = E.resumoEdicao({ antes: { tipo: 'motorista', dataAgendada: '2026-11-20', observacao: null }, depois: { tipo: 'retirada', dataAgendada: '2026-11-22', observacao: 'Ligar' } });
  assert.equal(txt, 'Tipo: Entrega → Retirado pelo cliente; Data: 20/11/2026 → 22/11/2026; Observação: vazio → Ligar');
  assert.equal(E.resumoEdicao(null), '');
  assert.ok(PERFIS['Programador'].includes('entregas.programar'));
});
