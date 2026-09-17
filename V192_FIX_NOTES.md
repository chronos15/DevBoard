# TaskBoard V192 — Aprovação dentro de Subatividades recentes

## Aprovações deixam de ser uma notificação comum

Ao solicitar **Ag. Aprovação**, a pendência não é mais criada como uma notificação comum para o usuário escolhido.

A própria subatividade passa a ser a fonte persistente do aviso:

- `status = waiting`;
- `approval_user_id = usuário citado`;
- `approval_requested_at = data/hora da solicitação`.

A migration `096_taskboard_approval_in_recent_subactivities.sql` substitui apenas a RPC `request_subactivity_approval` e remove a geração de `subactivity-approval-request`. A estrutura de tabelas e o fluxo de aprovação existente foram preservados.

Notificações antigas desse tipo continuam no banco, porém deixam de aparecer no sino, badge de não lidos, aviso do navegador/PWA e marcadores de não lido do Acompanhamento.

## Subatividades recentes

A tela **Subatividades recentes** agora também reúne aprovações destinadas ao usuário, mesmo quando ele não é o responsável pela subatividade.

As aprovações:

- ficam sempre no topo enquanto estiverem pendentes;
- usam um card com tom rosado discreto, diferente das tarefas comuns;
- mostram **Sua aprovação**;
- possuem **X** para revogar/devolver para Backlog;
- possuem **✓** para aprovar e concluir automaticamente;
- permanecem na lista até a decisão ser registrada;
- entram na contagem do ícone de Subatividades recentes.

As subatividades normais atribuídas ao usuário continuam funcionando como antes.

## Realtime e acesso

Nenhum polling novo foi adicionado. O fluxo continua usando o Realtime já existente de `subactivities` e `subactivity_members`. Como o usuário citado já é adicionado como membro da subatividade pela RPC existente, ele recebe acesso ao contexto necessário e o card aparece ao atualizar o estado em tempo real.

## Versão

Versão física embutida atualizada para **V192**.
