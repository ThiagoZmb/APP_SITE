// Agendas (tela): categorias com cor, legenda, mover/arrastar (agenda_comum.js + criarLinha de tarefas.js e tarefas_admin.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const AG = require('../agenda_comum.js');
const T = require('../tarefas.js');
const A = require('../tarefas_admin.js');
const { CORES: CORES_SERVIDOR } = require('../calculo/minha_semana');

const ler = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const tique = () => new Promise(r => setImmediate(r));
function armazem() {
  const m = new Map();
  return { m, getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
}

// ---------- paleta, categorias e legenda ----------
test('paleta da tela = paleta do servidor; categoria apagada ou de cor estranha vira "Sem categoria"/neutra', () => {
  assert.deepEqual(AG.CORES.map(c => c.codigo), CORES_SERVIDOR);
  const mapa = AG.indexar([{ id: 1, nome: 'Banco', cor: 'azul' }, { id: 2, nome: 'Estranha', cor: '#ff0000' }, { id: 'x', nome: 'ruim', cor: 'azul' }]);
  assert.deepEqual([...mapa.keys()], [1, 2]);
  assert.deepEqual([AG.corDe(1, mapa), AG.nomeDe(1, mapa)], ['azul', 'Banco']);
  assert.deepEqual([AG.corDe(2, mapa), AG.corDe(9, mapa), AG.nomeDe(9, mapa), AG.corDe(null, mapa)], ['', '', 'Sem categoria', '']);
});

test('nome da categoria: mesma regra do servidor (1 a 30, uma linha, sem repetir maiúsculas/acentos)', () => {
  const lista = [{ id: 1, nome: 'Médico' }];
  assert.deepEqual(AG.conferirNome('  Banco \n do  Brasil ', lista), { ok: true, nome: 'Banco do Brasil' });
  assert.equal(AG.conferirNome('MEDICO', lista).ok, false);
  assert.equal(AG.conferirNome('medico', lista, 1).ok, true, 'renomear a própria');
  assert.equal(AG.conferirNome('', lista).ok, false);
  assert.equal(AG.conferirNome('a'.repeat(31), lista).ok, false);
});

test('legenda: o escondido fica guardado por página e usuário; armazenamento bloqueado não quebra; categoria apagada sai da lista', () => {
  const st = armazem();
  const mapa = AG.indexar([{ id: 1, nome: 'A', cor: 'azul' }, { id: 2, nome: 'B', cor: 'rosa' }]);
  const l = AG.criarLegenda(() => st, 'minha_semana_legenda:7');
  l.mostrar('1', false);
  l.mostrar('sem', false);
  assert.deepEqual([l.visivel(1, mapa), l.visivel(2, mapa), l.visivel(null, mapa), l.visivel(99, mapa)], [false, true, false, false], 'categoria sumida = Sem categoria');
  assert.deepEqual(JSON.parse(st.getItem('minha_semana_legenda:7')), ['1', 'sem']);
  assert.equal(AG.criarLegenda(() => st, 'minha_semana_legenda:8').visivel(1, mapa), true, 'outro usuário tem a sua');
  assert.equal(AG.criarLegenda(() => st, 'minha_semana_legenda:7').visivel(1, mapa), false, 'volta ao reabrir');
  l.podar(AG.indexar([{ id: 2, nome: 'B', cor: 'rosa' }]));
  assert.deepEqual(JSON.parse(st.getItem('minha_semana_legenda:7')), ['sem']);
  l.mostrar('sem', true);
  assert.equal(st.getItem('minha_semana_legenda:7'), null, 'nada escondido: nada guardado');
  const bloqueado = AG.criarLegenda(() => { throw new Error('bloqueado'); }, 'k');
  bloqueado.mostrar('1', false);
  assert.equal(bloqueado.visivel(1, mapa), false, 'vale nesta visita');
});

test('mover: mesmo lugar, corpo enviado e pergunta antes de ir para Notas só com alarme gravado', () => {
  assert.equal(AG.mesmoLugar({ quadro: 'dia', data: '2026-11-24' }, { quadro: 'dia', data: '2026-11-24' }), true);
  assert.equal(AG.mesmoLugar({ quadro: 'tarefas', data: null }, { quadro: 'tarefas', data: '2026-11-24' }), true);
  assert.equal(AG.mesmoLugar({ quadro: 'dia', data: '2026-11-24' }, { quadro: 'dia', data: '2026-11-25' }), false);
  assert.deepEqual(AG.corpoMover({ quadro: 'notas', data: '2026-11-24' }), { quadro: 'notas', data: null });
  assert.equal(AG.pedeConfirmacaoNotas({ quadro: 'dia', temAlarme: true }, { quadro: 'notas' }), true);
  assert.equal(AG.pedeConfirmacaoNotas({ quadro: 'dia', temAlarme: false, feita: true }, { quadro: 'notas' }), false, 'o concluído sai sem perguntar');
  assert.equal(AG.pedeConfirmacaoNotas({ quadro: 'dia', temAlarme: true }, { quadro: 'tarefas' }), false, 'entre dias e Tarefas o alarme fica');
});

test('modo de falha 5: só linha salva e sem nada pendente se arrasta; a atualização automática espera arraste, menu e janela', () => {
  const linha = (extra = {}) => ({ dados: { id: 3, texto: 'ligar' }, erro: false, conflito: null, apagada: false, pendente: () => false, ...extra });
  const item = (l, valor = 'ligar', readOnly = false) => ({ linha: l, input: { value: valor, readOnly } });
  assert.equal(AG.podeArrastar(item(linha())), true);
  assert.equal(AG.podeArrastar(item(linha(), 'ligar ')), true, 'espaço nas pontas não conta (o servidor também tira)');
  assert.equal(AG.podeArrastar(item(linha(), 'ligar cedo')), false, 'texto digitado e ainda não salvo');
  assert.equal(AG.podeArrastar(item(linha({ dados: { id: null, texto: '' } }), '')), false, 'linha nova');
  assert.equal(AG.podeArrastar(item(linha({ pendente: () => true }))), false, 'fila ocupada');
  assert.equal(AG.podeArrastar(item(linha({ erro: true }))), false);
  assert.equal(AG.podeArrastar(item(linha({ conflito: {} }))), false);
  assert.equal(AG.podeArrastar(item(linha(), 'ligar', true)), false, 'semana trocando');
  assert.equal(AG.podeAtualizar({ arrastando: false, menuAberto: false, janelaAberta: false }), true);
  for (const k of ['arrastando', 'menuAberto', 'janelaAberta']) assert.equal(AG.podeAtualizar({ arrastando: false, menuAberto: false, janelaAberta: false, [k]: true }), false, k);
  // e a tela confere de novo depois da resposta (o arraste pode ter começado enquanto a consulta ia e voltava)
  assert.match(ler('tarefas_admin.js'), /geracao !== estado\.geracao \|\| !Array\.isArray\(r\.linhas\) \|\| !podeAtualizar\(\)/);
});

test('rolagem automática perto da borda e rótulo do mês', () => {
  assert.equal(AG.velocidadeRolagem(400, 800), 0);
  assert.ok(AG.velocidadeRolagem(0, 800) < AG.velocidadeRolagem(40, 800) && AG.velocidadeRolagem(40, 800) < 0);
  assert.ok(AG.velocidadeRolagem(800, 800) > AG.velocidadeRolagem(760, 800) && AG.velocidadeRolagem(760, 800) > 0);
  assert.equal(AG.rotuloMes('2026-11-23'), 'Novembro de 2026');
  assert.equal(AG.rotuloMes('2026-11-30'), 'Novembro – Dezembro de 2026');
  assert.equal(AG.rotuloMes('2026-12-28'), 'Dezembro de 2026 – Janeiro de 2027');
});

// ---------- Minha semana: colorir e mover pela fila da linha ----------
function apiPessoal() {
  const chamadas = [];
  const estado = { falhar: 0, status: undefined, preso: null };
  let id = 0;
  async function chamar(caminho, { metodo = 'GET', corpo } = {}) {
    chamadas.push([metodo, caminho, corpo]);
    if (estado.preso) { const p = estado.preso; estado.preso = null; await p; }
    if (estado.falhar > 0) { estado.falhar--; const e = new Error('Sem conexão. Tente de novo.'); e.status = estado.status; throw e; }
    if (metodo === 'POST') return { id: ++id, ...corpo, feita: false, alarme: null, categoriaId: null };
    if (metodo === 'PUT' && corpo.quadro) return { id: Number(caminho.split('/').pop()), texto: 'x', ...corpo, feita: corpo.quadro === 'notas' ? false : true, alarme: null, categoriaId: 4 };
    return { ok: true };
  }
  const segurar = () => { let soltar; estado.preso = new Promise(r => { soltar = r; }); return soltar; };
  return { chamar, chamadas, estado, segurar };
}

test('pessoal: mover e colorir entram na fila depois do POST (um POST só) e não mudam texto', async () => {
  const api = apiPessoal();
  const l = T.criarLinha(api.chamar, { quadro: 'dia', data: '2026-11-23', texto: '', feita: false });
  const soltar = api.segurar();
  const a = l.salvarTexto('Ligar');
  const b = l.colorir(4);
  const c = l.mover({ quadro: 'dia', data: '2026-11-26' });
  await tique();
  assert.equal(api.chamadas.length, 1);
  soltar();
  const [, rb, rc] = await Promise.all([a, b, c]);
  assert.deepEqual(api.chamadas.map(x => [x[0], x[1], x[2]]), [
    ['POST', '/minha_semana', { quadro: 'dia', data: '2026-11-23', texto: 'Ligar' }],
    ['PUT', '/minha_semana/1', { categoriaId: 4 }],
    ['PUT', '/minha_semana/1', { quadro: 'dia', data: '2026-11-26' }]
  ]);
  assert.deepEqual([rb.ok, rc.ok, l.dados.categoriaId, l.dados.data, l.dados.texto, l.pendente()], [true, true, 4, '2026-11-26', 'Ligar', false]);
});

test('pessoal: mover com texto não salvo é recusado sem chamar o servidor; falha devolve ok:false e nada muda', async () => {
  const api = apiPessoal();
  const l = T.criarLinha(api.chamar, { id: 5, quadro: 'dia', data: '2026-11-23', texto: 'velho', feita: false });
  l.anotar('novo, ainda digitando');
  const r = await l.mover({ quadro: 'tarefas' });
  assert.deepEqual([r.ok, api.chamadas.length, l.dados.quadro], [false, 0, 'dia']);
  const m = T.criarLinha(api.chamar, { id: 6, quadro: 'dia', data: '2026-11-23', texto: 'x', feita: false });
  api.estado.falhar = 1;
  const f = await m.mover({ quadro: 'tarefas' });
  assert.deepEqual([f.ok, m.dados.quadro, m.dados.data, m.erro], [false, 'dia', '2026-11-23', false], 'não vira erro da linha: o texto está salvo');
  api.estado.falhar = 1; api.estado.status = 404;
  assert.deepEqual(await m.colorir(2), { ok: false, sumiu: true });
});

test('pessoal: ir para Notas tira o concluído e o alarme também na tela', async () => {
  const api = apiPessoal();
  const l = T.criarLinha(api.chamar, { id: 7, quadro: 'dia', data: '2026-11-23', texto: 'x', feita: true, alarme: '2026-11-23 10:00' });
  assert.equal(l.dados.temAlarme, true, 'sabe do alarme gravado mesmo em stand by');
  const r = await l.mover({ quadro: 'notas' });
  assert.equal(r.ok, true);
  assert.deepEqual([l.dados.quadro, l.dados.feita, l.feita, l.dados.temAlarme], ['notas', false, false, false]);
});

// ---------- Semana compartilhada: versão, 409 e atualização ----------
function servidorAdmin() {
  const linhas = [{ id: 1, quadro: 'dia', data: '2026-11-24', texto: 'ligar', feita: false, alarme: null, versao: 1, criadaPor: 'Ana', feitaPor: null, categoriaId: null }];
  const chamadas = [];
  const erro = (status, dados) => { const e = new Error('x'); e.status = status; e.dados = dados; return e; };
  async function chamar(caminho, { metodo = 'GET', corpo } = {}) {
    chamadas.push([metodo, caminho, corpo]);
    const l = linhas.find(x => caminho === '/semana_admin/' + x.id);
    if (!l) throw erro(404, { error: 'Tarefa não encontrada.' });
    if (l.versao !== corpo.versao) throw erro(409, { error: 'Alterada.', atual: { ...l } });
    const { versao, ...mudanca } = corpo;
    Object.assign(l, mudanca, { versao: versao + 1 }, mudanca.quadro === 'notas' ? { feita: false, alarme: null } : {});
    return { ...l };
  }
  return { linhas, chamadas, chamar };
}

test('compartilhada: mover leva a versão; 409 = nada gravado por cima e a linha passa a ser a atual', async () => {
  const s = servidorAdmin();
  const l = A.criarLinha(s.chamar, { ...s.linhas[0] });
  const r = await l.mover({ quadro: 'dia', data: '2026-11-26' });
  assert.deepEqual(s.chamadas[0], ['PUT', '/semana_admin/1', { quadro: 'dia', data: '2026-11-26', versao: 1 }]);
  assert.deepEqual([r.ok, l.dados.data, l.dados.versao], [true, '2026-11-26', 2]);
  // outra pessoa colore a linha antes
  const outra = A.criarLinha(s.chamar, { ...s.linhas[0], versao: 2 });
  await outra.colorir(3);
  const velha = await l.mover({ quadro: 'tarefas' });
  assert.deepEqual([velha.ok, velha.conflito, velha.atual.categoriaId], [false, true, 3]);
  assert.deepEqual([s.linhas[0].quadro, s.linhas[0].versao], ['dia', 3], 'nada gravado por cima');
  assert.deepEqual([l.dados.versao, l.dados.categoriaId, l.conflito, l.erro, l.pendente()], [3, 3, null, false, false], 'adota o atual sem perguntar (só mexeu em lugar)');
  s.linhas.length = 0;
  assert.deepEqual(await l.colorir(1), { ok: false, apagada: true });
});

test('compartilhada: atualização automática leva a linha para o lugar novo quando outra pessoa a moveu', () => {
  const l = A.criarLinha(async () => ({}), { id: 1, quadro: 'dia', data: '2026-11-24', texto: 'a', feita: false, versao: 1, criadaPor: 'Ana' });
  const m = A.criarLinha(async () => ({}), { id: 2, quadro: 'tarefas', data: null, texto: 'b', feita: false, versao: 1, criadaPor: 'Ana' });
  const itens = [{ linha: l, livre: () => true }, { linha: m, livre: () => true }];
  const plano = A.planejarAtualizacao(itens, [{ ...l.dados, data: '2026-11-27', versao: 2 }, { ...m.dados, texto: 'b2', versao: 2 }], new Set([1, 2]), new Set());
  assert.deepEqual(plano.mover.map(([i, s]) => [i.linha.dados.id, s.data]), [[1, '2026-11-27']]);
  assert.deepEqual(plano.atualizar.map(([i]) => i.linha.dados.id), [2]);
});

// ---------- segurança e visual ----------
test('XSS: nome de categoria e texto só por textContent/value; sem innerHTML; rotas certas em cada tela', () => {
  for (const f of ['agenda_comum.js', 'tarefas.js', 'tarefas_admin.js']) assert.doesNotMatch(ler(f), /innerHTML|insertAdjacentHTML|outerHTML|document\.write/, f);
  const ag = ler('agenda_comum.js');
  assert.doesNotMatch(ag, /minha_semana|semana_admin/, 'a parte comum não conhece rota');
  assert.match(ler('tarefas.js'), /'\/minha_semana\/categorias'/);
  assert.match(ler('tarefas_admin.js'), /'\/semana_admin\/categorias'/);
  assert.doesNotMatch(ler('tarefas.js'), /semana_admin/);
  assert.doesNotMatch(ler('tarefas_admin.js'), /['`]\/minha_semana/);
  assert.match(ag, /setPointerCapture/);
  assert.match(ag, /pointercancel/);
  assert.match(ag, /'Escape'/);
  assert.doesNotMatch(ag, /import |require\(|https?:\/\//, 'sem biblioteca externa');
});

// contraste WCAG lido do tema.css: texto sobre a faixa (tinta escura) e sobre a faixa concluída (Tinta Média), nas 10 cores e na neutra
test('tema.css: 10 cores + neutra como variáveis; texto da faixa e da concluída com contraste AA (>= 4,5:1)', () => {
  const css = ler('tema.css');
  const v = nome => { const m = new RegExp(`--${nome}:\\s*(#[0-9a-f]{6})`, 'i').exec(css); assert.ok(m, nome); return m[1]; };
  const lum = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)).reduce((s, c, i) => s + c * [0.2126, 0.7152, 0.0722][i], 0);
  const razao = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  for (const { codigo } of AG.CORES) {
    assert.ok(razao(v('cat-tinta'), v('cat-' + codigo)) >= 4.5, codigo);
    assert.ok(razao(v('text-mid'), v(`cat-${codigo}-suave`)) >= 4.5, codigo + ' concluída');
    assert.match(css, new RegExp(`\\[data-cor="${codigo}"\\] \\{ --faixa: var\\(--cat-${codigo}\\)`), codigo);
  }
  assert.ok(razao(v('text-dark'), v('cat-neutra')) >= 4.5);
  assert.ok(razao(v('text-mid'), v('cat-neutra-suave')) >= 4.5);
  assert.match(css, /\.agenda \.linha\.salva\.feita textarea \{[^}]*color: var\(--text-mid\);[^}]*line-through/);
  assert.match(css, /\.agenda \.alca \{[^}]*touch-action: none/);
  const design = ler('DESIGN.md');
  for (const { codigo } of AG.CORES) assert.ok(design.includes(v('cat-' + codigo)), 'DESIGN.md sem ' + codigo);
});

test('alarmes continuam em stand by e com o código no lugar', () => {
  assert.match(ler('layout.js'), /const ALARMES_ATIVOS = false;/);
  for (const f of ['tarefas.js', 'tarefas_admin.js']) {
    const js = ler(f);
    assert.match(js, /function abrirEditor\(item\)/);
    assert.match(js, /alarmar: q =>/);
  }
});
