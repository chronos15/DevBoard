# TaskBoard V102 — Performance após permissões

## Diagnóstico

A regressão de desempenho começou na camada de permissões estruturais adicionada pela migration `077_taskboard_weekly_schedule_and_access_profiles.sql`.

O problema principal não era o `canPerformAction()` do frontend. O gargalo estava nos helpers de RLS do PostgreSQL:

- `taskboard_can_view_project()`
- `taskboard_can_view_activity()`
- `taskboard_can_view_subactivity()`

A implementação anterior era encadeada: subatividade validava atividade, e atividade validava projeto. Como essas funções participam das policies de leitura de atividades, subatividades, comentários, anexos, logs, sessões e AQS, o PostgreSQL repetia a árvore de validação para muitas linhas durante o `loadProjects()`.

O efeito ficou mais evidente porque, depois de diversas gravações, o frontend aguardava uma nova leitura completa da árvore de projetos. Ao mesmo tempo, o Supabase Realtime recebia a mesma alteração e disparava outra atualização, criando leituras duplicadas justamente na consulta que ficou mais cara com o novo RLS.

## Correções de banco — migration 082

Arquivo: `supabase/migrations/082_taskboard_permission_performance.sql`

- Reescritos os três helpers `taskboard_can_view_*` sem chamadas recursivas entre eles.
- Mantidas as mesmas regras de acesso da V77/V95.
- Fast-path para Admin, perfil personalizado desativado e escopos sem restrição.
- Consultas de vínculo individual só são executadas quando a respectiva restrição está ativa.
- `taskboard_can_perform_action()` também recebeu fast-path para reduzir o custo das RPCs de gravação.
- Adicionados índices para os caminhos usados pelas permissões:
  - `activity_assignees(user_id, activity_id)`
  - `subactivities(assignee_id, activity_id)`
  - `activities(project_id, id)`
- `ANALYZE` das tabelas envolvidas para o planner utilizar imediatamente as novas estatísticas/índices.

A migration não remove RLS, não libera telas e não contorna permissões. Ela otimiza a forma como a mesma regra é calculada.

## Correções no frontend

### Refreshes duplicados

Foi criado um coordenador de refresh por domínio. Se Realtime e uma mutação solicitarem a mesma atualização ao mesmo tempo, não são abertas duas consultas pesadas em paralelo. No máximo existe uma execução corrente e uma passagem final de reconciliação.

Os debounce keys também foram normalizados (`projects`, `service-requests`, `notifications`, `work-sessions`, etc.), evitando que a mesma fonte fosse atualizada em paralelo usando nomes diferentes.

### Gravações não ficam esperando a árvore inteira recarregar

Após uma RPC confirmar a gravação, os fluxos mais frequentes deixam de manter o botão/loading bloqueado esperando um `loadProjects()`/`loadServiceRequests()` completo. A reconciliação acontece em segundo plano.

Foram ajustados, entre outros:

- criação/edição de atividades e subatividades;
- criação/edição de projetos;
- comentários e acompanhamento;
- anexos;
- mensagens/arquivos do chat;
- mensagens e anexos de solicitações;
- alterações de tipo;
- atualizações ligadas a timer/status.

### Atualização otimista/local

Para a interface continuar consistente enquanto o refresh de segurança roda ao fundo, o estado local é atualizado assim que o servidor confirma:

- projeto criado/alterado;
- atividade/subatividade criada;
- comentários de subatividade/acompanhamento;
- anexos de projeto/atividade/subatividade;
- áudio e mídia do chat;
- alteração de tipo.

### Realtime sem refresh global desnecessário

Eventos frequentes agora são aplicados diretamente no estado quando possível:

- `chat_messages` INSERT/UPDATE;
- `subactivity_comments` INSERT/UPDATE;
- `attachments` INSERT/UPDATE;
- `subactivities` UPDATE;
- `project_logs` INSERT.

DELETEs e mudanças estruturais continuam usando reconciliação completa quando necessário.

## Instalação

Executar depois da migration `081`:

```sql
supabase/migrations/082_taskboard_permission_performance.sql
```

A migration 082 é a parte mais importante desta correção. Atualizar apenas o frontend melhora a sensação dos loadings, mas não elimina o custo do RLS antigo no banco.

## Validação

- Validação sintática dos arquivos TypeScript/TSX do projeto.
- Revisão de equivalência lógica entre os helpers de visibilidade antigos e os novos.
- Refreshes pesados continuam existindo como reconciliação eventual, porém deixam de bloquear os fluxos principais e deixam de executar em paralelo de forma redundante.
