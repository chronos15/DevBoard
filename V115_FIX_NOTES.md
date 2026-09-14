# TaskBoard V115 — Atalhos de menções no Acompanhamento

## Objetivo
Permitir identificar rapidamente **em qual subatividade** o usuário foi mencionado e navegar diretamente para o contexto da menção, sem alterar a regra atual de leitura das notificações.

## Alterações

### Acompanhamento — modo completo
- O indicador `@` do projeto agora é clicável.
- O indicador `@` da atividade agora é clicável.
- Subatividades que possuem menção não lida passam a exibir o próprio badge `@`.
- Clique no `@` da subatividade abre diretamente aquela subatividade.
- Clique no `@` do projeto/atividade resolve a menção não lida mais recente daquele escopo e abre a subatividade correspondente.
- Quando a mensagem correspondente já está disponível no histórico carregado, o TaskBoard posiciona e destaca a mensagem exata.

### Acompanhamento — modo resumido
- O `@` sobre o ícone do projeto passou a funcionar como atalho para a menção.
- Atividades com menção passam a exibir `@` clicável na árvore lateral.
- Subatividades com menção passam a exibir `@` clicável na própria linha.
- A navegação preserva projeto, atividade, subatividade e, quando resolvido, o item exato da timeline através do parâmetro `focus`.

### Regra de leitura preservada
- Nenhuma regra de leitura foi alterada.
- Os atalhos não chamam `markNotificationRead` nem `markFollowUpContextRead` diretamente.
- O comportamento existente ao abrir/visualizar um contexto continua sendo o único responsável por considerar notificações lidas.

## Implementação
Novo helper central:
- `lib/follow-up-mention-shortcuts.ts`

Ele resolve a menção não lida mais recente por projeto/atividade/subatividade e tenta associá-la à mensagem do histórico pela proximidade de `created_at` e pelas menções persistidas no comentário.

## Banco de dados
**Não há migration nova na V115.**

## Arquivos alterados
- `components/project-detail/project-follow-up.tsx`
- `components/project-detail/follow-up-page.tsx`
- `components/discord/discord-workspace.tsx`
- `lib/follow-up-mention-shortcuts.ts`
- `V115_FIX_NOTES.md`
