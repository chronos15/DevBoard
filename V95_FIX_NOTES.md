# TaskBoard V95 — Permissões de ações, reação acima do feed e contexto de projeto

## Permissões estruturais desacopladas

O perfil personalizado da V93 ganhou uma segunda camada chamada **Ações permitidas**. Ela só é aplicada quando o acesso personalizado do colaborador estiver ativo; usuários existentes continuam usando as regras legadas enquanto essa opção permanecer desligada.

As ações configuráveis desta versão são:

- Adicionar projetos
- Editar projetos
- Adicionar atividades
- Adicionar subatividades

A role e as regras de integração continuam sendo o teto da operação. As novas flags servem para restringir ações que o fluxo atual já permitiria; não transformam um usuário em Administrador nem contornam as regras de responsável/integrante. Administradores continuam com acesso integral.

A proteção foi aplicada no frontend e nas RPCs do Supabase. `editProjects` também cobre identidade visual, versionamento e o novo contexto organizacional do projeto. A transformação de uma anotação de atividade em subatividade passa pela mesma permissão de criação de subatividade.

## Reações no Acompanhamento

O seletor **Adicionar reação** agora é renderizado em um portal no `document.body`, com posicionamento em viewport e camada própria. Isso elimina o problema em que o popup ficava atrás da mensagem seguinte por causa do `overflow`/stacking context do histórico.

## Mensagem + anexo durante upload

O agrupamento de mensagem e anexos da V91 foi mantido e o estado otimista foi reconciliado com os registros que chegam do Realtime. Quando o comentário ou um anexo já apareceu no payload persistido, o equivalente otimista deixa de ser desenhado. Assim, o envio continua mostrando texto + previews no mesmo bloco, mas não aparece duplicado durante a transição entre upload local e registro salvo.

## Módulos, assuntos e departamentos responsáveis

A criação/edição de projeto ganhou a seção **Contexto do sistema**, com listas editáveis de:

- Módulos do sistema
- Assuntos
- Departamentos responsáveis

Os itens são persistidos nas colunas `projects.modules`, `projects.subjects` e `projects.responsible_departments`. Cada lista aceita até 40 entradas e cada item até 100 caracteres. Alterações geram log do projeto.

## Banco

Execute `078_taskboard_action_permissions_project_context.sql` depois da migration 077.
