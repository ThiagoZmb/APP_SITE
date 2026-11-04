# Portal do cliente: configuração (passo a passo do dono)

Este guia liga o portal do cliente (etapa 2: só a **identidade**, ou seja, convite, senha, 2º fator e login). Depois de entrar, o cliente ainda não vê pedidos, notas nem financeiro: isso vem nas etapas seguintes.

Enquanto as variáveis abaixo não estiverem no Render, o portal fica desligado (responde "Portal não configurado.") e o resto do sistema funciona normalmente.

**Regra de ouro:** senhas e chaves **só no painel do Render**. Nunca no chat, nunca no git, nunca em e-mail.

## 1. Gerar a chave do portal (`PORTAL_CHAVE_CRIPTO`)

Num computador com Node.js, rode no terminal:

```
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Sai uma linha de 44 caracteres terminada em `=`. Essa é a chave.

- Guarde uma cópia **em local seguro** (gerenciador de senhas ou cofre da empresa), fora do git.
- **Perder ou trocar essa chave** invalida os segredos de 2º fator e os códigos de recuperação de todos os clientes. A saída, nesse caso, é reiniciar o 2º fator de cada usuário pela tela da equipe (seção 6) e eles configuram tudo de novo.

## 2. Definir o endereço do portal (`PORTAL_URL_BASE`)

É o endereço `https` do servidor no Render (o mesmo da API), **sem barra no final e sem caminho**. Exemplo de formato: `https://nome-do-servico.onrender.com`.

As páginas do cliente ficam em `PORTAL_URL_BASE/portal/login.html`, e o link do convite é montado a partir dele.

## 3. Configurar o e-mail (SMTP) da conta do portal

O e-mail do convite sai da conta `portal@elegancealuminio.com.br`. No painel do Render, em **Environment**, crie:

| Variável | O que é |
|---|---|
| `SMTP_HOST` | servidor de saída de e-mail |
| `SMTP_PORT` | porta (se não definir, vale 465) |
| `SMTP_USER` | usuário da conta (normalmente o próprio e-mail) |
| `SMTP_PASS` | senha da conta |
| `SMTP_FROM` | remetente (opcional; se faltar, usa `SMTP_USER`) |

- **Confirme o servidor e a porta no painel da UOL** (a spec deixa isso em aberto; não chute). A porta 465 usa conexão segura direta; outras portas funcionam, mas o sistema só liga a conexão segura direta na 465. Se a UOL pedir outra porta, avise o desenvolvedor.
- O e-mail só é ligado quando `SMTP_HOST`, `SMTP_USER` e `SMTP_PASS` estão preenchidos.
- Sem SMTP, o portal funciona do mesmo jeito: a tela da equipe mostra o **link do convite** para você copiar e mandar por outro meio.

## 4. Salvar e reiniciar

No Render, salve as variáveis (`PORTAL_URL_BASE`, `PORTAL_CHAVE_CRIPTO` e as `SMTP_*`) e aguarde o serviço reiniciar. Se faltar ou estiver inválida uma das duas primeiras, o portal continua desligado: a tela da equipe e as páginas do cliente recebem "Portal não configurado." e o log do Render, na subida, traz uma linha `[portal] desativado:` dizendo qual variável falta ou está inválida (o texto nunca repete o valor). Confira os nomes e os valores das duas variáveis.

## 5. Testar com um e-mail de teste

Antes de qualquer cliente real:

1. Entre no sistema como **Administrador** e abra **Usuários > Portal do cliente** (só o Administrador tem a permissão `portal.gerir`).
2. Escolha uma empresa de teste (veja a seção 6) e convide **um e-mail seu** (use letras sem acento).
3. Abra o e-mail (ou copie o link que a tela mostrar), crie a senha, configure o aplicativo autenticador, digite o código, aceite o termo e **guarde os 10 códigos de recuperação**. Eles aparecem uma única vez.
4. Entre em `/portal/login.html` com e-mail, senha e o código do aplicativo. Deve abrir a página "Início do portal" com o nome da empresa.
5. Teste "Sair" e entre de novo. Aguarde 60 minutos sem usar: a sessão deve expirar sozinha.

## 6. Liberar a primeira empresa

1. Em **Usuários > Portal do cliente**, busque o cliente pela razão social ou código e clique em **Liberar**.
2. **Nome duplicado:** a empresa só pode ser liberada se a razão social for **única** no cadastro de clientes (pedidos e financeiro se ligam ao cliente pelo nome) e não estiver vazia. Se o botão **Liberar** não aparecer, a própria tela **Portal do cliente** mostra o motivo na linha da empresa (por exemplo "mais de um cadastro com esta razão social" ou "O cadastro está sem razão social."). Corrija o cadastro e busque de novo. Para ver a lista completa de nomes repetidos, peça ao desenvolvedor.
3. Com a empresa liberada, clique em **Abrir**, informe o e-mail do **administrador geral** da empresa e **Enviar convite**. O convite vale **48 horas** e só pode ser usado uma vez. Passou do prazo: use **Reenviar convite**.
4. **Suspender** derruba na hora todos os acessos da empresa; **Reativar** a libera de novo.
5. **Remover ou Desativar um usuário** (na lista de usuários da empresa aberta):
   - **E-mail digitado errado, antes de a pessoa aceitar o convite:** use **Remover**. Apaga o convite e o cadastro dessa pessoa no portal e libera o e-mail; depois é só convidar de novo com o endereço certo. Só funciona para quem ainda não aceitou o convite (a tela pede confirmação).
   - **Alguém saiu da empresa ou não deve mais entrar:** use **Desativar**. A pessoa perde o acesso na hora, os convites abertos dela deixam de valer e as sessões abertas caem. Vale para quem já aceitou e também para quem ainda está só convidado. Não há botão para reativar: se precisar, peça ao desenvolvedor.
   - Na dúvida, escolha **Desativar**: ele não apaga nada.

## 7. O que o cliente faz

1. Abre o link do convite.
2. Instala (se ainda não tiver) um aplicativo autenticador no celular e digita nele o segredo mostrado na tela (não há QR code nesta versão).
3. Escolhe uma senha (12 caracteres ou mais), digita o código de 6 dígitos que o aplicativo mostra e aceita os termos de uso.
4. **Guarda os 10 códigos de recuperação** em lugar seguro. Cada um vale uma vez e só aparecem nessa tela. Se perder a tela antes de anotar, a equipe precisa reiniciar o 2º fator.
5. Depois entra sempre em `/portal/login.html` com e-mail, senha e o código do aplicativo (ou um código de recuperação no lugar dele).

Cinco erros seguidos na mesma conta bloqueiam o login por 15 minutos (a tela avisa "Muitas tentativas").

## 8. Quando alguém perde o aparelho (ou os códigos)

Na tela **Portal do cliente**, abra a empresa e clique em **Reiniciar 2º fator** no usuário. Isso apaga o aplicativo cadastrado, os códigos de recuperação **e a senha**, derruba as sessões abertas e gera um **convite novo** (e-mail ou link para copiar). A pessoa refaz senha e aplicativo e recebe códigos novos. Só funciona para usuário já ativo.

**Se a conta de uma empresa foi comprometida:** pode **Suspender** a empresa primeiro e, ainda suspensa, **Reiniciar 2º fator** (e **Reenviar convite**) dos usuários; o convite novo só funciona depois que você **Reativar** a empresa. Assim não há janela em que quem tem a senha antiga consiga entrar.

## 9. Trocar o texto do termo de uso

A página `portal/public/termo.html` hoje é um **RASCUNHO** (o aviso aparece na página). Antes do primeiro cliente real:

1. Substitua o texto pelo texto jurídico (o conteúdo é de responsabilidade do dono) e tire o aviso de rascunho.
2. No Render, defina `PORTAL_TERMO_VERSAO` com uma versão nova (por exemplo `2026-12`). Sem a variável vale `2026-11-rascunho`.
3. Quem estiver no meio de um convite com a versão antiga recebe a mensagem para recarregar a página e ler o termo novo.

## 10. Pendências que continuam sendo condição para o primeiro cliente real

Nada disto é feito pelo código; só o dono resolve. Sem isso, qualquer pessoa que consiga a senha do banco acessa os dados do VB direto, contornando o portal:

- Trocar a senha do MySQL, no Render e no HostGator (a antiga está no histórico do git).
- Restringir no HostGator os IPs com acesso remoto ao MySQL (hoje qualquer um).
- Limpar o histórico do git (reescrita destrutiva) e confirmar a visibilidade do repositório no GitHub.
- Ligar `DB_SSL=1` quando o HostGator confirmar TLS no MySQL.
- Publicar o sistema interno numa origem própria (domínio ou subdomínio da empresa), em vez de `thiagozmb.github.io`.
- Texto jurídico do termo de uso (seção 9) e aviso de privacidade.
- SMTP configurado e variáveis do portal no Render (seções 1 a 4).

## 11. O que ainda não foi testado

Foi testado só com banco, e-mail e navegador simulados. Confira você, na primeira vez: o envio de e-mail pelo SMTP real, as páginas do cliente e a tela da equipe no navegador, o aplicativo autenticador de verdade, e se a pasta de páginas do portal chega ao servidor do Render.

## 12. Conferir no MySQL do HostGator antes do primeiro uso

Nenhum SQL do portal rodou em MySQL real (os testes usam um banco falso, que não simula collation, `FOR UPDATE` nem transação). E a criação das tabelas `web_portal_*` roda **na subida do servidor**: uma falha ali impediria o ERP inteiro de subir. Antes de publicar, peça ao desenvolvedor (ou rode você, num cliente MySQL com o usuário de manutenção) o seguinte:

1. `SELECT @@version, @@sql_mode, @@collation_connection;` — o `sql_mode` **não** pode conter `NO_BACKSLASH_ESCAPES`; anote a versão e a collation.
2. **Testar a subida do servidor numa cópia do banco** (ou num banco vazio de teste) antes de publicar no Render, e conferir no log que as tabelas foram criadas sem erro.
3. `SHOW CREATE TABLE` de cada uma das 7 tabelas (`web_portal_empresas`, `web_portal_usuarios`, `web_portal_permissoes`, `web_portal_convites`, `web_portal_recuperacao`, `web_portal_sessoes`, `web_portal_auditoria`): conferir tipos, índices únicos (e-mail em `utf8mb4_bin`) e que não há chave estrangeira.
4. Rodar a consulta do login (`SQL_LOGIN` em `rotas/portal_auth.js`) com um **e-mail existente** e com um **inexistente**, cada uma precedida de `EXPLAIN`: as duas devem devolver 1 linha e usar o mesmo plano (a contagem de `cadastro_clientes` por razão social roda nos dois casos).
5. Medir o tempo da busca da tela da equipe (`/admin/portal/clientes?q=a`, que faz `LIKE` e conta nomes iguais em `cadastro_clientes`); se demorar, avise o desenvolvedor.
6. Depois do primeiro login real, olhar o IP gravado em `web_portal_auditoria`: tem de ser o do cliente e não o do proxy do Render (confere o `trust proxy` de 1 salto).
