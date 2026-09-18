# TaskBoard V206

## Reunião — toggle de microfone/câmera sem refresh de dispositivos

- Removida a chamada a `enumerateDevices()` do fluxo de **mutar/desmutar microfone** e **ligar/desligar câmera**.
- O toggle agora altera somente `track.enabled` + estado de mídia/presença, preservando PeerConnection, transceivers, senders, receivers e ICE.
- A lista de dispositivos continua sendo carregada na entrada da reunião e nas trocas explícitas de microfone/câmera.
- Adicionado listener nativo de `devicechange` para atualizar a lista somente quando o navegador informar mudança real de hardware.

## Recuperação leve de reprodução remota

- Após um toggle local de microfone/câmera, os players remotos recebem apenas um `HTMLMediaElement.play()` novamente.
- Há uma segunda tentativa curta (220 ms) para cobrir pausas transitórias/aleatórias do decoder em alguns Chrome/drivers.
- Não há `load()`, troca de `srcObject`, recriação de track, renegociação, ICE restart ou recriação de PeerConnection.
- Áudio e vídeo já conectados permanecem na mesma sessão.

## Estrutura

- Sem migration nova.
- Sem alteração em SDP/ICE/sinalização ou criação de peers.
- Versão física embutida atualizada para **V206**.
