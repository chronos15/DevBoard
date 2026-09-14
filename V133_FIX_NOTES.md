# TaskBoard V133 — Skeleton do compartilhamento alinhado à tela real

## Alterações

- Criado um skeleton específico para `/compartilhar`, seguindo a mesma composição da tela "Enviar para...".
- O skeleton agora representa:
  - cabeçalho com voltar, título e logo;
  - campo de busca;
  - resumo do conteúdo compartilhado;
  - seção de recentes/destinos;
  - filtros rápidos;
  - rodapé fixo com destino e botão Enviar.
- O mesmo skeleton é utilizado tanto durante a hidratação do `AppShell` quanto durante a leitura do conteúdo compartilhado, eliminando a troca entre loadings visualmente diferentes.
- Adicionadas margens laterais `px-3` no mobile e `sm:px-5` em telas maiores, iguais à tela final.
- Nenhuma regra de compartilhamento, permissão ou envio foi alterada.
- Não há migration nova.
