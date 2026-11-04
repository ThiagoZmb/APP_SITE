process.env.JWT_SECRET = 'teste';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PASTA = path.join(__dirname, '..', 'portal', 'public');
const existe = nome => fs.existsSync(path.join(PASTA, nome));
const ler = nome => fs.readFileSync(path.join(PASTA, nome), 'utf8');
const esperar = () => new Promise(r => setImmediate(r));
// objetos criados dentro do vm têm outro Object.prototype: compara por estrutura JSON
const plano = x => JSON.parse(JSON.stringify(x));

test('usuarios.html e usuarios.js existem', () => {
  assert.ok(existe('usuarios.html'), 'falta usuarios.html');
  assert.ok(existe('usuarios.js'), 'falta usuarios.js');
});

test('usuarios.html: sem inline, sem name nem <form>; ids da tela e link de volta', () => {
  const h = ler('usuarios.html');
  for (const m of h.matchAll(/<script\b([^>]*)>/gi)) assert.match(m[1], /\bsrc="[^"]+"/);
  assert.ok(!/<script\b[^>]*>\s*[^<\s]/i.test(h), 'script com conteúdo');
  assert.ok(!/\sstyle\s*=/i.test(h), 'style=');
  assert.ok(!/\son[a-z]+\s*=/i.test(h), 'on*=');
  assert.ok(!/<form\b/i.test(h), 'form');
  for (const m of h.matchAll(/<input\b([^>]*)>/gi)) assert.ok(!/\sname\s*=/i.test(m[1]), 'input com name');
  assert.match(h, /<title>Usuários da empresa<\/title>/);
  assert.match(h, /<script src="usuarios\.js">/);
  assert.match(h, /<p id="erro" class="erro" role="alert"/);
  for (const id of ['aviso', 'painel', 'lista', 'convite-email', 'convite-pedidos', 'convite-financeiro', 'convite-documentos', 'convidar', 'resultado-convite']) {
    assert.ok(h.includes(`id="${id}"`), 'falta #' + id);
  }
  assert.match(h, /href="inicio\.html"/);
});

test('usuarios.js: APIs proibidas, textContent, rotas, confirm e login', () => {
  const j = ler('usuarios.js');
  assert.doesNotThrow(() => new vm.Script(j));
  for (const p of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'eval(', 'document.write', 'href']) assert.ok(!j.includes(p), p);
  assert.ok(j.includes('textContent'));
  assert.ok(j.includes('/portal/api/usuarios'));
  assert.ok(j.includes('confirm('));
  assert.ok(j.includes('/portal/login.html'));
  assert.ok(j.includes('usuarios.gerir'));
});

test('inicio.html tem o link Usuários oculto por padrão', () => {
  const h = ler('inicio.html');
  assert.match(h, /<a href="usuarios\.html" id="link-usuarios" hidden>Usuários<\/a>/);
});

function rodarInicio(permissoes) {
  const el = {};
  const novo = () => ({ textContent: '', hidden: undefined, addEventListener() {} });
  const get = id => (el[id] = el[id] || novo());
  get('link-usuarios').hidden = true;
  const usuario = { email: 'a@b.c', empresa: { razaoSocial: 'X' } };
  if (permissoes !== undefined) usuario.permissoes = permissoes;
  const janela = { location: {}, PortalApi: { chamar: async () => ({ status: 200, dados: { usuario } }) } };
  vm.runInNewContext(ler('inicio.js'), { window: janela, document: { getElementById: get } });
  return get;
}

test('inicio.js: mostra o link Usuários só com usuarios.gerir', async () => {
  let get = rodarInicio(['pedidos.ver', 'usuarios.gerir']);
  await esperar();
  assert.equal(get('link-usuarios').hidden, false);
  get = rodarInicio(['pedidos.ver']);
  await esperar();
  assert.equal(get('link-usuarios').hidden, true);
  get = rodarInicio(undefined);
  await esperar();
  assert.equal(get('link-usuarios').hidden, true);
});

test('portal.js: chamar aceita o método (PUT) e mantém POST por padrão e GET sem corpo', async () => {
  const pedidos = [];
  const janela = {};
  const fetchFalso = async (c, o) => { pedidos.push({ c, o }); return { status: 200, json: async () => ({}), headers: { get: () => null } }; };
  vm.runInNewContext(ler('portal.js'), { window: janela, fetch: fetchFalso });
  await janela.PortalApi.chamar('/a');
  await janela.PortalApi.chamar('/b', { x: 1 });
  await janela.PortalApi.chamar('/c', { y: 2 }, 'PUT');
  assert.equal(pedidos[0].o.method, undefined);
  assert.equal(pedidos[0].o.body, undefined);
  assert.equal(pedidos[1].o.method, 'POST');
  assert.equal(pedidos[1].o.body, '{"x":1}');
  assert.equal(pedidos[2].o.method, 'PUT');
  assert.equal(pedidos[2].o.body, '{"y":2}');
  assert.equal(pedidos[2].o.headers['X-Portal'], '1');
});

test('portal.js: só PUT é método alternativo; qualquer outro valor vira POST', async () => {
  const pedidos = [];
  const janela = {};
  const fetchFalso = async (c, o) => { pedidos.push({ c, o }); return { status: 200, json: async () => ({}), headers: { get: () => null } }; };
  vm.runInNewContext(ler('portal.js'), { window: janela, fetch: fetchFalso });
  for (const m of ['DELETE', 'PATCH', 'GET', 'put', 'TRACE', '', null, 7, {}]) await janela.PortalApi.chamar('/x', { a: 1 }, m);
  await janela.PortalApi.chamar('/x', { a: 1 }, 'PUT');
  assert.deepEqual(pedidos.map(p => p.o.method), ['POST', 'POST', 'POST', 'POST', 'POST', 'POST', 'POST', 'POST', 'POST', 'PUT']);
});

// ---- DOM falso -------------------------------------------------------------------------------------------------
function elemento(tag) {
  return {
    tag, _t: '', children: [], atributos: {}, ouvintes: {}, hidden: false, disabled: false, checked: false, value: '', type: '', className: '',
    get textContent() { return this._t; },
    set textContent(v) { this._t = v; this.children = []; },
    appendChild(f) { this.children.push(f); },
    setAttribute(k, v) { this.atributos[k] = String(v); },
    addEventListener(t, f) { this.ouvintes[t] = f; }
  };
}
const todos = (no, acc = []) => { acc.push(no); for (const f of no.children) todos(f, acc); return acc; };
const textos = no => todos(no).map(n => n._t).filter(Boolean);

const ADMIN = { id: 1, email: 'a@b.c', papel: 'admin_geral', situacao: 'ativo', permissoes: ['documentos.ver', 'financeiro.ver', 'pedidos.ver'] };
const COMUM = { id: 2, email: 'c@b.c', papel: 'usuario', situacao: 'ativo', permissoes: ['pedidos.ver'] };
const CONVIDADO = { id: 3, email: 'd@b.c', papel: 'usuario', situacao: 'convidado', permissoes: [] };
const OUTRO_ADMIN = { id: 4, email: 'e@b.c', papel: 'admin_geral', situacao: 'ativo', permissoes: ['documentos.ver', 'financeiro.ver', 'pedidos.ver'] };
const INATIVO = { id: 5, email: 'f@b.c', papel: 'usuario', situacao: 'inativo', permissoes: [] };

// roteador: { permissoes (de /eu), usuarios, acoes: função (chamada) => resposta | undefined, confirmar }
function rodar({ permissoes = ['pedidos.ver', 'usuarios.gerir'], usuarios = [ADMIN, COMUM, CONVIDADO], acao, confirmar = () => true } = {}) {
  const el = {};
  const get = id => (el[id] = el[id] || elemento('#' + id));
  get('aviso').hidden = true;
  get('painel').hidden = true;
  const chamadas = [];
  const confirmacoes = [];
  const janela = {
    location: { replace: u => chamadas.push({ replace: u }) },
    confirm: msg => { confirmacoes.push(msg); return confirmar(msg); },
    PortalApi: {
      chamar: async (caminho, corpo, metodo) => {
        const c = { caminho, corpo, metodo };
        chamadas.push(c);
        if (caminho === '/portal/api/eu') return { status: 200, dados: { usuario: { email: 'a@b.c', empresa: { razaoSocial: 'X' }, permissoes } } };
        if (caminho === '/portal/api/usuarios' && corpo === undefined) return { status: 200, dados: { usuarios } };
        return (acao && acao(c)) || { status: 200, dados: { ok: true } };
      }
    }
  };
  const documento = { getElementById: get, createElement: elemento };
  vm.runInNewContext(ler('usuarios.js'), { window: janela, document: documento });
  const botao = (acaoNome, id) => todos(get('lista')).find(n => n.atributos['data-acao'] === acaoNome && n.atributos['data-usuario'] === String(id));
  const marcas = id => todos(get('lista')).filter(n => n.atributos['data-permissao'] && n.atributos['data-usuario'] === String(id));
  return { get, chamadas, confirmacoes, botao, marcas };
}
const soUsuarios = chamadas => chamadas.filter(c => c.caminho && c.caminho !== '/portal/api/eu');

test('sem usuarios.gerir: mostra aviso e não chama /portal/api/usuarios', async () => {
  const { get, chamadas } = rodar({ permissoes: ['pedidos.ver'] });
  await esperar();
  assert.equal(get('aviso').hidden, false);
  assert.equal(get('painel').hidden, true);
  assert.deepEqual(chamadas.map(c => c.caminho), ['/portal/api/eu']);
});

test('401 em /eu leva ao login e não chama a lista', async () => {
  const el = {};
  const get = id => (el[id] = el[id] || elemento(id));
  const chamadas = [];
  const janela = { location: { replace: u => chamadas.push('replace:' + u) }, confirm: () => true,
    PortalApi: { chamar: async c => { chamadas.push(c); return { status: 401, dados: { error: 'x' } }; } } };
  vm.runInNewContext(ler('usuarios.js'), { window: janela, document: { getElementById: get, createElement: elemento } });
  await esperar();
  assert.deepEqual(chamadas, ['/portal/api/eu', 'replace:/portal/login.html']);
});

test('lista os usuários por textContent; e-mail com <script> aparece como texto; painel visível', async () => {
  const xss = { ...COMUM, id: 7, email: '<script>alert(1)</script>@x.com' };
  const { get, chamadas } = rodar({ usuarios: [ADMIN, xss] });
  await esperar();
  assert.equal(get('painel').hidden, false);
  assert.equal(get('aviso').hidden, true);
  assert.equal(chamadas[1].caminho, '/portal/api/usuarios');
  const ts = textos(get('lista'));
  assert.ok(ts.some(t => t.includes('<script>alert(1)</script>@x.com')));
  assert.ok(ts.some(t => t.includes('a@b.c')));
  assert.ok(todos(get('lista')).every(n => n.tag !== 'script' && n.tag !== 'a'));
});

test('id de usuário fora de /^\\d{1,9}$/ não gera botões nem chamadas', async () => {
  const ruim = { ...COMUM, id: '2/../x', email: 'r@b.c' };
  const { get, chamadas } = rodar({ usuarios: [ADMIN, ruim] });
  await esperar();
  assert.ok(textos(get('lista')).some(t => t.includes('r@b.c')));
  assert.ok(todos(get('lista')).every(n => !n.atributos['data-usuario'] || /^\d{1,9}$/.test(n.atributos['data-usuario'])));
  assert.equal(soUsuarios(chamadas).length, 1);
});

test('convite: envia { email, permissoes } por POST; documentos marca pedidos junto', async () => {
  const { get, chamadas } = rodar({ acao: c => (c.metodo === undefined && c.corpo ? { status: 200, dados: { ok: true, enviado: true } } : undefined) });
  await esperar();
  get('convite-email').value = '  Novo@Empresa.com ';
  get('convite-documentos').checked = true;
  get('convite-documentos').ouvintes.change();
  assert.equal(get('convite-pedidos').checked, true);
  get('convite-financeiro').checked = true;
  await get('convidar').ouvintes.click();
  const post = chamadas.find(c => c.corpo && c.caminho === '/portal/api/usuarios');
  assert.ok(post);
  assert.equal(post.corpo.email, 'Novo@Empresa.com');
  assert.deepEqual([...post.corpo.permissoes].sort(), ['documentos.ver', 'financeiro.ver', 'pedidos.ver']);
  assert.ok(post.metodo === undefined || post.metodo === 'POST');
  assert.ok(get('resultado-convite').textContent.length > 0);
  assert.equal(get('convite-email').value, '', 'campo limpo');
  // a lista foi recarregada
  assert.equal(chamadas.filter(c => c.caminho === '/portal/api/usuarios' && c.corpo === undefined).length, 2);
});

test('convite: desmarcar pedidos desmarca documentos; sem permissões envia lista vazia', async () => {
  const { get, chamadas } = rodar({ acao: () => ({ status: 200, dados: { ok: true, enviado: true } }) });
  await esperar();
  get('convite-documentos').checked = true;
  get('convite-documentos').ouvintes.change();
  get('convite-pedidos').checked = false;
  get('convite-pedidos').ouvintes.change();
  assert.equal(get('convite-documentos').checked, false);
  get('convite-email').value = 'x@y.com';
  await get('convidar').ouvintes.click();
  const post = chamadas.find(c => c.corpo && c.caminho === '/portal/api/usuarios');
  assert.deepEqual(plano(post.corpo.permissoes), []);
});

test('convite sem e-mail digitado não chama o servidor', async () => {
  const { get, chamadas } = rodar();
  await esperar();
  await get('convidar').ouvintes.click();
  assert.equal(chamadas.filter(c => c.corpo).length, 0);
  assert.ok(get('erro').textContent.length > 0);
});

test('convite com link: mostra o link como TEXTO (nunca href)', async () => {
  const link = 'https://api.exemplo.com/portal/convite.html#abc123';
  const { get } = rodar({ acao: () => ({ status: 200, dados: { ok: true, enviado: false, link } }) });
  await esperar();
  get('convite-email').value = 'x@y.com';
  await get('convidar').ouvintes.click();
  const alvo = todos(get('resultado-convite')).map(n => n._t).join('|');
  assert.ok(alvo.includes(link), 'link como texto');
  const tudo = todos(get('resultado-convite')).concat(todos(get('lista')));
  assert.ok(tudo.every(n => n.tag !== 'a' && n.atributos.href === undefined));
});

test('convite recusado (409/429): mostra o erro e a lista não é recarregada', async () => {
  for (const [status, error] of [[409, 'Já existe um usuário do portal com este e-mail.'], [429, 'Muitos convites enviados. Aguarde um pouco.'], [400, 'E-mail inválido.']]) {
    const { get, chamadas } = rodar({ acao: () => ({ status, dados: { error } }) });
    await esperar();
    get('convite-email').value = 'x@y.com';
    await get('convidar').ouvintes.click();
    assert.equal(get('erro').textContent, error);
    assert.equal(chamadas.filter(c => c.caminho === '/portal/api/usuarios' && c.corpo === undefined).length, 1);
  }
});

test('botões por situação: admin, comum ativo, convidado e inativo', async () => {
  const { botao } = rodar({ usuarios: [ADMIN, OUTRO_ADMIN, COMUM, CONVIDADO, INATIVO] });
  await esperar();
  assert.ok(botao('rebaixar', 4) && botao('desativar', 4));
  assert.ok(!botao('salvar', 4) && !botao('promover', 4));
  assert.ok(botao('salvar', 2) && botao('promover', 2) && botao('desativar', 2));
  assert.ok(!botao('reenviar', 2) && !botao('remover', 2));
  assert.ok(botao('salvar', 3) && botao('reenviar', 3) && botao('remover', 3) && botao('desativar', 3));
  assert.ok(!botao('promover', 3));
  for (const a of ['salvar', 'promover', 'rebaixar', 'desativar', 'reenviar', 'remover']) assert.ok(!botao(a, 5), 'inativo com ' + a);
});

test('ações: só disparam após confirm() verdadeiro e chamam a rota certa com o id numérico', async () => {
  const casos = [
    ['salvar', 2, '/portal/api/usuarios/2/permissoes', 'PUT', c => assert.deepEqual(c.corpo, { permissoes: ['pedidos.ver'] })],
    ['promover', 2, '/portal/api/usuarios/2/papel', 'POST', c => assert.deepEqual(c.corpo, { papel: 'admin_geral' })],
    ['rebaixar', 4, '/portal/api/usuarios/4/papel', 'POST', c => assert.deepEqual(c.corpo, { papel: 'usuario', permissoes: [] })],
    ['desativar', 2, '/portal/api/usuarios/2/desativar', 'POST', c => assert.deepEqual(c.corpo, {})],
    ['reenviar', 3, '/portal/api/usuarios/3/reenviar_convite', 'POST', c => assert.deepEqual(c.corpo, {})],
    ['remover', 3, '/portal/api/usuarios/3/remover', 'POST', c => assert.deepEqual(c.corpo, {})]
  ];
  for (const [nome, id, caminho, metodo, conferir] of casos) {
    // recusado no confirm: nada é chamado
    let r = rodar({ usuarios: [ADMIN, OUTRO_ADMIN, COMUM, CONVIDADO], confirmar: () => false });
    await esperar();
    let antes = r.chamadas.length;
    await r.botao(nome, id).ouvintes.click();
    assert.equal(r.confirmacoes.length, 1, nome + ': confirm perguntado');
    assert.equal(r.chamadas.length, antes, nome + ': nada chamado sem confirmar');
    // confirmado: chama a rota certa e recarrega a lista
    r = rodar({ usuarios: [ADMIN, OUTRO_ADMIN, COMUM, CONVIDADO], confirmar: () => true });
    await esperar();
    antes = r.chamadas.length;
    await r.botao(nome, id).ouvintes.click();
    const c = r.chamadas[antes];
    assert.equal(c.caminho, caminho, nome);
    assert.equal(c.metodo === undefined ? 'POST' : c.metodo, metodo, nome + ' método');
    conferir({ ...c, corpo: plano(c.corpo) });
    assert.equal(r.chamadas[antes + 1].caminho, '/portal/api/usuarios', nome + ' recarrega');
  }
});

test('salvar permissões envia as caixas marcadas do cartão do usuário', async () => {
  const r = rodar();
  await esperar();
  const m = r.marcas(2);
  assert.deepEqual(m.map(n => n.atributos['data-permissao']).sort(), ['documentos.ver', 'financeiro.ver', 'pedidos.ver']);
  assert.equal(m.find(n => n.atributos['data-permissao'] === 'pedidos.ver').checked, true);
  m.find(n => n.atributos['data-permissao'] === 'financeiro.ver').checked = true;
  m.find(n => n.atributos['data-permissao'] === 'documentos.ver').checked = true;
  m.find(n => n.atributos['data-permissao'] === 'documentos.ver').ouvintes.change();
  await r.botao('salvar', 2).ouvintes.click();
  const c = r.chamadas.find(x => x.metodo === 'PUT');
  assert.deepEqual([...c.corpo.permissoes].sort(), ['documentos.ver', 'financeiro.ver', 'pedidos.ver']);
});

test('salvar com documentos sem pedidos marca pedidos junto antes de enviar', async () => {
  const r = rodar({ usuarios: [ADMIN, CONVIDADO] });
  await esperar();
  const m = r.marcas(3);
  m.find(n => n.atributos['data-permissao'] === 'documentos.ver').checked = true; // sem disparar change
  await r.botao('salvar', 3).ouvintes.click();
  const c = r.chamadas.find(x => x.metodo === 'PUT');
  assert.deepEqual([...c.corpo.permissoes].sort(), ['documentos.ver', 'pedidos.ver']);
});

test('ação sobre o próprio usuário (e-mail de /eu) traz aviso extra no confirm', async () => {
  const r = rodar({ usuarios: [ADMIN, OUTRO_ADMIN], confirmar: () => false });
  await esperar();
  await r.botao('desativar', 1).ouvintes.click();
  await r.botao('desativar', 4).ouvintes.click();
  assert.match(r.confirmacoes[0], /você mesmo/i);
  assert.doesNotMatch(r.confirmacoes[1], /você mesmo/i);
  await r.botao('rebaixar', 1).ouvintes.click();
  assert.match(r.confirmacoes[2], /você mesmo/i);
});

test('erro do servidor (409/404) é mostrado e a lista não é recarregada', async () => {
  for (const [status, error] of [[409, 'A empresa precisa de ao menos um administrador ativo.'], [404, 'Usuário não encontrado.'], [400, 'Permissão inválida.']]) {
    const r = rodar({ acao: () => ({ status, dados: { error } }) });
    await esperar();
    const antes = r.chamadas.length;
    await r.botao('desativar', 2).ouvintes.click();
    assert.equal(r.get('erro').textContent, error);
    assert.equal(r.chamadas.length, antes + 1, 'só a ação, sem recarregar');
    assert.equal(r.botao('desativar', 2).atributos['data-usuario'], '2', 'lista mantida');
  }
});

test('durante a ação os botões ficam desabilitados (sem clique duplo) e voltam ao fim, com sucesso ou erro', async () => {
  for (const resposta of [{ status: 200, dados: { ok: true } }, { status: 409, dados: { error: 'Não.' } }]) {
    let liberar;
    const r = rodar({ usuarios: [ADMIN, OUTRO_ADMIN, COMUM, CONVIDADO], acao: () => new Promise(res => { liberar = () => res(resposta); }) });
    await esperar();
    const botoes = () => todos(r.get('lista')).filter(n => n.atributos['data-acao']);
    const antigos = botoes();
    assert.ok(antigos.length > 5 && antigos.every(b => b.disabled === false));
    const clique = r.botao('desativar', 2).ouvintes.click();
    await esperar();
    assert.ok(antigos.every(b => b.disabled === true), 'todos os botões desabilitados durante a chamada');
    const nAntes = r.chamadas.length;
    await r.botao('remover', 3).ouvintes.click(); // clique duplo/outro botão durante a chamada: ignorado
    assert.equal(r.chamadas.length, nAntes, 'nenhuma segunda chamada');
    assert.equal(r.confirmacoes.length, 1, 'nem o confirm se repete');
    liberar();
    await clique;
    if (resposta.status !== 200) assert.ok(antigos.every(b => b.disabled === false), 'erro: reabilitados');
    else assert.ok(botoes().every(b => b.disabled === false), 'sucesso: lista nova, botões habilitados');
  }
});

test('o botão Convidar também fica desabilitado durante a chamada e volta ao fim', async () => {
  let liberar;
  const r = rodar({ acao: () => new Promise(res => { liberar = () => res({ status: 400, dados: { error: 'E-mail inválido.' } }); }) });
  await esperar();
  r.get('convite-email').value = 'x@y.com';
  const clique = r.get('convidar').ouvintes.click();
  await esperar();
  assert.equal(r.get('convidar').disabled, true);
  liberar();
  await clique;
  assert.equal(r.get('convidar').disabled, false);
});

test('se a recarga da lista responder 403 (perdeu a gestão), esconde o painel e mostra o aviso', async () => {
  let recargas = 0;
  const el = {};
  const get = id => (el[id] = el[id] || elemento('#' + id));
  get('aviso').hidden = true;
  get('painel').hidden = true;
  const janela = { location: { replace() {} }, confirm: () => true,
    PortalApi: { chamar: async (caminho, corpo) => {
      if (caminho === '/portal/api/eu') return { status: 200, dados: { usuario: { email: 'a@b.c', permissoes: ['usuarios.gerir'] } } };
      if (caminho === '/portal/api/usuarios' && corpo === undefined) {
        recargas++;
        return recargas === 1 ? { status: 200, dados: { usuarios: [ADMIN, OUTRO_ADMIN] } } : { status: 403, dados: { error: 'Sem permissão.' } };
      }
      return { status: 200, dados: { ok: true } };
    } } };
  vm.runInNewContext(ler('usuarios.js'), { window: janela, document: { getElementById: get, createElement: elemento } });
  await esperar();
  assert.equal(get('painel').hidden, false);
  const b = todos(get('lista')).find(n => n.atributos['data-acao'] === 'rebaixar' && n.atributos['data-usuario'] === '1');
  await b.ouvintes.click();
  assert.equal(get('painel').hidden, true);
  assert.equal(get('aviso').hidden, false);
  assert.equal(get('aviso').textContent, 'Você não tem mais acesso a esta tela.');
});

test('o último administrador continua com Desativar e Tornar usuário comum (o servidor é quem recusa)', async () => {
  const { botao } = rodar({ usuarios: [ADMIN] });
  await esperar();
  assert.ok(botao('desativar', 1) && botao('rebaixar', 1));
});

test('ação com 401 leva ao login', async () => {
  const r = rodar({ acao: () => ({ status: 401, dados: { error: 'x' } }) });
  await esperar();
  await r.botao('desativar', 2).ouvintes.click();
  assert.deepEqual(r.chamadas[r.chamadas.length - 1], { replace: '/portal/login.html' });
});

test('sucesso de reenviar sem e-mail enviado mostra o link como texto', async () => {
  const link = 'https://api.exemplo.com/portal/convite.html#zzz';
  const r = rodar({ acao: () => ({ status: 200, dados: { ok: true, enviado: false, link } }) });
  await esperar();
  await r.botao('reenviar', 3).ouvintes.click();
  assert.ok(todos(r.get('resultado-convite')).some(n => n._t.includes(link)));
});

test('falha ao carregar a lista mostra o erro', async () => {
  const el = {};
  const get = id => (el[id] = el[id] || elemento(id));
  const janela = { location: { replace() {} }, confirm: () => true,
    PortalApi: { chamar: async c => (c === '/portal/api/eu'
      ? { status: 200, dados: { usuario: { email: 'a@b.c', permissoes: ['usuarios.gerir'] } } }
      : { status: 500, dados: { error: 'Erro de servidor' } }) } };
  vm.runInNewContext(ler('usuarios.js'), { window: janela, document: { getElementById: get, createElement: elemento } });
  await esperar();
  assert.equal(get('erro').textContent, 'Erro de servidor');
});
