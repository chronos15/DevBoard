# TaskBoard V101 — Dashboard de atividade e ação de criação

## Alterações

### Projetos > Atividades
- O botão **Adicionar atividade** foi removido do final da listagem, onde ficava visualmente solto.
- A ação agora fica no cabeçalho da seção **Atividades**, ao lado dos modos Lista/Kanban/Acompanhamento.
- O cabeçalho da seção foi reorganizado em duas áreas:
  - ação principal + modos de visualização;
  - filtros de status, usuário e ordenação.
- O mesmo botão principal atende Lista e Kanban, evitando duplicação de fluxo.
- No Kanban, a faixa auxiliar ficou dedicada somente à criação de subatividade na atividade selecionada.
- Layout responsivo: no mobile a ação ocupa a largura disponível e os controles se reorganizam em coluna.

### Informações da atividade
- Redesign completo para formato de dashboard.
- Cabeçalho com projeto, cliente, título, tipo, prioridade e resumo de conclusão.
- Cards de métricas para:
  - progresso;
  - tempo registrado;
  - estimativa;
  - subatividades.
- Nova seção **Contexto da abertura** com posição fixa para:
  - Build;
  - O.S. vinculada;
  - Módulo relacionado;
  - Assunto;
  - Departamento responsável;
  - Prioridade.
- Campos sem valor agora exibem **Não informado**, em vez de desaparecerem do painel.
- Seção **Execução da atividade** redesenhada com status, responsável, horas registradas/estimadas e barra de progresso por subatividade.
- Painel lateral com responsáveis, distribuição por status e resumo geral de execução.
- Removida a antiga seção que repetia o título como "Descrição da atividade", pois não existe atualmente um campo de descrição separado para Activity.
- Modal ampliado para aproveitar melhor telas desktop e continuar responsivo em telas menores.

## Banco de dados
- Nenhuma migration nova nesta versão.
- Mantém os campos de contexto introduzidos na migration `080_taskboard_activity_opening_context.sql`.

## Arquivos alterados
- `components/project-detail/project-detail.tsx`
- `components/project-detail/activity-info-dialog.tsx`
- `V101_FIX_NOTES.md`
