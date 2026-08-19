# MediaProjection no Devboard

O módulo `android-client/` é complementar. O projeto Next.js atual permanece a aplicação principal e pode continuar sendo publicado normalmente.

## Fluxo

```text
Devboard WebView
    │
    ├─ câmera/microfone/chat/reunião → WebRTC web atual
    │
    └─ Compartilhar tela
           │
           ▼
  DevboardNativeBridge
           │
           ▼
  MediaProjection (Android)
           │
           ▼
 ScreenCapturerAndroid
           │
           ▼
 track WebRTC de tela
           │
           ▼
 Supabase Realtime (somente sinalização)
           │
           ▼
 participante remoto
```

Não há migration SQL adicional para o bridge Android.
