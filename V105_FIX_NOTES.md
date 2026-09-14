# TaskBoard V105 · Foco de hoje definido pelo Admin

## Objetivo
Transformar o bloco **Foco de hoje** do dashboard em uma seleção administrada manualmente, em vez de listar automaticamente as subatividades em execução.

## Alterações

### 1. Marcar subatividade como foco
- Administradores agora veem uma ação com ícone de estrela nas subatividades.
- A ação está disponível na visualização em lista e no Kanban.
- Uma subatividade marcada recebe o selo visual **Foco**.
- Clicar novamente remove a marcação.
- A alteração usa estado otimista para responder imediatamente na interface.

### 2. Dashboard · Foco de hoje
- O bloco agora mostra somente subatividades marcadas pela administração.
- A seleção não depende mais do status `in-progress`.
- Itens marcados recentemente aparecem primeiro, mantendo a subatividade em execução no topo quando aplicável.
- Exibe projeto, atividade, status, responsável e tempo registrado.
- O escopo respeita o RLS: cada usuário vê apenas itens que já pode visualizar normalmente.

### 3. Persistência e segurança
Migration nova:

`supabase/migrations/084_taskboard_admin_focus_subactivities.sql`

Novos campos em `subactivities`:
- `is_focus`
- `focus_marked_at`
- `focus_marked_by`

Nova RPC:
- `set_subactivity_focus_admin(uuid, boolean)`

A RPC é `security definer`, valida a sessão e exige role `admin` no workspace antes de alterar o foco.

### 4. Auditoria
- Marcar ou remover foco gera log do projeto usando `subactivity-updated`.
- A operação atualiza `updated_at` da subatividade.

## Validação
- 189 arquivos TypeScript/TSX verificados via parser/transpilação do TypeScript.
- 0 erros sintáticos encontrados.
- O `tsc --noEmit` completo não é conclusivo neste pacote porque o ZIP não contém `node_modules`/tipagens de React, Next, Supabase e demais dependências.
