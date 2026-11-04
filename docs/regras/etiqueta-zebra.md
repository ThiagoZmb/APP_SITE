# Etiquetas de pedido/produção na Zebra

Uma etiqueta de 100 × 60 mm (203 dpi, `^PW800 ^LL480`, UTF-8 `^CI28`) **por item do Pedido**: cliente, nº do pedido, item/total e quantidade, descrição, medidas, entrega e código de barras (Code 128) com o nº do pedido. Spec: `docs/superpowers/specs/2026-11-04-etiqueta-zebra-design.md`.

## Como funciona
1. Menu do botão direito do Pedido (Início e Pedidos): "🏷️ Imprimir etiquetas (Zebra)" (permissão `pedidos.pdf`) → `etiqueta_zebra.js`.
2. A tela confere o serviço local (`GET 127.0.0.1:3917/ping`); sem resposta, avisa e para. Não há plano B pelo navegador (ZPL não imprime pelo diálogo comum).
3. `GET /etiquetas/pedido/:numero` (`rotas/etiquetas.js`) devolve `{ zpl, quantidade }`. O ZPL é montado por `calculo/etiqueta_zpl.js` (função pura).
4. A tela envia o ZPL a `POST 127.0.0.1:3917/etiqueta` (`local/zebra.js`), que o grava RAW no spooler do Windows por PowerShell (`winspool.drv`).

## Regras
- **Só Pedido**; só leitura; respeita os estados do usuário (`foraDosEstados`) como `/dados_pdf`. Pedido sem itens = 404 com mensagem própria.
- **Sem dinheiro**: nenhum campo de valor na etiqueta nem na resposta (a contagem se chama `quantidade`, nunca `total`).
- **Saneamento**: todo texto do banco perde `^`, `~` e `\` e caracteres de controle (`sanearZpl`); o conteúdo do pedido nunca vira comando da impressora. Cliente é cortado em 50 caracteres, descrição em 300, medidas em 80.
- **Medida ausente = "—"**, nunca estimada (item sem linha em `ped_orc_itens_v4`, como serralheria e avulso). Folhas aparecem como `ALTURAxLARGURA | …`.
- **Entrega** na etiqueta é `ped_orc.DATA_PRONTO` (a previsão, a mesma do PDF). `DATA_ENTREGA` só é preenchida ao entregar, então não serve na produção. Decisão a confirmar com o dono.
- **A impressora nunca vem da requisição**: só de `zebra.config.json` (`{ "impressora": "nome no Windows" }`, ao lado de `zebra.js`; exemplo em `local/zebra.config.exemplo.json`) ou, sem ele, a primeira cujo nome contenha "zebra" ou "zdesigner". Sem impressora, o serviço responde 500 com a lista encontrada.
- ZPL: máximo 1 MB, tem que começar em `^XA` e terminar em `^XZ`. O ZPL vai ao PowerShell por stdin (base64) e o nome da impressora por variável de ambiente: nada do site vira linha de comando.
- Se `zebra.js` faltar no PC, o salvador de PDF segue funcionando e `/etiqueta` responde 503; `/ping` informa `zebra: true/false`.

## Instalação e pendências
- Reinstalar o serviço local em cada PC que imprimir (`local/instalar_salvador_pdf.bat`; o instalador copia `zebra.js` e o exemplo de configuração e preserva `zebra.config.json`).
- **Não testado em Zebra real.** Testes: `test/etiqueta_zpl.test.js`, `test/etiquetas_rotas.test.js`, `test/zebra_local.test.js` (envio falso), `test/etiqueta_tela.test.js`. O PowerShell foi verificado só até o erro "impressora inexistente" (compila e o spooler responde). Falta, no PC da empresa: confirmar o nome da impressora, que o driver aceita RAW (driver Zebra ou "Generic / Text Only"), o tamanho, os acentos, a leitura do código de barras e a data.
