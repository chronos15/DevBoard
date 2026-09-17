# TaskBoard V198 — correção do seletor “Mostrar concluídas”

## Problema corrigido
Ao alternar o botão **Mostrar concluídas** no Acompanhamento, a subatividade selecionada podia voltar sozinha para a subatividade que havia aberto originalmente o Acompanhamento (por notificação/deep-link). Isso acontecia porque atualizações de Realtime/timer faziam o `initialSubactivityId` ser reaplicado repetidamente.

## Ajustes
- O `initialSubactivityId` agora é consumido **uma única vez por navegação/deep-link**, sem reaplicar a seleção a cada atualização do projeto.
- Alternar **Mostrar concluídas** mantendo uma subatividade aberta não troca mais a seleção sem necessidade.
- Se o usuário estiver visualizando uma subatividade **Concluída** e clicar para **ocultar concluídas**, o Acompanhamento muda antes para outra subatividade visível:
  1. prioriza uma subatividade da mesma atividade;
  2. depois uma subatividade em execução;
  3. depois a primeira subatividade disponível.
- Se não existir outra subatividade compatível com os filtros atuais, a seleção é limpa em vez de reabrir a concluída.

## Estrutura
- Nenhuma migration nova.
- Nenhuma alteração de banco, permissões, status ou dados.
- Versão física embutida atualizada para **V198**.
