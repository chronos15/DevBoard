# TaskBoard V86 — Equipe em tempo real + Anotações

## Painel
- Os três cards da primeira linha analítica (`Horas registradas`, `Equipe agora` e `Status das tarefas`) passam a ter a mesma altura no desktop.
- `Equipe agora` ganhou reconexão automática do Supabase Presence, watchdog de assinatura e sincronização imediata após `track`.
- Em reconexões temporárias o painel preserva o último estado conhecido, evitando transformar todos os usuários em “Atualizando status…” até um F5.

## Anotações
- O recurso antes apresentado como `Checklist` da subatividade passa a se chamar **Anotações** na interface e nos novos logs, mantendo a tabela/RPCs históricas para compatibilidade.
- Atividades agora possuem **Anotações** próprias, acessíveis no Modo Completo, Acompanhamento e Modo Resumido.
- Cada anotação de atividade pode ser transformada em subatividade. O título vem preenchido com a própria anotação e o usuário pode escolher responsável e estimativa antes de criar.
- A anotação original não some após a conversão: ela fica marcada como “Transformada em subatividade” e oferece atalho para abrir a subatividade criada.
- Inclusão, remoção e transformação geram logs do projeto.

## Banco
Execute `073_taskboard_activity_notes_and_realtime_presence.sql` depois da migration 072.
