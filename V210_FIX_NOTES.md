# TaskBoard V210

## Reunião — painel lateral sem espaço vazio no desktop

- Corrigido o wrapper de Participantes no desktop para ocupar 100% da largura da sidebar.
- O painel de Participantes e o painel do Mural agora usam a largura inteira disponível, sem o espaço vazio à direita que aparecia apenas em telas maiores.
- Mobile permanece com o mesmo comportamento atual.

## Reunião — preview local da câmera ao alternar Mural

- Corrigido o caso em que a própria câmera ficava preta somente para o usuário local ao alternar entre a grade normal e o Mural.
- A causa era visual: ao trocar o layout, o `<video>` local era remontado em outra região e o novo elemento podia nascer sem o `srcObject`, embora a track continuasse sendo enviada normalmente aos demais participantes.
- Agora o TaskBoard reanexa o mesmo `MediaStream` ao novo elemento de preview e reaplica `play()` somente na UI local.
- Há uma segunda tentativa curta (120 ms) para cobrir o timing do Chrome durante a troca de layout.

## Estrutura preservada

- Nenhuma alteração em ICE, SDP, PeerConnection, sender/receiver ou renegociação.
- Nenhuma track é recriada, parada ou substituída por causa do Mural.
- Nenhuma migration nova.
- O aviso eventual de Presence `timed out` continua sendo tratado como evento separado; não é usado para reiniciar mídia nem alterar a chamada.
