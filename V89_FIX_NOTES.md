# TaskBoard V89 — ações compactas da subatividade

## Ajuste de UI

- O cabeçalho do Acompanhamento/Subatividade não exibe mais uma sequência de botões de ação lado a lado.
- Todas as ações foram concentradas em um único botão `…` (Mais ações), reduzindo a largura ocupada no desktop e no mobile.
- O popup mantém as permissões e regras já existentes e reúne:
  - Iniciar reunião;
  - Editar subatividade (Admin);
  - Pesquisar (`Ctrl + F`);
  - Anotações, incluindo contador de pendências;
  - Ativar/encerrar Brainstorm (`Ctrl + Shift + B`);
  - Mensagens fixadas;
  - Iniciar/pausar cronômetro;
  - Alterar situação, em submenu.
- DEV em modo observador continua sem ganhar ações de edição/execução.
- A edição administrativa continua usando o mesmo modal da V87; ele apenas recebeu suporte a abertura controlada pelo novo menu.

## Banco de dados

Nenhuma migration nova é necessária para a V89.
