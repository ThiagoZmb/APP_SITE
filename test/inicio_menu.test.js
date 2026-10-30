const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ler = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

// o arquivo é de navegador: um window/document mínimos bastam para o iniciar() montar os ouvintes e devolver itensDoMenu
function carregarMenu(permissoes) {
  global.window = { addEventListener() {}, innerWidth: 1000, abrirPdfAutenticado() {} };
  global.document = { addEventListener() {} };
  delete require.cache[require.resolve('../inicio_menu.js')];
  require('../inicio_menu.js');
  return global.window.InicioMenu.iniciar({ apiBase: 'https://api', loginUrl: 'login', token: () => 't', docDe: () => null, recarregar() {}, esc: s => s,
    pode: p => String(p).split(' ').every(x => permissoes.has(x)) });
}
const rotulos = it => it.filter(x => x.rotulo).map(x => x.rotulo);

test('menu do botão direito do início: administrador vê PDFs, imprimir, editar, cortes, situação e entrega', () => {
  const m = carregarMenu(new Set(['pedidos.pdf', 'orcamentos.criar', 'valores.ver', 'corte.ver', 'pedidos.situacao', 'entregas.ver']));
  const it = m.itensDoMenu({ numero: 7, cliente: 'X', situacao: 'Em Produção', entregaStatus: 'agendada' });
  assert.deepEqual(rotulos(it), ['Abrir PDF', 'Guia de produção (PDF sem valores)', 'Vidros (PDF)', 'Imprimir PDF', 'Imprimir guia de produção', 'Imprimir vidros',
    'Abrir para editar', 'Corte de perfil', 'Corte de vidros', 'Em Produção', 'Pronto', 'Entregue', 'Retirado', 'Ver entrega (Agendada)']);
  assert.ok(it.find(x => x.rotulo === 'Em Produção').desativado, 'a situação atual fica marcada e desativada');
  assert.ok(!rotulos(it).some(r => /cancelar|excluir/i.test(r)), 'nada destrutivo neste menu');
  assert.ok(it[it.length - 1].rotulo && !it[it.length - 1].sep, 'não termina em separador');
});

test('menu do início respeita as permissões e esconde cortes e situação de pedido cancelado', () => {
  const so = carregarMenu(new Set(['pedidos.pdf']));
  assert.deepEqual(rotulos(so.itensDoMenu({ numero: 1, situacao: 'Pronto' })), ['Abrir PDF', 'Guia de produção (PDF sem valores)', 'Vidros (PDF)', 'Imprimir PDF', 'Imprimir guia de produção', 'Imprimir vidros']);
  const nada = carregarMenu(new Set());
  assert.deepEqual(nada.itensDoMenu({ numero: 1, situacao: 'Pronto' }), []);
  const tudo = carregarMenu(new Set(['pedidos.pdf', 'corte.ver', 'pedidos.situacao', 'entregas.ver']));
  const canc = rotulos(tudo.itensDoMenu({ numero: 2, situacao: 'Cancelado', entregaStatus: 'cancelada' }));
  assert.ok(!canc.includes('Corte de perfil') && !canc.includes('Pronto'), 'pedido cancelado: sem cortes nem mudança de situação');
  assert.ok(canc.includes('Ver entrega (Cancelada)'));
});

test('início: listas com data-numero, script e menu ligados, CSP libera iframe de blob e o serviço local', () => {
  const h = ler('inicio.html');
  assert.equal((h.match(/<li data-numero="\$\{escapeHtml\(p\.numero\)\}"/g) || []).length, 2, 'últimos pedidos e entregas da semana');
  assert.ok(h.includes('<script src="inicio_menu.js'));
  assert.ok(h.includes('window.InicioMenu.iniciar({'));
  const csp = h.match(/Content-Security-Policy" content="([^"]+)"/)[1];
  assert.ok(/frame-src blob:/.test(csp) && /http:\/\/127\.0\.0\.1:3917/.test(csp) && !/upgrade-insecure-requests/.test(csp));
  assert.ok(h.includes('pedidosInicio = pedidos;'));
});

test('as listas do início (entregas da semana e últimos pedidos) e o menu usam SÓ pedidos (tipo Pedido), nunca orçamentos', () => {
  const h = ler('inicio.html'), m = ler('inicio_menu.js');
  // os dois cards saem da lista de pedidos; a de orçamentos só alimenta os indicadores
  assert.ok(h.includes("api('/dados_lista?tipo=Pedido'), api('/dados_lista?tipo=Orçamento')"));
  assert.ok(h.includes("$('ultimos').innerHTML = pedidos.slice(0, 6)") && h.includes('const entregas = pedidos\n') || h.includes('const entregas = pedidos\r\n'));
  assert.ok(!/const entregas = orcamentos|\$\('ultimos'\)\.innerHTML = orcamentos/.test(h));
  // o menu só fala com o tipo Pedido
  assert.ok(m.includes('tipo=Pedido') && m.includes('/ped_orc/Pedido/') && m.includes('orcamentos.html?abrir=Pedido/'));
  assert.ok(!/ped_orc\/Orçamento|abrir=Orçamento|tipo=Orçamento|tipo=Orcamento/.test(m), 'nenhuma ação do menu aponta para orçamento');
  // o servidor também filtra: /dados_lista tem WHERE p.TIPO = ? e a rota de situação recusa tipo diferente de Pedido
  const idx = ler('index.js'), ped = ler('rotas/ped_orc.js');
  assert.ok(idx.includes('WHERE p.TIPO = ?') && idx.includes("const tipo = req.query.tipo === 'Orçamento' ? 'Orçamento' : 'Pedido';"));
  assert.ok(ped.includes("if (alvo.tipo !== 'Pedido') return res.status(400).json({ error: 'Só pedidos têm situação"));
});
