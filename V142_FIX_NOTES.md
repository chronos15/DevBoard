# TaskBoard V142 — responsividade da tela Projetos > Atividades

## Motivo

Em resoluções menores, especialmente com sidebar e painel lateral abertos, os controles da tela **Projetos > Atividades** podiam ultrapassar a largura disponível e o título das atividades/subatividades acabava comprimido demais. O objetivo desta versão foi priorizar a leitura do título e mover as ações para uma linha inferior quando o espaço horizontal não for suficiente.

## O que foi ajustado

### Cabeçalho do bloco “Atividades”

- o botão **Adicionar atividade** e o grupo **Lista / Kanban / Acompanhamento** agora se reorganizam abaixo do título em larguras menores;
- o grupo de modos passou a aceitar `wrap`, evitando que os controles saiam para fora do card;
- a composição horizontal completa é mantida apenas em larguras maiores.

### Card de atividade

- o título da atividade agora recebe prioridade visual e pode ocupar toda a largura útil do card;
- em telas menores, barra de progresso, percentual e tempo rastreado ficam abaixo do título;
- os controles de **Informações, Anotações, Arquivos, Copiar link e Excluir** descem para uma linha inferior responsiva;
- os ícones verticais à direita permanecem apenas em larguras maiores.

### Linha de subatividade

- o título da subatividade agora fica em uma linha superior própria, com mais espaço para leitura;
- badges como tipo, brainstorm e foco passam a ficar abaixo do título;
- os controles continuam na linha inferior e com quebra adequada (`wrap`), sem esmagar o título.

## Estrutura preservada

- nenhuma alteração de banco;
- nenhuma migration nova;
- sem mudança de regras de negócio;
- sem quebra da navegação, timers, comentários, anexos ou acompanhamento.

## Arquivos alterados

- `components/project-detail/project-detail.tsx`
- `components/project-detail/activity-item.tsx`
- `lib/app-version.ts`
- `next.config.mjs`
- `V142_FIX_NOTES.md`

## Resultado esperado

Em larguras menores:

1. o título da **atividade** e da **subatividade** fica mais legível;
2. os controles não vazam horizontalmente;
3. as ações descem para a linha de baixo;
4. o layout continua íntegro também em resoluções grandes.
