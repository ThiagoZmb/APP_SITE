// Tela "Notas de compra (SEFAZ)": funções puras, HTML/CSP, menu/permissões e a ligação com a entrada de estoque.
// Também trava a regra de ouro do front-end: todo script das páginas tocadas precisa compilar.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const N = require('../notas_compra.js');
const { gerarChave } = require('./apoio/sefazFalsa');
const { CATALOGO, PERFIS_INICIAIS } = require('../seguranca/permissoes');
const { acrescentarPermissoesComprasNfe } = require('../seguranca/instalacao');
const { criarPoolFalso } = require('./apoio/poolFalso');

const ler = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const scriptsInline = html => [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const CHAVE = gerarChave({ numero: 4321, serie: 2 });
const norm = s => s.replace(/ /g, ' ');

test('regra de ouro: notas_compra.js, layout.js, os módulos locais e os scripts inline das páginas compilam', () => {
  for (const f of ['notas_compra.js', 'layout.js', 'local/sefaz.js', 'local/salvador_pdf.js']) assert.doesNotThrow(() => new vm.Script(ler(f), { filename: f }), f);
  for (const f of ['notas_compra.html', 'movimentacao_estoque.html']) {
    const blocos = scriptsInline(ler(f));
    blocos.forEach((s, i) => assert.doesNotThrow(() => new vm.Script(s, { filename: `${f}#${i}` }), `${f} script ${i}`));
  }
  assert.equal(scriptsInline(ler('notas_compra.html')).length, 0, 'a página nova não tem script inline');
});

test('chave, número/série, moeda com R$, datas e CNPJ', () => {
  assert.equal(N.chaveValida(CHAVE), true);
  assert.equal(N.chaveValida(CHAVE.slice(0, 43) + ((Number(CHAVE[43]) + 1) % 10)), false);
  assert.deepEqual(N.numeroDaChave(CHAVE), { serie: '2', numero: '4321' });
  assert.equal(norm(N.moeda(1234.5)), 'R$ 1.234,50');
  assert.equal(N.dataBR('2026-10-20'), '20/10/2026');
  assert.equal(N.cnpjBR('11222333000181'), '11.222.333/0001-81');
  assert.equal(N.formatarChave('12345678').trim(), '1234 5678');
});

test('ações por situação: ciência só no resumo, baixar no resumo/ciência, importar só completa; cancelada não age', () => {
  const n = s => ({ chave: CHAVE, situacao: s });
  assert.deepEqual(['resumo', 'ciencia', 'completa', 'importada'].map(s => [N.podeCiencia(n(s)), N.podeBaixar(n(s)), N.podeImportar(n(s))]),
    [[true, true, false], [false, true, false], [false, false, true], [false, false, false]]);
  const c = { ...n('completa'), cancelada: true };
  assert.equal(N.podeImportar(c), false);
  assert.equal(N.rotulo(c)[0], 'Cancelada');
});

test('filtro e busca (emitente sem acento, CNPJ, número)', () => {
  const notas = [{ chave: CHAVE, situacao: 'completa', emitente: 'Alumínio São Paulo', cnpjEmitente: '11222333000181', numero: '4321' },
    { chave: gerarChave({ numero: 9, cnpj: '99888777000166' }), situacao: 'resumo', emitente: 'Vidros Rio', cnpjEmitente: '99888777000166', numero: '9' }];
  assert.equal(N.filtrar(notas, { filtro: 'importar' }).length, 1);
  assert.equal(N.filtrar(notas, { filtro: 'pendentes' })[0].emitente, 'Vidros Rio');
  assert.equal(N.filtrar(notas, { busca: 'aluminio sao' }).length, 1);
  assert.equal(N.filtrar(notas, { busca: '11.222.333' }).length, 1);
  assert.equal(N.filtrar(notas, { busca: '4321' }).length, 1);
  assert.equal(N.filtrar(notas, { filtro: 'xxx' }).length, 2);
});

test('linha: dado de fora escapado; valor com R$ só com valores.ver; botões conforme permissões', () => {
  const nota = { chave: CHAVE, situacao: 'completa', emitente: '<img src=x onerror=alert(1)>', cnpjEmitente: '11222333000181', valor: 1500.25, dataEmissao: '2026-10-20' };
  const com = N.linhaHtml(nota, { comValores: true, importar: true, movimentar: true });
  assert.ok(!com.includes('<img') && com.includes('&lt;img'));
  assert.ok(norm(com).includes('R$ 1.500,25'));
  assert.ok(com.includes('data-acao="importar"'));
  const sem = N.linhaHtml(nota, { comValores: false, importar: true, movimentar: true });
  assert.ok(!sem.includes('R$') && !sem.includes('1.500'));
  assert.ok(!N.linhaHtml(nota, { importar: true, movimentar: false }).includes('data-acao="importar"'), 'importar exige estoque.movimentar');
  assert.ok(!N.linhaHtml(nota, { importar: false, movimentar: true }).includes('data-acao'), 'sem compras_nfe.importar não há ações');
  const resumo = N.linhaHtml({ ...nota, situacao: 'resumo' }, { importar: true });
  assert.ok(resumo.includes('data-acao="ciencia"') && resumo.includes('data-acao="baixar"') && resumo.includes('class="nc-marcar"'));
});

test('pacote para a entrada de estoque: chave válida, XML até 1 MB, recente; pendentes só com chaves válidas', () => {
  const agora = Date.UTC(2026, 9, 29, 12);
  const p = N.lerPacote(N.montarPacote(CHAVE, '<nfeProc/>', agora), agora + 1000);
  assert.deepEqual(p, { chave: CHAVE, xml: '<nfeProc/>' });
  assert.equal(N.lerPacote(N.montarPacote('123', '<x/>', agora), agora), null);
  assert.equal(N.lerPacote(N.montarPacote(CHAVE, '', agora), agora), null);
  assert.equal(N.lerPacote(N.montarPacote(CHAVE, 'x'.repeat(N.LIMITE_XML + 1), agora), agora), null);
  assert.equal(N.lerPacote(N.montarPacote(CHAVE, '<x/>', agora), agora + 31 * 60000), null, 'velho demais');
  assert.equal(N.lerPacote('não é json', agora), null);
  assert.equal(N.lerPacote(null, agora), null);
  assert.deepEqual(N.lerPendentes(JSON.stringify([CHAVE, CHAVE, '../x', 5])), [CHAVE]);
  assert.deepEqual(N.lerPendentes('{'), []);
});

test('marcarImportada: serviço fora guarda a chave como pendente; serviço no ar não guarda', async () => {
  const guardado = {};
  const win = { localStorage: { getItem: k => guardado[k] ?? null, setItem: (k, v) => { guardado[k] = v; } }, AbortSignal,
    fetch: async () => { throw new TypeError('failed to fetch'); } };
  assert.equal(await N.marcarImportada(win, CHAVE), false);
  assert.deepEqual(JSON.parse(guardado[N.CHAVE_PENDENTES]), [CHAVE]);
  const pedidos = [];
  const winOk = { ...win, fetch: async (url, o) => { pedidos.push([url, o.method, o.body]); return { ok: true, json: async () => ({ ok: true }) }; } };
  assert.equal(await N.marcarImportada(winOk, CHAVE), true);
  assert.deepEqual(pedidos[0], ['http://127.0.0.1:3917/sefaz/importada', 'POST', JSON.stringify({ chave: CHAVE })]);
  assert.equal(await N.marcarImportada(winOk, 'x'), false);
});

test('página: CSP libera o serviço local e não tem upgrade-insecure-requests; scripts, controles e permissões', () => {
  const h = ler('notas_compra.html');
  const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(h)[1];
  assert.match(csp, /connect-src [^;]*http:\/\/127\.0\.0\.1:3917/);
  assert.doesNotMatch(csp, /upgrade-insecure-requests/);
  assert.match(h, /name="viewport"/);
  for (const s of ['layout.js', 'notas_compra.js']) assert.ok(h.includes(`<script src="${s}`), s);
  for (const id of ['nc-lista', 'nc-status', 'nc-aviso', 'nc-busca', 'nc-filtro', 'btn-sincronizar', 'btn-ciencia-lote', 'btn-atualizar', 'toasts']) assert.ok(h.includes(`id="${id}"`), id);
  assert.ok(h.includes('data-perm="compras_nfe.ver"') && h.includes('data-perm="compras_nfe.importar"'));
  assert.doesNotMatch(h, /\son(click|change|submit|error|load)=/);
});

test('entrada de estoque: CSP com o serviço local, recebe o XML da SEFAZ pelo mesmo caminho do arquivo e marca como importada', () => {
  const h = ler('movimentacao_estoque.html');
  const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(h)[1];
  assert.match(csp, /connect-src [^;]*http:\/\/127\.0\.0\.1:3917/);
  assert.doesNotMatch(csp, /upgrade-insecure-requests/);
  assert.ok(h.includes('<script src="notas_compra.js'));
  assert.match(h, /async function importarXmlEntrada\(xml, sefaz = null\)/);
  assert.match(h, /await importarXmlEntrada\(await arq\.text\(\)\)/);
  assert.match(h, /api\('\/estoque\/entrada\/xml', \{ bruto: xml, tipo: 'application\/xml' \}\)/);
  assert.match(h, /await receberNotaSefaz\(\);/);
  assert.match(h, /entrada\.numeroSefaz === numero && window\.NotasCompra\) window\.NotasCompra\.marcarImportada\(window, entrada\.chaveSefaz\)/);
  // a tela de notas de compra só monta onde existe a lista (não na entrada de estoque)
  assert.match(ler('notas_compra.js'), /if \(document\.getElementById\('nc-lista'\)\) lib\.iniciar\(raiz\)/);
  assert.match(ler('notas_compra.js'), /movimentacao_estoque\.html\?aba=entrada/);
});

test('layout.js: item no menu (subitem do Estoque) e página no mapa com compras_nfe.ver', () => {
  const l = ler('layout.js');
  assert.match(l, /\{ href: 'notas_compra\.html', texto: 'Notas de compra \(SEFAZ\)', icone: 'estoque', sub: true \}/);
  assert.match(l, /'notas_compra\.html': \['compras_nfe\.ver'\]/);
  const pos = h => l.indexOf("href: '" + h + "'");
  assert.ok(pos('notas_compra.html') > pos('estoque.html') && pos('notas_compra.html') < pos('produtos.html'));
  assert.match(l, /'minhas_entregas\.html': \['entregas\.baixar'\]\s*\/\/ por último/);
});

test('permissões compras_nfe.*: catálogo (Estoque), perfis iniciais e migração única para Administrador e Interno completo', async () => {
  for (const c of ['compras_nfe.ver', 'compras_nfe.importar']) assert.equal(CATALOGO.find(p => p.codigo === c)?.area, 'Estoque', c);
  for (const nome of ['Administrador', 'Interno completo']) {
    const p = PERFIS_INICIAIS.find(x => x.nome === nome).permissoes;
    assert.ok(p.includes('compras_nfe.ver') && p.includes('compras_nfe.importar'), nome);
  }
  assert.ok(!PERFIS_INICIAIS.find(x => x.nome === 'Estoquista').permissoes.includes('compras_nfe.ver'));
  let feito = false;
  const pool = criarPoolFalso([
    [/SELECT id FROM web_auditoria WHERE acao = 'permissoes_compras_nfe'/, () => feito ? [{ id: 1 }] : []],
    [/SELECT id, nome FROM web_perfis/, [{ id: 1, nome: 'Administrador' }, { id: 2, nome: 'Interno completo' }]],
    [/INSERT INTO web_auditoria/, () => { feito = true; return { affectedRows: 1 }; }]
  ]);
  assert.deepEqual(await acrescentarPermissoesComprasNfe(pool), { feito: true });
  const inseridas = pool.chamadas.filter(c => /INSERT IGNORE INTO web_perfil_permissoes/.test(c.sql)).map(c => c.params.join(':'));
  assert.deepEqual(inseridas.sort(), ['1:compras_nfe.importar', '1:compras_nfe.ver', '2:compras_nfe.importar', '2:compras_nfe.ver']);
  assert.deepEqual(await acrescentarPermissoesComprasNfe(pool), { feito: false });
  assert.match(ler('index.js'), /acrescentarPermissoesComprasNfe\(pool\)/);
});

test('instalador do serviço local: ASCII, copia o módulo da SEFAZ, instala só dependências de produção e nunca a config', () => {
  const ps = ler('local/instalar_salvador_pdf.ps1');
  assert.ok(/^[\x00-\x7F]*$/.test(ps), 'o .ps1 precisa ser só ASCII (PowerShell 5.1 lê sem BOM como ANSI)');
  for (const a of ['salvador_pdf.js', 'sefaz.js', 'package.json', 'package-lock.json', 'sefaz.config.exemplo.json']) assert.ok(ps.includes(`'${a}'`), a);
  assert.match(ps, /--omit=dev/);
  const copiados = /^\$arquivos = @\(([^)]*)\)/m.exec(ps)[1];
  assert.ok(!copiados.includes("'sefaz.config.json'"), 'o instalador não copia nem sobrescreve a configuração');
  const pkg = JSON.parse(ler('local/package.json'));
  assert.deepEqual(Object.keys(pkg.dependencies).sort(), ['fast-xml-parser', 'node-forge']);
  assert.ok(Object.values(pkg.dependencies).every(v => /^\d+\.\d+\.\d+$/.test(v)), 'versões exatas');
  const exemplo = JSON.parse(ler('local/sefaz.config.exemplo.json'));
  assert.equal(exemplo.cnpj, '00000000000000');
  assert.equal(exemplo.ambiente, 'homologacao');
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'local', 'package-lock.json')));
});

test('nenhum certificado, chave privada ou configuração real no repositório', () => {
  const raiz = path.join(__dirname, '..');
  const proibidos = [];
  const andar = d => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (['node_modules', '.git'].includes(e.name)) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) andar(p);
      else if (/\.(pfx|p12)$/i.test(e.name) || e.name === 'sefaz.config.json' || e.name === 'sefaz.estado.json') proibidos.push(path.relative(raiz, p));
    }
  };
  andar(path.join(raiz, 'local'));
  andar(path.join(raiz, 'docs'));
  assert.deepEqual(proibidos, []);
  assert.match(ler('.gitignore'), /\*\.pfx/);
  assert.match(ler('.gitignore'), /sefaz\.config\.json/);
});

test('Ciência da operação desativada: botão em lote e por nota inativos, caixas de seleção desabilitadas, sem chamada ao serviço', () => {
  const fs = require('node:fs'), path = require('node:path');
  const js = fs.readFileSync(path.join(__dirname, '..', 'notas_compra.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'notas_compra.html'), 'utf8');
  assert.match(js, /const CIENCIA_LIBERADA = false;/);
  assert.match(js, /if \(!CIENCIA_LIBERADA \|\| !chaves\.length\) return;/);
  assert.match(js, /disabled = !CIENCIA_LIBERADA \|\| !q \|\| estado\.ocupado/);
  assert.match(html, /id="btn-ciencia-lote"[^>]*\bdisabled\b/);
  const linha = N.linhaHtml({ chave: '3'.repeat(44), situacao: 'resumo', emitente: 'X' }, { importar: true });
  assert.match(linha, /data-acao="ciencia"[^>]*\bdisabled\b/);
  assert.match(linha, /class="nc-marcar"[^>]*\bdisabled\b/);
});

test('tela de notas de compra começa com o filtro "Todas" (no estado e no seletor)', () => {
  const fs = require('node:fs'), path = require('node:path');
  const js = fs.readFileSync(path.join(__dirname, '..', 'notas_compra.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'notas_compra.html'), 'utf8');
  assert.match(js, /const estado = \{ notas: \[\], status: null, filtro: '', busca: ''/);
  assert.match(html, /<option value="" selected>Todas<\/option>/);
  assert.equal((html.match(/<option value="[^"]*" selected>/g) || []).length, 1, 'só uma opção marcada');
});

test('botão que busca de novo todo o histórico se chama "Histórico completo"', () => {
  const html = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'notas_compra.html'), 'utf8');
  assert.match(html, /id="btn-rebuscar"[^>]*>Histórico completo<\/button>/);
  assert.ok(!html.includes('Rebuscar histórico'));
});
