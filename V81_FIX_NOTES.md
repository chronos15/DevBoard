# TaskBoard V81 — @todos por tópico, destaque de menção e árvore unificada

## 1. @todos não vincula novos usuários
- `@todos` agora resolve somente os usuários que já pertencem ao tópico/contexto aberto.
- `@here` também é broadcast sem associação e continua limitado, no cliente, às pessoas presentes/online naquele contexto.
- A migration 070 reforça a regra no backend: broadcast não insere novos `project_members`, `subactivity_members`, participantes AQS ou participantes de Solicitação.
- Menção individual, `@desenvolvedores`, `@aqs` e `@admin` preservam a associação intencional implementada na V80.
- Em canais/grupos e reuniões, `@todos` usa somente os membros já existentes do grupo/reunião e não convida novos usuários.

## 2. Mensagem em que eu fui mencionado
Quando o usuário atual aparece nos metadados da menção — por nome, `@todos` ou outro grupo que o inclua — a mensagem recebe tratamento no estilo Discord:
- fundo âmbar/laranja discreto;
- marcador vertical laranja na lateral esquerda;
- mantém contraste correto nos temas claro e escuro.

O destaque foi aplicado em Acompanhamento/Subatividade, comentários, Solicitações, Análise AQS, chat da reunião e canais/conversas.

## 3. Modo Resumido com a mesma árvore do Acompanhamento
A lista de Atividades/Subatividades do Modo Resumido foi alinhada ao layout do Acompanhamento:
- atividade em linha compacta com chevron, `#`, numeração e indicador de execução;
- subatividades recuadas sob uma linha vertical;
- título, status, tempo registrado e avatar do responsável na mesma hierarquia visual;
- seleção e hover seguem o mesmo padrão do Acompanhamento;
- ações administrativas continuam disponíveis sem alterar a estrutura ou regras existentes.

## Migration
Execute `070_taskboard_todos_scope_existing_participants.sql` depois da 069.

> A migration não remove automaticamente participantes que já tenham sido vinculados por `@todos` antes da V81, para evitar excluir associações legítimas indistinguíveis no banco atual.
