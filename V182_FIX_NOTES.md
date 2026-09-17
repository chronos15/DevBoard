# TaskBoard V182 — Equipe, Gantt, isolamento do acompanhamento e marcador de foco

## 1. Card Equipe · ação "Mais"
- removido o nome do usuário da descrição;
- agora exibe somente: **Dashboard, cronologia e Gantt**.

## 2. Gantt · abrir acompanhamento da subatividade
- o título da subatividade no Gantt agora é clicável;
- as próprias barras/sessões do Gantt também são clicáveis;
- a abertura utiliza o launcher central do Acompanhamento, preservando o modo atual da interface:
  - interface Completa -> Acompanhamento completo;
  - interface Resumida -> workspace resumido na mesma subatividade.

## 3. Subatividade mostrando informações de outra
Corrigido o vínculo textual dos logs legados do projeto.

Antes, o resumo e o Acompanhamento associavam logs usando `includes()` no título. Isso fazia títulos semelhantes vazarem histórico entre subatividades. Exemplo: uma subatividade `UIX` também capturava logs de `UI/UIX`.

Agora um log legado só é relacionado quando contém o **título completo da subatividade como referência entre aspas**. Comentários, anexos e sessões continuam ligados diretamente pelo ID da subatividade, como já eram.

A correção foi aplicada tanto no **Resumo do acompanhamento dentro de Projetos/Atividades** quanto no **Acompanhamento principal**.

## 4. Marcador lateral de foco
- removido o contorno grande/arredondado que aparecia ao abrir uma subatividade por link/foco;
- substituído por um marcador lateral fino, curto e discreto, mantendo apenas um fundo suave.

## Banco de dados
Nenhuma migration nova. Nenhuma tabela, policy, RPC ou enum foi alterado nesta versão.
