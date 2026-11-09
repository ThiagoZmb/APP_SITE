# Baixa de estoque por QR (celular)

**NÃO testado em aparelho real (Android e iPhone): câmera, leitura de QR (jsQR), QR gerado (escaneabilidade) e impressão das etiquetas.** Só a lógica pura, as rotas e as telas em Node (sem câmera) têm teste automático. Registrar o resultado do roteiro no fim deste arquivo antes de dar o módulo como validado (mesmo tratamento da Zebra).

Spec: `docs/superpowers/specs/2026-11-09-baixa-estoque-qr-design.md`.

### O que é
O funcionário que só retira material entra pelo celular e cai na câmera (`baixa_qr.html`); lê o QR da etiqueta, vê nome, unidade e quantidade em estoque, ajusta a quantidade (começa em 1) e toca em "Dar baixa". A baixa é a saída de estoque que já existia (`POST /estoque/saida`, sem alteração). Etiquetas com QR são impressas em `etiquetas_qr.html`.

### Tabela `estoque` e o código de barras
- O QR carrega o texto de `estoque.CODIGO_BARRA` (até 20 caracteres; o cadastro web gera EAN-13, mas itens vindos do VB podem ter outro formato). Nenhum identificador novo.
- **O banco não impõe unicidade de `CODIGO_BARRA`.** `GET /estoque/por_codigo/:codigo` faz `SELECT ... WHERE CODIGO_BARRA = ? LIMIT 2`; se vierem 2 linhas responde **409** ("Código de barras repetido no estoque: avise o administrador.") para nunca baixar o item errado. Inexistente ou `SITUACAO` Inativo = 404 uniforme ("Item não encontrado."). Código inválido (vazio, mais de 20 caracteres, caractere de controle) = 400.
- `GET /estoque/etiquetas` lista só `SITUACAO = 'Ativo'`; item sem código de barras não entra e é contado em `semCodigo` (a página manda cadastrar em `estoque.html`).

### `qtd` e não `saldo`
A resposta de `por_codigo` é só `{ codigo, nome, unidade, qtd }` (sem preço, custo nem fornecedor). O campo se chama **`qtd`**: `saldo` casa com `REGEX_VALOR` de `seguranca/valores.js` e `redeDeValores` o apagaria da resposta de quem não tem `valores.ver` (justamente o Estoquista). Não renomear para `saldo`.

### Chave do lançamento e repetição
- Ao ler o item, a tela gera uma `chave` (`qr-` + UUID, até 64 caracteres) e **usa a mesma chave em toda tentativa daquele cartão** até a baixa dar certo; só uma nova leitura gera outra chave.
- O servidor recusa chave repetida com **409** "Este lançamento já foi gravado."; a tela trata como "Esta baixa já foi registrada. Confira no histórico antes de repetir." (o cartão continua aberto, nada é regravado).
- Toque duplo: ao confirmar a fase vira `gravando` na hora (segundo toque ignorado) e os botões ficam desabilitados. A câmera pausa enquanto o cartão está aberto, então não há leitura repetida.
- Saldo insuficiente ou erro do servidor: mensagem no cartão, quantidade preservada. Sem conexão: "Sem conexão. Tente de novo."; nada vai para fila (sem modo offline). O saldo mostrado é o de quando o QR foi lido.
- Desfazer continua só pelo estorno existente (`estoque.desfazer`); o celular não tem botão de desfazer.

### Regra do login (Estoquista)
Em `layout.js`, `primeiraPaginaDe` devolve `baixa_qr.html` quando o acesso tem **exatamente** `estoque.ver` + `estoque.movimentar` e **nenhuma outra permissão** (`somenteBaixa`: mesmo tamanho do conjunto e todas presentes). Qualquer permissão a mais (Administrador, Estoquista com extra, outros perfis) segue o caminho de sempre. Exceção: no modo atendimento, se `baixa_qr.html` estiver bloqueado, cai no caminho normal. Quem tem outros acessos abre a leitura pelo subitem "Baixa por QR" do menu Estoque.

### Rotas e permissões
Ambas em `rotas/estoque_qr.js`, criadas por `registro.rota(...)`; só leem; funções puras em `calculo/estoque_qr.js` (`codigoValido`, `projetarItem`, `projetarEtiquetas`).
| Rota | Permissões |
|---|---|
| `GET /estoque/por_codigo/:codigo` | `estoque.ver` + `estoque.movimentar` (as mesmas de `POST /estoque/saida`) |
| `GET /estoque/etiquetas` | `estoque.ver` + `estoque.editar` |
| `POST /estoque/saida` (existente) | `estoque.ver` + `estoque.movimentar` |

Páginas (`PAGINAS` do `layout.js`): `baixa_qr.html` = `estoque.ver` + `estoque.movimentar`; `etiquetas_qr.html` = `estoque.ver` + `estoque.editar` (botão "Etiquetas de QR" em `estoque.html`). CSP padrão do projeto (inclui `'unsafe-inline'` e `cdn.jsdelivr.net`, como as demais páginas); as duas páginas não têm `<script>` nem `style=""` inline e carregam `vendor/` do próprio domínio; dado da API só entra por `textContent` e o QR é montado por `createElementNS`.

### Bibliotecas em `vendor/` (copiadas, sem build; detalhes em `vendor/LEIA-ME.txt`)
- `jsQR.js` 1.4.0, licença Apache-2.0 (leitura do QR; só foi acrescentada a linha de licença no topo).
- `qrcode.js` (qrcode-generator) 1.4.4, licença MIT (desenho do QR das etiquetas; sem alterações).

### Testes
`test/estoque_qr_calculo.test.js`, `test/estoque_qr_rotas.test.js`, `test/baixa_qr_login.test.js`, `test/baixa_qr_tela.test.js`, `test/etiquetas_qr_tela.test.js`. Câmera, jsQR e QR gerado reais não são automatizáveis.

### Pendências conhecidas (menores)
1. `baixa_qr.js`: o stream da câmera continua ligado nas fases cartão/erro/feito; só o laço de leitura pausa (`pausar()`), as faixas só são paradas em `desligar()` (pagehide, aba oculta, sair).
2. `baixa_qr.js`: `ligar()` não tem trava contra um segundo `getUserMedia` concorrente (duas chamadas seguidas antes de a primeira resolver).
3. `vendor/qrcode.js` usa por padrão `c & 0xff` para converter texto em bytes: código de barras com acento ou caractere acima de 255 gera QR diferente do texto. EAN-13 é ASCII e não é afetado. Correção prevista: `qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8']`, confirmando antes que o jsQR devolve UTF-8.
4. `etiquetas_qr.js`: `desenharQr` não tem try/catch por item (um código que estoure o QR derruba a folha inteira) e não tem teste.

### Roteiro manual no celular (resultado a registrar; nada foi executado ainda)
- [ ] pendente: imprimir 3 etiquetas (folha de `etiquetas_qr.html`) e conferir tamanho/legibilidade do QR no papel
- [ ] pendente: ler cada uma das 3 etiquetas no Android
- [ ] pendente: ler cada uma das 3 etiquetas no iPhone
- [ ] pendente: dar baixa de 1 unidade (Android e iPhone) e conferir o saldo e o histórico
- [ ] pendente: dar baixa de 2 unidades (Android e iPhone) e conferir o saldo e o histórico
- [ ] pendente: tentar baixar mais que o saldo (mensagem no cartão, quantidade mantida)
- [ ] pendente: tocar duas vezes em "Dar baixa" (só uma baixa gravada)
- [ ] pendente: ler o QR de um item inativo ("Item não encontrado.", nada gravado)
- [ ] pendente: câmera negada / sem HTTPS cai no campo de digitar o código
- [ ] pendente: entrar com um Estoquista (`estoque.ver` + `estoque.movimentar`): cai na leitura
- [ ] pendente: entrar com um Administrador: cai no sistema normal e abre a leitura pelo menu Estoque
