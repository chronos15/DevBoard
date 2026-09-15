import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

const SERVER_SHARE_BUCKET = "taskboard-share-inbox"
const SERVER_SHARE_MAX_AGE_MS = 24 * 60 * 60 * 1000

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
    if (typeof entry.size !== "number" || entry.size <= 0) continue
    files.push(entry)
  }
  return files
}

async function cleanupOldServerShares(supabase: Awaited<ReturnType<typeof createClient>>, userId: string) {
  try {
    const { data } = await supabase.storage.from(SERVER_SHARE_BUCKET).list(userId, { limit: 100 })
    const now = Date.now()
    for (const entry of data ?? []) {
      // Pastas virtuais do Storage normalmente chegam sem id.
      if (entry.id || !entry.name) continue
      const stamp = Number(entry.name.split("-", 1)[0])
      if (!Number.isFinite(stamp) || now - stamp <= SERVER_SHARE_MAX_AGE_MS) continue
      const folder = `${userId}/${entry.name}`
      const { data: children } = await supabase.storage.from(SERVER_SHARE_BUCKET).list(folder, { limit: 100 })
      const paths = (children ?? []).filter((item) => item.id && item.name).map((item) => `${folder}/${item.name}`)
      if (paths.length) await supabase.storage.from(SERVER_SHARE_BUCKET).remove(paths)
    }
  } catch {
    // Limpeza é best-effort e nunca deve impedir o recebimento atual.
  }
}

export async function POST(request: Request) {
  const target = new URL("/compartilhar", request.url)

  let formData: FormData | null = null
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
      const supabase = await createClient()
      const { data: authData } = await supabase.auth.getUser()
      const user = authData.user
      if (user) {
        const shareId = `${Date.now()}-${typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2)}`
        const uploaded: string[] = []
        await cleanupOldServerShares(supabase, user.id)

        try {
          for (let index = 0; index < files.length; index += 1) {
            const file = files[index]
            const path = `${user.id}/${shareId}/${String(index).padStart(3, "0")}-${safeFileName(file.name || `arquivo-${index + 1}`)}`
            const { error } = await supabase.storage.from(SERVER_SHARE_BUCKET).upload(path, file, {
              contentType: file.type || "application/octet-stream",
              upsert: false,
            })
            if (error) throw error
            uploaded.push(path)
          }
          target.searchParams.set("serverShare", shareId)
          target.searchParams.set("serverFiles", String(files.length))
          return NextResponse.redirect(target, 303)
        } catch {
          if (uploaded.length) await supabase.storage.from(SERVER_SHARE_BUCKET).remove(uploaded).catch(() => undefined)
        }
      }
    } catch {
      // Se o fallback persistente não estiver disponível, seguimos com o aviso legado.
    }
  }

  // Fallback legado: preserva texto/link e informa ao cliente que os arquivos
  // precisam ser compartilhados novamente. Em instalações atualizadas, o SW ou
  // o inbox privado acima preservam os binários antes deste redirect.
  target.searchParams.set("fallback", "1")
  if (files.length) {
    target.searchParams.set("fileCount", String(files.length))
    target.searchParams.set("files", files.slice(0, 5).map((file) => file.name || "arquivo").join("|"))
  }
  return NextResponse.redirect(target, 303)
}
