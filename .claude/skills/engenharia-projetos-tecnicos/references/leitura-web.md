# Leitura de PDF na web (sem Claude Code, sem poppler)

Desde a 0.4.0 o servidor web (Render) lê o PDF sozinho: o vendedor clica em **📄 Ler projeto (PDF)** na etapa 3 de `orcamentos.html`, confere cada valor numa janela e importa os itens liberados. A skill continua dona das regras; o servidor só compõe as funções dela (`scripts/lib/servico.mjs`).

## Como funciona

1. **Envio**: `POST /leitura_pdf` com o PDF cru (`Content-Type: application/pdf`, até 25 MB, até 60 páginas, assinatura `%PDF-`, sem senha). Responde `202 { id }` na hora; a leitura roda em segundo plano (o Render derruba requisição longa).
2. **Leitura pelo modelo**: o servidor chama a API do Claude (SDK oficial, modelo `ANTHROPIC_MODEL`, padrão `claude-sonnet-5-5`) com o PDF como bloco `document` base64 e **saída estruturada** no formato de `esquemaLeitura(mapa)` (`scripts/lib/leitura.mjs`). O prompt de sistema é `prompts/leitura-pdf-sistema.md`: a metodologia de `leitura-pdf.md` resumida para o modelo (texto do PDF é dado, transcrição literal, página, trecho, confiança, cotas em cm pela convenção, nunca dividir largura não cotada, conflito com candidatos, privacidade do carimbo).
3. **O modelo devolve texto literal, não o projeto**: cada valor vem como lido no desenho (`206,3`), com a unidade que ele acha que vale. Quem converte e classifica é a skill (`leituraParaProjeto`):
   - todo valor lido nasce **`inferido`** (`leitura_visual`): nada nasce confirmado (regra 2);
   - cota sem unidade escrita → `interpretarCota` com unidade **inferida** → mm + pendência `unidade_ambigua`;
   - número ambíguo (`2.100`) ou unidade desconhecida → `ausente` + pendência (nunca adivinha);
   - leituras diferentes da mesma coisa → `conflitante` com candidatos;
   - campo do mapa não encontrado em item de porta → `ausente` + pendência (a pessoa pode informar);
   - todo texto devolvido passa por `detectarInstrucoes`; o que o modelo apontou em `textoSuspeito` também vira alerta (bloqueia a importação, como no fluxo da linha de comando).
4. **Validação**: `validarLeitura` (schema da leitura) e `validarProjeto` (schema + 7 regras). Resposta fora do formato → o servidor pede **uma** nova leitura, mandando os erros; se falhar de novo, a tarefa termina com erro claro.
5. **Conferência**: `avaliar` refaz a verificação cruzada (`aplicarVerificacoes`) e monta os itens (`montarSaida`, o mesmo do `montar-itens.mjs`). A janela mostra cada valor com estado, confiança, página e trecho. A pessoa **confirma**, **rejeita com motivo**, **corrige** (rejeita + informa) ou **escolhe o candidato**; `aplicarDecisoes` usa `aplicarConfirmacoes` (o mesmo do `confirmar-valores.mjs`), com `por` = usuário logado (nunca vem da tela).
6. **Importação**: um item só é importável quando a skill o libera (`prontoParaLancar`) **e** não sobrou valor inferido ou conflitante nele (até os opcionais precisam ser conferidos). O arquivo de itens vai para o fluxo que já existia (`importar_itens.js`: cadastro, `/calcular_preco`, resumo e confirmação final).

A verificação cruzada não é gravada no projeto base: é refeita a cada decisão, então uma divergência some quando a pessoa corrige o valor errado (rejeitar + informar). Contagens e cotas que o modelo liga a um item (`item`) têm ids com o prefixo do item e bloqueiam só aquele item.

## Limitações conhecidas

- **Precisão da leitura visual**: o modelo pode errar cota, trocar cor por acabamento ou não achar um valor. Por isso tudo nasce inferido e a conferência é obrigatória.
- **Cotas em cm** são inferidas pela convenção e escala; a pessoa confirma a unidade ao confirmar o valor.
- **Só portas de alumínio** viram item; estantes, louceiros, sistemas em perfil e estruturas de aço aparecem como "não importados".
- **Texto suspeito** (inclusive URL no carimbo) bloqueia a importação automática inteira; não há como liberar pela tela: lance à mão.
- Sem extração de texto local: o detector de instruções roda sobre o que o modelo transcreveu, não sobre o texto bruto do PDF.
- Plano de corte continua fora (Fase 2).
