// Tela de dependências do perfil: lógica pura e conferência do HTML.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const T = require('../produtos_dependencias_tela.js');

const grav = { tiposProduto: ['Porta'], acabamentos: ['Branco', 'Preto'], puxadores: [], revestimentos: ['ACM'], divisores: [] };

test('diferenca/resumo: adicionados e removidos sem diferenciar maiúsculas', () => {
  const atual = { ...grav, acabamentos: ['branco', 'Bronze'], puxadores: ['P1'] };
  const r = T.resumo(grav, atual);
  assert.deepEqual(r.acabamentos.adicionados, ['Bronze']);
  assert.deepEqual(r.acabamentos.removidos, ['Preto']);
  assert.deepEqual(r.puxadores.adicionados, ['P1']);
  assert.equal(r.tiposProduto.alterado, false);
  assert.deepEqual(T.gruposAlterados(grav, atual), ['acabamentos', 'puxadores']);
  assert.deepEqual(T.totais(grav, atual), { adicionados: 2, removidos: 1 });
  assert.deepEqual(T.gruposAlterados(grav, grav), []);
});

test('grupo que ficaria vazio: ficaVazio, confirmação e confirmarVazio só do grupo', () => {
  const atual = { ...grav, revestimentos: [] };
  assert.equal(T.resumo(grav, atual).revestimentos.ficaVazio, true);
  assert.equal(T.precisaConfirmar(grav, atual), true);
  assert.match(T.textoConfirmacao(grav, atual), /Revestimentos - remover: ACM[\s\S]*VAZIO/);
  assert.deepEqual(T.corpoPut(grav, atual, []), { revestimentos: [] });
  assert.deepEqual(T.corpoPut(grav, atual, ['revestimentos']), { revestimentos: [], confirmarVazio: { revestimentos: true } });
  assert.equal(T.precisaConfirmar(grav, { ...grav, puxadores: ['P1'] }), false);
});

test('corpoPut envia só os grupos alterados', () => {
  const corpo = T.corpoPut(grav, { ...grav, divisores: ['D1'] }, []);
  assert.deepEqual(corpo, { divisores: ['D1'] });
  assert.deepEqual(T.corpoPut(grav, grav, []), {});
});

test('alternar marca/desmarca sem duplicar', () => {
  assert.deepEqual(T.alternar(['A'], 'B', true), ['A', 'B']);
  assert.deepEqual(T.alternar(['A', 'B'], 'b', false), ['A']);
  assert.deepEqual(T.alternar(['A'], 'a', true), ['A']);
});

test('itensDoGrupo: marcados do topo primeiro, fora das opções continua, filtro sem acento', () => {
  const it = T.itensDoGrupo(['Branco', 'Cinza', 'Preto'], ['Antigo'], ['Antigo', 'Preto'], ['Antigo', 'Preto'], '');
  assert.deepEqual(it.map(x => x.valor), ['Preto', 'Antigo', 'Branco', 'Cinza']);
  assert.equal(it[1].foraDasOpcoes, true);
  assert.equal(it[1].marcado, true);
  assert.equal(it[2].marcado, false);
  assert.deepEqual(T.itensDoGrupo(['Cinza Grafíte'], [], [], [], 'grafite').map(x => x.valor), ['Cinza Grafíte']);
  assert.deepEqual(T.itensDoGrupo(['Branco', 'Preto'], [], [], [], 'pre').map(x => x.valor), ['Preto']);
});

test('aplicarCopia: por grupo ou todos, só valores válidos, devolve ignorados', () => {
  const opcoes = { tiposProduto: ['Porta'], acabamentos: ['Branco', 'Preto', 'Bronze'], puxadores: ['P1'], revestimentos: [], divisores: [] };
  const outro = { tiposProduto: ['Porta', 'Janela'], acabamentos: ['bronze'], puxadores: ['P1'], revestimentos: ['X'], divisores: [] };
  const um = T.aplicarCopia(grav, outro, ['acabamentos'], opcoes, grav);
  assert.deepEqual(um.atuais.acabamentos, ['Bronze']);
  assert.deepEqual(um.atuais.tiposProduto, ['Porta']);
  assert.deepEqual(um.ignorados, {});
  const todos = T.aplicarCopia(grav, outro, null, opcoes, grav);
  assert.deepEqual(todos.atuais.tiposProduto, ['Porta']);
  assert.deepEqual(todos.ignorados, { tiposProduto: ['Janela'], revestimentos: ['X'] });
  assert.deepEqual(todos.atuais.revestimentos, []);
  assert.deepEqual(grav.acabamentos, ['Branco', 'Preto'], 'não altera a entrada');
});

test('mensagemErro: português por tipo de erro', () => {
  assert.match(T.mensagemErro({ status: 400, dados: { invalidos: { puxadores: ['Z'] } } }), /Puxadores: Z/);
  assert.match(T.mensagemErro({ status: 400, dados: { gruposVazios: ['divisores'] } }), /Divisores/);
  assert.match(T.mensagemErro({ status: 403 }), /permissão/);
  assert.match(T.mensagemErro({ status: 404 }), /não encontrado/);
  assert.match(T.mensagemErro({ status: 409, dados: {} }), /ao mesmo tempo/);
  assert.match(T.mensagemErro({ status: 500 }), /suas marcações continuam/);
  assert.match(T.mensagemErro(new Error('rede')), /servidor/);
});

test('produtos.html: script carregado antes do uso, container com data-perm, sem alert nativo no editor', () => {
  const h = fs.readFileSync(path.join(__dirname, '..', 'produtos.html'), 'utf8');
  assert.match(h, /<script src="produtos_dependencias_tela\.js\?v=\d+"><\/script>/);
  assert.ok(h.indexOf('produtos_dependencias_tela.js') < h.indexOf('const DEP = window.ProdutosDependenciasTela'));
  assert.match(h, /id="dep-editor" data-perm="produtos\.dependencias"/);
  assert.match(h, /Salvar dependências/);
  assert.match(h, /aria-live="polite"/);
  assert.equal(/\balert\(/.test(h.slice(h.indexOf('DEPENDÊNCIAS DO PERFIL'), h.indexOf('// ============ FICHA'))), false);
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'produtos_dependencias_tela.js')));
});
