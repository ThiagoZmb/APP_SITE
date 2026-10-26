# engenharia-projetos-tecnicos

Agent Skill do Claude que lê projetos técnicos em PDF (esquadrias de alumínio, portas, serralheria) e produz dados estruturados **rastreáveis**. Versão 0.3.0: preparo do PDF com poppler (inventário, texto, renderização e recortes), núcleo comum (contrato, validação, unidades, verificação cruzada, segurança, relatório), confirmação humana registrada e montagem de itens de portas de alumínio no formato da tela de orçamentos/pedidos. Plano de corte ainda não existe. Veja `SKILL.md`.

## Instalar

Requer Node.js 24 e, para ler PDF, o **poppler** (próxima seção). Dentro deste repositório, a skill já fica em `.claude/skills/` e usa o `node_modules` da raiz (`npm install`).

Para copiar a skill para outro lugar, instale a única dependência dentro da pasta da skill:

```bash
cd engenharia-projetos-tecnicos
npm install ajv@8
```

## Poppler

O `extrair-texto.mjs` usa `pdftoppm`, `pdfinfo`, `pdffonts`, `pdftotext` e `pdfimages` do poppler. Ordem de busca:

1. variável `POPPLER_BIN` (pasta que contém `pdftoppm`); se definida, é a única fonte e, se estiver errada, o comando falha (exit 3);
2. o `PATH`, só aceitando quem se identifica como poppler em `pdftoppm -v` (o `pdftotext` antigo do xpdf é ignorado);
3. o padrão do winget: `%LOCALAPPDATA%\Microsoft\WinGet\Packages\oschwartz10612.Poppler_*\poppler-*\Library\bin`.

Sem poppler: exit 3 com a instrução de instalação (`winget install oschwartz10612.Poppler`; abra um novo terminal depois, para o PATH atualizar). Os programas rodam por `execFile` (sem shell), com timeout e sem rede; nada que vem do PDF é executado.

## Usar

Todos os comandos rodam a partir da pasta da skill. Não usam rede.

```bash
# Prepara o PDF (ver references/leitura-pdf.md): inventário por página, texto, renderização e recortes
# Pasta de trabalho padrão: <tmp>/engenharia-projetos/<sha256 12>/ (fora do git)
# Exit 0 = ok, 1 = erro ao processar, 2 = uso errado, 3 = poppler não encontrado
node scripts/extrair-texto.mjs projeto.pdf [--trabalho DIR] [--renderizar 4,11] [--dpi 60] \
  [--recorte 4:0.1,0.2,0.5,0.3] [--dpi-recorte 200]

# Valida (schema + regras). Exit 0 = válido, 1 = inválido, 2 = uso errado
node scripts/validar-projeto.mjs projeto.json

# Valida e gera o relatório em Markdown (stdout, ou arquivo com --saida)
node scripts/gerar-relatorio.mjs projeto.json --saida relatorio.md

# Confirmação humana registrada (tudo ou nada; o arquivo de entrada nunca é alterado)
# Exit 0 = ok, 1 = entrada/saída inválida ou regra violada, 2 = uso errado
node scripts/confirmar-valores.mjs projeto.json --por "Nome" --saida novo.json \
  [--ids a,b] [--resolver conflitante=candidato] [--informar id=valor] [--rejeitar a,b] [--nota "..."] [--em ISO]

# Monta os itens no formato da tela do orçamento/pedido (stdout, ou arquivo com --saida)
# Exit 0 = ok (veja prontoParaLancar), 1 = projeto inválido (nada é gerado), 2 = uso errado
node scripts/montar-itens.mjs projeto.json --dominio portas-aluminio --saida itens.json
```

Origem padrão dos projetos em PDF: `C:\Programa Elegance\Projetos_PDF\`. A skill não lê nem escreve nessa pasta por conta própria; passe o caminho do JSON estruturado.

Se o documento for inválido, `gerar-relatorio` e `montar-itens` saem com 1 e não geram nada. Divergências de soma de cotas e de contagens viram pendências automaticamente.

Como biblioteca (ESM): `scripts/lib/valor.mjs` (construtores), `validacao.mjs`, `unidades.mjs`, `cruzada.mjs`, `seguranca.mjs`, `relatorio.mjs`, `mapear.mjs` (`mapearItens`, `montarSaida`, `validarMapa`), `pdf.mjs` (classificação e recorte, funções puras), `poppler.mjs` (localização e execução sem shell) e `confirmacao.mjs` (`aplicarConfirmacoes`).

## Rodar os testes

Na raiz do repositório, `npm test` roda os testes do sistema e os da skill. Só a skill:

```bash
node --test ".claude/skills/engenharia-projetos-tecnicos/tests/**/*.test.mjs"
```

Fixtures sintéticos (sem dados de cliente) em `tests/fixtures/`; relatório e itens de referência em `tests/golden/`. Os testes de consumo (`tests/montar-itens.test.mjs`) carregam `calculo/engenharia.js` do repositório e só rodam dentro do APP_SITE.

### Opções do extrair-texto

- `--renderizar 4,11` (ou `2-5`): gera `pagina-NN.png` (`--dpi`, padrão 60, de 30 a 400). Use 50 a 60 dpi para a visão geral.
- `--recorte PAG:x,y,w,h` (repetível): gera `recorte-NN-x-y-w-h.png`, com frações de 0 a 1 **da página já girada, como aparece na imagem renderizada** (as páginas das amostras reais têm `/Rotate 270`). `--dpi-recorte` padrão 200.
- `inventario.json`: `arquivo` (só o nome), `sha256`, `poppler`, `paginas` (`numero`, `rotacao`, `larguraPt`, `alturaPt`, `caracteres`, `fontes`, `imagens`, `classificacao`, `arquivoTexto?`), `alertasSeguranca` e `geradas` (imagens, com largura e altura em pixels). O console mostra só um resumo.

### Opções do confirmar-valores

- `--ids a,b`: só valor `inferido` vira `confirmado` (mantém método e origem; grava `confirmacao`). Qualquer outro estado é erro e nada é gravado.
- `--resolver conflitante=candidato`: o conflitante vira o candidato escolhido, confirmado; os candidatos originais ficam no `historico`.
- `--informar id=valor`: para valor **ausente**; método `informado_humano`. Em campo de comprimento o número é em mm (aceita `79,5 cm` e converte); em campo de texto vale o texto; `num:2` informa número em campo sem unidade.
- `--rejeitar id[,id...]`: para valor **inferido** que está errado; exige `--nota` (motivo). O valor vira `ausente` (`valor: null`, `confianca: 0`), mantém `id`, `unidade`, `metodo` e `origem`; o valor rejeitado, quem, quando e a nota vão para o `historico` (ação `rejeitar`). Confirmado, ausente ou conflitante é erro (conflitante se resolve com `--resolver`). As pendências `inferido_sem_confirmacao`/`unidade_ambigua` do valor saem e entra **uma** pendência `ausente` "rejeitado por <por>: <nota>"; se a pendência tinha outros refs, ela fica sem o id rejeitado quando algum ref restante ainda exige pendência, e sai por inteiro quando todos já estão resolvidos. Valor calculado que dependia do rejeitado gera aviso; como o validador exige calculado ausente quando uma entrada está ausente, rejeite-o na mesma execução (`--rejeitar rejeitado,calculado`) ou a saída é recusada com a indicação de qual calculado rejeitar.
- O mesmo id não pode estar em duas ações da mesma execução. As opções se combinam (`--ids`, `--resolver`, `--informar`, `--rejeitar`).
- Remove pendências cujos valores ficaram todos resolvidos (nunca `divergencia` nem `texto_suspeito`), acrescenta `historico`, avisa quando um valor calculado depende de valor recém-confirmado (recalcule) e valida entrada e saída (saída inválida: não grava, exit 1). O schema do documento vira 1.1.0.

## Golden de amostras reais (fora do git)

Projetos reais de clientes **não vão para o git nem para fixtures** (`amostras_pdf/` está no `.gitignore`). O teste `tests/amostras-reais.test.mjs` procura pares em `<repo>/amostras_pdf/golden/` (ou na pasta de `ENG_GOLDEN_DIR`): `<nome>.projeto.json` e `<nome>.itens.esperado.json`. Para cada par valida o projeto, roda `montar-itens` e compara o resultado exatamente com o esperado. Sem a pasta ou sem pares, o teste é pulado ("sem golden de amostras reais nesta máquina"). Arquivo sem o par é erro.

Como aprovar e gerar um golden:

1. Leia o PDF seguindo `references/leitura-pdf.md`, valide e gere o relatório.
2. A pessoa responsável confere o desenho e roda `confirmar-valores.mjs`; o projeto confirmado é o `projeto.json` aprovado.
3. Copie-o para `amostras_pdf/golden/<nome>.projeto.json`.
4. Rode `node scripts/montar-itens.mjs amostras_pdf/golden/<nome>.projeto.json --saida amostras_pdf/golden/<nome>.itens.esperado.json` e **confira o resultado à mão**: é essa conferência que aprova o esperado.
5. `npm test` passa a comparar. Se uma mudança no código alterar a saída de propósito, regenere o esperado e reaprove.

## Configuração

`config/nucleo.json` guarda os parâmetros editáveis, cada um com metadados (`versao`, `data`, `responsavel`, `motivo`). `tolerancias.somaCotasMm` é 0 e o `responsavel` está pendente de aprovação. Ao mudar um parâmetro, atualize os metadados e o `CHANGELOG.md`.

### Governança das regras

Decisão do usuário (2026-10-26): **quem aprova as regras é qualquer pessoa que esteja usando o sistema**; não há um responsável técnico único. Na prática: o campo `responsavel` dos metadados guarda **o nome de quem aprovou** cada mudança; quando a decisão veio do usuário do sistema sem nome registrado, usa-se `"usuário do sistema"` com `status: "aprovado"`. Nunca invente um nome. Parâmetro que ninguém decidiu continua com `responsavel: null` e status "pendente" (hoje: `config/nucleo.json` com tolerância de soma de 0 mm, o mapa `portas-aluminio` e `barraComercial.sobraMinimaMm`). Toda mudança de regra atualiza os metadados e o `CHANGELOG.md`.

## Adicionar um domínio

O núcleo não conhece "porta": `itens[].dimensoes` e `atributos` são mapas livres, e `scripts/lib/mapear.mjs` só interpreta um **mapa declarativo em JSON**. Um domínio novo não muda nenhum código do núcleo:

1. Criar `config/regras-por-dominio/<dominio>.json` (nome em minúsculas, dígitos e hífen). O mapa tem `dominio`, `metadados` (`versao`, `data`, `responsavel`, `motivo`), `base` (estrutura fixa do objeto de saída) e `campos`. `categorias` (opcional) lista os `tipo` de item aceitos pelo domínio. Cada campo diz: `origem` (`tipo` = categoria do item, **sempre confirmada, nunca use para algo deduzido do desenho**; `quantidade`, `dimensoes.x` ou `atributos.x`), `destino` (caminho com pontos no objeto de saída), `tipo` (`numero`, `inteiro`, `texto`, `lista`), `obrigatorio`, e opcionalmente `traducao`, `minimo`, `maximo`, `maiorQue`, `itemTipo`, `separador`, `obrigatorioQuando` (`{destino, em: [...]}`).
2. Escrever `references/<dominio>.md` com o formato real do consumidor (com arquivo:linha), as traduções e as divergências.
3. Acrescentar fixtures e testes em `tests/` (veja `tests/mapear.test.mjs`, que prova o núcleo com um domínio fictício, `tests/fixtures/dominio-guarda-corpo-teste.json`).
4. Rodar `node scripts/montar-itens.mjs projeto.json --dominio <dominio>`; atualizar `SKILL.md` e `CHANGELOG.md`.

Regras do mapeamento (valem para todo domínio): só valor `confirmado` entra no objeto; `inferido` vai para `sugestoes`; ausente e conflitante não entram e geram pendência; tradução sem correspondência ou valor de tipo/faixa inválido vira pendência; cada campo preenchido registra `rastreio[destino]` com o id do valor de origem.

## Por que `montar-itens.mjs` e não `calcular-pecas.mjs`

O plano original previa um `calcular-pecas.mjs`. Pela decisão D3 (2026-10-26) a skill não aplica descontos de fabricação: vidro, perfil e sistema de correr são calculados pelo sistema web a partir do banco (ver `references/regras-fabricacao.md`). Sobra à skill entregar as medidas lidas do projeto no formato do item da tela (decisão D4), que é o que `montar-itens.mjs` faz. O arquivo `config/barras-comerciais.json` (barra de 6000 mm, decisão D5) já existe para a Fase 2 (plano de corte), mas nada o usa ainda.
