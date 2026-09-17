# TaskBoard V204

## Chat da reunião — Ctrl+V e arrastar corrigidos

- Ctrl+V de arquivos/imagens agora é capturado no painel inteiro do Chat da reunião, não somente quando o compositor está focado.
- Mantido o paste de texto normal quando a área de transferência não possui arquivo.
- Adicionado fallback direto de drag/drop no próprio painel do chat, além do overlay visual existente.
- Arquivos arrastados continuam abrindo no mesmo preview antes do envio.
- Mantidos os limites de 50 MB por arquivo e 150 MB por lote.

## Reunião no mobile — tela de trás não rola mais

- Enquanto a reunião estiver expandida, o documento que está atrás fica travado na posição atual.
- Scroll, swipe e overscroll passam a ficar restritos à própria reunião e aos seus painéis internos.
- Ao minimizar ou fechar a reunião, o documento é restaurado exatamente na posição anterior.
- O bloqueio não é aplicado quando a reunião está minimizada.
- Adicionado `overscroll` contido nos históricos/painéis internos para evitar encadeamento até o documento.

## Estrutura

- Sem migration nova.
- Nenhuma alteração no WebRTC, sinalização, gravação ou regras da reunião.
- Versão física embutida atualizada para **V204**.
