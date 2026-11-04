# Etiquetas de pedido/produção na Zebra (design)

Data: 2026-11-04 · Caminho: arquitetural · Abordagem escolhida: A (ZPL RAW pelo serviço local)

## Objetivo
Imprimir, a partir de um Pedido, **uma etiqueta por item do pedido** na impressora Zebra do PC da empresa, para identificar as peças na produção/expedição.

## Decisões do dono
- Conteúdo: etiqueta de pedido/produção, uma por item (`ped_orc_lista_itens`).
- Impressora: Zebra por **USB, instalada no Windows** (spooler).
- Etiqueta: **100 × 60 mm**, completa: cliente, nº do pedido, item/total, descrição, medidas (L × A), data de entrega e código de barras do pedido.
- Abordagem: servidor monta o ZPL; o serviço local do PC (porta 3917) envia RAW ao spooler.

## Fora do escopo
Etiquetas de Orçamento; etiqueta por peça/folha; desenho da porta na etiqueta; fila ou histórico de reimpressão; impressão pelo diálogo do navegador.

## Componentes

### 1. `calculo/etiqueta_zpl.js` (função pura, sem banco)
- Entrada: cabeçalho do pedido e itens. Saída: um bloco `^XA…^XZ` por item.
- Layout: `^PW800 ^LL480` (203 dpi), `^CI28` (UTF-8). Campos: cliente (destaque), "Pedido nº X", "Item i/N" e "Qtd", descrição (`^FB`, truncada em poucas linhas), medidas "H × L" (de `ped_orc_itens_v4`), data de entrega, Code 128 com o nº do pedido.
- **Saneamento obrigatório**: todo texto do banco perde ou escapa `^`, `~` e `\` e caracteres de controle; o conteúdo do pedido nunca vira comando da impressora.
- Descrição reaproveita `descricaoItem` de `pdf/ped_orc.js` (igual ao Guia de Produção).
- Medida ausente aparece como "—", **nunca estimada**.
- Nenhum campo de dinheiro.

### 2. `rotas/etiquetas.js` (servidor)
- `GET /etiquetas/pedido/:numero`, registrada por `registro.rota` com a permissão **`pedidos.pdf`** (sem permissão nova).
- Só Pedido. Respeita o filtro de estados (`foraDosEstados`), como `/dados_pdf`. Pedido inexistente ou sem itens: 404 com mensagem.
- Resposta: `{ zpl, total }`.

### 3. `local/zebra.js` (serviço local)
- Carregado por `local/salvador_pdf.js` como o `sefaz.js`; se faltar, o serviço continua funcionando e a rota avisa.
- `POST /etiqueta` com `{ zpl }`: confere origem (já existente), tamanho máximo de 1 MB e se o texto começa em `^XA` e termina em `^XZ`.
- Envio por PowerShell com `winspool.drv` (`OpenPrinter`/`WritePrinter`, tipo RAW). Sem dependências npm.
- Impressora vem **só** de `local/zebra.config.json` (`{ "impressora": "..." }`, com arquivo de exemplo) ou, sem ele, da primeira impressora com "zebra" ou "zdesigner" no nome. Nunca do corpo da requisição. Sem impressora: erro claro com a lista encontrada.
- `/ping` passa a informar `zebra: true/false`. O instalador copia o arquivo novo e reinicia o serviço.
- O envio ao spooler é um módulo injetável, para os testes não chamarem o PowerShell.

### 4. Tela
- Item "🏷️ Imprimir etiquetas (Zebra)" (permissão `pedidos.pdf`) no menu do botão direito de `inicio_menu.js` e de `painel_inicial.html`.
- Arquivo compartilhado `etiqueta_zebra.js`: busca o ZPL no servidor (com o token) e envia ao `127.0.0.1:3917/etiqueta`. As duas páginas já liberam a porta 3917 na CSP.
- Serviço local sem resposta ao `/ping`: aviso "Serviço local não encontrado neste PC". Sem plano B pelo navegador.

## Testes (`node:test`, sem MySQL nem impressora)
- ZPL: uma etiqueta por item, contagem, saneamento de `^ ~ \`, truncamento, acentos, ausência de dinheiro.
- Rota: permissão, 404, estados e formato da resposta, com banco falso.
- Serviço local: origem, validação do ZPL, erro de impressora ausente, envio injetado.
- **Não testável aqui:** o envio real à Zebra (só no PC da empresa, como o salvador de PDF).

## Pendências e riscos
- Reinstalar o serviço local em cada PC que imprimir (como em mudanças anteriores).
- Confirmar no PC real o nome da impressora e que o driver aceita RAW (driver Zebra ou "Generic / Text Only").
- Atualizar `CLAUDE.md` e `docs/regras/servico-local.md` ao implementar.
