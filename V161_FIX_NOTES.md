# TaskBoard V161 — READ ONLY por módulo

## Objetivo

Amplia o sistema de permissões para permitir que um Administrador configure qualquer integrante da equipe — inclusive outro Administrador — com acesso personalizado por módulo.

Cada módulo pode ficar em um dos três modos:

- **Completo**: visualiza e executa as ações permitidas pela role/base e pelas ações estruturais.
- **READ ONLY / Somente leitura**: visualiza o conteúdo, histórico e detalhes, mas não pode alterar dados daquele módulo.
- **Sem acesso**: o módulo não aparece na navegação e a rota é bloqueada.

A role continua existindo normalmente. Portanto, um chefe de outro departamento pode continuar com role **Administrador**, mas ser configurado como observador em READ ONLY nos módulos desejados.

## O que READ ONLY bloqueia

Conforme o módulo, o modo de leitura bloqueia operações de escrita como:

- criar, editar ou excluir;
- comentar, responder, reagir ou mencionar;
- anexar/enviar arquivos;
- alterar status;
- iniciar/pausar cronômetro;
- iniciar ações de reunião relacionadas ao módulo;
- ações estruturais de projetos/atividades/subatividades;
- alterações administrativas quando **Configurações** estiver em READ ONLY.

Sair de uma reunião permanece permitido para não prender o usuário em uma chamada.

## Administrador observador

Admins agora também podem receber **Acesso personalizado**. Para um Admin que deve somente acompanhar:

1. mantenha a role **Administrador**;
2. ative **Acesso personalizado**;
3. marque os módulos desejados como **Somente leitura**;
4. deixe **Configurações** em Somente leitura ou Sem acesso caso ele não deva administrar equipe/permissões.

Há uma proteção para evitar que o último administrador capaz de gerenciar Configurações remova a própria capacidade de administração sem existir outro Admin com Configurações completas.

## Segurança e backend

- Ações estruturais de Projetos respeitam READ ONLY também no helper do banco.
- Alterações de role, jornada, status da conta e perfil de acesso exigem Configurações com escrita no banco.
- A API de criação direta de usuário também verifica a permissão de escrita de Configurações.
- A API administrativa falha de forma segura se a validação da Migration 091 não estiver disponível; não continua a criação por engano.
- O backend mantém o perfil personalizado como camada restritiva: ele não pode promover uma role para módulos que a role base não possui.
- Demais mutações do aplicativo passam pelo guard central de módulo do Store, além dos controles de interface.

## Migration

Execute após a migration 090:

`supabase/migrations/091_taskboard_read_only_module_permissions.sql`

## Arquivos principais alterados

- `lib/types.ts`
- `lib/access-control.ts`
- `lib/supabase/data.ts`
- `lib/store.tsx`
- `components/config/config-view.tsx`
- `components/sidebar.tsx`
- `components/comments/comment-dialog.tsx`
- `components/project-detail/project-follow-up.tsx`
- `components/chat/chat-view.tsx`
- `app/api/admin/users/route.ts`
- `supabase/migrations/091_taskboard_read_only_module_permissions.sql`
- `lib/app-version.ts`
- `next.config.mjs`
