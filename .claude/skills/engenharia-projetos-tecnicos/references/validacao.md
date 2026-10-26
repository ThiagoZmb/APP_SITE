# Validação do projeto-tecnico

`validarProjeto(doc)` (`scripts/lib/validacao.mjs`) devolve `{ ok, erros: [{ caminho, mensagem }] }`. Faz duas etapas: **schema** (estrutura, via ajv) e **regras semânticas**. As semânticas só rodam se o schema passar, para não gerar erros em cascata. O `caminho` aponta o lugar exato no JSON, por exemplo `itens[0].dimensoes.altura.unidade`.

## Contrato ValorRastreavel

Todo valor extraído ou calculado tem:

| Campo | Significado |
|---|---|
| `id` | Texto único no documento |
| `valor` | número, texto ou `null` |
| `unidade` | `mm`, `un`, `kg`, `m2` ou `null` |
| `estado` | `confirmado`, `inferido`, `ausente`, `conflitante` |
| `confianca` | 0 a 1 |
| `metodo` | `texto_vetorial`, `ocr`, `leitura_visual`, `calculado`, `configuracao` |
| `origem` | `arquivo`, `pagina` (inteiro >= 1 ou `null`), `trecho`; opcionais `regiao` `[x,y,w,h]`, `chave`, `entradas` |
| `regra` | obrigatória se `metodo=calculado` |
| `confirmacao` | `{por, em, nota}`: quem confirmou, data ISO, observação |
| `candidatos` | obrigatório e com 2 ou mais itens se `conflitante` |

## Estados

- **confirmado**: valor lido diretamente (texto vetorial) ou confirmado por humano. Com `ocr` ou `leitura_visual` só vale com `confirmacao`.
- **inferido**: valor provável, mas não garantido. Vai para `pendencias` e aparece no relatório como "INFERIDO — conferir". Com `confirmacao` humana registrada deixa de exigir pendência (use `confirmarHumano`, que o torna `confirmado`).
- **ausente**: não encontrado. `valor=null`, `confianca=0`.
- **conflitante**: fontes divergentes. `valor=null` e `candidatos` com os valores concorrentes. Nunca se escolhe um.

Ordem de qualidade: confirmado, inferido, ausente/conflitante. Um valor `calculado` nunca pode ser melhor que o pior estado das suas entradas; se alguma entrada é ausente ou conflitante, o calculado é ausente.

## Regras semânticas e mensagens

| Regra | Erro típico |
|---|---|
| 1. Comprimento em mm | `unidade "cm" ... comprimento deve ser convertido para mm` |
| 2. OCR/leitura visual confirmado exige confirmação | `exige confirmacao humana registrada` |
| 3. Ausente: valor null, confiança 0 | `estado "ausente" proíbe valor` |
| 4. Conflitante: null + 2 candidatos diferentes | `exige "candidatos" com pelo menos 2 valores` |
| 5. Calculado: regra, entradas e estado | `calculado "confirmado" é melhor que o pior estado das entradas` |
| 6. Incerto precisa de pendência | `não consta em pendencias; registre uma pendência com refs [...]` |
| 7. Ids únicos | `id "X" repetido (já usado em ...)` |

Unidades por campo: `quantidade` e contagens em `un`; `cotas` (total e parciais) em `mm`; `dimensoes` em `mm`, `m2` ou `kg` (número sem unidade é erro); `atributos` livres.

Todos os ids (itens, cotas, contagens, pendências, valores e candidatos) dividem o mesmo espaço de nomes. Uma `refs` de pendência que não existe é erro.

## Pendências

`tipo`: `ausente`, `conflitante`, `inferido_sem_confirmacao`, `divergencia`, `unidade_ambigua`, `texto_suspeito`. Cada uma tem `id`, `mensagem`, `refs` (ids dos valores envolvidos) e opcionalmente `pagina` ou `paginas`.

A verificação cruzada (`scripts/lib/cruzada.mjs`, detalhada em `cotas-e-unidades.md`) gera pendências `divergencia` e as CLIs as acrescentam automaticamente, sem duplicar ids.

## CLIs

```
node scripts/validar-projeto.mjs projeto.json        # 0 válido | 1 inválido | 2 uso errado
node scripts/gerar-relatorio.mjs projeto.json [--saida relatorio.md]
```
