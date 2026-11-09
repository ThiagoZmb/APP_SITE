// ELEGANCE - atalho no celular (PWA). Carregado pelo layout.js em todas as páginas.
// Garante as tags do manifesto/ícones (as páginas principais já as trazem no HTML)
// e registra o service worker mínimo (sw.js, que não guarda dados).
(function () {
    if (window.__pwaCarregado) return;
    window.__pwaCarregado = true;
    const base = (document.currentScript && document.currentScript.src) || location.href;
    const url = nome => new URL(nome, base).href;
    const head = document.head;
    const garantir = (seletor, criar) => { if (!head.querySelector(seletor)) head.appendChild(criar()); };
    const link = (rel, href) => { const e = document.createElement('link'); e.rel = rel; e.href = href; return e; };
    const meta = (nome, conteudo) => { const e = document.createElement('meta'); e.name = nome; e.content = conteudo; return e; };

    garantir('link[rel="manifest"]', () => link('manifest', url('manifest.webmanifest')));
    garantir('meta[name="theme-color"]', () => meta('theme-color', '#14161a'));
    garantir('link[rel="apple-touch-icon"]', () => link('apple-touch-icon', url('icones/apple-touch-icon.png')));
    garantir('meta[name="apple-mobile-web-app-capable"]', () => meta('apple-mobile-web-app-capable', 'yes'));
    garantir('meta[name="mobile-web-app-capable"]', () => meta('mobile-web-app-capable', 'yes'));
    garantir('meta[name="apple-mobile-web-app-title"]', () => meta('apple-mobile-web-app-title', 'Elegance'));
    garantir('meta[name="apple-mobile-web-app-status-bar-style"]', () => meta('apple-mobile-web-app-status-bar-style', 'black'));

    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register(url('sw.js')).catch(() => { /* sem service worker o sistema funciona igual */ });
        });
    }
})();
