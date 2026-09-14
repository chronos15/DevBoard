# V108 — Card completo da subatividade abre detalhes inline

## Alteração

- Na visualização em Lista do projeto, o clique para abrir/recolher os detalhes inline da subatividade deixou de ficar restrito ao nome.
- Agora qualquer área livre do card da subatividade alterna o resumo inline.
- O card recebeu `cursor-pointer` para comunicar melhor a interação.

## Proteção dos controles internos

Os controles continuam independentes e não abrem/recolhem o resumo ao serem usados:

- concluir/reabrir;
- foco;
- editar;
- copiar link;
- brainstorm;
- comentários;
- anexos;
- status;
- responsável/perfil;
- cronômetro;
- links, inputs e demais elementos interativos.

O clique no nome continua funcionando como antes.

## Banco de dados

- Nenhuma migration nova.
- Nenhuma alteração de estrutura ou persistência.
