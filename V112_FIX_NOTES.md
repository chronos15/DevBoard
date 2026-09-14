# TaskBoard V112 — Equipe responsiva e menções contextuais

## Tela inicial · Equipe

- Corrigida a disposição dos cards de **Horas efetivadas** em larguras menores.
- O nome/avatar/cargo do usuário agora ficam em um cabeçalho próprio, ocupando toda a largura do card.
- O nome pode usar até duas linhas antes de truncar, evitando nomes reduzidos a poucos caracteres quando o card fica estreito.
- O gráfico circular e os valores de efetivado/meta ficam em uma segunda linha.
- A grade passa a se adaptar pela largura real disponível no componente (`auto-fit/minmax`), em vez de depender apenas do breakpoint da janela.

## Menções `@` · envolvidos primeiro

Ao abrir o autocomplete de menções, os usuários diretamente envolvidos no contexto passam a aparecer antes dos atalhos de equipe e dos demais resultados.

Aplicado em:

- Acompanhamento da subatividade;
- Solicitações;
- Análise AQS;
- Chat em grupo;
- Chat de reunião.

### Critério de envolvidos

- **Acompanhamento:** responsável e membros vinculados à subatividade.
- **Solicitação:** participantes, solicitante/criador, AQS, DEV responsável e executor.
- **Análise AQS:** responsável/membros da subatividade, AQS designado e criador da análise.
- **Chat:** membros da conversa.
- **Reunião:** membros convidados/participantes da reunião.

A busca continua respeitando o texto digitado após `@`; a priorização só altera a ordem dos candidatos válidos.

## Banco de dados

- Nenhuma migration nova.
- Nenhuma alteração de schema ou RLS.
