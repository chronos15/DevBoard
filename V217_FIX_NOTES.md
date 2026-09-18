# TaskBoard V217 — correção definitiva do Web Share Target

## Problema
Compartilhamentos iniciados por aplicativos externos (Galeria, WhatsApp, gerenciador de arquivos etc.) podiam abrir `/compartilhar` com **0 itens prontos para enviar**, mesmo quando o POST continha um anexo.

## Correções
- O Service Worker volta a assumir o `POST /share-target`, mas agora consome o multipart **uma única vez** e mantém uma cópia intacta apenas para fallback.
- Arquivos recebidos são persistidos primeiro no Cache Storage do PWA; o metadata só é gravado por último, funcionando como um commit do lote.
- Antes do redirect para `/compartilhar`, o Service Worker confirma que todos os blobs e o metadata realmente existem no cache.
- O receptor coleta **qualquer entrada binária** do `FormData`, independentemente do nome do campo usado pelo aplicativo de origem.
- Se o Cache Storage/formData do dispositivo falhar, o POST original segue para o backend sem ter seu body consumido.
- O fallback de servidor usa `SUPABASE_SERVICE_ROLE_KEY` somente no backend para o inbox temporário, evitando dependência de policies de `storage.objects` durante a captura.
- Foi criada `/api/share-inbox`, autenticada, para a tela recuperar/remover os anexos temporários sem expor a service role ao navegador.
- A recuperação do fallback usa até 3 downloads concorrentes, reduzindo espera sem explodir memória em lotes grandes.
- O bucket temporário é criado pelo backend quando necessário e permanece privado.
- A versão exibida no sistema agora é embutida diretamente como **V217**, sem depender de `NEXT_PUBLIC_TASKBOARD_VERSION` no servidor.

## Arquivos principais alterados
- `public/devboard-sw.js`
- `app/share-target/route.ts`
- `app/api/share-inbox/route.ts` (novo)
- `lib/taskboard-share-cache.ts`
- `app/compartilhar/page.tsx`
- `lib/app-version.ts`
