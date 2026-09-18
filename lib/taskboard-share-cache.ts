"use client"

import { createClient } from "@/lib/supabase/client"

const SHARE_CACHE = "devboard-share-target-v1"
const SHARE_PREFIX = "/__devboard-share-target__/"
export const SERVER_SHARE_BUCKET = "taskboard-share-inbox"
const SERVER_SHARE_MANIFEST = "__taskboard_share_manifest.json"

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

type ServerShareManifest = {
  id?: string
  receivedAt?: string
  files?: Array<{
    index?: number
    storedName: string
    name?: string
    type?: string
    size?: number
    lastModified?: number
  }>
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

async function downloadServerObject(
  supabase: ReturnType<typeof createClient>,
  path: string,
  attempts = 4,
) {
  let lastError: unknown = null
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const { data, error } = await supabase.storage.from(SERVER_SHARE_BUCKET).download(path)
    if (!error && data) return data
    lastError = error
    if (attempt < attempts - 1) await wait(120 + (attempt * 180))
  }
  throw lastError ?? new Error("Não foi possível recuperar o arquivo temporário.")
}

async function listServerShareEntries(
  supabase: ReturnType<typeof createClient>,
  folder: string,
  expectedFiles: number,
) {
  let lastError: unknown = null
  let entries: Array<{ name: string; updated_at?: string | null; metadata?: { mimetype?: string } | null }> = []

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const { data, error } = await supabase.storage.from(SERVER_SHARE_BUCKET).list(folder, {
      limit: 100,
      sortBy: { column: "name", order: "asc" },
    })
    if (error) {
      lastError = error
    } else {
      // Não dependemos mais de `item.id`. Algumas versões self-hosted do
      // Storage retornam os arquivos corretamente, mas deixam esse campo nulo.
      entries = (data ?? [])
        .filter((item) => Boolean(item.name) && item.name !== SERVER_SHARE_MANIFEST)
        .map((item) => ({
          name: item.name,
          updated_at: item.updated_at,
          metadata: item.metadata as { mimetype?: string } | null | undefined,
        }))
      if (entries.length > 0 && (!expectedFiles || entries.length >= expectedFiles)) return entries
    }
    if (attempt < 3) await wait(120 + (attempt * 180))
  }

  if (entries.length) return entries
  if (lastError) throw lastError
  return entries
}

export async function readServerStagedShare(
  shareId: string,
  userId: string,
  payload: { title?: string; text?: string; url?: string; expectedFiles?: number } = {},
) {
  if (!shareId || !userId) throw new Error("Compartilhamento temporário inválido.")
  const supabase = createClient()
  const folder = `${userId}/${shareId}`
  const expectedFiles = Math.max(0, Number(payload.expectedFiles || 0))
  const files: File[] = []
  const missingNames: string[] = []

  // V216: o servidor grava um manifesto em um caminho conhecido. Isso evita
  // depender de Storage.list() para descobrir os binários recém-enviados.
  let manifest: ServerShareManifest | null = null
  try {
    const manifestBlob = await downloadServerObject(supabase, `${folder}/${SERVER_SHARE_MANIFEST}`, 3)
    const parsed = JSON.parse(await manifestBlob.text()) as ServerShareManifest
    if (Array.isArray(parsed.files)) manifest = parsed
  } catch {
    // Compartilhamentos criados por versões anteriores não possuem manifesto.
  }

  if (manifest?.files?.length) {
    const ordered = [...manifest.files].sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    for (let index = 0; index < ordered.length; index += 1) {
      const item = ordered[index]
      if (!item?.storedName) continue
      try {
        const blob = await downloadServerObject(supabase, `${folder}/${item.storedName}`)
        files.push(new File([blob], item.name || originalNameFromServerObject(item.storedName), {
          type: item.type || blob.type || "application/octet-stream",
          lastModified: item.lastModified || Date.now(),
        }))
      } catch {
        missingNames.push(item.name || originalNameFromServerObject(item.storedName))
      }
    }
  } else {
    // Compatibilidade com V134–V215. O fallback não exige `item.id`, pois isso
    // era justamente o motivo de alguns shares aparecerem como "0 itens".
    const entries = await listServerShareEntries(supabase, folder, expectedFiles)
    for (const item of entries) {
      try {
        const blob = await downloadServerObject(supabase, `${folder}/${item.name}`)
        files.push(new File([blob], originalNameFromServerObject(item.name), {
          type: blob.type || item.metadata?.mimetype || "application/octet-stream",
          lastModified: item.updated_at ? new Date(item.updated_at).getTime() : Date.now(),
        }))
      } catch {
        missingNames.push(originalNameFromServerObject(item.name))
      }
    }
  }

  if (expectedFiles > 0 && files.length === 0) {
    throw new Error("O anexo chegou ao servidor, mas ainda não pôde ser recuperado do armazenamento temporário. Tente compartilhar novamente.")
  }

  return {
    metadata: {
      id: shareId,
      title: payload.title ?? "",
      text: payload.text ?? "",
      url: payload.url ?? "",
      receivedAt: manifest?.receivedAt ?? new Date().toISOString(),
      files: files.map((file, index) => ({
        index,
        name: file.name,
        type: file.type,
        size: file.size,
        lastModified: file.lastModified,
      })),
    },
    files,
    missingNames,
  }
}

export async function deleteServerStagedShare(shareId: string, userId: string) {
  if (!shareId || !userId) return
  const supabase = createClient()
  const folder = `${userId}/${shareId}`
  const { data, error } = await supabase.storage.from(SERVER_SHARE_BUCKET).list(folder, { limit: 100 })
  if (error) return
  const paths = (data ?? []).filter((item) => item.name).map((item) => `${folder}/${item.name}`)
  if (paths.length) await supabase.storage.from(SERVER_SHARE_BUCKET).remove(paths)
}
