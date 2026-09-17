# TaskBoard V185 — Marcador de menção mais discreto

## Ajuste visual

O marcador lateral usado nas mensagens que mencionam o usuário foi refinado sem alterar nenhuma regra de menção ou notificação.

- barra lateral reduzida de 3px para 2px;
- maior recuo superior e inferior para não disputar visualmente com o arredondamento/borda do card;
- marcador deslocado 1px para dentro do componente, evitando a sensação de ultrapassar a borda;
- cantos totalmente arredondados e intensidade levemente suavizada;
- aplicado tanto aos cards de mensagem (`tb-mentioned-message`) quanto às bolhas (`tb-mentioned-bubble`), mantendo consistência em Acompanhamento, Solicitações, AQS, Chat e reunião onde essas classes já são reutilizadas.

Nenhuma regra de negócio, banco de dados, menção ou notificação foi alterada. Não há migration nova.
