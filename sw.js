// ELEGANCE - service worker mínimo, só para o navegador oferecer "Instalar app".
// NÃO guarda nada (nem páginas, nem dados, nem chamadas à API): o sistema tem dados
// sensíveis e JWT, então toda requisição segue direto para a rede. A única coisa que
// este arquivo faz é, se o celular estiver sem internet ao abrir uma página, mostrar
// um aviso simples em vez do erro do navegador.
self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', event => { event.waitUntil(self.clients.claim()); });

const AVISO_OFFLINE = '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<title>Sem conexão</title></head>'
    + '<body style="font-family:system-ui,sans-serif;background:#12151a;color:#e8eaee;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;text-align:center;padding:24px">'
    + '<div><h1 style="font-size:20px">Sem conexão</h1><p>Conecte o celular à internet e abra o Elegance de novo.</p></div></body></html>';

self.addEventListener('fetch', event => {
    const req = event.request;
    // Só páginas abertas pelo próprio app; API, imagens e o resto não passam por aqui.
    if (req.mode !== 'navigate' || new URL(req.url).origin !== self.location.origin) return;
    event.respondWith(fetch(req).catch(() => new Response(AVISO_OFFLINE, {
        status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }
    })));
});
