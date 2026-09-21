# TaskBoard V230 — Solicitante da aprovação em Subatividades recentes

## 1. Card de Ag. Aprovação

- O card de **Sua aprovação** no modal **Subatividades recentes** passa a mostrar quem solicitou a aprovação.
- O nome é obtido de `approval_requested_by` e resolvido pela lista de membros já carregada no store; não foi adicionada consulta extra nem mudança no banco.
- A informação aparece abaixo de **Aguardando sua aprovação** como `Solicitado por <nome>`, com truncamento seguro em telas estreitas.
- Se o perfil do solicitante não estiver mais disponível na lista de membros, é usado o fallback visual **Usuário** sem quebrar o card.

## 2. Espaçamento entre cards

- A lista recebeu espaçamento vertical consistente entre os cards (`space-y-2.5`).
- O ajuste vale para aprovações e demais subatividades recentes, mantendo o padding interno e o comportamento responsivo do popover.

## 3. Escopo

- Nenhuma alteração no fluxo de aprovar/revogar, Realtime, RLS ou banco de dados.
- Não é necessária migration.

## 4. Versão

- Versão embutida atualizada para **V230**.
- Service Worker, configuração de build e diagnóstico do compartilhamento atualizados para V230.
