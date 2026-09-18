# TaskBoard V209

## Reunião — participantes em blocos no modo Mural

- Ao entrar no **Mural**, a lateral de Participantes passa a abrir por padrão no modo de **quadrinhos com câmera**, mantendo áudio/vídeo exatamente no mesmo WebRTC já usado pela reunião.
- Foi adicionado um switch compacto, disponível **somente no modo Mural**, para alternar entre:
  - quadrinhos de vídeo/câmera;
  - lista de participantes já existente.
- O modo escolhido é local para o usuário e não altera a visualização dos outros participantes.

## Reunião — Chat do Mural sem derrubar a página

- O Chat da reunião não é mais desmontado/remontado ao alternar entre Participantes e Chat no desktop. Ele permanece montado e apenas muda de visibilidade, preservando estado e evitando a condição de corrida que fazia a página cair ao abrir o Chat durante o Mural.
- O canal de reações do Chat agora usa um identificador único por montagem, evitando colisão com um canal anterior ainda em processo de remoção pelo Supabase Realtime.
- Quando o Chat está oculto no Mural, os listeners de Ctrl+V e o capturador exclusivo de drag/drop ficam desativados, evitando que um painel invisível intercepte anexos destinados ao Acompanhamento/mural.

## Estrutura preservada

- Nenhuma alteração de banco ou migration.
- Nenhuma mudança em ICE, SDP, PeerConnection, tracks, gravação, câmera ou áudio.
- O Mural continua sendo uma visualização local: cada participante abre/fecha quando quiser.
