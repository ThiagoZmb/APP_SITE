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
- Administração de usuários, perfis e permissões (`usuarios.html`, `rotas/admin.js`, `seguranca/`).

Stack: Node.js + Express 4, mysql2 (MySQL), jsonwebtoken, bcryptjs, helmet, cors, express-rate-limit, pdfkit, fast-xml-parser. Front-end em HTML/CSS/JS puro (sem build/framework), com Content-Security-Policy em cada página.

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
calculo/                 Funções puras (testáveis sem banco)
  precos.js              Motor de preço: portas, serralheria, avulso, acessórios; leitor do cadastro
  precos_formacao.js / precos_referencias.js / custos.js / custos_sugestao.js   Formação de preço e custos
  engenharia.js          Regras de engenharia das portas
  leitura_vb.js / linhas_vb.js   Conversão banco<->tela no formato do VB
  nomes.js               Normalização/semelhança de nomes de produtos
pdf/ped_orc.js           PDF do pedido/orçamento (rota /dados_pdf) fiel ao Gerar_PDF_PedOrc do VB; ?producao=1 = Guia de Produção (só Pedido)
imagens/logo_elegance.png  Logo do cabeçalho do PDF (convertido do Elegance_Logo.JPEG do VB, que na verdade é BMP)
seguranca/               acesso.js (perfil+permissões por requisição, cache 60 s), permissoes.js (catálogo único de permissões), rotas.js (registro obrigatório de rotas), valores.js (esconde dinheiro de quem não tem `valores.ver`), instalacao.js (cria tabelas web_*, migrações)
*.html, layout.js, login.js, ranking.js, custos_precos.js, style.css, tema.css   Front-end (layout.js = menu lateral e permissões na tela)
test/                    Testes (node:test); test/apoio/ = banco/pool falsos, servidor de teste, XMLs de NF-e
.gitignore               node_modules/, .env, *.log
APP_SITE.rar             Arquivo compactado não rastreado (ignorar)
```

## 3. Como rodar

```bash
npm install
npm start        # node index.js  (porta PORT ou 3000)
npm test         # node --test "test/**/*.test.js"
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

### Outras regras não óbvias
- **Fidelidade ao VB**: cálculos devem reproduzir o VB (comentários citam `MotorFinanceiro`, `MotorPrecificacaoSerralheria`, `frmPortasAbrir`, etc.). Antes de "corrigir" uma conta, confirme se é comportamento do VB.
- **Puxador**: valor mínimo R$ 20 por unidade (`precos.js:208`, "fiel ao VB"). Puxador "Total" desconta o lado do perímetro do perfil (`precos.js:199-204`). Divisores: `qtdDivH` = horizontais, `qtdDivV` = verticais (`precos.js:215`). Dedução do divisor no revestimento usa fator 0,015 (`precos.js:232`).
- **Percentuais** (`"+10;-5"`): na rota `/calcular_preco` são compostos (`aplicarPercentuais`, `precos.js:87`); no histórico do VB (`fatorHistorico`, `precos.js:99`) são **sobre a base** (não composto): "+100;+10" = ×2,1.
- **Solda sem cadastro** → valor 0 (`precos.js:54`). Acessório com tamanho é cobrado por metro (`tamanho/1000`).
- **Complementos da serralheria**: somados fora do motor, com valor do cadastro e **sem desconto do cliente** (`precos.js:147,270`).
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
