// Tela da equipe (entregas.html + entregas.js): lógica pura (node:test) e conferência do HTML/layout estáticos.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const E = require('../entregas.js');

const ler = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const ent = (id, status, extra = {}) => ({ id, numero: 100 + id, status, tipo: null, cliente: 'C' + id, cidade: '', uf: '', dataPrometida: null, dataAgendada: null, motorista: null, qtdOcorrencias: 0, ...extra });

test('esc: escapa HTML e aceita vazio', () => {
  assert.equal(E.esc('<img src=x onerror="a()">&\''), '&lt;img src=x onerror=&quot;a()&quot;&gt;&amp;&#39;');
  assert.equal(E.esc(null), '');
  assert.equal(E.esc(5), '5');
});

test('dataBR: AAAA-MM-DD vira dd/mm/aaaa; inválido vira vazio', () => {
  assert.equal(E.dataBR('2026-10-26'), '26/10/2026');
  assert.equal(E.dataBR('2026-10-26 10:00:00'), '26/10/2026');
  assert.equal(E.dataBR(null), '');
  assert.equal(E.dataBR('lixo'), '');
});

test('dataHoraBR e rotuloEvento', () => {
  assert.equal(E.dataHoraBR('2026-10-26 14:05:09'), '26/10/2026 14:05');
  assert.equal(E.dataHoraBR(''), '');
  assert.equal(E.rotuloEvento('reagendada'), 'Reagendada');
  assert.equal(E.rotuloEvento('novo_tipo'), 'novo_tipo');
});

test('acoesDisponiveis: espelha as transições do servidor', () => {
  const a = (status, tipo = null) => E.acoesDisponiveis({ status, tipo });
  assert.deepEqual(a('a_programar'), ['agendar', 'cancelar']);
  assert.deepEqual(a('agendada', 'motorista'), ['reagendar', 'cancelar']);
  assert.deepEqual(a('agendada', 'retirada'), ['reagendar', 'retirada', 'cancelar']);
  assert.deepEqual(a('agendada', 'outro_estado'), ['reagendar', 'enviada', 'cancelar']);
  assert.deepEqual(a('enviada', 'outro_estado'), ['comprovante']);
  assert.deepEqual(a('ocorrencia', 'motorista'), ['reagendar', 'cancelar']);
  assert.deepEqual(a('em_rota', 'motorista'), ['reagendar', 'cancelar']);
  for (const s of ['entregue', 'retirado', 'cancelada']) assert.deepEqual(a(s, 'motorista'), []);
  assert.deepEqual(E.acoesDisponiveis(null), []);
});

test('rótulos e cores de status e tipo', () => {
  assert.equal(E.rotuloStatus('a_programar'), 'A programar');
  assert.equal(E.rotuloStatus('em_rota'), 'Em rota');
  assert.equal(E.rotuloStatus('ocorrencia'), 'Ocorrência');
  assert.equal(E.rotuloStatus('xyz'), 'xyz');
  assert.equal(E.rotuloTipo('outro_estado'), 'Entrega em outro estado');
  assert.equal(E.rotuloTipo('motorista'), 'Entrega');
  assert.equal(E.rotuloTipo(null), '—');
  for (const s of ['a_programar', 'agendada', 'em_rota', 'ocorrencia', 'entregue', 'retirado', 'enviada', 'cancelada']) assert.match(E.corStatus(s), /^[a-z]+$/);
  assert.equal(E.corStatus('inexistente'), 'neutro');
});

test('filtrarAba: fila, agenda (ordenada por data), em rota, concluídas e ocorrências', () => {
  const l = [ent(1, 'a_programar'), ent(2, 'agendada', { dataAgendada: '2026-10-30' }), ent(3, 'agendada', { dataAgendada: '2026-10-28' }),
    ent(4, 'em_rota'), ent(5, 'entregue'), ent(6, 'retirado'), ent(7, 'cancelada'), ent(8, 'ocorrencia'), ent(9, 'enviada')];
  const ids = a => E.filtrarAba(l, a).map(e => e.id);
  assert.deepEqual(ids('fila'), [1]);
  assert.deepEqual(ids('agenda'), [3, 2]);
  assert.deepEqual(ids('em_rota'), [4, 9]);
  assert.deepEqual(ids('concluidas'), [5, 6, 7]);
  assert.deepEqual(ids('ocorrencias'), [8]);
  assert.deepEqual(E.filtrarAba(l, 'nada'), []);
  assert.deepEqual(E.filtrarAba(null, 'fila'), []);
});

test('contadores: fila e ocorrências', () => {
  const l = [ent(1, 'a_programar'), ent(2, 'a_programar'), ent(3, 'ocorrencia'), ent(4, 'entregue')];
  assert.deepEqual(E.contadores(l), { fila: 2, ocorrencias: 1 });
});

test('agruparAgenda: por dia e, dentro do dia, por motorista', () => {
  const l = [
    ent(1, 'agendada', { dataAgendada: '2026-10-29', tipo: 'motorista', motorista: 'Zé' }),
    ent(2, 'agendada', { dataAgendada: '2026-10-28', tipo: 'motorista', motorista: 'Zé' }),
    ent(3, 'agendada', { dataAgendada: '2026-10-28', tipo: 'motorista', motorista: 'Ana' }),
    ent(4, 'agendada', { dataAgendada: '2026-10-28', tipo: 'retirada' }),
    ent(5, 'agendada', { dataAgendada: '2026-10-28', tipo: 'motorista', motorista: 'Zé' })
  ];
  const g = E.agruparAgenda(l);
  assert.deepEqual(g.map(d => d.dia), ['2026-10-28', '2026-10-29']);
  assert.deepEqual(g[0].grupos.map(m => m.nome), ['Ana', 'Retirado pelo cliente', 'Zé']);
  assert.deepEqual(g[0].grupos.find(m => m.nome === 'Zé').entregas.map(e => e.id), [2, 5]);
  assert.deepEqual(E.agruparAgenda([]), []);
});

const base = { tipo: 'motorista', dataAgendada: '2026-10-28', motoristaCodigo: '7', rua: '', numero: '', bairro: '', cidade: '', uf: '', cep: '', ref: '', contatoLocal: '', observacao: '', transportadora: '', rastreio: '', previsao: '' };

test('dataValida: formato e calendário', () => {
  assert.equal(E.dataValida('2026-02-28'), true);
  assert.equal(E.dataValida('2026-02-30'), false);
  assert.equal(E.dataValida('28/10/2026'), false);
  assert.equal(E.dataValida(''), false);
});

test('validarAgendamento: tipo, data, motorista e UF', () => {
  assert.deepEqual(E.validarAgendamento(base), []);
  assert.match(E.validarAgendamento({ ...base, tipo: '' })[0], /tipo/i);
  assert.match(E.validarAgendamento({ ...base, tipo: 'voando' })[0], /tipo/i);
  assert.match(E.validarAgendamento({ ...base, dataAgendada: '2026-13-01' })[0], /data/i);
  assert.match(E.validarAgendamento({ ...base, motoristaCodigo: '' })[0], /motorista/i);
  assert.deepEqual(E.validarAgendamento({ ...base, tipo: 'retirada', motoristaCodigo: '' }), []);
  assert.match(E.validarAgendamento({ ...base, rua: 'Rua A', uf: 'R' })[0], /UF/);
  assert.match(E.validarAgendamento({ ...base, rua: 'Rua A', uf: 'RJX' })[0], /UF/);
  assert.deepEqual(E.validarAgendamento({ ...base, rua: 'Rua A', uf: 'rj' }), []);
  assert.deepEqual(E.validarAgendamento({ ...base, uf: '' }), []);
  assert.match(E.validarAgendamento({ ...base, tipo: 'outro_estado', previsao: '31/12/2026' })[0], /previs/i);
  assert.deepEqual(E.validarAgendamento({ ...base, tipo: 'outro_estado', previsao: '2026-12-31' }), []);
});

test('corpoAgendar / corpoReagendar: só o que vale para o tipo', () => {
  assert.deepEqual(E.corpoAgendar(base), { tipo: 'motorista', dataAgendada: '2026-10-28', motoristaCodigo: 7 });
  const completo = { ...base, rua: ' Rua A ', numero: '10', cidade: 'Rio', uf: 'rj', contatoLocal: 'Maria', observacao: 'portão azul' };
  assert.deepEqual(E.corpoAgendar(completo), { tipo: 'motorista', dataAgendada: '2026-10-28', motoristaCodigo: 7,
    endereco: { rua: 'Rua A', numero: '10', bairro: '', cidade: 'Rio', uf: 'RJ', cep: '', ref: '' }, contatoLocal: 'Maria', observacao: 'portão azul' });
  assert.deepEqual(E.corpoAgendar({ ...base, tipo: 'retirada', rua: 'Rua A', motoristaCodigo: '7', observacao: 'x' }),
    { tipo: 'retirada', dataAgendada: '2026-10-28', observacao: 'x' });
  assert.deepEqual(E.corpoAgendar({ ...base, tipo: 'outro_estado', motoristaCodigo: '', transportadora: 'TNT', rastreio: 'AB1', previsao: '2026-11-05' }),
    { tipo: 'outro_estado', dataAgendada: '2026-10-28', transportadora: 'TNT', rastreio: 'AB1', previsao: '2026-11-05' });
  assert.deepEqual(E.corpoReagendar(base), E.corpoAgendar(base));
});

test('enderecoDoCliente: preenche o formulário a partir de clienteEndereco, sem inventar campos', () => {
  assert.deepEqual(E.enderecoDoCliente({ rua: 'R', numero: '1', bairro: 'B', cidade: 'C', uf: 'SP', cep: '123', telefone: '999' }),
    { rua: 'R', numero: '1', bairro: 'B', cidade: 'C', uf: 'SP', cep: '123' });
  assert.deepEqual(E.enderecoDoCliente(null), { rua: '', numero: '', bairro: '', cidade: '', uf: '', cep: '' });
});

test('validações das baixas: retirada, enviada, comprovante, cancelamento', () => {
  assert.match(E.validarRetirada({ entregueA: ' ' }), /quem/i);
  assert.equal(E.validarRetirada({ entregueA: 'João' }), null);
  assert.match(E.validarEnviada({ transportadora: '' }), /transportadora/i);
  assert.equal(E.validarEnviada({ transportadora: 'TNT' }), null);
  assert.match(E.validarComprovante({ temFoto: false }), /foto/i);
  assert.equal(E.validarComprovante({ temFoto: true }), null);
  assert.match(E.validarCancelamento('ab'), /motivo/i);
  assert.equal(E.validarCancelamento('cliente desistiu'), null);
});

test('escalaImagem: limita o maior lado sem ampliar', () => {
  assert.deepEqual(E.escalaImagem(4000, 3000, 1600), { largura: 1600, altura: 1200 });
  assert.deepEqual(E.escalaImagem(800, 600, 1600), { largura: 800, altura: 600 });
  assert.deepEqual(E.escalaImagem(1000, 3000, 1500), { largura: 500, altura: 1500 });
});

test('entregas.html: viewport, CSP, abas, permissões e sem handlers inline', () => {
  const h = ler('entregas.html');
  assert.match(h, /<meta name="viewport"/);
  assert.match(h, /Content-Security-Policy/);
  assert.match(h, /<script src="entregas\.js[^"]*" defer>/);
  assert.match(h, /<script src="layout\.js[^"]*" defer>/);
  for (const aba of ['fila', 'agenda', 'em_rota', 'concluidas', 'ocorrencias']) assert.match(h, new RegExp(`data-aba="${aba}"`));
  for (const id of ['btn-agendar', 'btn-cancelar', 'btn-reagendar', 'btn-comprovante', 'btn-retirada', 'btn-enviada']) {
    assert.match(h, new RegExp(`id="${id}"[^>]*data-perm="entregas\\.programar"`), id);
  }
  assert.doesNotMatch(h, /\son(click|change|submit|input|load)=/i);
  assert.doesNotMatch(h, /R\$|valor|preço/i);
});

test('layout.js: Entregas no menu (após Clientes), em PAGINAS e com ícone', () => {
  const l = ler('layout.js');
  assert.match(l, /clientes\.html', texto: 'Clientes', icone: 'clientes' \},\s*\{ href: 'entregas\.html', texto: 'Entregas', icone: 'entregas' \}/);
  assert.match(l, /'entregas\.html': \['entregas\.ver'\]/);
  assert.match(l, /\n\s+entregas: ic\(/);
});

test('montarMes: semanas de domingo a sábado cobrindo o mês, entregas no dia certo, canceladas fora', () => {
  const l = [
    ent(1, 'agendada', { dataAgendada: '2026-10-28' }), ent(2, 'em_rota', { dataAgendada: '2026-10-28' }),
    ent(3, 'cancelada', { dataAgendada: '2026-10-28' }), ent(4, 'a_programar'), ent(5, 'ocorrencia', { dataAgendada: '2026-10-01 08:00:00' })
  ];
  const sem = E.montarMes(l, 2026, 9, '2026-10-27');
  assert.ok(sem.every(s => s.length === 7));
  assert.equal(sem.length, 5); // 27/09 a 31/10
  assert.equal(sem[0][0].dia, '2026-09-27');
  assert.equal(sem[0][0].doMes, false);
  assert.equal(sem[4][6].dia, '2026-10-31');
  const dia = d => sem.flat().find(c => c.dia === d);
  assert.deepEqual(dia('2026-10-28').entregas.map(e => e.id), [1, 2]);
  assert.deepEqual(dia('2026-10-01').entregas.map(e => e.id), [5]);
  assert.equal(dia('2026-10-27').hoje, true);
  assert.equal(sem.flat().filter(c => c.hoje).length, 1);
  assert.equal(sem.flat().reduce((n, c) => n + c.entregas.length, 0), 3);
});

test('montarMes: mês que termina no sábado não ganha semana extra; lista inválida não quebra', () => {
  const sem = E.montarMes(null, 2026, 6, ''); // julho/2026 termina numa sexta
  assert.ok(sem.every(s => s.length === 7));
  assert.equal(sem.flat().filter(c => c.doMes).length, 31);
  const fev = E.montarMes([], 2026, 1, ''); // fev/2026: 1º é domingo, 28 dias = 4 semanas
  assert.equal(fev.length, 4);
});

test('entregas.html: estilos do calendário da agenda', () => {
  const h = ler('entregas.html');
  assert.match(h, /\.cal-linha/);
  assert.match(h, /\.etiqueta/);
});
