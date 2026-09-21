# TaskBoard V226

## Realtime mais tolerante a quedas móveis

- A desconexão do canal principal não exibe mais alerta imediatamente.
- O TaskBoard executa 3 tentativas silenciosas de reconexão antes de sinalizar problema ao usuário.
- Em Wi-Fi/4G offline, as mesmas tentativas continuam em segundo plano e a reconexão também é retomada ao voltar online/abrir o PWA.
- Se a falha persistir, o antigo card grande foi substituído por um aviso compacto “Realtime instável · reconectando…”.
- Ao recuperar o canal, o aviso some e o sistema reconcilia as alterações que podem ter ocorrido durante a queda.

## Registros de reunião protegidos

- Gravações automáticas (`Gravacao - ...`) e PDF do chat (`Chat da reunião - ...pdf`) passam a ser reconhecidos como registros técnicos protegidos.
- Usuários comuns não podem excluir esses registros, mesmo quando são owner/criador da chamada.
- A proteção é aplicada no backend (RPC), não apenas na interface.
- ADMIN não apaga o registro: pode somente **Ocultar registro** / **Exibir registro**, de forma reversível.
- Quando oculto, o registro some da interface dos usuários comuns e o Storage bloqueia novas tentativas de abrir o vídeo/PDF; o ADMIN continua vendo o item inativo para poder reativá-lo.
- A regra vale para reuniões iniciadas em subatividade, Análise AQS e Solicitações.
- Em Solicitações, anexos passam a possuir estado `active`, mantendo todos os anexos existentes como ativos por padrão.

## Banco de dados

Aplicar a migration:

`supabase/migrations/099_taskboard_meeting_artifact_visibility.sql`

Ela preserva as regras anteriores de anexos comuns e acrescenta apenas as restrições dos registros automáticos de reunião.
