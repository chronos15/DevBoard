# TaskBoard V78 — Entrega de versão + “digitando...”

## Modal de entrega ao concluir / enviar para AQS

Ao mover uma subatividade para **Aguardando AQS** ou **Concluído**, o modal de confirmação passa a oferecer uma seção opcional de entrega com:

- caminho da pasta da versão;
- número da versão;
- build;
- arquivo `.zip` de até 50 MB.

Nenhum campo é obrigatório. Se o usuário não preencher nem anexar nada, o modal deixa isso claro antes da confirmação e o histórico registra que a etapa avançou sem informações de versão/build, caminho ou ZIP.

O ZIP reutiliza os anexos existentes da subatividade. Não foi criada nova estrutura de arquivo, bucket ou coluna.

A mudança foi aplicada aos pontos de alteração de status da visualização em lista, Kanban e Acompanhamento/Modo Resumido.

## Indicador de digitação estilo Discord

Foi criado um indicador efêmero via Supabase Realtime Presence. Enquanto outra pessoa estiver escrevendo, aparece abaixo/próximo ao composer:

`Mauricio Costa está digitando...`

Com duas ou mais pessoas, o texto se adapta automaticamente. O indicador some pouco depois que a pessoa para de digitar e nunca é persistido.

Escopos cobertos:

- Acompanhamento / tópico de subatividade;
- Análise AQS (compartilha o mesmo estado de digitação da subatividade);
- canais e conversas do chat, inclusive canais do Modo Resumido;
- Solicitações.

Usuários em modo somente leitura continuam podendo **ver** quem está digitando; a permissão de escrita existente continua sendo respeitada.

## Backend

Aplicar `supabase/migrations/068_taskboard_release_handoff_and_typing.sql` depois da 067.

A migration não altera tabelas. A nova RPC chama internamente o fluxo oficial de status, preservando as validações de permissão, checklist, AQS e estados terminais, e em seguida adiciona o registro de entrega ao histórico do projeto.

## Arquivos alterados

- `components/project-detail/subactivity-status-confirm-dialog.tsx`
- `components/project-detail/activity-item.tsx`
- `components/project-detail/subactivity-kanban.tsx`
- `components/project-detail/project-follow-up.tsx`
- `components/analysis/analysis-view.tsx`
- `components/requests/request-detail.tsx`
- `components/chat/chat-view.tsx`
- `components/typing/typing-indicator.tsx`
- `lib/store.tsx`
- `lib/types.ts`
- `supabase/migrations/068_taskboard_release_handoff_and_typing.sql`
- `SUPABASE_SETUP.md`
- `V78_FIX_NOTES.md`
