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

  await cache.put(
    cacheUrl(`${SHARE_PREFIX}${id}/metadata`),
    new Response(JSON.stringify(metadata), { headers: { "Content-Type": "application/json" } }),
  )
  await Promise.all(files.map((file, index) => cache.put(
    cacheUrl(`${SHARE_PREFIX}${id}/file/${index}`),
    new Response(file, { headers: { "Content-Type": file.type || "application/octet-stream" } }),
  )))

  return `/compartilhar?share=${encodeURIComponent(id)}`
}
