---
name: ELEGANCE — Sistema de gestão (Console Grafite)
description: Sistema de gestão web de esquadrias, portas e serralheria; console escuro em grafite azulado, painéis em degraus de elevação separados por filetes de 1px, um único acento cobre (da logo) e quatro cores de estado dessaturadas.
colors:
  primary: "#e8895a"
  primary-dark: "#cf7348"
  primary-tint: "rgba(232, 137, 90, 0.12)"
  primary-ring: "rgba(232, 137, 90, 0.30)"
  primary-border: "rgba(232, 137, 90, 0.45)"
  on-primary: "#14110f"
  page-bg: "#12151a"
  surface: "#181c22"
  surface-2: "#1f242c"
  surface-3: "#272d36"
  border: "#2a303a"
  border-strong: "#3a424e"
  border-control: "#667180"
  table-line: "#21262e"
  text-dark: "#e7eaef"
  text-mid: "#adb5c0"
  text-light: "#8d97a5"
  text-disabled: "#6b7685"
  success: "#54c18b"
  success-text: "#6fd3a2"
  warning: "#e3b04b"
  warning-text: "#edc26b"
  danger: "#ef6f7b"
  danger-text: "#f59aa3"
  info: "#6baae8"
  info-text: "#8ec0f0"
  sidebar-bg: "#0d0f12"
  sidebar-text: "#9aa3b0"
  sidebar-muted: "#6b7685"
typography:
  title:
    fontFamily: "'Public Sans', 'Segoe UI', system-ui, -apple-system, sans-serif"
    fontSize: "24px"
    fontWeight: 700
    letterSpacing: "-0.01em"
  headline:
    fontFamily: "'Public Sans', 'Segoe UI', system-ui, -apple-system, sans-serif"
    fontSize: "17px"
    fontWeight: 700
  body:
    fontFamily: "'Public Sans', 'Segoe UI', system-ui, -apple-system, sans-serif"
    fontSize: "14px"
    fontWeight: 500
  label:
    fontFamily: "'Public Sans', 'Segoe UI', system-ui, -apple-system, sans-serif"
    fontSize: "11.5px"
    fontWeight: 600
    letterSpacing: "0.05em"
  figure:
    fontFamily: "'JetBrains Mono', ui-monospace, 'Cascadia Mono', Consolas, monospace"
    fontSize: "17px"
    fontWeight: 600
    fontFeature: "tnum"
  table-cell:
    fontFamily: "'Public Sans', 'Segoe UI', system-ui, -apple-system, sans-serif"
    fontSize: "13.5px"
    lineHeight: 1.35
rounded:
  sm: "6px"
  md: "8px"
  lg: "10px"
  drawer: "12px"
  pill: "999px"
spacing:
  card-gap: "12px"
  card-padding: "12px 16px"
  cell-padding: "8px 10px"
  sidebar-width: "264px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.sm}"
    padding: "11px 18px"
  button-secondary:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text-dark}"
    rounded: "{rounded.sm}"
    padding: "11px 18px"
  button-mini:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text-mid}"
    rounded: "{rounded.sm}"
    padding: "8px 12px"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.md}"
    padding: "12px 16px"
  panel:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.md}"
  input:
    backgroundColor: "{colors.page-bg}"
    textColor: "{colors.text-dark}"
    rounded: "{rounded.sm}"
    padding: "10px 12px"
    height: "42px"
  table-head:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text-light}"
    padding: "10px 10px"
  modal:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.lg}"
---

# Design System: ELEGANCE — Console Grafite

> Fonte única das regras visuais. A implementação vive em `tema.css` (carregado por último em todas as páginas internas); os valores do cabeçalho acima são normativos e o texto explica como aplicá-los. A **logo Elegance** é o único elemento de identidade obrigatório; a cor do acento, a fonte e as formas podem evoluir. O layout de `orcamentos.html` e `financeiro.html` é preservado: só a aparência muda.

## Overview

**Creative North Star: "O Console Grafite"**

O sistema é uma ferramenta de trabalho escura e precisa. O fundo é grafite, os painéis são um degrau mais claros e se separam por filetes de 1px, nunca por sombra pesada. Existe um único acento, o cobre (da logo), e ele tem função: a ação principal da tela, o item ativo do menu, o foco de um campo e o número que merece atenção. Verde, azul, amarelo-dourado e rosa-vermelho (dessaturados) só dizem estado.

É feito para quem lê tabela e valor o dia todo: números pequenos e monoespaçados, cabeçalhos de coluna discretos, ações destrutivas isoladas e em contorno. A densidade é de trabalho, não de vitrine. O tom escuro foi uma decisão do dono do sistema ("faça sempre em tom escuro") e vale para todas as telas internas, inclusive no celular.

**Key Characteristics:**
- Grafite `#12151a` de fundo, painéis `#181c22`, elevado `#1f242c`, sobreposto `#272d36`, filetes `#2a303a`; elevação por tom, sem sombras decorativas.
- Acento único cobre `#e8895a`; texto sobre ele é sempre `#14110f`, nunca branco. Estados: verde `#54c18b`, amarelo-dourado `#e3b04b`, rosa-vermelho `#ef6f7b`, azul `#6baae8`.
- Public Sans para interface; JetBrains Mono para números, códigos e pedidos, em tamanho discreto (valores de cartão 17px).
- Cantos curtos: 6px em controles, 8px em cartões e painéis, 10px em modal, 12px na gaveta.
- Estados nunca só por cor: sempre com texto, ícone ou ponto.
- Respeita `prefers-reduced-motion`.

## Colors

Paleta revisada em 2026-11-13 (pedido do dono: "muita mistura de cores, sem coerência"). Regra de ouro: **neutros fazem 90% da tela, o cobre marca a ação e a identidade, e só quatro cores dessaturadas dizem estado**. Nenhuma outra cor existe.

### Princípios usados (pesquisa)
- **Nada de preto puro nem de branco puro** (Material Design dark theme; vev.design "6 Dark Mode Website Color Palette Ideas"; SaaSUI): fundo grafite `#12151a` (próximo do `#121212` do Material) e texto `#e7eaef` (15:1, sem o "halo" do branco sobre preto).
- **Elevação por tom, não por sombra** (Material: "higher elevation, lighter surface"; Pegasus Design System; Brainy): page `#12151a` → painel `#181c22` → elevado `#1f242c` → sobreposto `#272d36`; sombra só em camada flutuante.
- **Um acento + neutros; cor com parcimônia** (Material: "limited color accents"; vev.design "monochromatic minimalism": a cor direciona o foco): o cobre é a única cor de marca.
- **Acentos e semânticas dessaturados e mais claros no escuro** (Material: saturadas "vibram"; paletacolorpro e SaaSUI: sucesso/erro/alerta/info com tons mais claros e menos saturados): as quatro cores de estado têm croma e luminosidade parecidos, para nenhuma gritar mais que a outra.
- **Escala por função** (Radix Colors, 12 passos: fundo, fundo de componente, borda sutil, borda de controle, sólido, texto de baixo e de alto contraste): cada papel abaixo tem uma função e uma variável.
- **Contraste de verdade** (WCAG 2.1 AA; Material 15,8:1; Apple): texto >= 4,5:1 em todas as superfícies, componentes e bordas de campo >= 3:1 (criterio 1.4.11). Tabela em "Contraste".
- **Variáveis semânticas, nunca hexadecimal solto** (vev.design "define your colors as Variables"; Pegasus: "no component uses a hex value").

### Primary — Cobre (acento único da marca)
Derivado do "g" terracota da logo ELEGANCE (`#a6361e`, matiz ~10°), clareado para ler sobre grafite (matiz ~18°). Substituiu o âmbar `#f2a33a`, que era também a cor de "aviso" e por isso competia com o estado.
- **Cobre de Ação** (`#e8895a`, `--primary-color`): botão principal, item ativo do menu, foco de campo, link, número em destaque (saldo), aba ativa, contadores. Texto sobre ele: **Tinta sobre Cobre** (`#14110f`, `--on-primary`). Hover: `brightness(1.1)`; pressionado: `--primary-dark` `#cf7348`.
- **Cobre Fundo** (`rgba(232,137,90,.12)`, `--primary-light`), **Anel** (`.30`, `--primary-ring`: foco de 3px) e **Cobre Borda** (`.45`, `--primary-borda`: cartão em destaque).

### Neutral (grafite azulado, matiz ~215°, croma baixíssimo)
- **Fundo** (`#12151a`, `--bg`): página e fundo dos campos (mais escuro que o painel que os contém).
- **Painel** (`#181c22`, `--white`): cartões, painéis, tabelas, modais.
- **Painel Elevado** (`#1f242c`, `--surface-2`): cabeçalho de tabela, botão secundário, aba ativa, topo de gaveta.
- **Sobreposto** (`#272d36`, `--surface-3`): menus, balões, toasts neutros, selo neutro.
- **Filete** (`#2a303a`, `--border-color`): divisória e borda de cartão. **Filete Firme** (`#3a424e`, `--border-strong`): divisória forte e chip ativo. **Borda de Controle** (`#667180`, `--border-control`): borda de campo e de botão secundário, 3,7:1 sobre o fundo. Linha de tabela `#21262e`; hover de linha `rgba(255,255,255,.035)`.
- **Tinta** (`#e7eaef`, `--text-dark`), **Tinta Média** (`#adb5c0`, `--text-mid`), **Tinta Suave** (`#8d97a5`, `--text-light`), **Tinta Apagada** (`#6b7685`, `--text-disabled`: só para o que está desabilitado/inativo).

### Semantic (estado; só dizem o que algo é)
Cada semântica tem quatro variáveis: cor base (ícone, ponto, borda forte, número), `-fg` (texto sobre o fundo suave), `-bg` (14%) e `-borda` (35%).
- **Verde** (`#54c18b` / fg `#6fd3a2`): sucesso, entrada, pago, concluído. `--success-*`
- **Amarelo-dourado** (`#e3b04b` / fg `#edc26b`): aviso, estoque no mínimo, falta ação. `--warning-*` (não é o acento: é mais amarelo, matiz ~42° contra ~18°)
- **Rosa-vermelho** (`#ef6f7b` / fg `#f59aa3`): erro, saída, falta, atraso, ação destrutiva. `--danger-*`
- **Azul** (`#6baae8` / fg `#8ec0f0`): informação, em andamento. `--info-*`
- Sólidos para texto branco (toast): `--success-solid` `#1f6b46`, `--danger-solid` `#a8344a`.

### Selos de status
Pares `-bg` e `-fg` em `tema.css`, montados sobre as semânticas: `--selo-neutro-*`, `--selo-aviso-*`, `--selo-info-*`, `--selo-ok-*`, `--selo-perigo-*`.

### Cores das situações
Padrão único (aprovado em `docs/padrao-cores-situacoes.md`): cada situação tem **uma** cor em todas as telas, definida em `situacoes.js` (`Situacoes.selo(grupo, valor)` / `Situacoes.cor`) e desenhada pelo único `.selo` do `tema.css`. Nada de hsl/hex, variáveis locais (`--ok`, `--erro`...) nem `.selo` copiado na página.
- **ok** (verde): concluído, pago, ativo, conferido. **info** (azul): em andamento ou combinado. **aviso** (amarelo-dourado): falta ação ou conferência. **perigo** (rosa-vermelho): atrasado, falhou, bloqueado. **neutro** (cinza): inativo, N/A, encerrado, cancelado por decisão normal.
- Pedido: Em Produção info · Pronto aviso · Entregue/Retirado ok · Cancelado neutro · Atrasado perigo. Entrega: A programar aviso · Entrega a agendar (estado derivado do calendário) info · Agendada/Em rota/Enviada info · Ocorrência perigo · Entregue/Retirado ok · Cancelada/Encerrada neutro. Tipo "Retirada" (de entrega) é neutro: tipo não tem cor de situação.
- "Inativo" é sempre neutro; vermelho só para o que exige reação (Bloqueado, Suspensa). Situação nova: acrescentar em `situacoes.js` e no teste `test/situacoes.test.js`.

### Séries de gráfico (categorias sem significado de estado)
`--serie-1` a `--serie-8` em ordem fixa, todas com luminosidade e croma parecidos (sóbrias): cobre `#e8895a`, azul-aço `#6fa8dc`, verde-água `#5db8a8`, ouro `#d9b25a`, lavanda `#9a8cd9`, rosa `#d98aa8`, sálvia `#9db87a`, cinza `#8e99a8`; "Outros" `#4a5260`. O 1º é o acento. **Valor com significado de estado (entrada/saída, pago/recebido, em risco) usa a semântica, não a série.** Em canvas e Chart.js a cor precisa ser literal (`var()` não vale): use os hexadecimais acima, com o comentário "valores do tema.css".
- Grade de eixo `#2a303a`; fatia de rosca separada por `#181c22`; linha de resultado/total em `#e7eaef`.

### Ícones em emoji
Os atalhos e cartões usam emoji (coloridos por natureza). O `tema.css` aplica uma camada `mix-blend-mode: color` que deixa o emoji monocromático no tom do papel do ícone: **cobre por padrão**; entrada = verde, saída/falta = rosa-vermelho, mínimo = amarelo-dourado (variável `--icone-tom`). Emoji solto dentro de texto ou botão não é tratado.

### Sidebar
- **Fundo** (`#0d0f12`, um degrau abaixo da página) com filete à direita; texto `#9aa3b0`, rótulos de grupo `#6b7685`; item ativo em Cobre Fundo com texto cobre e anel de 1px.

### Exceção deliberada: o desenho técnico da porta
A área `#cv-visualizacao` e as funções de canvas do desenho (`orcamentos.html`, `desenho3d.js`) usam cores claras e de engenharia (vão azul, porta laranja, vidro azul-claro, perfil cinza claro), porque o PNG vai para o PDF e para o cliente em papel/tela clara. Não seguem a paleta do tema e não devem ser trocadas.

### Contraste (calculado, WCAG 2.1)
| Par | Razão | Mínimo |
| --- | --- | --- |
| Tinta `#e7eaef` sobre fundo / painel / elevado / sobreposto | 15,2 / 14,2 / 12,9 / 11,5 | 4,5 |
| Tinta Média `#adb5c0` sobre fundo / painel / elevado / sobreposto | 8,8 / 8,3 / 7,5 / 6,7 | 4,5 |
| Tinta Suave `#8d97a5` sobre fundo / painel / elevado / sobreposto | 6,2 / 5,8 / 5,3 / 4,7 | 4,5 |
| Cobre `#e8895a` (texto/link) sobre fundo / painel / elevado / sobreposto | 7,1 / 6,6 / 6,1 / 5,4 | 4,5 |
| Tinta sobre Cobre `#14110f` sobre `#e8895a` (botão) / hover `#f09a6e` | 7,3 / 8,6 | 4,5 |
| Cobre sobre seu fundo suave (aba/mini ativo, sobre elevado) | 5,0 | 4,5 |
| Verde / amarelo / rosa-vermelho / azul (cor base) sobre painel | 7,6 / 8,6 / 5,9 / 7,0 | 3 (ícone) |
| Selo: `-fg` sobre `-bg`: verde / amarelo / rosa-vermelho / azul | 7,3 / 7,8 / 6,7 / 7,0 | 4,5 |
| Toast: branco sobre `#1f6b46` / sobre `#a8344a` | 6,5 / 6,5 | 4,5 |
| Borda de controle `#667180` sobre fundo / elevado | 3,7 / 3,2 | 3 (1.4.11) |
| Tinta Apagada `#6b7685` sobre fundo (só desabilitado, exceção WCAG) | 4,0 | 3 |

### Named Rules
**The One Voice Rule.** O cobre é o único acento. Se uma tela parece ter dois, um deles é erro. As quatro cores de estado só dizem o que algo é e nunca enfeitam.
**The Ink On Copper Rule.** Qualquer superfície cobre leva texto escuro (`var(--on-primary)`). Texto branco sobre cobre falha o contraste.
**The Neutral Icons Rule.** Ícone sem significado de estado é neutro ou cobre; verde, vermelho, amarelo e azul em ícone só com o significado delas.
**The Variable Rule.** Cor nova nasce como variável em `tema.css`. Fundo claro, `#fff` de fundo ou `<style>` redefinindo `:root` com variáveis do tema numa página é dívida. Tom de estado em fundo/borda: `var(--success-bg)`, `var(--danger-borda)` etc., nunca `hsla(...)` nem hexadecimal de estado.

## Typography

**Interface:** Public Sans (Google Fonts, 400–700), com `'Segoe UI', system-ui, sans-serif` de reserva.
**Números:** JetBrains Mono, em valores de cartão, valor de tabela, pedido, código e totais; sempre `tabular-nums`.

**Caráter:** sóbria e legível; a monoespaçada marca onde há medida, dinheiro ou código.

### Hierarchy
- **Title** (700, 24px, -0.01em): título de página.
- **Headline** (700, 17px): título de painel, tabela e gráfico.
- **Figure** (600, 17px, mono): valor dos cartões de indicador. Números não crescem para "impressionar".
- **Body** (500, 14px): campos, botões, texto corrente.
- **Table cell** (13.5px, 1.35): células; texto longo vira "…" e aparece inteiro ao passar o mouse.
- **Label** (600, 11.5px, maiúsculas, 0.05em, Tinta Suave): rótulo de cartão e cabeçalho de coluna.

### Named Rules
**The Quiet Numbers Rule.** Valores em reais, quantidades e totais usam a monoespaçada em tamanho de leitura (13–17px). Número gigante é proibido.

## Layout

A casca é uma grade de duas colunas: sidebar fixa de 264px e conteúdo ocupando o resto, com uma faixa fina de 24px no topo (empresa e usuário). Cartões de indicador entram em grade automática (financeiro: 3 × 2); painéis e gráficos têm 18–22px de respiro; tabelas são compactas (8px × 10px por célula, uma linha por registro). **Toda lista com rolagem mantém o cabeçalho das colunas sempre visível**, em destaque (texto claro, filete cobre de 2px embaixo e sombra suave sobre as linhas que passam) (regra do dono, 2026-11-09): a lista rola dentro de um quadro com altura limitada (`.tabela-wrap`, `.lista-wrap`, `.rolagem`, `.etp-rolagem`; o `tema.css` já dá a altura máxima e o `th` sticky quando a página não define a sua). Lista nova: coloque a tabela dentro de um desses quadros; só `overflow-x` não basta, porque sem altura máxima o quadro não rola na vertical e o `th` nunca gruda.

Responsivo: abaixo de 960px a sidebar vira gaveta com fundo escurecido; há ajustes em 1200, 1000, 700, 600 e 520px. O motorista usa `minhas_entregas.html` no celular, então toque e leitura em tela pequena contam. O botão do menu móvel (`.btn-menu-mobile`, três barras no topo) tem área de toque de 44x44 px e ícone de 24 px na cor do texto da barra (`--side-text`), sem caixa visível; a barra do topo continua com 24 px de altura (margem negativa no botão).

## Elevation & Depth

Plano por padrão: superfícies com filete de 1px. A hierarquia vem de um degrau de tom (`#12151a` → `#181c22` → `#1f242c`), não de sombra. Sombras só em camadas flutuantes (modal, toast, gaveta): `0 24px 48px -12px rgba(0,0,0,.7)`. O foco usa anel cobre de 3px.

Camadas sobrepostas (gaveta, ficha lateral, modal, menu de contexto, popover, sugestões): fundo sempre sólido do tema (`var(--bg)` na gaveta/ficha lateral, `var(--surface-2)` ou `var(--white)` em menus e cartões), nunca `rgba`/`hsla` com alfa menor que 1 nem `transparent`. Só o fundo de escurecimento (`*-fundo`, backdrop) é translúcido.

### Named Rules
**The Hairline Rule.** Separação é filete de 1px. Cartão não sobe, brilha nem projeta sombra ao passar o ponteiro; só a borda se firma.

## Shapes

Cantos curtos e consistentes: **6px** (controles, botões, linhas de ranking), **8px** (cartões, painéis, blocos, trilhos de alternância), **10px** (modal e janelas), **12px** (gaveta lateral, só no canto externo), **999px** (chips e selos). Bordas finas de 1px; não há faixa colorida lateral maior que 1px em cartão, linha ou alerta (estado se mostra por tom de fundo, ponto e texto).

## Components

### Buttons
- **Primário:** fundo cobre, texto `--on-primary`, 14px/700, `padding 11px 18px`, raio 6px, sem sombra. Hover: mais claro (`brightness 1.1`). **Um primário por tela.**
- **Secundário:** Painel Elevado com filete firme; hover firma a borda.
- **Mini** (ação de linha): Painel Elevado, 13px/600, raio 6px; hover e ativo em Cobre Fundo com texto cobre. Variantes de estado em verde e azul.
- **Perigo:** contorno e tom vermelho translúcido, isolado dos vizinhos; nunca cobre cheio.

### Chips e alternâncias
- **Chip:** pílula com filete; ativo = Filete Firme com texto claro.
- **Alternância (segmented):** trilho `#12151a` com filete, raio 8px; segmento ativo em Painel Elevado com texto cobre.

### Cards / Containers
- **Cartão de indicador:** painel, raio 8px, `padding 12px 16px`; título 11.5px maiúsculas Tinta Suave, valor mono 17px. Ícone de 32px com fundo tonal do significado (verde entrada, rosa-vermelho saída/falta, amarelo-dourado mínimo; os demais, cobre).
- **Saldo / destaque:** mesmo cartão com borda cobre a 50% e o número em cobre. Não há cartão preenchido de cobre.
- **Painel:** Painel com filete, raio 8px, título 17px.

### Olho dos resumos
- Botão de olho (`.olho-resumos`, `olho_resumos.js` + bloco "OLHO DOS RESUMOS" do `tema.css`) que mostra ou esconde os blocos de números-resumo do topo da tela (cartões de indicador, faixas "Operação agora"/"Resultado do período"). **A tela sempre inicia com os resumos escondidos** (decisão do dono, 2026-11-11): a escolha não é guardada entre visitas. Escondido por CSS (`body:not(.resumos-on) [data-resumo]`), então não há flash e a lista principal sobe e ocupa o espaço.
- Uso: `data-resumo` no bloco (junto de `data-perm`/`data-valor`, que continuam mandando; o botão some se nenhum resumo é permitido); `data-olho-destino` no elemento de filtros/título onde o botão entra (sem ele, uma barrinha acima do primeiro resumo). Botão: `aria-pressed`, `aria-label` "Mostrar resumos"/"Ocultar resumos", ícones SVG de olho aberto/fechado, alvo de 40px (44px em toque). Busca só para os resumos: `if (OlhoResumos.adiar(fn)) return;` (escondido, nada vai ao banco; roda ao mostrar). Resumo novo no topo de uma tela segue este padrão.
- **Só o que é de trabalho aparece e carrega com o olho fechado** (decisão do dono, 2026-11-11): filtros, busca, lista/tabela principal e ações ficam sempre; resumo, indicador, gráfico, ranking, análise e comparativo ficam atrás do olho (`data-resumo`) **e a chamada de API que só serve a eles é adiada**. Contadores de abas e chips de filtro que servem de navegação NÃO são resumo e ficam. Informação analítica nova nasce atrás do olho.
- **Carga adiada que depende de filtro** (período, cliente, mês): `const analises = OlhoResumos.carga(renderAnalises); analises.atualizar();` a cada mudança. Olho fechado: só marca "desatualizado" (nada é buscado nem desenhado); ao abrir carrega uma vez; aberto: recarrega na hora; reabrir sem mudança reaproveita o que já veio. Chamada compartilhada com a parte de trabalho deve ser separada com segurança (ex.: `/estoque/resumo?parte=filtros|totais`); se não der, só esconda. `OlhoResumos.aoMudar(fn)` avisa abrir/fechar (ex.: sair de uma aba que só existe com o olho aberto); mais de um `data-olho-destino` gera um botão em cada um (ex.: lista e ficha lateral).
- **Atalho que existia só no resumo** (ex.: cartões "No mínimo"/"Em falta" do Estoque): ganha chip equivalente na área de trabalho e, com a lista filtrada, a faixa `.filtro-ativo` ("Mostrando só..." + "Limpar filtro"), definida no `tema.css`.

### Inputs / Fields
- Fundo Grafite de Fundo (mais escuro que o painel), filete firme, raio 6px, altura mínima 42px; rótulo 12px/700 Tinta Média sem maiúsculas.
- **Foco:** borda cobre + anel de 3px. **Somente leitura:** número em cobre. **Desabilitado:** `#181c22`, borda tracejada, cursor bloqueado.
- **Anotação em post-it amarelo** (observação geral do pedido, `#ped-obs`): fundo `--post-it-bg` (`#fff9c4`) fixo nos dois temas, texto `--post-it-texto` (`#1a1a1a`), cursor igual ao texto, placeholder `--post-it-placeholder` (`#5c5c5c`). Texto claro do tema escuro sobre amarelo é ilegível; contraste ~16:1.
- Busca com lupa clara à esquerda; seleção com seta própria; checkbox com `accent-color` cobre; `color-scheme: dark` para controles nativos.

### Tables
- Cabeçalho em Painel Elevado, 11px/700 maiúsculas Tinta Suave. Células 13.5px, divisória `#21262e`, hover sutil.
- Linhas semânticas por tom de fundo (falta vermelho 9%, mínimo amarelo-dourado 9%, selecionada cobre 12%); sem faixa lateral. Movimentos do Fluxo de Caixa não têm fundo por tipo (entrada/saída): a cor fica no valor; só a linha da data de hoje ganha verde suave (`--success-bg`, classe `.linha-hoje`).
- **Selos:** pílula 11.5px/700 com bolinha de 6px, usando os pares `--selo-*`.

### Navigation
- **Sidebar** `#0d0f12` com grupos em maiúsculas pequenas; item de 14px/600; ativo em Cobre Fundo com texto cobre; subitens recuados com guia de 1px.
- **Abas:** 13.5px/700 em Tinta Suave, ativa em cobre com sublinhado de 2px.

### Overlays
- **Modal:** raio 10px, filete, fundo `rgba(8,9,11,.62)`. **Gaveta:** topo em Painel Elevado com texto claro, filete à esquerda. **Toast:** raio 8px; sucesso `#1f6b46`, erro `#a8344a`, informação Painel Elevado com filete.

### Movimento
Transições de 0,12–0,25 s; entrada de página de 0,45 s. Com `prefers-reduced-motion`, quase zero.

## Do's and Don'ts

### Do:
- **Do** usar as variáveis de `tema.css` em toda cor, borda e raio novos (`var(--primary-color)`, `var(--white)` = superfície de painel, `var(--bg)` = fundo e campos, `var(--text-dark)`, `var(--border-color)`).
- **Do** manter **um botão primário por tela** (cobre com texto escuro).
- **Do** usar `--font-mono` e `tabular-nums` em valores, quantidades e códigos.
- **Do** mostrar estado com cor **e** texto, ícone ou ponto.
- **Do** usar `--border-control` (3:1) na borda de campo e controle, e `--text-disabled` só no que está desabilitado.
- **Do** conferir o contraste (texto 4,5:1; componente 3:1) de qualquer par novo; a tabela da seção Colors é o padrão.
- **Do** dar foco visível a todo campo e botão (borda cobre + anel de 3px).
- **Do** carregar `tema.css` por último em toda página nova e subir o `?v=` em **todas** as páginas quando o tema mudar (um teste exige versão única).
- **Do** respeitar `prefers-reduced-motion` em qualquer animação nova.

### Don't:
- **Don't** usar fundo claro, `#fff` de fundo ou cor hexadecimal solta numa página, nem redefinir `:root` com variáveis do tema. Única exceção de hexadecimal: `#fff` para texto sobre tom escuro de estado (toast).
- **Don't** colocar texto branco sobre cobre; use `var(--on-primary)`.
- **Don't** usar faixa colorida lateral (`border-left`/`right`) maior que 1px em cartão, linha ou alerta.
- **Don't** usar número grande de destaque, gradiente em texto, sombra decorativa nem cartão que sobe no hover.
- **Don't** criar um segundo acento de marca nem usar vermelho/verde/azul/amarelo como enfeite (ícone, botão, aba ou cabeçalho sem significado de estado).
- **Don't** usar `hsla(...)`/hexadecimal para tom de estado, nem `<a>` azul do navegador: use `--success-bg`, `--danger-borda` etc. e deixe o link no cobre.
- **Don't** usar preto puro (`#000`) nem branco puro de texto; o texto é `--text-dark`.
- **Don't** usar `var()` em canvas, atributos SVG ou strings de JS que desenham: ali a cor precisa ser literal (use o valor do tema).
- **Don't** reutilizar nomes de classe do `layout.js` (`grupo`, `menu-item`, `sb-*`) nas páginas sem escopo; `.grupo` já colidiu com o menu em `corte.html` e `corte_vidros.html`.
- **Don't** mostrar dinheiro a quem não tem `valores.ver` (regra de negócio, vale para toda tela nova).
