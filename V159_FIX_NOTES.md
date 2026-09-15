# TaskBoard V159 — Equipe por movimentação + dashboard do usuário

## Card Equipe

- O resumo expandido de cada usuário deixa de considerar itens de Backlog.
- As 3 linhas rápidas agora representam as últimas subatividades realmente movimentadas do responsável, considerando:
  - Em execução
  - Pausadas
  - Aguardando
  - Aguardando AQS
  - Concluídas
  - comentários recentes
  - anexos/alterações recentes
- A responsabilidade continua estrita por `assigneeId`; menções e participação no acompanhamento não transferem a tarefa para outro usuário.
- A ordenação usa a movimentação mais recente da subatividade (atualização, comentário, anexo ou criação).
- O texto da linha informa o tipo da última movimentação.

## Item “Mais”

- Depois das 3 movimentações recentes, existe o item `Mais`.
- Administrador pode abrir o dashboard de qualquer usuário.
- Usuário não administrador vê `Mais` somente no próprio usuário.

## Dashboard do usuário

Modal responsivo para desktop/Windows e Android contendo:

- identidade, cargo e presença do usuário;
- horas efetivadas hoje e nos últimos 7 dias;
- quantidade em execução, pausada e concluída;
- gráfico Gantt das sessões reais registradas nos últimos 14 dias;
- cronologia de subatividades em ordem decrescente, mais recentes primeiro;
- status, projeto, atividade, horas registradas, comentários e tipo da última movimentação;
- clique em uma linha abre diretamente o acompanhamento da subatividade.

## Regras

- Backlog não aparece no resumo operacional nem na cronologia do dashboard.
- Canceladas também ficam fora do resumo operacional.
- Nenhuma migration nova.

## Arquivos alterados

- `components/dashboard/workspace-activity-status.tsx`
- `components/dashboard/member-work-dashboard-dialog.tsx` (novo)
- `lib/member-work-activity.ts` (novo)
- `lib/app-version.ts`
- `next.config.mjs`
- `V159_FIX_NOTES.md`
