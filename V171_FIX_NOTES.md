# TaskBoard V171 — O.S. e Versão / Build por subatividade

## Alteração principal

A referência de **O.S.** e **Versão / Build** usada no acompanhamento deixou de depender da atividade e agora pertence a cada subatividade individualmente.

- Cada subatividade possui seus próprios campos `linked_os` e `build`.
- Os campos continuam opcionais.
- A criação de subatividade permite informar O.S. e Versão / Build sem impedir o cadastro quando estiverem vazios.
- Ao abrir uma subatividade no Acompanhamento sem uma das referências, é exibido um alerta discreto para preenchimento opcional.
- O alerta pode ser ignorado com **Agora não** e não volta a incomodar aquela subatividade durante a mesma sessão da tela.
- Ao salvar, os chips da subatividade são atualizados imediatamente.
- Os cards do Acompanhamento mostram a O.S. e a Versão / Build da própria subatividade, não mais os dados da atividade pai.
- O cabeçalho da subatividade aberta também mostra essas referências quando informadas.
- Administradores podem alterar as referências pelo modal **Editar subatividade**.

## Banco de dados

Nova migration:

`supabase/migrations/092_taskboard_subactivity_os_build_context.sql`

Ela adiciona em `public.subactivities`:

- `linked_os text`
- `build text`

Também adiciona a RPC:

`set_subactivity_context(uuid, text, text)`

Os campos já existentes em `activities` foram mantidos para compatibilidade com o contexto da atividade e outras telas. Esta alteração não remove nem renomeia colunas existentes.

## Compatibilidade

A RPC existente `add_subactivity` não teve sua assinatura alterada. A subatividade continua sendo criada pelo fluxo atual e, quando houver referências, elas são persistidas em seguida pela nova RPC. Isso reduz o risco de quebrar integrações e chamadas existentes.

## Arquivos alterados

- `components/project-detail/add-subactivity-dialog.tsx`
- `components/project-detail/edit-subactivity-dialog.tsx`
- `components/project-detail/follow-up-structure-dialogs.tsx`
- `components/project-detail/project-follow-up.tsx`
- `lib/store.tsx`
- `lib/supabase/data.ts`
- `lib/types.ts`
- `supabase/migrations/092_taskboard_subactivity_os_build_context.sql`
- `V171_FIX_NOTES.md`
