# TaskBoard V130 — envio de anexos mais fluido, padrão Discord

## Diagnóstico pelos vídeos
- No TaskBoard, o anexo passava por vários tamanhos/estados visuais: preview local no composer → item otimista → player pequeno sem metadados/URL assinada → player no tamanho definitivo.
- A troca de altura entre esses estados fazia a timeline reposicionar e dava a sensação de que a tela "subia" durante o envio.
- A V127 ainda mantinha um lock temporário de rodapé durante o upload, causando correções adicionais de scroll enquanto o anexo mudava de estado.
- No Discord, a mensagem reserva a área da mídia e a troca de estado ocorre dentro do mesmo espaço, sem alterar a geometria da conversa.

## Alterações
- Mídias selecionadas passam a manter um preview local em cache durante toda a entrega.
- Imagens e vídeos têm suas dimensões/proporção lidas antes/durante o envio e a timeline reserva o espaço final desde o item otimista.
- Quando o registro definitivo do anexo entra no estado do projeto, o TaskBoard continua usando temporariamente a mídia local, evitando o estágio de player pequeno/vazio enquanto a URL assinada é resolvida.
- O estado "Enviando" de imagens/vídeos virou um indicador sobreposto à mídia; ele não adiciona mais uma linha que altera a altura da mensagem.
- Removido o lock de rodapé específico de delivery da V127. O scroll vai ao fim apenas quando o item otimista é inserido; carregamento de URL/metadados não fica mais empurrando a timeline depois.
- Arquivos não visuais mantêm indicação de envio e tentativa novamente em caso de falha.
- O cache local é liberado ao sair do Acompanhamento.

## Resultado esperado
- Composer limpa e a mensagem aparece imediatamente.
- O bloco da mídia não encolhe nem cresce durante upload/registro/URL assinada.
- Não há etapa intermediária com player preto pequeno.
- A timeline não fica sendo reposicionada a cada fase do upload.

## Banco de dados
Nenhuma migration nova.
