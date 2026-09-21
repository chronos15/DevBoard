# V232 — descrição da subatividade e modal de pausa

## Ajustes

- O modal **Pausar subatividade** agora limita o descritivo exibido a no máximo 3 linhas.
- O conteúdo interno do modal de pausa ganhou rolagem vertical própria em telas menores, mantendo cabeçalho e ações estáveis.
- Descrições totalmente em CAIXA ALTA são apresentadas em formato de frase ao abrir a subatividade no Acompanhamento, sem alterar silenciosamente o dado gravado.
- Trechos entre aspas permanecem exatamente como foram escritos, inclusive quando estão em CAIXA ALTA.
- Adicionada a ação **Normalizar texto** nos formulários de criação e edição de subatividade. A ação converte o conteúdo para formato de frase e preserva trechos entre aspas.
- Ao ultrapassar 500 caracteres, o campo de descrição mostra um aviso orientativo para deixar apenas um resumo no descritivo e publicar o detalhamento no corpo da subatividade. O salvamento continua permitido.
- Versão embutida e cache do Service Worker atualizados para **V232**.

## Banco / infraestrutura

- Nenhuma migration necessária.
- Nenhuma alteração em Realtime, WebRTC, permissões ou Storage.
