# Etiquetas de pedido/produção na Zebra

Uma etiqueta de 100 × 60 mm (203 dpi = 8 dots/mm, `^PW800 ^LL480`, UTF-8 `^CI28`) **por item do Pedido**. Spec: `docs/superpowers/specs/2026-11-04-etiqueta-zebra-design.md`.

## Layout (2026-11-12, copiado da etiqueta de referência do dono)
De cima para baixo, em dots (800 × 480): logo "elegance Alumínio" numa caixa arredondada (`^GB`) em 14,14 e, ao lado, **"Pedido: N"** (y 30, até 64 de altura); **"Nome: <razão social>"** (`ped_orc.RAZAO_SOCIAL`, y 120); **"Cliente: <cliente final>"** (`ped_orc.CLIENTE_FINAL`, y 240); **"Qtd: n"** (`QTD` do item, y 368, à esquerda) e, à direita na mesma faixa, o **código de barras Code 128 do nº do pedido** (`^BY3`, altura 80, modo automático, zona de silêncio de 10 módulos). Textos em fonte 0 e negrito simulado (cada linha impressa duas vezes, 2 dots deslocada). **O endereço e o telefone da Elegance foram removidos**; descrição, medidas, entrega e "Item n/total" deixaram de sair.
- **Ajuste de texto** (Nome e Cliente): uma linha no maior tamanho que couber (60, 52); senão até 2 linhas menores (52, 44, 36); se ainda não couber, trunca com "…". Largura estimada = caracteres × 0,6 × altura (conservadora; **conferir na Zebra real**). Razão social/cliente final: até 60 caracteres.
- **Cliente final vazio** imprime "Cliente: —" (mesma convenção de medida ausente).
- **Logo**: bitmap 1-bit 224 × 82 dots (28 mm) em `^GFA`, gerado do `imagens/logo_elegance.png` por `node calculo/gerar_logo_zpl.js` (só zlib do Node, determinístico, sem rede) e guardado em `calculo/etiqueta_logo.js`. Rode o script de novo só se o PNG mudar.

## Como funciona
1. Menu do botão direito do Pedido (Início e Pedidos): "🏷️ Imprimir etiquetas (Zebra)" (permissão `pedidos.pdf`) → `etiqueta_zebra.js`.
2. A tela confere o serviço local (`GET 127.0.0.1:3917/ping`); sem resposta, avisa e para. Não há plano B pelo navegador (ZPL não imprime pelo diálogo comum).
3. `GET /etiquetas/pedido/:numero` (`rotas/etiquetas.js`) devolve `{ zpl, quantidade }`. O ZPL é montado por `calculo/etiqueta_zpl.js` (função pura).
4. A tela envia o ZPL a `POST 127.0.0.1:3917/etiqueta` (`local/zebra.js`), que o grava RAW no spooler do Windows por PowerShell (`winspool.drv`).

## Regras
- **Só Pedido**; só leitura; respeita os estados do usuário (`foraDosEstados`) como `/dados_pdf`. Pedido sem itens = 404 com mensagem própria.
- **Sem dinheiro**: nenhum campo de valor na etiqueta nem na resposta (a contagem se chama `quantidade`, nunca `total`).
- **Saneamento**: todo texto do banco perde `^`, `~` e `\` e caracteres de controle (`sanearZpl`); o conteúdo do pedido nunca vira comando da impressora. Razão social e cliente final: truncados com "…" (ver Layout).
- **A impressora nunca vem da requisição**: só de `zebra.config.json` (`{ "impressora": "nome no Windows" }`, ao lado de `zebra.js`; exemplo em `local/zebra.config.exemplo.json`) ou, sem ele, a primeira cujo nome contenha "zebra" ou "zdesigner". Sem impressora, o serviço responde 500 com a lista encontrada.
- ZPL: máximo 1 MB, tem que começar em `^XA` e terminar em `^XZ`. O ZPL vai ao PowerShell por stdin (base64) e o nome da impressora por variável de ambiente: nada do site vira linha de comando.
- Se `zebra.js` faltar no PC, o salvador de PDF segue funcionando e `/etiqueta` responde 503; `/ping` informa `zebra: true/false`.

## Instalação e pendências
- Reinstalar o serviço local em cada PC que imprimir (`local/instalar_salvador_pdf.bat`; o instalador copia `zebra.js` e o exemplo de configuração e preserva `zebra.config.json`).
- **Não testado em Zebra real.** Testes: `test/etiqueta_zpl.test.js`, `test/etiquetas_rotas.test.js`, `test/zebra_local.test.js` (envio falso), `test/etiqueta_tela.test.js`. O PowerShell foi verificado só até o erro "impressora inexistente" (compila e o spooler responde). Falta, no PC da empresa: confirmar o nome da impressora, que o driver aceita RAW (driver Zebra ou "Generic / Text Only"), o tamanho, os acentos, a leitura do código de barras, o encaixe dos textos (fator 0,6 da largura) e a qualidade do logo.

## Impressora errada (2026-11-12) e a regra nova
- **O que aconteceu:** no PC da impressora, "Imprimir etiquetas (Zebra)" disse "enviada(s) para ZDesigner for Developers - Generic Printer 600dpi", o Windows salvou `Documentos\Etiqueta Elegance.prn` (401 bytes) e nada saiu. A detecção antiga pegava a **primeira** impressora cujo nome tinha "zebra"/"zdesigner"; esse driver é de **porta FILE:** (imprime em arquivo) e veio antes da Zebra USB real.
- **Regra nova (`escolherImpressora` em `local/zebra.js`):** sem `zebra.config.json`, entram só impressoras Zebra/ZDesigner/ZPL (nome ou driver) **fora** das virtuais: porta `FILE:`/`PORTPROMPT:`/`.prn`/`.txt`/`.pdf`/`.xps`, ou nome/driver "Print to PDF", XPS, OneNote, Fax, "for Developers". Entre elas, vale a de porta `USB…` pronta (não offline). Se sobrar **uma**, é ela; se sobrarem **várias**, o serviço NÃO adivinha: responde 500 listando nomes e portas e pedindo para fixar em `zebra.config.json`; se não sobrar nenhuma: "Nenhuma impressora Zebra USB encontrada; instaladas: ...". Nunca imprime em arquivo.
- **Nome fixado em `zebra.config.json` também é conferido:** se a porta for `FILE:`/virtual, o serviço recusa com mensagem explicando.
- A resposta de sucesso traz `impressora` (nome) **e** `porta`; a tela mostra os dois no alerta.
- **Diagnóstico:** `GET http://127.0.0.1:3917/impressoras` (somente leitura, mesmas regras de origem do `/ping`) lista cada impressora com nome, porta, driver, status, `virtual`, `zebra`, `usb`, `pronta`, `candidata`, mais `escolhida` e `problema`. Abra no navegador do PC da impressora.
- **Como fixar a Zebra:** copie `zebra.config.exemplo.json` para `zebra.config.json` (mesma pasta de `zebra.js`, `C:\Programa Elegance\Servico`) e ponha o nome exato visto em `/impressoras`: `{ "impressora": "ZDesigner ZD220-203dpi ZPL" }` (o exemplo "ZDesigner ZD220" é só ilustração). Vale na próxima etiqueta, sem reiniciar. O instalador preserva esse arquivo.
- Testes: `test/zebra_local.test.js` (impressoras injetadas, sem Windows).
