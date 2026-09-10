# TaskBoard V77 — Hierarquia visual + DEV observador

## Modo Resumido

A navegação de Projeto foi refinada sem mudar a estrutura funcional do TaskBoard:

- Atividade agora aparece como bloco-pai colapsável, com ícone próprio, título mais forte, contador de subatividades e ações agrupadas.
- Subatividade aparece recuada dentro da atividade, com guia vertical, `#`, estado selecionado mais evidente e indicador de status.
- A busca continua filtrando atividades/subatividades e a navegação/deep-link existente foi preservada.
- Subatividades vistas por um DEV que não participa exibem um ícone de olho para deixar claro o modo de observação.

## Regra de acesso do DEV observador

Um usuário `developer` pode visualizar as subatividades do workspace mesmo sem ser responsável/membro. Quando não participa da subatividade:

- pode visualizar o acompanhamento e o checklist;
- pode reagir;
- pode comentar somente respondendo um item existente;
- não pode enviar mensagem nova, anexar, mencionar, alterar checklist, membros, status ou cronômetro, nem iniciar reunião.

Admin continua com acesso total a qualquer subatividade.

## Backend

Aplicar `supabase/migrations/067_taskboard_simplified_observer_access.sql` depois da 066.

A 067 não altera a estrutura das tabelas. Ela cria apenas um helper de leitura e ajusta policies/RPCs do Acompanhamento. A função de acesso de edição (`can_access_followup_subactivity`) permanece intacta para evitar ampliar permissões de escrita.

## Arquivos alterados

- `components/discord/discord-workspace.tsx`
- `components/project-detail/project-follow-up.tsx`
- `lib/follow-up-access.ts`
- `supabase/migrations/067_taskboard_simplified_observer_access.sql`
- `SUPABASE_SETUP.md`
- `V77_FIX_NOTES.md`
