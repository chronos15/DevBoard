# V121 — Preview de vídeo na proporção original

## Ajuste
- Removido o container `aspect-video` que forçava vídeos verticais/quadrados dentro de uma área 16:9 e criava faixas pretas laterais.
- O player inline agora usa a proporção real informada pelo próprio arquivo de vídeo.
- Mantidos os controles nativos, `playsInline`, preload de metadata e os limites máximos de tamanho para não dominar a tela.
- Vídeos verticais, quadrados e horizontais passam a ocupar somente a área necessária à sua proporção.

## Locais ajustados
- Acompanhamento / timeline de subatividade.
- Chat / mensagens de mídia.
- Blocos de vídeo renderizados no chat.
- Preview otimista de vídeo durante envio no acompanhamento.

## Banco de dados
- Nenhuma migration nova.
