---
name: ELEGANCE — Sistema de gestão
description: Sistema de gestão web de esquadrias, portas e serralheria; neutros claros, um único acento vinho e sidebar escura.
colors:
  primary: "#9b1b30"
  primary-dark: "#6e0f20"
  primary-gradient-start: "#b02a3f"
  primary-gradient-end: "#7c1123"
  primary-tint: "rgba(155, 27, 48, 0.08)"
  primary-ring: "rgba(155, 27, 48, 0.16)"
  page-bg: "#f4f4f7"
  surface: "#ffffff"
  surface-2: "#f9f9fb"
  border: "#e7e7ee"
  border-strong: "#d9d9e3"
  text-dark: "#18151d"
  text-mid: "#4a4553"
  text-light: "#6b6473"
  success: "#12a150"
  warning: "#d98a00"
  danger: "#e0384b"
  info: "#2b7fd9"
  sidebar-bg: "#15111a"
  sidebar-bg-2: "#1e1824"
  sidebar-text: "#bdb5c4"
  sidebar-muted: "#6f6678"
typography:
  display:
    fontFamily: "'Plus Jakarta Sans', 'Segoe UI', system-ui, -apple-system, sans-serif"
    fontSize: "30px"
    fontWeight: 800
    lineHeight: 1.15
    letterSpacing: "-0.03em"
  headline:
    fontFamily: "'Plus Jakarta Sans', 'Segoe UI', system-ui, -apple-system, sans-serif"
    fontSize: "17px"
    fontWeight: 700
    letterSpacing: "-0.015em"
  indicator:
    fontFamily: "'Plus Jakarta Sans', 'Segoe UI', system-ui, -apple-system, sans-serif"
    fontSize: "28px"
    fontWeight: 800
    lineHeight: 1.1
    letterSpacing: "-0.03em"
    fontFeature: "tnum"
  body:
    fontFamily: "'Plus Jakarta Sans', 'Segoe UI', system-ui, -apple-system, sans-serif"
    fontSize: "14px"
    fontWeight: 500
  table-cell:
    fontFamily: "'Plus Jakarta Sans', 'Segoe UI', system-ui, -apple-system, sans-serif"
    fontSize: "13.5px"
    fontWeight: 400
    lineHeight: 1.35
  label:
    fontFamily: "'Plus Jakarta Sans', 'Segoe UI', system-ui, -apple-system, sans-serif"
    fontSize: "12px"
    fontWeight: 700
    letterSpacing: "0.06em"
  table-head:
    fontFamily: "'Plus Jakarta Sans', 'Segoe UI', system-ui, -apple-system, sans-serif"
    fontSize: "11px"
    fontWeight: 700
    letterSpacing: "0.04em"
rounded:
  mini: "9px"
  sm: "10px"
  md: "14px"
  lg: "16px"
  modal: "18px"
  drawer: "20px"
  pill: "999px"
spacing:
  card-gap: "18px"
  card-padding: "20px 22px"
  panel-padding: "24px"
  block-gap: "28px"
  cell-padding: "8px 10px"
  sidebar-width: "264px"
components:
  button-primary:
    backgroundColor: "{colors.primary-gradient-end}"
    textColor: "{colors.surface}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "11px 18px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-dark}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "11px 18px"
  button-mini:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-mid}"
    rounded: "{rounded.mini}"
    padding: "8px 12px"
  button-mini-hover:
    backgroundColor: "{colors.primary-tint}"
    textColor: "{colors.primary}"
  chip:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-mid}"
    rounded: "{rounded.pill}"
    padding: "7px 14px"
  chip-active:
    backgroundColor: "{colors.text-dark}"
    textColor: "{colors.surface}"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.lg}"
    padding: "20px 22px"
  panel:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.lg}"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-dark}"
    rounded: "{rounded.sm}"
    padding: "10px 12px"
    height: "42px"
  table-head:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text-light}"
    typography: "{typography.table-head}"
    padding: "10px 10px"
  table-cell:
    textColor: "{colors.text-dark}"
    typography: "{typography.table-cell}"
    padding: "8px 10px"
  badge:
    rounded: "{rounded.pill}"
    padding: "3px 10px"
  modal:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.modal}"
---

# Design System: ELEGANCE — Sistema de gestão

> Fonte única das regras visuais. A implementação vive em `tema.css` (carregado por último em todas as páginas internas) e este arquivo descreve o que ele já faz. Os valores do cabeçalho acima são normativos; o texto explica como aplicá-los.

## Overview

**Creative North Star: "O Balcão Elegante"**

O sistema é um balcão de atendimento bem cuidado: superfícies brancas e limpas sobre um fundo cinza-lavanda muito claro, uma única cor de marca (o vinho Elegance) e uma sidebar escura que ancora a navegação. É uma ferramenta de trabalho diário para escritório, vendas e produção, então a densidade é de quem lê tabela e número o dia todo, mas com o acabamento refinado de quem atende cliente: cartões suaves, sombras leves, cantos generosos e um brilho discreto no que importa.

O vinho aparece com parcimônia e sempre com função: a ação principal da tela, o item selecionado, o número do pedido, o foco de um campo. Todo o resto é neutro. Cores de estado (verde, âmbar, vermelho, azul) são só para significado, nunca para decoração.

O toque é tátil e confiante: os elementos clicáveis respondem ao ponteiro (sobem um pouco, ganham sombra ou anel), mas o movimento é curto e some para quem pede menos movimento ao sistema.

**Key Characteristics:**
- Um único acento (vinho `#9b1b30`) sobre neutros claros; sidebar escura como contraste fixo.
- Fonte única, Plus Jakarta Sans, com peso 700–800 nos títulos e números.
- Cantos arredondados em escala: 9, 10, 14, 16, 18 e 20 px; pílula (999px) para chips e selos.
- Cartões e painéis brancos com borda fina e sombra leve; elevação só como resposta ao ponteiro.
- Números alinhados em colunas (`tabular-nums`); tabelas compactas, uma linha por registro.
- Respeita `prefers-reduced-motion`.

## Colors

Neutros frios com um acento vinho quente; o contraste entre eles é a identidade.

### Primary
- **Vinho Elegance** (`#9b1b30`): cor da marca. Texto de destaque (número do pedido, total do orçamento), borda e anel de foco, aba ativa, item selecionado.
- **Vinho Profundo** (`#6e0f20`): par escuro do vinho, para o extremo do degradê e estados pressionados.
- **Degradê Vinho** (`linear-gradient(135deg, #b02a3f 0%, #7c1123 100%)`): só em superfícies de ação ou destaque: botão primário, cartão de saldo, topo da gaveta, numeração de etapa, atalho em destaque.
- **Véu Vinho** (`rgba(155, 27, 48, 0.08)`) e **Anel Vinho** (`rgba(155, 27, 48, 0.16)`): fundo de hover/ativo suave e anel de foco de 4px.

### Neutral
- **Lavanda Névoa** (`#f4f4f7`): fundo da página, com dois halos radiais muito sutis (vinho no canto superior direito, azul no inferior esquerdo).
- **Branco Balcão** (`#ffffff`): cartões, painéis, campos, modais.
- **Cinza Papel** (`#f9f9fb`): cabeçalho de tabela, campo somente leitura, hover de lista, blocos internos.
- **Linha Fina** (`#e7e7ee`) e **Linha Firme** (`#d9d9e3`): borda de cartão e divisória; borda de campo e botão secundário.
- **Tinta** (`#18151d`): texto principal e chip ativo.
- **Tinta Média** (`#4a4553`) e **Tinta Suave** (`#6b6473`): rótulos, texto secundário, cabeçalhos de tabela, legendas.

### Semantic
- **Verde Entrada** (`#12a150`): sucesso, entradas, pago, "recebido".
- **Âmbar Atenção** (`#d98a00`): estoque no mínimo, avisos.
- **Vermelho Falta** (`#e0384b`): erro, saídas, falta, atraso.
- **Azul Informação** (`#2b7fd9`): informação e estados neutros-ativos (por exemplo referência).

### Selos de status
Pílulas de fundo claro com texto escuro da mesma família, definidas como variáveis em `tema.css`: `--selo-neutro-*`, `--selo-aviso-*` (âmbar), `--selo-info-*` (azul), `--selo-ok-*` (verde) e `--selo-perigo-*` (vermelho), cada uma com `-bg` e `-fg`. Toda tela nova usa esses pares em vez de escolher tons.

### Sidebar
- **Noite Ameixa** (`#15111a` → `#1e1824`): fundo da sidebar, da faixa do topo e da barra de seleção.
- **Cinza Ameixa** (`#bdb5c4`) e **Ameixa Apagada** (`#6f6678`): texto e rótulos de grupo na sidebar.

### Named Rules
**The One Voice Rule.** O vinho é a única cor de marca. Se uma tela parece ter dois acentos, um deles é erro. Cores de estado só dizem o que algo é (pago, falta, atenção), nunca enfeitam.

**The Variable Rule.** Cor nova nasce como variável em `tema.css` (`:root`). Valor hexadecimal solto dentro de uma página é dívida: use `var(--primary-color)`, `var(--text-dark)`, `var(--border-color)` e semelhantes.

## Typography

**Fonte única:** Plus Jakarta Sans (Google Fonts, pesos 400–800), com `'Segoe UI', system-ui, -apple-system, sans-serif` de reserva. Os ícones Font Awesome são exceção e mantêm a própria fonte.

**Caráter:** moderna, redonda e firme; os pesos altos (700–800) com espaçamento levemente negativo dão presença aos títulos e números sem precisar de tamanho grande.

### Hierarchy
- **Display** (800, 30px, 1.15, -0.03em): título de página (`.welcome-title`).
- **Headline** (700, 17px, -0.015em): título de painel, tabela e gráfico.
- **Indicator** (800, `clamp(21px, 1.75vw, 28px)`, 1.1, -0.03em, números tabulares): valor grande dos cartões de indicador; nunca quebra linha.
- **Body** (500–700, 14px): campos, botões, texto corrente. Botões e campos usam 14px.
- **Table cell** (13.5px, 1.35): células de tabela; texto longo vira "…" e aparece inteiro ao passar o mouse.
- **Label** (700, 12px): rótulo de campo (sem maiúsculas), subtítulo de cartão de indicador (maiúsculas, `0.06em`), legendas e notas com 12–12.5px em Tinta Suave.
- **Table head** (700, 11px, maiúsculas, `0.04em`, Tinta Suave): cabeçalho de coluna.

### Named Rules
**The Tabular Numbers Rule.** Todo valor em dinheiro, quantidade ou total usa `font-variant-numeric: tabular-nums` para as colunas se alinharem.

**The One Family Rule.** Uma única família de fonte em todo o sistema. Hierarquia vem de peso, tamanho e caixa, nunca de uma segunda fonte.

## Layout

A casca do app é uma grade de duas colunas: sidebar fixa de 264px à esquerda e área de conteúdo à direita, com uma faixa fina de 24px no topo (escura, com nome da empresa e usuário). O conteúdo ocupa toda a largura restante; não há contêiner centralizado.

Os blocos se empilham com 28px entre títulos e grupos e 18px entre cartões. Indicadores usam grade automática (`repeat(auto-fit, minmax(175px, 1fr))`); o financeiro usa grade fixa 3 × 2 (2 colunas abaixo de 700px). Painéis e gráficos têm 24px de respiro; cartões de indicador 20px × 22px. Tabelas são compactas: 8px × 10px por célula, uma linha por registro.

Responsivo: abaixo de 960px a sidebar vira gaveta (desliza da esquerda com fundo escurecido); há ajustes adicionais em 1200, 1000, 700, 600 e 520px. O sistema também é usado no celular pelo motorista (entregas), então toque e leitura em tela pequena contam.

## Elevation & Depth

Híbrido: superfícies brancas planas com borda fina, e sombras leves que aparecem no repouso dos cartões e crescem como resposta ao ponteiro.

### Shadow Vocabulary
- **Leve** (`0 1px 2px rgba(20,16,28,.04), 0 1px 3px rgba(20,16,28,.05)`): cartões, painéis, botão secundário, campos em repouso.
- **Média** (`0 4px 16px -4px rgba(20,16,28,.10), 0 2px 6px -2px rgba(20,16,28,.06)`): hover de cartão e atalho.
- **Pesada** (`0 24px 48px -12px rgba(20,16,28,.22)`): modal e toast.
- **Brilho Vinho** (`0 6px 16px -6px rgba(155,27,48,.55)`; no hover `0 10px 22px -8px rgba(155,27,48,.7)`): só no botão primário e em cartão de destaque (`0 16px 32px -14px rgba(155,27,48,.65)`).
- **Anel de foco** (`0 0 0 4px rgba(155,27,48,.16)`): campo em foco e cartão filtrado ativo.

### Named Rules
**The Lift On Touch Rule.** Cartão e botão primário sobem 1–2px (`translateY`) e ganham sombra ao passar o ponteiro; em repouso ficam quase planos. Elevação é resposta, não decoração.

## Shapes

Cantos generosos e consistentes, em escala fixa:

- **9–10px** (`--radius-sm`): botões, campos, botões mini.
- **12–14px**: blocos internos (seção de item de orçamento), ícones em caixa (12px), toast (12px).
- **16px** (`--radius`): cartões, painéis, gráficos, atalhos.
- **18px**: modal. **20px**: gaveta (cantos esquerdos).
- **999px**: chips, selos de status, contadores.

Bordas finas de 1px em Linha Fina (cartões) ou Linha Firme (campos e botões secundários). A aba ativa usa sublinhado de 2px em vinho, não caixa.

## Components

### Buttons
- **Primário:** degradê vinho, texto branco, borda `#7c1123`, brilho vinho; 14px/700, `padding 11px 18px`, raio 10px. Hover sobe 1px e aumenta a sombra; ativo volta ao chão. **Um primário por tela**: a ação principal.
- **Secundário:** branco, borda Linha Firme, sombra leve; hover vai a Cinza Papel.
- **Mini** (ações em linha de tabela): branco com borda, 13px/600, `padding 8px 12px` (4px 9px dentro de tabela), raio 9px. Hover e estado ativo: borda e texto vinho com Véu Vinho. Variantes de estado: `auto-on` em verde, `ref-on` em azul.
- **Filtro** (`.filter-btn`): Véu Vinho com texto vinho; no hover inverte para vinho cheio.

### Chips e alternâncias
- **Chip:** pílula branca com borda, 13px/600; ativo = fundo Tinta com texto branco.
- **Alternância (segmented):** trilho cinza (`#ececf2`, raio 12px, 4px de respiro); o segmento ativo vira branco com texto vinho e sombra leve. Usado em frentes de produto, tipo, situação e mês.

### Cards / Containers
- **Cartão de indicador:** branco, raio 16px, `padding 20px 22px`; faixa vinho de 3px no topo que só aparece no hover. Ícone de 40px em caixa de raio 12px com fundo vinho suave. Título em 12px maiúsculas Tinta Suave; valor em Indicator.
- **Cartão de destaque** (`.saldo`): degradê vinho, texto branco, sombra vinho; um por tela, para o número mais importante.
- **Painel:** branco, borda fina, raio 16px, sombra leve; título Headline com contador em pílula Véu Vinho.
- **Variantes de ícone por significado:** entrada (verde), saída/falta (vermelho), mínimo (âmbar), sempre em 10–12% de opacidade.

### Inputs / Fields
- **Estilo:** branco, borda Linha Firme, raio 10px, altura mínima 42px, `padding 10px 12px`, sombra mínima. Rótulo acima: 12px/700 Tinta Média, sem maiúsculas.
- **Hover:** borda um tom mais escura. **Foco:** borda vinho + anel de 4px; sem contorno do navegador.
- **Somente leitura:** fundo Cinza Papel, texto vinho 700 (valor calculado). **Desabilitado:** fundo `#f4f4f6`, borda tracejada, cursor bloqueado.
- **Busca:** campo com lupa à esquerda (40px de recuo). **Seleção:** seta própria à direita; **checkbox:** `accent-color` vinho, 17px.

### Tables
- Cabeçalho em Cinza Papel, 11px/700 maiúsculas Tinta Suave, linha inferior fina. Células 13.5px, divisória `#f0eff4`, última linha sem divisória.
- Hover de linha: `#faf6f7`. Linha selecionada: Véu Vinho + marcador vinho de 3px à esquerda.
- Linhas semânticas: entrada (verde 4,5%), saída (vermelho 4%), falta (vermelho 7% + marcador), mínimo (âmbar 8% + marcador), inativo (cinza). Números de pedido e cliente em vinho/700.
- **Selos de status:** pílula 11.5px/700 com bolinha de 6px na cor do texto.

### Navigation
- **Sidebar escura de 264px** com grupos rotulados em maiúsculas pequenas (Comercial, Gestão…), item 13.5px/600 em Cinza Ameixa; item ativo com fundo vinho e ícone à esquerda; subitens recuados com linha-guia. Abaixo de 960px vira gaveta com fundo escurecido.
- **Abas:** 13.5px/700 em Tinta Suave, ativa em vinho com sublinhado de 2px.

### Overlays
- **Modal:** raio 18px, borda fina, sombra Pesada, fundo `rgba(21,17,26,.45)` com desfoque de 3px.
- **Gaveta:** painel lateral com topo em degradê vinho e raio 20px à esquerda.
- **Toast:** pílula de raio 12px com ícone circular (✓, !, i); sucesso `#0f8a45`, erro `#d22f42`, informação `#241f2b`.
- **Carregamento:** véu translúcido com desfoque e spinner vinho.

### Movimento
Transições curtas e padrão: 0,12–0,25 s com `ease`; entrada de página de 0,45 s (`cubic-bezier(.2,.7,.2,1)`, sobe 10px). Com `prefers-reduced-motion`, as transições e animações se reduzem a praticamente zero.

## Do's and Don'ts

### Do:
- **Do** usar as variáveis de `tema.css` (`var(--primary-color)`, `var(--border-color)`, `var(--radius)`…) em toda cor, borda e raio novos.
- **Do** manter **um botão primário por tela** (degradê vinho); ações secundárias em branco com borda, ações de linha em botão mini.
- **Do** usar `tabular-nums` e alinhar à direita colunas de valor, quantidade e total.
- **Do** mostrar significado de estado com cor **e** texto/ícone (selo com bolinha, rótulo), nunca só com cor.
- **Do** dar foco visível a todo campo e botão (borda vinho + anel 4px).
- **Do** carregar `tema.css` por último em toda página nova, para herdar fonte, casca e componentes.
- **Do** respeitar `prefers-reduced-motion` em qualquer animação nova.

### Don't:
- **Don't** colocar valores hexadecimais soltos nem `<style>` com cor própria numa página, nem redefinir `:root` com as variáveis do tema. Única exceção: `#fff` para texto sobre superfície colorida (vinho, verde, vermelho). A paleta antiga (`#8B0000`, `#600000`, cinzas do Bootstrap, gradiente azul-acinzentado do fundo) já saiu das páginas; tons de alerta avulsos que ainda existem (`#c0392b`, `#f5a08a`, `#fff4e0`, `#b8620b` e semelhantes) são dívida a unificar nos pares de selo, não padrão.
- **Don't** usar `var()` em canvas, atributos SVG (`fill="..."`) ou strings de JS que desenham: ali a cor precisa ser literal, então leia a variável com `getComputedStyle` ou documente o valor.
- **Don't** usar outra família de fonte nem um segundo acento de marca.
- **Don't** usar o degradê vinho em superfície grande ou repetida; ele é para ação e destaque.
- **Don't** usar vermelho/verde/âmbar como decoração; eles significam erro/saída, sucesso/entrada e atenção.
- **Don't** criar raios, sombras ou espaçamentos fora da escala acima.
- **Don't** mostrar dinheiro a quem não tem a permissão `valores.ver` (regra de negócio, vale para toda tela nova).
- **Don't** deixar texto longo quebrar linha dentro de tabela compacta; corte com "…" e mostre o texto inteiro ao passar o mouse (exceção: descrição principal do item do orçamento).
