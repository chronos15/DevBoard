"use client"

const SHARE_CACHE = "devboard-share-target-v1"
const SHARE_PREFIX = "/__devboard-share-target__/"

function cacheUrl(path: string) {
  return new URL(path, window.location.origin).toString()
}

export async function stageFilesForTaskBoardShare(files: File[], title = "") {
  if (typeof window === "undefined" || !("caches" in window) || files.length === 0) {
    throw new Error("O compartilhamento interno não está disponível neste dispositivo.")
  }

  const id = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  const cache = await caches.open(SHARE_CACHE)
  const metadata = {
    id,
    title,
    text: "",
    url: "",
    receivedAt: new Date().toISOString(),
    files: files.map((file, index) => ({
      index,
      name: file.name || `arquivo-${index + 1}`,
      type: file.type || "application/octet-stream",
      size: file.size,
      lastModified: file.lastModified || Date.now(),
    })),
  }

  try {
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index]
      await cache.put(
        cacheUrl(`${SHARE_PREFIX}${id}/file/${index}`),
        new Response(file, {
          headers: {
            "Content-Type": file.type || "application/octet-stream",
            "X-TaskBoard-File-Name": encodeURIComponent(file.name || `arquivo-${index + 1}`),
            "X-TaskBoard-Last-Modified": String(file.lastModified || Date.now()),
          },
        }),
      )
    }

    await cache.put(
      cacheUrl(`${SHARE_PREFIX}${id}/metadata`),
      new Response(JSON.stringify(metadata), { headers: { "Content-Type": "application/json" } }),
    )
  } catch (error) {
    const keys = await cache.keys()
    await Promise.all(keys
      .filter((entry) => entry.url.includes(`${SHARE_PREFIX}${id}/`))
      .map((entry) => cache.delete(entry)))
    throw error
  }

  return `/compartilhar?share=${encodeURIComponent(id)}`
}

type ServerShareFile = {
  index: number
  name: string
  type: string
  size: number
  lastModified: number
}

type ServerShareManifest = {
  id: string
  receivedAt?: string
  expiresAt?: string
  title?: string
  text?: string
  url?: string
  files: ServerShareFile[]
  error?: string
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

async function fetchServerShareManifest(shareId: string) {
  let lastError = "Não foi possível recuperar o compartilhamento temporário."

  // Retentativas curtas cobrem replicação/latência de storage sem transformar um
  // recebimento válido em "0 arquivos" por uma leitura alguns ms cedo demais.
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const response = await fetch(`/api/share-inbox?share=${encodeURIComponent(shareId)}&ts=${Date.now()}`, {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Cache-Control": "no-cache" },
    })
    const payload = await response.json().catch(() => ({})) as ServerShareManifest
    if (response.ok && payload && Array.isArray(payload.files)) return payload

    lastError = payload.error || lastError
    if (response.status !== 404 || attempt === 5) break
    await sleep(180 * (attempt + 1))
  }

  throw new Error(lastError)
}

async function fetchServerShareFile(shareId: string, item: ServerShareFile) {
  let lastError = `Não foi possível recuperar “${item.name}”.`

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(
      `/api/share-inbox?share=${encodeURIComponent(shareId)}&file=${encodeURIComponent(String(item.index))}&ts=${Date.now()}`,
      {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Cache-Control": "no-cache" },
      },
    )
    if (response.ok) {
      const blob = await response.blob()
      const encodedName = response.headers.get("X-TaskBoard-File-Name")
      const modified = Number(response.headers.get("X-TaskBoard-Last-Modified") || item.lastModified || Date.now())
      return new File([blob], encodedName ? decodeURIComponent(encodedName) : item.name, {
        type: response.headers.get("Content-Type") || item.type || blob.type || "application/octet-stream",
        lastModified: Number.isFinite(modified) ? modified : Date.now(),
      })
    }

    const payload = await response.json().catch(() => ({})) as { error?: string }
    lastError = payload.error || lastError
    if (response.status !== 404 || attempt === 3) break
    await sleep(150 * (attempt + 1))
  }

  throw new Error(lastError)
}

export async function readServerStagedShare(shareId: string) {
  if (!shareId) throw new Error("Compartilhamento temporário inválido.")

  const manifest = await fetchServerShareManifest(shareId)
  const ordered = [...manifest.files].sort((a, b) => a.index - b.index)
  const files: File[] = []
  const missingNames: string[] = []

  let cursor = 0
  const workers = Array.from({ length: Math.min(3, Math.max(1, ordered.length)) }, async () => {
    while (cursor < ordered.length) {
      const index = cursor
      cursor += 1
      const item = ordered[index]
      try {
        files[index] = await fetchServerShareFile(shareId, item)
      } catch {
        missingNames.push(item.name)
      }
    }
  })
  await Promise.all(workers)

  const availableFiles = files.filter(Boolean)
  if (ordered.length > 0 && availableFiles.length === 0) {
    throw new Error("O recebimento foi confirmado, mas os anexos não puderam ser lidos. O TaskBoard não vai tratar isso como um compartilhamento vazio.")
  }

  return {
    metadata: {
      id: shareId,
      title: manifest.title ?? "",
      text: manifest.text ?? "",
      url: manifest.url ?? "",
      receivedAt: manifest.receivedAt ?? new Date().toISOString(),
      files: ordered,
    },
    files: availableFiles,
    missingNames,
  }
}

export async function deleteServerStagedShare(shareId: string) {
  if (!shareId) return
  await fetch(`/api/share-inbox?share=${encodeURIComponent(shareId)}`, {
    method: "DELETE",
    credentials: "same-origin",
    cache: "no-store",
  }).catch(() => undefined)
}
