# TaskBoard V75 — remoção definitiva da imagem do projeto

## Corrigido

- **Remover imagem e usar ícone** agora marca a imagem atual para remoção de verdade.
- Ao voltar para a aba **Imagem** depois de remover, a foto antiga **não reaparece**.
- Se o usuário quiser voltar a usar imagem depois de removê-la na edição atual, precisa selecionar uma nova imagem.
- O formulário mostra o aviso **“A imagem atual será removida ao salvar o projeto.”**.
- Admin pode excluir/trocar imagem de projeto mesmo quando a foto original foi enviada por outro usuário.
- A policy de `DELETE` do bucket `devboard-project-icons` não depende mais do primeiro segmento do path ser o `auth.uid()` atual.
- `set_project_visual(..., NULL)` foi reafirmada para remoção explícita da imagem sem usar `is_workspace_admin`.

## Banco de dados

Execute a migration:

`supabase/migrations/066_taskboard_project_image_removal_fix.sql`

Ela deve ser executada **depois da 065**.
