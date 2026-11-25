# Semana dos administradores e alarmes

## Intenção
Além da **Minha semana** (privada), uma segunda página igual, compartilhada somente entre os administradores, e a opção (não obrigatória) de pôr um **alarme** numa tarefa, nas duas páginas. O aviso aparece **dentro do sistema** (decisão do dono).

## Página compartilhada
- Item **"Semana dos administradores"** no menu, junto de "Minha semana". Mesma grade horizontal, mesmos quadros e mesmo funcionamento.
- Todos que têm acesso veem, escrevem, marcam e apagam as mesmas linhas. Cada linha mostra, discretamente, quem escreveu e quem concluiu.
- Atualiza sozinha a cada minuto, sem mexer na linha em que se está digitando.
- Se duas pessoas alterarem a mesma linha, a segunda é avisada e vê o texto atual antes de decidir; nada é sobrescrito sem aviso. O texto dela não se perde.
- Escondida no modo atendimento.

### Quem entra
Permissão nova `tarefas_admin.usar` ("Semana dos administradores"), marcada como só administrativa. Começa liberada apenas para o perfil **Administrador**; pode ser dada a outra pessoa administrativa na tela de Usuários. Quem não a tem não vê o menu e o servidor recusa.

## Alarmes (nas duas páginas)
- Um ícone de sino na linha abre a escolha de **data e hora**; dá para trocar ou remover. A linha com alarme mostra o horário.
- Vale para tarefas dos dias e do quadro Tarefas. **Notas** não têm alarme.
- Dispara uma vez (sem repetição).
- Na hora, aparece uma janela com som em qualquer tela do sistema que esteja aberta, com o texto da tarefa e os botões **OK** e **Adiar 10 minutos**.
- Com o sistema fechado, aparece na próxima vez que a pessoa entrar.
- Tarefa concluída ou apagada não toca.
- Alarme pessoal toca só para o dono. Alarme da compartilhada toca para **todos que têm acesso**; OK e Adiar valem só para quem clicou.
- No modo atendimento o aviso fica retido e aparece ao desligar o modo.
- A tela consulta o servidor uma vez por minuto; o aviso pode atrasar até 1 minuto.
- O navegador pode bloquear o som enquanto a pessoa não tiver clicado na página; a janela aparece mesmo assim.
- O horário é o do relógio de Brasília.

## Dados
- Compartilhada: tabelas novas próprias (tarefas e o "já avisei" de cada pessoa). Rotas próprias, todas exigindo a permissão.
- Pessoal: `web_tarefas` ganha as colunas do alarme. A tabela pode já existir no banco publicado, então a coluna é acrescentada na subida se faltar, sem apagar nada.
- Nenhuma tabela do VB é alterada. O texto das tarefas não vai para o log.

## Fora do escopo
Notificação com o sistema fechado, e-mail, repetição de alarme, atribuir tarefa a uma pessoa, histórico de alterações.

## Restrições
Mesmas da Minha semana: rotas por `registro.rota`, HTML/CSS/JS puro, tema do `DESIGN.md`, testes com `node:test` (incluindo que pessoal e compartilhada não se misturam e que quem não tem a permissão recebe 403 e nenhum aviso).

## Abordagens consideradas
1. Mesma tela e mesma tabela, marcando pessoal ou dos administradores: menos código repetido.
2. **Cópia separada com tabela própria (escolhida pelo dono):** quase não mexe na página pessoal; ajustes de tela precisam ser feitos nas duas.
3. Uma página com abas: risco de escrever algo pessoal na aba compartilhada.

O aviso (janela e consulta de alarmes) é um só para o sistema inteiro, não duplicado.
