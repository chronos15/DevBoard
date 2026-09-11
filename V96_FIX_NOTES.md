# TaskBoard V96

## Visualizador de imagens dentro da aplicação

- Imagens do acompanhamento/subatividade deixam de abrir em nova aba.
- Imagens do chat de reunião usam o mesmo visualizador.
- Imagens anexadas em Solicitações também abrem dentro da tela.
- Visualizador responsivo com zoom de 100% a 500%, roda do mouse, duplo clique, arraste, gesto de pinça, rotação, reset/ajuste e download.
- Arquivos que não são imagem mantêm o comportamento anterior.

## Anotações da atividade com histórico

- Transformar uma anotação em subatividade não remove mais o contexto visual: o texto permanece riscado e identificado como transformado, com data/usuário e atalho para a subatividade quando disponível.
- Excluir uma anotação passa a ser uma exclusão lógica: o registro permanece riscado, com indicador de exclusão, data e usuário.
- Anotações transformadas não podem ser excluídas, preservando a rastreabilidade.
- Migration adicionada: `079_taskboard_activity_notes_history.sql`.

## Equipe no dashboard

- Ao expandir um usuário, as 3 tarefas agora são ordenadas pela alteração mais recente, e não pela criação.
- A ordenação considera `subactivities.updated_at` e também comentários/anexos mais recentes.
- Cada item informa há quanto tempo ocorreu a última alteração considerada.
