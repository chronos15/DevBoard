const TASKBOARD_SW_VERSION = "V219"

self.addEventListener("install", () => {
  self.skipWaiting()
})

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    // Remove somente caches legados do receptor externo. O V219 processa o POST
    // diretamente no servidor para não depender de Cache Storage/particionamento
    // do navegador ao receber arquivos vindos de outros apps.
    const cacheNames = await caches.keys()
    await Promise.all(
      cacheNames
        .filter((name) => name.startsWith("devboard-share-target-") && name !== "devboard-share-target-v1")
        .map((name) => caches.delete(name)),
    )
    await self.clients.claim()
  })())
})

self.addEventListener("fetch", (event) => {
  const request = event.request
  if (request.method !== "POST") return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  // IMPORTANTE V219:
  // Não usamos respondWith() em /share-target nem /share-target-v219.
  // Assim o multipart original segue intacto ao Route Handler do Next.js. O
  // backend persiste o conteúdo e somente depois responde com HTTP 303.
  if (url.pathname === "/share-target" || url.pathname === "/share-target-v218" || url.pathname === "/share-target-v219") {
    return
  }
})

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
