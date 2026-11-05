# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Equipe e parceiros da ELEGANCE (indústria de esquadrias, portas e serralheria em alumínio):
- **Escritório e vendas**, no PC, o dia todo: orçamentos, pedidos, clientes, financeiro, estoque, notas fiscais.
- **Produção e cortador**, em PC ou tablet na fábrica: planos de corte de perfis e vidros, etiquetas.
- **Motorista**, no celular: entregas do dia e baixa com foto do canhoto.
- **Cliente (portal) e representantes**, de fora da empresa: pedidos, financeiro e documentos próprios.

## Product Purpose
Versão web de um sistema de gestão que já existe em VB; lê e grava as mesmas tabelas do banco. Cobre orçamento e pedido com cálculo de preço de portas e serralheria, estoque, financeiro, custos e formação de preço, entregas, cortes, notas fiscais, gestão e portal do cliente. Sucesso: a equipe faz o trabalho do dia sem erro e o cliente enxerga o que é dele.

## Operating Context
- Uso intenso e repetitivo de tabelas, valores em reais, medidas e quantidades.
- Orçamentos e financeiro são as telas mais usadas e têm layout que a equipe já domina.
- Front-end em HTML/CSS/JS puro, sem build nem framework, publicado no GitHub Pages; API no Render.

## Capabilities and Constraints
- Permissões por perfil; quem não tem `valores.ver` não vê dinheiro.
- Cada página carrega `tema.css` por último; `DESIGN.md` descreve o visual atual.
- **A mudança é só de aparência**: funcionalidades, IDs e scripts das telas não mudam.
- **O layout de `orcamentos.html` e de `financeiro.html` deve ser preservado** (posição e organização dos blocos); só a aparência pode mudar.

## Brand Commitments
- A **logo Elegance** é o único elemento de identidade obrigatório. Cor da marca, fonte, formas e o restante podem mudar.

## Evidence on Hand
- Logo em `imagens/logo_elegance.png`. Sem fotos de produto nem depoimentos no repositório; não inventar.

## Product Principles
- Clareza e velocidade de leitura vêm antes de enfeite: é ferramenta de trabalho.
- Uma identidade só, aplicada igual em todas as telas, inclusive celular e portal do cliente.
- Dinheiro, medida e status precisam ser lidos de relance e sem ambiguidade.
- Mudar a aparência nunca pode custar funcionalidade.
