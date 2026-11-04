# Portal do cliente, etapa 4: usuários da empresa e permissões (design)

Data: 2026-11-04. Etapa 4 do spec `2026-11-03-portal-do-cliente-seguranca-design.md` (seção 6.5). A etapa 3 (3a pedidos, 3b financeiro, 3c documentos) já está na main.

## 1. Objetivo e decisões

O administrador geral de uma empresa cliente cria, edita e desativa os usuários da própria empresa e escolhe o que cada um vê (`pedidos.ver`, `documentos.ver`, `financeiro.ver`). Nunca vê outra empresa. Toda mudança é auditada.

Decisões do dono (04/11/2026): **mais de um administrador geral por empresa**, com promover e rebaixar e a trava do último administrador. Execução direta, sem revisão intermediária (revisão do dono no fim).

Rulings do controlador (reversíveis): (1) reinício do 2º fator continua só da equipe (spec 6.2); o administrador não reinicia ninguém; (2) o administrador pode convidar, mudar permissões, promover, rebaixar, desativar, reenviar convite e remover quem nunca aceitou o convite; (3) reativar usuário inativo não existe (igual à equipe); (4) quem tem `usuarios.gerir` é só o administrador geral, por papel, nunca por linha em `web_portal_permissoes`; (5) limite de convites por administrador.

## 2. Permissões

- `usuarios.gerir` (nova): existe só para o papel `admin_geral` (entra no conjunto do administrador; **nunca** é concedível a usuário comum). `portal/acesso.js` passa a ter `PERMISSOES_CONCEDIVEIS = ['pedidos.ver','documentos.ver','financeiro.ver']` (o que se grava em `web_portal_permissoes`) e `PERMISSOES_PORTAL` = concedíveis + `usuarios.gerir` (o que o administrador tem). Para usuário comum, `carregarPermissoesPortal` filtra as linhas gravadas por `PERMISSOES_CONCEDIVEIS` (uma linha `usuarios.gerir` gravada por engano não vale).
- "Nunca concede além do que a empresa tem": todas as concedíveis estão sempre disponíveis à empresa liberada; o administrador só concede códigos de `PERMISSOES_CONCEDIVEIS` que ele próprio tem (as 3). Qualquer outro código na requisição = 400.

## 3. Rotas

Todas por `registro.portal(..., ['usuarios.gerir'], ...)`, empresa só de `req.portal.empresaCodigo`, nas listas fixas de `registro.rotasPortal()`. Id de usuário estrito (`/^\d{1,9}$/`); usuário de outra empresa, inexistente ou id inválido = o **mesmo 404** `{ error: 'Usuário não encontrado.' }`.

- `GET /portal/api/usuarios` → `{ usuarios: [{ id, email, papel, situacao, permissoes: [...] }] }` só da empresa (permissões do administrador listadas como as 3 concedíveis; nunca `senha_hash`, segredo, tokens nem datas internas).
- `POST /portal/api/usuarios` `{ email, permissoes }` → cria usuário `usuario`/`convidado` com as permissões e o convite (48 h, uso único); `{ ok: true, enviado: boolean, link?: string }` (o link só vem quando o e-mail não foi enviado; nunca em log nem auditoria). E-mail já existente (em qualquer empresa) = 409 `Já existe um usuário do portal com este e-mail.` Limite 20 convites por hora por administrador (429).
- `PUT /portal/api/usuarios/:id/permissoes` `{ permissoes }` → substitui as permissões de usuário comum (`ativo` ou `convidado`); em administrador = 409 (rebaixe antes).
- `POST /portal/api/usuarios/:id/papel` `{ papel: 'admin_geral'|'usuario', permissoes? }` → promover (só `ativo`; apaga as linhas de permissões, o papel dá tudo) ou rebaixar (exige `permissoes` array de concedíveis, pode ser vazio). **Trava do último administrador**: rebaixar não pode deixar a empresa sem administrador `ativo`.
- `POST /portal/api/usuarios/:id/desativar` → `inativo`, convites abertos invalidados, sessões revogadas. Não vale para o último administrador `ativo` (409 `A empresa precisa de ao menos um administrador ativo.`); vale para si mesmo se houver outro. Já inativo = 409.
- `POST /portal/api/usuarios/:id/reenviar_convite` → só `convidado`; invalida os anteriores e cria novo; mesma resposta do `POST /usuarios`.
- `POST /portal/api/usuarios/:id/remover` → só `convidado` que nunca aceitou o convite (`termo_aceito_em` nulo): apaga usuário, convites, recuperação, permissões e sessões e libera o e-mail; demais = 409.

Todas as alterações usam transação com trava de linha (`FOR UPDATE`) nas linhas de usuário da empresa para a regra do último administrador valer sob concorrência. Corpo JSON objeto (senão 400). CSRF/`X-Portal` já exigidos por `portalAutenticar`.

## 4. Auditoria

`auditarPortal` com `usuarioId` do administrador, `clienteCodigo` e `detalhe` só com ids e códigos: `usuario_convidado`, `usuario_permissoes`, `usuario_papel`, `usuario_desativado`, `convite_reenviado`, `usuario_removido`. Nunca e-mail, link, token nem permissões além dos códigos. Falha de gravação não desfaz a ação (como nas etapas anteriores). Retenção: 12 meses.

## 5. Refatoração

`portal/convites.js` extrai de `rotas/portal_admin.js` o que o administrador do portal também precisa: criar convite (token opaco, hash, 48 h), invalidar convites abertos e enviar o e-mail com fallback do link. `rotas/portal_admin.js` passa a usá-lo sem mudar nenhuma resposta (testes `portal_admin_*` verdes).

## 6. Tela

`portal/public/usuarios.html` + `usuarios.js`: lista da empresa com situação, papel e permissões; formulário para convidar (e-mail + 3 caixas); por usuário: salvar permissões, promover/rebaixar, desativar, reenviar convite, remover (cada ação com `confirm()` e mensagem de erro do servidor). Link em `inicio.html`/`inicio.js` só com `usuarios.gerir` em `/portal/api/eu`. Sem script/estilo inline, `textContent`.

## 7. Efeitos nas telas existentes

`documentos.ver` sem `pedidos.ver` (agora possível) não chega aos botões de documento (o detalhe da 3a exige `pedidos.ver`). Ruling: ao conceder `documentos.ver` sem `pedidos.ver` o servidor responde 400 `Para ver documentos, conceda também a visão de pedidos.` (regra de consistência na concessão e no rebaixamento). O administrador tem tudo.

## 8. Testes (resumo; detalhes no plano)

Isolamento entre empresas (usuário de outra empresa = 404 idêntico, em todas as ações); trava do último administrador (rebaixar e desativar, inclusive duas requisições concorrentes simuladas); `usuarios.gerir` nunca vale para usuário comum nem por linha gravada; permissões fora da lista = 400; 403 para usuário comum; auditoria sem e-mail/link; limite de convites; fluxo completo convidar → concluir convite → login do convidado só com as permissões dadas.

## 9. Fora do escopo

Reativar usuário, reiniciar 2º fator pelo administrador, trocar e-mail, transferir propriedade de empresa, papéis personalizados, log de auditoria visível ao cliente.

## 10. Não testável aqui

MySQL real (SQL só em banco falso), concorrência real (`FOR UPDATE` não é simulado), SMTP real, página no navegador real. Entra no roteiro da seção 12 de `docs/portal_configuracao.md`.
