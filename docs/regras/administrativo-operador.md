# Administrativo × Operador (permissão-chave `administrativo.ver`)

Decisão do dono em 2026-11-10: o sistema se divide em duas classes de usuário.

1. **Administrativo**: vê gráficos, indicadores, resumos e totais, telas de gestão e **dinheiro**.
2. **Operador**: faz saída de estoque, atualiza status/etapas, entregas etc. e **não recebe nenhuma informação administrativa**.
3. **Só valores** (terceira situação, decidida junto): Vendedor e Representante precisam ver preço para montar orçamento, mas não são administrativos.

Implementado **sem campo novo no usuário**: a classe é derivada das permissões finais (`classeDoAcesso` em `seguranca/permissoes.js`) e só é exibida na tela de usuários (coluna "Classe").

## A regra (uma só, no servidor)

`permissoesFinais` (`seguranca/permissoes.js`), depois de somar perfil e exceções:

- **Com `administrativo.ver`** → o usuário ganha `valores.ver` junto (administrativo vê dinheiro).
- **Sem `administrativo.ver`** → as permissões da lista `PERMISSOES_ADMINISTRATIVAS` **somem**, venham do perfil ou de exceção "liberar": `paineis.ver`, `indicadores.ver`, `financeiro.ver/lancar/excluir`, `gestao.ver/editar`, `precos.ver/editar/gravar`, `clientes.receber`, `clientes.credito`.
- **`valores.ver` NÃO está na lista**: continua valendo sozinha (Vendedor e Representante). Quem não tem nenhuma das duas é operador.

Como o menu, as telas e `registro.rota(...)` já usam essas permissões, tudo que dependia delas fica administrativo de uma vez (Início, Financeiro, Custos e preços, Central de Gestão, indicadores do painel).

## Rotas e telas que NÃO eram protegidas por permissão administrativa e agora exigem a chave

| Onde | Antes | Agora |
|---|---|---|
| `GET /ranking_produtos`, `/ranking_clientes`, `/dados_compras_orcamentos` | `pedidos.ver` ou `clientes.ver` | + `administrativo.ver` |
| `GET /clientes/analise/:codigo` e `cliente_analise.html` | `clientes.ver` (+ valores) | + `administrativo.ver` |
| `GET /estoque/analises` e `PUT /estoque/analises/prazo/:codigo` (curva ABC, previsão de falta, itens parados) | `estoque.ver` + movimentar | + `administrativo.ver` |
| `GET /estoque/movimentacao` (gráfico entradas × saídas do item) | `estoque.ver` | + `administrativo.ver` |
| `GET /estoque/resumo` | todos recebiam totais e contagens | **sem a chave só os filtros** (`classes`, `unidades`, `fornecedores`); com a chave, também `valorTotal`, `ativos`, `falta`, `minimo` |
| `graficos_pedidos.html` | `pedidos.ver` | + `administrativo.ver` |
| `estoque.html` | cartões de resumo, gráfico do item e aba Análises para todos | `data-perm="administrativo.ver"` |
| `movimentacao_estoque.html` | aba Análises para quem movimenta | `PERM_ABA.analises = 'administrativo.ver'` (inclui `?aba=analises`) |
| `painel_inicial.html`, `clientes.html` | gráficos e rankings para quem vê pedidos/clientes | `data-perm="administrativo.ver"` e **sem chamar o servidor** sem a chave (senão viria 403) |

O que continua para o operador: lista de itens do estoque e quantidade, saída/entrada, baixa por QR, lista de pedidos (sem valores), mudar situação, etapas, entregas.

## Perfis e migração

- **Administrador** e **Interno completo** têm a chave (vêm de `TODAS`).
- **Operador** é perfil novo (último de `PERFIS_INICIAIS`): `estoque.ver/movimentar`, `pedidos.ver/pdf/situacao`, as etapas (ver e as 6 OK), `entregas.ver`, `corte.ver`; **sem a chave e sem valores**. O dono ajusta na tela de usuários.
- **Vendedor, Representante e Estoquista** não mudam. Vendedor/Representante **perdem o Início** (`paineis.ver` é administrativa): entram direto em Pedidos e Orçamentos.
- Migração única `acrescentarPermissoesAdministrativo` (`seguranca/instalacao.js`, marca `permissoes_administrativo` na auditoria), chamada na subida do `index.js`: dá a chave ao Administrador, ao Interno completo, a **qualquer outro perfil que já tenha `financeiro.ver`, `gestao.ver` ou `precos.ver`** e, por exceção "liberar", a quem tem exceção dessas três (ninguém perde a gestão que já usa); cria o perfil Operador se não existir. A auditoria guarda `perfisComChave`, `usuariosComChave` e `operadorCriado`.
- Perfil personalizado criado pelo dono que usava `paineis.ver`/`indicadores.ver`/`clientes.receber`/`clientes.credito` **sem** financeiro/gestão/preços perde essas permissões até receber a chave (aparece como "Só valores" ou "Operador" na lista).

## Regras para quem mexer depois

- Informação administrativa nova (gráfico, resumo, total) **exige `administrativo.ver`** na rota (`registro.rota(..., [..., 'administrativo.ver'])`) e `data-perm="administrativo.ver"` na tela, e a tela não deve chamar a rota sem a chave.
- Dinheiro continua pelas regras de `valores.ver` (`semValores`, `redeDeValores`); a chave só traz `valores.ver` junto, não substitui `semValores`.
- Testes: `test/permissoes.test.js` (a regra), `test/administrativo_migracao.test.js` (migração e classe), `test/administrativo_telas.test.js` (telas), `test/rotas_mapa.test.js` e `test/estoque_analises.test.js` (rotas), `test/admin.test.js` (classe na lista de usuários).

**NÃO validado na prática** (o dono verifica com usuários reais): efeito nas telas de cada perfil, o login do Vendedor sem Início e o perfil Operador criado pela migração.
