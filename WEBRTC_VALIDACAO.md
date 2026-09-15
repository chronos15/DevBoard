# Validação WebRTC — TaskBoard V149

## Regressão V92 corrigida

A V92 vinculou o callback de moderação (`handleMemberRemoved`) ao ciclo de vida do efeito responsável pela conexão WebRTC. Como `onOpenChange` era passado inline pelo host, renders normais do host podiam desmontar o canal e os peers no meio da negociação.

A V149 desacopla completamente a moderação do ciclo de vida da mídia.

## Teste mínimo obrigatório

1. Faça deploy da V149.
2. Confirme no sidebar `V149 - dd/MM HH:mm`.
3. Feche qualquer reunião antiga e crie uma reunião nova.
4. Entre com dois usuários/dispositivos.
5. No console de cada dispositivo deve aparecer uma única vez ao entrar:
   - `TaskBoard: sessão WebRTC iniciada`
6. Durante a reunião, **não** deve aparecer `TaskBoard: sessão WebRTC finalizada` enquanto nenhum usuário sair/trocar de reunião.
7. Confirme `TaskBoard: track remota recebida` para áudio e vídeo.
8. Confirme `TaskBoard: estado do peer` com `state: connected`.
9. Teste mute, câmera, minimizar/restaurar e remoção de participante.
10. Ao sair/encerrar deve aparecer `TaskBoard: sessão WebRTC finalizada` uma vez.

## TURN

A Edge Function Cloudflare atual não precisa ser alterada. A obtenção de candidato `relay` já foi confirmada nos testes anteriores.

## Banco

Nenhuma migration nova. A migration 076 permanece aplicada e a 090 pode permanecer no banco; o fluxo ativo da V148/V149 não depende do polling persistente da 090 para a negociação principal.
