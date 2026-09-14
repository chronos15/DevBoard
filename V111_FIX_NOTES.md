# TaskBoard V111 — Controle de horas e confiabilidade das reuniões

## Controle de horas

Corrigida a RPC `hours_report` introduzida/alterada na migration 086. O `RETURN QUERY` final usava nomes de colunas iguais aos parâmetros de saída da `RETURNS TABLE` sem qualificação, o que pode gerar erro de ambiguidade em runtime no PL/pgSQL.

A nova migration 087 usa aliases explícitos em todo o CTE e mantém a regra de acesso:

- **Admin:** todos os registros do workspace, com filtros por projeto/usuário;
- **Demais usuários:** somente os próprios registros, independentemente do `p_user_id` enviado pelo cliente.

O frontend também passa explicitamente `currentUserId` no escopo pessoal, deixando a intenção da consulta clara, enquanto a segurança continua garantida no banco.

## Reuniões / WebRTC

### Gravação somente pelo owner

A versão anterior permitia que qualquer participante assumisse a gravação após um timeout quando o criador ainda não tivesse registrado heartbeat. Na V111:

- somente `meetings.created_by` pode ser `recorder_user_id`;
- participantes não iniciam `BrowserMeetingRecorder`;
- participantes não tentam takeover da gravação;
- gravações ativas antigas atribuídas a convidado são devolvidas ao owner ao aplicar a migration;
- um trigger impede que futuras gravações sejam atribuídas a outro usuário;
- somente sinais de gravação emitidos pelo owner são aceitos pela UI.

### Card preto / vídeo congelado

O health-check antigo somava bytes de áudio e vídeo. Se o áudio continuasse trafegando, uma câmera congelada não era detectada.

A V111 monitora os bytes de vídeo separadamente. Quando o vídeo esperado para de trafegar:

1. solicita `media-resync-request` ao emissor;
2. reanexa a track de vídeo (`replaceTrack(null)` → track) para forçar reativação do encoder/keyframe;
3. executa ICE restart;
4. se o problema persistir, recria apenas o peer do participante afetado.

O compartilhamento nativo Android também recria peers em `FAILED` **e** `DISCONNECTED`, reduzindo casos de compartilhamento parado em um único frame.

## Migration

Aplicar após a 086:

`supabase/migrations/087_taskboard_hours_report_and_meeting_reliability.sql`

## Arquivos alterados

- `components/hours/hours-view.tsx`
- `components/chat/call-room.tsx`
- `android-client/app/src/main/java/br/com/softwork/devboard/webrtc/NativeScreenShareManager.kt`
- `supabase/migrations/087_taskboard_hours_report_and_meeting_reliability.sql`
- `WEBRTC_VALIDACAO.md`
- `V111_FIX_NOTES.md`
