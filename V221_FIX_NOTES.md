# TaskBoard V221 — Web Share Target local e determinístico

## Mudança principal

O recebimento de anexos compartilhados pelo Android volta a ser processado no próprio PWA, antes de qualquer navegação ou chamada ao Next.js.

Fluxo V221:

1. Android envia `POST multipart/form-data` ao Web Share Target.
2. `devboard-sw.js` intercepta `/share-target` (e também os endpoints legados V218/V219).
3. O próprio `Request.formData()` do Chrome interpreta o multipart.
4. Toda parte binária é convertida em Blob e gravada no IndexedDB `taskboard-share-target-v221`.
5. Somente após o commit no IndexedDB o SW retorna HTTP 303 para `/compartilhar?shareLocal=...`.
6. A tela reconstrói os objetos `File` diretamente do IndexedDB e permite selecionar os destinos.
7. Após envio ou descarte, o registro local é excluído.

## Por que esta arquitetura

- elimina Apache/XAMPP, Proxy do Next, parser multipart customizado, sessão e Supabase do caminho principal;
- aceita qualquer nome de campo binário entregue pelo Android;
- preserva nome, MIME, tamanho, `lastModified` e bytes do Blob;
- mantém o receptor server-side existente apenas como fallback;
- mantém compatibilidade com WebAPKs ainda apontando para `/share-target-v218` ou `/share-target-v219`.

## Manifesto

O `share_target.action` volta a ser estável em `/share-target`. Não haverá mais endpoint versionado no manifesto, evitando regenerações desnecessárias do WebAPK a cada release.

## Android / WebAPK

O destino de compartilhamento é registrado no Android pelo WebAPK. Alterações de `share_target` podem levar tempo para serem aplicadas pelo Chrome. Para validar a V221 sem depender do ciclo de atualização do WebAPK, desinstale o TaskBoard do Android e instale novamente pelo Chrome após o deploy da V221.

## Versão

Versão embutida: **V221**.
