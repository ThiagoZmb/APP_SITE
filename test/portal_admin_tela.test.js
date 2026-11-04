// Tela da equipe do portal do cliente: conferência estática do HTML, do menu e do script
// (a tela no navegador real não tem teste automático).
process.env.JWT_SECRET = 'teste';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ler = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const contar = (texto, regex) => (texto.match(regex) || []).length;
// tira comentários de linha e de bloco para não confundir o que é código com o que é explicação
const semComentarios = js => js.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('página: CSP de tela interna, layout.js, portal_admin.js e sem handlers inline', () => {
  const h = ler('portal_admin.html');
  assert.match(h, /Content-Security-Policy/);
  assert.match(h, /connect-src 'self' https:\/\/elegance-backend-hrho\.onrender\.com/);
  assert.match(h, /name="viewport"/);
  assert.ok(h.includes('<script src="layout.js'));
  assert.ok(h.includes('<script src="entregas_comum.js'));
  assert.ok(h.includes('<script src="portal_admin.js'));
  for (const id of ['busca', 'lista-clientes', 'lista-empresas', 'lista-usuarios', 'form-convite', 'convite-email', 'caixa-link', 'campo-link', 'btn-copiar']) {
    assert.ok(h.includes(`id="${id}"`), id);
  }
  assert.ok(h.includes('Envie este link ao cliente por um canal seguro; ele não será mostrado de novo.'));
  assert.ok(h.includes('nomes_duplicados'));
  assert.match(h, /id="campo-link"[^>]*readonly/);
  assert.doesNotMatch(h, /\son(click|change|submit|error|load)=/);
});

test('layout.js: Portal do cliente no menu (depois de Usuários) e em PAGINAS com portal.gerir', () => {
  const l = ler('layout.js');
  assert.equal(contar(l, /href: 'portal_admin\.html', texto: 'Portal do cliente'/g), 1);
  assert.equal(contar(l, /'portal_admin\.html': \['portal\.gerir'\]/g), 1);
  assert.ok(l.indexOf("href: 'portal_admin.html'") > l.indexOf("href: 'usuarios.html'"));
  assert.match(l, /href: 'portal_admin\.html'[^}]*sub: true/);
  assert.match(l, /'minhas_entregas\.html': \['entregas\.baixar'\]\s*\/\/ por último/);
});

test('portal_admin.js: compila e só usa textContent/value para dados do servidor', () => {
  const js = ler('portal_admin.js');
  assert.doesNotThrow(() => new vm.Script(js, { filename: 'portal_admin.js' }));
  const codigo = semComentarios(js);
  assert.equal(contar(codigo, /innerHTML/g), 0, 'nenhum innerHTML');
  assert.equal(contar(codigo, /insertAdjacentHTML|outerHTML|document\.write/g), 0);
  assert.ok(contar(codigo, /\.textContent\s*=/g) >= 8, 'usa textContent');
  assert.ok(contar(codigo, /createElement\(/g) >= 1, 'monta a tela por createElement');
  assert.ok(contar(codigo, /\bel\('/g) >= 10, 'usa o helper el() (createElement + textContent)');
  assert.ok(contar(codigo, /\.value\s*=/g) >= 1, 'o link vai por value');
});

test('portal_admin.js: confirm antes de suspender, reiniciar o 2º fator, desativar e remover usuário', () => {
  const codigo = semComentarios(ler('portal_admin.js'));
  const suspender = codigo.match(/async function suspender[\s\S]*?\n    }\n/);
  const reiniciar = codigo.match(/async function reiniciar2fa[\s\S]*?\n    }\n/);
  const desativar = codigo.match(/async function desativar[\s\S]*?\n    }\n/);
  const remover = codigo.match(/async function remover[\s\S]*?\n    }\n/);
  assert.ok(suspender, 'função suspender encontrada');
  assert.ok(reiniciar, 'função reiniciar2fa encontrada');
  assert.ok(desativar, 'função desativar encontrada');
  assert.ok(remover, 'função remover encontrada');
  const antesDoPost = (corpo, rota) => {
    const iConfirm = corpo.indexOf('win.confirm(');
    const iChamada = corpo.indexOf(rota);
    assert.ok(iConfirm >= 0 && iChamada >= 0, rota);
    assert.ok(iConfirm < iChamada, `confirm antes de ${rota}`);
  };
  antesDoPost(suspender[0], '/suspender');
  antesDoPost(reiniciar[0], '/reiniciar_2fa');
  antesDoPost(desativar[0], '/desativar');
  antesDoPost(remover[0], '/remover');
  assert.ok(codigo.includes('Suspender derruba todas as sessões desta empresa. Continuar?'));
  assert.ok(codigo.includes('perderá os códigos de recuperação'));
  assert.ok(codigo.includes('A pessoa perde o acesso e as sessões abertas caem. Continuar?'));
  assert.match(codigo, /MSG_REMOVER = '[^']*Continuar\?'/);
  // reativar não pede confirmação; suspender, reiniciar, desativar e remover sim: exatamente quatro confirm
  assert.equal(contar(codigo, /win\.confirm\(/g), 4);
});

test('portal_admin.js: botões Desativar (convidado e ativo, nunca inativo) e Remover (só convidado)', () => {
  const codigo = semComentarios(ler('portal_admin.js'));
  const lista = codigo.match(/function desenharUsuarios[\s\S]*?\n    }\n/);
  assert.ok(lista, 'desenharUsuarios encontrada');
  assert.match(lista[0], /botao\('Desativar', 'btn-perigo', \(\) => desativar\(u\)\)/);
  assert.match(lista[0], /botao\('Remover', 'btn-perigo', \(\) => remover\(u\)\)/);
  // Remover só dentro do bloco do convidado; Desativar só para convidado/ativo (inativo não tem ação)
  assert.match(lista[0], /if \(u\.situacao === 'convidado'\) \{[\s\S]*?botao\('Remover'[\s\S]*?\}/);
  assert.match(lista[0], /if \(u\.situacao === 'convidado' \|\| u\.situacao === 'ativo'\) acoes\.appendChild\(botao\('Desativar'/);
  assert.match(codigo, /inativo: 'Inativo'/);
  assert.ok(codigo.includes("'/desativar'") && codigo.includes("'/remover'"));
});

test('portal_admin.js: o link do convite não vai a storage nem a console; busca com encodeURIComponent', () => {
  const codigo = semComentarios(ler('portal_admin.js'));
  assert.equal(contar(codigo, /localStorage\.(setItem|getItem)|sessionStorage/g), 0, 'nenhum storage');
  assert.equal(contar(codigo, /console\./g), 0, 'nenhum console');
  assert.ok(contar(codigo, /encodeURIComponent\(/g) >= 2, 'encodeURIComponent na busca e nos códigos');
  assert.match(codigo, /\/admin\/portal\/clientes\?q=' \+ encodeURIComponent/);
  // o link é limpo ao fechar/trocar de empresa e mostrado só quando o e-mail não foi enviado
  assert.ok(contar(codigo, /limparLink\(\)/g) >= 3, 'limparLink chamado em vários pontos');
  assert.ok(codigo.includes('Convite enviado por e-mail.'));
  assert.ok(codigo.includes('navigator.clipboard'));
  assert.ok(contar(codigo, /\.catch\(|catch\s*\(/g) >= 1);
});

test('portal_admin.js: usa as rotas da equipe e só oferece as ações permitidas por situação', () => {
  const codigo = semComentarios(ler('portal_admin.js'));
  for (const r of ['/admin/portal/clientes', '/admin/portal/empresas', '/admin/portal/convites', '/reenviar_convite', '/reiniciar_2fa', '/suspender', '/reativar', '/usuarios']) {
    assert.ok(codigo.includes(r), r);
  }
  assert.match(codigo, /liberavel/);
  assert.match(codigo, /'convidado'/);
  assert.match(codigo, /'ativo'/);
});
