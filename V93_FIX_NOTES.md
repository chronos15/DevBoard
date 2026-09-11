# TaskBoard V93 — Jornada semanal HH:mm e acesso personalizado

## Configurações > Equipe

- A jornada deixa de ser uma única quantidade de horas para todos os dias.
- Cada dia da semana possui sua própria carga no formato `HH:mm`.
- Dias desligados são tratados como folga.
- Exemplo suportado: segunda a sexta `08:00` e sábado `04:00`.
- A listagem da equipe foi reorganizada para telas pequenas: identificação e ações não ficam mais espremidas na mesma linha.
- Os cards possuem mais espaçamento e as ações administrativas quebram para uma segunda linha no mobile.

## Painel > Equipe > Horas efetivadas

- O gauge usa a meta do dia da semana atual.
- Se sábado estiver configurado como `04:00`, quatro horas trabalhadas representam 100%.
- A jornada antiga (`work_days` + `daily_hours`) continua sincronizada como fallback para clientes antigos.

## Acesso personalizado por usuário

Foi criada uma camada opcional, desacoplada da role base.

- Por padrão ela fica **desativada** para todos os usuários existentes.
- Desativada = comportamento idêntico às versões anteriores.
- A role continua sendo o teto de permissão. O acesso personalizado pode restringir, nunca promover um usuário para funções que sua role não possua.
- Administradores continuam com acesso integral e não podem ser acidentalmente bloqueados.
- É possível escolher quais telas daquele perfil ficam disponíveis.
- É possível restringir separadamente:
  - projetos: somente projetos em que o usuário está integrado direta ou indiretamente;
  - atividades: somente atividades em que participa diretamente ou por subatividade;
  - subatividades: somente subatividades em que é responsável ou participante.
- As restrições estruturais também são aplicadas pela RLS do Supabase, não apenas escondidas na interface.
- O Modo Resumido respeita as mesmas permissões de Acompanhamento, Solicitações, Análise AQS e Chat.

## Banco

Execute `077_taskboard_weekly_schedule_and_access_profiles.sql` depois da migration 076.

A migration cria:

- `workspace_member_work_schedule` — meta em minutos para cada dia da semana;
- `workspace_member_access_profiles` — perfil opcional de acesso por usuário;
- RPCs administrativas para jornada e acesso;
- helpers RLS para projetos, atividades e subatividades.

A migration migra a jornada V92 para o novo formato sem mudar a meta efetiva dos usuários existentes. Nenhum perfil de acesso personalizado é ativado automaticamente.
