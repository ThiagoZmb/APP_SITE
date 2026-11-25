const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const raiz = path.join(__dirname, '..');
const fonte = fs.readFileSync(path.join(raiz, 'layout.js'), 'utf8');

// expressão de uma constante de nível de módulo do layout.js (ex.: 'const SO_CONSULTA =')
function regexDe(prefixo) {
  const linha = fonte.split(/\r?\n/).find(l => l.trim().startsWith(prefixo));
  assert.ok(linha, prefixo + ' encontrado');
  const valor = vm.runInNewContext(linha.trim().slice(prefixo.length).replace(/;\s*$/, ''));
  assert.equal(Object.prototype.toString.call(valor), '[object RegExp]', prefixo + ' é RegExp');
  return valor;
}

// a função real ehGravacao(alvo, args), extraída do layout.js e executada com as mesmas regras
const METODOS_GRAVACAO = regexDe('const METODOS_GRAVACAO =');
const SO_CONSULTA = regexDe('const SO_CONSULTA =');
const trecho = fonte.match(/function ehGravacao\(alvo, args\) \{[\s\S]*?\n {8}\}/);
assert.ok(trecho, 'função ehGravacao encontrada no layout.js');
const ehGravacao = vm.runInNewContext('(' + trecho[0] + ')', { METODOS_GRAVACAO, SO_CONSULTA });

const URL = 'https://api.exemplo.com';

test('gravações: POST, PUT e PATCH contam como "Salvando" (método no init)', () => {
  assert.equal(ehGravacao(URL + '/ped_orc/salvar', [URL + '/ped_orc/salvar', { method: 'POST' }]), true);
  assert.equal(ehGravacao(URL + '/clientes/9', [URL + '/clientes/9', { method: 'PUT' }]), true);
  assert.equal(ehGravacao(URL + '/x', [URL + '/x', { method: 'PATCH' }]), true);
  assert.equal(ehGravacao(URL + '/x', [URL + '/x', { method: 'post' }]), true, 'método em minúsculas também');
});

test('gravações: método vindo de um Request (sem init) também conta', () => {
  assert.equal(ehGravacao('https://a/estoque/saida', [{ url: 'https://a/estoque/saida', method: 'POST' }]), true);
});

test('consultas: GET, DELETE e chamadas sem método continuam "Carregando"', () => {
  assert.equal(ehGravacao(URL + '/entregas', [URL + '/entregas']), false, 'sem init = GET');
  assert.equal(ehGravacao(URL + '/entregas', [URL + '/entregas', { method: 'GET' }]), false);
  assert.equal(ehGravacao(URL + '/checklist', [URL + '/checklist', { method: 'DELETE' }]), false);
  assert.equal(ehGravacao('https://a/x', [{ url: 'https://a/x', method: 'GET' }]), false);
});

test('excluídas: login, logout, verificação de regras, leitura de PDF/imagem, cálculos e consultas com POST', () => {
  const excluidas = [
    '/login', '/logout', '/portal/api/logout', '/regras/verificar_item', '/leitura_pdf',
    '/leitura_pdf/42/confirmar', '/perfil_secoes/1036/ler_imagem', '/calcular_preco', '/calcular_preco?debug=1',
    '/peso/itens', '/danfe/existentes', '/estoque/codigo_barras'
  ];
  for (const c of excluidas) {
    assert.equal(ehGravacao(URL + c, [URL + c, { method: 'POST' }]), false, 'POST ' + c + ' não mostra Salvando');
  }
});

test('o que não está na lista de exclusão continua gravação mesmo com nome parecido', () => {
  assert.equal(ehGravacao(URL + '/estoque/saida', [URL + '/estoque/saida', { method: 'POST' }]), true);
  assert.equal(ehGravacao(URL + '/loginx', [URL + '/loginx', { method: 'POST' }]), true, 'não casa /login por prefixo');
  assert.equal(ehGravacao(URL + '/leituras/salvar', [URL + '/leituras/salvar', { method: 'POST' }]), true);
});

test('wiring: o contador de gravações alimenta o texto e o fetch repassa o tipo ao fim da chamada', () => {
  assert.match(fonte, /function comecou\(gravacao\) \{\s*if \(gravacao\) gravacoes\+\+;/);
  assert.match(fonte, /function terminou\(gravacao\) \{\s*if \(gravacao\) gravacoes--;/);
  assert.match(fonte, /const gravacao = ehGravacao\(alvo, args\);\s*comecou\(gravacao\);/);
  assert.match(fonte, /p\.finally\(\(\) => \{ terminou\(gravacao\); if \(el\) liberar\(el\); \}\)/);
  assert.match(fonte, /const t = gravacoes > 0 \? 'Salvando' : 'Carregando';/);
  assert.match(fonte, /const noTexto = barra\.querySelector\('\.cg-texto'\)\.firstChild;\s*noTexto\.nodeValue = t;/);
  assert.match(fonte, /barra\.setAttribute\('aria-label', t\)/);
});

test('o texto troca só o nó de texto: os 3 <b> continuam no HTML do indicador', () => {
  assert.ok(fonte.includes('<div class="cg-texto">Carregando<b></b><b></b><b></b></div>'));
});

test('SEGUNDO_PLANO continua acima da contagem (sem indicador, sem contar como gravação)', () => {
  assert.match(fonte, /if \(SEGUNDO_PLANO\.test\(alvo\)\) return fetchOriginal\(\.\.\.args\);\s*const el/);
});

test('versão do layout.js: a mesma em todos os .html e maior que a anterior (202611291300)', () => {
  const pasta = fs.readdirSync(raiz).filter(f => f.endsWith('.html'));
  const versoes = new Set();
  for (const f of pasta) {
    const t = fs.readFileSync(path.join(raiz, f), 'utf8');
    for (const m of t.matchAll(/layout\.js\?v=(\d+)/g)) versoes.add(m[1]);
  }
  assert.equal(versoes.size, 1, 'uma única versão: ' + [...versoes].join(', '));
  assert.ok(Number([...versoes][0]) > 202611291300);
});
