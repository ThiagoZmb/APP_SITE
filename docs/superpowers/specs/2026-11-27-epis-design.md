# EPIs: entrega, estoque e foto da ficha assinada (projeto)

Data: 2026-11-27. Situação: aprovado pelo dono em 2026-11-27.

## Para que serve

Trazer o piloto `epi.html` para dentro do sistema e guardar, junto de cada entrega de EPI, a foto da assinatura do funcionário que recebeu, para consulta futura. Mesma ideia das fotos das entregas.

## O que entra

- Tela `epis.html` ("EPIs", seção Gestão do menu, logo abaixo de Funcionários) com o tema do sistema e as abas **Registrar entrega**, **Histórico**, **Estoque** e **Resumo**.
- Uma **entrega** = um funcionário, uma data, observação opcional, um ou mais EPIs com quantidade e até 6 fotos.
- A foto é opcional na hora do registro e pode ser anexada depois. Cada linha do histórico mostra "Assinado ✓" ou "Sem foto", com os botões de ver e anexar.
- Catálogo de EPIs: nome, nº do C.A. (obrigatório, só números), estoque mínimo, ativo/inativo; entrada de quantidade no estoque.
- Histórico com filtro por funcionário, EPI e período, busca, filtro "Sem foto" e exportação CSV.
- Resumo do piloto (indicadores e gráficos de barras) e estimativa de quantos dias o estoque dura.

## O que muda em relação ao piloto

| Piloto | No sistema |
|---|---|
| Dados no navegador | Banco de dados, em tabelas `web_epi*` |
| Lista própria de funcionários (aba) | Cadastro de funcionários do sistema; a aba some |
| Um EPI por baixa | Vários EPIs por entrega |
| Apagar baixas | **Cancelar** a entrega, com motivo: devolve ao estoque, continua no histórico com as fotos |
| Excluir EPI apaga o histórico | **Desativar** o EPI; o histórico fica |
| Backup, Restaurar e botão de tema | Removidos |

## O que não entra

- Assinatura desenhada na tela, termo ou ficha de EPI em PDF.
- Aviso de troca ou de vencimento do C.A.
- Ligação com o estoque de materiais, com o financeiro ou com tabelas do VB (o cadastro de funcionários é só lido).
- Importar os dados salvos no navegador pelo piloto.

Seria um fracasso: uma entrega ou foto sumir do histórico, o estoque de EPI ficar negativo, ou quem não tem permissão ver as fotos.

## Abordagens consideradas

- **A) Foto presa à entrega** (escolhida pelo dono): mostra exatamente o que a pessoa assinou e permite ver o que está sem assinatura. Exige registrar a entrega com seus itens.
- **B) Foto na ficha do funcionário:** mais simples, mas não diz qual foto comprova qual entrega.

## Permissões

| Permissão | Libera |
|---|---|
| `epi.ver` | Abrir a tela, o estoque, o histórico e as fotos |
| `epi.registrar` | Registrar entrega e anexar foto |
| `epi.gerir` | Cadastrar e desativar EPI, dar entrada, cancelar entrega, remover foto errada |

Só o Administrador começa com elas; o dono libera para os demais. A aba **Resumo** exige também `administrativo.ver`, fica atrás do olho e só carrega ao abrir.

Quem registra entregas precisa escolher o funcionário sem ter `funcionarios.ver`: a tela de EPIs recebe só código e nome dos funcionários em atividade, nenhum outro dado.

## Decisões minhas (confira)

- A data da entrega vem preenchida com hoje e aceita data anterior (para lançar fichas atrasadas), nunca futura.
- Quantidades são inteiras. Entrega sem estoque suficiente é recusada.
- Remover foto errada apenas a oculta; o arquivo continua no banco e a ação fica na auditoria.
- Foto reduzida no aparelho antes do envio; o servidor aceita JPEG ou PNG de até 1 MB, como nas entregas.
- Entrega cancelada não pode ser reaberta nem receber foto.
- O nome do funcionário, do EPI e o C.A. são copiados para a entrega: mudar o cadastro depois não altera o histórico.
- O arquivo `epi.html` sai da raiz quando a tela nova estiver pronta (foi incluído no git em 2026-11-27, então continua recuperável pelo histórico).

## Como se encaixa no código

- `rotas/epis.js` (todas por `registro.rota`), `calculo/epis.js` (validações puras), `epis.html` + `epis.js`.
- Tabelas criadas por `seguranca/instalacao.js`: `web_epis`, `web_epi_entradas`, `web_epi_entregas`, `web_epi_entrega_itens`, `web_epi_fotos`.
- Saldo = entradas − itens de entregas não canceladas. Gravação em transação, travando o EPI antes de conferir o saldo; chave por envio para não duplicar entrega nem foto se a rede cair.
- Permissões em `seguranca/permissoes.js`; menu e `PAGINAS` em `layout.js`; auditoria em cada gravação.
- Foto validada com a regra de `validarAnexo` (`calculo/entregas.js`).
- Testes com banco simulado; visual conforme `DESIGN.md` (cabeçalho de tabela fixo).

## O que fica a cargo de quem programa

Nomes das colunas e das rotas, e a disposição dos campos dentro das abas.
