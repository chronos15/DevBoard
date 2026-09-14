# TaskBoard V106 — Foco no Acompanhamento

## Alteração

- Adicionada a ação de **Foco** diretamente no cabeçalho da subatividade aberta no modo **Acompanhamento**.
- A estrela aparece tanto no modo **Completo** quanto no modo **Resumido**, pois ambos reutilizam o mesmo `ProjectFollowUp`.
- A ação permanece exclusiva para usuários **Admin**.
- Quando a subatividade já está marcada como foco, a estrela fica preenchida/destacada.
- Durante a alteração, o botão exibe loading e evita cliques duplicados.
- A implementação reutiliza `setSubactivityFocus` e a RPC `set_subactivity_focus_admin` da V105; não foi criada regra paralela.

## Banco de dados

Nenhuma migration nova é necessária nesta versão. É necessário apenas que a migration da V105 (`084_taskboard_admin_focus_subactivities.sql`) já esteja aplicada.

## Arquivos alterados

- `components/project-detail/project-follow-up.tsx`
- `V106_FIX_NOTES.md`
