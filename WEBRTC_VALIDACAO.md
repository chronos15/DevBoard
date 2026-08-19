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

Esta versão mantém peers WebRTC por uma janela de tolerância quando o Supabase Presence oscila durante troca de Wi‑Fi/4G, background/foreground ou reconexão do socket. A sinalização SDP/ICE é processada em fila por peer para impedir concorrência entre `offer`, `answer` e candidatos ICE. A chamada também executa health-check periódico do RTP e solicita ICE restart somente quando a mídia realmente deixa de trafegar por uma janela sustentada.

Teste recomendado:

1. Estabeleça áudio e vídeo nos dois sentidos.
2. Coloque o celular em background por 5–10 segundos e volte.
3. Troque Wi‑Fi por 4G/5G e aguarde a reconexão.
4. Faça mute/unmute e câmera on/off após a troca de rede.
5. Confirme que o peer não some apenas porque o Presence ficou temporariamente vazio.

## Compartilhamento de tela em navegador mobile

O Devboard usa `navigator.mediaDevices.getDisplayMedia()` quando a API existe. O compartilhamento exige HTTPS e uma ação explícita do usuário.

No Chrome Android/Android WebView, a API de captura de tela do sistema ainda não é exposta ao conteúdo web. Nesse ambiente o Devboard mostra uma mensagem específica em vez do erro genérico de contexto. Captura da tela inteira do aparelho Android exigirá um cliente Android nativo (por exemplo, usando MediaProjection) ou um wrapper com ponte nativa; uma PWA/web pura não consegue contornar a ausência da API do navegador.
