// Agendas (tela): horário e grade de horários, lista única de categorias. Funções puras da parte comum e a fila da linha
// (tarefas.js / tarefas_admin.js) com API falsa; HTML e CSS lidos do disco.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const AG = require('../agenda_comum.js');
const T = require('../tarefas.js');
const A = require('../tarefas_admin.js');

const ler = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const H = (inicio, fim) => ({ inicio, fim });
function armazem() {
  const m = new Map();
  return { m, getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
}
function api(resposta = () => ({ ok: true })) {
  const chamadas = [];
  let id = 40;
  const estado = { falhar: null };
  async function chamar(caminho, { metodo = 'GET', corpo } = {}) {
    chamadas.push([metodo, caminho, corpo]);
    if (estado.falhar) { const e = estado.falhar; estado.falhar = null; throw e; }
    if (metodo === 'POST') return { id: ++id, ...corpo, feita: false, alarme: null, categoriaId: null, versao: 1, criadaPor: 'Ana', horario: corpo.horario ?? null };
    return resposta(metodo, caminho, corpo);
  }
  return { chamar, chamadas, estado };
}

test('parte comum: posição na grade (1h = 48px, sobrepostos dividem a largura), mesmo horário, quando há grade, corpo do mover', () => {
  assert.equal(AG.PX_HORA, 48);
  assert.deepEqual(AG.estiloGrade(H('09:30', '10:30')), { top: '456px', height: '48px', left: 'calc(0.0000% + 1px)', width: 'calc(100.0000% - 3px)', curto: false });
  assert.deepEqual(AG.estiloGrade(H('10:00', '10:15'), { col: 2, cols: 3 }), { top: '480px', height: '20px', left: 'calc(66.6667% + 1px)', width: 'calc(33.3333% - 3px)', curto: true });
  assert.equal(AG.mesmoHorario(null, undefined), true);
  assert.equal(AG.mesmoHorario(H('09:00', '10:00'), H('09:00', '10:00')), true);
  assert.equal(AG.mesmoHorario(H('09:00', '10:00'), null), false);
  assert.equal(AG.podeHorario({ id: 1, quadro: 'dia' }), true);
  assert.equal(AG.podeHorario({ id: 1, quadro: 'tarefas' }), false);
  assert.equal(AG.podeHorario({ id: null, quadro: 'dia' }), false);
  assert.equal(AG.querGrade(1200, false), true);
  assert.equal(AG.querGrade(879, false), false);
  assert.equal(AG.querGrade(1200, true), false, 'celular: lista por dia');
  assert.deepEqual(AG.corpoMover({ quadro: 'dia', data: '2026-11-24' }), { quadro: 'dia', data: '2026-11-24' }, 'sem horário no destino = mantém');
  assert.deepEqual(AG.corpoMover({ quadro: 'dia', data: '2026-11-24', horario: null }), { quadro: 'dia', data: '2026-11-24', horario: null });
  assert.deepEqual(AG.corpoMover({ quadro: 'dia', data: '2026-11-24', horario: H('08:00', '09:00') }), { quadro: 'dia', data: '2026-11-24', horario: H('08:00', '09:00') });
  assert.deepEqual(AG.corpoMover({ quadro: 'tarefas', horario: H('08:00', '09:00') }), { quadro: 'tarefas', data: null }, 'fora dos dias o servidor tira');
});

test('pessoal: item novo criado na grade manda o horário no POST; o rascunho guarda o horário até salvar e volta com ele', async () => {
  const a = api();
  const arm = armazem();
  const rascunhos = T.criarRascunhos(() => arm, 7);
  const l = T.criarLinha(a.chamar, { quadro: 'dia', data: '2026-11-24', texto: '', horario: H('09:30', '10:30') }, { rascunhos, chave: 'k1' });
  l.anotar('Fernanda');
  assert.deepEqual(rascunhos.ler().k1.horario, H('09:30', '10:30'), 'nada digitado se perde, nem o horário');
  // a resposta se perdeu: o rascunho fica; ao reabrir, a linha volta no mesmo horário
  a.estado.falhar = new Error('Sem conexão');
  await l.salvarTexto('Fernanda');
  assert.deepEqual(a.chamadas[0], ['POST', '/minha_semana', { quadro: 'dia', data: '2026-11-24', texto: 'Fernanda', horario: H('09:30', '10:30') }]);
  const entrada = rascunhos.ler().k1;
  assert.deepEqual(entrada.horario, H('09:30', '10:30'));
  const b = api();
  const volta = T.retomar(b.chamar, { chave: 'k1', entrada: { ...entrada, enviado: undefined }, base: null }, rascunhos);
  await volta.pronto;
  assert.deepEqual(b.chamadas[0][2].horario, H('09:30', '10:30'));
  assert.deepEqual(volta.linha.dados.horario, H('09:30', '10:30'));
  assert.equal(rascunhos.ler().k1, undefined, 'salvou: o rascunho some');
  // item de Tarefas não manda horário
  const c = api();
  await T.criarLinha(c.chamar, { quadro: 'tarefas', texto: '' }).salvarTexto('x');
  assert.equal('horario' in c.chamadas[0][2], false);
});

test('pessoal: mudar o horário é um PUT só do horário, pela fila; texto pendente impede; mover leva o horário da grade', async () => {
  const a = api((metodo, caminho, corpo) => ({ id: 5, quadro: corpo.quadro || 'dia', data: corpo.data || '2026-11-24', texto: 'Mãe chega', feita: false, alarme: null, categoriaId: null, horario: corpo.horario ?? null }));
  const l = T.criarLinha(a.chamar, { id: 5, quadro: 'dia', data: '2026-11-24', texto: 'Mãe chega' });
  let r = await l.mudarHorario(H('10:00', '11:00'));
  assert.deepEqual([r.ok, l.dados.horario], [true, H('10:00', '11:00')]);
  assert.deepEqual(a.chamadas.at(-1), ['PUT', '/minha_semana/5', { horario: H('10:00', '11:00') }]);
  r = await l.mudarHorario(null);
  assert.deepEqual([r.ok, l.dados.horario], [true, null]);
  l.anotar('Mãe chega cedo');   // digitado e ainda não salvo
  r = await l.mudarHorario(H('08:00', '09:00'));
  assert.equal(r.ok, false);
  assert.equal(a.chamadas.length, 2, 'nada enviado com texto pendente');
  l.anotar('Mãe chega');
  r = await l.mover({ quadro: 'dia', data: '2026-11-26', horario: H('14:00', '15:00') });
  assert.deepEqual(a.chamadas.at(-1), ['PUT', '/minha_semana/5', { quadro: 'dia', data: '2026-11-26', horario: H('14:00', '15:00') }]);
  assert.deepEqual([r.ok, l.dados.data, l.dados.horario], [true, '2026-11-26', H('14:00', '15:00')]);
  const t = T.criarLinha(a.chamar, { id: 6, quadro: 'tarefas', texto: 'x' });
  assert.equal((await t.mudarHorario(H('08:00', '09:00'))).ok, false, 'Tarefas não têm horário');
});

test('compartilhada: horário com a versão; 409 adota o atual (nada por cima); POST de item novo da grade leva o horário', async () => {
  const atual = { id: 5, quadro: 'dia', data: '2026-11-24', texto: 'Visita', feita: false, alarme: null, versao: 3, criadaPor: 'João', categoriaId: null, horario: H('11:00', '12:00') };
  let conflito = true;
  const a = api((metodo, caminho, corpo) => {
    if (conflito) { conflito = false; const e = new Error('Esta linha foi alterada por outra pessoa.'); e.status = 409; e.dados = { atual }; throw e; }
    return { ...atual, versao: atual.versao + 1, horario: corpo.horario };
  });
  const l = A.criarLinha(a.chamar, { id: 5, quadro: 'dia', data: '2026-11-24', texto: 'Visita', versao: 2, criadaPor: 'João', horario: H('09:00', '10:00') });
  let r = await l.mudarHorario(H('15:00', '16:00'));
  assert.deepEqual(a.chamadas[0], ['PUT', '/semana_admin/5', { horario: H('15:00', '16:00'), versao: 2 }]);
  assert.deepEqual([r.ok, r.conflito, l.dados.horario, l.dados.versao], [false, true, H('11:00', '12:00'), 3]);
  r = await l.mudarHorario(H('15:00', '16:00'));
  assert.deepEqual(a.chamadas[1][2], { horario: H('15:00', '16:00'), versao: 3 });
  assert.deepEqual([r.ok, l.dados.horario, l.dados.versao], [true, H('15:00', '16:00'), 4]);
  const n = api();
  const nova = A.criarLinha(n.chamar, { quadro: 'dia', data: '2026-11-24', texto: '', horario: H('07:00', '08:00') });
  await nova.salvarTexto('Abrir a loja');
  assert.deepEqual(n.chamadas[0][2], { quadro: 'dia', data: '2026-11-24', texto: 'Abrir a loja', horario: H('07:00', '08:00') });
  assert.deepEqual(nova.dados.horario, H('07:00', '08:00'));
});

test('telas: botão Categorias só para quem gere a lista única; "Horário…" no menu; confirmação de excluir fala das duas agendas; grade no tema', () => {
  for (const f of ['tarefas.html', 'tarefas_admin.html']) {
    const h = ler(f);
    assert.match(h, /id="btn-categorias" data-perm="tarefas_admin\.usar"/, f);
    assert.ok(h.indexOf('calculo/agenda_horario.js?v=') > 0 && h.indexOf('calculo/agenda_horario.js?v=') < h.indexOf('agenda_comum.js?v='), f + ': horário antes da parte comum');
  }
  const ag = ler('agenda_comum.js');
  assert.match(ag, /'Horário…'/);
  assert.match(ag, /sai da lista das duas agendas[^`]*Minha semana de todos e na Semana compartilhada[^`]*Nenhum item é apagado/);
  for (const js of ['tarefas.js', 'tarefas_admin.js']) {
    const s = ler(js);
    assert.match(s, /aoCategorias: podeGerir\(\) \? abrirCategorias : null/, js);
    assert.match(s, /aoHorario: AG\.podeHorario/, js);
    assert.match(s, /ligarRedimensionar/, js);
    assert.doesNotMatch(s, /innerHTML/, js);
  }
  const css = ler('tema.css');
  for (const sel of ['.agenda.ag-com-grade', '.agenda .ag-grade', '.agenda .ag-col', '.agenda .ag-agora', '.ag-sombra', '.agenda .ag-hora', '.ag-puxar'])
    assert.ok(css.includes(sel), sel);
  assert.match(css, /height: calc\(24 \* 48px\)/, 'a mesma hora de 48px do AG.PX_HORA');
});
