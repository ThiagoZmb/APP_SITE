# Changelog

## 0.2.0 — 2026-10-26

Fase 1b: montagem de itens no formato da tela de orçamentos/pedidos, com núcleo genérico e domínio por configuração.

Motivo: transformar o projeto técnico validado em itens que o sistema web consome, sem duplicar regras de fabricação. Aprovado por: pendente.

Decisões do usuário (2026-10-26) registradas:

- **D3 = (b)**: a skill NÃO aplica descontos de fabricação (`DESCONTO_VIDRO`, `DESC_PERF_PUX`, `DESCONTO_ALTURA`); ficam no banco e são aplicados pelo sistema web/VB. A skill entrega só medidas de folha/vão lidas do projeto. Não chama `medidasVidro`/`medidasPerfil`, não cria configuração de descontos e não reescreve nada de `calculo/engenharia.js`. Ver `references/regras-fabricacao.md`.
- **D4**: a saída para a fábrica é JSON no formato do item da tela, para lançar no pedido. Ver `references/esquadrias-aluminio.md` (formato com arquivo:linha e divergências).
- **D5**: barra comercial de 6000 mm (para a Fase 2) em `config/barras-comerciais.json`; `kerfMm` e `sobraMinimaMm` são `null`, pendentes de definição. Plano de corte não implementado.
- **D6**: amostras de clientes fora do git (`amostras_pdf/` no `.gitignore`).
- Origem padrão dos projetos: `C:\Programa Elegance\Projetos_PDF\` (documentada; a skill não lê nem escreve nela).

Novidades:

- `scripts/lib/mapear.mjs` (núcleo, não conhece "porta"): `mapearItens`, `montarSaida`, `validarMapa`. Só valor `confirmado` entra no item; `inferido` vira `sugestoes`; ausente e conflitante geram pendência; tradução sem correspondência e valor de tipo/faixa inválido geram pendência; `rastreio[destino]` aponta o id do valor de origem.
- `config/regras-por-dominio/portas-aluminio.json`: mapa do domínio (frente, qtd, medidas, `detalhes.*`, furos), metadados com responsável pendente de aprovação.
- `scripts/montar-itens.mjs` (CLI; exit 0 ok, 1 projeto inválido, 2 uso errado) e `schemas/itens-tela.schema.json` (draft-07).
- Testes: golden `tests/golden/itens-tela-exemplo.json`, consumo pela web (`folhasDoItem` + `agruparFolhas` via `createRequire`), domínio fictício `guarda-corpo-teste` rodando o mesmo núcleo.
- Desvio de arquitetura: o `calcular-pecas.mjs` planejado virou `montar-itens.mjs`, porque pela D3 o cálculo de peças fica no sistema web.

Não incluído: extração de PDF (aguarda poppler) e plano de corte.

## 0.1.0 — 2026-10-26

Primeira versão: núcleo comum, independente de domínio e de PDF.

- Contrato `ValorRastreavel` e schema `projeto-tecnico` 1.0.0 (JSON Schema draft-07).
- Validação (schema + 7 regras semânticas) com erros apontando o caminho JSON.
- Construtores `confirmado`, `inferido`, `ausente`, `conflitante`, `calculado` e `confirmarHumano`.
- Unidades: conversão exata para mm (mm, cm, m, pol), números pt-BR com detecção de ambiguidade, leitura de cotas.
- Verificação cruzada: soma de cotas (tolerância 0 mm, pendente de aprovação) e contagens.
- Detecção de texto suspeito (injeção de prompt) em texto de PDF.
- Relatório em Markdown determinístico e CLIs `validar-projeto.mjs` e `gerar-relatorio.mjs`.
- Não incluído: extração de PDF, regras de portas, cálculo de peças, plano de corte.
