# EPIs: entrega, estoque e foto da ficha assinada

Spec aprovada pelo dono em 2026-11-27: `docs/superpowers/specs/2026-11-27-epis-design.md`. Substitui o piloto `epi.html` (removido; está no histórico do git).

Arquivos: `epis.html`, `epis.js`, `rotas/epis.js`, `calculo/epis.js`. Testes: `test/epis_calculo.test.js`, `test/epis_rotas.test.js`, `test/epis_tela.test.js` (banco simulado em `test/apoio/bancoEpis.js`).

## Permissões

| Permissão | Libera |
|---|---|
| `epi.ver` | Tela, estoque, histórico e fotos |
| `epi.registrar` (+ `epi.ver`) | Registrar entrega, anexar foto, lista de funcionários (só código e nome) |
| `epi.gerir` (+ `epi.ver`) | Cadastrar, editar, desativar EPI, dar entrada, cancelar entrega, remover foto |
| `administrativo.ver` (+ `epi.ver`) | Aba Resumo (`GET /epis/resumo`), atrás do olho |

Só o Administrador começa com `epi.*` (migração única `acrescentarPermissoesEpi`, marcador `permissoes_epi`; o Interno completo fica de fora).

## Dados (só tabelas `web_*`)

`web_epis`, `web_epi_entradas`, `web_epi_entregas`, `web_epi_entrega_itens`, `web_epi_fotos`. A tabela do VB `funcionarios` é só lida; "ativo" é `SITUACAO = 'Ativo'`, o mesmo filtro "Ativos" da tela de Funcionários.

## Regras

- Saldo = entradas − itens de entregas não canceladas. Nunca negativo: a entrega trava os EPIs (`ORDER BY id FOR UPDATE`) como **primeira leitura** da transação e só então confere o saldo (não colocar leitura comum antes: no REPEATABLE READ ela fixaria uma foto velha do banco).
- Nada é apagado: entrega é **cancelada** (motivo obrigatório; devolve ao estoque; não reabre nem recebe foto; as fotos continuam), EPI é **desativado** (não entra em entrega nova nem recebe entrada), foto é **ocultada**.
- Nome do funcionário, nome do EPI e C.A. são copiados para a entrega.
- Data da entrega: hoje por padrão (hora de Brasília), passada aceita, futura recusada. Quantidades inteiras. C.A. obrigatório, 1 a 7 dígitos. Nome de EPI único. EPI repetido na mesma entrega é recusado.
- Chave de idempotência por entrega, por entrada e por foto: reenvio devolve 200 `repetido`. Na tela a chave vale enquanto o conteúdo não muda (`criarChaves`).
- Foto: JPEG/PNG conferido pelos bytes (`validarAnexo`), até 1 MB, reduzida no aparelho (`camera_captura.js`); até 6 visíveis por entrega; sai só por `GET /epis/entregas/:id/foto/:fotoId` (`epi.ver`, `no-store`).
- Toda gravação vai para `web_auditoria`.
- Nomes de campos da API não podem lembrar dinheiro (`saldo`, `total`, `valor`...): a `redeDeValores` os apagaria de quem não tem `valores.ver`. Por isso `qtdEstoque`, `qtdUnidades`.

## Tela

- Abas Registrar entrega, Histórico, Estoque e Resumo. O Resumo só aparece com o olho aberto e só é buscado ao abrir a aba.
- "Dura (est.)" = estoque ÷ (consumo dos últimos 30 dias ÷ 30); fica na aba Estoque para quem tem `epi.ver`.
- Histórico: entregas (não as entradas de estoque), filtros no navegador sobre a lista inteira (sem corte), CSV com uma linha por EPI e fórmulas neutralizadas.
- No celular (até 640 px) as linhas das tabelas viram cartões.

## Verificado e não verificado

Verificado só no Edge headless com banco simulado (1366 px e 390 px). **Não testado** em MySQL real, em celular real (câmera "Fotografar" inclusive) nem por usuários reais.
