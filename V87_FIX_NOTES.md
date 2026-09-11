# TaskBoard V87 — edição administrativa + horas HH:mm + Equipe expansível

## Subatividades
- Administradores agora possuem ação **Editar subatividade** na Lista, Kanban e Acompanhamento/Modo Resumido.
- A edição administrativa permite alterar descrição, estimativa, tipo e responsável.
- Troca de responsável fica bloqueada enquanto a subatividade estiver em execução, preservando cronômetro e sessão de trabalho.
- A alteração gera log `Subatividade atualizada`; quando há novo responsável, ele recebe notificação e é associado ao tópico.
- Nenhum outro perfil ganha essa permissão.

## Horas
- O total exibido na linha da atividade deixa de usar horas decimais (`1.8h`, `0.3h`) e passa para `HH:mm` (`01:48`, `00:18`).

## Painel
- `Equipe agora` passa a se chamar **Equipe**.
- Os cards `Horas registradas`, `Equipe` e `Status das tarefas` passam a ocupar três colunas de mesma largura no desktop.
- Clicar em um usuário expande o próprio card inline e mostra até as **3 tarefas abertas mais recentes** daquele usuário, com projeto, atividade, subatividade e status.
- A tarefa atualmente em execução fica sempre no topo da expansão e recebe identificação **Executando**.

## Banco
- Execute `074_taskboard_admin_subactivity_edit_and_team_expand.sql` depois da migration 073.
