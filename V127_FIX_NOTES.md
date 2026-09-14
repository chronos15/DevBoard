# TaskBoard V127

## Preview/editor de imagem no mobile
- A barra de controles do preview ganhou respiro real à direita no Android/iOS e ficou um pouco mais alta para melhorar a área de toque.
- O editor de imagem não usa mais o botão de fechar absoluto do Dialog. O fechar agora participa do layout do cabeçalho e não sobrepõe Recorte/Desenho.
- Após concluir uma edição e reenviar a imagem com sucesso para o contexto atual, o preview é fechado automaticamente e o usuário volta ao tópico.

## Envio de anexos no Acompanhamento
- Adicionado um lock de rodapé temporário somente durante a entrega otimista do anexo.
- A troca entre preview do composer, item em envio e anexo definitivo mantém a timeline ancorada no fim, reduzindo os saltos vistos no mobile.
- O lock é liberado imediatamente se o usuário tentar rolar manualmente, preservando a correção anterior que permite navegar para cima enquanto mídias carregam.
- Imagem, vídeo e áudio pendentes sinalizam quando suas dimensões/metadados ficaram prontos para estabilizar o scroll.

## Banco
- Nenhuma migration nova.
