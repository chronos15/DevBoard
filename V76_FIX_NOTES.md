# TaskBoard V76 — rascunho da edição não é mais sobrescrito pelo Realtime

## Problema real identificado no vídeo

O formulário de edição tinha um `useEffect(..., [project])` que copiava todos os dados do projeto para o estado local sempre que o objeto `project` mudava de identidade.

Como o Store executa `refreshProjects()` através do Supabase Realtime, o mesmo projeto era recriado em memória mesmo sem o usuário sair da tela. Isso fazia o formulário ser resetado durante a edição.

Efeito visível:
- clicar em **Remover imagem e usar ícone** funcionava por alguns instantes;
- selecionar uma nova imagem também mostrava a nova prévia;
- no refresh seguinte, `iconImagePreview`, `useCustomImage`, `removeExistingImage` e os demais campos eram restaurados com os valores antigos vindos do banco;
- por isso a foto antiga reaparecia antes mesmo de salvar.

## Correção

`ProjectForm` agora inicializa o rascunho somente uma vez para cada `project.id` aberto.

Refreshes do Realtime continuam atualizando o restante do TaskBoard, mas não sobrescrevem mais o formulário que está sendo editado.

A correção vale também para outros campos do projeto: nome, cliente, descrição, categoria, prioridade, prazo, repositório e responsáveis não serão mais revertidos silenciosamente enquanto o usuário edita.

## Banco de dados

Esta correção é somente de frontend. Não existe migration 067 para a V76.

As migrations 065 e 066 continuam necessárias para as permissões de Storage/RPC caso ainda não tenham sido aplicadas no banco.
