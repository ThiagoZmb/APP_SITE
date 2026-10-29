# Pesos estimados de perfis e puxadores (kg/m)

Estimativa a partir do desenho técnico da seção transversal da Alternativa Componentes. **Não são pesos oficiais**: nem o catálogo nem a lista de preços trazem kg/m. Servem para preencher `web_pesos` com origem `estimado_desenho` até haver peso medido/oficial. JSON pronto para importar: `docs/pesos_estimados_perfis.json` (nada foi importado).

## Método e premissas

- Densidade do alumínio: 2,7 g/cm³. `kg/m = área_mm² × 2,7 / 1000`.
- Fonte do desenho: PNG "Desenho técnico" da página do produto (`https://www.alternativa.ind.br/produto/<código>`) ou, quando a página não existe/tem resolução baixa, o catálogo local `arquivos_gerais/CATÁLOGO INDÚSTRIA 2026 - ALTERNATIVA.pdf` (desenho vetorial, renderizado a 600-800 dpi só no recorte do perfil).
- Os desenhos são **seção preenchida** (cinza-escuro), não só contorno. Área = nº de pixels escuros (luminosidade < 110, pouco saturados, com transparência ignorada) do maior componente conexo; vidro (azul), fita (verde), cunha bege/cinza dos puxadores, cotas e textos ficam de fora (são componentes separados ou mais claros).
- Escala: razão pixels/mm obtida das cotas do próprio desenho (largura e altura totais). As duas cotas concordaram em todos os casos (diferença menor que 1,5%). Resolução de 10 a 17 px/mm em todos os usados.
- Sanidade: todos os valores ficaram entre 0,19 e 0,74 kg/m; os perfis estruturais de porta ficaram entre 0,31 e 0,45.
- Faixa de erro: ±6% onde a escala é ≥ 10 px/mm (sensibilidade medida variando o limiar de cor de 80 a 150: até ±4%, mais a incerteza de borda/cota); ±10% nos marcados "média". O erro maior possível é sistemático: o desenho é esquemático (pode omitir raios, rebarbas, tolerância de extrusão), então o peso real tende a divergir uns poucos %.
- Scripts de contagem ficaram só no rascunho (fora do projeto); nada do sistema ou do banco foi alterado.

## Estimados (ordem de uso; 3345 primeiro = 913 itens)

| Tipo | Nome no sistema | Fonte | Área mm² | kg/m | Faixa | Confiança | Observação |
|---|---|---|---|---|---|---|---|
| perfil | 3345 | site /produto/3345 | 152,4 | **0,412** | 0,39 a 0,44 | alta | 19 x 45 mm, tubo com aba de vidro de 4 mm |
| perfil | 3445 | site /produto/3445 | 151,6 | **0,409** | 0,38 a 0,43 | alta | 15,6 x 45 mm |
| perfil | 1036 | site /produto/1036 | 134,8 | **0,364** | 0,34 a 0,39 | alta | 18,9 x 45 mm |
| perfil | 3025 | site /produto/3025 (imagem JPEG) | 114,1 | **0,308** | 0,28 a 0,34 | média | 19,5 x 23 mm; fonte é JPEG, borda mais difusa (área varia de 106 a 115 conforme o limiar) |
| perfil | 3026 | site /produto/3026 | 132,1 | **0,357** | 0,34 a 0,38 | alta | 21,8 x 23 mm |
| perfil | 3042 | site /produto/3042 | 160,9 | **0,434** | 0,41 a 0,46 | alta | 18 x 41,9 mm |
| perfil | 3446 | catálogo p. 6 (600+ dpi, vetorial) | 166,9 | **0,451** | 0,42 a 0,48 | alta | 18 x 45 mm. A imagem do site (591 px, 6,5 px/mm) dava 0,50; usei a do catálogo por ter 17 px/mm |
| perfil | Thin LED 1805 | catálogo p. 45 (800 dpi); site /produto/thin-1805 | 129,5 | **0,350** | 0,33 a 0,37 | alta | 20 x 27,5 mm. A imagem do site tem só 2,8 px/mm (deu 0,30, descartada) |
| perfil | Arezzo | catálogo p. 111 (índice ilustrado; site /produto/arezzo = 404) | 76,5 | **0,207** | 0,19 a 0,23 | média | 39,2 x 13,3 mm; é o perfil puxador da linha "Arezzo & Linz" (cód. 1418); desenho pequeno, mas vetorial |
| puxador | 2018 E | site /produto/2018e | 82,3 | **0,222** | 0,21 a 0,24 | alta | 32,3 x 12,8 mm |
| puxador | 2019 | catálogo p. 111 ("Treviso Sobreposto", 37 x 13); confere com site /produto/2019 | 85,2 | **0,230** | 0,22 a 0,25 | alta | A imagem do site (5,6 px/mm) deu 0,235, igual dentro do erro; usado o valor do catálogo |
| puxador | 8015 | site /produto/8015 | 71,4 | **0,193** | 0,18 a 0,21 | alta | 34,7 x 15 mm; cunha bege/cinza do desenho (painel) excluída |
| puxador | Slim | site /produto/slim | 85,1 | **0,230** | 0,22 a 0,25 | alta | 34 x 12,8 mm |
| puxador | 5015 | site /produto/5015 | 78,9 | **0,213** | 0,20 a 0,23 | alta | 36,1 x 16,6 mm |
| puxador | 3180 T | catálogo p. 7 (600 dpi); site /produto/3180t = 404 | 264,2 | **0,713** | 0,64 a 0,78 | média | Seção COMPLETA "perfil estrutural com puxador" (78,2 x 19,6 mm), não só o puxador |
| puxador | 3186 T | site /produto/3186t | 249,2 | **0,673** | 0,61 a 0,74 | média | Seção COMPLETA com aba (83,5 x 20,6 mm), não só o puxador |
| puxador | 3180 | site /produto/3180 | 273,2 | **0,738** | 0,67 a 0,81 | média | Seção COMPLETA (77,2 x 19 mm), não só o puxador |

Atenção nos três últimos (3180, 3180 T, 3186 T): o desenho inclui o corpo estrutural (equivalente ao 1045/2345/3345, cerca de 0,41 kg/m) mais o puxador. Se o sistema já soma o peso do perfil de corpo (ex.: 3345) por outra linha, somar também estes valores contaria o corpo duas vezes; a parte só-puxador seria da ordem de 0,26 a 0,33 kg/m (diferença aproximada, o corpo de cada um tem altura levemente diferente de 45 mm). Confirmar como o sistema usa esses nomes antes de importar. Confiança "média" também porque "3180 T" não tem página no site; usei o desenho do catálogo.

## Não estimados

| Nome no sistema | Motivo |
|---|---|
| Sottile | É nome de linha, não de um perfil: o catálogo tem Sottile 1811 a 1817 (p. 50), cada um com seção diferente. Sem saber qual código o sistema usa, não há desenho único. Não existe página `/produto/sottile`. |
| Evidence | Idem: linha com vários perfis (Evidence 9565, 9566, 9567, 9569, 9570, 9571, 9572, 9573, 9577, 9579, 9597, 9598; p. 22 a 28). Sem `/produto/evidence`. |
| Evidence Slim | Não encontrado: nem site (`/produto/evidence-slim` = 404) nem catálogo citam "Evidence Slim". |
| 2010/20 | Não encontrado: sem página no site (`/produto/2010`, `/produto/2010-20` = 404) e sem ocorrência no catálogo. |
| 1013 | Não encontrado no site (404) nem no catálogo. |
| 1019 | Não encontrado no site (404) nem no catálogo. |

Se o sistema usar códigos específicos para Sottile/Evidence (ex.: 1811, 9566), dá para estimar cada um do mesmo jeito.

## Resumo

17 de 23 estimados (9 perfis, 8 puxadores); 6 não estimados. Confiança: 12 alta, 5 média (3025, Arezzo, 3180, 3180 T, 3186 T), nenhuma baixa.
