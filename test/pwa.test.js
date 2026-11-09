'use strict';
// Atalho no celular (PWA): manifesto, ícones, tags nas páginas e service worker sem cache de dados.
process.env.JWT_SECRET = 'teste';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');
const ler = f => fs.readFileSync(path.join(RAIZ, f), 'utf8');
const manifesto = JSON.parse(ler('manifest.webmanifest'));

// Lê largura e altura do cabeçalho IHDR de um PNG.
function dimensoesPng(arquivo) {
    const b = fs.readFileSync(path.join(RAIZ, arquivo));
    assert.strictEqual(b.subarray(1, 4).toString('latin1'), 'PNG', arquivo + ' não é PNG');
    return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

test('manifesto tem os campos obrigatórios e caminhos relativos (GitHub Pages em /APP_SITE/)', () => {
    assert.strictEqual(manifesto.name, 'ELEGANCE');
    assert.strictEqual(manifesto.short_name, 'Elegance');
    assert.strictEqual(manifesto.display, 'standalone');
    assert.strictEqual(manifesto.lang, 'pt-BR');
    assert.strictEqual(manifesto.start_url, './login.html');
    assert.strictEqual(manifesto.scope, './');
    assert.match(manifesto.theme_color, /^#[0-9a-f]{6}$/i);
    assert.match(manifesto.background_color, /^#[0-9a-f]{6}$/i);
    for (const i of manifesto.icons) assert.ok(!i.src.startsWith('/'), 'ícone com caminho absoluto: ' + i.src);
});

test('ícones do manifesto existem com as dimensões declaradas, inclusive maskable', () => {
    const tamanhos = new Set();
    for (const i of manifesto.icons) {
        const [w, h] = i.sizes.split('x').map(Number);
        const d = dimensoesPng(i.src);
        assert.deepStrictEqual([d.w, d.h], [w, h], i.src);
        tamanhos.add(`${i.purpose}:${i.sizes}`);
    }
    for (const t of ['any:192x192', 'any:512x512', 'maskable:192x192', 'maskable:512x512']) assert.ok(tamanhos.has(t), 'falta ' + t);
    assert.deepStrictEqual(dimensoesPng('icones/apple-touch-icon.png'), { w: 180, h: 180 });
});

test('páginas-chave referenciam manifesto, ícone da Apple, theme-color ', () => {
    const paginas = ['login', 'inicio', 'painel_inicial', 'minhas_entregas', 'baixa_qr', 'etapas_producao', 'entregas', 'calendario', 'calendario_dia', 'estoque'];
    for (const p of paginas) {
        const h = ler(p + '.html');
        assert.match(h, /<link rel="manifest" href="manifest\.webmanifest">/, p);
        assert.match(h, /<link rel="apple-touch-icon" href="icones\/apple-touch-icon\.png">/, p);
        assert.match(h, /<meta name="theme-color" content="#14161a">/, p);
        assert.match(h, /apple-mobile-web-app-capable/, p);
    }
});

test('layout.js carrega o pwa.js nas demais páginas e o pwa.js registra o sw.js', () => {
    assert.match(ler('layout.js'), /"pwa\.js"/);
    assert.match(ler('pwa.js'), /serviceWorker\.register\(url\('sw\.js'\)\)/);
});

test('sw.js não guarda nada em cache e não intercepta a API', () => {
    const sw = ler('sw.js');
    assert.doesNotMatch(sw, /\bcaches\b/);
    assert.doesNotMatch(sw, /\.(put|addAll|add)\s*\(/);
    assert.doesNotMatch(sw, /onrender\.com|\/api\//);
    // só trata navegação (páginas); qualquer outra requisição segue direto para a rede
    assert.match(sw, /req\.mode !== 'navigate'/);
});
