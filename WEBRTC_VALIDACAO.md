# Devboard — validação WebRTC desktop ↔ mobile

Esta versão usa uma negociação determinística por par de dispositivos:

- apenas um peer é o **offerer**;
- o outro peer é sempre o **answerer**;
- os m-lines de `audio` e `video` são criados desde a primeira oferta como `sendrecv`;
- ligar/desligar câmera e microfone usa as tracks já negociadas e não cria offers concorrentes;
- ICE restart só ocorre em falha real de conectividade;
- áudio remoto é separado do elemento de vídeo e a saída de som é desbloqueada no gesto de **Atender/Entrar**.

## Antes do teste

1. Confirme HTTPS em desktop e mobile.
2. Confirme o TURN em **Chat → Reunião → Áudio e vídeo → Conectividade WebRTC**.
3. Em redes diferentes, prefira que apareça `TURN relay` ou uma rota direta conectada.
4. No Chrome mobile, permita Microfone e Câmera para o domínio do Devboard.

## Teste A — desktop chama mobile

1. Desktop inicia vídeo.
2. Mobile recebe a chamada e toca **Atender**.
3. Confirme áudio desktop → mobile.
4. Confirme áudio mobile → desktop.
5. Confirme vídeo desktop → mobile.
6. Confirme vídeo mobile → desktop.
7. Mute/desmute 10 vezes de cada lado.
8. Ligue/desligue câmera 5 vezes de cada lado.

Resultado esperado: os dois sentidos continuam ativos e o ícone de mute/câmera acompanha a outra ponta em menos de ~1 s.

## Teste B — mobile chama desktop

Repita o Teste A invertendo quem inicia. O resultado deve ser idêntico; quem iniciou a chamada não muda o papel de envio/recebimento de mídia.

## Teste C — áudio mobile

1. Atenda a chamada tocando **Atender** (não entre por refresh automático).
2. Se o navegador bloquear autoplay, o tile remoto exibirá **Ativar áudio e vídeo**.
3. Toque uma vez nesse botão. Após o gesto, o Devboard mantém um `AudioContext` compartilhado para a chamada.
4. Teste com volume físico do celular acima de 50% e sem Bluetooth conectado por engano.

## Teste D — troca de rede

1. Entre com o celular em Wi‑Fi.
2. Durante a chamada, desligue o Wi‑Fi e deixe 4G/5G.
3. Aguarde alguns segundos.
4. O ICE restart deve recuperar a conexão sem recriar a reunião.

## Diagnóstico

Em **Áudio e vídeo → Conectividade WebRTC**, confira o estado por participante:

- `connected` + `TURN relay`: mídia passou pelo TURN;
- `connected` + `STUN / direta`: P2P direto;
- `connected` + `Rede local / direta`: mesma rede;
- `failed`: verifique TURN, firewall e logs do Realtime.

No Supabase, verifique também os logs do Realtime. O Devboard usa Broadcast para sinalização WebRTC e para o estado rápido de mute/câmera, e Presence apenas para presença/reconciliação.

## Estabilidade de rede / mobile

Esta versão mantém peers WebRTC por uma janela de tolerância quando o Supabase Presence oscila durante troca de Wi‑Fi/4G, background/foreground ou reconexão do socket. A sinalização SDP/ICE é processada em fila por peer para impedir concorrência entre `offer`, `answer` e candidatos ICE. Na V141, o health-check volta ao comportamento da V110: monitora progresso agregado de RTP e solicita ICE restart somente após quatro verificações consecutivas (~20 s) sem progresso esperado.

Teste recomendado:

1. Estabeleça áudio e vídeo nos dois sentidos.
2. Coloque o celular em background por 5–10 segundos e volte.
3. Troque Wi‑Fi por 4G/5G e aguarde a reconexão.
4. Faça mute/unmute e câmera on/off após a troca de rede.
5. Confirme que o peer não some apenas porque o Presence ficou temporariamente vazio.

## Compartilhamento de tela em navegador mobile

O Devboard usa `navigator.mediaDevices.getDisplayMedia()` quando a API existe. O compartilhamento exige HTTPS e uma ação explícita do usuário.

No Chrome Android/Android WebView, a API de captura de tela do sistema ainda não é exposta ao conteúdo web. Nesse ambiente o Devboard mostra uma mensagem específica em vez do erro genérico de contexto. Captura da tela inteira do aparelho Android exigirá um cliente Android nativo (por exemplo, usando MediaProjection) ou um wrapper com ponte nativa; uma PWA/web pura não consegue contornar a ausência da API do navegador.

## V140 — estabilidade de vídeo e gravação owner-only (histórico; substituído pela V141)

A V140 corrige a estratégia de recuperação introduzida na V111. O problema não era apenas detectar vídeo parado; a recuperação anterior podia ser destrutiva demais para uma conexão que ainda estava saudável.

### O que mudou no vídeo

- `replaceTrack(null) -> track` foi removido da recuperação. A track não é mais destacada do sender só para tentar gerar keyframe.
- congelamento visual não executa ICE restart imediatamente; ICE restart fica reservado para falha real de transporte (`failed` ou `disconnected` persistente);
- o health-check considera **frames codificados/decodificados + bytes**, não apenas bytes;
- o watchdog não trata background/minimização do PWA como travamento de vídeo;
- após uma janela sustentada sem frames, a recuperação usa primeiro rebind seguro e depois uma renegociação SDP normal, preservando o mesmo `RTCPeerConnection`;
- peer conectado não é mais destruído/recriado somente por vídeo parado;
- tracks remotas antigas/encerradas são removidas do `MediaStream`, evitando que o `<video>` continue preso em uma track obsoleta/preta;
- tracks locais encerradas inesperadamente são readquiridas sem recriar o peer; se o dispositivo escolhido sumiu, o TaskBoard tenta o dispositivo padrão;
- `replaceTrack()` não é repetido quando o sender já aponta para a mesma track viva, evitando resets desnecessários do encoder;
- sinalização atrasada não é aplicada em uma instância de peer que já foi substituída;
- uma oferta sem resposta possui timeout/rollback. Se `offer`/`answer` se perder no Realtime, a conexão volta a `stable` e tenta negociar novamente em vez de ficar presa em `have-local-offer`;
- `DISCONNECTED` ganhou tolerância maior antes de recuperação, tanto no peer principal quanto no compartilhamento nativo Android.

### Gravação

A regra continua estritamente **owner-only**:

- somente `meetings.created_by` cria `BrowserMeetingRecorder`;
- somente o owner alimenta as fontes da gravação;
- somente o owner atende pedido de finalização/publicação;
- um recorder residual em cliente não-owner é interrompido e nunca publicado;
- a migration 087 continua protegendo a mesma regra no banco por trigger/RPC.

Não há migration nova na V140.

### Cenários mínimos de validação

1. Owner inicia reunião em uma subatividade e dois usuários entram em seguida. Todos devem ver/escutar todos.
2. Deixe câmera parada por pelo menos 30 s. Não deve ocorrer ciclo de reconexão nem card preto.
3. Minimize o PWA por 10–20 s e retorne. A chamada deve preservar o peer e recuperar mídia sem restart imediato.
4. Troque Wi-Fi por 4G/5G. `DISCONNECTED` transitório deve aguardar; falha persistente deve recuperar por ICE restart.
5. Ligue/desligue câmera repetidamente; a mesma m-line deve ser reutilizada sem tela preta.
6. Compartilhe tela em Android nativo e provoque troca de rede. O peer nativo não deve recriar em loop a cada oscilação curta.
7. Durante a chamada, desconecte/troque uma câmera ou microfone USB/Bluetooth. A fonte deve recuperar sem recriar a conexão inteira.
8. Encerre a reunião por participante e por owner. Somente o owner deve produzir/uploadar/publicar a gravação.

Para chamadas entre redes diferentes, o TURN continua sendo necessário quando uma rota direta não é possível. Confira em **Áudio e vídeo → Conectividade WebRTC** se a Edge Function `webrtc-ice-servers` está retornando TURN.

## V141 — retorno controlado ao núcleo WebRTC da V110

A V141 substitui a estratégia experimental de recuperação de vídeo introduzida na V111 e modificada novamente na V140. Como a reunião era estável até a V110, o fluxo de mídia/sinalização voltou à base conhecida como funcional, sem rollback dos demais módulos do TaskBoard.

Comportamento efetivo da V141:

- não existe `media-resync-request`;
- não existe `replaceTrack(null) -> track` para tentar forçar keyframe;
- um card sem avanço visual não destrói/recria o peer;
- o health-check volta a observar RTP total em intervalos de 5 s e solicita ICE restart após quatro verificações consecutivas sem progresso;
- `DISCONNECTED` do compartilhamento nativo Android não recria o peer imediatamente;
- o receiver nativo só é fechado automaticamente em `failed` ou `closed`;
- a gravação continua **owner-only**, protegida no frontend e pela migration 087.

Para validar a regressão, priorize primeiro um teste simples com dois navegadores/dispositivos, câmera e microfone ligados por alguns minutos. Depois teste câmera on/off, background/foreground, troca de rede e compartilhamento de tela. Isso ajuda a separar falha de negociação/mídia de limitações de TURN/rede.


## V143 — teste de sinalização confiável

A V143 adiciona um handshake `ready`, retry de SDP e a migration 090 como fallback persistente para sinais WebRTC. O cenário principal de aceite é o caso em que ambos aparecem como conectados à sala, mas a mídia remota não inicia.

1. Aplique `090_taskboard_reliable_meeting_signaling.sql`.
2. Abra a mesma reunião em desktop e Android/Chrome.
3. Confirme `2/2 na sala`.
4. Em poucos segundos, os dois lados devem sair de **Conectando mídia** e receber áudio/vídeo remoto.
5. Recarregue um dos lados durante a chamada; a nova sessão deve renegociar sem exigir recriar a reunião.
6. Troque Wi‑Fi/4G e valide a renegociação.
7. Se aparecer aviso de ausência de TURN, teste também com TURN configurado para separar sinalização de limitação de NAT/CGNAT.

O fallback do banco não transporta áudio/vídeo. Ele guarda somente `offer`, `answer`, ICE, `ready` e restart por uma janela curta, com acesso restrito a membros efetivamente `joined` na reunião.


## V144 — ICE/TURN UDP-first e negociação SDP estável

A V144 corrige dois pontos do diagnóstico visto em produção:

- depois de `offer/answer`, o handshake não gera novas offers enquanto ICE está apenas `checking`;
- o navegador começa com STUN + TURN/UDP e somente promove TCP/TLS se a rota inicial não conectar.

Durante o teste, o console agora informa:

- `TaskBoard: candidato TURN relay disponível` quando o navegador realmente conseguiu gerar candidate relay;
- `TaskBoard: erro ICE` com `errorCode`, `errorText`, URL, endereço e porta, deduplicado por rota.

Um `icecandidateerror` 701 de um endpoint específico não prova falha total se outro endpoint/candidate funcionar. O aceite deve ser feito pelo `connectionState=connected` e pela rota selecionada em **Conectividade WebRTC**.

Não há migration nova. Mantenha a migration 090 aplicada.


## V145 — SDP com ICE embutido

O handshake principal aguarda o ICE gathering antes de enviar offer/answer. Isso faz com que candidatos host/srflx/relay já viajem dentro do SDP e reduz a dependência de trickle ICE. Em falha da primeira tentativa, o peer muda para TURN relay-only e faz um ICE restart controlado.

## V146 — sinalização explícita por HTTP + trickle ICE da V110

A V146 substitui a estratégia da V145 de aguardar o ICE gathering e o fallback relay-only. O diagnóstico em produção mostrou que o Cloudflare TURN está gerando candidatos `relay`, enquanto o supabase-js avisava que `channel.send()` estava fazendo fallback implícito para REST durante a sinalização.

Comportamento efetivo:

- o `RTCPeerConnection` recebe desde o início a lista completa devolvida pela Edge Function (STUN + TURN UDP/TCP/TLS), como na base V110;
- offer/answer são enviados imediatamente após `setLocalDescription()`;
- candidatos ICE são enviados por trickle ICE conforme são gerados;
- Broadcast da reunião usa `channel.httpSend()` explicitamente, evitando o fallback implícito/depreciado de `send()`;
- offer/answer/ICE continuam sendo persistidos também pela RPC da migration 090 e recuperados pelo poller, como caminho redundante;
- quando o lado answerer detecta o outro participante mas ainda não recebeu offer, envia uma única `restart-request`, garantindo que o offerer publique novamente o SDP;
- não existe handshake `ready`, espera de ICE gathering, troca automática para relay-only ou retry de SDP em loop.

Teste mínimo:

1. encerre qualquer sala criada antes do deploy;
2. abra uma reunião nova com dois usuários distintos;
3. confirme `2/2 na sala`;
4. no console, deve aparecer `TaskBoard: enviando offer WebRTC` em um lado e `TaskBoard: offer WebRTC recebida` no outro;
5. em seguida devem aparecer answer e candidatos ICE; o card remoto deve mudar de `Conectando mídia` para conectado;
6. o aviso `Realtime send() is automatically falling back to REST API` não deve mais ser originado pelo módulo de reunião;
7. mantenha a migration 090 aplicada. Não existe migration nova na V146.

## V147 — fim do loop offer/answer/ICE restart

A V147 corrige um ciclo interno que podia impedir a chamada de estabilizar mesmo com TURN funcional. O padrão observado era `answer recebida` seguido imediatamente por nova `offer` com `iceRestart: true` enquanto a negociação anterior ainda estava sendo concluída.

Comportamento efetivo:

- não existe mais `restartPending`;
- `signalingstatechange` não cria offer automaticamente;
- ICE restart só pode ocorrer com `signalingState === stable`, `localDescription` e `remoteDescription` válidas;
- `failed` espera 4,5 s e `disconnected` espera 8 s antes da recuperação;
- se o ICE ainda estiver em `gathering`, o restart é adiado;
- timers antigos de restart são cancelados antes de aplicar offer/answer;
- um `restart-request` recebido durante `have-local-offer` apenas reenvia a offer atual, sem empilhar outra negociação;
- o console informa `TaskBoard: candidato TURN relay remoto recebido` quando o candidate relay do outro lado efetivamente chega;
- erros 701 de rotas específicas ficam em nível debug quando há outras rotas disponíveis.

Teste mínimo:

1. crie uma reunião nova após o deploy;
2. abra em dois usuários/dispositivos;
3. confirme que aparece apenas uma offer inicial e uma answer correspondente;
4. não deve existir sequência contínua `answer -> offer iceRestart -> answer -> offer iceRestart`;
5. valide `candidato TURN relay disponível` e, quando necessário, `candidato TURN relay remoto recebido`;
6. aguarde pelo menos 10 s antes de concluir que a primeira rota falhou;
7. somente após falha persistente deve ocorrer um ICE restart controlado.

## V148 — sinalização WebSocket única (hard reset pré-V111)

A V148 remove o caminho experimental de sinalização WebRTC por `httpSend()` + `meeting_webrtc_signal_send/pull` do fluxo ativo da chamada. `offer`, `answer`, candidatos ICE e `restart-request` voltam a usar somente o Broadcast do canal Realtime quando o canal está em `SUBSCRIBED`, preservando a ordem e o comportamento da base funcional anterior à V111.

Durante o primeiro handshake não há ICE restart automático. A recuperação por restart só é habilitada depois que aquele peer já atingiu `connectionState = connected` pelo menos uma vez.

Logs úteis no teste:

- `TaskBoard: offer WebRTC recebida`
- `TaskBoard: answer WebRTC recebida`
- `TaskBoard: candidato TURN relay remoto recebido` (quando TURN é usado)
- `TaskBoard: track remota recebida` com `kind: audio` e `kind: video`
- `TaskBoard: estado do peer` com `state: connected`

A migration 090 pode permanecer aplicada, mas não participa do handshake/mídia da V148.
