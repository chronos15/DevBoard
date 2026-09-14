# TaskBoard V113 — Equipe mais compacta no dashboard

## Ajuste de UI/UX

- Compactado o card de **Equipe > Horas efetivadas** na tela inicial, principalmente para larguras menores.
- Nenhuma informação foi removida: permanecem avatar, nome, cargo, gráfico circular, horas efetivadas, meta configurada, percentual e subatividade em execução.
- Reduzidos paddings, margens e espaçamentos verticais do card.
- Avatar e gráfico circular ficaram menores para liberar área útil sem prejudicar leitura.
- Nome continua acima dos indicadores e pode ocupar até duas linhas, preservando a melhoria da V112.
- Indicadores de horas foram alinhados em uma grade mais compacta.
- A tarefa em execução permanece no rodapé, agora separada por uma linha discreta e com menos espaço vertical.
- Ajustado o `minmax` da grade para melhorar o aproveitamento horizontal em telas menores.

## Banco de dados

- Nenhuma migration nova.

## Arquivos alterados

- `components/dashboard/workspace-activity-status.tsx`
- `V113_FIX_NOTES.md`
