self.addEventListener("install", () => {
  self.skipWaiting()
})

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim())
})

// TaskBoard V216
// O Web Share Target (/share-target) deve seguir DIRETO para o backend.
// Não registramos um handler de fetch para esse POST: o Android/Chrome entrega
// o multipart original à rota Next.js sem clone, formData() ou fetch intermediário
// no Service Worker. Isso evita o caso em que o anexo era perdido e a tela de
// compartilhamento abria com "0 itens prontos para enviar".

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const targetUrl = event.notification?.data?.url || "/chat"

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true })
    for (const client of windows) {
      if ("focus" in client) {
        if ("navigate" in client) await client.navigate(targetUrl)
        await client.focus()
        return
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(targetUrl)
  })())
})
