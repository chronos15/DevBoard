# TaskBoard V233

## Reunião — Mural completo para todos

- Reuniões vinculadas a uma subatividade agora usam sempre o `ProjectFollowUp` completo no Modo Mural, independentemente do perfil do usuário.
- O antigo fallback automático para `MeetingWallSurface` resumido foi removido das reuniões com subatividade.
- Falhas transitórias de montagem tentam recuperar silenciosamente o mural completo duas vezes sem encerrar ou interferir na chamada.
- Se a montagem continuar falhando, a reunião permanece ativa e é exibida somente uma ação para tentar carregar novamente o mural completo; não há troca para o mural resumido.
- Contextos de Análise AQS vinculados a uma subatividade também resolvem projeto/atividade/subatividade pelo próprio registro da análise, evitando perda do mural completo quando algum ID vier ausente no contexto da chamada.
- O componente do mural recebe uma chave estável por reunião/subatividade para evitar reaproveitamento de estado de outra origem ao alternar o Mural.

## Versão

- Versão embutida, fallback do `next.config.mjs`, Service Worker e diagnóstico do compartilhamento atualizados para V233.
- Nenhuma migration, alteração de ICE/WebRTC, Realtime, gravação ou permissão foi necessária.
