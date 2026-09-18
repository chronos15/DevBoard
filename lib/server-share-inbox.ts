import { randomBytes } from "node:crypto"
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createClient as createAdminClient, type SupabaseClient } from "@supabase/supabase-js"

export const SERVER_SHARE_BUCKET = "taskboard-share-inbox"
export const SERVER_SHARE_MANIFEST = "__taskboard_share_manifest.json"
export const SERVER_SHARE_MAX_AGE_MS = 24 * 60 * 60 * 1000
export const SERVER_SHARE_MAX_FILE_BYTES = 200 * 1024 * 1024
export const SERVER_SHARE_MAX_BATCH_BYTES = 300 * 1024 * 1024

const SERVER_SHARE_ROOT_PREFIX = "v219"
const LOCAL_SHARE_ROOT = process.env.TASKBOARD_SHARE_INBOX_DIR?.trim()
  || (process.platform === "win32"
    ? path.join(process.env.LOCALAPPDATA?.trim() || os.tmpdir(), "TaskBoard", "share-inbox-v219")
    : path.join(os.tmpdir(), "taskboard-share-inbox-v219"))

type ShareFileManifest = {
  index: number
  storedName: string
  name: string
  type: string
  size: number
  lastModified: number
}

export type ServerShareManifest = {
  version: 219
  id: string
  receivedAt: string
  expiresAt: string
  title: string
  text: string
  url: string
  files: ShareFileManifest[]
}

export type StagedServerShare = {
  manifest: ServerShareManifest
  storedLocally: boolean
  storedRemotely: boolean
}

function adminStorage() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !serviceRoleKey) return null
  return createAdminClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
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

function tokenPath(token: string) {
  return path.join(LOCAL_SHARE_ROOT, token)
}

function remoteFolder(token: string) {
  return `${SERVER_SHARE_ROOT_PREFIX}/${token}`
}

export function createServerShareToken() {
  // 256 bits de entropia. O token funciona como uma capability temporária e não
  // depende de cookie/sessão no POST disparado pelo Android.
  return randomBytes(32).toString("hex")
}

export function validServerShareToken(value: string) {
  // Aceita o formato V219 (64 hex) e IDs legados somente para permitir limpeza/
  // recuperação durante a transição de uma instalação já aberta.
  return /^[a-f0-9]{64}$/i.test(value) || /^[a-zA-Z0-9-]{12,180}$/.test(value)
}

function formText(formData: FormData, name: string) {
  const entry = formData.get(name)
  return typeof entry === "string" ? entry.trim() : ""
}

export function collectSharedFiles(formData: FormData) {
  const files: File[] = []
  for (const [, entry] of formData.entries()) {
    if (typeof entry === "string") continue
    if (typeof entry.size !== "number") continue
    // Arquivos vazios legítimos continuam sendo aceitos. O que importa é que a
    // parte multipart seja binária, independentemente do nome do campo.
    files.push(entry)
  }
  return files
}

function buildManifest(token: string, formData: FormData, files: File[]): ServerShareManifest {
  const now = Date.now()
  return {
    version: 219,
    id: token,
    receivedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + SERVER_SHARE_MAX_AGE_MS).toISOString(),
    title: formText(formData, "title").slice(0, 500),
    text: formText(formData, "text").slice(0, 12000),
    url: formText(formData, "url").slice(0, 4000),
    files: files.map((file, index) => ({
      index,
      storedName: `${String(index).padStart(3, "0")}-${safeFileName(file.name || `arquivo-${index + 1}`)}`,
      name: file.name || `arquivo-${index + 1}`,
      type: file.type || "application/octet-stream",
      size: file.size,
      lastModified: file.lastModified || now,
    })),
  }
}

function validateFiles(files: File[]) {
  const oversized = files.find((file) => file.size > SERVER_SHARE_MAX_FILE_BYTES)
  if (oversized) {
    throw new Error(`O arquivo “${oversized.name || "compartilhado"}” excede 200 MB.`)
  }
  const total = files.reduce((sum, file) => sum + file.size, 0)
  if (total > SERVER_SHARE_MAX_BATCH_BYTES) {
    throw new Error("O compartilhamento excede o limite temporário de 300 MB.")
  }
}

async function ensureShareBucket(admin: SupabaseClient) {
  const { data } = await admin.storage.getBucket(SERVER_SHARE_BUCKET)
  if (data) return
  const { error } = await admin.storage.createBucket(SERVER_SHARE_BUCKET, {
    public: false,
    fileSizeLimit: SERVER_SHARE_MAX_FILE_BYTES,
  })
  if (error && !/already|exist/i.test(error.message || "")) throw error
}

async function writeLocal(manifest: ServerShareManifest, files: File[]) {
  const folder = tokenPath(manifest.id)
  const tempFolder = `${folder}.tmp-${process.pid}-${Date.now()}`
  await mkdir(tempFolder, { recursive: true })

  try {
    for (let index = 0; index < files.length; index += 1) {
      const item = manifest.files[index]
      const buffer = Buffer.from(await files[index].arrayBuffer())
      await writeFile(path.join(tempFolder, item.storedName), buffer)
    }

    // Manifest por último = commit. Um diretório sem manifest nunca é tratado
    // como recebimento completo.
    await writeFile(
      path.join(tempFolder, SERVER_SHARE_MANIFEST),
      JSON.stringify(manifest),
      "utf8",
    )

    await rm(folder, { recursive: true, force: true }).catch(() => undefined)
    // rename entre diretórios no mesmo volume é atômico. Em plataformas onde
    // rename possa falhar, copiamos de forma simples para o diretório final.
    const { rename } = await import("node:fs/promises")
    try {
      await rename(tempFolder, folder)
    } catch {
      await mkdir(folder, { recursive: true })
      const entries = await readdir(tempFolder)
      for (const entry of entries) {
        const data = await readFile(path.join(tempFolder, entry))
        await writeFile(path.join(folder, entry), data)
      }
      await rm(tempFolder, { recursive: true, force: true })
    }
  } catch (error) {
    await rm(tempFolder, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }
}

async function writeRemote(admin: SupabaseClient, manifest: ServerShareManifest, files: File[]) {
  await ensureShareBucket(admin)
  const folder = remoteFolder(manifest.id)
  const uploaded: string[] = []

  try {
    for (let index = 0; index < files.length; index += 1) {
      const item = manifest.files[index]
      const objectPath = `${folder}/${item.storedName}`
      const { error } = await admin.storage.from(SERVER_SHARE_BUCKET).upload(objectPath, files[index], {
        contentType: item.type,
        upsert: true,
      })
      if (error) throw error
      uploaded.push(objectPath)
    }

    const manifestPath = `${folder}/${SERVER_SHARE_MANIFEST}`
    const { error } = await admin.storage.from(SERVER_SHARE_BUCKET).upload(
      manifestPath,
      new Blob([JSON.stringify(manifest)], { type: "application/json" }),
      { contentType: "application/json", upsert: true },
    )
    if (error) throw error
    uploaded.push(manifestPath)
  } catch (error) {
    if (uploaded.length) {
      await admin.storage.from(SERVER_SHARE_BUCKET).remove(uploaded).catch(() => undefined)
    }
    throw error
  }
}

async function cleanupLocalShares() {
  try {
    await mkdir(LOCAL_SHARE_ROOT, { recursive: true })
    const entries = await readdir(/* turbopackIgnore: true */ LOCAL_SHARE_ROOT, { withFileTypes: true })
    const now = Date.now()
    await Promise.all(entries.map(async (entry) => {
      if (!entry.isDirectory()) return
      const folder = path.join(LOCAL_SHARE_ROOT, entry.name)
      try {
        const info = await stat(folder)
        if (now - info.mtimeMs > SERVER_SHARE_MAX_AGE_MS) {
          await rm(folder, { recursive: true, force: true })
        }
      } catch {
        // best effort
      }
    }))
  } catch {
    // best effort
  }
}

export async function stageServerShare(formData: FormData, preferredToken?: string): Promise<StagedServerShare> {
  const files = collectSharedFiles(formData)
  validateFiles(files)

  const title = formText(formData, "title")
  const text = formText(formData, "text")
  const url = formText(formData, "url")
  if (files.length === 0 && !title && !text && !url) {
    throw new Error("O compartilhamento chegou sem arquivo, texto ou link.")
  }

  const token = preferredToken && validServerShareToken(preferredToken)
    ? preferredToken
    : createServerShareToken()
  const manifest = buildManifest(token, formData, files)

  void cleanupLocalShares()
  const admin = adminStorage()

  // As duas gravações são independentes. No Windows Server o disco local evita
  // depender de rede/policy. Em ambientes distribuídos, o Supabase preserva o
  // mesmo recibo entre instâncias. Um único sucesso já é suficiente.
  const [localResult, remoteResult] = await Promise.allSettled([
    writeLocal(manifest, files),
    admin ? writeRemote(admin, manifest, files) : Promise.reject(new Error("Supabase service role indisponível")),
  ])

  const storedLocally = localResult.status === "fulfilled"
  const storedRemotely = remoteResult.status === "fulfilled"
  if (!storedLocally && !storedRemotely) {
    const localMessage = localResult.status === "rejected" ? String(localResult.reason) : ""
    const remoteMessage = remoteResult.status === "rejected" ? String(remoteResult.reason) : ""
    console.error("[TaskBoard/PWA Share V219] Nenhum backend conseguiu persistir o recebimento", {
      localMessage,
      remoteMessage,
    })
    throw new Error("Não foi possível preservar o conteúdo compartilhado antes de abrir o TaskBoard.")
  }

  return { manifest, storedLocally, storedRemotely }
}

function manifestExpired(manifest: ServerShareManifest) {
  const expiresAt = Date.parse(manifest.expiresAt || "")
  return Number.isFinite(expiresAt) && Date.now() > expiresAt
}

async function readLocalManifest(token: string) {
  try {
    const raw = await readFile(path.join(tokenPath(token), SERVER_SHARE_MANIFEST), "utf8")
    const parsed = JSON.parse(raw) as ServerShareManifest
    if (!parsed || parsed.id !== token || !Array.isArray(parsed.files) || manifestExpired(parsed)) return null
    return parsed
  } catch {
    return null
  }
}

async function readRemoteManifest(admin: SupabaseClient, token: string) {
  try {
    const { data, error } = await admin.storage
      .from(SERVER_SHARE_BUCKET)
      .download(`${remoteFolder(token)}/${SERVER_SHARE_MANIFEST}`)
    if (error || !data) return null
    const parsed = JSON.parse(await data.text()) as ServerShareManifest
    if (!parsed || parsed.id !== token || !Array.isArray(parsed.files) || manifestExpired(parsed)) return null
    return parsed
  } catch {
    return null
  }
}

export async function loadServerShareManifest(token: string) {
  if (!validServerShareToken(token)) return null
  const local = await readLocalManifest(token)
  if (local) return local
  const admin = adminStorage()
  return admin ? readRemoteManifest(admin, token) : null
}

export async function loadServerShareFile(token: string, index: number) {
  const manifest = await loadServerShareManifest(token)
  if (!manifest) return null
  const item = manifest.files.find((file) => file.index === index)
  if (!item) return null

  try {
    const data = await readFile(path.join(tokenPath(token), item.storedName))
    return { manifest, item, data: new Blob([data], { type: item.type }) }
  } catch {
    // tenta remoto abaixo
  }

  const admin = adminStorage()
  if (!admin) return null
  const { data, error } = await admin.storage
    .from(SERVER_SHARE_BUCKET)
    .download(`${remoteFolder(token)}/${item.storedName}`)
  if (error || !data) return null
  return { manifest, item, data }
}

export async function deleteServerShare(token: string) {
  if (!validServerShareToken(token)) return
  await rm(tokenPath(token), { recursive: true, force: true }).catch(() => undefined)

  const admin = adminStorage()
  if (!admin) return
  const manifest = await readRemoteManifest(admin, token)
  if (!manifest) return
  const folder = remoteFolder(token)
  const paths = [
    ...manifest.files.map((item) => `${folder}/${item.storedName}`),
    `${folder}/${SERVER_SHARE_MANIFEST}`,
  ]
  await admin.storage.from(SERVER_SHARE_BUCKET).remove(paths).catch(() => undefined)
}
