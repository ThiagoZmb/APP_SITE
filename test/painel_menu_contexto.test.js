// Menu do botão direito em painel_inicial.html: conferência estática (a tela não tem testes de DOM)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const h = fs.readFileSync(path.join(__dirname, '..', 'painel_inicial.html'), 'utf8');

test('painel_inicial: menu de contexto nas linhas com PDF, guia de produção, situação, entrega, copiar, cancelar e excluir', () => {
  assert.match(h, /addEventListener\('contextmenu'/);
  assert.match(h, /producao=1/);
  for (const perm of ['pedidos.pdf', 'pedidos.situacao', 'entregas.ver', 'pedidos.cancelar', 'pedidos.excluir', 'orcamentos.criar valores.ver']) assert.ok(h.includes("'" + perm + "'"), perm);
  assert.ok(h.includes('/situacao'));
  for (const s of ['Em Produção', 'Pronto', 'Entregue', 'Retirado']) assert.ok(h.includes("'" + s + "'") || h.includes(': ' + "'" + s + "'"), s);
});

test('painel_inicial: api() mantém o Authorization e aceita cabeçalhos extras (JSON do POST de situação)', () => {
  assert.ok(h.includes("headers: { ...(opcoes.headers || {}), 'Authorization'"));
});

test('painel_inicial: nomes do menu escapados (esc) e sem handlers inline novos', () => {
  const bloco = h.slice(h.indexOf('menu do botão direito: ações'), h.indexOf("$('chips-sit').addEventListener"));
  assert.ok(bloco.length > 500);
  assert.ok(bloco.includes('esc(it.rotulo)'));
  assert.doesNotMatch(bloco, /onclick=|onerror=/);
});

// executa o itensDoMenu real do painel_inicial.html com permissões simuladas
function menuDoPainel(permissoes, tipoLista, x) {
  const vm = require('node:vm');
  const ini = h.indexOf('function itensDoMenu(x)');
  const fim = h.indexOf('let menuCtx = null');
  assert.ok(ini > 0 && fim > ini);
  const ctx = {
    Acesso: { pode: p => String(p).split(/\s+/).every(c => permissoes.has(c)) },
    tipoLista, SITUACAO_NOME: { em_producao: 'Em Produção', pronto: 'Pronto' }, ROT_ENTREGA: {},
    norm: s => String(s ?? '').toLowerCase(), urlPdf: () => 'u', API_BASE: 'https://api',
    abrirPdfAutenticado() {}, imprimirPdf() {}, mudarSituacao() {}, mudarSituacaoOrcamento() {}, acaoNoDocumento() {},
    voltarParaEstaPagina: () => 'x', location: {}
  };
  vm.createContext(ctx);
  vm.runInContext(h.slice(ini, fim) + '\nthis.itensDoMenu = itensDoMenu;', ctx);
  return Array.from(ctx.itensDoMenu(x)).filter(i => i.rotulo).map(i => String(i.rotulo));
}

test('menu do botão direito: quem só tem pedidos.pdf (perfil Representante) vê somente as opções de PDF', () => {
  const rep = new Set(['pedidos.pdf']);
  const ped = menuDoPainel(rep, 'Pedido', { numero: 1, s: 'pronto', entregaStatus: 'agendada' });
  assert.deepEqual(ped, ['Abrir PDF', 'Guia de produção (PDF sem valores)', 'Vidros (PDF)', 'Imprimir PDF', 'Imprimir guia de produção', 'Imprimir vidros']);
  const orc = menuDoPainel(rep, 'Orçamento', { numero: 2, s: 'aberto', situacao: '' });
  assert.deepEqual(orc, ['Abrir PDF', 'Imprimir orçamento']);
  // sem pedidos.pdf, nada de PDF
  assert.deepEqual(menuDoPainel(new Set(['pedidos.ver', 'valores.ver', 'clientes.ver']), 'Pedido', { numero: 1, s: 'pronto' }), []);
});

test('menu do botão direito: editar, cortes, situação, entrega, cancelar e excluir exigem a permissão certa', () => {
  const x = { numero: 1, s: 'pronto', entregaStatus: 'agendada' };
  const so = (p) => menuDoPainel(new Set(['pedidos.pdf', ...p]), 'Pedido', x);
  assert.ok(!so(['orcamentos.criar']).includes('Abrir para editar'), 'editar exige orcamentos.criar + valores.ver');
  assert.ok(so(['orcamentos.criar', 'valores.ver']).includes('Abrir para editar'));
  assert.ok(so(['corte.ver']).includes('Corte de perfil') && !so([]).includes('Corte de perfil'));
  assert.ok(so(['pedidos.situacao']).includes('Pronto') && !so([]).includes('Pronto'));
  assert.ok(so(['entregas.ver']).some(r => r.startsWith('Ver entrega')) && !so([]).some(r => r.startsWith('Ver entrega')));
  assert.ok(so(['pedidos.cancelar']).includes('Cancelar pedido') && !so([]).includes('Cancelar pedido'));
  assert.ok(so(['pedidos.excluir']).includes('Excluir pedido') && !so([]).includes('Excluir pedido'));
});

test('perfil Representante inicial: só listar, abrir PDF, clientes e valores (nada de editar/orçamento/cancelar)', () => {
  const { PERFIS_INICIAIS } = require('../seguranca/permissoes');
  const rep = (PERFIS_INICIAIS || []).find(p => p.nome === 'Representante');
  assert.ok(rep, 'perfil Representante existe');
  for (const c of ['pedidos.ver', 'pedidos.pdf']) assert.ok(rep.permissoes.includes(c), c);
  for (const c of ['orcamentos.criar', 'orcamentos.salvar', 'pedidos.situacao', 'pedidos.cancelar', 'pedidos.excluir', 'corte.ver', 'entregas.ver']) assert.ok(!rep.permissoes.includes(c), c);
});
