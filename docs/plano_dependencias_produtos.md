# Plano: controle de dependências do produto dentro do sistema

Hoje as dependências são editadas direto no MySQL (trabalhoso e perigoso). A web só LÊ:
`GET /produtos/item/:codigo` (index.js ~1482-1495) devolve `permitidos`, e `produtos.html` (~1038) só exibe.
O orçamento usa as listas em cascata (`QUERIES_FILTRO`, index.js ~1138).

## Mapa das tabelas (todas do VB, chave = MODELO do `cadastro_de_produtos`)
| Tabela | Colunas | Significado |
|---|---|---|
| `perfis_permitidos` | MODELO, TIPO_PRODUTO | tipos de produto em que o perfil pode ser usado |
| `acabamentos_permitidos` | MODELO, ACABAMENTO | acabamentos que o perfil aceita (acabamento vem de `acabamentos`) |
| `puxadores_permitidos` | MODELO, PUXADOR_PERMITIDO | puxadores aceitos pelo perfil |
| `revestimentos_permitidos` | MODELO, REVESTIMENTO_PERMITIDO | revestimentos aceitos |
| `divisores_permitidos` | MODELO, DIVISOR | divisores aceitos |
| `modelos_permitidos_serralheria` | MODELO, PRODUTO | materiais da serralheria por produto |

Cadeia: tipo de produto -> perfil -> (acabamento, puxador, revestimento, divisor).
Obs.: `acabamentos_permitidos` é por MODELO, não por tipo.

## Status
- Etapas 1 e 2: **feitas** (2026-11-11, sem tela) em `rotas/produtos_dependencias.js`; dono autorizou a escrita nas 5 tabelas (decisão abaixo respondida: sim). Regras: `docs/regras/produtos-dependencias.md`.
- Etapa 3 (tela em `produtos.html`): **feita** (2026-11-11), `produtos_dependencias_tela.js`; não verificada em navegador real.
- Etapas 4 e 5: pendentes. O "desfazer" da etapa 4 pode usar o antes/depois já gravado em `web_auditoria` (`produto_dependencias_gravadas`).

## Etapas
1. **Permissão + leitura segura** (pequena): chave nova `produtos.dependencias` em `seguranca/permissoes.js`
   (Administrador). Rota de leitura por perfil com as 5 listas + opções disponíveis para marcar.
2. **Gravar por perfil, tudo ou nada**: `PUT /produtos/:codigo/permitidos` em transação (DELETE+INSERT
   só do MODELO), valida que cada valor existe no cadastro, auditoria (`web_auditoria`) com antes/depois,
   sem apagar nada de outro perfil. Teste com banco falso.
3. **Tela** na aba do perfil em `produtos.html` (já mostra `permitidos`): marcar/desmarcar, "copiar de outro perfil",
   resumo do que muda, confirmação. Seguir DESIGN.md/tema.css.
4. **Segurança de dados**: avisar quando a remoção afeta pedidos/orçamentos já salvos (só avisa, nunca apaga item),
   desfazer da última gravação (guardar o antes em `web_*`).
5. **Visão por tipo/acabamento** (opcional): editar do outro lado ("este tipo aceita estes perfis"),
   perfis sem nenhum tipo (o log já avisa em index.js ~1220) e relatório de inconsistências.

Decidir com o dono antes da etapa 2: pode a web gravar nessas tabelas do VB (regra do CLAUDE.md: não mudar dados
do banco compartilhado sem combinar)? Recomendação: sim, só por esta rota, com auditoria e desfazer.
