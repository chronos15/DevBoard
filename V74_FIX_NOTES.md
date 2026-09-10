# TaskBoard V74 — correção de imagem de projeto / Storage

## Corrigido

- Admin pode alterar dados e identidade visual de qualquer projeto do workspace sem precisar estar em `project_members`.
- Upload, atualização e exclusão de imagens em `devboard-project-icons` não chamam `is_workspace_admin(...)` diretamente.
- `set_project_visual` valida o Admin diretamente dentro de função `SECURITY DEFINER`.
- Reaplicada a policy atual de upload em `cadence-attachments` para evitar policy antiga residual.
- A migration 065 pode ser aplicada mesmo se a 064 ainda não tiver sido aplicada; ela repete os pontos críticos de forma segura.

## Observação sobre o erro `VM... reportAllChanges ... startTime`

Esse stack não aponta para um arquivo do TaskBoard. Ele é produzido por código de instrumentação Web Vitals carregado como script `VM...`. A falha real de Storage, quando existir, aparecerá separadamente como `StorageApiError`/HTTP 4xx.

## Aplicação

Execute no Supabase SQL Editor:

`supabase/migrations/065_taskboard_project_images_storage_final_fix.sql`

Depois publique o frontend da V74 e faça um hard refresh no navegador.
