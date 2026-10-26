# engenharia-projetos-tecnicos

Agent Skill do Claude que lê projetos técnicos em PDF (esquadrias de alumínio, portas, serralheria) e produz dados estruturados **rastreáveis**. Versão 0.2.0: núcleo comum (contrato, validação, unidades, verificação cruzada, segurança, relatório) e montagem de itens de portas de alumínio no formato da tela de orçamentos/pedidos. Extração de PDF (aguarda poppler) e plano de corte ainda não existem. Veja `SKILL.md`.

## Instalar

Requer Node.js 24. Dentro deste repositório, a skill já fica em `.claude/skills/` e usa o `node_modules` da raiz (`npm install`).

Para copiar a skill para outro lugar, instale a única dependência dentro da pasta da skill:

```bash
cd engenharia-projetos-tecnicos
npm install ajv@8
```

## Usar

Todos os comandos rodam a partir da pasta da skill. Não usam rede.

```bash
# Valida (schema + regras). Exit 0 = válido, 1 = inválido, 2 = uso errado
node scripts/validar-projeto.mjs projeto.json

# Valida e gera o relatório em Markdown (stdout, ou arquivo com --saida)
node scripts/gerar-relatorio.mjs projeto.json --saida relatorio.md

# Monta os itens no formato da tela do orçamento/pedido (stdout, ou arquivo com --saida)
# Exit 0 = ok (veja prontoParaLancar), 1 = projeto inválido (nada é gerado), 2 = uso errado
node scripts/montar-itens.mjs projeto.json --dominio portas-aluminio --saida itens.json
```

Origem padrão dos projetos em PDF: `C:\Programa Elegance\Projetos_PDF\`. A skill não lê nem escreve nessa pasta por conta própria; passe o caminho do JSON estruturado.

Se o documento for inválido, `gerar-relatorio` e `montar-itens` saem com 1 e não geram nada. Divergências de soma de cotas e de contagens viram pendências automaticamente.

Como biblioteca (ESM): `scripts/lib/valor.mjs` (construtores), `validacao.mjs`, `unidades.mjs`, `cruzada.mjs`, `seguranca.mjs`, `relatorio.mjs`, `mapear.mjs` (`mapearItens`, `montarSaida`, `validarMapa`).

## Rodar os testes

Na raiz do repositório, `npm test` roda os testes do sistema e os da skill. Só a skill:

```bash
node --test ".claude/skills/engenharia-projetos-tecnicos/tests/**/*.test.mjs"
```

Fixtures sintéticos (sem dados de cliente) em `tests/fixtures/`; relatório e itens de referência em `tests/golden/`. Os testes de consumo (`tests/montar-itens.test.mjs`) carregam `calculo/engenharia.js` do repositório e só rodam dentro do APP_SITE.

## Configuração

`config/nucleo.json` guarda os parâmetros editáveis, cada um com metadados (`versao`, `data`, `responsavel`, `motivo`). `tolerancias.somaCotasMm` é 0 e o `responsavel` está pendente de aprovação. Ao mudar um parâmetro, atualize os metadados e o `CHANGELOG.md`.

## Adicionar um domínio

O núcleo não conhece "porta": `itens[].dimensoes` e `atributos` são mapas livres, e `scripts/lib/mapear.mjs` só interpreta um **mapa declarativo em JSON**. Um domínio novo não muda nenhum código do núcleo:

1. Criar `config/regras-por-dominio/<dominio>.json` (nome em minúsculas, dígitos e hífen). O mapa tem `dominio`, `metadados` (`versao`, `data`, `responsavel`, `motivo`), `base` (estrutura fixa do objeto de saída) e `campos`. Cada campo diz: `origem` (`tipo`, `quantidade`, `dimensoes.x` ou `atributos.x`), `destino` (caminho com pontos no objeto de saída), `tipo` (`numero`, `inteiro`, `texto`, `lista`), `obrigatorio`, e opcionalmente `traducao`, `minimo`, `maximo`, `maiorQue`, `itemTipo`, `separador`, `obrigatorioQuando` (`{destino, em: [...]}`).
2. Escrever `references/<dominio>.md` com o formato real do consumidor (com arquivo:linha), as traduções e as divergências.
3. Acrescentar fixtures e testes em `tests/` (veja `tests/mapear.test.mjs`, que prova o núcleo com um domínio fictício, `tests/fixtures/dominio-guarda-corpo-teste.json`).
4. Rodar `node scripts/montar-itens.mjs projeto.json --dominio <dominio>`; atualizar `SKILL.md` e `CHANGELOG.md`.

Regras do mapeamento (valem para todo domínio): só valor `confirmado` entra no objeto; `inferido` vai para `sugestoes`; ausente e conflitante não entram e geram pendência; tradução sem correspondência ou valor de tipo/faixa inválido vira pendência; cada campo preenchido registra `rastreio[destino]` com o id do valor de origem.

## Por que `montar-itens.mjs` e não `calcular-pecas.mjs`

O plano original previa um `calcular-pecas.mjs`. Pela decisão D3 (2026-10-26) a skill não aplica descontos de fabricação: vidro, perfil e sistema de correr são calculados pelo sistema web a partir do banco (ver `references/regras-fabricacao.md`). Sobra à skill entregar as medidas lidas do projeto no formato do item da tela (decisão D4), que é o que `montar-itens.mjs` faz. O arquivo `config/barras-comerciais.json` (barra de 6000 mm, decisão D5) já existe para a Fase 2 (plano de corte), mas nada o usa ainda.
