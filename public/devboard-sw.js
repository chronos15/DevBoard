const TASKBOARD_SHARE_CACHE = "devboard-share-target-v1"
const TASKBOARD_SHARE_PREFIX = "/__devboard-share-target__/"
const TASKBOARD_SHARE_TARGET_PATH = "/share-target"

self.addEventListener("install", () => {
  self.skipWaiting()
})

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim())
})

function shareCacheUrl(path) {
  return new URL(path, self.location.origin).toString()
}

function randomShareId() {
  if (self.crypto && typeof self.crypto.randomUUID === "function") {
    return self.crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`
}

function formText(formData, name) {
  const value = formData.get(name)
  return typeof value === "string" ? value.trim() : ""
}

function collectSharedFiles(formData) {
  const files = []
  for (const [field, value] of formData.entries()) {
    if (typeof value === "string" || !value || typeof value.size !== "number") continue
    files.push({ field, file: value })
  }
  return files
}

async function deleteShareCacheEntries(cache, shareId) {
  const prefix = `${TASKBOARD_SHARE_PREFIX}${shareId}/`
  const keys = await cache.keys()
  await Promise.all(
    keys
      .filter((entry) => new URL(entry.url).pathname.startsWith(prefix))
      .map((entry) => cache.delete(entry)),
  )
}

async function stageShareLocally(formData) {
  const id = randomShareId()
  const title = formText(formData, "title")
  const text = formText(formData, "text")
  const url = formText(formData, "url")
  const incoming = collectSharedFiles(formData)

  // Se não veio arquivo nem conteúdo textual, deixamos o backend tentar ler o
  // POST original. Isso cobre implementações incomuns de Web Share Target.
  if (incoming.length === 0 && !title && !text && !url) return null

  const cache = await caches.open(TASKBOARD_SHARE_CACHE)
  const metadata = {
    id,
    title,
    text,
    url,
    receivedAt: new Date().toISOString(),
    files: incoming.map(({ field, file }, index) => ({
      index,
      field,
      name: file.name || `arquivo-compartilhado-${index + 1}`,
      type: file.type || "application/octet-stream",
      size: file.size,
      lastModified: file.lastModified || Date.now(),
    })),
  }

  try {
    // Primeiro persistimos os binários. O metadata é o commit final: a tela só
    // enxerga o compartilhamento depois que todos os arquivos já estão no cache.
    for (let index = 0; index < incoming.length; index += 1) {
      const file = incoming[index].file
      await cache.put(
        shareCacheUrl(`${TASKBOARD_SHARE_PREFIX}${id}/file/${index}`),
        new Response(file, {
          headers: {
            "Content-Type": file.type || "application/octet-stream",
            "X-TaskBoard-File-Name": encodeURIComponent(file.name || `arquivo-compartilhado-${index + 1}`),
            "X-TaskBoard-Last-Modified": String(file.lastModified || Date.now()),
          },
        }),
      )
    }

    await cache.put(
      shareCacheUrl(`${TASKBOARD_SHARE_PREFIX}${id}/metadata`),
      new Response(JSON.stringify(metadata), {
        headers: { "Content-Type": "application/json; charset=utf-8" },
      }),
    )

    // Verificação real antes do redirect. Evita abrir /compartilhar com metadata
    // pronto, porém sem os blobs (o antigo sintoma de "0 arquivos").
    for (let index = 0; index < incoming.length; index += 1) {
      const stored = await cache.match(shareCacheUrl(`${TASKBOARD_SHARE_PREFIX}${id}/file/${index}`))
      if (!stored) throw new Error(`Arquivo ${index + 1} não persistido no Cache Storage.`)
    }
    const storedMetadata = await cache.match(shareCacheUrl(`${TASKBOARD_SHARE_PREFIX}${id}/metadata`))
    if (!storedMetadata) throw new Error("Metadata do compartilhamento não persistido.")

    return id
  } catch (error) {
    await deleteShareCacheEntries(cache, id).catch(() => undefined)
    throw error
  }
}

async function handleShareTarget(request) {
  // Mantemos uma cópia intocada para o fallback de servidor. Nunca tentamos
  // reenviar o mesmo body depois de consumi-lo com formData().
  const serverFallbackRequest = request.clone()

  try {
    const formData = await request.formData()
    const shareId = await stageShareLocally(formData)
    if (shareId) {
      const target = new URL("/compartilhar", self.location.origin)
      target.searchParams.set("share", shareId)
      target.searchParams.set("receiver", "sw-v217")
      return Response.redirect(target.toString(), 303)
    }
  } catch (error) {
    // O fallback abaixo ainda recebe a cópia original e pode persistir o share
    // pelo servidor mesmo quando Cache Storage/formData falhar no aparelho.
  }

  return fetch(serverFallbackRequest)
}

self.addEventListener("fetch", (event) => {
  const request = event.request
  if (request.method !== "POST") return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin || url.pathname !== TASKBOARD_SHARE_TARGET_PATH) return

  event.respondWith(handleShareTarget(request))
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
