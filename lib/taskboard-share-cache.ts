"use client"

import { createClient } from "@/lib/supabase/client"

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

  await cache.put(
    cacheUrl(`${SHARE_PREFIX}${id}/metadata`),
    new Response(JSON.stringify(metadata), { headers: { "Content-Type": "application/json" } }),
  )
  await Promise.all(files.map((file, index) => cache.put(
    cacheUrl(`${SHARE_PREFIX}${id}/file/${index}`),
    new Response(file, {
      headers: {
        "Content-Type": file.type || "application/octet-stream",
        "X-TaskBoard-File-Name": encodeURIComponent(file.name || `arquivo-${index + 1}`),
        "X-TaskBoard-Last-Modified": String(file.lastModified || Date.now()),
      },
    }),
  )))

  return `/compartilhar?share=${encodeURIComponent(id)}`
}

function originalNameFromServerObject(name: string) {
  return name.replace(/^\d{3,5}-/, "") || "arquivo-compartilhado"
}

export async function readServerStagedShare(
  shareId: string,
  userId: string,
  payload: { title?: string; text?: string; url?: string } = {},
) {
  if (!shareId || !userId) throw new Error("Compartilhamento temporário inválido.")
  const supabase = createClient()
  const folder = `${userId}/${shareId}`
  const { data, error } = await supabase.storage.from(SERVER_SHARE_BUCKET).list(folder, {
    limit: 100,
    sortBy: { column: "name", order: "asc" },
  })
  if (error) throw error

  const entries = (data ?? []).filter((item) => item.name && item.id)
  const files = await Promise.all(entries.map(async (item, index) => {
    const path = `${folder}/${item.name}`
    const { data: blob, error: downloadError } = await supabase.storage.from(SERVER_SHARE_BUCKET).download(path)
    if (downloadError || !blob) throw downloadError ?? new Error(`Não foi possível recuperar “${item.name}”.`)
    return new File([blob], originalNameFromServerObject(item.name), {
      type: blob.type || item.metadata?.mimetype || "application/octet-stream",
      lastModified: item.updated_at ? new Date(item.updated_at).getTime() : Date.now(),
    })
  }))

  return {
    metadata: {
      id: shareId,
      title: payload.title ?? "",
      text: payload.text ?? "",
      url: payload.url ?? "",
      receivedAt: new Date().toISOString(),
      files: files.map((file, index) => ({
        index,
        name: file.name,
        type: file.type,
        size: file.size,
        lastModified: file.lastModified,
      })),
    },
    files,
  }
}

export async function deleteServerStagedShare(shareId: string, userId: string) {
  if (!shareId || !userId) return
  const supabase = createClient()
  const folder = `${userId}/${shareId}`
  const { data, error } = await supabase.storage.from(SERVER_SHARE_BUCKET).list(folder, { limit: 100 })
  if (error) return
  const paths = (data ?? []).filter((item) => item.name && item.id).map((item) => `${folder}/${item.name}`)
  if (paths.length) await supabase.storage.from(SERVER_SHARE_BUCKET).remove(paths)
}
