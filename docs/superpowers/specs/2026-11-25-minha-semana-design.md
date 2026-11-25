# Minha semana: caderno de tarefas pessoal

## Intenção
Uma lista de tarefas do dia, sem horários, com cara de caderno pautado, e uma caixinha para finalizar. Referência: planejador semanal em quadros (dias, Tarefas, Notas). Todo usuário do sistema pode usar e cada um vê somente a sua lista.

## Tela (`tarefas.html`, item "Minha semana" no menu)

```
 Minha semana        [‹]  23/11 a 29/11  [›]  [Hoje]
 ┌ Seg 23 ──┐┌ Ter 24 ──┐┌ Qua 25 ──┐┌ Qui 26 ──┐┌ Sex 27 ──┐┌ Sáb 28 ──┐┌ Dom 29 ──┐
 │[✓] ~~Li~~││[ ] ...   ││[ ] texto ││          ││          ││          ││          │
 │[ ] ...   ││          ││    longo ││          ││          ││          ││          │
 └──────────┘└──────────┘└──────────┘└──────────┘└──────────┘└──────────┘└──────────┘
 ┌ TAREFAS ───────────────────────────────┐┌ NOTAS ──────────────────────────────────┐
 │[ ] ...                                 ││ ...                                     │
 └────────────────────────────────────────┘└─────────────────────────────────────────┘
```

- Sete quadros de dia mais Tarefas e Notas, com linhas pautadas. O dia de hoje fica destacado.
- Ordem horizontal, da esquerda para a direita, como a visão de semana do Google Agenda (mudança pedida pelo dono; antes o desenho era em 3 colunas, coluna a coluna). Em telas menores quebra em 4 colunas, na mesma leitura. Texto longo quebra linha e aparece inteiro.
- Escrever na linha vazia e apertar Enter cria a tarefa e abre a próxima. Sair da linha também salva.
- Marcar a caixinha risca o texto; desmarcar desfaz.
- Apagar todo o texto de uma linha exclui a tarefa.
- Cores e componentes do `DESIGN.md` / `tema.css`, não as cores da imagem.
- No celular os quadros ficam um embaixo do outro, e a semana atual abre rolada até hoje.
- Se salvar falhar, a linha fica marcada com aviso e o texto não é perdido da tela.

## Propostas a confirmar na aprovação
- Os quadros **Tarefas** e **Notas** são fixos: não mudam ao trocar de semana.
- Tarefa não concluída **fica no dia em que foi escrita**; não passa sozinha para o dia seguinte.
- **Notas** não têm caixinha (é anotação, não tarefa).
- A página fica escondida no **modo atendimento**, para o cliente não ver anotações do vendedor.

## Dados e privacidade
- Tabela nova `web_tarefas` (criada em `seguranca/instalacao.js`): id, usuário, quadro (`dia`, `tarefas` ou `notas`), data (só no quadro `dia`), texto (até 300 caracteres), feita, criada em, atualizada em.
- Rotas só para usuário logado, sem permissão nova. O usuário vem sempre do login (`req.user.id`), nunca da requisição; ler, alterar ou excluir linha de outro usuário responde 404.
- Nem o administrador vê a lista de outra pessoa. O texto não vai para a auditoria nem para o log.
- Nenhuma tabela do VB é lida ou alterada.

## Fora do escopo
Horários, lembretes, compartilhar ou atribuir tarefa, caderno da equipe, impressão, transferir pendências automaticamente.

## Restrições
- Rotas criadas por `registro.rota`; HTML/CSS/JS puro com Content-Security-Policy como nas outras páginas.
- Testes com `node:test` e banco falso, incluindo o isolamento entre usuários.
- A tela entra no menu (`layout.js`) sem passar a ser a primeira página de ninguém.

## Abordagens consideradas
1. **Página nova, uma linha do banco por tarefa (escolhida).** Sincroniza entre computador e celular e não sobrescreve anotações. Exige publicar o servidor.
2. Semana inteira num bloco só: menos código, mas dois aparelhos abertos podem apagar um o texto do outro.
3. Só no navegador: rápida, mas não sincroniza, pode ser apagada e mistura usuários em PC compartilhado.
