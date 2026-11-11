# Dependências do perfil (produtos)

Código: `rotas/produtos_dependencias.js`; testes: `test/produtos_dependencias.test.js`; plano: `docs/plano_dependencias_produtos.md`.

## Exceção autorizada pelo dono (2026-11-11)
A web pode gravar nas tabelas do VB `perfis_permitidos`, `acabamentos_permitidos`, `puxadores_permitidos`, `revestimentos_permitidos` e
`divisores_permitidos`, **somente** por `PUT /produtos/:codigo/permitidos`, com auditoria. `modelos_permitidos_serralheria` e qualquer outra
tabela do VB continuam intocáveis.

## Rotas (permissão `produtos.dependencias`, só Administrador; não é permissão administrativa de dinheiro)
- `GET /produtos/:codigo/permitidos`: `{ codigo, modelo, permitidos, opcoes }` com os 5 grupos (`tiposProduto`, `acabamentos`, `puxadores`, `revestimentos`, `divisores`).
- `PUT /produtos/:codigo/permitidos`: corpo com qualquer subconjunto dos 5 grupos (arrays de texto). Grupo ausente = não mexe.

## Regras do PUT
- A chave das tabelas é o MODELO do cadastro (`codigo` -> `MODELO`, como em `GET /produtos/item`); só esse MODELO é tocado (DELETE + INSERT).
- Uma transação (`emTransacao`, nova tentativa em deadlock), linha do cadastro travada com `FOR UPDATE`; falha = rollback de tudo.
- Valor válido = está nas opções do grupo ou já estava marcado neste perfil (sem diferenciar maiúsculas; grava a grafia canônica). Inválidos: 400 com `invalidos` por grupo.
- Texto com trim, sem duplicar; no máximo 500 itens por grupo e 100 caracteres por item.
- Lista vazia exige `confirmarVazio: true` (vale para todos os grupos vazios) ou `confirmarVazio: { grupo: true }`; senão 400 com `gruposVazios`.
- Grupo sem mudança real não é regravado. Se algo mudou, `web_auditoria` recebe `produto_dependencias_gravadas` (alvo = código, detalhe com `modelo` e `antes`/`depois` por grupo; `quem` = usuário).

## Opções disponíveis
- Tipos de produto: valores distintos de `perfis_permitidos.TIPO_PRODUTO`. Acabamentos: tabela `acabamentos`.
- **Limitação:** não há critério de classe confiável para puxador, revestimento e divisor; as opções são os valores já usados na respectiva tabela `*_permitidos` que ainda são produtos ativos em `cadastro_de_produtos`. Um puxador/revestimento/divisor nunca usado por nenhum perfil não aparece para marcar (um tipo de produto novo também precisa já existir em algum perfil).

## Migração
`acrescentarPermissoesProdutosDependencias` (`seguranca/instalacao.js`) dá a chave ao Administrador uma vez (auditoria `permissoes_produtos_dependencias`); Interno completo não recebe.

## Tela (etapa 3, 2026-11-11): aba "Permissões" de `produtos.html`
Código: `produtos_dependencias_tela.js` (lógica pura, global `ProdutosDependenciasTela`; teste `test/produtos_dependencias_tela.test.js`) + bloco "DEPENDÊNCIAS DO PERFIL" em `produtos.html`.
- Só com `produtos.dependencias` (container `#dep-editor` com `data-perm` + `Acesso.pode`) e só em produto já salvo; sem a chave ou em cadastro novo continua a exibição somente leitura (`renderPermissoes`).
- 5 grupos com caixas de marcar, busca por grupo (sem acento), contador "X marcados", marcados no topo (ordem fixada ao carregar/copiar, não pula a cada clique), valores gravados fora das opções continuam aparecendo ("fora das opções").
- "Copiar de outro perfil": a lista de origem são os produtos da mesma classe do perfil aberto; carrega o GET do outro e aplica só na tela, por grupo ou todos. Valores do outro perfil que este não aceitaria (fora das opções e não gravados) são ignorados e avisados, para o PUT não dar 400.
- Resumo ao vivo (`aria-live`) com "+ adicionados" e "− removidos" por grupo; "Salvar dependências" desabilitado sem mudança; o PUT leva só os grupos alterados. Confirmação na janela do tema listando os removidos; grupo que ficaria vazio tem confirmação própria e vai com `confirmarVazio: { grupo: true }`.
- Erro do servidor (400 inválidos/gruposVazios, 403, 404, 409, 5xx) vira mensagem em português e as marcações ficam. Após salvar, relê o GET, atualiza `acabamentosDoProduto` e a exibição somente leitura.
- Trocar de produto com dependências alteradas e não salvas pede "Descartar alterações?". Os eventos do editor não marcam o formulário do produto como alterado (o botão "Salvar" da ficha não participa).
- **Não verificado em navegador real.**
