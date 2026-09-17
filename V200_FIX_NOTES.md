# TaskBoard V200 — Zoom de vídeo no mobile e posição do botão Expandir

## Correções
- Corrigidos os botões `-`, percentual/alternar zoom, `+` e reset no visualizador expandido em dispositivos touch.
- O recognizer de pinch/pan agora ignora explicitamente a barra de controles de zoom, evitando que o `touchstart`/`touchmove` cancele o clique dos botões no mobile.
- Pinça e arraste do vídeo continuam funcionando normalmente fora da barra de controles.

## Botão Expandir
- O botão de expandir vídeo foi movido para o canto inferior direito, acima da faixa de controles/`...` do player.
- O ícone ficou mais visível usando a cor primária do tema, mantendo fundo escuro e borda discreta.
- A nova posição evita conflito com as ações de copiar/excluir que aparecem na região superior do anexo/mensagem.

## Estrutura
- Nenhuma migration nova.
- Nenhuma alteração em Storage, upload, mensagens ou estrutura de banco.
- Versão embutida atualizada para V200.
