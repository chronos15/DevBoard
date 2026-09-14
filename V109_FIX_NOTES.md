# TaskBoard V109 — Manutenção administrativa de horas trabalhadas

## Objetivo

Amplia a manutenção de horas criada na V107. O Admin passa a poder ajustar, no dashboard da atividade, tanto a **estimativa** quanto o **total de horas trabalhadas** de cada subatividade.

## Alterações

- O botão **Editar horas** continua no dashboard da atividade e agora abre o modal **Manutenção de horas**.
- O modal possui dois campos independentes:
  - **Estimativa em horas**;
  - **Horas trabalhadas**.
- Aceita valores decimais com ponto ou vírgula.
- É permitido registrar horas trabalhadas acima da estimativa; a interface apenas sinaliza essa situação.
- A manutenção continua exclusiva para usuários **Admin** no frontend e na RPC do Supabase.
- A alteração gera log no projeto com os valores anterior e novo de estimativa e horas trabalhadas.

## Preservação do cronômetro

A V109 não reescreve nem exclui sessões históricas de `work_sessions`.

Foi adicionado `manual_adjustment_seconds` em `subactivities`. O total exibido passa a ser:

`tempo do cronômetro + ajuste administrativo`

Assim, o Admin pode aumentar ou reduzir o total trabalhado sem corromper o histórico original das sessões.

Se a subatividade estiver **Em execução**, a correção define o total no instante da manutenção e o cronômetro continua contando normalmente depois disso.

## Relatório de horas

Foi criada `subactivity_time_adjustments` para registrar cada correção administrativa como diferença positiva ou negativa. A função `hours_report` passa a incluir esses ajustes no período em que a manutenção foi realizada, sem contabilizá-los como uma nova sessão de trabalho.

## Migration obrigatória

Executar após a migration `085`:

`supabase/migrations/086_taskboard_admin_worked_hours_maintenance.sql`

A migration:

- adiciona `subactivities.manual_adjustment_seconds`;
- cria `subactivity_time_adjustments`;
- cria a RPC `update_subactivity_time_maintenance_admin`;
- atualiza `hours_report` para considerar ajustes administrativos.

## Arquivos alterados

- `components/project-detail/activity-info-dialog.tsx`
- `components/hours/hours-view.tsx`
- `lib/store.tsx`
- `lib/supabase/data.ts`
- `lib/supabase/hours-report.ts`
- `supabase/migrations/086_taskboard_admin_worked_hours_maintenance.sql`
- `V109_FIX_NOTES.md`

## Validação

- 189 arquivos TypeScript/TSX analisados pelo parser do TypeScript sem erros sintáticos.
- A manutenção mantém estimativa e horas trabalhadas como operações independentes: alterar apenas a estimativa não arredonda nem modifica inadvertidamente o tempo trabalhado.
