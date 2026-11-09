# Baixa de estoque por QR no celular — design

Data: 2026-11-09. Caminho: arquitetural (tela nova, rota nova, regra nova no login, geração de etiquetas).

## 1. Objetivo

O funcionário que só retira material do estoque entra pelo celular, a câmera já está pronta para ler o QR do item, e em poucos toques a baixa fica gravada. O administrador e os demais perfis continuam entrando no sistema normal.

Sucesso = baixa rápida, sem digitar código nem procurar o item em lista, com baixa errada ou duplicada difícil de acontecer.

### Decisões do dono (conversa de 2026-11-09)
- O **sistema gera** o QR de cada item (etiqueta impressa); o QR carrega o **código de barras que o item do estoque já tem** (`estoque.CODIGO_BARRA`, até 20 caracteres; o cadastro web o gera como EAN-13 por `POST /estoque/codigo_barras`, mas itens vindos do VB podem ter outro formato). Nenhum identificador novo. O banco **não** impõe unicidade desse código.
- Depois de ler: cartão com nome, unidade e saldo, **quantidade em 1 com + e −** e botão grande **"Dar baixa"**.
- Cai direto na leitura **só quem tem apenas a permissão de baixa** (ex.: perfil Estoquista). Quem tem outros acessos entra normal e abre a leitura por atalho no menu.

### Premissas (não ditas pelo dono, a confirmar na revisão)
- A baixa usa a regra de saída que já existe (transação, conferência de saldo, histórico, usuário do token). Estoque nunca fica negativo.
- Sem modo offline, sem baixa de vários itens de uma vez, sem ligação com pedido, sem impressão direta na Zebra (ver seção 7).

## 2. Como o QR é lido (abordagem escolhida)

Página própria com a câmera aberta no navegador (`getUserMedia`) e uma biblioteca JS de leitura de QR **copiada para o projeto** (o front não tem build). Roda em Android e iPhone sem instalar nada; exige HTTPS (o front já está em HTTPS no GitHub Pages). O vídeo nunca sai do aparelho: o QR é decodificado no próprio celular.

Descartadas: `BarcodeDetector` nativo (não existe no Safari do iPhone) e QR com link aberto pela câmera do sistema (cada leitura abre uma página nova, lento em baixas seguidas).

## 3. Telas

### 3.1 Etiquetas de QR (página `etiquetas_qr.html`, permissão `estoque.editar`, botão de acesso em `estoque.html`)
- O usuário escolhe os itens e gera uma folha para imprimir (QR + nome + código por item).
- Item sem código de barras não entra na folha: a página avisa quantos são e manda cadastrar o código em `estoque.html` (o cadastro já exige código de barras ao salvar).
- O QR é desenhado no navegador (biblioteca de geração de QR, também copiada para o projeto). A lista de itens vem de uma rota de leitura nova (seção 4).

### 3.2 Leitura e baixa (`baixa_qr.html`, `baixa_qr.js`, permissão `estoque.movimentar`)
1. A câmera abre sozinha.
2. Ao ler o QR, a câmera **pausa** e aparece o cartão: nome, unidade, saldo, quantidade (1, com + e −) e "Dar baixa" / "Cancelar".
3. "Dar baixa" grava, mostra "Baixa feita" com o novo saldo e volta para a câmera.
4. Reserva: campo para digitar o código (câmera negada, sem HTTPS ou QR danificado).

### 3.3 Login
`login.js` já escolhe a página inicial com `Acesso.primeiraPaginaDe` (`layout.js`). Regra nova: se o usuário tem `estoque.movimentar` e **nenhuma permissão fora do conjunto {`estoque.ver`, `estoque.movimentar`}**, o destino é `baixa_qr.html`. Os demais seguem o caminho de hoje. `baixa_qr.html` entra em `PAGINAS` do `layout.js` exigindo `estoque.movimentar`, e ganha item no menu para quem tem outros acessos.

## 4. Backend

- **Rota nova de leitura 1:** `GET /estoque/por_codigo/:codigo`, permissões `estoque.ver` + `estoque.movimentar` (as mesmas de `POST /estoque/saida`), criada por `registro.rota(...)`. Devolve só `{ codigo, nome, unidade, qtd }` (**sem preço, custo nem fornecedor**). O campo se chama `qtd` e **não** `saldo`: `saldo` casa com `REGEX_VALOR` de `seguranca/valores.js` e seria apagado da resposta de quem não tem `valores.ver` (o Estoquista). Código validado (texto de 1 a 20 caracteres, o mesmo limite do cadastro), SQL parametrizado. 404 uniforme se não existir ou se `SITUACAO` for `Inativo`; **409** ("Código de barras repetido no estoque: avise o administrador") se mais de um item tiver o mesmo código, para nunca baixar o item errado.
- **Rota nova de leitura 2:** `GET /estoque/etiquetas`, permissão `estoque.editar`, devolve `[{ codigo, produto, unidade, codBarras }]` dos itens ativos com código de barras preenchido, mais `semCodigo` (quantidade de itens ativos sem código).
- **Baixa:** `POST /estoque/saida` existente, sem alteração (`chave` única por confirmação, `data` `AAAA-MM-DD` do dia, `itens: [{ produtoCodigo, qtd }]`).
- Arquivos novos: `rotas/estoque_qr.js` (as duas rotas) e `calculo/estoque_qr.js` (validação do código e projeção das linhas, funções puras testáveis sem banco).

## 5. Segurança e erros

- Nenhuma rota nova de escrita; quem baixa é sempre o usuário do token.
- **Toque duplo:** cada confirmação gera uma `chave` própria (a rota já recusa chave repetida) e o botão fica desabilitado durante a gravação.
- **Leitura repetida:** câmera pausada enquanto o cartão está aberto.
- **Item inexistente/inativo:** "Item não encontrado", nada é gravado.
- **Saldo insuficiente:** mensagem da conferência existente no cartão; quantidade continua editável.
- **Sem internet / erro do servidor:** mostra o erro e não grava nada em fila. A baixa só vale quando o servidor confirma.
- **Sessão expirada:** volta ao login como as demais telas.
- **Câmera negada ou sem HTTPS:** cai no campo de digitar o código.
- **Desfazer:** continua só pelo estorno existente (`estoque.desfazer`); a tela do celular não ganha botão de desfazer.
- CSP da página nova: só `'self'` (a biblioteca de QR vem do próprio projeto, sem script ou estilo inline).

## 6. Testes (node:test, sem MySQL)

- Rota `por_codigo`: só os 4 campos permitidos; recusa código inválido (400); 404 para inexistente e para `Inativo`; 409 para código repetido; 403 sem `estoque.movimentar`; nenhum campo de dinheiro (`redeDeValores`).
- Rota `etiquetas`: só itens ativos com código; `semCodigo` correto; 403 sem `estoque.editar`.
- Regra do login: só `estoque.ver` + `estoque.movimentar` → `baixa_qr.html`; Administrador, Estoquista com qualquer permissão extra e outros perfis → destino de hoje.
- Tela: confirmação com `chave` única por tentativa; botão bloqueado durante a gravação; erro de saldo mantém o cartão e a quantidade; falha da câmera mostra o campo de digitar.
- **Não automatizável:** biblioteca de QR e câmera reais. Precisa de teste num celular Android e num iPhone; registrar como "NÃO testado em aparelho real" no CLAUDE.md/docs até acontecer (mesmo tratamento da Zebra).

## 7. Fora do escopo (próximas etapas, se importar)

Modo offline; baixa de vários itens de uma vez (carrinho); ligar a baixa a um pedido ou ordem; impressão direta da etiqueta de QR na Zebra (o ZPL suporta QR); QR de pedido; opção por usuário "começar na leitura".

## 8. Documentação a atualizar na implementação

`CLAUDE.md` (resumo do módulo + pastas), novo `docs/regras/baixa-qr.md`, `DESIGN.md`/`tema.css` apenas se surgir componente visual novo (o cartão da leitura deve usar as variáveis do tema).
