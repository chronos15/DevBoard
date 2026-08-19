# Devboard Android Bridge

Cliente Android isolado do projeto web. Ele carrega o Devboard existente em um `WebView` e adiciona somente capacidades nativas que o Chrome Android não oferece à página web, principalmente compartilhamento da tela via `MediaProjection`.

## O que continua no Web

- Supabase/Auth
- chat e reuniões
- microfone e câmera do WebRTC atual
- sinalização da reunião
- TURN/STUN já configurado no Devboard
- UI da sala

## O que o Android adiciona

- `MediaProjection` para capturar tela/aplicativo com consentimento do Android
- foreground service enquanto a tela está sendo compartilhada
- `ScreenCapturerAndroid` para transformar a captura em uma track WebRTC
- bridge JavaScript `window.DevboardNativeBridge`
- suporte ao modo tela cheia dos cards dentro do WebView

## Configurar URL

Abra `android-client/gradle.properties` e acrescente:

```properties
DEVBOARD_URL=https://SEU-DOMINIO-DEVBOARD
```

Ou passe como propriedade Gradle no ambiente de build.

A URL deve usar HTTPS porque câmera/microfone e a aplicação web dependem de contexto seguro.

## Abrir no Android Studio

Abra diretamente a pasta:

```text
android-client/
```

Espere o Gradle Sync e execute o módulo `app` em um aparelho Android real.

Configuração atual:

- package: `br.com.softwork.devboard`
- minSdk: 26
- targetSdk: 36
- Java/Kotlin target: 17

## Teste do compartilhamento

1. Entre na mesma reunião pelo Devboard desktop e pelo aplicativo Android.
2. No Android, toque em **Compartilhar tela**.
3. O seletor nativo do Android será aberto.
4. Escolha compartilhar a tela ou um aplicativo.
5. No outro participante, o card deve indicar `Tela` e exibir a captura completa usando `contain`, sem cortar as bordas.
6. Toque no card para priorizá-lo.
7. Use o botão de expandir no canto superior direito para tela cheia.
8. Pare o compartilhamento pelo Devboard ou pela notificação/controle do sistema.

## Segurança

O `JavascriptInterface` só é utilizado pela URL configurada do Devboard; navegações externas são abertas fora do `WebView`. O consentimento de captura não é armazenado: cada nova sessão depende da autorização do Android.
