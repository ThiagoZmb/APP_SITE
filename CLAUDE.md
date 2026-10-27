# CLAUDE.md — APP_SITE (ELEGANCE)

Não havia README nem CLAUDE.md anterior; este arquivo foi gerado a partir da leitura do código.

> **Trabalho em andamento (branch `feat/skill-engenharia-projetos`):** antes de mexer na skill `.claude/skills/engenharia-projetos-tecnicos/`, leia `CONTEXTO_SKILL_ENGENHARIA.md` (raiz), que tem decisões, estado atual e próximos passos.

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
- Administração de usuários, perfis e permissões (`usuarios.html`, `rotas/admin.js`, `seguranca/`).
- **Leitura de projeto técnico em PDF** na tela de orçamentos (botão "📄 Ler projeto (PDF)", `leitura/`, `leitura_pdf.js`): o servidor lê o PDF pela API do Claude e o vendedor confere cada valor antes de importar (seção 5, "Leitura de PDF").

Stack: Node.js + Express 4, mysql2 (MySQL), jsonwebtoken, bcryptjs, helmet, cors, express-rate-limit, pdfkit, fast-xml-parser, ajv (validação da skill), @anthropic-ai/sdk (leitura de PDF; versão fixada 0.133.0). Front-end em HTML/CSS/JS puro (sem build/framework), com Content-Security-Policy em cada página.

## 2. Organização das pastas

```
index.js                 Servidor Express inteiro: pool MySQL, JWT, login, rate limit, ~54 rotas (clientes, produtos, financeiro, PDF...), registra os módulos de rotas e sobe a porta
rotas/                   Módulos de rotas registrados pelo index.js
  admin.js               Usuários, perfis, permissões
  ped_orc.js             Gravação de orçamentos/pedidos (igual ao VB) e listas de apoio
  estoque_movimentos.js  Entrada, saída, ajuste, histórico, estornos
  estoque_analises.js    Previsão de falta, ABC, parados
  nfe_xml.js             Leitura do XML da NF-e (recusa DOCTYPE)
  custos.js              Formação de preço, parte A (custos dos materiais)
  precos_formacao.js     Formação de preço, partes B+C (grava VALOR_FIXO, com histórico/desfazer)
  fornecedores.js / funcionarios.js   Cadastros de fornecedores e de funcionários (rotas; validação em calculo/cadastros.js e calculo/documentos.js = CPF/CNPJ)
  entregas.js            Entregas: varredura da fila (`sincronizarFila`), agenda, anexos, rotas da equipe (`/entregas*`) e do motorista (`/minhas_entregas*`)
  transacao.js           Transação com nova tentativa em deadlock, `ErroUsuario`, hora local (compartilhado pelas rotas)
calculo/                 Funções puras (testáveis sem banco)
  precos.js              Motor de preço: portas, serralheria, avulso, acessórios; leitor do cadastro
  precos_formacao.js / precos_referencias.js / custos.js / custos_sugestao.js   Formação de preço e custos
  entregas.js            Máquina de status das entregas (`proximo`, `pedidoPara`) e validação de anexo
  engenharia.js          Regras de engenharia das portas
  leitura_vb.js / linhas_vb.js   Conversão banco<->tela no formato do VB
  nomes.js               Normalização/semelhança de nomes de produtos
pdf/ped_orc.js           PDF do pedido/orçamento (rota /dados_pdf) fiel ao Gerar_PDF_PedOrc do VB; ?producao=1 = Guia de Produção (só Pedido)
imagens/logo_elegance.png  Logo do cabeçalho do PDF (convertido do Elegance_Logo.JPEG do VB, que na verdade é BMP)
leitura/                 Leitura de PDF pela web: rotas.js (rotas /leitura_pdf, tarefas em memória, limites, auditoria), claude.js (pedido à API pelo SDK, erros), pdf.js (assinatura, senha, nº de páginas sem poppler), conferencia.js (dados da janela de conferência)
.claude/skills/engenharia-projetos-tecnicos/   Skill de leitura de projetos (regras, validação, mapa, confirmação). O servidor IMPORTA scripts/lib/servico.mjs dela: a pasta precisa ir no deploy
seguranca/               acesso.js (perfil+permissões por requisição, cache 60 s), permissoes.js (catálogo único de permissões), rotas.js (registro obrigatório de rotas), valores.js (esconde dinheiro de quem não tem `valores.ver`), instalacao.js (cria tabelas web_*, migrações)
entregas.html/.js, entregas_comum.js, minhas_entregas.html/.js   Telas da equipe e do motorista (entregas_comum.js = rótulos e helpers compartilhados)
*.html, layout.js, login.js, ranking.js, custos_precos.js, importar_itens.js, leitura_pdf.js, style.css, tema.css   Front-end (layout.js = menu lateral e permissões na tela)
test/                    Testes (node:test); test/apoio/ = banco/pool falsos, servidor de teste, XMLs de NF-e
.gitignore               node_modules/, .env, *.log
APP_SITE.rar             Arquivo compactado não rastreado (ignorar)
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
- Opcionais: `DB_PORT` (padrão 3306), `PORT` (padrão 3000), `TRUST_PROXY_HOPS` (padrão 1), `ADMIN_KEY` (rotas `/admin/definir_senha` e `/migrar_senhas`, via header `x-admin-key`; sem ela as rotas respondem 403), `WEB_ADMIN_INICIAL` (usuário que vira administrador na migração inicial), `NODE_ENV`.

Nunca colocar valores de senhas/tokens neste arquivo nem no git.

## 5. Regras importantes do código

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
- **Fluxo**: `POST /leitura_pdf` (corpo = PDF cru, `Content-Type: application/pdf`, nome em `X-Arquivo-Nome`; até 25 MB e 60 páginas; `%PDF-`; sem senha) → `202 {id}` → leitura em segundo plano → `GET /leitura_pdf/:id` (polling; quando pronta traz a conferência) → `POST /leitura_pdf/:id/confirmar` (confirmar / rejeitar com motivo / informar / resolver) → a tela entrega o arquivo de itens ao fluxo de `importar_itens.js` (`#dlg-importar`, preço por `/calcular_preco`). `DELETE /leitura_pdf/:id` cancela (aborta a chamada à API). `GET /leitura_pdf/disponivel` diz se há chave.
- **Permissão**: `orcamentos.criar` + `valores.ver` (a mesma de montar orçamento; sem permissão nova).
- **Regras ficam na skill**: o servidor faz `import()` de `.claude/skills/engenharia-projetos-tecnicos/scripts/lib/servico.mjs`; prompt em `prompts/leitura-pdf-sistema.md`, schema da saída estruturada gerado do mapa (`scripts/lib/leitura.mjs`). Não duplique regra no servidor.
- **Nada entra sem conferência**: todo valor lido nasce `inferido`; cota sem unidade = cm inferido (pendência); item só é importável quando a skill libera e não sobra valor inferido/conflitante nele. Texto suspeito no PDF bloqueia a importação automática.
- **Tarefas em memória** (Map, dono = usuário, TTL 30 min depois de terminar, tempo máximo 15 min, 1 por usuário, 3 no servidor). Tarefa de outro usuário responde 404. Reinício do servidor perde as tarefas (a tela pede para enviar de novo). O PDF nunca vai para disco nem log.
- **Custo**: 10 leituras/hora por usuário (só as aceitas contam); 1 nova leitura automática se a resposta vier fora do formato; cada leitura grava em `web_auditoria` (`acao = leitura_pdf`: quem, arquivo, páginas, bytes, modelo, tentativas, `tokensEntrada`/`tokensSaida`, resultado, duração) e cada conferência (`leitura_pdf_conferir`). Para acompanhar o gasto: somar os tokens dessas linhas. Ordem de grandeza: cada página de PDF custa alguns milhares de tokens de entrada; o preço por token é o do modelo escolhido.
- **Testes**: `test/leitura_pdf.test.js` (cliente da API falso; nunca chama a API real), `test/leitura_pdf_tela.test.js`, `.claude/skills/engenharia-projetos-tecnicos/tests/leitura.test.mjs`.

### Entregas (módulo web, tabelas `web_entregas`, `web_entrega_eventos`, `web_entrega_anexos`)
- **Criação**: só a varredura idempotente (`sincronizarFila`) cria registros, para pedidos `SITUACAO='Pronto'`; não há gancho nas rotas da web. A web **nunca marca Pronto** (quem marca é o VB). Pedido que sai de Pronto antes de agendar é cancelado na varredura (e reaberto se voltar a Pronto, só quando foi a própria varredura que cancelou); entrega A programar/Agendada/Ocorrência de pedido `Cancelado` também é cancelada (Em rota não). A varredura roda em lote (um INSERT ... SELECT de entregas e um de eventos).
- **Baixa**: grava `ped_orc.SITUACAO` (`'Entregue'` ou `'Retirado'`) **e** `DATA_ENTREGA` (data da baixa, Brasília), como `Pedido_Entregue`/`Pedido_Retirado` do VB (`Module1.vb`), na **mesma transação** do evento (`rotas/transacao.js`). Nunca sobrescreve pedido `Cancelado` (409, nada gravado). Nenhuma outra escrita em tabela do VB; nada de lançamento em `fluxo_de_caixa` (fase 2).
- **Entrega Em rota**: só o motorista a conclui, mas a equipe pode Reagendar ou Cancelar uma entrega `em_rota` (para não ficar presa).
- **Exclusão de pedido**: `DELETE /ped_orc/Pedido/:numero` apaga também a entrega do número (anexos, eventos, entrega) na mesma transação e audita `entrega_removida_com_pedido`, pois o NUMERO é reaproveitado (MAX+1). **Exclusões feitas direto pelo VB não passam por aqui** e deixam o registro de entrega órfão.
- **Motorista**: perfil `Motorista` é criado pela administração (não vem nos perfis iniciais); só tem `entregas.baixar`. Vê e age apenas nas **próprias** entregas; entrega de outro motorista, inexistente ou em estado inválido responde **404 uniforme**.
- **Anexos**: no MySQL (MEDIUMBLOB), ≤ 1 MB, enviados por PUT binário; só JPEG ou PNG (conferido pelos bytes, não só pelo mime). Foto do canhoto obrigatória na baixa; assinatura opcional. Dono, tipo e status do anexo são conferidos dentro da trava da transação.
- **Nomes de campo**: nada que case com `REGEX_VALOR` (por isso `entregue_a`, e não `recebedor`: "receb" é dinheiro). Contagens usam `qtd*`. Os campos `entregaStatus`, `dataAgendada` e `qtdEntregasPendentes` são seguros e aparecem em `/dados_lista`, `/dados_pedidos`, `/dados_pedidos_rj` (LEFT JOIN só para `TIPO='Pedido'`) e em `/clientes/financeiro/:codigo`.
- **Permissões**: `entregas.ver`, `entregas.programar`, `entregas.baixar`. A migração dá ver+programar a Administrador e Interno completo; `baixar` a nenhum perfil.
- **Testes**: `test/entregas_*.test.js`, `test/minhas_entregas_tela.test.js`; `test/entregas_ligacoes.test.js` cobre as ligações e confirma que o app sobe com as rotas novas (`registro.verificar()`).

### Cadastros (fornecedores e funcionários)
- **Tabelas do VB** (`cadastro_fornecedores`: COD, RAZAO_FABRICANTE, ..., CLASSE, CF_CV; `funcionarios`: CODIGO, NOME, CPF, CARGO, SALARIO_BASE, ..., SENHA, NIVEL, ADMISSAO, DEMISSAO). Códigos novos são AUTO_INCREMENT (o VB manda NULL/0). Regras tiradas de `frm_Cadastro_Fornecedores.vb` e `frm_Funcionários.vb`.
- **Fornecedor**: classe obrigatória (Matéria prima, Insumos, Serviços, Geral); situação Ativo/Inativo; a razão social não muda depois de criada (estoque, compras e `fluxo_de_caixa.RAZAO_FABRICANTE` usam o nome como chave) e não pode repetir; o registro `.` do VB não aparece; sem exclusão (inativar). Permissões `fornecedores.ver`/`fornecedores.editar` (Administrador e Interno completo).
- **Funcionário**: dados pessoais com `funcionarios.ver`/`funcionarios.editar` (**só Administrador** na migração); salário e encargos (SALARIO_BASE, FGTS, férias, 13º, almoço, transporte, plano, seguro, outros) só com `valores.ver` — sem ela a rota não devolve e, ao salvar, mantém o que está gravado (`preservarValores`). **SENHA, NIVEL e DARF do VB nunca saem nem são alterados pela web** (novo funcionário entra com SENHA vazia; NIVEL = cargo, como o VB). Como o VB, DEMISSAO sempre grava uma data (hoje se vazia); a tela só mostra para quem está Demitido. A auditoria (`funcionario_criado/alterado`) guarda só os nomes dos campos alterados, nunca CPF nem valores. Sem exclusão (Inativo/Demitido).
- **Testes**: `test/cadastros_calculo.test.js`, `test/cadastros_rotas.test.js` (banco falso `test/apoio/bancoCadastros.js`), `test/cadastros_tela.test.js`.

### Outras regras não óbvias
- **Fidelidade ao VB**: cálculos devem reproduzir o VB (comentários citam `MotorFinanceiro`, `MotorPrecificacaoSerralheria`, `frmPortasAbrir`, etc.). Antes de "corrigir" uma conta, confirme se é comportamento do VB.
- **Puxador**: valor mínimo R$ 20 por unidade (`precos.js:208`, "fiel ao VB"). Puxador "Total" desconta o lado do perímetro do perfil (`precos.js:199-204`). Divisores: `qtdDivH` = horizontais, `qtdDivV` = verticais (`precos.js:215`). Dedução do divisor no revestimento usa fator 0,015 (`precos.js:232`).
- **Percentuais** (`"+10;-5"`): na rota `/calcular_preco` são compostos (`aplicarPercentuais`, `precos.js:87`); no histórico do VB (`fatorHistorico`, `precos.js:99`) são **sobre a base** (não composto): "+100;+10" = ×2,1.
- **Solda sem cadastro** → valor 0 (`precos.js:54`). Acessório com tamanho é cobrado por metro (`tamanho/1000`).
- **Complementos da serralheria**: somados fora do motor, com valor do cadastro e **sem desconto do cliente** (`precos.js:147,270`).
- **Menu do botão direito (pedidos e orçamentos)**: em `painel_inicial.html`, cada linha abre ações conforme a permissão (PDF, guia de produção, editar, mudar situação, ver entrega, copiar, cancelar, excluir). Mudar situação = `POST /ped_orc/Pedido/:numero/situacao` (permissão `pedidos.situacao`, só Administrador na migração; valores Em Produção/Pronto/Entregue/Retirado; Entregue/Retirado gravam `DATA_ENTREGA` = hoje como o VB, sair deles limpa a data; Cancelado não muda por aqui; auditado como `pedido_situacao`). A fila de Entregas acompanha pela varredura.
- **Segurança de rotas**: toda rota deve ser criada por `registro.rota(...)`/`registro.publica(...)` com a permissão exigida; `registro.verificar()` impede o servidor de subir se houver rota fora do registro. Nova permissão: acrescentar em `seguranca/permissoes.js` (código `area.acao`).
- **Valores financeiros**: quem não tem `valores.ver` não pode receber dinheiro. Use `semValores(...)` nas rotas; `redeDeValores` apaga campos com nome de dinheiro que escaparem. **Contagens não podem usar nomes de campos de dinheiro** — use `qtd*`/`quantidade` (`seguranca/valores.js`).
- **Tabelas**: tabelas do VB são lidas/gravadas "do jeito que o VB espera"; tudo que é só da web fica em tabelas `web_*`, criadas na subida por `seguranca/instalacao.js` (que nunca altera tabelas do VB). Gravações de estoque/pedido são transações.
- **Token JWT**: guarda só id/nome (`v: 2`, 8 h, issuer `elegance-api`); perfil, permissões e estados vêm do banco a cada requisição (cache 60 s). Login limitado a 5 tentativas por 15 min.
- **Estados (região)**: usuário com estados restritos só vê clientes desses estados (`filtroEstados`, `foraDosEstados`).
- **Senhas**: bcrypt; `/migrar_senhas` converte senhas em texto puro criadas pelo VB. Chave de admin só por header, nunca na URL.
- **NF-e XML**: documentos com DOCTYPE são recusados (proteção contra entidades).
- **Dados ausentes no custo**: custo vira `null` + motivo, nunca zero (`calculo/custos.js`). Referências em `precos_referencias.js` são só exibição, nunca usadas no cálculo.
- **Formação de preço**: mínimo = custo ÷ (1−V); equilíbrio = custo ÷ (1−V−F); alvo = custo ÷ (1−V−F−M); `VALOR_FIXO` sugerido = alvo ÷ (1−desconto) (`calculo/precos_formacao.js`). A gravação é "tudo ou nada" e recusa se o valor mudou desde a leitura (`rotas/precos_formacao.js:264`).
- Nos testes e no código não foram encontrados marcadores `IMPORTANTE`, `NÃO MUDAR` ou `TODO` relevantes (busca feita; só resultados irrelevantes como "todos").
