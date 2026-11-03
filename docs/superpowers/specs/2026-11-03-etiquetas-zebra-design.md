# Etiquetas de volume na Zebra ZD220 (design)

Data: 2026-11-03. Pedido do dono. Substitui a etiqueta feita à mão (logo, Pedido, Nome, Cliente, Qtd, endereço da fábrica).

## 1. Objetivo e escopo

Gerar, a partir de um **Pedido**, uma etiqueta por **unidade** de cada item de **porta de alumínio** (giro, basculante, correr, gaveta) e de **serralheria** (o conjunto inteiro, não cada peça de metalon), para colar na embalagem. Item com quantidade 3 gera 3 etiquetas.

- Papel: **100 x 60 mm**, 203 dpi (aprox. 800 x 480 pontos), impressa na posição de leitura (sem girar o texto).
- Impressora: Zebra ZD220, ligada por **USB a um PC da empresa**. Só esse PC imprime.
- Disparo: item **"Imprimir etiquetas"** no menu do botão direito do Pedido, com prévia; imprime todas ou só uma (reimpressão). Sem impressão automática.
- Só Pedido não cancelado. Orçamento, venda avulsa, acessórios, vidros e peças de corte ficam de fora.

## 2. Conteúdo da etiqueta

- Logo (bitmap monocromático), **PEDIDO nº** em destaque e **"n / total"** (posição da etiqueta no pedido inteiro, não no item).
- **CLIENTE** = `ped_orc.RAZAO_SOCIAL`; **OBRA** = `ped_orc.CLIENTE_FINAL` (linha omitida se vazia).
- **ITEM n**, tipo, descrição do item (medidas, perfil, acabamento, cor), vindos do que o pedido já grava (`ped_orc_lista_itens.DESCRICAO` etc.). **Nenhum cálculo novo.**
- **QR code** com `ELG|<pedido>|<item>|<unidade>`; por ora só identifica.
- Rodapé pequeno: endereço e telefone da fábrica (constantes do módulo).
- **Sem preço e sem peso.** Textos longos são cortados com reticências; nunca estouram a etiqueta. Acentos por `^CI28` (UTF-8).

## 3. Arquitetura

1. **Servidor** (`calculo/etiqueta.js`, funções puras; `rotas/etiquetas.js`): `GET /etiquetas/pedido/:n` devolve `{ pedido, cliente, obra, etiquetas: [{ numeroEtiqueta, qtdEtiquetas, item, unidadeDoItem, qtdDoItem, tipo, linhas, zpl }] }` e `POST /etiquetas/registro` grava a auditoria `etiquetas_impressas` (usuário, pedido, quantidade; sem dados pessoais).
2. **Tela** (`etiquetas.html`, `etiquetas.js`): prévia desenhada em CSS/canvas (aproximada, não é o ZPL real), botões Imprimir todas / Imprimir só esta, status da impressora, "impressas em dd/mm às hh:mm".
3. **Serviço local** (`local/etiquetas.js`, carregado por `local/salvador_pdf.js` como o da SEFAZ; instalador passa a copiá-lo): `GET /etiqueta/status` e `POST /etiqueta/imprimir` `{ zpl }`. Envio RAW ao spooler do Windows por PowerShell (sem dependência nova).

### Segurança do serviço local
- Só a origem do site (mesma regra das outras rotas); Host só `127.0.0.1`/`localhost`; `Content-Type: application/json`.
- Validação do ZPL: começa em `^XA`, termina em `^XZ`, tamanho máximo, no máximo 200 etiquetas por chamada, **comandos `~` recusados**.
- Impressora escolhida só por **nome** (`etiqueta.config.json` ao lado do `sefaz.config.json`, ou `ELEGANCE_IMPRESSORA_ETIQUETA`); sem config, busca "ZDesigner"/"ZD220": exatamente uma = usa; zero ou várias = pede o nome. Nenhum caminho vem da tela.

### Erros
- Serviço fora do ar ou PC errado: a tela avisa e não imprime nada.
- Impressora desligada ou sem papel: o Windows aceita na fila e imprime quando voltar; a tela diz "enviado para a fila".
- Falha no meio do lote: mostra quantas foram e mantém as restantes para nova tentativa (sem repetir as já enviadas, salvo "Imprimir só esta").

## 4. Permissões

- Nova: `etiquetas.imprimir`, na migração para Administrador e Interno completo (`acrescentarPermissoesEtiquetas`). Item de menu e rotas exigem a permissão (403 sem ela).
- Nada é dinheiro: sem `valores.ver`; nenhum nome de campo casa com `REGEX_VALOR` (`qtd*`, `numeroEtiqueta`; **nunca `total`**, que casa com a regra de dinheiro e seria apagado da resposta).
- Estados restritos: não monta etiqueta de cliente de outro estado (403).
- O serviço local não conhece o usuário (como na SEFAZ): o controle é do servidor ao montar as etiquetas e da tela.

## 5. Testes

- `test/etiqueta_calculo.test.js`: unidades por item, numeração n/total, corte de textos longos, obra vazia, acentos, ZPL e QR válidos.
- `test/etiquetas_rotas.test.js` (banco falso): só Pedido, cancelado = 404, permissão, estados, itens avulsos fora, auditoria.
- `test/etiqueta_local.test.js`: validação do ZPL (`^XA...^XZ`, `~`, tamanho, origem, Host) com spooler **falso**; nunca imprime de verdade.
- `test/etiquetas_tela.test.js`: HTML, CSP, item de menu, permissões, compilação dos scripts.

## 6. Fora do escopo (de propósito)

Ler o QR para dar baixa; etiqueta para orçamento, acessórios, avulso, vidros e corte; imprimir de qualquer PC; impressão automática sem clique; editar o texto na tela; desenho da porta na etiqueta; PDF da etiqueta como reserva.

## 7. Pendências e riscos

- **Logo** em preto e branco: usar o arquivo que o dono enviar ou converter `imagens/logo_elegance.png`.
- **Nome da impressora** no Windows, para o exemplo de configuração.
- **Não testável aqui:** o envio real ao spooler e a impressão na ZD220 real (acentos, nitidez do QR, tamanho do papel, "gap" do rolo). Validar à mão no PC da fábrica; o ajuste do papel (`^PW`, `^LL`, calibração do sensor) pode exigir uma rodada de teste.
- A descrição do item vem do texto já gravado; se for longa demais para a etiqueta, será cortada (a etiqueta não é a fonte de verdade das medidas).
