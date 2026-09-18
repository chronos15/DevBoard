import { NextResponse } from "next/server"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/server"

const SERVER_SHARE_BUCKET = "taskboard-share-inbox"
const SERVER_SHARE_MANIFEST = "__taskboard_share_manifest.json"

type ManifestFile = {
  index: number
  storedName: string
  name: string
  type: string
  size: number
  lastModified: number
}

type ShareManifest = {
  id: string
  receivedAt: string
  userId?: string
  files: ManifestFile[]
}

function validShareId(value: string) {
  return /^[a-zA-Z0-9-]{12,180}$/.test(value)
}

function adminStorage() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceRoleKey) return null
  return createAdminClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

async function authenticatedUser() {
  const supabase = await createClient()
  const { data } = await supabase.auth.getUser()
  return data.user ?? null
}

async function loadManifest(admin: NonNullable<ReturnType<typeof adminStorage>>, userId: string, shareId: string) {
  const path = `${userId}/${shareId}/${SERVER_SHARE_MANIFEST}`
  const { data, error } = await admin.storage.from(SERVER_SHARE_BUCKET).download(path)
  if (error || !data) return null

  try {
    const parsed = JSON.parse(await data.text()) as ShareManifest
    if (!parsed || parsed.id !== shareId || !Array.isArray(parsed.files)) return null
    if (parsed.userId && parsed.userId !== userId) return null
    return parsed
  } catch {
    return null
  }
}

export async function GET(request: Request) {
  const user = await authenticatedUser()
  if (!user) return NextResponse.json({ error: "Sua sessão expirou. Entre novamente no TaskBoard." }, { status: 401 })

  const admin = adminStorage()
  if (!admin) return NextResponse.json({ error: "O recebimento temporário de anexos não está configurado no servidor." }, { status: 503 })

  const url = new URL(request.url)
  const shareId = (url.searchParams.get("share") || "").trim()
  if (!validShareId(shareId)) return NextResponse.json({ error: "Compartilhamento temporário inválido." }, { status: 400 })

  const manifest = await loadManifest(admin, user.id, shareId)
  if (!manifest) return NextResponse.json({ error: "O conteúdo compartilhado não está mais disponível." }, { status: 404 })

  const fileIndexRaw = url.searchParams.get("file")
  if (fileIndexRaw === null) {
    return NextResponse.json({
      id: manifest.id,
      receivedAt: manifest.receivedAt,
      files: manifest.files.map(({ index, name, type, size, lastModified }) => ({ index, name, type, size, lastModified })),
    })
  }

  const fileIndex = Number(fileIndexRaw)
  const item = manifest.files.find((file) => file.index === fileIndex)
  if (!Number.isInteger(fileIndex) || !item) {
    return NextResponse.json({ error: "Arquivo temporário inválido." }, { status: 404 })
  }

  const path = `${user.id}/${shareId}/${item.storedName}`
  const { data, error } = await admin.storage.from(SERVER_SHARE_BUCKET).download(path)
  if (error || !data) return NextResponse.json({ error: "Não foi possível recuperar este anexo temporário." }, { status: 404 })

  return new Response(data, {
    status: 200,
    headers: {
      "Content-Type": item.type || data.type || "application/octet-stream",
      "Content-Length": String(data.size),
      "Cache-Control": "no-store",
      "X-TaskBoard-File-Name": encodeURIComponent(item.name || `arquivo-${item.index + 1}`),
      "X-TaskBoard-Last-Modified": String(item.lastModified || Date.now()),
    },
  })
}

export async function DELETE(request: Request) {
  const user = await authenticatedUser()
  if (!user) return NextResponse.json({ ok: false }, { status: 401 })

  const admin = adminStorage()
  if (!admin) return NextResponse.json({ ok: false }, { status: 503 })

  const url = new URL(request.url)
  const shareId = (url.searchParams.get("share") || "").trim()
  if (!validShareId(shareId)) return NextResponse.json({ ok: false }, { status: 400 })

  const manifest = await loadManifest(admin, user.id, shareId)
  if (!manifest) return NextResponse.json({ ok: true })

  const folder = `${user.id}/${shareId}`
  const paths = [
    ...manifest.files.map((item) => `${folder}/${item.storedName}`),
    `${folder}/${SERVER_SHARE_MANIFEST}`,
  ]
  await admin.storage.from(SERVER_SHARE_BUCKET).remove(paths)
  return NextResponse.json({ ok: true })
}
