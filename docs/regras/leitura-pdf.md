# Leitura de PDF (skill engenharia-projetos-tecnicos na web)

_Movido do CLAUDE.md sem alteração; o CLAUDE.md guarda só o resumo._

### Leitura de PDF (skill engenharia-projetos-tecnicos na web)
- **Fluxo**: `POST /leitura_pdf` (corpo = PDF cru, `Content-Type: application/pdf`, nome em `X-Arquivo-Nome`; até 25 MB e 60 páginas; `%PDF-`; sem senha) → `202 {id}` → leitura em segundo plano → `GET /leitura_pdf/:id` (polling; quando pronta traz a conferência) → `POST /leitura_pdf/:id/confirmar` (confirmar / rejeitar com motivo / informar / resolver) → a tela entrega o arquivo de itens ao fluxo de `importar_itens.js` (`#dlg-importar`, preço por `/calcular_preco`). `DELETE /leitura_pdf/:id` cancela (aborta a chamada à API). `GET /leitura_pdf/disponivel` diz se há chave.
- **Permissão**: `orcamentos.criar` + `valores.ver` (a mesma de montar orçamento; sem permissão nova).
- **Regras ficam na skill**: o servidor faz `import()` de `.claude/skills/engenharia-projetos-tecnicos/scripts/lib/servico.mjs`; prompt em `prompts/leitura-pdf-sistema.md`, schema da saída estruturada gerado do mapa (`scripts/lib/leitura.mjs`). Não duplique regra no servidor.
- **Nada entra sem conferência**: todo valor lido nasce `inferido`; cota sem unidade = cm inferido (pendência); item só é importável quando a skill libera e não sobra valor inferido/conflitante nele. Texto suspeito no PDF bloqueia a importação automática.
- **Tarefas em memória** (Map, dono = usuário, TTL 30 min depois de terminar, tempo máximo 15 min, 1 por usuário, 3 no servidor). Tarefa de outro usuário responde 404. Reinício do servidor perde as tarefas (a tela pede para enviar de novo). O PDF nunca vai para disco nem log.
- **Custo**: 10 leituras/hora por usuário (só as aceitas contam); 1 nova leitura automática se a resposta vier fora do formato; cada leitura grava em `web_auditoria` (`acao = leitura_pdf`: quem, arquivo, páginas, bytes, modelo, tentativas, `tokensEntrada`/`tokensSaida`, resultado, duração) e cada conferência (`leitura_pdf_conferir`). Para acompanhar o gasto: somar os tokens dessas linhas. Ordem de grandeza: cada página de PDF custa alguns milhares de tokens de entrada; o preço por token é o do modelo escolhido.
- **Testes**: `test/leitura_pdf.test.js` (cliente da API falso; nunca chama a API real), `test/leitura_pdf_tela.test.js`, `.claude/skills/engenharia-projetos-tecnicos/tests/leitura.test.mjs`.
