# TaskBoard Android Share Bridge — V224

Este APK existe apenas para receber `ACTION_SEND` e `ACTION_SEND_MULTIPLE` diretamente do Android.
Ele não substitui o PWA e não possui ícone/launcher próprio.

Fluxo:

1. Galeria / WhatsApp / Arquivos envia a URI real ao `TaskBoard (Compartilhar)`.
2. O bridge lê a URI com `ContentResolver`.
3. Monta `multipart/form-data` em arquivo temporário e envia com `Content-Length` para:
   `https://taskboard.softworksistema.com.br/share-target`.
4. O servidor já existente persiste o anexo e devolve `303 Location: /compartilhar?...`.
5. O bridge abre essa URL no Android; o usuário continua no fluxo normal do TaskBoard.

## Compilar pelo Android Studio

- Abra a pasta `android-share-bridge` no Android Studio.
- Aguarde o Gradle Sync.
- `Build > Build APK(s)`.
- APK debug: `app/build/outputs/apk/debug/app-debug.apk`.

## Instalar via ADB

```powershell
adb install -r app\build\outputs\apk\debug\app-debug.apk
```

Depois compartilhe uma imagem/arquivo e escolha **TaskBoard (Compartilhar)**.

Não é necessário desinstalar o PWA para testar o bridge.
