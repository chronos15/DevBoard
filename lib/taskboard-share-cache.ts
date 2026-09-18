"use client"

const SHARE_CACHE = "devboard-share-target-v1"
const SHARE_PREFIX = "/__devboard-share-target__/"
export const SERVER_SHARE_BUCKET = "taskboard-share-inbox"

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

    // Metadata por último = commit do share. A tela nunca abre um lote ainda
    // incompleto caso o Cache Storage falhe durante a gravação de algum blob.
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
  files: ServerShareFile[]
  error?: string
}

async function fetchServerShareManifest(shareId: string) {
  const response = await fetch(`/api/share-inbox?share=${encodeURIComponent(shareId)}`, {
    method: "GET",
    credentials: "same-origin",
    cache: "no-store",
  })
  const payload = await response.json().catch(() => ({})) as ServerShareManifest
  if (!response.ok) {
    throw new Error(payload.error || "Não foi possível recuperar o compartilhamento temporário.")
  }
  if (!payload || !Array.isArray(payload.files)) {
    throw new Error("O compartilhamento temporário retornou dados inválidos.")
  }
  return payload
}

async function fetchServerShareFile(shareId: string, item: ServerShareFile) {
  const response = await fetch(
    `/api/share-inbox?share=${encodeURIComponent(shareId)}&file=${encodeURIComponent(String(item.index))}`,
    { method: "GET", credentials: "same-origin", cache: "no-store" },
  )
  if (!response.ok) throw new Error(`Não foi possível recuperar “${item.name}”.`)
  const blob = await response.blob()
  const encodedName = response.headers.get("X-TaskBoard-File-Name")
  const modified = Number(response.headers.get("X-TaskBoard-Last-Modified") || item.lastModified || Date.now())
  return new File([blob], encodedName ? decodeURIComponent(encodedName) : item.name, {
    type: response.headers.get("Content-Type") || item.type || blob.type || "application/octet-stream",
    lastModified: Number.isFinite(modified) ? modified : Date.now(),
  })
}

export async function readServerStagedShare(
  shareId: string,
  userId: string,
  payload: { title?: string; text?: string; url?: string; expectedFiles?: number } = {},
) {
  if (!shareId || !userId) throw new Error("Compartilhamento temporário inválido.")

  const manifest = await fetchServerShareManifest(shareId)
  const expectedFiles = Math.max(0, Number(payload.expectedFiles || 0))
  const ordered = [...manifest.files].sort((a, b) => a.index - b.index)
  const files: File[] = []
  const missingNames: string[] = []

  // Pouca concorrência evita estourar memória em compartilhamentos com vários
  // vídeos/imagens grandes, sem voltar ao envio sequencial lento.
  let cursor = 0
  const workers = Array.from({ length: Math.min(3, Math.max(1, ordered.length)) }, async () => {
    while (cursor < ordered.length) {
      const index = cursor
      cursor += 1
      const item = ordered[index]
      try {
        const file = await fetchServerShareFile(shareId, item)
        files[index] = file
      } catch {
        missingNames.push(item.name)
      }
    }
  })
  await Promise.all(workers)

  const availableFiles = files.filter(Boolean)
  if ((expectedFiles > 0 || ordered.length > 0) && availableFiles.length === 0) {
    throw new Error("Os anexos chegaram ao servidor, mas não puderam ser recuperados. Compartilhe novamente pelo TaskBoard.")
  }

  return {
    metadata: {
      id: shareId,
      title: payload.title ?? "",
      text: payload.text ?? "",
      url: payload.url ?? "",
      receivedAt: manifest.receivedAt ?? new Date().toISOString(),
      files: availableFiles.map((file, index) => ({
        index,
        name: file.name,
        type: file.type,
        size: file.size,
        lastModified: file.lastModified,
      })),
    },
    files: availableFiles,
    missingNames,
  }
}

export async function deleteServerStagedShare(shareId: string, userId: string) {
  if (!shareId || !userId) return
  await fetch(`/api/share-inbox?share=${encodeURIComponent(shareId)}`, {
    method: "DELETE",
    credentials: "same-origin",
    cache: "no-store",
  }).catch(() => undefined)
}
