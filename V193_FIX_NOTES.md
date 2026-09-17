# TaskBoard V193 — Aprovação abre no Acompanhamento + correção do loading de anexos

## 1. Card de Ag. Aprovação abre diretamente no Acompanhamento

Na tela **Subatividades recentes**, os cards do tipo **Sua aprovação** agora abrem a própria subatividade pelo fluxo central de Acompanhamento.

- Interface completa: abre `/acompanhamento` já na subatividade correta.
- Interface resumida: abre a mesma subatividade no workspace resumido.
- Os botões X e ✓ continuam aprovando/revogando no próprio card sem navegar.
- Os cards comuns de subatividade mantêm a navegação anterior.

## 2. Anexo enviado não fica mais preso em "Carregando imagem..."

Corrigida uma condição de corrida no preview de imagem/vídeo logo após o upload no Acompanhamento.

O preview local via `blob:` pode carregar praticamente de forma instantânea. Antes, o `onLoad` podia marcar a mídia como pronta e, logo depois, um `useEffect` resetava esse estado para `false`. Como a URL não mudava novamente, o overlay de **Carregando imagem...** permanecia para quem enviou até remontar a tela.

Agora a prontidão da mídia fica vinculada à URL exata que concluiu `onLoad`/`onLoadedMetadata`. Ao trocar de URL, a nova mídia naturalmente volta ao estado de carregamento; ao terminar, libera o preview sem depender de refresh ou troca de atividade.

Além disso, após o upload concluído o estado otimista é reconciliado com os dados canônicos de projetos do servidor. Isso mantém o envio instantâneo, mas evita que o remetente fique com um estado visual antigo caso o Realtime chegue fora de ordem.

A rotina de Storage, RPCs e persistência de anexos foi preservada.

## 3. Versão

Versão física embutida atualizada para **V193**.

Não há migration nova nesta versão.
