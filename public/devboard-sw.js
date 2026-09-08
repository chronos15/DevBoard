const DEVBOARD_SHARE_CACHE = "devboard-share-target-v1"
const DEVBOARD_SHARE_PREFIX = "/__devboard-share-target__/"
const DEVBOARD_SHARE_MAX_AGE_MS = 24 * 60 * 60 * 1000

self.addEventListener("install", () => {
  self.skipWaiting()
})

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim())
})

function shareCacheUrl(path) {
  return new URL(path, self.location.origin).toString()
}

async function cleanupExpiredShares(cache) {
  const requests = await cache.keys()
  const metadataRequests = requests.filter((request) => request.url.includes("/metadata"))
  const now = Date.now()

  await Promise.all(metadataRequests.map(async (request) => {
    try {
      const response = await cache.match(request)
      const metadata = response ? await response.json() : null
      const receivedAt = metadata?.receivedAt ? new Date(metadata.receivedAt).getTime() : 0
      if (receivedAt && now - receivedAt <= DEVBOARD_SHARE_MAX_AGE_MS) return

      const shareId = metadata?.id
      if (!shareId) {
        await cache.delete(request)
        return
      }

      const entries = await cache.keys()
      await Promise.all(entries
        .filter((entry) => entry.url.includes(`${DEVBOARD_SHARE_PREFIX}${shareId}/`))
        .map((entry) => cache.delete(entry)))
    } catch {
      await cache.delete(request)
    }
  }))
}

async function handleShareTarget(request) {
  const formData = await request.formData()
  const shareId = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`

  const files = formData.getAll("files").filter((entry) => entry instanceof File && entry.size > 0)
  const title = String(formData.get("title") || "").trim()
  const text = String(formData.get("text") || "").trim()
  const url = String(formData.get("url") || "").trim()
  const cache = await caches.open(DEVBOARD_SHARE_CACHE)

  await cleanupExpiredShares(cache)

  const metadata = {
    id: shareId,
    title,
    text,
    url,
    receivedAt: new Date().toISOString(),
    files: files.map((file, index) => ({
      index,
      name: file.name || `arquivo-${index + 1}`,
      type: file.type || "application/octet-stream",
      size: file.size,
      lastModified: file.lastModified || Date.now(),
    })),
  }

  await cache.put(
    shareCacheUrl(`${DEVBOARD_SHARE_PREFIX}${shareId}/metadata`),
    new Response(JSON.stringify(metadata), { headers: { "Content-Type": "application/json" } }),
  )

  await Promise.all(files.map((file, index) => cache.put(
    shareCacheUrl(`${DEVBOARD_SHARE_PREFIX}${shareId}/file/${index}`),
    new Response(file, { headers: { "Content-Type": file.type || "application/octet-stream" } }),
  )))

  const target = new URL("/compartilhar", self.location.origin)
  target.searchParams.set("share", shareId)
  return Response.redirect(target.toString(), 303)
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url)
  if (event.request.method === "POST" && url.origin === self.location.origin && url.pathname === "/share-target") {
    event.respondWith(handleShareTarget(event.request).catch(() => {
      const target = new URL("/compartilhar", self.location.origin)
      target.searchParams.set("erro", "recebimento")
      return Response.redirect(target.toString(), 303)
    }))
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
