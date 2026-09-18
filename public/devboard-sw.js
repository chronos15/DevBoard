const TASKBOARD_SW_VERSION = "V221"
const SHARE_DB_NAME = "taskboard-share-target-v221"
const SHARE_DB_VERSION = 1
const SHARE_STORE = "shares"
const SHARE_MAX_AGE_MS = 24 * 60 * 60 * 1000
const SHARE_PATHS = new Set([
  "/share-target",
  "/share-target-v218",
  "/share-target-v219",
  "/share-target-v221",
])

self.addEventListener("install", () => {
  self.skipWaiting()
})

function openShareDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(SHARE_DB_NAME, SHARE_DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(SHARE_STORE)) {
        db.createObjectStore(SHARE_STORE, { keyPath: "id" })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error("indexeddb_open_failed"))
    request.onblocked = () => reject(new Error("indexeddb_blocked"))
  })
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error || new Error("indexeddb_transaction_failed"))
    tx.onabort = () => reject(tx.error || new Error("indexeddb_transaction_aborted"))
  })
}

async function putLocalShare(record) {
  const db = await openShareDb()
  try {
    const tx = db.transaction(SHARE_STORE, "readwrite")
    tx.objectStore(SHARE_STORE).put(record)
    await txDone(tx)
  } finally {
    db.close()
  }
}

async function cleanupLocalShares() {
  let db
  try {
    db = await openShareDb()
    const tx = db.transaction(SHARE_STORE, "readwrite")
    const store = tx.objectStore(SHARE_STORE)
    const request = store.openCursor()
    const now = Date.now()
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) return
      const record = cursor.value
      const receivedAt = Date.parse(record?.receivedAt || "")
      if (Number.isFinite(receivedAt) && now - receivedAt > SHARE_MAX_AGE_MS) cursor.delete()
      cursor.continue()
    }
    await txDone(tx)
  } catch {
    // limpeza é best effort
  } finally {
    db?.close()
  }
}

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys()
    await Promise.all(
      cacheNames
        .filter((name) => name.startsWith("devboard-share-target-"))
        .map((name) => caches.delete(name)),
    )
    await cleanupLocalShares()
    await self.clients.claim()
  })())
})

function stringValue(formData, name) {
  const value = formData.get(name)
  return typeof value === "string" ? value : ""
}

function randomShareId() {
  if (self.crypto?.randomUUID) return self.crypto.randomUUID()
  const bytes = new Uint8Array(16)
  self.crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")
}

async function receiveShareLocally(request) {
  const serverFallbackRequest = request.clone()

  try {
    // Deixa o próprio Chrome interpretar o multipart gerado pelo Android.
    // Isto evita Apache/Next/Supabase no caminho principal do anexo.
    const formData = await request.formData()
    const files = []
    let fileIndex = 0

    for (const [, value] of formData.entries()) {
      if (typeof value === "string") continue
      if (!(value instanceof Blob)) continue

      const name = typeof value.name === "string" && value.name.trim()
        ? value.name
        : `arquivo-compartilhado-${fileIndex + 1}`
      const type = value.type || "application/octet-stream"
      const lastModified = Number(value.lastModified || Date.now())
      const blob = value.slice(0, value.size, type)

      files.push({
        index: fileIndex,
        name,
        type,
        size: value.size,
        lastModified: Number.isFinite(lastModified) ? lastModified : Date.now(),
        blob,
      })
      fileIndex += 1
    }

    const title = stringValue(formData, "title")
    const text = stringValue(formData, "text")
    const url = stringValue(formData, "url")

    if (files.length === 0 && !title && !text && !url) {
      throw new Error("android_delivered_empty_formdata")
    }

    const id = randomShareId()
    await putLocalShare({
      id,
      receivedAt: new Date().toISOString(),
      title,
      text,
      url,
      files,
    })

    const destination = new URL("/compartilhar", self.location.origin)
    destination.searchParams.set("shareLocal", id)
    destination.searchParams.set("localFiles", String(files.length))
    destination.searchParams.set("receiver", "sw-v221")
    return Response.redirect(destination.toString(), 303)
  } catch (error) {
    // O servidor continua como fallback para dispositivos/contextos em que IDB
    // ou o parser multipart do Service Worker não estejam disponíveis.
    try {
      return await fetch(serverFallbackRequest)
    } catch (serverError) {
      const destination = new URL("/compartilhar", self.location.origin)
      destination.searchParams.set("erro", "recebimento-v221")
      destination.searchParams.set("motivo", "sw-e-servidor")
      destination.searchParams.set("receiver", "sw-v221-error")
      return Response.redirect(destination.toString(), 303)
    }
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request
  if (request.method !== "POST") return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin || !SHARE_PATHS.has(url.pathname)) return

  event.respondWith(receiveShareLocally(request))
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
