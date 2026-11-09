# Atalho do Elegance no celular (app instalável)

O sistema pode ser colocado na tela inicial do celular, com ícone próprio, abrindo em tela cheia (sem a barra do navegador).

## Android (Chrome)
1. Abra `https://thiagozmb.github.io/APP_SITE/login.html` no Chrome.
2. Menu (três pontinhos) -> **Instalar app** (ou **Adicionar à tela inicial**).
3. Confirme. O ícone "Elegance" aparece na tela inicial.

## iPhone (Safari)
1. Abra o mesmo endereço no **Safari** (outro navegador não serve para isso).
2. Botão **Compartilhar** -> **Adicionar à Tela de Início** -> **Adicionar**.

## Limites
- Só funciona abrindo pelo endereço HTTPS do GitHub Pages (não por arquivo local nem `http://`).
- O app é o mesmo site: precisa de internet, faz login como sempre e não guarda dados no aparelho. O service worker (`sw.js`) existe só para o Android oferecer a instalação; ele não guarda páginas nem respostas da API (há teste em `test/pwa.test.js`).
- O iPhone ignora parte do manifesto (usa `icones/apple-touch-icon.png` e as metas `apple-mobile-web-app-*`).
- Se mudar o endereço do site, o atalho antigo continua apontando para o endereço velho: apague e instale de novo.
- Não testado em aparelho real ainda.

## Arquivos
`manifest.webmanifest`, `sw.js`, `pwa.js` (carregado pelo `layout.js`; garante as tags e registra o service worker), `icones/` (PNG 192/512, versão maskable e apple-touch 180, gerados a partir do "e" de `imagens/Logo 1.png`). As páginas principais (login, início, pedidos, entregas, etapas, calendário, estoque, baixa por QR) trazem as tags no HTML; as demais recebem pelo `pwa.js`. Caminhos relativos de propósito, por causa do `/APP_SITE/`.
