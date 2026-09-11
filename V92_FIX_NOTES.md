# TaskBoard V92 — Equipe, jornada configurável e reunião desacoplada do upload

## Configurações > Equipe

- Administrador pode adicionar usuário informando nome, e-mail, senha, perfil, dias de trabalho e horas por dia.
- A conta é criada pela Supabase Admin API com e-mail já confirmado, sem envio de e-mail de confirmação.
- Administrador pode inativar e reativar colaboradores sem apagar histórico.
- Dias trabalhados e carga diária podem ser editados por usuário.
- A criação direta exige `SUPABASE_SERVICE_ROLE_KEY` somente no servidor; nunca exponha essa chave com `NEXT_PUBLIC_`.

## Painel > Equipe > Horas efetivadas

- O gauge não usa mais referência fixa de 08:00.
- A meta diária vem de `workspace_members.daily_hours`.
- O percentual é calculado somente nos dias configurados em `work_days`.
- Dias fora da jornada aparecem como `Folga`.
- Percentuais acima de 100% continuam exibindo o valor real, mantendo o arco visual limitado a 100%.

## Reuniões

- Admin, criador da reunião e responsável pela subatividade/atividade de origem podem remover participantes da call.
- O usuário removido recebe um evento em tempo real e a sala é fechada no dispositivo dele.
- Ao encerrar a reunião, a gravação é interrompida imediatamente para preservar o último trecho, a call é desligada e o processamento/upload continua sem manter a sala ativa.
- Quando o gravador é outro participante, o pedido para finalizar a gravação é enviado antes da sala ser desmontada.

## Banco

Execute `076_taskboard_team_schedule_and_meeting_controls.sql` depois da migration 075.
