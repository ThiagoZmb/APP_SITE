// Permissões por ação (2026-11-17, pedido do dono: "Reagendar entregas só pode ser feita pelo administrativo", e assim por diante).
// entregas.programar virou uma permissão por ação; pedidos.situacao perdeu a data de pronto e orcamentos.criar perdeu o desconto do pedido.
// Rotas com o banco simulado de entregas (test/apoio/bancoEntregas.js) e a migração com pool falso; nada toca MySQL real.
process.env.JWT_SECRET = 'teste';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { prepararEntregas } = require('./apoio/bancoEntregas');
const { criarPoolFalso } = require('./apoio/poolFalso');
const { desdobrarPermissoes, acrescentarPermissoesEntregasAcoes, acrescentarPermissoesPedidosAcoes, REGRAS_ENTREGAS_ACOES, REGRAS_PEDIDOS_ACOES } = require('../seguranca/instalacao');
const { CODIGOS, PERMISSOES_ADMINISTRATIVAS } = require('../seguranca/permissoes');

const ler = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);

function cenario(banco, entrega = {}) {
  banco.semear.cliente();
  banco.semear.pedido({ NUMERO: 501, SITUACAO: 'Pronto' });
  return banco.semear.entrega({ numero: 501, status: 'agendada', tipo: 'motorista', motorista_codigo: 21, data_agendada: '2026-11-20', ...entrega });
}
const post = (chamar, id, acao, corpo = {}) => chamar(`/entregas/${id}/${acao}`, 'POST', corpo);

// ======================= rotas: cada ação exige a sua permissão =======================
test('rotas: cada ação de Entregas declara a própria permissão (sem entregas.programar genérico nas ações separadas)', () => {
  const src = ler('rotas/entregas.js');
  const esperado = {
    "'post', '/entregas/:id/agendar'": 'PROGRAMAR', "'put', '/entregas/:id/endereco'": 'PROGRAMAR', "'put', '/entregas/:id'": 'PROGRAMAR',
    "'post', '/entregas/:id/reagendar'": 'REAGENDAR', "'post', '/entregas/:id/cancelar'": 'CANCELAR',
    "'put', '/entregas/:id/anexo'": 'CONCLUIR', "'post', '/entregas/:id/retirada'": 'CONCLUIR', "'post', '/entregas/:id/enviada'": 'CONCLUIR',
    "'post', '/entregas/:id/comprovante'": 'CONCLUIR', "'put', '/entregas/:id/checklist_assinado'": 'CHECKLIST_ASSINADO',
    "'post', '/entregas/:id/separar'": 'DIVIDIR', "'post', '/entregas/pedido/:numero/saldo'": 'DIVIDIR',
    "'post', '/entregas/pedido/:numero/saldo/encerrar'": 'ENCERRAR_SALDO', "'post', '/entregas/pedido/:numero/criar'": 'CRIAR'
  };
  for (const [rota, perm] of Object.entries(esperado)) assert.ok(src.includes(`rota(${rota}, ${perm},`), `${rota} -> ${perm}`);
  for (const [nome, codigo] of [['REAGENDAR', 'entregas.reagendar'], ['CANCELAR', 'entregas.cancelar'], ['CRIAR', 'entregas.criar'], ['DIVIDIR', 'entregas.dividir'],
    ['ENCERRAR_SALDO', 'entregas.encerrar_saldo'], ['CONCLUIR', 'entregas.concluir'], ['CHECKLIST_ASSINADO', 'entregas.checklist_assinado']]) {
    assert.ok(src.includes(`const ${nome} = ['${codigo}'];`), nome);
    assert.ok(CODIGOS.has(codigo), codigo);
  }
  const ped = ler('rotas/ped_orc.js');
  assert.match(ped, /rota\('post', '\/ped_orc\/:tipo\/:numero\/desconto', \['pedidos\.desconto', 'valores\.ver'\]/);
  assert.match(ped, /rota\('get', '\/ped_orc\/:tipo\/:numero\/desconto', \['pedidos\.desconto', 'valores\.ver'\]/);
  assert.match(ped, /rota\('post', '\/ped_orc\/:tipo\/:numero\/data_pronto', \[\{ algum: \['pedidos\.data_pronto', 'orcamentos\.salvar'\] \}\]/);
});

test('só agendar (perfil com a permissão antiga, sem a migração): agenda e corrige endereço; todas as outras ações = 403 e nada gravado', async t => {
  const { banco, chamar } = await prepararEntregas(t, { perfil: 'Só agendar' });
  const e = cenario(banco, { status: 'a_programar', tipo: null, motorista_codigo: null, data_agendada: null });
  assert.equal((await post(chamar, e.id, 'agendar', { tipo: 'retirada', dataAgendada: '2026-11-21' })).status, 200);
  assert.equal(e.status, 'agendada');
  const eventos = banco.eventos.length;
  assert.equal((await post(chamar, e.id, 'reagendar', { dataAgendada: '2026-11-22' })).status, 403);
  assert.equal((await post(chamar, e.id, 'cancelar', { motivo: 'teste' })).status, 403);
  assert.equal((await post(chamar, e.id, 'retirada', { entregueA: 'João' })).status, 403);
  assert.equal((await post(chamar, e.id, 'separar', { itens: [{ numeroItem: 1, quantidade: 1 }] })).status, 403);
  assert.equal((await chamar('/entregas/pedido/501/saldo', 'POST', {})).status, 403);
  assert.equal((await chamar('/entregas/pedido/501/saldo/encerrar', 'POST', { motivo: 'xxx' })).status, 403);
  assert.equal((await chamar('/entregas/pedido/777/criar', 'POST', {})).status, 403);
  assert.equal((await chamar(`/entregas/${e.id}/anexo?tipo=foto`, 'PUT', JPEG, { 'Content-Type': 'image/jpeg' })).status, 403);
  assert.equal((await chamar(`/entregas/${e.id}/checklist_assinado`, 'PUT', JPEG, { 'Content-Type': 'image/jpeg' })).status, 403);
  assert.equal(e.status, 'agendada');
  assert.equal(e.data_agendada, '2026-11-21');
  assert.equal(banco.eventos.length, eventos, 'nenhum evento novo');
  assert.equal(banco.anexos.length, 0);
});

test('reagendar só com entregas.reagendar: a equipe sem ela recebe 403; com ela, agendada -> reagendada', async t => {
  const sem = await prepararEntregas(t, { perfil: 'Programador sem reagendar' });
  const a = cenario(sem.banco);
  assert.equal((await post(sem.chamar, a.id, 'reagendar', { dataAgendada: '2026-11-25' })).status, 403);
  assert.equal(a.data_agendada, '2026-11-20');
  // o resto da equipe continua: cancelar vale
  assert.equal((await post(sem.chamar, a.id, 'cancelar', { motivo: 'cliente desistiu' })).status, 200);
  const com = await prepararEntregas(t, { perfil: 'Programador' });
  const b = cenario(com.banco);
  const r = await post(com.chamar, b.id, 'reagendar', { dataAgendada: '2026-11-25' });
  assert.equal(r.status, 200);
  assert.equal(b.data_agendada, '2026-11-25');
});

test('"Editar entrega" não serve de atalho para reagendar: mudar data/tipo/motorista de entrega já programada exige entregas.reagendar', async t => {
  const { banco, chamar } = await prepararEntregas(t, { perfil: 'Programador sem reagendar' });
  const e = cenario(banco);
  for (const corpo of [{ dataAgendada: '2026-11-28' }, { tipo: 'retirada' }, { motoristaCodigo: 22 }]) {
    const r = await chamar(`/entregas/${e.id}`, 'PUT', corpo);
    assert.equal(r.status, 403, JSON.stringify(corpo));
    assert.match((await r.json()).error, /reagendar/i);
  }
  assert.equal(e.data_agendada, '2026-11-20');
  assert.equal(e.tipo, 'motorista');
  assert.equal(Number(e.motorista_codigo), 21);
  assert.equal(banco.eventos.length, 0);
  assert.equal(banco.auditoria.length, 0);
  // endereço, contato e observação continuam com entregas.programar
  assert.equal((await chamar(`/entregas/${e.id}`, 'PUT', { observacao: 'Ligar antes' })).status, 200);
  assert.equal(e.observacao, 'Ligar antes');
  // entrega ainda A programar: definir a data é agendar, não reagendar
  const nova = banco.semear.entrega({ numero: 501, sequencia: 2, status: 'a_programar' });
  assert.equal((await chamar(`/entregas/${nova.id}`, 'PUT', { dataAgendada: '2026-11-29' })).status, 200);
});

test('"Editar entrega" com entregas.reagendar muda a data de entrega agendada', async t => {
  const { banco, chamar } = await prepararEntregas(t, { perfil: 'Programador' });
  const e = cenario(banco);
  assert.equal((await chamar(`/entregas/${e.id}`, 'PUT', { dataAgendada: '2026-11-28' })).status, 200);
  assert.equal(e.data_agendada, '2026-11-28');
});

test('tela: a janela Editar entrega esconde tipo/data/motorista de quem não reagenda (entrega já programada)', () => {
  const ed = ler('entrega_editar.js');
  assert.match(ed, /const semReagendar = cfg\.podeReagendar === false && e\.status !== 'a_programar' && !agendaTravada\(e\);/);
  assert.match(ed, /const travada = agendaTravada\(e\) \|\| semReagendar;/);
  assert.match(ed, /só o administrativo faz/);
});

test('menus: "Programar entrega" (criar) usa entregas.criar no Início, calendário e painel', () => {
  assert.match(ler('inicio_menu.js'), /\['pronto', 'em producao'\]\.includes\(norm\(x\.situacao\)\) && cfg\.pode\('entregas\.criar'\)/);
  assert.match(ler('painel_inicial.html'), /Acesso\.pode\('entregas\.criar'\)/);
});

// ======================= migração =======================
function poolMigracao({ marcador, jaFeito = false, comChave = [], porPermissao = {}, excecoes = {}, chavePorExcecao = [] }) {
  return criarPoolFalso([
    [/FROM web_auditoria WHERE acao = \? LIMIT 1/, (sql, [m]) => (jaFeito && m === marcador ? [{ id: 9 }] : [])],
    [/WHERE permissao = 'administrativo\.ver' ORDER BY perfil_id/, comChave.map(id => ({ perfil_id: id }))],
    [/SELECT DISTINCT perfil_id FROM web_perfil_permissoes WHERE permissao = \?/, (sql, [p]) => (porPermissao[p] || []).map(id => ({ perfil_id: id }))],
    [/SELECT usuario_codigo, tipo FROM web_usuario_excecoes WHERE permissao = \?/, (sql, [p]) => excecoes[p] || []],
    [/SELECT DISTINCT x\.usuario_codigo FROM web_usuario_excecoes x/, chavePorExcecao.map(u => ({ usuario_codigo: u }))],
    [/INSERT IGNORE INTO web_(perfil_permissoes|usuario_excecoes)/, () => ({ affectedRows: 1 })],
    [/INSERT INTO web_auditoria/, () => ({ insertId: 1 })]
  ]);
}
const gravados = (p, tabela) => p.chamadas.filter(c => new RegExp(`INSERT IGNORE INTO ${tabela}`).test(c.sql)).map(c => c.params);

test('migração de entregas: quem tinha entregas.programar ganha cada ação nova; reagendar só o perfil administrativo', async () => {
  const p = poolMigracao({
    marcador: 'permissoes_entregas_acoes',
    comChave: [1, 2], // Administrador e Interno completo
    porPermissao: { 'entregas.programar': [1, 2, 6] }, // 6 = perfil de expedição sem a chave
    excecoes: { 'entregas.programar': [{ usuario_codigo: 30, tipo: 'liberar' }, { usuario_codigo: 31, tipo: 'bloquear' }] },
    chavePorExcecao: [40]
  });
  const r = await acrescentarPermissoesEntregasAcoes(p);
  assert.equal(r.feito, true);
  const acoes = REGRAS_ENTREGAS_ACOES[0].para;
  const porPerfil = id => gravados(p, 'web_perfil_permissoes').filter(x => x[0] === id).map(x => x[1]).sort();
  assert.deepEqual(porPerfil(1), [...acoes, 'entregas.reagendar'].sort());
  assert.deepEqual(porPerfil(2), [...acoes, 'entregas.reagendar'].sort());
  assert.deepEqual(porPerfil(6), [...acoes].sort(), 'perfil sem a chave não ganha reagendar');
  // exceções copiadas com o mesmo tipo (liberar continua liberando; bloquear continua bloqueando, inclusive o reagendar)
  const exc = gravados(p, 'web_usuario_excecoes');
  const doUsuario = u => exc.filter(x => x[0] === u).map(x => `${x[1]}:${x[2]}`).sort();
  assert.deepEqual(doUsuario(30), [...acoes, 'entregas.reagendar'].map(c => c + ':liberar').sort());
  assert.deepEqual(doUsuario(31), [...acoes, 'entregas.reagendar'].map(c => c + ':bloquear').sort());
  // chave liberada por exceção + perfil que programava: reagendar por exceção
  assert.deepEqual(doUsuario(40), ['entregas.reagendar:liberar']);
  const consulta = p.chamadas.find(c => /SELECT DISTINCT x\.usuario_codigo/.test(c.sql));
  assert.deepEqual(consulta.params, ['entregas.programar', 'entregas.programar']);
  // nada em tabela do VB; uma transação; auditoria com o detalhe
  assert.ok(!p.chamadas.some(c => /INSERT|UPDATE|DELETE|ALTER/i.test(c.sql) && !/web_(perfil_permissoes|usuario_excecoes|auditoria)/.test(c.sql)));
  assert.deepEqual(p.chamadas.filter(c => ['BEGIN', 'COMMIT', 'ROLLBACK'].includes(c.sql)).map(c => c.sql), ['BEGIN', 'COMMIT']);
  const aud = p.chamadas.find(c => /INSERT INTO web_auditoria/.test(c.sql));
  assert.equal(aud.params[1], 'permissoes_entregas_acoes');
  assert.deepEqual(JSON.parse(aud.params[3])['entregas.programar'].perfisChave, [1, 2]);
});

test('migração de pedidos: data de pronto para quem muda a situação; desconto para quem monta orçamento', async () => {
  const p = poolMigracao({
    marcador: 'permissoes_pedidos_acoes',
    porPermissao: { 'pedidos.situacao': [1, 9], 'orcamentos.criar': [1, 2, 3] },
    excecoes: { 'orcamentos.criar': [{ usuario_codigo: 12, tipo: 'bloquear' }] }
  });
  assert.equal((await acrescentarPermissoesPedidosAcoes(p)).feito, true);
  const pp = gravados(p, 'web_perfil_permissoes');
  assert.deepEqual(pp.filter(x => x[1] === 'pedidos.data_pronto').map(x => x[0]), [1, 9]);
  assert.deepEqual(pp.filter(x => x[1] === 'pedidos.desconto').map(x => x[0]), [1, 2, 3]);
  assert.deepEqual(gravados(p, 'web_usuario_excecoes'), [[12, 'pedidos.desconto', 'bloquear']]);
  assert.ok(!p.chamadas.some(c => /SELECT DISTINCT x\.usuario_codigo/.test(c.sql)), 'sem permissão administrativa nova: sem a consulta da chave');
  assert.deepEqual(REGRAS_PEDIDOS_ACOES.map(r => r.de), ['pedidos.situacao', 'orcamentos.criar']);
});

test('migração: roda uma vez só por marcador e desfaz tudo se algo falhar', async () => {
  const ja = poolMigracao({ marcador: 'permissoes_entregas_acoes', jaFeito: true });
  assert.deepEqual(await acrescentarPermissoesEntregasAcoes(ja), { feito: false });
  assert.ok(!ja.chamadas.some(c => /INSERT|BEGIN/.test(c.sql)));
  const falha = criarPoolFalso([
    [/FROM web_auditoria WHERE acao = \? LIMIT 1/, []],
    [/WHERE permissao = 'administrativo\.ver' ORDER BY perfil_id/, []],
    [/SELECT DISTINCT perfil_id FROM web_perfil_permissoes WHERE permissao = \?/, [{ perfil_id: 1 }]],
    [/INSERT IGNORE INTO web_perfil_permissoes/, () => { throw Object.assign(new Error('falhou'), { code: 'ER_X' }); }]
  ]);
  await assert.rejects(desdobrarPermissoes(falha, 'teste_falha', [{ de: 'a.b', para: ['a.c'] }]));
  assert.deepEqual(falha.chamadas.filter(c => ['BEGIN', 'COMMIT', 'ROLLBACK'].includes(c.sql)).map(c => c.sql), ['BEGIN', 'ROLLBACK']);
});

test('regras de migração só citam permissões do catálogo; as "soComChave" são administrativas', () => {
  for (const r of [...REGRAS_ENTREGAS_ACOES, ...REGRAS_PEDIDOS_ACOES]) {
    for (const c of [r.de, ...(r.para || []), ...(r.soComChave || [])]) assert.ok(CODIGOS.has(c), c);
    for (const c of r.soComChave || []) assert.ok(PERMISSOES_ADMINISTRATIVAS.includes(c), c);
  }
  const idx = ler('index.js');
  const iChave = idx.indexOf('await acrescentarPermissoesAdministrativo(pool)'), iAcoes = idx.indexOf('await acrescentarPermissoesEntregasAcoes(pool)');
  assert.ok(iChave > 0 && iAcoes > iChave, 'a migração por ação roda depois da chave administrativa');
  assert.ok(idx.includes('await acrescentarPermissoesPedidosAcoes(pool)'));
});
