# TaskBoard V205

## Chat da reunião — drag/drop não atravessa mais para a subatividade

- O destino de drag/drop do chat da reunião agora é **exclusivo enquanto a reunião/chat estiver aberto**.
- Overlays globais da tela que está atrás (Acompanhamento, atividade/subatividade, AQS etc.) ficam impedidos de capturar o mesmo arquivo durante o arraste.
- O `drop` é consumido pela camada da reunião antes de alcançar a tela inferior.
- Mantido o overlay visual de “Solte para anexar à reunião”.
- Ctrl+V continua funcionando no painel inteiro do chat da reunião.

## Preview de anexos inline

- Removido o modal de preview usado ao colar/arrastar anexos no chat da reunião.
- Arquivos agora aparecem **inline acima do campo de mensagem**, no mesmo padrão visual do Acompanhamento.
- Imagens e vídeos mostram miniatura; arquivos comuns mostram nome e tamanho.
- É possível remover um arquivo, remover todos ou adicionar mais antes do envio.
- Imagens mantêm a ação de edição antes do envio.
- O próprio campo de mensagem passa a funcionar como legenda do lote de anexos.
- O botão Enviar envia texto/legenda + anexos a partir do mesmo compositor.

## Estrutura

- Sem migration nova.
- Nenhuma alteração em WebRTC, gravação ou regras de reunião.
- Versão física embutida atualizada para **V205**.
