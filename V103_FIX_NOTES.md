# TaskBoard V103 — atividade sem responsável visível para DEV

## Correção

A V102 manteve a regra da V93 em que `restrict_activities` exigia vínculo direto do usuário com a atividade ou com alguma subatividade. Como uma atividade criada sem responsável não possui registros em `activity_assignees`, ela aparecia otimisticamente logo após a criação e sumia no próximo `refreshProjects()` por causa da RLS.

A V103 adiciona a regra funcional esperada:

- atividade **sem responsável** fica visível para **qualquer usuário com role `developer`**;
- essa exceção vale mesmo quando o perfil personalizado possui `restrict_projects` e/ou `restrict_activities` ativados;
- atividades que possuem um ou mais responsáveis continuam obedecendo normalmente às restrições de acesso;
- `restrict_subactivities` continua sendo respeitado. A exceção de atividade sem responsável não libera subatividades de terceiros quando a restrição de subatividades estiver ativa;
- para a árvore `Projeto -> Atividade` funcionar, um projeto que contenha atividade sem responsável passa a ficar visível ao DEV. Isso não libera as demais atividades atribuídas do projeto, pois cada atividade continua passando pela própria RLS.

## Banco

Aplicar após a migration 082:

`supabase/migrations/083_taskboard_unassigned_activities_visible_to_developers.sql`

A migration redefine apenas:

- `taskboard_can_view_project`
- `taskboard_can_view_activity`
- `taskboard_can_view_subactivity`

Não há alteração de tabelas nem perda de dados.

## UI administrativa

A descrição de **Somente atividades integradas** em Configurações > Equipe foi atualizada para deixar explícito que atividades sem responsável permanecem disponíveis para todos os desenvolvedores.
