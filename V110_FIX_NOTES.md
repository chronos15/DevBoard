# TaskBoard V110 — Manutenção de horas em HH:mm

## Objetivo

Padroniza a manutenção administrativa de tempo da subatividade para o formato **HH:mm**, evitando a necessidade de informar horas em decimal.

## Alterações

- O modal **Manutenção de horas** continua exclusivo para Admin.
- Os dois campos agora trabalham no formato **HH:mm**:
  - **Estimativa (HH:mm)**;
  - **Horas trabalhadas (HH:mm)**.
- Exemplos aceitos: `01:30`, `08:00`, `12:45` e `37:20`.
- Horas acumuladas podem ultrapassar 24 horas.
- Minutos são validados de `00` a `59`; valores como `01:75` são recusados.
- Ao sair do campo, horas com um único dígito são normalizadas visualmente (`8:30` → `08:30`).
- O resumo do modal também exibe estimativa e tempo trabalhado em **HH:mm**.
- Internamente os valores continuam sendo convertidos para o formato numérico já utilizado pela V109/RPC, preservando compatibilidade com banco, relatórios e cronômetro.
- Nenhuma migration nova é necessária.

## Arquivo alterado

- `components/project-detail/activity-info-dialog.tsx`
- `V110_FIX_NOTES.md`

## Compatibilidade

A migration `086_taskboard_admin_worked_hours_maintenance.sql` da V109 continua sendo a migration mais recente necessária para esta funcionalidade.
