# Pedidos a fornecedor (a partir do Estoque) — desenho

Data: 2026-11-26. Situação: aprovado pelo dono em 2026-11-26.

Marcação: **[dono]** = dito ou escolhido pelo dono; **[proposta]** = preenchido por quem escreveu, o dono pode trocar.

## 1. Intenção

**[dono]** Hoje a falta de material é percebida numa análise semanal do estoque, olhando o que mais sai. Em geral uma pessoa faz isso (não é regra). Os itens vão para uma lista, salva em PDF e enviada ao fabricante por e-mail. O que costuma dar errado: a conferência humana do estoque às vezes falha. O sistema deve **acompanhar a chegada** do que foi pedido.

Sucesso: o sistema aponta o que precisa ser pedido, a pessoa confere, gera o PDF e depois sabe o que está a caminho, o que chegou e o que falta, sem digitar a chegada duas vezes.

## 2. Objetivos e o que fica de fora

Objetivos:
- Lista sugerida de itens a pedir, por fornecedor.
- Montar, salvar, editar e gerar o PDF do pedido.
- Acompanhar a chegada pela entrada de nota que já existe.

Fora desta entrega: **[proposta]** envio de e-mail pelo sistema (só 2 dos 19 fornecedores usados no estoque têm e-mail cadastrado); preços, totais e conta a pagar; cotação entre fornecedores; importar os pedidos antigos do VB; atualização automática por tempo ou aviso em segundo plano.

Seria uma falha mesmo funcionando: um item em falta não aparecer na sugestão; um item já pedido ser sugerido de novo; a chegada exigir um segundo lançamento; a entrada de estoque passar a falhar por causa dos pedidos sem desfazer tudo junto.

## 3. Restrições

- Regras do projeto: `CLAUDE.md` (rotas por `registro.rota` com permissão, `DESIGN.md`/`tema.css`, tabelas só da web em `web_*` criadas por `seguranca/instalacao.js`, gravações de estoque em transação, consultas independentes em paralelo, cabeçalho fixo nas listas, informação analítica atrás do olho).
- A solução é só para a web; o VB não é referência.
- **[dono]** Ninguém dá nem desfaz entrada de estoque pelo VB: toda nota passa pela web.
- **[dono]** É raro a nota vir de um cadastro diferente do fornecedor do pedido: a baixa exige o mesmo fornecedor; nos casos raros usa-se "Encerrar".
- Quem não tem `valores.ver` não recebe dinheiro (aqui não há dinheiro).
- Fatos medidos no banco em 2026-11-26: 346 itens ativos; todos com `FORNECEDOR`; 112 com `MIN_ESTOQUE` > 0; 189 com `COD_FORNECEDOR`; os 19 fornecedores casam com `cadastro_fornecedores.RAZAO_FABRICANTE`; `estoque.AGUARDANDO` é `varchar(10)` com valores `NULL`, `''` ou `'Aguardando'` (22 itens); `entrada_estoque.QTD` é inteiro.

## 4. Abordagens

Como registrar a chegada:
- **A. Marcada no próprio pedido.** Simples, não toca na entrada; exige digitar a chegada duas vezes e depende de lembrar.
- **B. Reconhecida pela entrada de nota.** Uma digitação só; exige tratar também o desfazer da entrada. **Escolhida [dono]**, porque não depende de a pessoa lembrar, que é a falha de hoje.
- **C. "Receber" no pedido faz a entrada.** Um lugar só; cria um segundo caminho de entrada, com risco de estoque em dobro.

Onde guardar: tabelas novas `web_*` (escolhidas) ou as `pedido_fabricante*` do VB (descartadas: presas ao formato do VB, que não é mais referência). Os pedidos antigos continuam lá, sem alteração.

## 5. Como funciona

### 5.1 Tela
**[proposta]** Página nova `pedidos_compra.html`, aberta por um botão "Pedidos a fornecedor" junto das abas de `estoque.html`. Duas visões:

```
Pedidos                                         [Novo pedido]
Nº   Fornecedor     Criado   Enviado  Situação        Itens
12   Fornecedor X   20/11    20/11    Chegou em parte   2

Novo pedido                    Fornecedor: [ ........ v ]
[x] Cód  Produto   Estoque  Mínimo  Acaba em  A caminho  Pedir
[x] 120  Perfil A     4       10     6 dias       0      [ 20 ]
[ ] 133  Roldana B   35        —    12 dias      50      [    ]
[+ Adicionar item]  Observação: [....]   [Salvar]  [Gerar PDF]
```

Ao escolher o fornecedor, a lista mostra também quantos itens sugeridos cada fornecedor tem, para a pessoa saber por onde começar.

### 5.2 Sugestão **[proposta]**
Só itens ativos do fornecedor escolhido. Entra na sugestão o item que:
1. tem mínimo > 0 e estoque ≤ mínimo; ou
2. pelo consumo, está com alerta `comprar` (cobertura ≤ prazo de reposição, padrão 15 dias); ou
3. está zerado e teve saída nos últimos 12 meses.

Consumo, cobertura e prazo vêm das mesmas contas de `calcularAnalises` (`rotas/estoque_analises.js`, janela de 90 dias), sem duplicar a lógica.

Quantidade sugerida = o maior entre `mínimo − estoque` e `consumo por dia × (prazo + 30 dias) − estoque`, menos o que já está a caminho, arredondado para cima. Se der zero ou menos, o campo fica vazio. É sempre editável.

Item com algo a caminho que cobre a necessidade aparece desmarcado, mostrando a quantidade a caminho. **[proposta]** Também aparecem desmarcados, com aviso: item que está num rascunho ("em rascunho nº X") e item marcado `Aguardando` sem pedido na web ("marcado como aguardando fora destes pedidos"), para não comprar em dobro. Os demais sugeridos vêm marcados. "Adicionar item" aceita qualquer item ativo do estoque.

### 5.3 Situações do pedido
`rascunho` → `enviado` → `parcial` → `recebido`; mais `encerrado` e `cancelado`.
- Rascunho: pode editar e excluir; não conta como "a caminho".
- **[proposta]** Ao gerar o PDF de um rascunho, a tela pergunta "Marcar como enviado?"; há também o botão "Marcar como enviado". A lista destaca rascunhos esquecidos. Entrada dada antes de marcar como enviado não é descontada depois (resolve-se com "Encerrar").
- Enviado: itens não são editados. Para corrigir, cancela e cria outro.
- Cancelar: só se nada chegou (o pedido não vale). Encerrar: em pedido `enviado` ou `parcial`, quando o restante não vem ou chegou sem passar pela entrada de nota.
- Cada mudança guarda quem e quando.

### 5.4 PDF **[proposta]**
Gerado no servidor (pdfkit, logo da empresa): número, data, fornecedor, e por item o código no fornecedor, o nome no fornecedor (ou o nome da casa se vazio), quantidade, unidade do estoque; observação no fim. **Sem preços.**

### 5.5 Chegada pela entrada de nota
Dentro da mesma transação de `POST /estoque/entrada` (que já serve a entrada manual e a por XML):
- pega os pedidos `enviado`/`parcial` do **mesmo fornecedor da nota**, criados até a data da nota (nota antiga não baixa pedido novo);
- para cada produto da nota, desconta do saldo dos pedidos, do mais antigo para o mais novo; o que passar do pedido é ignorado;
- grava cada desconto (item do pedido, nota, fornecedor, quantidade) para poder desfazer;
- recalcula a situação do pedido;
- a resposta diz quais pedidos foram atualizados, e a tela de entrada mostra isso.

`POST /estoque/entrada/desfazer` apaga os descontos daquela nota e recalcula situação e saldo. Pedido encerrado ou cancelado não muda de situação.

Quem dá entrada não precisa ter permissão de pedidos: a baixa do saldo é automática.

**[proposta]** Fora desse caminho, não há baixa manual de chegada: material que não passa por entrada de nota é resolvido com "Encerrar".

### 5.6 "Aguardando" no estoque
`estoque.AGUARDANDO` passa a ser gravado pela web (escrita em tabela compartilhada): `'Aguardando'` quando há saldo a caminho em pedido enviado, `''` quando deixa de haver. Recalculado ao enviar, cancelar, encerrar, dar entrada e desfazer entrada. A entrada hoje limpa a marca sempre; passa a mantê-la se ainda houver saldo. Itens marcados pelo VB sem pedido na web seguem como hoje (a primeira entrada limpa).

A coluna "Aguardando" da lista do estoque mostra a quantidade a caminho quando houver pedido na web; senão, o texto que estiver gravado.

### 5.7 Quantidades
Inteiras e maiores que zero. O pedido guarda e controla tudo na unidade do estoque (a mesma que a entrada soma).

**Embalagem [dono]:** às vezes o fornecedor vende uma caixa de 50 e o estoque é em unidades.
**[proposta]** Cada item do pedido tem "unidades por caixa" (inteiro, padrão 1 = avulso), editável:
- preenchido com o último valor usado num pedido da web para o mesmo fornecedor e produto; se não houver, com o `fator` inteiro maior que 1 que a entrada por XML já aprendeu (`web_estoque_ligacoes`, o mais recente do fornecedor e produto; a entrada calcula quantidade da nota × fator); senão 1;
- com mais de 1, a pessoa digita **número de caixas**, a tela mostra o total ("2 caixas × 50 = 100 un") e a sugestão arredonda para cima em caixas inteiras;
- o PDF mostra "2 caixas com 50 (100 un)";
- a chegada continua descontada em unidades, então receber caixa incompleta fica "Chegou em parte".

### 5.8 Dados novos
- `web_pedidos_compra`: número (automático), fornecedor, situação, observação, datas e autores.
- `web_pedidos_compra_itens`: pedido, código do produto, cópia dos nomes/código do fornecedor/unidade, quantidade (unidades do estoque), unidades por caixa.
- `web_pedidos_compra_baixas`: item do pedido, nota, fornecedor, quantidade.

### 5.9 Permissões **[proposta]**
- `compras.ver`: ver pedidos, sugestão e PDF.
- `compras.criar`: criar, editar, excluir rascunho, enviar, encerrar, cancelar.

As duas também exigem `estoque.ver` e **não** são "só administrativas": quem monta o pedido vê dias de cobertura sem precisar de `administrativo.ver`. Na instalação, vão para os perfis e usuários que já têm `estoque.editar`.

## 6. Verificação
Testes `node:test` com banco falso para: regra de sugestão, mudanças de situação, baixa pela entrada (em parte, total, excedente, vários pedidos), desfazer, marca "Aguardando" e permissões. Tela conferida no navegador. Atualizar `CLAUDE.md` e criar `docs/regras/pedidos-compra.md`.

## 7. Fica a cargo de quem constrói
Nomes de rotas e arquivos, índices, detalhes de layout dentro do `DESIGN.md` e textos de mensagens.
