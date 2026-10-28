# Notas fiscais sem itens (entrada e saída) — design

Data: 2026-10-28

## Objetivo
Registrar notas fiscais de entrada (fornecedor) e de saída (cliente) apenas pelo cabeçalho, sem itens, para controle fiscal. O registro **não** mexe em estoque, nem em `fluxo_de_caixa`, nem em nenhuma tabela do VB.

## Decisões já tomadas
- Finalidade: registro/controle fiscal apenas (sem lançamento no financeiro).
- Contraparte: entrada = fornecedor de `cadastro_fornecedores`; saída = cliente de `clientes`.
- Fora do escopo: itens, estoque, financeiro, leitura de XML/PDF da nota.

## Dados
Tabela nova `web_notas_fiscais`, criada em `seguranca/instalacao.js` (nunca altera tabelas do VB):

| Campo | Tipo | Observação |
|---|---|---|
| id | INT AUTO_INCREMENT PK | |
| tipo | ENUM('entrada','saida') | |
| numero | VARCHAR(20) | só dígitos |
| serie | VARCHAR(5) | padrão `1` |
| chave | CHAR(44) NULL | opcional; 44 dígitos com dígito verificador |
| data_emissao | DATE | |
| contraparte_codigo | INT | referência lógica (fornecedor `COD` ou cliente), sem FK |
| contraparte_nome | VARCHAR(190) | cópia do nome no momento do registro |
| valor_total | DECIMAL(14,2) | |
| observacao | VARCHAR(500) NULL | |
| situacao | ENUM('ativa','cancelada') | padrão `ativa` |
| motivo_cancelamento | VARCHAR(300) NULL | |
| criado_por, criado_em, alterado_por, alterado_em | | |

Unicidades: (tipo, serie, numero, contraparte_codigo) e `chave` (quando preenchida).

## Regras
- Entrada exige fornecedor existente; saída exige cliente existente (400 se não existir). Usuário com estados restritos só lança saída para cliente dos seus estados (`foraDosEstados`).
- Número repetido (mesma combinação) ou chave repetida: 409.
- Valor: vírgula ou ponto decimal, > 0; `1.234,56` recusado (igual às tintas).
- Sem exclusão. Cancelamento exige motivo; nota cancelada não pode ser editada. Cancelar é irreversível.
- Contraparte, tipo, número, série e chave não mudam depois de criada (corrigir = cancelar e lançar de novo); editáveis: data, valor, observação.
- `valor_total` é dinheiro: sem `valores.ver` a rota não devolve e, ao editar, mantém o gravado; ao criar sem `valores.ver`, é recusado (a nota exige valor).
- Auditoria (`nota_fiscal_criada/alterada/cancelada`) guarda só nomes de campos, nunca valores nem chave.

## Rotas (`rotas/notas_fiscais.js`, todas por `registro.rota`)
- `GET /notas_fiscais?tipo=&de=&ate=&q=&situacao=` — lista (limite 200), `notas.ver`.
- `GET /notas_fiscais/:id` — `notas.ver`.
- `POST /notas_fiscais` — `notas.editar`.
- `PUT /notas_fiscais/:id` — `notas.editar`.
- `POST /notas_fiscais/:id/cancelar` — `notas.editar`.
- Transação com `rotas/transacao.js`; campos de contagem com `qtd*` (nunca nome casando com `REGEX_VALOR`, exceto os de valor, que passam por `semValores`).

## Permissões
`notas.ver` e `notas.editar` em `seguranca/permissoes.js`; migração dá ambas a Administrador e Interno completo.

## Tela
`notas_fiscais.html` + `notas_fiscais.js` + item de menu em `layout.js`. Abas Entrada/Saída, busca (número, contraparte, período), lista e formulário de lançamento com seleção de fornecedor/cliente. CSP e estilo como as demais páginas.

## Validação pura
`calculo/notas_fiscais.js`: normalização de número/série, validação da chave (44 dígitos + módulo 11), valor, campos editáveis.

## Testes
`test/notas_calculo.test.js`, `test/notas_rotas.test.js` (banco falso `test/apoio/bancoNotas.js`), `test/notas_tela.test.js`; mais o teste de ligações confirmando que o app sobe (`registro.verificar()`).

## Documentação
Acrescentar seção "Notas fiscais" ao `CLAUDE.md` e a linha da funcionalidade.
