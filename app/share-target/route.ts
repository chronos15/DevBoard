import { NextResponse } from "next/server"
import { createClient as createAdminClient, type SupabaseClient } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/server"

const SERVER_SHARE_BUCKET = "taskboard-share-inbox"
const SERVER_SHARE_MAX_AGE_MS = 24 * 60 * 60 * 1000
const SERVER_SHARE_MANIFEST = "__taskboard_share_manifest.json"
const SERVER_SHARE_BUCKET_SIZE = 200 * 1024 * 1024

function firstForwardedValue(value: string | null) {
  return value?.split(",", 1)[0]?.trim() || ""
}

function normalizeHttpOrigin(value: string | null | undefined) {
  const candidate = value?.trim()
  if (!candidate) return null
  try {
    const parsed = new URL(candidate)
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null
    return parsed.origin
  } catch {
    return null
  }
}

function resolvePublicOrigin(request: Request) {
  const configuredOrigin = normalizeHttpOrigin(process.env.NEXT_PUBLIC_APP_URL)
  if (configuredOrigin) return configuredOrigin

  const forwardedHost = firstForwardedValue(request.headers.get("x-forwarded-host"))
  const forwardedProto = firstForwardedValue(request.headers.get("x-forwarded-proto")).toLowerCase()
  if (forwardedHost && (forwardedProto === "http" || forwardedProto === "https")) {
    const forwardedOrigin = normalizeHttpOrigin(`${forwardedProto}://${forwardedHost}`)
    if (forwardedOrigin) return forwardedOrigin
  }

  const requestOriginHeader = normalizeHttpOrigin(request.headers.get("origin"))
  if (requestOriginHeader) return requestOriginHeader

  const host = firstForwardedValue(request.headers.get("host"))
  if (host) {
    try {
      const requestUrl = new URL(request.url)
      const hostOrigin = normalizeHttpOrigin(`${requestUrl.protocol}//${host}`)
      if (hostOrigin) return hostOrigin
    } catch {
      // Segue para o último fallback.
    }
  }

  return new URL(request.url).origin
}

function safeFileName(name: string) {
  const clean = (name || "arquivo-compartilhado")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\\/]+/g, "-")
    .replace(/[^a-zA-Z0-9._()\- ]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
  return clean.slice(0, 140) || "arquivo-compartilhado"
}

function collectFiles(formData: FormData) {
  const files: File[] = []
  for (const [, entry] of formData.entries()) {
    if (typeof entry === "string") continue
    if (typeof entry.size !== "number") continue
    files.push(entry)
  }
  return files
}

function createStorageAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceRoleKey) return null
  return createAdminClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

async function ensureShareBucket(storageClient: SupabaseClient) {
  const { data } = await storageClient.storage.getBucket(SERVER_SHARE_BUCKET)
  if (data) return

  const { error } = await storageClient.storage.createBucket(SERVER_SHARE_BUCKET, {
    public: false,
    fileSizeLimit: SERVER_SHARE_BUCKET_SIZE,
  })
  if (error && !/already|exist/i.test(error.message || "")) throw error
}

async function cleanupOldServerShares(storageClient: SupabaseClient, userId: string) {
  try {
    const { data } = await storageClient.storage.from(SERVER_SHARE_BUCKET).list(userId, { limit: 100 })
    const now = Date.now()
    for (const entry of data ?? []) {
      if (entry.id || !entry.name) continue
      const stamp = Number(entry.name.split("-", 1)[0])
      if (!Number.isFinite(stamp) || now - stamp <= SERVER_SHARE_MAX_AGE_MS) continue
      const folder = `${userId}/${entry.name}`
      const { data: children } = await storageClient.storage.from(SERVER_SHARE_BUCKET).list(folder, { limit: 100 })
      const paths = (children ?? []).filter((item) => item.name).map((item) => `${folder}/${item.name}`)
      if (paths.length) await storageClient.storage.from(SERVER_SHARE_BUCKET).remove(paths)
    }
  } catch {
    // Limpeza é best-effort e nunca impede o recebimento atual.
  }
}

export async function POST(request: Request) {
  const target = new URL("/compartilhar", resolvePublicOrigin(request))

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    target.searchParams.set("erro", "recebimento")
    return NextResponse.redirect(target, 303)
  }

  const title = String(formData.get("title") || "").trim()
  const text = String(formData.get("text") || "").trim()
  const url = String(formData.get("url") || "").trim()
  const files = collectFiles(formData)

  if (title) target.searchParams.set("title", title.slice(0, 300))
  if (text) target.searchParams.set("text", text.slice(0, 4000))
  if (url) target.searchParams.set("url", url.slice(0, 2000))

  if (files.length) {
    try {
      const sessionClient = await createClient()
      const { data: authData } = await sessionClient.auth.getUser()
      const user = authData.user

      if (user) {
        // V217: a persistência temporária não depende mais das policies de
        // storage.objects. A service role é usada apenas no servidor e somente
        // neste inbox privado; a leitura continua vinculada ao usuário logado.
        const admin = createStorageAdmin()
        const storageClient = (admin ?? sessionClient) as SupabaseClient
        if (admin) await ensureShareBucket(admin)

        const shareId = `${Date.now()}-${typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2)}`
        const uploaded: string[] = []
        const stagedFiles: Array<{
          index: number
          storedName: string
          name: string
          type: string
          size: number
          lastModified: number
        }> = []

        await cleanupOldServerShares(storageClient, user.id)

        try {
          for (let index = 0; index < files.length; index += 1) {
            const file = files[index]
            const storedName = `${String(index).padStart(3, "0")}-${safeFileName(file.name || `arquivo-${index + 1}`)}`
            const path = `${user.id}/${shareId}/${storedName}`
            const { error } = await storageClient.storage.from(SERVER_SHARE_BUCKET).upload(path, file, {
              contentType: file.type || "application/octet-stream",
              upsert: false,
            })
            if (error) throw error
            uploaded.push(path)
            stagedFiles.push({
              index,
              storedName,
              name: file.name || `arquivo-${index + 1}`,
              type: file.type || "application/octet-stream",
              size: file.size,
              lastModified: file.lastModified || Date.now(),
            })
          }

          const manifestPath = `${user.id}/${shareId}/${SERVER_SHARE_MANIFEST}`
          const manifest = new Blob([JSON.stringify({
            id: shareId,
            userId: user.id,
            receivedAt: new Date().toISOString(),
            files: stagedFiles,
          })], { type: "application/json" })
          const { error: manifestError } = await storageClient.storage.from(SERVER_SHARE_BUCKET).upload(manifestPath, manifest, {
            contentType: "application/json",
            upsert: true,
          })
          if (manifestError) throw manifestError
          uploaded.push(manifestPath)

          target.searchParams.set("serverShare", shareId)
          target.searchParams.set("serverFiles", String(files.length))
          target.searchParams.set("receiver", admin ? "server-v217" : "server-session-v217")
          return NextResponse.redirect(target, 303)
        } catch (error) {
          console.error("[TaskBoard/PWA Share] Falha ao persistir anexos temporários", error)
          if (uploaded.length) await storageClient.storage.from(SERVER_SHARE_BUCKET).remove(uploaded).catch(() => undefined)
        }
      }
    } catch (error) {
      console.error("[TaskBoard/PWA Share] Falha no fallback de servidor", error)
    }
  }

  // Se chegamos aqui, o Service Worker não conseguiu assumir o POST e o inbox
  // de servidor também não conseguiu persistir os binários. Mantemos texto/link
  // e mostramos uma mensagem amigável em vez de fingir que existem 0 anexos.
  target.searchParams.set("fallback", "1")
  if (files.length) {
    target.searchParams.set("fileCount", String(files.length))
    target.searchParams.set("files", files.slice(0, 5).map((file) => file.name || "arquivo").join("|"))
  }
  return NextResponse.redirect(target, 303)
}
