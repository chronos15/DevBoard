# TaskBoard V196 — Correção ao abrir Acompanhamento pela notificação

## Problema reproduzido
Ao clicar em uma notificação que direciona para outra subatividade no Acompanhamento, a tela podia abrir por alguns instantes e depois cair no Error Boundary (`This page couldn't load`).

No vídeo, o erro fatal no console é:

`cannot add 'presence' callbacks for realtime:taskboard-typing:... after subscribe()`

## Causa
O indicador de "digitando" usa Supabase Realtime Presence. O cliente Realtime reaproveita o canal enquanto um tópico com o mesmo nome ainda estiver registrado.

O cleanup anterior fazia:

1. `untrack()`;
2. somente no `finally` removia o canal.

Em uma navegação rápida (como abrir uma subatividade pela notificação), o novo Acompanhamento podia inicializar antes desse cleanup terminar. O Supabase então devolvia o canal anterior, que ainda estava inscrito. Ao tentar adicionar novamente os listeners de Presence, a versão atual do realtime-js lança uma exceção e o React derruba a tela.

Também havia uma recriação desnecessária do canal quando o nome/membros eram atualizados.

## Correção aplicada
- o nome do usuário usado no payload agora é mantido em `ref`, sem reiniciar o canal quando `members` muda;
- antes de criar um canal de digitação, qualquer canal residual do mesmo tópico é removido e aguardado;
- no cleanup o canal é removido diretamente, sem aguardar `untrack()` para só então iniciar a remoção;
- o estado de `typing` continua sendo preservado durante a reconexão;
- nenhuma regra de notificação, Acompanhamento ou Presence global foi alterada.

## Banco
Nenhuma migration nova.

## Versão
Versão embutida atualizada para V196.
