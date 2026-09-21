# TaskBoard V228 — Preview textual e busca de subatividades

## 1. Preview/download de arquivos textuais

- Corrigido o caso de anexos textuais antigos (`.html`, `.txt`, `.sql`, `.json`, `.md`, `.csv`, scripts e outros formatos reconhecidos como texto) que foram persistidos somente em `attachments.text_content` e, após recarregar a aplicação, apareciam como **Preview indisponível**.
- `InlineTextAttachment` agora tenta, nesta ordem:
  1. conteúdo já disponível na memória;
  2. arquivo no Storage por URL assinada;
  3. fallback lazy de `attachments.text_content` pelo ID do anexo.
- O fallback é usado também para download, portanto anexos antigos sem `storage_path` voltam a exibir o botão de download e podem ser baixados normalmente.
- Se o Storage falhar temporariamente em um anexo textual do Acompanhamento/AQS, o conteúdo persistido no banco é usado como redundância.
- Novos arquivos textuais enviados pelo Acompanhamento ou pelo diálogo de anexos passam a manter **o arquivo original no Storage e o conteúdo textual**, preservando preview imediato e download real do arquivo.
- Nenhuma migration é necessária para este ajuste.

## 2. Pesquisa de subatividade no header do projeto

Implementado no Acompanhamento completo e no modo simplificado:

- novo botão de pesquisa ao lado de **Mostrar concluídas**;
- pesquisa por **número da subatividade** (`33`, `#33` ou `33.`) e por trecho do título, ignorando acentos e caixa;
- pesquisa numérica é exata para evitar que `3` retorne `13`, `23`, `30` etc.;
- ao pesquisar, todas as atividades que contêm resultados são expandidas temporariamente;
- a pesquisa encontra também subatividades concluídas mesmo que **Mostrar concluídas** esteja desligado;
- ao selecionar um resultado concluído, a visualização de concluídas é ativada para que a seleção continue acessível ao fechar a pesquisa;
- digitar na pesquisa não troca automaticamente a subatividade aberta no painel central;
- contador compacto mostra quantos resultados foram encontrados;
- `Esc` fecha a pesquisa no modo completo; o botão `X` fecha e limpa nos dois modos;
- no modo completo, `Enter` abre diretamente o resultado quando existe exatamente uma correspondência.

### Header responsivo

- Quando há espaço, o ícone de pesquisa fica diretamente ao lado de **Mostrar concluídas**.
- Em largura reduzida ou projeto com nome longo, as ações de pesquisa/concluídas são agrupadas em `...` para evitar esmagar o nome do projeto.
- Ao abrir a pesquisa, o próprio header se transforma no campo de busca e oculta temporariamente título, subtítulo e demais ações.
- No modo simplificado, a antiga caixa fixa de busca abaixo do header foi removida da área de projeto; a busca de subatividade agora usa o mesmo padrão compacto do header.

## 3. Versão

- Versão embutida atualizada para **V228**.
- Service Worker e registradores atualizados para `v=228`.
