---
name: ELEGANCE — Sistema de gestão (Console Grafite)
description: Sistema de gestão web de esquadrias, portas e serralheria; console escuro em grafite, painéis separados por filetes de 1px e um único acento âmbar.
colors:
  primary: "#f2a33a"
  primary-dark: "#d98a1c"
  primary-tint: "rgba(242, 163, 58, 0.12)"
  primary-ring: "rgba(242, 163, 58, 0.28)"
  on-primary: "#14161a"
  page-bg: "#14161a"
  surface: "#1b1e24"
  surface-2: "#20242b"
  border: "#2c313a"
  border-strong: "#3a404b"
  table-line: "#23272e"
  text-dark: "#e8eaee"
  text-mid: "#b4bac4"
  text-light: "#8b93a1"
  success: "#3ddc97"
  warning: "#f2a33a"
  danger: "#ff6b7a"
  info: "#6cb6ff"
  sidebar-bg: "#101215"
  sidebar-text: "#9aa1ad"
  sidebar-muted: "#6b7280"
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

O sistema é uma ferramenta de trabalho escura e precisa. O fundo é grafite, os painéis são um degrau mais claros e se separam por filetes de 1px, nunca por sombra pesada. Existe um único acento, o âmbar, e ele tem função: a ação principal da tela, o item ativo do menu, o foco de um campo e o número que merece atenção. Verde, azul, âmbar de aviso e vermelho só dizem estado.

É feito para quem lê tabela e valor o dia todo: números pequenos e monoespaçados, cabeçalhos de coluna discretos, ações destrutivas isoladas e em contorno. A densidade é de trabalho, não de vitrine. O tom escuro foi uma decisão do dono do sistema ("faça sempre em tom escuro") e vale para todas as telas internas, inclusive no celular.

**Key Characteristics:**
- Grafite `#14161a` de fundo, painéis `#1b1e24`, filetes `#2c313a`; um degrau de elevação, sem sombras decorativas.
- Acento único âmbar `#f2a33a`; texto sobre ele é sempre grafite `#14161a`, nunca branco.
- Public Sans para interface; JetBrains Mono para números, códigos e pedidos, em tamanho discreto (valores de cartão 17px).
- Cantos curtos: 6px em controles, 8px em cartões e painéis, 10px em modal, 12px na gaveta.
- Estados nunca só por cor: sempre com texto, ícone ou ponto.
- Respeita `prefers-reduced-motion`.

## Colors

Neutros frios em grafite com um acento quente. O contraste entre eles é a identidade.

### Primary
- **Âmbar de Ação** (`#f2a33a`): botão principal, item ativo do menu, foco de campo, número em destaque (saldo), aba ativa, contadores. Texto sobre ele: **Grafite de Tinta** (`#14161a`).
- **Âmbar Fundo** (`rgba(242, 163, 58, 0.12)`) e **Anel Âmbar** (`rgba(242, 163, 58, 0.28)`): fundo do item ativo/hover e anel de foco de 3px.

### Neutral
- **Grafite de Fundo** (`#14161a`): página e também o fundo dos campos de entrada (mais escuros que o painel que os contém).
- **Painel** (`#1b1e24`): cartões, painéis, tabelas, modais.
- **Painel Elevado** (`#20242b`): cabeçalho de tabela, botão secundário, aba ativa, topo de gaveta.
- **Filete** (`#2c313a`) e **Filete Firme** (`#3a404b`): borda de cartão e divisória; borda de campo e botão.
- **Linha de Tabela** (`#23272e`) e hover de linha (`rgba(255,255,255,.035)`).
- **Tinta** (`#e8eaee`), **Tinta Média** (`#b4bac4`), **Tinta Suave** (`#8b93a1`): texto principal, secundário e rótulos.

### Semantic
- **Verde Entrada** (`#3ddc97`): sucesso, entradas, pago.
- **Âmbar Atenção** (`#f2a33a`): aviso e estoque no mínimo (mesma família do acento; distinguir por rótulo e ícone).
- **Vermelho Falta** (`#ff6b7a`): erro, saídas, falta, atraso.
- **Azul Informação** (`#6cb6ff`): informação.

### Selos de status
Pares `-bg` (tom translúcido) e `-fg` (texto claro da mesma cor) em `tema.css`: `--selo-neutro-*`, `--selo-aviso-*`, `--selo-info-*`, `--selo-ok-*`, `--selo-perigo-*`.

### Sidebar
- **Grafite Fundo** (`#101215`) com filete à direita; texto `#9aa1ad`, rótulos de grupo `#6b7280`; item ativo em Âmbar Fundo com texto âmbar.

### Named Rules
**The One Voice Rule.** O âmbar é o único acento. Se uma tela parece ter dois, um deles é erro. Cores de estado só dizem o que algo é.

**The Ink On Amber Rule.** Qualquer superfície âmbar leva texto grafite (`var(--on-primary)`). Texto branco sobre âmbar falha o contraste.

**The Variable Rule.** Cor nova nasce como variável em `tema.css`. Fundo claro, `#fff` de fundo ou `<style>` redefinindo `:root` numa página é dívida.

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

A casca é uma grade de duas colunas: sidebar fixa de 264px e conteúdo ocupando o resto, com uma faixa fina de 24px no topo (empresa e usuário). Cartões de indicador entram em grade automática (financeiro: 3 × 2); painéis e gráficos têm 18–22px de respiro; tabelas são compactas (8px × 10px por célula, uma linha por registro).

Responsivo: abaixo de 960px a sidebar vira gaveta com fundo escurecido; há ajustes em 1200, 1000, 700, 600 e 520px. O motorista usa `minhas_entregas.html` no celular, então toque e leitura em tela pequena contam.

## Elevation & Depth

Plano por padrão: superfícies com filete de 1px. A hierarquia vem de um degrau de tom (`#14161a` → `#1b1e24` → `#20242b`), não de sombra. Sombras só em camadas flutuantes (modal, toast, gaveta): `0 24px 48px -12px rgba(0,0,0,.7)`. O foco usa anel âmbar de 3px.

### Named Rules
**The Hairline Rule.** Separação é filete de 1px. Cartão não sobe, brilha nem projeta sombra ao passar o ponteiro; só a borda se firma.

## Shapes

Cantos curtos e consistentes: **6px** (controles, botões, linhas de ranking), **8px** (cartões, painéis, blocos, trilhos de alternância), **10px** (modal e janelas), **12px** (gaveta lateral, só no canto externo), **999px** (chips e selos). Bordas finas de 1px; não há faixa colorida lateral maior que 1px em cartão, linha ou alerta (estado se mostra por tom de fundo, ponto e texto).

## Components

### Buttons
- **Primário:** fundo âmbar, texto grafite, 14px/700, `padding 11px 18px`, raio 6px, sem sombra. Hover: mais claro (`brightness 1.1`). **Um primário por tela.**
- **Secundário:** Painel Elevado com filete firme; hover firma a borda.
- **Mini** (ação de linha): Painel Elevado, 13px/600, raio 6px; hover e ativo em Âmbar Fundo com texto âmbar. Variantes de estado em verde e azul.
- **Perigo:** contorno e tom vermelho translúcido, isolado dos vizinhos; nunca âmbar cheio.

### Chips e alternâncias
- **Chip:** pílula com filete; ativo = Filete Firme com texto claro.
- **Alternância (segmented):** trilho `#14161a` com filete, raio 8px; segmento ativo em Painel Elevado com texto âmbar.

### Cards / Containers
- **Cartão de indicador:** painel, raio 8px, `padding 12px 16px`; título 11.5px maiúsculas Tinta Suave, valor mono 17px. Ícone de 32px com fundo tonal do significado (verde entrada, vermelho saída/falta, âmbar mínimo).
- **Saldo / destaque:** mesmo cartão com borda âmbar a 50% e o número em âmbar. Não há cartão preenchido de âmbar.
- **Painel:** Painel com filete, raio 8px, título 17px.

### Inputs / Fields
- Fundo Grafite de Fundo (mais escuro que o painel), filete firme, raio 6px, altura mínima 42px; rótulo 12px/700 Tinta Média sem maiúsculas.
- **Foco:** borda âmbar + anel de 3px. **Somente leitura:** número em âmbar. **Desabilitado:** `#181a1f`, borda tracejada, cursor bloqueado.
- Busca com lupa clara à esquerda; seleção com seta própria; checkbox com `accent-color` âmbar; `color-scheme: dark` para controles nativos.

### Tables
- Cabeçalho em Painel Elevado, 11px/700 maiúsculas Tinta Suave. Células 13.5px, divisória `#23272e`, hover sutil.
- Linhas semânticas por tom de fundo (entrada verde 5%, saída vermelho 4,5%, falta vermelho 9%, mínimo âmbar 9%, selecionada âmbar 12%); sem faixa lateral.
- **Selos:** pílula 11.5px/700 com bolinha de 6px, usando os pares `--selo-*`.

### Navigation
- **Sidebar** `#101215` com grupos em maiúsculas pequenas; item de 14px/600; ativo em Âmbar Fundo com texto âmbar; subitens recuados com guia de 1px.
- **Abas:** 13.5px/700 em Tinta Suave, ativa em âmbar com sublinhado de 2px.

### Overlays
- **Modal:** raio 10px, filete, fundo `rgba(8,9,11,.62)`. **Gaveta:** topo em Painel Elevado com texto claro, filete à esquerda. **Toast:** raio 8px; sucesso `#14663a`, erro `#a8283a`, informação Painel Elevado com filete.

### Movimento
Transições de 0,12–0,25 s; entrada de página de 0,45 s. Com `prefers-reduced-motion`, quase zero.

## Do's and Don'ts

### Do:
- **Do** usar as variáveis de `tema.css` em toda cor, borda e raio novos (`var(--primary-color)`, `var(--white)` = superfície de painel, `var(--bg)` = fundo e campos, `var(--text-dark)`, `var(--border-color)`).
- **Do** manter **um botão primário por tela** (âmbar com texto grafite).
- **Do** usar `--font-mono` e `tabular-nums` em valores, quantidades e códigos.
- **Do** mostrar estado com cor **e** texto, ícone ou ponto.
- **Do** dar foco visível a todo campo e botão (borda âmbar + anel de 3px).
- **Do** carregar `tema.css` por último em toda página nova e subir o `?v=` em **todas** as páginas quando o tema mudar (um teste exige versão única).
- **Do** respeitar `prefers-reduced-motion` em qualquer animação nova.

### Don't:
- **Don't** usar fundo claro, `#fff` de fundo ou cor hexadecimal solta numa página, nem redefinir `:root` com variáveis do tema. Única exceção de hexadecimal: `#fff` para texto sobre tom escuro de estado (toast).
- **Don't** colocar texto branco sobre âmbar; use `var(--on-primary)`.
- **Don't** usar faixa colorida lateral (`border-left`/`right`) maior que 1px em cartão, linha ou alerta.
- **Don't** usar número grande de destaque, gradiente em texto, sombra decorativa nem cartão que sobe no hover.
- **Don't** criar um segundo acento de marca nem usar vermelho/verde como enfeite.
- **Don't** usar `var()` em canvas, atributos SVG ou strings de JS que desenham: ali a cor precisa ser literal (use o valor do tema).
- **Don't** reutilizar nomes de classe do `layout.js` (`grupo`, `menu-item`, `sb-*`) nas páginas sem escopo; `.grupo` já colidiu com o menu em `corte.html` e `corte_vidros.html`.
- **Don't** mostrar dinheiro a quem não tem `valores.ver` (regra de negócio, vale para toda tela nova).
