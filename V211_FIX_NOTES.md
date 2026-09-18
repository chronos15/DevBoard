# TaskBoard V211

## Reunião — preview local não fica mais preto ao alternar Mural

- Corrigida a causa estrutural que ainda permitia o preview da própria câmera ficar preto ao alternar entre a grade normal e o modo Mural.
- A V210 tentava reanexar o stream por um único `localVideoRef`, mas a grade normal e o painel do Mural criam elementos `<video>` diferentes. Durante a troca de layout, o ciclo de mount/unmount podia deixar o ref apontando para o elemento antigo ou ser zerado no timing errado.
- O preview local agora é autocontido em cada `ParticipantTile`: no instante em que o `<video>` é montado ele busca diretamente o `MediaStream` atual e atribui o `srcObject` no próprio elemento.
- Também há reaplicação local em `requestAnimationFrame` e uma tentativa curta de `play()` para cobrir o timing do Chrome durante mudanças de layout.
- O getter lê diretamente `screenStreamRef.current` / `localStreamRef.current`, então não depende de state antigo nem de ref DOM compartilhado.

## Estrutura preservada

- Nenhuma alteração em ICE, SDP, RTCPeerConnection, sender, receiver, renegociação ou captura da câmera.
- A track local continua exatamente a mesma; apenas o elemento HTML de preview é reconectado ao stream existente.
- O outro participante não sofre qualquer reinício ou interrupção de mídia.
- Nenhuma migration nova.
- Há ainda um fallback defensivo: um stream antigo de compartilhamento de tela só é usado se ainda possuir track de vídeo `live`; caso contrário o preview volta imediatamente para o stream local da câmera.
