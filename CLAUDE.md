# CLAUDE.md — APP_SITE (ELEGANCE)

Não havia README nem CLAUDE.md anterior; este arquivo foi gerado a partir da leitura do código.

> **Trabalho em andamento (branch `feat/skill-engenharia-projetos`):** antes de mexer na skill `.claude/skills/engenharia-projetos-tecnicos/`, leia `CONTEXTO_SKILL_ENGENHARIA.md` (raiz), que tem decisões, estado atual e próximos passos.

> **Visual (qualquer tela, botão, tabela, modal ou cor):** antes de criar ou mexer em interface, leia `DESIGN.md` (raiz). Ele é a fonte única das regras visuais; a implementação está em `tema.css`, que toda página interna carrega por último. Use as variáveis do tema, não cores soltas, e mantenha `DESIGN.md` e `tema.css` em sincronia ao mudar o padrão.

## 1. O que o sistema faz

Versão web (front-end + API) de um sistema de gestão que já existe em **VB (Visual Basic)** para uma empresa de esquadrias/portas/serralheria ("ELEGANCE"). A web lê e grava **as mesmas tabelas do banco do VB**; muitos comentários dizem "fiel ao VB" e citam formulários/módulos do VB (ex.: `frm_Pedido2`, `ModPedOrc`, `MotorFinanceiro`).

Funcionalidades (páginas HTML na raiz):
- Login com JWT (`login.html`), painel inicial (`inicio.html`, `painel_inicial.html`).
- Clientes e análise de cliente (`clientes.html`, `cliente_analise.html`).
- Produtos/cadastro (`produtos.html`), orçamentos e pedidos com cálculo de preço de portas, serralheria e venda avulsa (`orcamentos.html`, `calculo/precos.js`, `rotas/ped_orc.js`), geração de PDF (pdfkit).
- Estoque: entrada manual e por XML de NF-e, saída, ajuste, histórico, estornos, análises (previsão de falta, curva ABC, itens parados) (`estoque.html`, `movimentacao_estoque.html`, `rotas/estoque_*.js`, `rotas/nfe_xml.js`).
- Financeiro / fluxo de caixa (`financeiro.html`) e gráficos de pedidos (`graficos_pedidos.html`).
- Custos e **formação de preço** (`custos.html`, `custos_precos.js`, `rotas/custos.js`, `rotas/precos_formacao.js`): calcula custo real dos materiais pelas compras e sugere o `VALOR_FIXO`.
- **Entregas** (`entregas.html`, `minhas_entregas.html`, `rotas/entregas.js`): fila de pedidos Pronto, agenda (motorista, retirada, outro estado), baixa pelo motorista no celular com foto do canhoto, ocorrências e histórico; também aparece em Início, Pedidos (selo) e Financeiro do cliente (somente leitura). Regras na seção 5, "Entregas".
- **Fornecedores e funcionários** (`fornecedores.html`, `funcionarios.html`, `rotas/fornecedores.js`, `rotas/funcionarios.js`): cadastros das tabelas do VB `cadastro_fornecedores` e `funcionarios`, com busca e CEP (ViaCEP). Regras na seção 5, "Cadastros".
- **Tintas** (`tintas.html`, `tintas.js`, `rotas/tintas.js`): cadastro da tabela do VB `tintas` (fabricante, classe, tipo, conjunto, cor, valor, % da mistura, rendimento), com busca, cor e exclusão. Regras na seção 5, "Tintas".
- **Notas fiscais sem itens** (`notas_fiscais.html`, `notas_fiscais.js`, `rotas/notas_fiscais.js`, `calculo/notas_fiscais.js`): registro de notas de entrada (fornecedor) e de saída (cliente) só pelo cabeçalho, em tabela própria `web_notas_fiscais`; não mexe em estoque, caixa nem tabelas do VB. Regras na seção 5, "Notas fiscais".
- **Central de Gestão, entrega 1** (`gestao.html`, `gestao.js`, `rotas/gestao.js`, `calculo/gestao_caixa.js`): metas de faturamento e despesa por mês, caixa realizado x previsto, orçamento por categoria, comparativos e alertas calculados na hora. Só lê o VB. Regras na seção 5, "Gestão".
- **Plano de corte de perfis** (`corte.html`, `corte.js`, `rotas/corte.js`, `calculo/corte_*.js`): a partir de um Pedido, distribui as peças de perfil (porta, puxador, divisor) em varas e retalhos minimizando a perda; reserva retalhos, o cortador marca as peças e o estoque de retalhos só muda quando o corte real é conferido e confirmado. Regras na seção 5, "Plano de corte".
- **Etiquetas de pedido na Zebra** (`etiqueta_zebra.js`, `rotas/etiquetas.js`, `calculo/etiqueta_zpl.js`, `local/zebra.js`): o botão direito do Pedido ("Imprimir etiquetas (Zebra)") monta uma etiqueta ZPL de 100 × 60 mm por item no servidor e o serviço local do PC (porta 3917) a envia RAW à Zebra USB. Regras na seção 5, "Etiquetas na Zebra".
- **Checklist de produção** (`checklist_pedido.js`, `rotas/checklist.js`, `calculo/checklist.js`): o botão direito do Pedido (`pedidos.checklist`) abre o PDF único do checklist guardado no banco (`web_checklist`); quem tem `checklist.enviar` o envia/troca na aba "Checklist de produção" de `danfe_envio.html`. Funciona de qualquer lugar, sem serviço local. Regras na seção 5, "Checklist de produção".
- **Plano de corte de vidros** (`corte_vidros.html`, `corte_vidros.js`, `rotas/corte_vidros.js`, `calculo/vidro_*.js`): a partir de um Pedido, distribui as peças da tabela `vidros` em chapas do estoque (guilhotina com rotação) e retalhos; o cortador marca as peças e, ao confirmar o corte conferido, as chapas novas baixam do estoque. Regras na seção 5, "Plano de corte de vidros".
- Administração de usuários, perfis e permissões (`usuarios.html`, `rotas/admin.js`, `seguranca/`).
- **Notas de compra pela SEFAZ** (`notas_compra.html`, `notas_compra.js`, `local/sefaz.js`): o serviço local do PC da empresa (o mesmo do salvador de PDF, porta 3917) busca na SEFAZ as NF-e emitidas contra o CNPJ da empresa com o certificado A1, dá a Ciência da operação e guarda os XML; a tela leva o XML para a entrada de estoque existente. O certificado nunca sai do PC. Regras na seção 5, "Notas de compra pela SEFAZ".
- **Nota fiscal em PDF (DANFE) pelo pedido** (`danfe_envio.html`, `danfe_envio.js`, `danfe_pedido.js`, `rotas/danfe.js`, `calculo/danfe.js`): os PDFs das notas (nome = chave de acesso de 44 dígitos) são enviados pela tela para o banco da web e abrem pelo botão direito do Pedido, de qualquer lugar. Regras na seção 5, "Nota fiscal em PDF (DANFE)".
- **Leitura de projeto técnico em PDF** na tela de orçamentos (botão "📄 Ler projeto (PDF)", `leitura/`, `leitura_pdf.js`): o servidor lê o PDF pela API do Claude e o vendedor confere cada valor antes de importar (seção 5, "Leitura de PDF").
- **Portal do cliente (identidade, etapa 2)** (`portal/`, `portal/public/`, `rotas/portal_auth.js`, `rotas/portal_admin.js`, `portal_admin.html/.js`): a equipe (permissão `portal.gerir`) libera uma empresa e convida o administrador geral por e-mail; o cliente cria senha, configura o 2º fator (aplicativo autenticador) e entra pelas páginas do próprio servidor da API. **Etapa 3a: depois de entrar o cliente vê "Meus pedidos" (lista e status, `portal/public/pedidos.html/.js`, `rotas/portal_pedidos.js`, `calculo/portal_pedidos.js`). Etapa 3b: o cliente com `financeiro.ver` também vê o "Financeiro" (resumo, em aberto e pagos; `portal/public/financeiro.html/.js`, `rotas/portal_financeiro.js`, `calculo/portal_financeiro.js`); Etapa 3c: o cliente com `documentos.ver` abre, na tela de cada pedido (`portal/public/pedido.html/.js`, link no número da lista), o PDF do pedido sem preços nem observação geral e o DANFE das notas ligadas ao pedido (`rotas/portal_documentos.js`). Etapa 4: o administrador geral da empresa (permissão `usuarios.gerir`) convida e gerencia os usuários da própria empresa (permissões `pedidos.ver`/`documentos.ver`/`financeiro.ver`, promover/rebaixar, desativar, reenviar convite, remover; `portal/public/usuarios.html/.js`, `rotas/portal_usuarios.js`, `portal/convites.js`).** Regras na seção 5, "Portal do cliente: identidade (etapa 2)"; passo a passo do dono em `docs/portal_configuracao.md`.

Stack: Node.js + Express 4, mysql2 (MySQL), jsonwebtoken, bcryptjs, nodemailer (convite do portal; versão fixada 10.1.7), helmet, cors, express-rate-limit, pdfkit, fast-xml-parser, ajv (validação da skill), @anthropic-ai/sdk (leitura de PDF; versão fixada 0.133.0). Front-end em HTML/CSS/JS puro (sem build/framework), com Content-Security-Policy em cada página.

## 2. Organização das pastas

```
index.js                 Servidor Express inteiro: pool MySQL, JWT, login, rate limit, ~54 rotas (clientes, produtos, financeiro, PDF...), registra os módulos de rotas e sobe a porta
rotas/                   Módulos de rotas registrados pelo index.js
  admin.js               Usuários, perfis, permissões
  ped_orc.js             Gravação de orçamentos/pedidos (igual ao VB) e listas de apoio
  estoque_movimentos.js  Entrada, saída, ajuste, histórico, estornos
  estoque_saida.js       Saída de estoque compartilhada (travarProdutos, conferirSaldo, gravarSaidas): usada por POST /estoque/saida e pela baixa das varas novas do plano de corte
  estoque_analises.js    Previsão de falta, ABC, parados
  nfe_xml.js             Leitura do XML da NF-e (recusa DOCTYPE)
  custos.js              Formação de preço, parte A (custos dos materiais)
  precos_formacao.js     Formação de preço, partes B+C (grava VALOR_FIXO, com histórico/desfazer)
  fornecedores.js / funcionarios.js   Cadastros de fornecedores e de funcionários (rotas; validação em calculo/cadastros.js e calculo/documentos.js = CPF/CNPJ)
  checklist.js           Checklist de produção em PDF no banco (web_checklist): GET /checklist/pdf, GET /checklist/info, PUT /checklist (validação em calculo/checklist.js)
  danfe.js               DANFE (nota fiscal em PDF) pelo pedido: /danfe/existentes, PUT /danfe/:chave, /danfe/pedido/:n, /danfe/:chave/pdf, /danfe/lista, /danfe/vinculo (validação em calculo/danfe.js)
  pesos.js               Peso por produto (web_pesos): /pesos, /pesos/produtos (validação e cálculo em calculo/peso.js)
  tintas.js              Cadastro de tintas (rotas; validação e listas fixas em calculo/tintas.js)
  notas_fiscais.js       Notas fiscais de entrada/saída sem itens (rotas; validação em calculo/notas_fiscais.js)
  corte.js               Plano de corte: GET /corte/pedido/:n (pré-visualização), POST .../salvar, GET /corte/plano/:id, PUT .../pecas, POST .../confirmar (com baixa das varas novas no estoque) e .../cancelar, GET /corte/estoque/produtos, GET/PUT /corte/config, retalhos (GET/POST/PUT, POST .../descartar); exporta liberarPlanosDoPedido (usada ao cancelar/excluir pedido em ped_orc.js)
  corte_vidros.js        Plano de corte de vidros: /corte_vidros/* (prévia, salvar, plano, peças, confirmar com baixa de chapas, cancelar, excluir, config, retalhos, estoque/produtos); exporta liberarPlanosVidroDoPedido (usada ao cancelar/excluir pedido em ped_orc.js)
  gestao.js              Central de Gestão: /gestao/painel, /gestao/orcamento, /gestao/metas_vb (leitura) e PUT /gestao/meta e /gestao/orcamento (gravam só em web_gestao_*)
  desenhos.js            Tela de orçamentos: funções puras da captura/envio do desenho da porta (caixa, redução do PNG, PUT por item)
  entregas.js            Entregas: varredura da fila (`sincronizarFila`), agenda, anexos, rotas da equipe (`/entregas*`) e do motorista (`/minhas_entregas*`)
  transacao.js           Transação com nova tentativa em deadlock, `ErroUsuario`, hora local (compartilhado pelas rotas)
calculo/                 Funções puras (testáveis sem banco)
  precos.js              Motor de preço: portas, serralheria, avulso, acessórios; leitor do cadastro
  precos_formacao.js / precos_referencias.js / custos.js / custos_sugestao.js   Formação de preço e custos
  entregas.js            Máquina de status das entregas (`proximo`, `pedidoPara`) e validação de anexo
  engenharia.js          Regras de engenharia das portas
  leitura_vb.js / linhas_vb.js   Conversão banco<->tela no formato do VB
  nomes.js               Normalização/semelhança de nomes de produtos
  corte_pecas.js / corte_otimizacao.js / corte_validacao.js   Plano de corte: peças do pedido (perfis + ped_orc_itens_v4), otimização em varas/retalhos, validação de config/retalho/conferência
  vidro_pecas.js / vidro_otimizacao.js / vidro_validacao.js   Plano de corte de vidros: peças (vidros + ped_orc_itens_v4), guilhotina em chapas/retalhos, validação de config/retalho/conferência
  gestao_caixa.js / gestao_validacao.js   Central de Gestão: caixa por mês, variação, meta, progresso/projeção do orçamento, alertas; validação de meta e orçamento (puras)
  portal_pedidos.js      Portal do cliente, etapa 3a: projeção (o que o cliente pode ver de um pedido) e validação dos parâmetros de lista/detalhe (puras)
  portal_financeiro.js   Portal do cliente, etapa 3b: visão, projeção dos títulos, rótulos, atraso na hora e corte de 12 meses (puras)
pdf/ped_orc.js           PDF do pedido/orçamento (rota /dados_pdf) fiel ao Gerar_PDF_PedOrc do VB; ?producao=1 = Guia de Produção (só Pedido)
local/                   Serviço do PC da empresa (127.0.0.1:3917): salvador_pdf.js (grava os PDFs nas pastas do VB), sefaz.js (notas de compra pela SEFAZ) e zebra.js (POST /etiqueta: ZPL RAW na Zebra). Detalhes e instalação: docs/regras/servico-local.md
imagens/logo_elegance.png  Logo do cabeçalho do PDF (convertido do Elegance_Logo.JPEG do VB, que na verdade é BMP)
leitura/                 Leitura de PDF pela web: rotas.js (rotas /leitura_pdf, tarefas em memória, limites, auditoria), claude.js (pedido à API pelo SDK, erros), pdf.js (assinatura, senha, nº de páginas sem poppler), conferencia.js (dados da janela de conferência)
.claude/skills/engenharia-projetos-tecnicos/   Skill de leitura de projetos (regras, validação, mapa, confirmação). O servidor IMPORTA scripts/lib/servico.mjs dela: a pasta precisa ir no deploy
seguranca/               acesso.js (perfil+permissões por requisição, cache 60 s), permissoes.js (catálogo único de permissões), rotas.js (registro obrigatório de rotas), valores.js (esconde dinheiro de quem não tem `valores.ver`), instalacao.js (cria tabelas web_*, migrações)
portal/                  Portal do cliente (identidade externa), sem JWT e sem reaproveitar as sessões de funcionário: config.js (lê as variáveis PORTAL_* e SMTP_*), cookie.js (`__Host-portal`), tokens.js (token opaco, hash SHA-256, códigos de recuperação com HMAC), sessoes.js (tabela `web_portal_sessoes`), acesso.js (guardas `portalAtivo`/`portalAutenticar`, `empresaLiberavel`), totp.js (RFC 6238), cripto.js (AES-256-GCM do segredo TOTP), senha.js (regras da senha), email.js (convite por SMTP), auditoria.js (`web_portal_auditoria`), cabecalhos.js (CSP e no-store em `/portal`), cors.js (origem do portal só em `/portal/...`), transacao.js, limpeza.js (retenção)
portal/public/          Páginas do cliente servidas pelo servidor da API em `/portal/*` (mesma origem): login, convite, termo (RASCUNHO), início, Meus pedidos (`pedidos.html/.js`), Financeiro (`financeiro.html/.js`), detalhe do pedido com documentos (`pedido.html/.js`); `portal.js` (chamadas com `X-Portal: 1`), `portal.css`; sem script nem estilo inline
rotas/portal_auth.js    Rotas do cliente: `POST /portal/api/convite/iniciar`, `/convite/concluir`, `/login`, `/logout` (públicas) e `GET /portal/api/eu` (autenticada)
rotas/portal_pedidos.js Rotas do cliente (etapa 3a, exigem `pedidos.ver`): `GET /portal/api/pedidos` (lista paginada) e `GET /portal/api/pedidos/:numero` (detalhe e status)
rotas/portal_financeiro.js Rotas do cliente (etapa 3b, exigem `financeiro.ver`): `GET /portal/api/financeiro?visao=abertos|pagos&pagina=N` (resumo e títulos de entrada, somente leitura)
rotas/portal_usuarios.js Rotas do administrador da empresa (etapa 4, exigem `usuarios.gerir`): `GET/POST /portal/api/usuarios`, `PUT /portal/api/usuarios/:id/permissoes`, `POST .../papel`, `.../desativar`, `.../reenviar_convite`, `.../remover`; trava do último administrador com `FOR UPDATE`; limite de 20 convites por hora
portal/convites.js      Criação, invalidação e resposta (`{ enviado, link? }`) de convites, compartilhadas por `rotas/portal_admin.js` e `rotas/portal_usuarios.js`
portal/public/usuarios.html/.js   Tela "Usuários da empresa" do administrador (link em `inicio.html` só com `usuarios.gerir`)
rotas/portal_documentos.js Rotas do cliente (etapa 3c, exigem `documentos.ver`): `GET /portal/api/pedidos/:numero/documentos`, `/pdf` (sem preços) e `/danfe/:chave` (só nota ligada ao pedido); limite de 30 aberturas por 10 min
rotas/danfe_ligacao.js  Ligação da nota (DANFE) ao pedido (`criarLigacaoDanfe`), compartilhada por `rotas/danfe.js` e pelo portal
pdf/carregar_ped_orc.js Leitura dos dados do PDF do pedido (`carregarCabecalhoPedOrc`, `carregarCorpoPedOrc`), compartilhada por `/dados_pdf` e pelo portal
rotas/portal_admin.js   Rotas da equipe (`portal.gerir`): `/admin/portal/clientes`, `/empresas` (liberar, suspender, reativar), `/convites`, reenviar convite, reiniciar 2º fator
portal_admin.html/.js   Tela da equipe "Portal do cliente" (subitem de Usuários no menu)
corte.html/.js           Tela do plano de corte (varas desenhadas em escala em CSS), retalhos e parâmetros
corte_vidros.html/.js   Tela do plano de corte de vidros (chapas desenhadas em escala em CSS), retalhos e parâmetros
gestao.html/.js          Tela da Central de Gestão (barras em CSS, sem biblioteca de gráficos)
entregas.html/.js, entregas_comum.js, minhas_entregas.html/.js   Telas da equipe e do motorista (entregas_comum.js = rótulos e helpers compartilhados)
DESIGN.md                Regras da identidade visual (cores, fonte, componentes, do's and don'ts); espelha o tema.css
*.html, layout.js, login.js, ranking.js, custos_precos.js, importar_itens.js, leitura_pdf.js, style.css, tema.css   Front-end (layout.js = menu lateral e permissões na tela)
test/                    Testes (node:test); test/apoio/ = banco/pool falsos, servidor de teste, XMLs de NF-e
.gitignore               node_modules/, .env, *.log
APP_SITE.rar             Arquivo compactado, tirado do git (estava rastreado; `*.rar` agora no .gitignore). O histórico ainda contém a senha antiga do banco até a limpeza do histórico, que depende do dono
```

## 3. Como rodar

```bash
npm install
npm start        # node index.js  (porta PORT ou 3000)
npm test         # node --test "test/**/*.test.js" + testes da skill (.claude/skills/engenharia-projetos-tecnicos/tests)
```

- Testes: pasta `test/`, framework **`node:test` nativo do Node** (sem Jest/Mocha), asserts com `node:assert`. Usam banco simulado (`test/apoio/poolFalso.js`, `bancoCustos.js`, `bancoEstoque.js`, `bancoPedOrc.js`); **não precisam de MySQL**. Cada teste define `process.env.JWT_SECRET='teste'` e `NODE_ENV='test'`.
- Para `npm start` localmente é preciso um MySQL acessível com o esquema do VB e as variáveis da seção 4 (não há `.env.example`; `.env` está no `.gitignore`, mas o código não carrega `dotenv` — defina as variáveis no ambiente do shell).
- O front-end tem a URL da API fixa (`API_BASE = 'https://elegance-backend-hrho.onrender.com'` em `login.js` e nos HTML); para testar localmente contra o backend local é preciso alterar isso. O CORS aceita `localhost`/`127.0.0.1` e `https://thiagozmb.github.io`.

## 4. Deploy e infraestrutura

- **Back-end (`index.js`)**: publicado no **Render** (`app.set('trust proxy', ...)` por estar atrás do proxy do Render).
- **Banco**: MySQL no **HostGator** (acesso remoto via `mysql2` com pool de 10 conexões, `dateStrings: true`, `multipleStatements: false`). O código só cita Render nos comentários/URLs; não há menção a HostGator no código — isso vem da informação do projeto.
- **Front-end**: aparentemente servido pelo GitHub Pages (`https://thiagozmb.github.io/APP_SITE/login.html` aparece como `LOGIN_URL`). Não há arquivo de configuração do Render (render.yaml, Procfile) no repositório; comando de build/start no Render não está documentado aqui.

Variáveis de ambiente (apenas nomes):
- Obrigatórias (fora de `NODE_ENV=test`): `DB_HOST`, `DB_USER`, `DB_PASS`, `DB_NAME`, `JWT_SECRET`. Se faltar alguma o processo encerra com FATAL.
- Leitura de PDF (opcionais; sem elas o resto do sistema funciona e o botão avisa "Leitura de PDF não configurada no servidor"): `ANTHROPIC_API_KEY` (chave da API do Claude; só no painel do Render, nunca no código/git/log), `ANTHROPIC_MODEL` (padrão `claude-sonnet-5-5`), `ANTHROPIC_FALLBACK=1` (liga o recurso beta de modelo alternativo em caso de recusa; só se a organização tiver o beta liberado).
- Portal do cliente (opcionais; sem `PORTAL_URL_BASE` e `PORTAL_CHAVE_CRIPTO` o portal responde "Portal não configurado."): `PORTAL_URL_BASE`, `PORTAL_CHAVE_CRIPTO` (**perder ou trocar a chave invalida o 2º fator e os códigos de recuperação**), `PORTAL_TERMO_VERSAO`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`. Só no painel do Render, nunca no chat nem no git. Detalhes: `docs/regras/ambiente.md` e `docs/portal_configuracao.md`.
- Opcionais: `EMPRESA_CNPJ`, `DB_PORT`, `DB_SSL` e `DB_SSL_CA` (TLS do MySQL; **padrão desligado até o HostGator confirmar TLS**), `PORT`, `TRUST_PROXY_HOPS`, `ADMIN_KEY` + `ADMIN_ROTAS` (rotas de manutenção `/admin/definir_senha`, `/migrar_senhas`, `/admin/importar_notas` e `/admin/importar_pesos` ficam **DESLIGADAS por padrão**: só respondem com `ADMIN_ROTAS=1`), `WEB_ADMIN_INICIAL`, `NODE_ENV`. Detalhes de cada uma: `docs/regras/ambiente.md`.

Nunca colocar valores de senhas/tokens neste arquivo nem no git.

**Pendências de segurança FORA DO CÓDIGO (condição para o primeiro cliente real entrar; só o dono resolve):**
- Trocar a senha do MySQL, no Render e no HostGator (a antiga está no histórico do git).
- Restringir no HostGator os IPs com acesso remoto ao MySQL (hoje `%`).
- Limpar o histórico do git (reescrita destrutiva: só com confirmação do dono) e confirmar a visibilidade do repositório no GitHub.
- Ligar `DB_SSL=1` quando o HostGator confirmar TLS no MySQL.
- Publicar o front numa origem própria (domínio ou subdomínio da empresa): todo site GitHub Pages da conta compartilha a origem `thiagozmb.github.io`, e nela o token em `localStorage`, o CORS e o serviço local da porta 3917 confiam.
- Para o portal do cliente (etapa 2): o relatório `GET /clientes/nomes_duplicados` precisa estar vazio para a empresa.
- Portal do cliente, ainda do dono: texto jurídico do termo de uso (hoje RASCUNHO em `portal/public/termo.html`), configurar o SMTP da conta do portal e as variáveis `PORTAL_*` no Render (`docs/portal_configuracao.md`).

## 5. Regras importantes do código

O detalhe de cada módulo fica em `docs/regras/` (um arquivo por módulo); aqui ficam só o resumo e as regras que valem para tudo.

### VALOR_CHEIO x VALOR_FIXO (tabela `cadastro_de_produtos`)
**Decisão: a web usa somente `VALOR_FIXO`. `VALOR_CHEIO` não é usado nos cálculos nem editado.** Não há condição que alterne entre os dois: o preço de tabela é `VALOR_FIXO` para todo cliente.
- `calculo/precos.js:4` — comentário: "Preço de tabela = VALOR_FIXO para todo cliente (decisão do Thiago, 2026-10-22: o VALOR_CHEIO não é usado na web)".
- `calculo/precos.js:14` — o leitor do cadastro faz SELECT sem `VALOR_CHEIO`; `precos.js:80` `precoBase = d => d.valorFixo` ("todo cliente parte do VALOR_FIXO"); `precos.js:47-52` Solda também usa `VALOR_FIXO`.
- `calculo/precos.js:110-114` — acessórios: `VALOR_FIXO`; o desconto do cliente entra no item só se o cliente for de "desconto fixo" (`TIPO_DESCONTO` contém "FIXO"); os demais recebem desconto no fechamento (ver `precos.js:170-171`, `:238`).
- `index.js:1381` — `/produtos/salvar`: "a web só usa o VALOR_FIXO; o VALOR_CHEIO (coluna do VB) não é editado aqui"; o UPDATE (`index.js:1396`) não toca em `VALOR_CHEIO`; `VALOR_FIXO` é obrigatório (`index.js:1380`).
- `index.js:1400-1404` — **única referência a `VALOR_CHEIO` no código de produção**: ao inserir produto novo grava `VALOR_CHEIO = VALOR_FIXO`, porque "o VB ainda lê VALOR_CHEIO" e a coluna não deve ficar vazia. Não remover essa gravação enquanto o VB estiver em uso.
- `rotas/precos_formacao.js:299` e `:324` — única escrita automática em tabela do VB: `UPDATE cadastro_de_produtos SET VALOR_FIXO` (gravação confirmada na tela e desfazer).
- Testes que travam a regra: `test/precos.test.js:15,43,49-56` (nenhum SQL pode conter VALOR_CHEIO), `test/rotas_mapa.test.js:129-156` (produtos/item não devolve VALOR_CHEIO; editar não mexe nele; produto novo grava os dois iguais).
- Não há outra explicação do "porquê" além dos comentários acima; histórico anterior à data 2026-10-22 não está documentado.

### Leitura de PDF (skill engenharia-projetos-tecnicos na web)
O servidor lê o PDF de projeto pela API do Claude e a skill valida; nada entra sem conferência humana. Permissão `orcamentos.criar` + `valores.ver`; 10 leituras/hora por usuário.
> Regras completas: `docs/regras/leitura-pdf.md` (ler antes de mexer neste módulo).

### Entregas (módulo web, tabelas `web_entregas`, `web_entrega_eventos`, `web_entrega_anexos`)
Fila de pedidos Pronto, agenda e baixa pelo motorista (`web_entregas*`); a web nunca marca Pronto; a baixa grava `ped_orc.SITUACAO` e `DATA_ENTREGA` na mesma transação.
> Regras completas: `docs/regras/entregas.md` (ler antes de mexer neste módulo).

### Cadastros (fornecedores e funcionários)
Fornecedores (a razão social não muda depois de criada) e funcionários (SENHA e NIVEL do VB nunca saem; salário só com `valores.ver`).
> Regras completas: `docs/regras/cadastros.md` (ler antes de mexer neste módulo).

### Tintas (tabela do VB `tintas`)
Tabela do VB `tintas`; RENDIMENTO é texto com vírgula; cor em ARGB; o fabricante precisa existir em `cadastro_fornecedores`.
> Regras completas: `docs/regras/tintas.md` (ler antes de mexer neste módulo).

### Notas fiscais (entrada e saída, sem itens)
`web_notas_fiscais` (só cabeçalho, sem estoque nem caixa); cancelar é irreversível; `POST /admin/importar_notas` copia do VB (só simula por padrão).
> Regras completas: `docs/regras/notas-fiscais.md` (ler antes de mexer neste módulo).

### Gestão (Central de Gestão, entrega 1)
Central de Gestão (metas, caixa realizado x previsto, orçamento); só lê o VB e grava em `web_gestao_*`; exige `gestao.*` + `valores.ver`.
> Regras completas: `docs/regras/gestao.md` (ler antes de mexer neste módulo).

### Plano de corte (perfis por pedido, varas e retalhos) — na tela e no menu o nome é "Corte de perfil"
Perfis por Pedido em varas e retalhos; peça sem medida ou sem ligação vira pendência e nunca é estimada; o estoque só muda ao confirmar o corte conferido.
> Regras completas: `docs/regras/corte-perfis.md` (ler antes de mexer neste módulo).

### Plano de corte de vidros (chapas por pedido, guilhotina e retalhos)
Chapas do estoque por Pedido (guilhotina com rotação) e retalhos; quantidades não são comparadas; ao confirmar, as chapas novas baixam do estoque.
> Regras completas: `docs/regras/corte-vidros.md` (ler antes de mexer neste módulo).

### Etiquetas na Zebra (uma por item do Pedido, ZPL 100 × 60 mm)
Servidor monta o ZPL (`GET /etiquetas/pedido/:numero`, `pedidos.pdf`); o serviço local envia RAW ao spooler; texto do banco saneado (`^ ~ \`); medida ausente = "—"; sem dinheiro; impressora só do `zebra.config.json` ou detectada, nunca da requisição. **Ainda não testado em Zebra real.**
> Regras completas: `docs/regras/etiqueta-zebra.md` (ler antes de mexer neste módulo).

### Checklist de produção (PDF no banco)
`web_checklist` guarda um único PDF vigente (id 1); `GET /checklist/pdf` (`pedidos.checklist`), `PUT /checklist` e `GET /checklist/info` (`checklist.enviar`); PDF validado pelos bytes, até 5 MB.
> Regras completas: `docs/regras/checklist.md` (ler antes de mexer neste módulo).

### Peso das portas (etapa 1)
`web_pesos`; peso sem cadastro nunca vira zero (pendência + parcial); **o peso aparece SÓ em `orcamentos.html`** (regra do dono).
> Regras completas: `docs/regras/peso.md` (ler antes de mexer neste módulo).

### Notas de compra pela SEFAZ (serviço local + tela + entrada de estoque)
O serviço local do PC (porta 3917) busca NF-e com o certificado A1, que nunca sai do PC; a regra de estoque continua só no servidor.
> Regras completas: `docs/regras/sefaz.md` (ler antes de mexer neste módulo).

### Nota fiscal em PDF (DANFE) pelo pedido
PDFs de notas (nome = chave de 44 dígitos) em `web_danfe`; ligação ao pedido manual ou pelo financeiro; permissões `danfe.ver/enviar/vincular`.
> Regras completas: `docs/regras/danfe.md` (ler antes de mexer neste módulo).

### Renomear cliente e nomes duplicados
Pedidos e caixa se ligam ao cliente pela razão social; renomear cliente com histórico exige `confirmarRenomear: true`; `GET /clientes/nomes_duplicados`.
> Regras completas: `docs/regras/renomear-cliente.md` (ler antes de mexer neste módulo).

### Portal do cliente: identidade (etapa 2)
Identidade externa (convite, senha, 2º fator, sessão opaca no cookie `__Host-portal`); empresa conferida a cada requisição; rotas só por `registro.portal*`; o cliente já vê pedidos e status (etapa 3a, somente leitura, isolados por `req.portal.empresaCodigo`); o cliente com `financeiro.ver` também vê o financeiro (etapa 3b, somente leitura, mesmo isolamento); o cliente com `documentos.ver` abre o PDF do pedido (sem preços nem observação geral) e o DANFE das notas ligadas ao pedido (etapa 3c, mesmo isolamento, 404 uniforme); o administrador geral da empresa gerencia os usuários da própria empresa (etapa 4: convite, permissões concedíveis, papel, desativar, reenviar, remover; sempre ao menos um administrador ativo; isolamento por empresa com 404 uniforme). Guia do dono: `docs/portal_configuracao.md`.
> Regras completas: `docs/regras/portal-identidade.md` (ler antes de mexer neste módulo).

### Recebimentos atrasados automáticos
`UPDATE fluxo_de_caixa` (**escrita em tabela do VB**): marca como `Atrasado` as entradas `A Receber` já vencidas, na subida do servidor e no login; idempotente, nunca mexe em saídas.
> Regras completas: `docs/regras/recebimentos-atrasados.md` (ler antes de mexer neste módulo).

### Outras regras não óbvias
- **Fidelidade ao VB**: cálculos devem reproduzir o VB (comentários citam `MotorFinanceiro`, `MotorPrecificacaoSerralheria`, `frmPortasAbrir`, etc.). Antes de "corrigir" uma conta, confirme se é comportamento do VB.
- **Puxador**: valor mínimo R$ 20 por unidade (`precos.js:208`, "fiel ao VB"). Puxador "Total" desconta o lado do perímetro do perfil (`precos.js:199-204`). Divisores: `qtdDivH` = horizontais, `qtdDivV` = verticais (`precos.js:215`). Dedução do divisor no revestimento usa fator 0,015 (`precos.js:232`).
- **Posição do puxador é POR FOLHA e só pelo desenho**: A posição do puxador é por folha (`posicoesFolhas[]`) e só pelo desenho; o preço é calculado por folha (`chavePosicaoPreco`). Detalhe: `docs/regras/outras-regras.md`.
- **Percentuais** (`"+10;-5"`): na rota `/calcular_preco` são compostos (`aplicarPercentuais`, `precos.js:87`); no histórico do VB (`fatorHistorico`, `precos.js:99`) são **sobre a base** (não composto): "+100;+10" = ×2,1.
- **Solda sem cadastro** → valor 0 (`precos.js:54`). Acessório com tamanho é cobrado por metro (`tamanho/1000`).
- **Complementos da serralheria**: somados fora do motor, com valor do cadastro e **sem desconto do cliente** (`precos.js:147,270`).
- **Menu do botão direito (pedidos e orçamentos)**: Ações do botão direito por permissão; mudar situação = `POST /ped_orc/Pedido/:numero/situacao` (`pedidos.situacao`) com `manterData`, `usarDataPronto` ou `dataEntrega`. Detalhe: `docs/regras/outras-regras.md`.
- **Orçamento "Baixado"**: `Baixado` não existe no VB; `POST /ped_orc/orcamentos/:numero/situacao`; `orcamentos.situacao` vai para Administrador, Interno completo e Representante. Detalhe: `docs/regras/outras-regras.md`.
- **PDF de Vidros**: `GET /dados_pdf_vidros?numero=` imprime a tabela `vidros` (não calcula); só Pedido. Detalhe: `docs/regras/outras-regras.md`.
- **Desenho da porta no PDF**: O PNG da porta sobe por `PUT /ped_orc/:tipo/:numero/desenho/:item`; **o PNG é validado de verdade** (`calculo/png.js`: PNG corrompido derruba o pdfkit). Detalhe: `docs/regras/outras-regras.md`.
- **Modo atendimento**: Recurso de tela, não de segurança (`atendimento.modo`). Detalhe: `docs/regras/outras-regras.md`.
- **Segurança de rotas**: toda rota deve ser criada por `registro.rota(...)`/`registro.publica(...)` com a permissão exigida; `registro.verificar()` impede o servidor de subir se houver rota fora do registro. Nova permissão: acrescentar em `seguranca/permissoes.js` (código `area.acao`).
- **Valores financeiros**: quem não tem `valores.ver` não pode receber dinheiro. Use `semValores(...)` nas rotas; `redeDeValores` apaga campos com nome de dinheiro que escaparem. **Contagens não podem usar nomes de campos de dinheiro** — use `qtd*`/`quantidade` (`seguranca/valores.js`).
- **Tabelas**: tabelas do VB são lidas/gravadas "do jeito que o VB espera"; tudo que é só da web fica em tabelas `web_*`, criadas na subida por `seguranca/instalacao.js` (que nunca altera tabelas do VB). **Única exceção, autorizada pelo dono em 2026-11-05:** `seguranca/coluna_imagem.js` acrescenta `cadastro_de_produtos.IMAGEM LONGBLOB NULL` na subida se faltar (foto do produto, `/produtos/imagem/:codigo`); só ADD COLUMN, idempotente. Gravações de estoque/pedido são transações.
- **Token JWT**: guarda só id/nome (`v: 2`, `tipo: 'funcionario'`, `sid` da sessão, 8 h, issuer `elegance-api`); `autenticar` recusa com 401 (mesma mensagem de sessão expirada) token cujo `tipo` não seja exatamente `funcionario` (ausente, `null`, vazio, outro tipo, caixa diferente) e token sem `sid` válido (cada usuário reloga uma vez); `registro.rotasAutenticadas()` lista as rotas de funcionário e `test/seguranca_barreira.test.js` assina TODOS os tokens com `sid` válido, de modo que só a regra de `tipo` pode gerar o 401 (apagar a linha de `tipo` em `autenticar` quebra o teste); lista FIXA das 5 rotas públicas (`registro.rotasPublicas()`, conferida em `test/seguranca_registro.test.js`: `POST /login`, `/admin/definir_senha`, `/migrar_senhas`, `/admin/importar_notas`, `/admin/importar_pesos`; uma nova pública falha o teste até alguém decidir); `registro.verificar()` também recusa `express.Router` montado com `app.use` (as rotas escapariam do registro) e `exigir` não é mais exportado; hash de senha só vale se for bcrypt completo (`REGEX_HASH_BCRYPT`; texto puro de 60 caracteres = falha de login, nunca 500); `/admin/definir_senha` revoga as sessões de todos os usuários com o nome; o tratador de erros grava no log só o `err.code`; perfil, permissões e estados vêm do banco a cada requisição (cache 60 s). Login limitado a 5 tentativas por 15 min por IP **e** 5 falhas por 15 min por conta (chave = código da conta, que o banco resolve, ou o nome normalizado se não existe; 429; `seguranca/login_limite.js`; nomes inexistentes têm teto e descartam o mais antigo). Usuário inexistente também roda o bcrypt (hash falso) e todo login é auditado (`login_ok`/`login_falha`/`login_bloqueado`/`login_negado`; `quem` = nome da conta ou `(inexistente)`, nunca o texto digitado; detalhe só IP e HMAC curto do nome inexistente); custo bcrypt único `CUSTO_BCRYPT = 12`. **Limitação conhecida**: os contadores ficam só em memória (uma instância do Render); reiniciar o servidor zera.
- **Sessões revogáveis de funcionário** (`seguranca/sessoes.js`, tabela `web_sessoes`: id de 32 hex aleatórios, usuário, criado/expira em 8 h, IP, revogada): o login cria a sessão só depois de concluir com sucesso e o JWT leva `sid`; `autenticar` confere `sessoes.valida(sid, id)` direto no banco a cada requisição (chave primária, sem cache, mesmo dentro do cache de 60 s das permissões), então o logout vale na hora. `POST /logout` revoga a sessão do token (`layout.js` o chama nos dois botões Sair, via `encerrarSessao`, sem esperar a resposta); trocar a senha (`POST /admin/usuarios/:codigo/senha` e `/admin/definir_senha`) revoga todas as sessões daquele usuário. **Token sem `sid` é recusado (401 "Sessão expirada...")**: após o deploy cada usuário entra de novo uma vez. Desativar o usuário já derruba pelo `acesso.ativo` (as sessões não são revogadas nesse caso). Nos testes, `test/apoio/sessaoFalsa.js` assina com um `sid` fixo e troca `sessoes.valida` na instância (nenhum desvio por NODE_ENV no código). Testes: `test/seguranca_sessoes.test.js`.
- **Estados (região)**: usuário com estados restritos só vê clientes desses estados (`filtroEstados`, `foraDosEstados`).
- **Senhas**: bcrypt; `/migrar_senhas` converte senhas em texto puro criadas pelo VB. Chave de admin só por header, nunca na URL.
- **NF-e XML**: documentos com DOCTYPE são recusados (proteção contra entidades).
- **Dados ausentes no custo**: custo vira `null` + motivo, nunca zero (`calculo/custos.js`). Referências em `precos_referencias.js` são só exibição, nunca usadas no cálculo.
- **Formação de preço**: mínimo = custo ÷ (1−V); equilíbrio = custo ÷ (1−V−F); alvo = custo ÷ (1−V−F−M); `VALOR_FIXO` sugerido = alvo ÷ (1−desconto) (`calculo/precos_formacao.js`). A gravação é "tudo ou nada" e recusa se o valor mudou desde a leitura (`rotas/precos_formacao.js:264`).
- Nos testes e no código não foram encontrados marcadores `IMPORTANTE`, `NÃO MUDAR` ou `TODO` relevantes (busca feita; só resultados irrelevantes como "todos").
