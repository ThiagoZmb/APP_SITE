// Histórico do pedido (menu do botão direito): GET /ped_orc/Pedido/:numero/historico, texto em calculo/historico_pedido.js e a janela da tela.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { prepararPedOrc, bancoPedOrc } = require('./apoio/bancoPedOrc');
const { montarHistorico, resumoDoEvento, ACOES_HISTORICO, LIMITE_HISTORICO } = require('../calculo/historico_pedido');

const ler = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const URL = n => `/ped_orc/Pedido/${n}/historico`;
const doc = (banco, numero, extra = {}) => banco.pedOrc.push({ id: numero + 100, TIPO: 'Pedido', NUMERO: numero, RAZAO_SOCIAL: 'CLIENTE TESTE', SITUACAO: 'Em Produção',
  TOTAL: 100, DATA: '2026-10-01 10:00:00', DATA_PRONTO: '2026-11-10', DATA_ENTREGA: null, ...extra });
const aud = (banco, alvo, acao, detalhe, quem = 'Thiago', quando = '2026-11-10 09:30:00') =>
  banco.auditoria.push({ quando, quem, acao, alvo, detalhe: typeof detalhe === 'string' ? detalhe : JSON.stringify(detalhe) });

// ---------- função pura ----------
test('texto: situação com cada tratamento de data, etapa de produção e entrega encerrada junto', () => {
  const q = '2026-11-10 09:30:00';
  assert.equal(resumoDoEvento('pedido_situacao', { de: 'Em Produção', para: 'Pronto' }, q), 'Situação: Em Produção → Pronto');
  assert.equal(resumoDoEvento('pedido_situacao', { de: 'Pronto', para: 'Entregue', manterData: true }, q), 'Situação: Pronto → Entregue (data de entrega mantida)');
  assert.equal(resumoDoEvento('pedido_situacao', { de: 'Pronto', para: 'Retirado', usarDataPronto: true }, q), 'Situação: Pronto → Retirado (data de entrega = data de pronto)');
  assert.equal(resumoDoEvento('pedido_situacao', { de: 'Pronto', para: 'Entregue', dataEscolhida: true }, q), 'Situação: Pronto → Entregue (data de entrega escolhida na janela)');
  assert.equal(resumoDoEvento('pedido_situacao', { de: 'Pronto', para: 'Entregue' }, q), 'Situação: Pronto → Entregue (data de entrega = hoje, 10/11/2026)');
  assert.equal(resumoDoEvento('pedido_situacao', { de: 'Em Produção', para: 'Pronto', origem: 'etapas_producao' }, q), 'Situação: Em Produção → Pronto (pela etapa "Pedido finalizado")');
  assert.equal(resumoDoEvento('pedido_situacao_entregas_abertas', { para: 'Retirado', entregasAbertas: 1, entregasEncerradas: 1 }, q), 'Confirmou marcar como Retirado com 1 entrega em aberto (1 encerrada junto)');
  assert.equal(resumoDoEvento('pedido_situacao_entregas_abertas', { para: 'Entregue', entregasAbertas: 3, entregasEncerradas: [1, 2] }, q), 'Confirmou marcar como Entregue com 3 entregas em aberto (2 encerradas junto)');
  assert.equal(resumoDoEvento('pedido_situacao_entregas_abertas', { para: 'Entregue', entregasAbertas: 2 }, q), 'Confirmou marcar como Entregue com 2 entregas em aberto');
});

test('texto: cancelamento, data de pronto, desconto e preço divergente (sem nenhum valor)', () => {
  assert.equal(resumoDoEvento('pedido_cancelado', { situacaoAnterior: 'Pronto' }), 'Pedido cancelado (era Pronto)');
  assert.equal(resumoDoEvento('pedido_cancelado', {}), 'Pedido cancelado');
  assert.equal(resumoDoEvento('data_pronto_alterada', { de: '2026-11-10', para: '2026-11-12' }), 'Data de pronto: 10/11/2026 → 12/11/2026');
  assert.equal(resumoDoEvento('data_pronto_alterada', { de: null, para: '2026-11-12' }), 'Data de pronto: sem data → 12/11/2026');
  const desc = resumoDoEvento('desconto_adicional_alterado', { modo: 'pct', subTotal: 1234.56, de: { descontoPct: 3, total: 1197.52 }, para: { descontoPct: 10, total: 1111.1 } });
  assert.equal(desc, 'Desconto adicional alterado');
  const prec = resumoDoEvento('preco_divergente', { itens: [{ item: 1, enviado: 999.99, calculado: 1500 }, { item: 2, enviado: 1, calculado: 2 }] });
  assert.equal(prec, 'Aviso de preço divergente na gravação (2 itens)');
  assert.ok(!/\d{3}|R\$|1500|999/.test(desc + prec), 'nenhum valor de dinheiro');
  assert.equal(resumoDoEvento('preco_divergente', 'lixo'), 'Aviso de preço divergente na gravação');
});

test('JSON inválido, nulo ou de outro formato nunca derruba; ação fora da lista é ignorada; cliente nunca sai', () => {
  const linhas = [
    { quando: '2026-11-10 10:00:00', quem: 'A', acao: 'pedido_situacao', detalhe: '{quebrado' },
    { quando: '2026-11-10 10:00:01', quem: 'B', acao: 'pedido_cancelado', detalhe: null },
    { quando: '2026-11-10 10:00:02', quem: 'C', acao: 'data_pronto_alterada', detalhe: '[1,2]' },
    { quando: '2026-11-10 10:00:03', quem: 'D', acao: 'documento_excluido', detalhe: '{}' },
    { quando: '2026-11-10 10:00:04', quem: 'E', acao: 'pedido_situacao', detalhe: { cliente: 'SEGREDO LTDA', de: 'Pronto', para: 'Entregue', manterData: true } },
    null, 'texto', { acao: 'inexistente' }];
  const r = montarHistorico(linhas);
  assert.deepEqual(r.map(x => x.quem), ['A', 'B', 'C', 'E']);
  assert.equal(r[0].resumo, 'Situação: não informada → não informada');
  assert.equal(r[1].resumo, 'Pedido cancelado');
  assert.equal(r[2].resumo, 'Data de pronto: sem data → sem data');
  assert.ok(!JSON.stringify(r).includes('SEGREDO'));
  assert.deepEqual(montarHistorico(undefined), []);
  assert.deepEqual(montarHistorico('x'), []);
  assert.deepEqual(Object.keys(r[0]).sort(), ['acao', 'quando', 'quem', 'resumo']);
});

test('texto vindo do banco é cortado em 40 caracteres e respeita o limite de 200 linhas', () => {
  assert.ok(resumoDoEvento('pedido_cancelado', { situacaoAnterior: 'x'.repeat(500) }).length < 80);
  const muitas = Array.from({ length: 350 }, (_, i) => ({ quando: '2026-11-10 10:00:00', quem: 'Q' + i, acao: 'pedido_cancelado', detalhe: '{}' }));
  assert.equal(montarHistorico(muitas).length, LIMITE_HISTORICO);
  assert.equal(LIMITE_HISTORICO, 200);
  assert.ok(ACOES_HISTORICO.includes('pedido_situacao') && !ACOES_HISTORICO.includes('documento_excluido') && !ACOES_HISTORICO.includes('orcamento_situacao'));
});

// ---------- rota ----------
test('rota: devolve só o histórico do pedido pedido, do mais novo ao mais antigo, com texto pronto e sem dinheiro', async t => {
  const banco = bancoPedOrc(); doc(banco, 5); doc(banco, 6);
  aud(banco, 'Pedido 5', 'data_pronto_alterada', { cliente: 'CLIENTE TESTE', de: '2026-11-10', para: '2026-11-12' }, 'Ana', '2026-11-08 08:00:00');
  aud(banco, 'Pedido 6', 'pedido_cancelado', { cliente: 'CLIENTE TESTE', situacaoAnterior: 'Pronto' }, 'Outro');
  aud(banco, 'Pedido 5', 'pedido_situacao', { cliente: 'CLIENTE TESTE', de: 'Em Produção', para: 'Pronto', manterData: true }, 'Bia', '2026-11-09 10:00:00');
  aud(banco, 'Pedido 5', 'desconto_adicional_alterado', { cliente: 'CLIENTE TESTE', subTotal: 500, de: { descontoPct: 0, total: 500 }, para: { descontoPct: 10, total: 450 } }, 'Caio', '2026-11-10 11:00:00');
  aud(banco, 'Pedido 5', 'documento_excluido', { total: 777 });   // fora da lista
  aud(banco, 'Pedido 5', 'orcamento_situacao', { de: 'a', para: 'b' });   // fora da lista
  aud(banco, 'Pedido 50', 'pedido_cancelado', { situacaoAnterior: 'Pronto' });   // alvo parecido, outro pedido
  aud(banco, 'Orçamento 5', 'pedido_cancelado', { situacaoAnterior: 'Pronto' });   // outro tipo, mesmo número
  aud(banco, 'Pedido 5', 'preco_divergente', { itens: [{ item: 1, enviado: 1234.5, calculado: 2000 }] }, 'Dani', '2026-11-07 07:00:00');
  aud(banco, 'Pedido 5', 'pedido_situacao', '{json quebrado', 'Edu', '2026-11-11 12:00:00');
  const { chamar } = await prepararPedOrc(t, { banco });
  const r = await chamar(URL(5));
  assert.equal(r.status, 200);
  const corpo = await r.json();
  assert.equal(corpo.numero, 5);
  assert.deepEqual(corpo.eventos.map(e => e.quem), ['Edu', 'Dani', 'Caio', 'Bia', 'Ana'], 'do último gravado (id maior) para o primeiro');
  assert.deepEqual(corpo.eventos.find(e => e.quem === 'Bia'), { quando: '2026-11-09 10:00:00', quem: 'Bia', acao: 'pedido_situacao', resumo: 'Situação: Em Produção → Pronto (data de entrega mantida)' });
  assert.equal(corpo.eventos.find(e => e.quem === 'Caio').resumo, 'Desconto adicional alterado');
  assert.equal(corpo.eventos.find(e => e.quem === 'Edu').resumo, 'Situação: não informada → não informada');
  const bruto = JSON.stringify(corpo);
  assert.ok(!/CLIENTE TESTE|450|500|1234|2000|777|"cliente"|"detalhe"/.test(bruto), 'sem cliente, valores nem detalhe cru');
});

test('rota: pedido sem registros devolve lista vazia; pedido inexistente = 404; número inválido = 400; orçamento não é pedido', async t => {
  const banco = bancoPedOrc(); doc(banco, 5);
  banco.pedOrc.push({ id: 1, TIPO: 'Orçamento', NUMERO: 9, RAZAO_SOCIAL: 'CLIENTE TESTE', SITUACAO: 'Fechado' });
  aud(banco, 'Orçamento 9', 'pedido_cancelado', { situacaoAnterior: 'x' });
  const { chamar } = await prepararPedOrc(t, { banco });
  const vazio = await chamar(URL(5));
  assert.equal(vazio.status, 200);
  assert.deepEqual(await vazio.json(), { numero: 5, eventos: [] });
  assert.equal((await chamar(URL(999))).status, 404);
  assert.equal((await chamar(URL(9))).status, 404, 'só existe como Orçamento');
  for (const n of ['abc', '0', '-3', '1.5']) assert.equal((await chamar(URL(n))).status, 400, n);
});

test('rota: exige pedidos.ver (Estoquista não tem → 403) e respeita os estados do usuário', async t => {
  let banco = bancoPedOrc(); doc(banco, 5); aud(banco, 'Pedido 5', 'pedido_cancelado', { situacaoAnterior: 'Pronto' });
  let c = await prepararPedOrc(t, { banco, perfil: 'Estoquista' });
  assert.equal((await c.chamar(URL(5))).status, 403);
  banco = bancoPedOrc(); doc(banco, 5); aud(banco, 'Pedido 5', 'pedido_cancelado', { situacaoAnterior: 'Pronto' });   // cliente do RJ
  c = await prepararPedOrc(t, { banco, perfil: 'Representante SP' });
  assert.equal((await c.chamar(URL(5))).status, 403, 'representante de SP não vê pedido de cliente do RJ');
  banco = bancoPedOrc(); doc(banco, 5, { RAZAO_SOCIAL: 'LOJA PAULISTA' }); aud(banco, 'Pedido 5', 'pedido_cancelado', { situacaoAnterior: 'Pronto' });
  c = await prepararPedOrc(t, { banco, perfil: 'Representante SP' });
  const ok = await c.chamar(URL(5));
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).eventos.length, 1);
});

test('rota: só lê (nenhuma gravação em web_auditoria nem em ped_orc) e está no registro de rotas com pedidos.ver', async t => {
  const banco = bancoPedOrc(); doc(banco, 5); aud(banco, 'Pedido 5', 'pedido_cancelado', { situacaoAnterior: 'Pronto' });
  const antes = JSON.stringify([banco.pedOrc, banco.auditoria]);
  const { chamar } = await prepararPedOrc(t, { banco });
  await chamar(URL(5));
  assert.equal(JSON.stringify([banco.pedOrc, banco.auditoria]), antes);
  const fonte = ler('rotas/ped_orc.js');
  assert.match(fonte, /rota\('get', '\/ped_orc\/Pedido\/:numero\/historico', \['pedidos\.ver'\]/);
  assert.match(fonte, /conferirEstadosDoCliente\(pool, req, cab\.RAZAO_SOCIAL\);\s*const marcas/);
});

// ---------- tela ----------
function ambiente(resposta) {
  const criar = tag => {
    const el = { tag, className: '', children: [], attrs: {}, listeners: {}, _txt: '', tabIndex: -1,
      setAttribute(k, v) { this.attrs[k] = v; }, append(...f) { this.children.push(...f); },
      addEventListener(ev, fn) { this.listeners[ev] = fn; }, focus() { doc.activeElement = this; }, remove() { this.removido = true; },
      querySelector(sel) { const cls = sel.replace('.', ''); const busca = n => { for (const c of n.children) { if (String(c.className).split(' ').includes(cls)) return c; const r = busca(c); if (r) return r; } return null; }; return busca(this); } };
    Object.defineProperty(el, 'textContent', { get() { return this._txt; }, set(v) { this._txt = v; if (v === '') this.children = []; } });
    if (tag === 'table') { el.tHead = null; el.append = function (...f) { this.children.push(...f); if (f[0] && f[0].tag === 'thead') this.tHead = f[0]; }; }
    return el;
  };
  const doc = { activeElement: { focus() {} }, body: criar('body'), createElement: criar, listeners: {}, addEventListener(e, f) { this.listeners[e] = f; }, removeEventListener(e) { delete this.listeners[e]; } };
  const chamadas = [];
  const sandbox = { window: { location: {} }, document: doc, localStorage: { removeItem() {} },
    fetch: async (url, opcoes) => { chamadas.push({ url, opcoes }); return resposta; } };
  sandbox.window.window = sandbox.window;
  vm.runInNewContext(ler('historico_pedido_tela.js'), sandbox, { filename: 'historico_pedido_tela.js' });
  return { sandbox, doc, chamadas };
}
const todos = (n, acc = []) => { acc.push(n); (n.children || []).forEach(c => typeof c === 'object' && todos(c, acc)); return acc; };
const textos = n => todos(n).map(x => x._txt).filter(Boolean);
const esperar = () => new Promise(r => setTimeout(r, 10));
const resp = (status, corpo) => ({ status, ok: status >= 200 && status < 300, json: async () => corpo });

test('tela: chama a rota com o token, mostra linhas (data e hora, quem, resumo) por textContent e fecha com Esc devolvendo o foco', async () => {
  const { sandbox, doc, chamadas } = ambiente(resp(200, { eventos: [{ quando: '2026-11-09 10:05:00', quem: 'Bia<b>', acao: 'pedido_situacao', resumo: 'Situação: A → B <img src=x>' }] }));
  const anterior = { focus() { doc.activeElement = this; } };
  doc.activeElement = anterior;
  sandbox.window.HistoricoPedido.abrir({ numero: 5, apiBase: 'https://api', loginUrl: 'login.html', token: () => 'tok' });
  await esperar();
  assert.equal(chamadas[0].url, 'https://api/ped_orc/Pedido/5/historico');
  assert.equal(chamadas[0].opcoes.headers.Authorization, 'Bearer tok');
  const fundo = doc.body.children[0];
  assert.equal(fundo.children[0].attrs.role, 'dialog');
  const t = textos(fundo);
  assert.ok(t.includes('09/11/2026 10:05') && t.includes('Bia<b>') && t.includes('Situação: A → B <img src=x>'), 'texto cru em textContent');
  assert.ok(t.includes('Data e hora') && t.includes('Quem') && t.includes('O que mudou'));
  assert.equal(todos(fundo).filter(x => x.tag === 'table').length, 1);
  assert.ok(todos(fundo).some(x => String(x.className).includes('rolagem')), 'quadro com rolagem (cabeçalho fixo)');
  doc.listeners.keydown({ key: 'Escape', preventDefault() {}, stopPropagation() {} });
  assert.ok(fundo.removido);
  assert.equal(doc.activeElement, anterior, 'foco volta a quem abriu');
  assert.equal(doc.listeners.keydown, undefined, 'ouvinte de teclado removido');
});

test('tela: estado vazio e erro tratados (mensagem do servidor, 403 e falha de rede)', async () => {
  let a = ambiente(resp(200, { eventos: [] }));
  a.sandbox.window.HistoricoPedido.abrir({ numero: 5, apiBase: 'x', loginUrl: 'l', token: () => 't' }); await esperar();
  assert.ok(textos(a.doc.body).includes('Nenhuma alteração registrada na web para este pedido (mudanças feitas no VB não aparecem aqui).'));
  a = ambiente(resp(404, { error: 'Pedido nº 5 não encontrado.' }));
  a.sandbox.window.HistoricoPedido.abrir({ numero: 5, apiBase: 'x', loginUrl: 'l', token: () => 't' }); await esperar();
  assert.ok(textos(a.doc.body).some(s => s.includes('Não foi possível carregar o histórico: Pedido nº 5 não encontrado.')));
  a = ambiente(resp(403, {}));
  a.sandbox.window.HistoricoPedido.abrir({ numero: 5, apiBase: 'x', loginUrl: 'l', token: () => 't' }); await esperar();
  assert.ok(textos(a.doc.body).some(s => s.includes('Acesso restrito.')));
  a = ambiente(null); a.sandbox.fetch = async () => { throw new Error('Failed to fetch'); };
  a.sandbox.window.HistoricoPedido.abrir({ numero: 5, apiBase: 'x', loginUrl: 'l', token: () => 't' }); await esperar();
  assert.ok(textos(a.doc.body).some(s => s.includes('Failed to fetch')));
});

test('tela: formatação de data e hora tolera formato inesperado', () => {
  const { sandbox } = ambiente(resp(200, {}));
  assert.equal(sandbox.window.HistoricoPedido.dataHora('2026-11-09 10:05:33'), '09/11/2026 10:05');
  assert.equal(sandbox.window.HistoricoPedido.dataHora('lixo'), 'lixo');
  assert.equal(sandbox.window.HistoricoPedido.dataHora(null), '');
});

// ---------- ligação estática: menus, páginas, estilo ----------
test('menus: "Histórico do pedido" com pedidos.ver em inicio_menu.js e painel_inicial.html; scripts carregados com a versão nova', () => {
  assert.match(ler('inicio_menu.js'), /add\('pedidos\.ver', '[^']+', 'Histórico do pedido', \(\) => window\.HistoricoPedido\.abrir\(\{ numero: n,/);
  assert.match(ler('painel_inicial.html'), /if \(ehPedido\) \{ sep\(\); add\('pedidos\.ver', '[^']+', 'Histórico do pedido', \(\) => window\.HistoricoPedido\.abrir\(/);
  for (const f of ['inicio.html', 'calendario.html', 'calendario_dia.html', 'painel_inicial.html']) {
    const h = ler(f);
    assert.match(h, /<script src="historico_pedido_tela\.js\?v=202611171200" defer><\/script>/, f);
    assert.ok(h.indexOf('desconto_pedido_tela.js') < h.indexOf('historico_pedido_tela.js'), f);
  }
  assert.doesNotThrow(() => new vm.Script(ler('historico_pedido_tela.js'), { filename: 'historico_pedido_tela.js' }));
});

test('menu do início: o item aparece só com pedidos.ver, também em pedido cancelado, e não é o último quando há entrega', () => {
  global.window = { addEventListener() {}, innerWidth: 1000, abrirPdfAutenticado() {} };
  global.document = { addEventListener() {} };
  delete require.cache[require.resolve('../inicio_menu.js')];
  require('../inicio_menu.js');
  const menu = permissoes => global.window.InicioMenu.iniciar({ apiBase: 'https://api', loginUrl: 'login', token: () => 't', docDe: () => null, recarregar() {}, esc: s => s,
    pode: p => String(p).split(' ').every(x => permissoes.has(x)) });
  const rot = it => it.filter(x => x.rotulo).map(x => x.rotulo);
  assert.ok(!rot(menu(new Set(['pedidos.pdf'])).itensDoMenu({ numero: 1, situacao: 'Pronto' })).includes('Histórico do pedido'));
  assert.deepEqual(rot(menu(new Set(['pedidos.ver'])).itensDoMenu({ numero: 1, situacao: 'Pronto' })), ['Histórico do pedido']);
  assert.deepEqual(rot(menu(new Set(['pedidos.ver'])).itensDoMenu({ numero: 1, situacao: 'Cancelado' })), ['Histórico do pedido']);
  const com = menu(new Set(['pedidos.ver', 'entregas.ver'])).itensDoMenu({ numero: 1, situacao: 'Pronto', entregaStatus: 'agendada' });
  assert.deepEqual(rot(com), ['Histórico do pedido', 'Ver entrega (Agendada)']);
});

test('visual: sem style= nem cor solta no JS, estilos hp-* no tema.css só com variáveis, cabeçalho fixo, mesma versão do tema em todas as páginas', () => {
  const js = ler('historico_pedido_tela.js'), css = ler('tema.css');
  assert.ok(!/\.style\b|style=|cssText|#[0-9a-fA-F]{3,6}\b|rgba?\(|innerHTML|outerHTML|insertAdjacentHTML/.test(js.replace(/\/\/.*$/gm, '')), 'sem estilo, cor nem HTML cru no JS');
  const bloco = css.slice(css.indexOf('janela "Histórico do pedido"'), css.indexOf('janela "Histórico do pedido"') + 1600);
  for (const cls of ['hp-caixa', 'hp-rolagem', 'hp-tabela', 'hp-quando', 'hp-msg', 'hp-erro']) assert.match(bloco, new RegExp(`\\.${cls}\\b`), cls);
  assert.ok(!/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(bloco), 'cores só por variáveis do tema');
  assert.ok(/class[^]*'rolagem hp-rolagem'/.test(js) || js.includes("'rolagem hp-rolagem'"), 'a lista usa o quadro .rolagem (th sticky do tema)');
  assert.ok(/:where\(\.tabela-wrap, \.lista-wrap, \.rolagem/.test(css));
  const versoes = new Set(fs.readdirSync(path.join(__dirname, '..')).filter(f => f.endsWith('.html')).flatMap(f => [...ler(f).matchAll(/tema\.css\?v=(\d+)/g)].map(m => m[1])));
  assert.deepEqual([...versoes], ['202611211500']);
});
