# Livro de regras de orçamentos e pedidos — design

Data: 2026-11-23. Escolha do dono: caminho **A** (livro único no servidor, tela consulta; limites como constantes nomeadas, prontas para virar tabela editável depois).

## Intenção

Hoje as proteções de orçamento/pedido estão espalhadas: `alert`/`confirm` escritos à mão em `adicionarItem()` (`orcamentos.html`) e só o básico em `validar()` (`rotas/ped_orc.js`). Quem chama a API sem a tela passa por tudo. O dono quer um **Livro de regras**: lugar único onde cada regra tem código, nível de rigor e mensagem, aplicado na tela **e** no servidor, e fácil de ampliar (o dono vai trazer mais regras depois).

## Objetivos

- Uma lista única de regras em módulo puro (`calculo/regras_item.js`), com testes.
- Três níveis de rigor por regra: `bloqueia` (não adiciona/não salva), `confirma` (pergunta; o usuário decide), `avisa` (alerta; pode seguir).
- A tela consulta o servidor ao adicionar o item; o servidor reaplica ao salvar.
- Regra nova = uma entrada nova na lista (código, nível, frentes, condição, mensagem) + teste. Sem mexer em rota nem tela.
- Página "Livro de regras" só de leitura, gerada da própria lista (nunca desatualizada).

## Não objetivos

- Editar regras ou limites pela tela (caminho B): fica para depois. Os limites ficam em `LIMITES` (constantes nomeadas num lugar só) para a migração ser simples.
- Mudar qualquer cálculo de preço. Regras só leem o item; nunca alteram valor.
- Revalidar documento/itens já gravados (itens com cadeado 🔒 ou cópias `ehCopia`).

## Anti-objetivos (seria falha mesmo funcionando)

- Travar a abertura ou a edição de pedido antigo por regra nova.
- Regra existir só na tela (contornável) ou escrita em dois lugares divergentes.
- Regra que "corrige" o item em silêncio.

## Abordagens consideradas

- **A (escolhida)**: livro no servidor, tela consulta, servidor reaplica. Uma fonte, sem contorno, regra nova barata.
- B: A + tabela `web_regras` editável. Mais construção (tela, auditoria, permissão); fica como evolução.
- C: mais `if` na tela. Descartada: contornável, espalhada.

## Desenho

**Módulo `calculo/regras_item.js` (puro, sem banco)**
- `LIMITES = { portaMedidaAlertaMm: 300, puxadorEmbutidoMinMm: 50, puxadorEmbutidoMaxMm: 400 }`.
- `REGRAS`: lista de `{ codigo, nivel, escopo: 'item'|'documento', frentes, verifica(item) -> mensagem|null }`.
- `avaliar(item) -> [{ codigo, nivel, mensagem }]` e `avaliarDocumento(corpo)`.
- Frentes de "porta": Porta de giro, Porta basculante, Frente de gaveta, Porta de Correr. Serralheria e Avulso ficam de fora das regras de porta.
- Item lido do formato que `coletarForm()` já envia: `detalhes.perfil/acabamento/cor/puxador/tipoPuxador/acabPux/corPux/tamanhoPux/todaExt/revestimento`, `altura`, `largura`.

**Rota `POST /regras/verificar_item`** (via `registro.rota`, permissão `orcamentos.criar`): recebe o item, devolve a lista de `avaliar`. Somente leitura, nada gravado.

**Tela (`adicionarItem`)**: depois das checagens locais atuais, chama a rota. `bloqueia` → alerta e para. `confirma`/`avisa` → pergunta com "Corrigir" / "Continuar assim"; o que for confirmado entra no item como `confirmacoes: [codigos]`. Falha de rede na consulta = não adiciona e mostra o erro (nunca segue sem consultar).

**Servidor (`validar()` em `rotas/ped_orc.js`)**: para cada item não-cópia, roda `avaliar`; `bloqueia` → erro 400 "Item N: mensagem"; `confirma` sem o código em `item.confirmacoes` → erro 400 pedindo confirmação; `avisa` não é exigido no servidor. Itens `ehCopia` e documentos de origem VB não são revalidados.

**Página `regras.html` (só leitura)**: lista código, nível, frentes e texto, lida de `GET /regras/livro` (mesma lista). Permissão `administrativo.ver`.

## Regras da primeira versão

| Código | Nível | Condição |
|---|---|---|
| `itens_minimo` | bloqueia | documento sem itens (já existe em `validar`, mesma mensagem; passa a constar no Livro) |
| `acabamento_perfil` | bloqueia | porta com perfil e sem acabamento (o divisor usa o acabamento do perfil: não tem campo próprio) |
| `acabamento_puxador` | bloqueia | porta com puxador e sem `acabPux` |
| `cor_obrigatoria` | bloqueia | acabamento "Pintura Metálica/Sólida" sem cor (perfil e puxador); tipo de cor vem de `tipoCorDoAcabamento` em `calculo/cores.js` |
| `sem_revestimento` | confirma | porta sem revestimento: "Sem revestimento escolhido. Inserir na lista mesmo assim?" |
| `porta_medida_pequena` | avisa | altura ou largura < 300 mm |
| `puxador_embutido_limites` | bloqueia | puxador `tipoPuxador` embutido com tamanho fora de 50–400 mm |
| `numero_inteiro` | bloqueia | qualquer campo de tamanho ou quantidade com vírgula, ponto ou não-dígito (lista na seção "Respostas da revisão") |
| `puxador_maior_que_porta` | bloqueia | tamanho do puxador > altura (ou largura, conforme a posição) da porta |

## Decisões do construtor (marcadas como chamada minha)

- "Toda extensão" (`todaExt`) só existe no puxador sobreposto e não tem tamanho digitado: a regra de tamanho do puxador não se aplica a ele (e o embutido nunca é "toda extensão").
- Qual dimensão da porta limita o puxador depende da posição/orientação do puxador; o construtor confere no código (`precos.js`, `descreverPosicoes`) e usa a mesma que o motor já usa. Se for ambíguo, usa a maior dimensão da porta.
- Mensagens em português, no estilo das do VB já existentes.

## Respostas da revisão (conferidas no código em 2026-11-23)

- **Tipo do item:** vem de `item.frente` (valores de `BADGE_FRENTE`: "Porta de giro", "Porta basculante", "Frente de gaveta", "Porta de Correr", "Serralheria", "Avulso"). Comparar sem diferenciar caixa; classificação em função própria com teste.
- **Formato no servidor:** `validar()` recebe o mesmo item que a tela envia (`detalhes` completo; confere na linha 175 de `rotas/ped_orc.js`). Sem conversão para o formato do banco antes, e sem esquema estrito (validação manual): campo `confirmacoes` passa.
- **Pedido antigo:** item não mexido chega com `origem.estado` em `intacto`, `so_pct` ou `travado` e já é tratado como cópia (`ehCopia`): não é revalidado. Item **novo ou editado** (`editado`) é revalidado. *Chamada minha:* se o usuário edita um item antigo, ele passa a seguir as regras.
- **`confirmacoes`:** lista de códigos; só vale para a checagem daquele salvamento, não é gravada. Item editado de novo pede confirmação de novo.
- **Puxador embutido:** comparar `tipoPuxador` contendo "embutido" sem diferenciar caixa (como `precos.js` faz). **Correção do dono (2026-11-23):** não existe "embutido total"; o "total" só existe no sobreposto ("Sobreposto Total"). Portanto o embutido nunca é "toda extensão" e a regra de 50–400 mm vale sempre para ele.
- **Números inteiros (regra do dono, 2026-11-23):** em nenhum campo de tamanho ou quantidade pode haver vírgula, ponto ou qualquer caractere que não seja dígito; só valores inteiros. Vale para `altura`, `largura`, `profundidade`, `tamanhoPux`, quantidades (`qtd`, `qtdAltura/Largura/Profundidade`, `divH`, `divV`, soldas, quantidade de peças e de acessórios, tamanho de acessório, furos, transpasse, larguras das folhas, medidas da serralheria e do avulso). Vira a regra `numero_inteiro` (nível `bloqueia`) e também trava a digitação na tela (`inputmode="numeric"`, só dígitos). Valor vazio não dispara a regra (a obrigatoriedade é de outras regras); valor com vírgula, ponto, sinal ou letra bloqueia. Vale só para itens novos/editados (itens antigos como cópia não são revalidados). **Não se aplica a dinheiro** (valor unitário, desconto %), só a tamanhos e quantidades.
- **Regra de documento (`itens_minimo`):** só no servidor; `GET /regras/livro` lista as duas escopos.
- **Permissão da consulta:** `orcamentos.criar`, a mesma das demais rotas da tela de orçamentos (`/ped_orc/acessorios_permitidos` etc.). Quem usa a tela já a tem.
- **Pequenos:** `regras.html` ganha entrada no menu (`layout.js`) e os testes de registro de rotas são atualizados.

## Fica para o construtor

Ordem exata das mensagens, nomes de arquivo de teste, texto dos botões, layout da página do Livro (segue `DESIGN.md` e `tema.css`).
