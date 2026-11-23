// Livro de regras na tela de orçamentos: lógica pura de regras_tela.js e conferência do HTML estático (tela NÃO testada em navegador real).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const R = require('../regras_tela.js');

const html = fs.readFileSync(path.join(__dirname, '..', 'orcamentos.html'), 'utf8').replace(/\r\n/g, '\n');
const corpoDe = (nome) => {
  const ini = html.indexOf(nome);
  assert.ok(ini >= 0, nome + ' existe');
  const prox = html.indexOf('\n        function ', ini + 10);
  const prox2 = html.indexOf('\n        const ', ini + 10);
  return html.slice(ini, Math.min(...[prox, prox2].filter(n => n > 0)));
};

test('soDigitos: tira tudo que não é dígito (digitar e colar)', () => {
  assert.equal(R.soDigitos('12,5'), '125');
  assert.equal(R.soDigitos('-3'), '3');
  assert.equal(R.soDigitos('1.200 mm'), '1200');
  assert.equal(R.soDigitos('abc'), '');
  assert.equal(R.soDigitos(null), '');
  assert.equal(R.soDigitos(40), '40');
});

test('camposComNaoDigito: texto cru com decimal/sinal/letra aponta o campo; vazio e dígitos passam', () => {
  const r = R.camposComNaoDigito([
    { rotulo: 'Altura', valor: '2000,5' }, { rotulo: 'Largura', valor: '800' }, { rotulo: 'Quantidade', valor: '' },
    { rotulo: 'Soldas', valor: '-1' }, { rotulo: 'Transpasse', valor: '1e3' }, { rotulo: 'Furo 1', valor: ' 100 ' }, { rotulo: 'Prof', valor: '2.0' }]);
  assert.deepEqual(r, ['Altura', 'Soldas', 'Transpasse', 'Prof']);
  assert.deepEqual(R.camposComNaoDigito(null), []);
  assert.match(R.textoNaoInteiro(['Altura', 'Soldas']), /Altura, Soldas/);
});

test('avaliar: bloqueia para tudo sem perguntar; confirma/avisa perguntam e gravam os códigos aceitos', () => {
  const perguntas = [];
  const sim = t => { perguntas.push(t); return true; };
  const b = R.avaliar([{ codigo: 'a', nivel: 'bloqueia', mensagem: 'M1' }, { codigo: 'b', nivel: 'confirma', mensagem: 'M2' }, { codigo: 'c', nivel: 'bloqueia', mensagem: 'M3' }], sim);
  assert.deepEqual(b, { ok: false, bloqueios: ['M1', 'M3'], confirmacoes: [] });
  assert.equal(perguntas.length, 0);

  const ok = R.avaliar([{ codigo: 'x', nivel: 'confirma', mensagem: 'Medida pequena' }, { codigo: 'y', nivel: 'avisa', mensagem: 'Atenção' }], sim);
  assert.deepEqual(ok, { ok: true, bloqueios: [], confirmacoes: ['x', 'y'] });
  assert.equal(perguntas.length, 2);
  assert.match(perguntas[0], /Medida pequena/);
  assert.match(perguntas[0], /OK = continuar assim · Cancelar = corrigir/);

  const nao = R.avaliar([{ codigo: 'x', nivel: 'confirma', mensagem: 'm' }, { codigo: 'y', nivel: 'avisa', mensagem: 'n' }], () => false);
  assert.deepEqual(nao, { ok: false, bloqueios: [], confirmacoes: [] });
  assert.deepEqual(R.avaliar([], sim), { ok: true, bloqueios: [], confirmacoes: [] });
  assert.deepEqual(R.avaliar(undefined, sim), { ok: true, bloqueios: [], confirmacoes: [] });
});

test('tela: regras_tela.js é carregado e consultarRegras chama a rota com token e trata 401', () => {
  assert.match(html, /<script src="regras_tela\.js/);
  const c = corpoDe('async function consultarRegras');
  assert.ok(c.includes('/regras/verificar_item'));
  assert.ok(c.includes("'Authorization': 'Bearer ' + getToken()"));
  assert.ok(c.includes('res.status === 401') && c.includes('LOGIN_URL'));
  assert.ok(c.includes('RegrasTela.avaliar'));
  assert.ok(c.includes('catch'), 'erro de rede não passa batido');
  assert.match(c, /ok:\s*false/);
});

test('adicionarItem: consulta o livro depois das checagens locais e do coletarForm, antes do push; erro não adiciona', () => {
  const a = corpoDe('async function adicionarItem');
  const iCheck = a.indexOf('temClienteSelecionado()');
  const iCru = a.indexOf('textoCruNaoInteiro');
  const iColeta = a.indexOf('coletarForm()');
  const iValor = a.indexOf('item.valor <= 0');
  const iConsulta = a.indexOf('await consultarRegras(item)');
  const iPush = a.indexOf('itens.push(item)');
  const iEdit = a.indexOf('itens[editandoIndex] = item');
  assert.ok(iCheck >= 0 && iCru > iCheck && iColeta > iCru, 'texto cru conferido antes do coletarForm');
  assert.ok(iValor > iColeta && iConsulta > iValor, 'consulta depois das checagens locais');
  assert.ok(iConsulta < iPush && iConsulta < iEdit, 'consulta antes de adicionar/atualizar');
  assert.match(a, /if \(!regras\.ok\) return;/);
  assert.ok(a.includes('item.confirmacoes = regras.confirmacoes'), 'códigos aceitos vão em item.confirmacoes');
  assert.ok(a.includes('delete item.confirmacoes') || a.includes('item.confirmacoes ='), 'edição não reaproveita as confirmações do item antigo');
  assert.ok(a.includes('consultandoRegras'), 'trava de clique duplo');
  // preserva o resto do fluxo
  assert.ok(a.includes('definirDesenho(item, capturarDesenho())'));
  assert.ok(a.includes('AuditoriaCalculo.valorAoAtualizar'));
});

test('salvar: confirmacoes de cada item viajam no corpo do POST /ped_orc/salvar', () => {
  assert.match(html, /itens: itens\.map\(it => \(\{[^]*?confirmacoes: Array\.isArray\(it\.confirmacoes\) \? it\.confirmacoes : \[\]/);
});

test('campos de tamanho e quantidade: texto numérico com data-inteiro; dinheiro e % de desconto continuam number', () => {
  const inteiros = ['f-transpasse', 'f-qtd', 'f-altura', 'f-largura', 'f-altura-serr', 'f-qtd-a', 'f-largura-serr', 'f-qtd-l', 'f-profundidade', 'f-qtd-p',
    'f-soldas', 'f-tamanho-pux', 'f-div-h', 'f-div-v', 'f-av-alt', 'f-av-larg'];
  for (const id of inteiros) {
    const m = html.match(new RegExp('<input[^>]*id="' + id + '"[^>]*>'));
    assert.ok(m, id + ' existe');
    assert.ok(/type="text"/.test(m[0]) && /inputmode="numeric"/.test(m[0]) && /data-inteiro/.test(m[0]), id + ' texto numérico com filtro: ' + m[0]);
  }
  for (const id of ['desconto', 'avl-pct']) {
    const m = html.match(new RegExp('<input[^>]*id="' + id + '"[^>]*>'));
    assert.ok(m && /type="number"/.test(m[0]) && !/data-inteiro/.test(m[0]), id + ' não mudou');
  }
  // linhas criadas por script: furos, largura de cada porta de correr, quantidade de acessório e de complemento
  assert.match(html, /<input type="text" inputmode="numeric" data-inteiro[^>]*>(?:<span>mm<\/span>)/);
  assert.match(html, /Porta \$\{i \+ 1\}<input type="text" inputmode="numeric" data-inteiro/);
  assert.match(html, /<input type="text" inputmode="numeric" data-inteiro class="cp-qtd"/);
  assert.match(html, /<input type="text" inputmode="numeric" data-inteiro class="ac-qtd"/);
});

test('filtro de dígitos: um ouvinte de input em fase de captura limpa os campos data-inteiro (digitar e colar)', () => {
  assert.match(html, /document\.addEventListener\('input', [^]*?\[data-inteiro\][^]*?RegrasTela\.soDigitos[^]*?, true\)/);
});

test('nada na tela depende de type=number nos campos trocados', () => {
  assert.ok(!/valueAsNumber|\.stepUp|\.stepDown/.test(html));
  assert.ok(!/input\[type=["']?number/.test(html));
});

test('conferência do texto cru cobre os campos estáticos e as linhas dinâmicas, também ao inserir peça', () => {
  const f = corpoDe('function textoCruNaoInteiro');
  for (const id of ['f-altura', 'f-qtd', 'f-tamanho-pux', 'f-div-h', 'f-av-alt', 'f-soldas']) assert.ok(f.includes(id) || html.includes(`['${id}'`), id);
  assert.ok(f.includes('#pnl-furacoes input') && f.includes('.ac-qtd') && f.includes('.cp-qtd') && f.includes('#correr-larguras input'));
  assert.ok(corpoDe('async function inserirPecaSerr').includes('textoCruNaoInteiro'));
});
