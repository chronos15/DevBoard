# TaskBoard V107 — Manutenção da estimativa de horas no dashboard da atividade

## Alteração

- No dashboard **Informações da atividade**, cada subatividade passa a exibir a ação **Editar horas** para Administradores.
- A ação abre um diálogo compacto com:
  - estimativa atual;
  - tempo já registrado;
  - nova estimativa em horas;
  - suporte a valores decimais (`1,5`, `2,25`, etc.);
  - aviso quando a nova estimativa fica abaixo do tempo já registrado.
- A edição altera **somente a estimativa** da subatividade. Não modifica horas trabalhadas, título, responsável, tipo ou status.
- A nova estimativa atualiza imediatamente:
  - a linha da subatividade;
  - o percentual de progresso;
  - a estimativa consolidada da atividade.
- A alteração é exclusiva de **Admin** também no banco, não apenas na interface.
- Cada ajuste gera log no projeto com estimativa anterior e nova estimativa.

## Migration

Aplicar após a migration `084`:

`supabase/migrations/085_taskboard_admin_subactivity_estimate_maintenance.sql`

A migration cria a RPC:

`update_subactivity_estimate_admin(uuid, numeric)`

Nenhuma tabela é recriada e nenhuma hora trabalhada é alterada.
