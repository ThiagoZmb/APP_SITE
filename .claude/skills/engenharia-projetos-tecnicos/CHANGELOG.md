# Changelog

## 0.3.2 — 2026-10-26

`confirmar-valores --rejeitar`.

Motivo: a conferência humana de uma amostra real achou uma lacuna. A pessoa precisava poder **rejeitar** um valor inferido errado (a leitura visual classificou "Inox escovado" como cor do perfil, mas é acabamento; ou leu "15" como tamanho de puxador num projeto sem puxador). Só existiam `--ids` (confirmar), `--resolver` e `--informar`.

- `--rejeitar id[,id...]` com `--nota` obrigatória (motivo). Só valor `inferido`; qualquer outro estado é erro e nada é gravado (conflitante se resolve com `--resolver`).
- O valor vira `ausente` (null, confiança 0), mantém id, unidade, método e origem; o valor rejeitado vai para o `historico` (ação `rejeitar`, com valor anterior, quem, quando e nota; o relatório mostra o valor rejeitado).
- Pendências: `inferido_sem_confirmacao`/`unidade_ambigua` do valor são substituídas por **uma** pendência `ausente` "rejeitado por <por>: <nota>" (regra 6). Com outros refs, a pendência continua (sem o id rejeitado) se algum ref restante ainda exige pendência; senão sai.
- Calculado que depende do rejeitado: aviso em stderr; se a saída ficar inválida (entrada ausente), o erro diz qual calculado rejeitar junto ou recalcular.
- Combina com `--ids`, `--resolver` e `--informar`; o mesmo id em duas ações é erro.

## 0.3.1 — 2026-10-26

Correção do núcleo achada ao ler uma amostra real, mais decisões do usuário.

Motivo da correção: a regra 2 ("inferido nunca vira confirmado sozinho") era violada. O campo de origem `tipo` do item virava **sempre** valor `confirmado` com confiança 1, mas o tipo de frente (giro, basculante, gaveta, correr) normalmente é **deduzido do desenho** (leitura visual) e precisa poder ser `inferido`. Achado ao usar a skill numa amostra real.

Mudanças:

- `portas-aluminio`: o destino `frente` passa a ter origem `atributos.tipoFrente` (ValorRastreavel, mesma tabela de tradução). Tipo de frente `inferido` vira sugestão + pendência bloqueante e só entra em `frente` depois de `confirmar-valores --ids`. O `rastreio.frente` agora aponta o id do valor (`P1.tipoFrente`), não o do item.
- `item.tipo` passa a ser só a **categoria** do item (`porta_aluminio` nas portas; continua usado por `foraDoEscopo`). O mapa ganha `categorias` (opcional): categoria fora dela e fora de `foraDoEscopo.tipos` vira pendência bloqueante `traducao_sem_correspondencia` com destino `tipo` (nunca adivinha, como antes).
- A origem `tipo` continua disponível no núcleo (usada pelo domínio de teste `guarda-corpo-teste` para a categoria), mas está documentada como **sempre confirmada**: não usar para nada deduzido do desenho.
- Fixtures, golden (só o `rastreio.frente` mudou), testes, `esquadrias-aluminio.md` e `leitura-pdf.md` atualizados. Testes de regressão: tipoFrente inferido não entra e bloqueia; depois de confirmar entra.
- Atenção: projetos já estruturados com o tipo de frente em `item.tipo` precisam migrar para `atributos.tipoFrente` e `tipo: "porta_aluminio"`.

Decisões do usuário (2026-10-26), aprovadas por: usuário do sistema.

- **Perda de serra (kerf) = 3 mm** em `config/barras-comerciais.json` (`kerfMm: 3`). `sobraMinimaMm` continua `null`, pendente. Ainda não usado por nenhum script (plano de corte é Fase 2).
- **Governança**: quem aprova as regras é qualquer pessoa que esteja usando o sistema. O `responsavel` dos metadados guarda o nome de quem aprovou; sem nome registrado usa-se `"usuário do sistema"` (status `aprovado`). Política no README ("Governança das regras").
- Metadados passam a `responsavel: "usuário do sistema"`, `status: "aprovado"` para o que o usuário decidiu: barra de 6000 mm (D5) e kerf de 3 mm. Registradas como aprovadas as decisões já tomadas: D3 (a skill não aplica descontos de fabricação), D4 (saída no formato do item da tela), D5, D6 (amostras fora do git), cota em cm inferida pela convenção, golden de amostras reais fora do git e a lista de produtos que a Elegance fabrica (portas; estantes/louceiros em perfil; estruturas de aço), todas já descritas nas versões 0.2.0 e 0.3.0 abaixo.
- **Continua pendente**: `config/nucleo.json` (tolerância de soma de cotas 0 mm; o usuário não decidiu) e o mapa `portas-aluminio` (responsável não registrado).

## 0.3.0 — 2026-10-26

Fase 1c: leitura de PDF com poppler, confirmação humana registrada e itens fora do escopo.

Motivo: as amostras reais são projetos executivos de marcenaria de escritórios de arquitetura (PDF A3 exportado de CAD, `/Rotate 270`, **sem nenhuma fonte**: `pdftotext` devolve 0 caracteres). A leitura real é visual e a confirmação humana passa a ser a etapa central. Aprovado por: pendente.

Decisões registradas:

- **Cotas em cm inferidas pela convenção**: as cotas vêm em centímetros com vírgula decimal e a unidade não aparece escrita. Quando a convenção de projeto de arquitetura e a escala (1/50, 1/25, 1/5) indicam cm, a leitura usa `unidadeDeclarada: { unidade: 'cm', inferida: true }`: estado `inferido` + pendência `unidade_ambigua`, sempre pendente de confirmação humana.
- **Golden de amostras reais fora do git**: `tests/amostras-reais.test.mjs` lê pares de `amostras_pdf/golden/` (ou `ENG_GOLDEN_DIR`) e é pulado quando a pasta não existe. Os fixtures versionados continuam 100% sintéticos.
- **O que a Elegance fabrica nesses projetos** (decisão do usuário, 2026-10-26): (1) portas de alumínio para móveis; (2) estantes, louceiros e afins em perfil de alumínio (por exemplo "PORTAS EM PERFIL 3136 E PUXADORES 2790", "SISTEMA THIN1802", "SISTEMA EVIDENCE"); (3) estruturas metálicas em aço carbono (base de mesa, adega, nicho, suporte de prateleira). Só (1) tem mapa para o item da tela; (2) e (3) são registráveis e saem como "fora do escopo atual (sem mapeamento)".
- **Poppler escolhido** para ler PDF: funciona também no ambiente do Claude.ai e habilita a leitura de PDF do Claude Code. A API de PDF do Windows foi descartada por existir só nesta máquina.

Novidades:

- `scripts/extrair-texto.mjs` (nome mantido da arquitetura; faz o "preparo" do PDF): localiza o poppler (`POPPLER_BIN`, PATH com verificação de que é poppler, padrão do winget; senão exit 3 com instrução de instalação), `execFile` sem shell, com timeout. Grava `inventario.json` (classificação por página: `texto_vetorial`, `vetorial_sem_texto`, `escaneado`, `misto`), `pagina-NN.txt` quando há texto, alertas de segurança (`detectarInstrucoes`), `pagina-NN.png` (`--renderizar`) e `recorte-NN-x-y-w-h.png` (`--recorte`, frações da página já girada; rotação 90/270 troca largura e altura). Funções puras em `scripts/lib/pdf.mjs`; execução do poppler em `scripts/lib/poppler.mjs`.
- `scripts/confirmar-valores.mjs` e `scripts/lib/confirmacao.mjs`: `--ids` (inferido para confirmado), `--resolver` (conflitante para o candidato escolhido, candidatos no histórico), `--informar` (ausente para valor dado por pessoa). Tudo ou nada; remove pendências resolvidas (nunca divergência nem texto suspeito); acrescenta `historico`; avisa quando um calculado depende de valor recém-confirmado; valida entrada e saída.
- **Schema 1.1.0**: campo opcional `historico` e método `informado_humano` (regra semântica nova: exige `confirmacao`). Documentos 1.0.0 continuam válidos.
- Mapa de domínio: `foraDoEscopo.tipos` (opcional). Item desses tipos sai com `foraDoEscopo: true`, `item: {}` e pendência informativa `fora_do_escopo` (não bloqueante); não impede o lançamento das portas. O relatório ganha as seções "Fora do escopo atual (sem mapeamento)" e "Histórico de confirmações" (só quando há conteúdo).
- `references/leitura-pdf.md` (protocolo de leitura econômica); `cotas-e-unidades.md`, `esquadrias-aluminio.md` e `validacao.md` atualizados.
- Testes com fixtures sintéticos (PDFs gerados com pdfkit em tempo de teste; os que precisam do poppler são pulados se ele faltar).

Não incluído: OCR automático e plano de corte.

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
