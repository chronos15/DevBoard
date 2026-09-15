# TaskBoard V165 — Status no Acompanhamento Resumido

## Correção

A V164 aplicou a identidade visual e a ordenação por status no Acompanhamento completo, mas o modo Resumido utiliza uma árvore de componentes separada (`discord-workspace.tsx`) e ainda mantinha o comportamento anterior.

Na V165 o modo Resumido passa a usar a mesma regra visual e de ordenação:

1. Backlog — cinza
2. Aguardando — âmbar
3. Em execução — azul
4. Pausada — laranja
5. Aguardando AQS — violeta
6. Concluída — verde
7. Cancelada — vermelho/rosa

### Visual
- Indicador da subatividade aumentado para `size-2.5`.
- Adicionado contraste com `ring` e `shadow` discreto.
- Texto do status recebe a mesma identidade de cor do indicador.
- Executando e Concluída ficam visualmente distintos também no modo Resumido.

### Ordem
- Subatividades são ordenadas pelo status na sequência acima.
- Dentro do mesmo status, a ordem original do array é preservada pelo sort estável do JavaScript moderno.
- A busca continua funcionando antes da ordenação.

## Estrutura
- Nenhuma migration nova.
- Nenhuma mudança em valores internos de status.
- Nenhuma mudança de permissões ou regras de Acompanhamento.
