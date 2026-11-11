// Aba "Desenho 3D" de produtos.html: conferência estática do HTML, dos ganchos e do script (o mouse/canvas só se vê no navegador).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ler = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');   // checkout com CRLF (autocrlf) nao quebra os trechos com \n
const html = ler('produtos.html');
const editor = ler('perfil_editor.js');

test('produtos.html: aba "Desenho 3D" existe, começa oculta e o conteúdo fica FORA do <form> (não marca o produto como alterado)', () => {
  assert.match(html, /<button class="aba pe-oculta" data-aba="desenho3d"[^>]*>Desenho 3D<\/button>/);
  const posForm = html.indexOf('</form>');
  const posAba = html.indexOf('data-aba="desenho3d" id="pe-raiz"');
  assert.ok(posForm > 0 && posAba > posForm, 'conteúdo da aba depois do </form>');
  assert.ok(html.indexOf('<div class="acoes">') > posAba);
  // as outras abas continuam na ordem: Dados, Preços e descontos, Permissões, Desenho 3D
  const abas = [...html.matchAll(/<button class="aba[^"]*" data-aba="([a-z0-9]+)"/g)].map(m => m[1]);
  assert.deepEqual(abas, ['dados', 'precos', 'permissoes', 'desenho3d']);
});

test('produtos.html: scripts novos carregados na ordem certa e nenhum script inline novo', () => {
  const ordem = ['calculo/perfil_secoes.js', 'desenho3d.js', 'calculo/perfil_traco.js', 'perfil_editor.js'].map(s => html.indexOf(`<script src="${s}`));
  assert.ok(ordem.every(i => i > 0), 'todos presentes');
  assert.deepEqual([...ordem].sort((a, b) => a - b), ordem, 'ordem: seções, 3D, traçado, editor');
  const inline = html.match(/<script(?![^>]*\ssrc=)[^>]*>/g) || [];
  assert.equal(inline.length, 1, 'continua um único bloco inline (o que já existia)');
  assert.ok(html.indexOf('<script src="perfil_editor.js') < html.indexOf('<script>\n        const API_BASE'), 'editor carrega antes do script da página');
  // a CSP já libera o jsDelivr (Three.js sob demanda) e não foi afrouxada
  const csp = html.match(/Content-Security-Policy" content="([^"]+)"/)[1];
  assert.ok(csp.includes('https://cdn.jsdelivr.net'));
  assert.ok(!/script-src[^;]*\*/.test(csp));
  assert.doesNotMatch(html, /\son(click|change|error|load)=/); // (o onsubmit do <form> já existia)
});

test('produtos.html: todo id que o editor usa existe no HTML', () => {
  const bloco = editor.slice(editor.indexOf('const IDS = {'), editor.indexOf('function iniciar(contexto'));
  const ids = [...bloco.matchAll(/'(pe-[a-z0-9-]+)'/g)].map(m => m[1]);
  assert.ok(ids.length > 40);
  for (const id of ids) assert.ok(html.includes(`id="${id}"`), `falta id="${id}"`);
  // ids duplicados quebrariam o editor
  for (const id of ids) assert.equal(html.split(`id="${id}"`).length, 2, `id repetido: ${id}`);
});

test('produtos.html: ganchos do editor (iniciar, produto mudou, descartar alterações do desenho)', () => {
  assert.match(html, /PerfilEditor\.iniciar\(\{ api, toast, confirmar, pode:/);
  assert.match(html, /function avisarEditorPerfil\(recarregar\)/);
  assert.match(html, /\$\('f-classe'\)\.addEventListener\('change', \(\) => \{ aplicarRegrasClasse\(true\); avisarEditorPerfil\(false\); \}\)/);
  assert.equal((html.match(/avisarEditorPerfil\(true\)/g) || []).length, 2, 'ao abrir produto e ao limpar a ficha');
  assert.match(html, /\(alterado \|\| desenhoPerfilSujo\(\) \|\| dependenciasSujas\(\)\) && !\(await confirmar\('Descartar alterações\?'/);
  assert.match(html, /beforeunload', e => \{ if \(alterado \|\| desenhoPerfilSujo\(\)\)/);
  // a classe GRAVADA vem da API (o select pode estar adiante)
  assert.match(html, /classeSalva = p\.classe \|\| ''/);
  assert.match(html, /acabamentosDoProduto = \(p\.permitidos && p\.permitidos\.acabamentos\) \|\| \[\]/);
});

test('perfil_editor.js: compila, permissão perfis.desenho, rotas da API e só vale para classe Perfil', () => {
  assert.doesNotThrow(() => new vm.Script(editor, { filename: 'perfil_editor.js' }));
  assert.doesNotThrow(() => new vm.Script(ler('calculo/perfil_traco.js'), { filename: 'perfil_traco.js' }));
  assert.match(editor, /ctx\.pode\('perfis\.desenho'\)/);
  assert.match(editor, /'\/perfil_secoes\/' \+ encodeURIComponent\(produto\.codigo\), \{ method: 'PUT'/);
  assert.match(editor, /'\/perfil_secoes\/' \+ encodeURIComponent\(produto\.codigo\), \{ method: 'DELETE'/);
  assert.match(editor, /'\/produtos\/imagem\/'/);
  assert.match(editor, /info\.classe !== 'Perfil'/);
  assert.match(editor, /Salve o produto \(classe Perfil\) antes/);
  assert.match(editor, /Remover o desenho deste perfil\?/);              // confirmação antes de apagar
  assert.match(editor, /ainda n\[aã\]o tem desenho/);                    // 404 = sem desenho; outro erro NUNCA libera gravar às cegas
  const mod = require('../perfil_editor.js');
  assert.equal(typeof mod.iniciar, 'function');
  assert.equal(typeof mod.produtoMudou, 'function');
  assert.equal(mod.temAlteracao(), false);
});

test('perfil_editor.js: dado da API/usuário nunca por innerHTML; sem cor solta; imagem local não é enviada', () => {
  assert.ok(!/innerHTML|insertAdjacentHTML|document\.write|eval\(/.test(editor.replace(/^\s*\/\/.*$/gm, '')));
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(editor.replace(/\/\/.*$/gm, '')), 'cores do canvas vêm das variáveis do tema');
  assert.ok(!/rgba?\(|hsla?\(/.test(editor));
  assert.match(editor, /getPropertyValue\('--primary-color'\)|v\('--primary-color'\)/);
  // arquivo escolhido só vira URL local (blob), nunca vai para fetch/api
  const trecho = editor.slice(editor.indexOf("el.arq.addEventListener('change'"), editor.indexOf("el.calibrar.addEventListener"));
  assert.match(trecho, /URL\.createObjectURL\(f\)/);
  assert.ok(!/api\(|fetch\(|FormData/.test(trecho));
});

test('CSS da aba: só variáveis do tema, fundos sólidos (nada de rgba/hsla/hex solto nem transparent)', () => {
  const ini = html.indexOf('/* ===== ABA DESENHO 3D');
  const fim = html.indexOf('</style>', ini);
  assert.ok(ini > 0 && fim > ini);
  const css = html.slice(ini, fim);
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(css), 'sem hexadecimal solto');
  assert.ok(!/rgba?\(|hsla?\(|transparent/.test(css));
  for (const sel of ['.pe-palco', '.pe-cena', '.pe-erros', '.pe-secao']) {
    const m = css.match(new RegExp(sel.replace('.', '\\.') + ' \\{[^}]*\\}'));
    assert.ok(m && /background: var\(--(bg|surface-2)\)/.test(m[0]), `${sel} com fundo sólido do tema`);
  }
  // sem faixa lateral colorida maior que 1px
  assert.ok(!/border-(left|right): [2-9]px/.test(css));
});

test('prévia: Desenho3D sob demanda (versão fixa e SRI continuam no desenho3d.js) e vidro sempre 4 mm', () => {
  const d = ler('desenho3d.js');
  assert.match(d, /three@0\.149\.0/);
  assert.match(d, /integrity: 'sha384-/);
  assert.match(editor, /raiz\.Desenho3D\.criar\(el\.cena/);
  assert.match(editor, /ctl3d\.esconder\(\)/, 'libera o WebGL ao sair da aba');
  assert.match(editor, /A tabela e o salvamento continuam funcionando/, 'sem WebGL: aviso e a tabela segue');
  assert.match(html, /value="4 mm \(fixo\)" readonly/);
});
