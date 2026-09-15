# TaskBoard V136 — pós-envio direto ao destino

## Alteração

- Removida a tela/modal intermediário de sucesso da página `/compartilhar`.
- Quando todos os destinos são enviados com sucesso, o TaskBoard navega imediatamente para o destino final.
- Com um único destino, abre esse próprio destino.
- Com múltiplos destinos, abre o **último destino selecionado pelo usuário**.
- A escolha do destino final usa a ordem de seleção, e não a ordem de conclusão dos workers paralelos da V135.
- Em caso de falha parcial ou total, a navegação automática não ocorre: a tela permanece aberta, exibe o erro e mantém selecionados somente os destinos que precisam ser reenviados.
- A limpeza do cache temporário PWA/Supabase continua sendo executada antes da navegação em caso de sucesso total.

## Banco de dados

Nenhuma migration nova.
