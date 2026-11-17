// Submenus do menu de contexto do Pedido (menu_contexto.js): montagem do HTML, acessibilidade e ligação nas telas
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ler = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

function carregar() {
  global.window = {};
  delete require.cache[require.resolve('../menu_contexto.js')];
  require('../menu_contexto.js');
  return global.window.MenuContexto;
}
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

test('montar: folhas seguidas com o mesmo grupo viram UM item principal com submenu (aria-haspopup, aria-expanded, role=menu)', () => {
  const M = carregar();
  const imp = { grupo: 'Imprimir', iconeGrupo: 'P' };
  const { html, folhas } = M.montar([
    { icone: 'a', rotulo: 'Abrir PDF', fn() {} }, { sep: true },
    { icone: 'i', rotulo: 'Imprimir PDF', fn() {}, ...imp }, { icone: 'i', rotulo: 'Imprimir vidros', fn() {}, ...imp },
    { sep: true },
    { icone: '', rotulo: 'Pronto', fn() {}, desativado: true, grupo: 'Mudar situação', iconeGrupo: 'S' }, { icone: '', rotulo: 'Entregue', fn() {}, grupo: 'Mudar situação', iconeGrupo: 'S' }
  ], esc);
  assert.equal((html.match(/class="mc-pai"/g) || []).length, 2, 'dois itens principais: Imprimir e Mudar situação');
  assert.equal((html.match(/aria-haspopup="menu"/g) || []).length, 2);
  assert.equal((html.match(/aria-expanded="false"/g) || []).length, 2);
  assert.equal((html.match(/class="mc-sub"[^>]*role="menu"[^>]*hidden/g) || []).length, 2);
  assert.ok(html.includes('>Imprimir<') || html.includes('Imprimir<span class="mc-seta"'));
  assert.ok(html.includes('Mudar situação<span class="mc-seta"'));
  assert.deepEqual(folhas.map(f => f.rotulo), ['Abrir PDF', 'Imprimir PDF', 'Imprimir vidros', 'Pronto', 'Entregue']);
  assert.match(html, /<button[^>]*data-i="3"[^>]* disabled>/, 'a situação atual continua desativada dentro do submenu');
  assert.ok(html.indexOf('Abrir PDF') < html.indexOf('mc-pai'), 'a ordem dos itens é mantida');
});

test('montar: o rótulo e o ícone são escapados; item sem grupo continua botão simples; perigo mantém a classe', () => {
  const M = carregar();
  const { html } = M.montar([{ icone: '<i>', rotulo: '<b>x</b>', fn() {}, perigo: true }, { titulo: 'T<' }], esc);
  assert.ok(!html.includes('<b>x') && html.includes('&lt;b&gt;x'));
  assert.ok(html.includes('class="mc-perigo"') && !html.includes('mc-pai') && html.includes('mc-tit'));
});

test('montar: a permissão continua por folha (grupo só com as folhas que o usuário pode ver; sem folhas não há item principal)', () => {
  const M = carregar();
  assert.equal(M.montar([], esc).html, '');
  const so = M.montar([{ rotulo: 'Imprimir checklist', grupo: 'Imprimir', icone: '' }], esc).html;
  assert.equal((so.match(/class="mc-pai"/g) || []).length, 1);
  assert.equal((so.match(/data-i=/g) || []).length, 1);
});

test('ligar: toque/clique abre o submenu, teclado (setas, Esc) e posição dentro da tela estão no código', () => {
  const s = ler('menu_contexto.js');
  for (const t of ["e.key === 'ArrowRight'", "e.key === 'ArrowLeft'", "e.key === 'Escape'", "e.key === 'Tab'", "e.key === 'Home'", "e.key === 'End'", 'stopPropagation', "pointerType !== 'mouse'", 'window.innerWidth', 'r.left - w', 'aria-expanded']) assert.ok(s.includes(t), t);
});

test('telas: menu_contexto.js carregado antes de inicio_menu.js (Início e Calendário) e no painel_inicial; CSS dos submenus no tema.css', () => {
  for (const f of ['inicio.html', 'calendario.html', 'calendario_dia.html']) {
    const h = ler(f);
    assert.ok(h.includes('<script src="menu_contexto.js?v=') && h.indexOf('<script src="menu_contexto.js') < h.indexOf('<script src="inicio_menu.js'), f);
  }
  assert.ok(ler('painel_inicial.html').includes('<script src="menu_contexto.js?v='));
  const css = ler('tema.css');
  for (const c of ['.mc-sub', '.mc-pai', '.mc-seta']) assert.ok(css.includes(c), c);
});

test('Editar pedido / Editar orçamento: o rótulo depende do tipo da lista (painel_inicial) e é "Editar pedido" no Início/Calendário', () => {
  assert.ok(ler('painel_inicial.html').includes("ehPedido ? 'Editar pedido' : 'Editar orçamento'"));
  assert.ok(ler('inicio_menu.js').includes("'Editar pedido'"));
  assert.ok(!/Abrir para editar/.test(ler('inicio_menu.js') + ler('painel_inicial.html')));
});

test('os itens de Imprimir e de Mudar situação vêm marcados com grupo (Início e painel); nada de título "Mudar situação para"', () => {
  for (const f of ['inicio_menu.js', 'painel_inicial.html']) {
    const s = ler(f);
    assert.ok(s.includes("grupo: 'Imprimir'") && s.includes("grupo: 'Mudar situação'"), f);
    assert.ok(!s.includes('Mudar situação para'), f);
  }
});

test('menu de Entregas: sem "Copiar endereço", "Copiar contato no local" nem "Ligar para o contato"', () => {
  const s = ler('entregas.js');
  for (const t of ['Copiar endereço', 'Copiar contato no local', "rotulo: 'Ligar para o contato'", "'copiar_endereco'", "'copiar_contato'", "case 'ligar'", 'copiarTexto']) assert.ok(!s.includes(t), t);
});
