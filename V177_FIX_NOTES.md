# TaskBoard V177 — Aprovação por usuário + logs de status em PT-BR

## 1. Logs do Acompanhamento em português

Os logs de mudança de situação não exibem mais os valores técnicos do banco (`in-progress`, `done`, etc.).

Exemplo:

- antes: `in-progress → done`
- agora: `Executando → Concluído`

O Acompanhamento também traduz registros antigos na exibição, então logs já existentes passam a aparecer em PT-BR sem precisar alterar o histórico gravado.

## 2. "Aguardando" virou "Aguard. Aprovação"

O status técnico `waiting` foi mantido para não quebrar a estrutura do banco, mas o rótulo visual agora é **Aguard. Aprovação**.

Ao selecionar esse status em uma subatividade já existente, abre um modal compacto para escolher **um usuário específico** que fará a aprovação.

O usuário escolhido:

- é incluído no contexto da subatividade;
- recebe notificação interna;
- recebe notificação do navegador/PWA quando habilitada;
- ao abrir a notificação vai direto ao Acompanhamento daquela subatividade.

## 3. Card de aprovação no Acompanhamento

Quando a subatividade está em **Aguard. Aprovação**, somente o usuário citado visualiza abaixo do título o card:

**Aguardando sua aprovação**

- `X`: recusa e devolve a subatividade para **Backlog**;
- `✓`: aprova e conclui a subatividade automaticamente.

A decisão gera log e notifica quem solicitou a aprovação/responsável.

## 4. Compatibilidade com AQS

Como o status `waiting` agora representa aprovação por usuário, uma revogação da análise AQS não utiliza mais esse estado. Ao revogar no AQS, a subatividade volta para **Backlog**, preservando o motivo e a notificação ao desenvolvedor.

## Banco de dados

Nova migration:

`supabase/migrations/093_taskboard_subactivity_approval_flow.sql`

Ela adiciona os campos de aprovação à subatividade e cria as RPCs:

- `request_subactivity_approval`
- `decide_subactivity_approval`

Nenhum enum de status foi alterado, preservando compatibilidade com a estrutura existente.
