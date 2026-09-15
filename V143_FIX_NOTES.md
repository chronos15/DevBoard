# TaskBoard V143 — sinalização WebRTC confiável

## Sintoma corrigido

Os participantes entravam na mesma reunião e o Presence mostrava `2/2 na sala`, porém cada dispositivo exibia apenas a própria câmera. O outro participante permanecia indefinidamente em **Conectando mídia / Aguardando entrada**, sem áudio e sem vídeo remoto.

Isso prova que autenticação, entrada na reunião e captura local estavam funcionando; a falha estava no caminho de sinalização `offer / answer / ICE` entre as sessões.

## Correções

### 1. Eleição de offerer independente de locale

A escolha do lado responsável pela oferta não usa mais `localeCompare()`. A comparação agora é lexicográfica/binária entre os IDs de sessão, produzindo a mesma ordem em Windows, Android e navegadores com locales diferentes.

### 2. Handshake explícito `ready`

O answerer anuncia que está pronto para receber a oferta. Se a primeira sincronização de Presence ocorrer no meio da entrada/reconexão, o offerer recebe um novo gatilho para iniciar ou reenviar o SDP.

### 3. Retry de offer/answer

Enquanto o peer ainda não estiver `connected`, o TaskBoard revalida o handshake. Se o offerer estiver em `have-local-offer`, ele reenvia a `localDescription` atual. Como o ICE gathering atualiza essa descrição, os retries também carregam candidatos já descobertos e reduzem dependência de um único evento ICE.

### 4. Fallback persistente no Supabase

Realtime Broadcast continua sendo o caminho principal, mas cada sinal WebRTC recebe uma chave única e também é persistido temporariamente pela RPC de fallback.

O receptor consulta os sinais destinados à sessão atual em intervalos curtos. Se o Broadcast chegar primeiro, a chave deduplica o registro persistido; se o Broadcast se perder, o registro no banco completa a negociação.

Os sinais expiram logicamente em 15 minutos e são removidos oportunisticamente. Eles não fazem parte do histórico da reunião.

### 5. Compatibilidade

Se a migration 090 ainda não estiver aplicada, o cliente detecta a ausência das RPCs e continua usando Realtime Broadcast normalmente. Após aplicar a migration, o fallback passa a funcionar automaticamente.

## Migration obrigatória para o fallback

Execute após a 089:

`supabase/migrations/090_taskboard_reliable_meeting_signaling.sql`

## Gravação

A regra permanece **owner-only**. Somente `meetings.created_by` grava e publica o vídeo final. Nenhuma alteração da V143 devolve takeover de gravação a participantes.

## Arquivos alterados

- `components/chat/call-room.tsx`
- `supabase/migrations/090_taskboard_reliable_meeting_signaling.sql`
- `lib/app-version.ts`
- `next.config.mjs`
- `SUPABASE_SETUP.md`
- `WEBRTC_VALIDACAO.md`
- `V143_FIX_NOTES.md`
