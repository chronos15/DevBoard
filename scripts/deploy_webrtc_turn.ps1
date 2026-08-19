param(
  [Parameter(Mandatory = $true)]
  [string]$ProjectRef,

  [Parameter(Mandatory = $true)]
  [string]$TurnKeyId,

  [Parameter(Mandatory = $true)]
  [string]$TurnApiToken,

  [int]$Ttl = 86400
)

$ErrorActionPreference = 'Stop'

if ($Ttl -lt 3600 -or $Ttl -gt 86400) {
  throw 'Ttl deve estar entre 3600 e 86400 segundos.'
}

Write-Host 'Vinculando projeto Supabase...'
supabase link --project-ref $ProjectRef

Write-Host 'Configurando segredos TURN...'
supabase secrets set "CLOUDFLARE_TURN_KEY_ID=$TurnKeyId" "CLOUDFLARE_TURN_API_TOKEN=$TurnApiToken" "CLOUDFLARE_TURN_TTL=$Ttl"

Write-Host 'Publicando Edge Function webrtc-ice-servers...'
supabase functions deploy webrtc-ice-servers

Write-Host ''
Write-Host 'Concluído. Abra uma reunião no Devboard e confira Áudio e vídeo > Conectividade WebRTC.' -ForegroundColor Green
Write-Host 'O status esperado é TURN disponível. Em redes que exigem relay, a rota aparecerá como TURN relay.'
