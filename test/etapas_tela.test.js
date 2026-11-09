// Tela das etapas de produção: etapas_producao.html / .js / .css e o item do menu em layout.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const T = require('../etapas_producao.js');

const ler = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const csp = h => (h.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/) || [])[1];
const ef = (estado, extra = {}) => ({ estado, origem: 'manual', usuario: 'Bia Souza', quando: '2026-11-05 14:30:00', observacao: null, ...extra });
const pedido = (extra = {}) => ({ numero: 321, cliente: 'Cliente <X>', clienteFinal: 'Obra Y', situacao: 'Em Produção', prontoEm: '2026-11-01', atrasado: true, qtdConcluidas: 1, qtdEtapas: 4,
  etapas: [ef('ok', { origem: 'corte', codigo: 'perfil_cortado' }), { codigo: 'vidro_cortado', ...ef('na', { origem: 'auto', usuario: '' }) }, { codigo: 'perfil_pintado', ...ef('pendente', { usuario: '' }) },
    { codigo: 'vidro_pintado', ...ef('na', { origem: 'auto', usuario: '' }) }, { codigo: 'portas_montadas', ...ef('pendente', { usuario: '' }) }, { codigo: 'finalizado', ...ef('pendente', { usuario: '' }) }].map((e, i) => ({ ...e, codigo: T.ETAPAS_PADRAO[i].codigo })),
  ...extra });

// ---------- funções puras ----------
test('celula: OK manual, OK do corte, N/A automático, N/A manual, pendente e bloqueado (só leitura)', () => {
  const ok = T.celula('Perfil pintado', ef('ok'), true);
  assert.equal(ok.classe, 'est-ok'); assert.equal(ok.texto, '✓ OK'); assert.equal(ok.sub, 'Bia');
  assert.match(ok.titulo, /Perfil pintado: OK por Bia Souza em 05\/11\/2026 14:30/);
  const auto = T.celula('Perfil cortado', ef('ok', { origem: 'corte' }), true);
  assert.equal(auto.classe, 'est-auto'); assert.equal(auto.sub, 'pelo corte'); assert.match(auto.titulo, /confirmação do corte/);
  assert.equal(T.celula('Vidro cortado', ef('na', { origem: 'auto' }), true).sub, 'não se aplica');
  assert.equal(T.celula('Vidro cortado', ef('na'), true).sub, 'Bia');
  const pend = T.celula('Montagem', ef('pendente', { usuario: '' }), true);
  assert.deepEqual([pend.classe, pend.texto, pend.bloqueado], ['est-pendente', '○ Pendente', false]);
  const bloq = T.celula('Montagem', ef('pendente'), false);
  assert.equal(bloq.bloqueado, true); assert.match(bloq.classe, /\bbloq\b/); assert.match(bloq.titulo, /só leitura/);
});

test('acaoDoClique: pendente -> OK; N/A -> nada (não é clicável); OK -> desfazer (pergunta)', () => {
  assert.equal(T.acaoDoClique({ estado: 'pendente' }), 'ok');
  assert.equal(T.acaoDoClique({ estado: 'na' }), null);
  assert.equal(T.acaoDoClique({ estado: 'ok' }), 'desfazer');
});

test('filtrar: busca por número/cliente/cliente final (sem acento), "o que falta" e "minha etapa"', () => {
  const ps = [pedido(), pedido({ numero: 400, cliente: 'Construtora São João', clienteFinal: '', etapas: pedido().etapas.map(e => (e.codigo === 'perfil_pintado' ? { ...e, estado: 'ok' } : e)) })];
  assert.deepEqual(T.filtrar(ps, { busca: '321' }).map(p => p.numero), [321]);
  assert.deepEqual(T.filtrar(ps, { busca: 'sao joao' }).map(p => p.numero), [400]);
  assert.deepEqual(T.filtrar(ps, { busca: 'obra' }).map(p => p.numero), [321]);
  assert.deepEqual(T.filtrar(ps, { falta: 'perfil_pintado' }).map(p => p.numero), [321]);
  assert.deepEqual(T.filtrar(ps, { falta: 'vidro_cortado' }).map(p => p.numero), [], 'N/A não é pendente');
  assert.deepEqual(T.filtrar(ps, { minha: true, minhas: ['perfil_pintado'] }).map(p => p.numero), [321]);
  assert.deepEqual(T.filtrar(ps, { minha: true, minhas: [] }).map(p => p.numero), []);
});

test('textoAtualizado e pendentesAntes', () => {
  assert.equal(T.textoAtualizado(null), 'carregando…');
  assert.equal(T.textoAtualizado(new Date(2026, 10, 5, 9, 7).getTime()), 'Atualizado às 09:07');
  assert.equal(T.textoAtualizado(new Date(2026, 10, 5, 14, 30).getTime()), 'Atualizado às 14:30');
  assert.equal(T.textoAtualizado('lixo'), 'carregando…');
  assert.deepEqual(T.pendentesAntes(pedido()), ['perfil_pintado', 'portas_montadas']);
  assert.equal(T.INTERVALO, undefined, 'sem intervalo de atualização automática');
});

test('menus: célula com permissão (OK, desfazer, N/A, histórico; finalizado sem N/A) e sem permissão (só histórico); linha só com as etapas permitidas', () => {
  const p = pedido();
  assert.deepEqual(T.itensMenuCelula(p, 'perfil_pintado', true).map(i => [i.acao, !!i.desativado]), [['ok', false], ['desfazer', true], ['na', false], ['historico', false]]);
  assert.deepEqual(T.itensMenuCelula(p, 'finalizado', true).map(i => i.acao), ['ok', 'desfazer', 'historico']);
  assert.deepEqual(T.itensMenuCelula(p, 'perfil_pintado', false).map(i => i.acao), ['historico']);
  // finalizado OK com o pedido de volta em produção: "Marcar OK" ativo para marcar Pronto de novo; com o pedido Pronto, desativado
  const fin = pedido({ etapas: p.etapas.map(e => (e.codigo === 'finalizado' ? { ...e, estado: 'ok' } : e)) });
  assert.equal(T.itensMenuCelula(fin, 'finalizado', true)[0].desativado, false);
  assert.equal(T.itensMenuCelula({ ...fin, situacao: 'Pronto' }, 'finalizado', true)[0].desativado, true);
  const linha = T.itensMenuLinha(p, T.ETAPAS_PADRAO, c => c === 'portas_montadas');
  assert.deepEqual(linha.map(i => i.titulo || i.acao), ['Portas montadas', 'ok', 'desfazer', 'na', 'historico']);
  assert.ok(linha.filter(i => i.acao && i.acao !== 'historico').every(i => i.etapa === 'portas_montadas'));
});

test('htmlLinha: escapa texto do banco, 6 botões com data-etapa, bloqueio por permissão, destaque da minha etapa, selo de atraso e barra de progresso por classe', () => {
  const h = T.htmlLinha(pedido(), { etapas: T.ETAPAS_PADRAO, podeEtapa: c => c === 'perfil_pintado', minhas: new Set(['perfil_pintado']), destacar: true, link: 'pdf', salvando: new Set(['321|portas_montadas']) });
  assert.ok(h.includes('Cliente &lt;X&gt;') && !h.includes('Cliente <X>'));
  assert.equal((h.match(/class="etp-cel /g) || []).length, 6);
  for (const e of T.ETAPAS_PADRAO) assert.ok(h.includes(`data-etapa="${e.codigo}"`), e.codigo);
  assert.equal((h.match(/aria-disabled="true"/g) || []).length, 5, 'só a etapa permitida fica clicável');
  assert.equal((h.match(/etp-minha/g) || []).length, 1);
  assert.match(h, /<span class="selo perigo">Atrasado<\/span>/);
  assert.match(h, /class="etp-t4 etp-f1"/);   // 1 OK de 4 etapas que se aplicam (as 2 N/A ficam fora)
  assert.match(h, /1\/4/);
  assert.match(h, /1 de 4 etapas concluídas/);
  // sem etapa nenhuma que se aplique/total inválido não quebra a barra
  assert.match(T.htmlLinha(pedido({ qtdConcluidas: 9, qtdEtapas: 0 }), { etapas: T.ETAPAS_PADRAO, podeEtapa: () => false, link: null }), /class="etp-t1 etp-f1"/);
  assert.match(h, /data-guia="321"/);
  assert.match(h, /salvando" data-numero="321" data-etapa="portas_montadas"[^>]*aria-busy="true"/);
  assert.doesNotMatch(h, /style=/);
  const editar = T.htmlLinha(pedido({ atrasado: false }), { podeEtapa: () => true, minhas: new Set(), link: 'editar' });
  assert.match(editar, /href="orcamentos\.html\?abrir=Pedido\/321&amp;voltar=etapas_producao\.html"/);
  assert.doesNotMatch(editar, /Atrasado/);
  assert.doesNotMatch(T.htmlLinha(pedido(), { podeEtapa: () => true, link: null }), /<a |data-guia/);
});

test('aplicarOtimista: muda só a célula e recalcula o progresso', () => {
  const p = pedido();
  const n = T.aplicarOtimista(p, 'perfil_pintado', 'ok', 'Bia');
  assert.equal(n.etapas.find(e => e.codigo === 'perfil_pintado').estado, 'ok');
  assert.equal(n.qtdConcluidas, 2);   // perfil_cortado + perfil_pintado; as N/A não entram na conta
  assert.equal(n.qtdEtapas, 4);
  assert.equal(p.etapas.find(e => e.codigo === 'perfil_pintado').estado, 'pendente', 'não muda o original (para desfazer se falhar)');
});

// ---------- página, CSP, CSS, layout ----------
test('etapas_producao.html: CSP igual à das páginas vizinhas, tema.css por último com ?v=, scripts com ?v= e defer, ids usados pelo JS, sem inline', () => {
  const h = ler('etapas_producao.html'), cal = ler('calendario.html');
  assert.equal(csp(h), csp(cal));
  const css = [...h.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map(m => m[1]);
  assert.equal(css[css.length - 1], cal.match(/href="(tema\.css\?v=\d+)"/)[1]);
  assert.ok(css[0].startsWith('etapas_producao.css?v='));
  const scripts = [...h.matchAll(/<script src="([^"?]+)\?v=\d+" defer><\/script>/g)].map(m => m[1]);
  assert.deepEqual(scripts, ['layout.js', 'entregas_comum.js', 'etapas_producao.js']);
  assert.equal((h.match(/<script/g) || []).length, scripts.length, 'nenhum script inline');
  assert.doesNotMatch(h, /\son[a-z]+=/i);
  assert.doesNotMatch(h, /\sstyle=/i);
  assert.doesNotMatch(h, /<style/i);
  assert.match(h, /id="etp-busca"[^>]*data-foco-busca/);
  assert.ok(h.includes('<nav class="sidebar">') && h.includes('<meta name="viewport"'));
  const ids = ['etp-busca', 'etp-falta', 'etp-minha', 'etp-abertos', 'etp-resumo', 'etp-atualizado', 'etp-recarregar', 'etp-legenda', 'etp-erro', 'etp-thead', 'etp-corpo', 'etp-corpo-painel', 'user-empresa', 'user-avatar', 'user-name', 'user-cargo', 'toasts'];
  for (const id of ids) assert.ok(h.includes(`id="${id}"`), id);
  const js = ler('etapas_producao.js');
  for (const id of ids.filter(i => i.startsWith('etp-'))) assert.ok(js.includes(`'${id}'`), `${id} é usado pelo JS`);
  assert.match(h, /aria-pressed="false"/);
});

test('etapas_producao.html: o ?v= do etapas_producao.js mudou junto com a remoção da atualização automática (senão o navegador roda o JS antigo com polling em cache)', () => {
  const h = ler('etapas_producao.html');
  assert.match(h, /etapas_producao\.js\?v=202611061500/);
});

test('etapas_producao.js: SEM atualização automática (só ao abrir e no botão Atualizar); menu por botão direito/Shift+F10 e "⋯"; finalizar pergunta a data de pronto', () => {
  const js = ler('etapas_producao.js');
  assert.doesNotMatch(js, /setInterval|setTimeout|visibilitychange|requestAnimationFrame/, 'a página não se recarrega sozinha');
  assert.match(js, /\$\('etp-recarregar'\)\.addEventListener\('click', \(\) => \{ if \(!estado\.carregando && !estado\.salvando\.size\) carregar\(\); \}\);/);
  assert.match(js, /aplicarOtimista\(antes, etapa, corpo\.estado/, 'clique continua otimista');
  assert.match(js, /\+\+estado\.consulta; estado\.carregando = false;/, 'gravar descarta a consulta da fila que estava a caminho');
  assert.match(js, /versao=/);
  assert.match(js, /addEventListener\('contextmenu'/);
  assert.match(js, /data-mais/);
  assert.match(js, /name="dataPronto" value="manter" checked/);
  assert.match(js, /name="dataPronto" value="hoje"/);
  assert.match(js, /voltarParaProducao: true/);
  assert.match(js, /forcar: true/);
  assert.doesNotMatch(js, /innerHTML\s*=\s*`[^`]*\$\{(?!esc\()[a-z]+\.(cliente|clienteFinal|observacao|usuario)/, 'texto do banco sempre por esc()');
  assert.doesNotMatch(js, /localStorage\.(get|set)Item\((?![^)]*CHAVE_FILTROS)/, 'só os filtros ficam no navegador');
});

test('etapas_producao.css: só variáveis do tema (sem hex/rgba/hsla), cartões no celular e foco visível', () => {
  const c = ler('etapas_producao.css');
  assert.doesNotMatch(c, /#[0-9a-fA-F]{3,8}\b/);
  assert.doesNotMatch(c, /\brgba?\(/);
  assert.doesNotMatch(c, /\bhsla?\(/);
  assert.match(c, /@media \(max-width: 760px\)/);
  assert.match(c, /\.etp-tabela tbody tr \{ display: grid;/);
  assert.match(c, /\.etp-cel:focus-visible/);
  assert.match(c, /min-height: 48px/);
  assert.match(c, /prefers-reduced-motion/);
  assert.doesNotMatch(c, /\.chip\b|\.grupo\b|\.menu-item\b/, 'classes do tema/layout não são redefinidas');
  assert.doesNotMatch(c, /border-left:\s*[2-9]px/, 'sem faixa lateral grossa (DESIGN.md)');
});

test('layout.js: "Etapas de produção" logo depois do Calendário (seção Comercial), PAGINAS com etapas.ver antes de minhas_entregas (que segue por último)', () => {
  const l = ler('layout.js');
  assert.match(l, /\{ href: 'calendario\.html'[^\n]*\n\s*\{ href: 'etapas_producao\.html', texto: 'Etapas de produção', icone: 'etapas' \}/);
  assert.ok(l.indexOf("href: 'etapas_producao.html'") < l.indexOf("secao: 'Gestão'"));
  assert.match(l, /\n\s+etapas: ic\(/);
  assert.match(l, /'etapas_producao\.html': \['etapas\.ver'\]/);
  const ctx = { window: {}, document: { readyState: 'loading', addEventListener() {}, querySelector() { return null; } }, localStorage: { getItem: () => null }, location: { pathname: '/x/inicio.html' }, sessionStorage: { getItem: () => null }, setTimeout, console };
  ctx.window = ctx; vm.createContext(ctx);
  try { vm.runInContext(l, ctx); } catch { /* o layout monta o DOM só no navegador */ }
  const paginas = Object.keys(ctx.ACESSO_PAGINAS || {});
  assert.ok(paginas.length > 0);
  assert.equal(paginas[paginas.length - 1], 'minhas_entregas.html');
  assert.equal(paginas[paginas.length - 2], 'etapas_producao.html');
  // quem só tem as etapas (chão de fábrica) cai na tela das etapas depois do login
  assert.equal(ctx.Acesso.primeiraPaginaDe({ permissoes: ['etapas.ver', 'etapas.montagem'] }), 'etapas_producao.html');
  assert.equal(ctx.Acesso.primeiraPaginaDe({ permissoes: ['pedidos.ver', 'etapas.ver'] }), 'painel_inicial.html', 'quem já tinha outra página não muda');
});

test('todas as páginas usam a mesma versão do layout.js (o menu novo chega a todas)', () => {
  const dir = path.join(__dirname, '..');
  const versoes = fs.readdirSync(dir).filter(n => n.endsWith('.html')).map(n => /layout\.js\?v=(\d+)/.exec(fs.readFileSync(path.join(dir, n), 'utf8'))).filter(Boolean).map(m => m[1]);
  assert.ok(versoes.length > 20);
  assert.equal(new Set(versoes).size, 1);
});

// ---------- cabeçalho de lista sempre visível (regra do dono, 2026-11-09; DESIGN.md) ----------
test('listas: o quadro rola na vertical e o cabeçalho (th) gruda; tema.css dá o padrão a todas as listas', () => {
  const css = ler('etapas_producao.css'), tema = ler('tema.css');
  // etapas: quadro com altura máxima + overflow auto (só overflow-x não deixava o th grudar) e th sticky no topo do quadro
  assert.match(css, /\.etp-rolagem \{[^}]*overflow: auto;[^}]*max-height: calc\(100vh - 300px\)/);
  assert.match(css, /\.etp-tabela th \{[^}]*position: sticky; top: 0/);
  // tema.css: padrão para todas as listas (quadros conhecidos), com especificidade zero para a página poder definir a sua
  assert.match(tema, /:where\(\.tabela-wrap, \.lista-wrap, \.rolagem, \.etp-rolagem\) \{ overflow: auto; max-height: max\(320px, calc\(100vh - 220px\)\); \}/);
  assert.match(tema, /body :where\(\.tabela-wrap, \.lista-wrap, \.rolagem, \.etp-rolagem\) thead th \{ position: sticky; top: 0; z-index: 3; \}/);
  assert.match(ler('DESIGN.md'), /Toda lista com rolagem mantém o cabeçalho das colunas sempre visível/);
});

// ---------- N/A não é clicável (decisão do dono, 2026-11-09) ----------
test('célula N/A é inerte: classe, aria-disabled e "Marcar OK" desativado no menu; histórico e "Desfazer" (N/A manual) continuam', () => {
  const c = T.celula('Perfil pintado', { estado: 'na', origem: 'auto', usuario: '' }, true);
  assert.equal(c.inerte, true);
  assert.match(c.classe, /est-na inerte/);
  assert.equal(T.celula('Perfil pintado', { estado: 'pendente' }, true).inerte, false);
  assert.match(T.htmlLinha(pedido(), { etapas: T.ETAPAS_PADRAO, podeEtapa: () => true, link: null }), /est-na inerte[^>]*aria-disabled="true"/);
  const menu = (estado, origem) => T.itensMenuCelula({ etapas: [{ codigo: 'perfil_pintado', estado, origem }], situacao: 'Em Produção' }, 'perfil_pintado', true);
  const m = menu('na', 'manual');
  assert.equal(m.find(i => i.acao === 'ok').desativado, true, 'N/A não vira OK');
  assert.equal(m.find(i => i.acao === 'desfazer').desativado, false, 'N/A marcado à mão volta a pendente pelo menu');
  assert.equal(m.find(i => i.acao === 'na').desativado, true);
  assert.ok(m.some(i => i.acao === 'historico'));
  assert.equal(menu('pendente').find(i => i.acao === 'ok').desativado, false);
  assert.match(ler('etapas_producao.css'), /\.etp-cel\.inerte, \.etp-cel\.inerte:hover \{ cursor: default;/);
  assert.doesNotMatch(ler('etapas_producao.js'), /ok_na/);
});
