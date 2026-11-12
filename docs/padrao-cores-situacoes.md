# Padrão de cores das situações (PROPOSTA para aprovação)

Status: **proposta**, ainda não aplicada no código. Depois de aprovada, vira seção do `DESIGN.md` e passa a valer em todas as telas
pelas variáveis `--selo-*` do `tema.css` (classe `.selo` + `neutro | aviso | info | ok | perigo`). Nada de hsl/hex solto.

## 1. Significado de cada cor

| Cor (classe) | Significa | Exemplos |
|---|---|---|
| **ok** (verde) | Concluído, positivo, regular | Pago, Recebido, Entregue, Ativo, Conferido |
| **info** (azul) | Em andamento, já combinado, em curso | Em Produção, Agendada, Em rota, Gerado |
| **aviso** (âmbar) | Falta ação ou conferência; atenção | Pronto (aguarda entrega), A programar, A Receber, No mínimo |
| **perigo** (vermelho) | Atrasado, falhou, bloqueado, cancelado com impacto | Atrasado, Ocorrência, Em falta, Cancelada, Bloqueado |
| **neutro** (cinza) | Sem estado ativo: inativo, não se aplica, encerrado, desconhecido | Inativo, N/A, Baixado, Encerrada, Sem consumo |

Regras: um estado tem **uma** cor em **todas** as telas; o rótulo pode variar, a cor não. Cor nunca é a única pista (o selo sempre leva o texto).
"Cancelado" é neutro quando é decisão normal (orçamento baixado) e perigo só quando houve falha ou cancelamento de algo em andamento (entrega cancelada).

## 2. Mapeamento proposto

### Pedido (`ped_orc.SITUACAO`)
| Situação | Cor | Observação |
|---|---|---|
| Em Produção | info | |
| Pronto | aviso | falta entregar; é o estado que pede ação da equipe |
| Entregue | ok | |
| Retirado | ok | |
| Cancelado | neutro | |
| Atrasado (derivado) | perigo | prevalece sobre Em Produção |
| Desconhecido | neutro | |

### Orçamento
| Situação | Cor |
|---|---|
| Aguardando resposta | aviso |
| Fechado | ok |
| Baixado | neutro |

### Financeiro do pedido e fluxo de caixa
| Situação | Cor |
|---|---|
| Recebido / Pago | ok |
| A Receber / A Pagar | aviso |
| Faturado | info |
| Atrasado | perigo |
| Protestado | perigo |
| Sem custo | neutro |

### Entrega (`web_entregas.status`)
| Status | Cor |
|---|---|
| A programar | aviso |
| Agendada | info |
| Em rota | info |
| Enviada (outro estado) | info |
| Ocorrência | perigo |
| Entregue / Retirado | ok |
| Cancelada | neutro |
| Encerrada | neutro |
| Suspensa | aviso |

Tipo de entrega (motorista, retirada, outro estado): sem cor (neutro). Em Início, Painel e Clientes deixa de ser roxo único: usa a cor do status.

### Etapas de produção
| Estado | Cor |
|---|---|
| OK manual | ok |
| OK vindo do corte | info (mantém a distinção atual) |
| Pendente | neutro |
| N/A | neutro (borda tracejada) |

### Planos de corte (perfis e vidros) e retalhos
| Situação | Cor |
|---|---|
| Gerado | info |
| Conferido | ok |
| Desatualizado (só perfis) | aviso |
| Cancelado | neutro |
| Retalho: Disponível | ok |
| Retalho: Reservado | info |
| Retalho: Usado | neutro |
| Retalho: Descartado | neutro |

Hoje essas situações aparecem só como texto: passam a ter selo.

### Notas fiscais
| Situação | Cor |
|---|---|
| Ativa | sem selo (ou ok) |
| Cancelada | perigo |
| SEFAZ: Só resumo | aviso |
| SEFAZ: Ciência dada | info |
| SEFAZ: XML completo | ok |
| SEFAZ: Importada | neutro |
| SEFAZ: Cancelada | perigo |

### Estoque
| Situação | Cor |
|---|---|
| Item Ativo | ok |
| Item Inativo | neutro |
| Saldo Normal | ok |
| No mínimo | aviso |
| Em falta | perigo |
| Previsão: Em falta | perigo |
| Previsão: Comprar | aviso |
| Previsão: Atenção | aviso |
| Previsão: OK | ok |
| Previsão: Sem consumo / Poucos dados | neutro |
| Movimento: Entrada | ok |
| Movimento: Saída | aviso |
| Movimento: Ajuste | info |
| Movimento: Estorno | neutro |
| Custo: Confiável | ok |
| Custo: Desatualizado | aviso |
| Custo: Faltando | perigo |
| Custo: Sem compra | neutro |
| Custo: Informado | info |
| Custo: Divergente | aviso |

### Cadastros e acesso
| Situação | Cor |
|---|---|
| Ativo (usuário, cliente, fornecedor, funcionário, portal) | ok |
| Inativo (em qualquer cadastro) | neutro |
| Inativo no VB / Inativo na web (usuário) | neutro |
| Sem acesso à web | neutro |
| Demitido | neutro |
| Liberado | ok |
| Bloqueado | perigo |
| Portal: Convidado | aviso |
| Portal: Suspensa | perigo |
| Portal: Não liberada | neutro |

Decisão: "Inativo" é sempre neutro (não é erro). Vermelho fica para o que exige reação (Bloqueado, Suspensa).

### Leitura de PDF, auditoria do cálculo e Gestão
| Situação | Cor |
|---|---|
| Valor confirmado / item pronto para importar | ok |
| Inferido / item com valores a conferir | aviso |
| Não encontrado / Conflitante / item bloqueado | perigo |
| Fora do escopo | neutro |
| Cálculo: Calculando | aviso |
| Cálculo: Aplicado | ok |
| Cálculo: Simulado | info |
| Cálculo: Descartado | neutro |
| Cálculo: Erro | perigo |
| Gestão: Estourado / Alerta / alerta crítico | perigo |
| Gestão: Risco pelo ritmo / Atenção | aviso |
| Gestão: Dentro do orçado | ok |
| Gestão: Sem orçamento / Não calculável | neutro |
| Gestão: alerta informativo | info |

### Tipo de produto no orçamento
Tipo não é situação: fica **neutro** em todos (sem verde/vermelho). Se precisar distinguir, usar ícone, nunca perigo.

## 3. Pontos para o dono decidir

1. **Pronto = aviso (âmbar)** ou ok (verde)? A proposta usa âmbar porque ainda falta entregar; verde ficaria só para Entregue/Retirado.
2. **Cancelado = neutro** nos pedidos e perigo nas entregas: aceita a diferença?
3. **Inativo sempre neutro**, inclusive usuário e cliente (hoje vermelho em vários lugares).
4. Ajuste de estoque em **info** para diferenciar de Estorno (neutro).

## 4. Plano de aplicação (depois da aprovação)

1. Registrar a tabela acima no `DESIGN.md` e garantir um único `.selo` no `tema.css` (pílula, 5 cores).
2. Criar um mapa único situação → cor em JS compartilhado (ex.: `situacoes_cor.js`), usado por todas as telas, no lugar dos mapas duplicados
   (`ROT_ENTREGA`, `COR_SITUACAO`, `COR_SIT`, `corStatus`, `COR_CLASSE`).
3. Trocar telas na ordem: Pedidos/Início/Painel/Calendário, Entregas e Clientes, Financeiro, Estoque, cortes, cadastros, portal.
4. Remover `.selo` duplicado inline, hex/hsl fixos e variáveis locais de cor (`--ok/--erro/...`).
5. Teste que falha se aparecer situação sem cor mapeada ou cor fora das cinco classes.
