# engenharia-projetos-tecnicos

Agent Skill do Claude que lê projetos técnicos em PDF (esquadrias de alumínio, portas, serralheria) e produz dados estruturados **rastreáveis**. Versão 0.1.0: apenas o núcleo comum (contrato, validação, unidades, verificação cruzada, segurança e relatório). Extração de PDF, regras de portas e plano de corte ainda não existem. Veja `SKILL.md`.

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
```

Se o documento for inválido, `gerar-relatorio` sai com 1 e não gera nada. Divergências de soma de cotas e de contagens viram pendências automaticamente.

Como biblioteca (ESM): `scripts/lib/valor.mjs` (construtores), `validacao.mjs`, `unidades.mjs`, `cruzada.mjs`, `seguranca.mjs`, `relatorio.mjs`.

## Rodar os testes

Na raiz do repositório, `npm test` roda os testes do sistema e os da skill. Só a skill:

```bash
node --test ".claude/skills/engenharia-projetos-tecnicos/tests/**/*.test.mjs"
```

Fixtures sintéticos (sem dados de cliente) em `tests/fixtures/`; relatório de referência em `tests/golden/`.

## Configuração

`config/nucleo.json` guarda os parâmetros editáveis, cada um com metadados (`versao`, `data`, `responsavel`, `motivo`). `tolerancias.somaCotasMm` é 0 e o `responsavel` está pendente de aprovação. Ao mudar um parâmetro, atualize os metadados e o `CHANGELOG.md`.

## Adicionar um domínio (esboço)

O núcleo não conhece "porta": `itens[].dimensoes` e `atributos` são mapas livres. Para um novo domínio:

1. Definir o valor de `dominio` e os nomes de dimensões e atributos do item (por exemplo `altura`, `largura`).
2. Escrever `references/<dominio>.md` com as regras de negócio e a origem de cada parâmetro.
3. Criar um módulo `scripts/lib/<dominio>.mjs` que consome o documento validado e devolve resultados também como `ValorRastreavel` (`calculado`, herdando o pior estado das entradas).
4. Acrescentar fixtures e testes em `tests/`.
5. Registrar parâmetros novos em `config/` com responsável e motivo, e atualizar `SKILL.md` e `CHANGELOG.md`.
