# Cotas, unidades e verificação cruzada

## Unidade interna

Todo comprimento é guardado em **mm**. Valor de comprimento em outra unidade é erro de validação. A conversão acontece na entrada, com `paraMm(valor, unidade)` (`scripts/lib/unidades.mjs`).

- Unidades aceitas: `mm`, `cm`, `m`, `pol` (1 pol = 25,4 mm exato). Qualquer outra lança erro.
- **Sem arredondamento.** A conversão usa aritmética decimal exata (BigInt), então `paraMm(1.1, 'm')` dá `1100`, não `1100.0000000000002`. Arredondar para fabricação é decisão de fase futura, nunca da conversão.

## Números pt-BR

`lerNumeroBr(texto)` devolve `{ valor, ambiguo, motivo }`:

| Texto | Resultado |
|---|---|
| `2100` | 2100 |
| `2,10` | 2,1 (vírgula é sempre decimal) |
| `1.234,5` | 1234,5 |
| `1.234.567` | 1234567 (dois pontos só podem ser milhar) |
| `2.100` | **ambíguo**: `valor=null`, `candidatos=[2100, 2.1]` |
| `abc`, `1,234.5` | `valor=null` com `motivo` |

"2.100" pode ser 2100 (milhar) ou 2,1 (decimal). **Nunca se adivinha**: a pendência `unidade_ambigua` fica para um humano resolver (conferir no desenho).

## Cotas com ou sem unidade

`interpretarCota(texto, { unidadeDeclarada })` devolve `valorMm`, `estadoUnidade` e `pendencias`.

| Situação | `estadoUnidade` | Pendência |
|---|---|---|
| Unidade no texto (`210 cm`, `2,1 m`, `2100mm`) | `confirmado` | não |
| Sem unidade, prancha declara a unidade (`unidadeDeclarada: 'mm'`) | `confirmado` | não |
| Sem unidade, declarada **marcada como inferida** (`{ unidade: 'mm', inferida: true }`) | `inferido` | `unidade_ambigua` |
| Sem unidade e sem nenhuma declarada | `ausente`, `valorMm=null` | `unidade_ambigua` |
| Número ambíguo ou unidade desconhecida | `valorMm=null` | `unidade_ambigua` |

Decisão: o estado "inferido" só existe quando alguém declarou explicitamente que a unidade da prancha é suposição. Cota sem nenhuma pista de unidade **não é convertida**; assumir mm seria palpite. A pendência `unidade_ambigua` também cobre a ambiguidade decimal/milhar, pois ambas mudam a ordem de grandeza.

O valor de uma cota vinda de unidade inferida deve virar `ValorRastreavel` com `estado=inferido` e entrar em `pendencias`.

## Verificação cruzada

`scripts/lib/cruzada.mjs`:

- `verificarSoma(cota, { toleranciaMm })`: compara a soma das `parciais` com o `total`. Se `|soma - total| > tolerância`, gera pendência `divergencia` com as páginas de origem (`paginas`). Padrão da tolerância: **0 mm** (`config/nucleo.json`, `tolerancias.somaCotasMm`), até um responsável aprovar outro valor. Diferenças abaixo de 1e-9 mm são ruído de ponto flutuante, não tolerância.
- `verificarContagem(contagem)`: `declarado` diferente de `contado` gera `divergencia`.
- Se o total ou alguma parcial/contagem está `ausente` ou `conflitante`, **nunca se assume 0**: gera pendência dizendo que a verificação não pôde ser feita (tipo `ausente` ou `conflitante`).
- `aplicarVerificacoes(doc, config)` devolve um documento novo com essas pendências acrescentadas (ids `pend-soma-<cota>` e `pend-contagem-<contagem>`), sem duplicar e sem alterar o original.

## Projetos de arquitetura: cotas em cm sem unidade (decisão de 2026-10-26)

As amostras reais (projeto executivo de marcenaria) trazem cotas em **centímetros com vírgula decimal** (`206,3`, `79,5`) e **a unidade não aparece escrita**; as escalas são 1/50, 1/25 e 1/5. Decisão: quando a convenção de projeto de arquitetura e a escala indicam cm, a leitura usa `interpretarCota(texto, { unidadeDeclarada: { unidade: 'cm', inferida: true } })`.

- O valor sai em mm (`206,3` vira `2063`), com `estadoUnidade: 'inferido'` e a pendência `unidade_ambigua`.
- O `ValorRastreavel` fica `inferido` (e, vindo de leitura visual, o método é `leitura_visual`). **Nunca `confirmado` sem humano**: quem confirma é a pessoa, com `confirmar-valores.mjs --ids`, depois de conferir a unidade no desenho.
- Resolver a pendência `unidade_ambigua` é confirmar o valor: `confirmar-valores` remove a pendência quando todos os valores citados nela foram confirmados.
- Se a escala ou o contexto não permitem concluir que é cm, **não infira**: valor `ausente` + pendência, ou a pessoa informa com `--informar` (aceita `206,3 cm`).

`--informar` em campo de comprimento converte para mm (a unidade do campo é preservada): `79,5` informa 79,5 mm; `79,5 cm` informa 795 mm; `2.100` é recusado por ambiguidade.
