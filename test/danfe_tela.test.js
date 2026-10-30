// Telas do DANFE: lógica pura (danfe_envio.js, danfe_pedido.js) e conferência do HTML/layout/menus estáticos.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const E = require('../danfe_envio.js');
const P = require('../danfe_pedido.js');
const S = require('../calculo/danfe');

const ler = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const CHAVE = '32260608951388000118550010000112901000002850';
const dvDe = base => { let s = 0, p = 2; for (let i = 42; i >= 0; i--) { s += Number(base[i]) * p; p = p === 9 ? 2 : p + 1; } const r = s % 11; return r < 2 ? 0 : 11 - r; };
const trocarDv = c => c.slice(0, 43) + ((Number(c[43]) + 1) % 10);
const arq = (name, size = 1000) => ({ name, size });

test('danfe tela: chaveValida e chaveDoNome (mesma regra do servidor)', () => {
  assert.equal(E.chaveValida(CHAVE), true);
  assert.equal(E.chaveValida(trocarDv(CHAVE)), false);
  assert.equal(E.chaveValida('123'), false);
  assert.equal(E.chaveDoNome(CHAVE + '.pdf'), CHAVE);
  assert.equal(E.chaveDoNome('pasta\\sub/' + CHAVE + '.PDF'), CHAVE);
  assert.equal(E.chaveDoNome(trocarDv(CHAVE) + '.pdf'), '');
  assert.equal(E.chaveDoNome(CHAVE + '.xml'), '');
  assert.equal(E.numeroDaChave(CHAVE), 11290);
  // a cópia do navegador e a do servidor concordam
  for (const c of [CHAVE, trocarDv(CHAVE), '1'.repeat(44), '0'.repeat(44)]) assert.equal(E.chaveValida(c), S.lerChave(c).valida, c);
});

test('danfe tela: classificarArquivos separa novas, ignoradas com motivo e repetidas', () => {
  const base65 = CHAVE.slice(0, 20) + '65' + CHAVE.slice(22, 43);
  const modelo65 = base65 + dvDe(base65);
  const r = E.classificarArquivos([
    arq(CHAVE + '.pdf'), arq('x/' + CHAVE + '.pdf'), arq('leia-me.txt'), arq('NF 12.pdf'), arq(trocarDv(CHAVE) + '.pdf'),
    arq(modelo65 + '.pdf'), arq('grande.pdf', 3 * 1024 * 1024)
  ]);
  assert.deepEqual(r.candidatas.map(c => c.chave), [CHAVE]);
  const motivos = Object.fromEntries(r.ignoradas.map(i => [i.nome, i.motivo]));
  assert.match(motivos['x/' + CHAVE + '.pdf'], /repetida/);
  assert.match(motivos['leia-me.txt'], /não é PDF/);
  assert.match(motivos['NF 12.pdf'], /chave de acesso/);
  assert.match(motivos[trocarDv(CHAVE) + '.pdf'], /chave de acesso/);
  assert.match(motivos[modelo65 + '.pdf'], /modelo 55/);
  assert.match(motivos['grande.pdf'], /chave de acesso/); // nome inválido vem antes do tamanho
  assert.equal(E.classificarArquivos([arq(CHAVE + '.pdf', E.MAX_PDF)]).candidatas.length, 1);
  assert.match(E.classificarArquivos([arq(CHAVE + '.pdf', E.MAX_PDF + 1)]).ignoradas[0].motivo, /2 MB/);
  assert.match(E.classificarArquivos([arq(CHAVE + '.pdf', 0)]).ignoradas[0].motivo, /vazio/);
});

test('danfe tela: lotes de 500 e resumo do envio', () => {
  assert.deepEqual(E.lotes([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(E.lotes([], 500), []);
  const r = E.resumir({ ignoradas: [{}, {}], jaExistiam: 3, resultados: [
    { chave: 'a', situacao: 'enviada' }, { chave: 'b', situacao: 'enviada', cnpjDiferente: true }, { chave: 'c', situacao: 'existia' }, { chave: 'd', situacao: 'erro', motivo: 'x' }] });
  assert.deepEqual([r.enviadas, r.jaExistentes, r.ignoradas, r.comErro.length, r.cnpjDiferente], [2, 4, 2, 1, 1]);
});

test('danfe pedido (tela): textos', () => {
  assert.equal(P.textoSemNota({ notas: [], semArquivo: [] }), 'Nenhuma nota fiscal ligada a este pedido.');
  assert.match(P.textoSemNota({ notas: [], semArquivo: [8862, 8887] }), /NF 8862, 8887.*PDF ainda não foi enviado/);
  assert.equal(P.rotuloNota({ numeroNf: 11290, serie: 1, enviadoEm: '2026-10-20 10:00:00', origem: 'financeiro' }), 'NF 11290 · enviada em 20/10/2026');
  assert.match(P.rotuloNota({ numeroNf: 5, serie: 2, enviadoEm: '', origem: 'manual' }), /NF 5 \(série 2\).*vínculo manual/);
});

test('página danfe_envio.html: CSP igual à das outras, scripts, abas com permissão e sem handlers inline', () => {
  const h = ler('danfe_envio.html');
  assert.match(h, /name="viewport"/);
  const csp = h.match(/Content-Security-Policy" content="([^"]+)"/)[1];
  assert.equal(csp, ler('notas_fiscais.html').match(/Content-Security-Policy" content="([^"]+)"/)[1]);
  for (const s of ['layout.js', 'entregas_comum.js', 'danfe_envio.js']) assert.ok(h.includes(`<script src="${s}`), s);
  assert.ok(!/<script(?![^>]*\ssrc=)/.test(h), 'sem script inline');
  assert.doesNotMatch(h, /\son(click|change|submit|error|load)=/);
  assert.ok(h.includes('data-perm="danfe.enviar"') && h.includes('data-perm="danfe.vincular"'));
  assert.match(h, /webkitdirectory/);
  for (const id of ['entrada-pasta', 'entrada-arquivos', 'btn-enviar', 'btn-parar', 'barra', 'relatorio', 'busca', 'lista', 'sec-enviar', 'sec-vincular']) assert.ok(h.includes(`id="${id}"`), id);
  assert.ok(!h.includes('data-valor'), 'DANFE não é dinheiro');
});

test('scripts novos e alterados compilam', () => {
  for (const f of ['danfe_envio.js', 'danfe_pedido.js', 'inicio_menu.js', 'layout.js']) assert.doesNotThrow(() => new vm.Script(ler(f), { filename: f }), f);
});

test('layout.js: Enviar DANFEs no menu (subitem do Financeiro) e em PAGINAS com enviar OU vincular', () => {
  const l = ler('layout.js');
  assert.match(l, /href: 'danfe_envio\.html', texto: 'Enviar DANFEs'.*sub: true/);
  assert.ok(l.indexOf("href: 'danfe_envio.html'") > l.indexOf("href: 'notas_fiscais.html'") && l.indexOf("href: 'danfe_envio.html'") < l.indexOf("href: 'usuarios.html'"));
  assert.match(l, /'danfe_envio\.html': \[\{ algum: \['danfe\.enviar', 'danfe\.vincular'\] \}\]/);
});

test('menu do botão direito: "Abrir nota fiscal (DANFE)" só para Pedido, com danfe.ver, nos dois menus', () => {
  const painel = ler('painel_inicial.html');
  assert.match(painel, /if \(ehPedido\) add\('danfe\.ver', '[^']+', 'Abrir nota fiscal \(DANFE\)'/);
  assert.ok(painel.includes('<script src="danfe_pedido.js'));
  assert.equal((painel.match(/Abrir nota fiscal \(DANFE\)/g) || []).length, 1);
  assert.match(ler('inicio_menu.js'), /add\('danfe\.ver', '[^']+', 'Abrir nota fiscal \(DANFE\)'/);
  assert.ok(ler('inicio.html').includes('<script src="danfe_pedido.js'));
});

test('danfe_pedido.js: dado da API por textContent e "Vincular nota…" só com danfe.vincular', () => {
  const j = ler('danfe_pedido.js');
  assert.ok(!/innerHTML/.test(j), 'dado da API nunca por innerHTML');
  assert.match(j, /pode\('danfe\.vincular'\)/);
  assert.match(j, /Nenhuma nota fiscal ligada a este pedido/);
  assert.match(j, /danfe_envio\.html\?aba=vincular&pedido=/);
});
