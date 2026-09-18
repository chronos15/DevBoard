import { NextResponse } from "next/server"
import {
  deleteServerShare,
  loadServerShareFile,
  loadServerShareManifest,
  validServerShareToken,
} from "@/lib/server-share-inbox"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function noStoreJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init)
  response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate")
  response.headers.set("Pragma", "no-cache")
  return response
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const shareId = (url.searchParams.get("share") || "").trim()
  if (!validServerShareToken(shareId)) {
    return noStoreJson({ error: "Compartilhamento temporário inválido." }, { status: 400 })
  }

  const fileIndexRaw = url.searchParams.get("file")
  if (fileIndexRaw === null) {
    const manifest = await loadServerShareManifest(shareId)
    if (!manifest) {
      return noStoreJson({ error: "O conteúdo compartilhado não está mais disponível." }, { status: 404 })
    }

    return noStoreJson({
      id: manifest.id,
      receivedAt: manifest.receivedAt,
      expiresAt: manifest.expiresAt,
      title: manifest.title,
      text: manifest.text,
      url: manifest.url,
      files: manifest.files.map(({ index, name, type, size, lastModified }) => ({
        index,
        name,
        type,
        size,
        lastModified,
      })),
    })
  }

  const fileIndex = Number(fileIndexRaw)
  if (!Number.isInteger(fileIndex) || fileIndex < 0) {
    return noStoreJson({ error: "Arquivo temporário inválido." }, { status: 400 })
  }

  const loaded = await loadServerShareFile(shareId, fileIndex)
  if (!loaded) {
    return noStoreJson({ error: "Não foi possível recuperar este anexo temporário." }, { status: 404 })
  }

  return new Response(loaded.data, {
    status: 200,
    headers: {
      "Content-Type": loaded.item.type || loaded.data.type || "application/octet-stream",
      "Content-Length": String(loaded.data.size),
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "Pragma": "no-cache",
      "X-TaskBoard-File-Name": encodeURIComponent(loaded.item.name || `arquivo-${loaded.item.index + 1}`),
      "X-TaskBoard-Last-Modified": String(loaded.item.lastModified || Date.now()),
    },
  })
}

export async function DELETE(request: Request) {
  const url = new URL(request.url)
  const shareId = (url.searchParams.get("share") || "").trim()
  if (!validServerShareToken(shareId)) {
    return noStoreJson({ ok: false }, { status: 400 })
  }

  await deleteServerShare(shareId)
  return noStoreJson({ ok: true })
}
