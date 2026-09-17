# TaskBoard V194 — filtro de concluídas e numeração das subatividades no Acompanhamento

## Acompanhamento completo e modo resumido

- Adicionado um **icon button** ao lado do botão de adicionar atividade para alternar a exibição de subatividades concluídas.
- Por padrão, ao abrir o Acompanhamento, as subatividades com status **Concluída** ficam ocultas.
- Ao ativar o controle, as concluídas reaparecem na árvore normalmente.
- O controle usa um pequeno indicador visual de liga/desliga e informa a quantidade de concluídas no tooltip.
- Links diretos para uma subatividade já concluída continuam funcionando: nesse caso a visualização de concluídas é habilitada automaticamente para não esconder o destino solicitado.

## Numeração das subatividades

- As subatividades passam a exibir `1.`, `2.`, `3.` antes do título na árvore do Acompanhamento.
- A numeração é calculada **dentro de cada atividade**, pela ordem de criação (`createdAt`), da mais antiga para a mais recente.
- A numeração não muda quando o filtro de concluídas é ligado/desligado nem quando a lista visual é agrupada por situação.
- Caso um registro legado não possua `createdAt`, é preservada a ordem original já recebida pelo projeto.

## Estrutura

- Nenhuma tabela, RPC, policy ou migration foi alterada.
- Nenhuma regra de status, timer, permissões, comentários ou anexos foi modificada.
- Versão embutida atualizada para **V194** para o deploy no servidor físico.
