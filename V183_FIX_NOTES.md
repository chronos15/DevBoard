# TaskBoard V183 — Logs vinculados exclusivamente pelo ID da subatividade

## Objetivo
Eliminar completamente qualquer associação de log por texto, título, `includes()` ou comparação de descrição.

A partir desta versão, um log só aparece no histórico/resumo de uma subatividade quando o próprio registro de `project_logs` possui o `subactivity_id` exato daquela subatividade.

## Banco de dados
Nova migration:

`095_taskboard_project_logs_subactivity_id.sql`

Ela:
- adiciona `project_logs.subactivity_id` como FK opcional para `subactivities.id`;
- cria índice para leitura por projeto + subatividade;
- adiciona uma sobrecarga interna de `add_project_log` que recebe o UUID da subatividade e valida se ela pertence ao projeto;
- atualiza os fluxos atuais que geram logs de subatividade para gravarem o ID exato: criação, início, pausa, alteração de status, AQS, aprovação, checklist/anotações da subatividade, brainstorm, ajustes administrativos, manutenção de horas, comentários legados e reuniões contextuais;
- reuniões antigas só são migradas quando o log já contém o UUID exato no marcador interno `meeting-subactivity`; nenhum título é usado para backfill.

Logs históricos antigos que não possuem um UUID seguro continuam no histórico geral do projeto, mas não são mais injetados no acompanhamento de nenhuma subatividade.

## Frontend
- `ProjectLogEntry` agora recebe `subactivityId`;
- carregamento inicial e realtime mapeiam `project_logs.subactivity_id`;
- Resumo do acompanhamento: `log.subactivityId === sub.id`;
- Acompanhamento principal: `log.subactivityId === selectedSub.id`;
- logs de reunião também usam o ID persistido do log;
- pesquisa do Acompanhamento só oferece logs com `subactivity_id` e navega para a subatividade exata.

## Resultado
Duas subatividades podem ter títulos idênticos, parecidos ou serem renomeadas sem qualquer possibilidade de uma receber logs da outra. O vínculo deixou de depender do texto definitivamente.

## Implantação
A migration `095_taskboard_project_logs_subactivity_id.sql` deve ser aplicada antes de publicar o frontend V183, pois o carregamento de projetos passa a selecionar a coluna `project_logs.subactivity_id`.
