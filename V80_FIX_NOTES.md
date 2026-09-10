# TaskBoard V80 — Reuniões contextuais, menções coletivas e tema equilibrado

## 1. Logs de reunião não vazam entre subatividades
- Logs de início/fim de reunião agora recebem `meeting-id`, `activity-id` e, quando aplicável, `subactivity-id`.
- A timeline do Acompanhamento e a Análise AQS filtram reuniões pela subatividade exata.
- Logs antigos sem `subactivity-id` não são exibidos dentro de uma subatividade, evitando mostrar uma reunião no tópico errado; permanecem no histórico geral do projeto.

## 2. Menções no estilo Discord
Disponíveis nos compositores de Acompanhamento, comentários de Subatividade, Solicitações, Análise AQS e chat da Reunião:
- `@here`: usuários online/presentes no contexto;
- `@todos`: todos os usuários ativos do workspace;
- `@desenvolvedores`: usuários com role Desenvolvedor;
- `@aqs`: usuários com role AQS;
- `@admin`: administradores.

O autocomplete mostra grupos antes dos usuários individuais e informa quantas pessoas serão atingidas. A menção é expandida em destinatários reais antes do envio, preservando notificações individuais e as regras de associação já existentes.

### Associação por contexto
- Acompanhamento/Subatividade: projeto + subatividade; análise AQS ativa, quando houver.
- Solicitação: participante da solicitação.
- Reunião: o usuário é chamado para a reunião e associado ao contexto correspondente por `meeting_invite_user`.
- A menção não muda o responsável principal nem concede role administrativa.

A regra de DEV observador da V77 continua valendo: observador não ganha permissão de enviar menções no Acompanhamento apenas por conseguir visualizar a subatividade.

## 3. Tema menos extremo
A paleta de superfícies foi aproximada do padrão visual do Discord sem alterar a cor primária configurável do usuário:
- Dark: canvas `#1a1a1e`, rail `#121214`, cards/painéis `#202024` a `#313338`.
- Light: canvas `#f2f3f5`, superfícies `#ffffff` e cinzas intermediários `#e3e5e8`/`#e9eaec`.

Isso reduz o preto absoluto no escuro e o excesso de branco contínuo no claro, mantendo contraste e legibilidade.

## Migration
Executar `069_taskboard_context_meeting_logs_and_group_mentions.sql` após a 068.
