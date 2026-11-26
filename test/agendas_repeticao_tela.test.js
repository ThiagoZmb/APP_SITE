// Agendas (tela): repetição de itens. Fila da linha (tarefas.js / tarefas_admin.js), pergunta de escopo, rascunho e visual.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const AG = require('../agenda_comum.js');
const T = require('../tarefas.js');
const A = require('../tarefas_admin.js');

const ler = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const tique = () => new Promise(r => setImmediate(r));
function armazem() {
  const m = new Map();
  return { m, getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
}
const SERIE = 'a'.repeat(32);

// API falsa da Minha semana: responde como o servidor (PUT devolve a linha + serie quando há escopo)
function apiPessoal() {
  const chamadas = [];
  const estado = { falhar: 0, status: undefined, dados: undefined, preso: null };
  let id = 10;
  async function chamar(caminho, { metodo = 'GET', corpo } = {}) {
    chamadas.push([metodo, caminho, corpo]);
    if (estado.preso) { const p = estado.preso; estado.preso = null; await p; }
    if (estado.falhar > 0) { estado.falhar--; const e = new Error('Sem conexão. Tente de novo.'); e.status = estado.status; e.dados = estado.dados; throw e; }
    const num = Number(caminho.split('?')[0].split('/')[2]);
    if (metodo === 'POST' && /\/repetir$/.test(caminho)) return { linha: { id: num, quadro: 'dia', data: '2026-12-01', texto: 'x', serieId: SERIE, seriePos: 1 }, linhas: [{ id: num, quadro: 'dia', data: '2026-12-01', serieId: SERIE, seriePos: 1 }, { id: 99, quadro: 'dia', data: '2026-12-02', serieId: SERIE, seriePos: 2 }], qtd: 2 };
    if (metodo === 'POST') return { id: ++id, ...corpo, feita: false, alarme: null, categoriaId: null, serieId: null };
    if (metodo === 'PUT' && corpo.escopo) return { id: num, texto: corpo.texto, serie: { escopo: corpo.escopo, alteradas: [{ id: num }, { id: 99 }], diferentes: 0 } };
    if (metodo === 'DELETE' && caminho.includes('escopo=')) return { ok: true, serie: { escopo: 'todos', apagadas: [num, 99], concluidas: 1, diferentes: 0 } };
    return { ok: true };
  }
  const segurar = () => { let soltar; estado.preso = new Promise(r => { soltar = r; }); return soltar; };
  return { chamar, chamadas, estado, segurar };
}
const daSerie = (api, extra = {}, opcoes = {}) => T.criarLinha(api.chamar, { id: 5, quadro: 'dia', data: '2026-12-01', texto: 'Ponto', feita: false, serieId: SERIE, seriePos: 1, ...extra }, opcoes);

// ---------- funções puras da parte comum ----------
test('pergunta de escopo só em item de série cujo texto mudou de verdade; "Repetir..." só em item salvo de dia/Tarefas fora de série', () => {
  const d = { id: 5, texto: 'Ponto', serieId: SERIE };
  assert.equal(AG.precisaEscopo(d, 'Ponto'), false, 'nada mudou');
  assert.equal(AG.precisaEscopo(d, '  Ponto \n'), false, 'só espaço e quebra');
  assert.equal(AG.precisaEscopo(d, 'Ponto 2'), true);
  assert.equal(AG.precisaEscopo(d, ''), true, 'apagar');
  assert.equal(AG.precisaEscopo({ ...d, serieId: null }, 'outro'), false, 'fora de série');
  assert.equal(AG.precisaEscopo({ ...d, id: null }, 'outro'), false);
  assert.equal(AG.podeRepetir({ id: 1, quadro: 'dia' }), true);
  assert.equal(AG.podeRepetir({ id: 1, quadro: 'tarefas' }), true);
  assert.equal(AG.podeRepetir({ id: 1, quadro: 'notas' }), false);
  assert.equal(AG.podeRepetir({ id: 1, quadro: 'dia', serieId: SERIE }), false, 'série não se repete de novo');
  assert.equal(AG.podeRepetir({ id: null, quadro: 'dia' }), false);
  assert.equal(AG.resumoSerie({ alteradas: [1, 2, 3], diferentes: 1 }), 'Mudou em 3 itens da série. 1 item ficou como estava, porque alguém o deixou diferente.');
  assert.equal(AG.resumoSerie({ apagadas: [1], concluidas: 2 }), 'Apagado 1 item da série. 2 itens já concluídos ficaram.');
});

// ---------- Minha semana: a fila da linha ----------
test('pessoal: texto com escopo vai num PUT com o escopo; o resto da série chega à tela por aoSerie; a escolha não se repete', async () => {
  const api = apiPessoal();
  const vistos = [];
  const l = daSerie(api, {}, { aoSerie: (serie, id) => vistos.push([serie.escopo, id, serie.alteradas.length]) });
  assert.equal(l.escolha, null);
  await l.salvarTexto('Ponto eletrônico', 'todos');
  assert.deepEqual(api.chamadas, [['PUT', '/minha_semana/5', { texto: 'Ponto eletrônico', escopo: 'todos' }]]);
  assert.deepEqual(vistos, [['todos', 5, 2]]);
  assert.deepEqual([l.dados.texto, l.escolha, l.pendente()], ['Ponto eletrônico', null, false]);
  // "só este" = PUT de sempre, sem escopo
  await l.salvarTexto('Ponto às 8', 'este');
  assert.deepEqual(api.chamadas[1], ['PUT', '/minha_semana/5', { texto: 'Ponto às 8' }]);
});

test('pessoal: falhou a gravação em série: a escolha fica guardada (Enter tenta de novo sem perguntar) e vai junto no rascunho', async () => {
  const api = apiPessoal();
  const st = armazem();
  const rascunhos = T.criarRascunhos(() => st, 7);
  const l = daSerie(api, {}, { rascunhos, chave: 'k1' });
  api.estado.falhar = 1;
  await l.salvarTexto('Novo', 'proximos');
  assert.deepEqual([l.erro, l.escolha], [true, { texto: 'Novo', escopo: 'proximos' }]);
  assert.equal(JSON.parse(st.getItem('minha_semana_rascunho:7')).k1.escopo, 'proximos');
  await l.salvarTexto('Novo');   // a tela chama sem escopo: vale a escolha já feita para este texto
  assert.deepEqual(api.chamadas.at(-1), ['PUT', '/minha_semana/5', { texto: 'Novo', escopo: 'proximos' }]);
  assert.equal(st.getItem('minha_semana_rascunho:7'), null, 'salvou: some do navegador');
});

test('pessoal: texto e caixinha juntos com escopo = dois PUTs (a série só leva o texto); apagar em série usa ?escopo=', async () => {
  const api = apiPessoal();
  const l = daSerie(api);
  l.anotar('Ponto 2', true);
  const a = l.salvarTexto('Ponto 2', 'todos');
  const b = l.marcar(true);
  await Promise.all([a, b]);
  assert.deepEqual(api.chamadas, [['PUT', '/minha_semana/5', { texto: 'Ponto 2', escopo: 'todos' }], ['PUT', '/minha_semana/5', { feita: true }]]);
  const vistos = [];
  const m = daSerie(api, { id: 6 }, { aoSerie: s => vistos.push(s.apagadas) });
  await m.salvarTexto('', 'todos');
  assert.deepEqual(api.chamadas.at(-1), ['DELETE', '/minha_semana/6?escopo=todos', undefined]);
  assert.deepEqual([m.dados.id, vistos], [null, [[6, 99]]]);
});

test('pessoal: categoria em série leva o escopo; repetir entra na fila depois do POST e recusa texto pendente', async () => {
  const api = apiPessoal();
  const vistos = [];
  const l = daSerie(api, {}, { aoSerie: s => vistos.push(s.escopo) });
  const r = await l.colorir(3, 'proximos');
  assert.deepEqual(api.chamadas[0], ['PUT', '/minha_semana/5', { categoriaId: 3, escopo: 'proximos' }]);
  assert.deepEqual([r.ok, l.dados.categoriaId, vistos], [true, 3, ['proximos']]);
  // repetir: um POST da linha nova, depois o POST de repetir no id devolvido
  const api2 = apiPessoal();
  const n = T.criarLinha(api2.chamar, { quadro: 'dia', data: '2026-11-30', texto: '', feita: false });
  const soltar = api2.segurar();
  const a = n.salvarTexto('Backup');
  const b = n.repetir({ tipo: 'diaria', de: '2026-12-01', ate: '2026-12-02', pularFimDeSemana: false });
  await tique();
  assert.equal(api2.chamadas.length, 1);
  soltar();
  const [, rb] = await Promise.all([a, b]);
  assert.deepEqual(api2.chamadas.map(c => [c[0], c[1]]), [['POST', '/minha_semana'], ['POST', '/minha_semana/11/repetir']]);
  assert.deepEqual([rb.ok, rb.resposta.qtd, n.dados.serieId, n.dados.data], [true, 2, SERIE, '2026-12-01']);
  // texto digitado e não salvo: não repete, nada enviado
  const p = T.criarLinha(api2.chamar, { id: 8, quadro: 'dia', data: '2026-11-30', texto: 'x', feita: false });
  p.anotar('x mudado');
  const antes = api2.chamadas.length;
  assert.equal((await p.repetir({ tipo: 'mensal', dia: 5, meses: 2 })).ok, false);
  assert.equal(api2.chamadas.length, antes);
  // já em série (409 do servidor): devolve jaEmSerie
  const q = T.criarLinha(api2.chamar, { id: 9, quadro: 'dia', data: '2026-11-30', texto: 'x', feita: false });
  Object.assign(api2.estado, { falhar: 1, status: 409, dados: { jaEmSerie: true } });
  const r9 = await q.repetir({ tipo: 'mensal', dia: 5, meses: 2 });
  assert.deepEqual([r9.ok, r9.jaEmSerie], [false, true]);
});

test('pessoal: rascunho de item de série sem escolha volta para a tela pedindo a escolha (nada é gravado sozinho)', async () => {
  const api = apiPessoal();
  const st = armazem();
  const rascunhos = T.criarRascunhos(() => st, 7);
  const base = { id: 5, quadro: 'dia', data: '2026-12-01', texto: 'Ponto', feita: false, serieId: SERIE, seriePos: 1 };
  const semEscolha = T.retomar(api.chamar, { chave: 'k', entrada: { id: 5, quadro: 'dia', data: '2026-12-01', texto: 'Ponto mudado', feita: false }, base }, rascunhos);
  await semEscolha.pronto;
  assert.deepEqual([semEscolha.decidir, api.chamadas.length], [true, 0]);
  assert.equal(JSON.parse(st.getItem('minha_semana_rascunho:7')).k.texto, 'Ponto mudado', 'o texto continua guardado');
  const comEscolha = T.retomar(api.chamar, { chave: 'k2', entrada: { id: 5, quadro: 'dia', data: '2026-12-01', texto: 'Ponto mudado', feita: false, escopo: 'todos' }, base }, rascunhos);
  await comEscolha.pronto;
  assert.deepEqual([comEscolha.decidir, api.chamadas[0]], [false, ['PUT', '/minha_semana/5', { texto: 'Ponto mudado', escopo: 'todos' }]]);
  // fora de série: retoma como sempre
  const fora = T.retomar(api.chamar, { chave: 'k3', entrada: { id: 6, quadro: 'dia', data: '2026-12-01', texto: 'b', feita: false }, base: { ...base, id: 6, serieId: null, texto: 'a' } }, rascunhos);
  await fora.pronto;
  assert.equal(fora.decidir, false);
});

test('pessoal: mover para Notas tira a linha da série também na tela', async () => {
  const api = apiPessoal();
  api.chamar = (orig => async (c, o) => (o?.metodo === 'PUT' && o.corpo.quadro ? { id: 5, quadro: o.corpo.quadro, data: null, texto: 'Ponto', feita: false, alarme: null, categoriaId: null, serieId: null } : orig(c, o)))(api.chamar);
  const l = daSerie(api);
  const r = await l.mover({ quadro: 'notas' });
  assert.deepEqual([r.ok, l.dados.serieId], [true, null]);
});

// ---------- Semana compartilhada ----------
function servidorAdmin() {
  const linhas = [1, 2, 3].map(id => ({ id, quadro: 'dia', data: `2026-12-0${id}`, texto: 'Ponto', feita: false, alarme: null, versao: 1, criadaPor: 'Ana', feitaPor: null, categoriaId: null, serieId: SERIE, seriePos: id }));
  const chamadas = [];
  const erro = (status, dados) => { const e = new Error('x'); e.status = status; e.dados = dados; return e; };
  async function chamar(caminho, { metodo = 'GET', corpo } = {}) {
    chamadas.push([metodo, caminho, corpo]);
    const id = Number(caminho.split('/')[2]);
    const l = linhas.find(x => x.id === id);
    if (!l) throw erro(404, { error: 'Tarefa não encontrada.' });
    if (l.versao !== corpo.versao) throw erro(409, { error: 'Alterada.', atual: { ...l } });
    if (metodo === 'POST') {
      if (l.serieId) throw erro(409, { error: 'Este item já se repete.', jaEmSerie: true, atual: { ...l } });
      Object.assign(l, { serieId: SERIE, seriePos: 1, versao: l.versao + 1 });
      return { linha: { ...l }, linhas: [{ ...l }], qtd: 1 };
    }
    if (metodo === 'DELETE') return { ok: true, ...(corpo.escopo ? { serie: { escopo: corpo.escopo, apagadas: [id], concluidas: 0, diferentes: 1 } } : {}) };
    const { versao, escopo, ...mudanca } = corpo;
    Object.assign(l, mudanca, { versao: versao + 1 });
    return { ...l, ...(escopo ? { serie: { escopo, alteradas: [{ ...l }], diferentes: 1 } } : {}) };
  }
  return { linhas, chamadas, chamar };
}

test('compartilhada: texto com escopo leva a versão; 409 = conflito como sempre (nada gravado por cima); apagar em série leva o escopo no corpo', async () => {
  const s = servidorAdmin();
  const vistos = [];
  const l = A.criarLinha(s.chamar, { ...s.linhas[0] }, { aoSerie: (serie, id) => vistos.push([serie.escopo, id, serie.diferentes]) });
  await l.salvarTexto('Ponto 2', 'todos');
  assert.deepEqual(s.chamadas[0], ['PUT', '/semana_admin/1', { texto: 'Ponto 2', escopo: 'todos', versao: 1 }]);
  assert.deepEqual([l.dados.versao, l.escolha, vistos], [2, null, [['todos', 1, 1]]]);
  // outra pessoa mudou o 2 antes: 409, nada por cima, a escolha fica para o "Manter o meu"
  const m = A.criarLinha(s.chamar, { ...s.linhas[1] });
  s.linhas[1].versao = 5; s.linhas[1].texto = 'Ponto (João)';
  await m.salvarTexto('Ponto 3', 'proximos');
  assert.ok(m.conflito, 'conflito');
  assert.equal(s.linhas[1].texto, 'Ponto (João)');
  assert.deepEqual(m.escolha, { texto: 'Ponto 3', escopo: 'proximos' });
  const n = A.criarLinha(s.chamar, { ...s.linhas[2] }, { aoSerie: serie => vistos.push(['apagou', serie.apagadas]) });
  await n.salvarTexto('', 'todos');
  assert.deepEqual(s.chamadas.at(-1), ['DELETE', '/semana_admin/3', { versao: 1, escopo: 'todos' }]);
  assert.deepEqual(vistos.at(-1), ['apagou', [3]]);
});

test('compartilhada: repetir leva a versão; já em série = 409 adota o atual; categoria em série leva o escopo', async () => {
  const s = servidorAdmin();
  s.linhas[0].serieId = null;
  const l = A.criarLinha(s.chamar, { ...s.linhas[0] });
  const r = await l.repetir({ tipo: 'diaria', de: '2026-12-01', ate: '2026-12-03', pularFimDeSemana: false });
  assert.deepEqual(s.chamadas[0], ['POST', '/semana_admin/1/repetir', { tipo: 'diaria', de: '2026-12-01', ate: '2026-12-03', pularFimDeSemana: false, versao: 1 }]);
  assert.deepEqual([r.ok, l.dados.serieId, l.dados.versao], [true, SERIE, 2]);
  const velha = A.criarLinha(s.chamar, { ...s.linhas[0], serieId: null, versao: 2 });
  const r2 = await velha.repetir({ tipo: 'mensal', dia: 1, meses: 2 });
  assert.deepEqual([r2.ok, r2.jaEmSerie, velha.dados.serieId], [false, true, SERIE], 'adota o atual (já em série)');
  const c = A.criarLinha(s.chamar, { ...s.linhas[1] });
  await c.colorir(4, 'todos');
  assert.deepEqual(s.chamadas.at(-1), ['PUT', '/semana_admin/2', { categoriaId: 4, escopo: 'todos', versao: 1 }]);
});

test('compartilhada: rascunho de série sem escolha não é enviado sozinho; com escolha vai com o escopo', async () => {
  const s = servidorAdmin();
  const st = armazem();
  const rascunhos = A.criarRascunhos(() => st, 7);
  const base = { ...s.linhas[0] };
  const entrada = { id: 1, quadro: 'dia', data: '2026-12-01', texto: 'Mudado', feita: false, alarme: null, versao: 1, base: { texto: 'Ponto', feita: false, alarme: null } };
  const sem = A.retomar(s.chamar, { chave: 'k', entrada, base }, rascunhos);
  await sem.pronto;
  assert.deepEqual([sem.decidir, s.chamadas.length], [true, 0]);
  const com = A.retomar(s.chamar, { chave: 'k2', entrada: { ...entrada, escopo: 'todos' }, base }, rascunhos);
  await com.pronto;
  assert.deepEqual(s.chamadas[0], ['PUT', '/semana_admin/1', { texto: 'Mudado', escopo: 'todos', versao: 1 }]);
});

// ---------- telas: pergunta, ↻, menu e visual ----------
test('telas: pergunta só no Enter/saída da linha (nunca a cada tecla), Cancelar guarda o texto, ↻ com texto acessível, Repetir no menu', () => {
  for (const f of ['tarefas.js', 'tarefas_admin.js']) {
    const js = ler(f);
    assert.match(js, /AG\.precisaEscopo\(/, f);
    assert.match(js, /ui\.perguntarEscopo\(/, f);
    assert.match(js, /ui\.abrirRepetir\(/, f);
    assert.match(js, /aoRepetir: AG\.podeRepetir\(/, f);
    assert.match(js, /'ag-serie', '↻'\)/, f);
    assert.match(js, /setAttribute\('aria-label', 'Item que se repete'\)/, f);
    // o evento 'input' (cada tecla) não chama a pergunta
    const noInput = /input\.addEventListener\('input', \(\) => \{([\s\S]*?)\n {6}\}\);/.exec(js)[1];
    assert.doesNotMatch(noInput, /perguntar|salvar\(/, f + ': nada de pergunta a cada tecla');
    assert.match(js, /input\.addEventListener\('blur', \(\) => \{ salvar\(item, 'blur'\); \}\)/, f);
    assert.match(js, /Desfazer/, f);
    assert.doesNotMatch(js, /toISOString/, f);
  }
  const ag = ler('agenda_comum.js');
  assert.match(ag, /'Só este'/);
  assert.match(ag, /'Este e os próximos'/);
  assert.match(ag, /'Todos'/);
  assert.match(ag, /'Pular fins de semana'/);
  assert.match(ag, /pular\.type = 'checkbox';\n/);
  assert.doesNotMatch(ag, /pular\.checked = true/, 'pular fins de semana começa desmarcado');
  for (const f of ['tarefas.html', 'tarefas_admin.html']) assert.match(ler(f), /calculo\/agenda_repeticao\.js\?v=/, f);
});

// contraste das alças e do "⋯" sobre as faixas: sem opacidade (a cor é a tinta da faixa: >= 4,5:1 nas 10 cores, na concluída e na neutra)
test('tema.css: alça, "⋯" e ↻ com a tinta da faixa sem transparência; desktop compacto sem mexer no toque', () => {
  const css = ler('tema.css');
  const regra = sel => { const m = new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' \\{([^}]*)\\}').exec(css); assert.ok(m, sel); return m[1]; };
  for (const sel of ['.agenda .alca', '.agenda .marcador', '.agenda .ag-serie']) {
    assert.doesNotMatch(regra(sel), /opacity/, sel + ' sem opacidade');
    assert.match(regra(sel), /color: var\(--faixa-texto\)|color: inherit/, sel);
  }
  assert.match(css, /\.agenda \.linha\.salva\.feita \.alca, \.agenda \.linha\.salva\.feita \.marcador, \.agenda \.linha\.salva\.feita \.ag-serie \{ color: var\(--text-mid\); \}/);
  // computador: caixinha em cima da alça numa coluna de 16px (o texto ganha largura); fora do ponteiro fino, lado a lado como antes
  assert.match(css, /\.agenda \.ag-esq \{ display: contents; \}/);
  assert.match(css, /@media \(pointer: fine\) \{[\s\S]*?\.agenda \.linha\.salva \.ag-esq \{ display: flex; flex-direction: column-reverse;[^}]*width: 16px;[^}]*\}/);
  for (const f of ['tarefas.js', 'tarefas_admin.js']) {
    const js = ler(f);
    assert.match(js, /item\.esq\.append\(item\.alca\);/, f);
    assert.match(js, /item\.esq\.append\(item\.caixa\);/, f);
  }
  assert.match(css, /@media \(pointer: coarse\) \{[\s\S]*?\.agenda \.marcador \{ width: 40px; height: 42px; \} \.agenda \.alca \{ width: 28px; min-height: 42px; \}/, 'toque continua grande');
});
