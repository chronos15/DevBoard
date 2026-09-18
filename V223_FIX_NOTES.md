# TaskBoard V223 — WebAPK share target mínimo

## Evidência usada

Nos testes reais do Android com a V222, o Next recebeu `multipart/form-data`, porém com `Content-Length: 75` e `entries: []`. Esse tamanho corresponde somente ao fechamento do boundary: o Chrome/WebAPK abriu o TaskBoard, mas não colocou nenhum arquivo no POST.

Os testes com `curl -F` direto no Next e através do Apache retornaram `serverFiles=1`, portanto Apache, Next, `request.formData()` e persistência do servidor já estavam comprovadamente capazes de receber o arquivo.

## Alteração principal

A V223 reduz o `share_target.params.files` para um único bucket nativo:

```json
{
  "name": "files",
  "accept": ["*/*"]
}
```

Isso reduz ao mínimo os metadados que o WebAPK gera para `shareParamNames` e `shareParamAccepts` e evita qualquer incompatibilidade/mismatch entre a lista grande de MIME types/extensões e o MIME real informado pelo `ContentResolver` do Android.

## Nova identidade do PWA

O manifest `id` mudou uma única vez de `/` para `/taskboard`.

Objetivo: obrigar o Chrome a criar um WebAPK novo e não reutilizar o pacote/metadados nativos associados ao manifest antigo. Depois da V223, o id `/taskboard` deve permanecer estável nas próximas versões.

## O que não foi alterado

- Apache/XAMPP: nenhuma mudança necessária.
- Rota `/share-target`: continua usando `request.formData()` nativo.
- Persistência em disco/Supabase: comportamento preservado.
- Service Worker: continua sem interceptar POST do Web Share Target.

## Versão

- Aplicação: V223
- Service Worker: V223
- Registros do Service Worker: `?v=223`
