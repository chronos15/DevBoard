# TaskBoard V84 — Projeto responsivo + edição rápida + Equipe agora

## Modo Resumido · criação/edição de projeto

- Corrigido o modal de **Criar projeto** que herdava o `sm:max-w-sm` do componente base e ficava estreito mesmo em telas grandes.
- O editor agora usa até **1180 px**, respeitando a largura disponível da viewport e mantendo layout de uma coluna em telas menores.
- **Segurar/clicar e manter pressionado** sobre um projeto existente abre a edição quando a permissão atual permitir.
- Admin pode editar qualquer projeto; DEV só recebe a ação de edição nos projetos aos quais está integrado.

## Data de entrega opcional

- Removida obrigatoriedade visual e de submit do campo **Data de entrega**.
- Frontend envia `NULL` quando o campo fica vazio.
- Migration 072 remove `NOT NULL` e atualiza `create_project`/`update_project` sem alterar as demais regras de permissão.
- Agenda, cards, detalhes e alertas de prazo tratam projetos sem data de entrega corretamente.

## Painel completo · Equipe agora

- Novo quadro entre **Horas registradas** e **Status das tarefas**.
- Lista todos os membros ativos do workspace.
- Exibe em tempo real:
  - quem está executando uma subatividade, projeto/atividade e tempo atual;
  - quem está online e em qual tela está;
  - quem ficou sem interação por pelo menos 2 minutos (**Parado em ...**);
  - quem está sem tarefas abertas;
  - usuários offline;
  - quantidade de tarefas abertas relacionadas ao usuário.
- Clique em um usuário que esteja executando leva direto para a subatividade no Acompanhamento.
- O contexto de tela/atividade usa **Supabase Realtime Presence** e não grava telemetria no banco.

## Painel mais largo

- A tela inicial no Modo Completo deixa de limitar o conteúdo a `max-w-7xl`.
- Em telas grandes, o painel aproveita toda a largura disponível mantendo **12 px de margem lateral**.

## Arquivos principais alterados

- `app/page.tsx`
- `components/app-shell.tsx`
- `components/dashboard/workspace-activity-status.tsx`
- `components/discord/discord-workspace.tsx`
- `components/projects/project-form.tsx`
- `lib/store.tsx`
- `lib/types.ts`
- `lib/supabase/data.ts`
- `lib/project-utils.ts`
- ajustes de prazo em Agenda, detalhes do projeto e Painel DEV
- `supabase/migrations/072_taskboard_optional_project_due_date.sql`
