# Portal do cliente e revisão de segurança — especificação

Data: 2026-11-03. Status: aguardando revisão do dono.

## 1. Objetivo

Abrir o sistema web para **clientes**: cada empresa (CNPJ) tem usuários próprios, vê só os próprios dados e o **administrador geral** da empresa cria os demais usuários e define o que cada um vê. Como passam a circular dados pessoais (LGPD), o sistema atual passa por uma revisão de segurança antes de qualquer cliente entrar.

Critério de sucesso: um usuário de uma empresa não consegue, por nenhum caminho (URL, número de pedido, chave de DANFE, código de cliente), ler dado de outra empresa nem de uso interno; e o sistema atual não aceita usuário externo em nenhuma rota de funcionário.

## 2. Decisões do dono

- Escopo da v1 do cliente: ver pedidos e status, baixar PDFs e notas (DANFE), ver financeiro; administrador geral por CNPJ cria usuários e permissões.
- **1 cadastro de `cadastro_clientes` = 1 empresa.** Matriz e filial com CNPJs diferentes são empresas separadas. Grupos de vários cadastros ficam fora.
- Entrada por **convite da equipe**, login por e-mail e senha, **2º fator obrigatório** (aplicativo TOTP).
- Abordagem A: **portal separado no mesmo servidor** (`/portal/*`), com filtro obrigatório por empresa. Rejeitadas: reaproveitar as rotas atuais com perfil "Cliente" (uma rota esquecida vaza tudo) e serviço/banco separados (custo e sincronização excessivos agora).
- E-mail dos convites: `portal@elegancealuminio.com.br` (conta da UOL criada só para isso). Credenciais só em variáveis do Render.
- **A senha do MySQL fica inalterada por enquanto** (decisão do dono, 2026-11-03). Ver risco na seção 8.

## 3. Resultado da auditoria do sistema atual

Relatório completo (arquivo:linha, como explorar, correção): `auditoria_seguranca.md` (da sessão de 2026-11-03). Resumo. Verificados à mão: A1 (histórico e `.rar`). Os demais vêm da auditoria e devem ser confirmados ao corrigir (cada correção começa por um teste que reproduz o problema).

Bloqueiam abrir para clientes:
- **A1 crítica:** senha do MySQL no histórico do git (commit `3a9995f` em diante, `DB_PASS ||` em `index.js`) e no `APP_SITE.rar`, que **está rastreado** no git (o CLAUDE.md dizia o contrário). HostGator aceitaria qualquer IP.
- **A2 crítica:** não existe "dono" do registro. Rotas conferem permissão + UF; um externo com `pedidos.ver`, `pedidos.pdf`, `danfe.ver` ou `clientes.*` leria dados de todos (ex.: `/dados_pdf`, `/ped_orc/:tipo/:numero`, `/danfe/:chave/pdf`, `/clientes/*/:codigo`, `/dados_clientes`).
- **A3 alta:** cliente ligado a pedido e financeiro por `RAZAO_SOCIAL` (`JOIN_CLIENTE`, financeiro), e `/clientes/salvar` permite renomear.
- **A4 alta:** `ADMIN_KEY` redefine qualquer senha, sem rate limit e sem comparação em tempo constante.
- **A5 alta:** `/migrar_senhas` transforma senha NULL em "null".
- **A6 alta:** token em `localStorage` (origem `thiagozmb.github.io` compartilhada), CSP com `'unsafe-inline'` e jsDelivr inteiro, logout sem revogação (JWT de 8 h).
- **A8 alta:** MySQL remoto sem TLS.
- **A9 alta:** `valores.ver` tudo ou nada; `redeDeValores` filtra por nome de campo; comissão, crédito e `OBS_GERAL` aparecem; leitura de dados pessoais e login não são auditados.
- **A7 média:** enumeração de usuários pelo tempo do login; limite só por IP.

Depois: erros com stack trace e `detalhe: err.message` (~15), `npm audit` (body-parser, qs, ip-address), serviço local da porta 3917 sem pareamento, 403 x 404 que revela números existentes, `PUT /produtos/imagem` sem validar bytes. Conferir no banco se algum usuário antigo que é cliente recebeu "Interno completo" na migração.

Sem achado: SQL injection, XXE, SSRF, path traversal, escalada em `rotas/admin.js`. Front (~260 `innerHTML`) não foi revisado um a um.

Não verificado: variáveis do Render, painel do HostGator, visibilidade do repositório, banco real.

## 4. Etapas e ordem

Cada etapa tem plano e testes próprios. O endurecimento vem primeiro.

1. **Endurecimento do sistema atual** (seção 5).
2. **Fundação da identidade externa** (seção 6).
3. **Portal de leitura** (seção 7).
4. **Gestão de usuários pelo administrador geral** (seção 6.5).

Nenhum cliente real entra antes das etapas 1 a 3 e da seção 8.

## 5. Etapa 1 — endurecimento

1. **Barreira central:** `registro.rota` recusa token com `tipo: 'cliente'` em toda rota de funcionário; `registro.publica` e as rotas `/portal/*` têm regra própria. Teste que enumera todas as rotas registradas e falha se uma aceitar token de cliente.
2. **Ligação por código:** `JOIN_CLIENTE` e o financeiro passam a usar `CODIGO`/chave estável; o `ped_orc` só guarda `RAZAO_SOCIAL`, então a ligação é por nome **só quando o nome é único** em `cadastro_clientes`, com teste de duplicado e de renomeado. Renomear cliente com histórico exige confirmação e é auditado.
3. **Rotas de administração:** `ADMIN_KEY` com rate limit e comparação em tempo constante; `/migrar_senhas` ignora senha NULL/vazia; ambas desligadas por padrão depois da migração inicial (variável explícita para ligar).
4. **Sessões revogáveis de funcionário:** tabela de sessões, logout real, troca de senha derruba as demais. Desligar a sessão por JWT puro (`v: 2`) com período de convivência.
5. **Login:** tempo de resposta igual com usuário inexistente (hash falso), limite por conta e por IP, todo login (sucesso e falha) na auditoria.
6. **Erros:** tratador global sem stack nem `err.message`; remover os `detalhe:`; `npm audit fix` e teste.
7. **TLS no MySQL:** testar se o HostGator oferece e, só então, tornar obrigatório.
8. **Serviço local 3917:** segredo de pareamento entre site e serviço.
9. **Dados do VB:** conferir usuários que são clientes; corrigir perfil.
10. **Fora do código (dono):** troca da senha do MySQL, restrição de IP, limpeza do histórico do git e remoção do `.rar` (reescrever histórico é destrutivo: só com confirmação explícita), conferir a visibilidade do repositório.

CSP sem `'unsafe-inline'` vale para as páginas novas; nas antigas é meta gradual (muito `innerHTML` e handlers inline).

## 6. Etapa 2 — identidade externa

### 6.1 Tabelas (todas `web_portal_*`, sem FK para o VB, o VB não é alterado)
- `web_portal_empresas`: `cliente_codigo` único (= `cadastro_clientes.CODIGO`), situação `ativa|suspensa`, liberado_por/em.
- `web_portal_usuarios`: e-mail único (minúsculo), hash bcrypt, `cliente_codigo`, papel `admin_geral|usuario`, situação, segredo TOTP **criptografado**, contadores de falha e bloqueio, `senha_alterada_em`, aceite do termo (versão e data).
- `web_portal_permissoes`: usuário + código (`pedidos.ver`, `documentos.ver`, `financeiro.ver`).
- `web_portal_convites`: **só o hash** do token, validade 48 h, uso único, quem convidou, papel.
- `web_portal_sessoes`: id, usuário, criado, expira, IP, revogada.
- `web_portal_auditoria`: tipo de evento, usuário, empresa, IP, objeto acessado; sem CPF, e-mail completo, valores nem tokens.

### 6.2 Autenticação
- Token com `tipo: 'cliente'`, `issuer` próprio e id de sessão; sessão conferida no banco a cada requisição; cookie `HttpOnly; Secure; SameSite=Strict`, sem token no `localStorage`.
- Senha de 12 caracteres ou mais, bcrypt, bloqueio gradual, mesma mensagem para usuário inexistente e senha errada, tempo igual.
- 2º fator TOTP obrigatório para todos; códigos de recuperação de uso único mostrados uma vez; reinício de 2º fator só pela equipe (administrador geral não reinicia o próprio).
- Convite: a equipe cadastra o e-mail do administrador geral da empresa; link de uso único; o administrador geral convida os demais.

### 6.3 Empresa só é liberada se
o nome em `cadastro_clientes` for único e a empresa estiver `ativa`. Empresa `suspensa` derruba todas as sessões na hora.

### 6.4 E-mail
SMTP da conta `portal@elegancealuminio.com.br`; variáveis `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` (e remetente) só no Render. Sem elas o portal avisa "convite por e-mail não configurado" e a equipe pode copiar o link manualmente. Nova dependência (cliente SMTP) com versão fixada.

### 6.5 Etapa 4
O administrador geral cria, edita, desativa usuários e escolhe as permissões da própria empresa; nunca concede além do que a empresa tem, nunca vê outra empresa, e não se rebaixa nem se desativa se for o último administrador geral. Toda mudança é auditada.

## 7. Etapa 3 — portal de leitura

- Rotas `/portal/*`, uma por função, cada uma com consulta escrita só para o cliente e **lista fechada de campos**; `cliente_codigo` vem sempre da sessão, nunca da requisição.
- Pedidos e status: pedido (não orçamento), situação, datas, entrega (status e data), sem custo, comissão, crédito, observações internas ou dados de outros clientes.
- Documentos: PDF do pedido e DANFE só se o pedido pertencer à empresa; outro dono e inexistente respondem **404 idêntico**. Cada abertura é auditada.
- Financeiro: títulos do cliente (situação, vencimento, valor, pagamentos); permissão `financeiro.ver`.
- Nomes de campo seguem a regra do projeto sobre dinheiro (`seguranca/valores.js`); como aqui o cliente vê os **próprios** valores, a rede de valores não se aplica ao portal, mas a lista fechada de campos sim.
- Telas: HTML/CSS/JS puro como o resto, com CSP sem `'unsafe-inline'`, sem `innerHTML` com dado do servidor (texto por `textContent`).

## 8. Riscos aceitos e condições

- **Senha do MySQL inalterada (decisão do dono).** Enquanto o histórico/`.rar` do git tiver a senha e o banco aceitar qualquer IP, qualquer pessoa pode acessar o banco do VB direto, contornando o portal. O isolamento por empresa só protege depois da troca da senha, restrição de IP e limpeza do histórico. **Condição para o primeiro cliente real entrar.**
- Segundo fator por aplicativo exige que o cliente tenha um; o suporte a quem perde o aparelho passa pela equipe.
- O serviço local de PDF/SEFAZ não é exposto ao portal.

## 9. LGPD

- Minimização por lista de campos; registro de acesso (quem, quando, IP) de PDF, DANFE e financeiro, retenção de 12 meses.
- Termo de uso e aviso de privacidade aceitos no primeiro login, com versão e data (o texto jurídico é de responsabilidade do dono).
- Direitos do titular: a equipe exporta e elimina os dados de um usuário do portal; dados fiscais e de pedido seguem a retenção legal e não são apagados.
- Incidente: comando para suspender uma empresa e para revogar todas as sessões; roteiro curto de resposta; decidir aviso à ANPD é jurídico.
- Logs sem dado pessoal, valor, chave ou token.

## 10. Testes

`node:test` com banco falso, como o resto (`test/apoio/`). Obrigatórios: token de cliente recusado em todas as rotas de funcionário (enumerando o registro); isolamento entre duas empresas em cada rota do portal; 404 uniforme; nome duplicado bloqueia a liberação; convite expira e só usa uma vez; bloqueio de login e tempo igual; sessão revogada deixa de valer; último administrador geral não se remove; lista fechada de campos (nenhum campo fora dela na resposta). **Não testáveis aqui:** SMTP real, MySQL real, TLS do HostGator, navegador real, SMB; ficam registrados como não testados.

## 11. Fora da v1

Criar orçamento ou pedido pelo cliente, notificação por e-mail de pedido pronto, grupos de CNPJ (matriz + filiais), login social, SMS, e recuperação de senha pelo próprio usuário (na v1, quem esquece a senha pede ao administrador geral, e o administrador geral pede à equipe, que gera um novo convite).

## 12. Perguntas em aberto

- Endereço do servidor SMTP da UOL e porta (a confirmar no painel).
- Se o HostGator oferece TLS para MySQL remoto.
- Visibilidade do repositório no GitHub.
- Texto do termo de uso e do aviso de privacidade.
