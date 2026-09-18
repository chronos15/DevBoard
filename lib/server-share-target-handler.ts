import { NextResponse } from "next/server"
import { stageServerShare } from "@/lib/server-share-inbox"
import { parseTaskBoardShareMultipart } from "@/lib/server-share-multipart"

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

  const origin = normalizeHttpOrigin(request.headers.get("origin"))
  if (origin) return origin

  const host = firstForwardedValue(request.headers.get("host"))
  if (host) {
    try {
      const requestUrl = new URL(request.url)
      const hostOrigin = normalizeHttpOrigin(`${requestUrl.protocol}//${host}`)
      if (hostOrigin) return hostOrigin
    } catch {
      // último fallback abaixo
    }
  }

  return new URL(request.url).origin
}

function shortContentType(value: string | null) {
  return (value || "desconhecido").split(";", 1)[0].trim().slice(0, 80)
}

function classifyReceiveError(error: unknown, contentType: string | null) {
  const message = error instanceof Error ? error.message : String(error || "")
  const lower = message.toLowerCase()
  if (!contentType?.toLowerCase().includes("multipart/form-data")) return "tipo-invalido"
  if (lower.includes("sem arquivo, texto ou link") || lower.includes("without file")) return "vazio"
  if (lower.includes("formdata") || lower.includes("multipart") || lower.includes("boundary") || lower.includes("unexpected end")) {
    return "multipart-incompleto"
  }
  if (lower.includes("excede") || lower.includes("limit")) return "limite"
  return "persistencia"
}

export async function handleTaskBoardShareTargetPost(request: Request) {
  const target = new URL("/compartilhar", resolvePublicOrigin(request))
  const contentType = request.headers.get("content-type")
  const contentLength = request.headers.get("content-length") || ""

  try {
    if (!contentType?.toLowerCase().includes("multipart/form-data")) {
      throw new Error(`Tipo de conteúdo inesperado no Web Share Target: ${contentType || "ausente"}`)
    }

    const parsed = await parseTaskBoardShareMultipart(request)
    const staged = await stageServerShare(parsed.formData)

    target.searchParams.set("serverShare", staged.manifest.id)
    target.searchParams.set("serverFiles", String(staged.manifest.files.length))
    target.searchParams.set("receiver", staged.storedLocally && staged.storedRemotely
      ? "server-v219-dual"
      : staged.storedLocally
        ? "server-v219-disk"
        : "server-v219-supabase")

    const response = NextResponse.redirect(target, 303)
    response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate")
    response.headers.set("Pragma", "no-cache")
    response.headers.set("X-TaskBoard-Share-Receiver", "V219")
    response.headers.set("X-TaskBoard-Share-Parts", String(parsed.partCount))
    response.headers.set("X-TaskBoard-Share-Files", String(parsed.fileCount))
    return response
  } catch (error) {
    const reason = classifyReceiveError(error, contentType)
    console.error("[TaskBoard/PWA Share V219] Falha ao receber compartilhamento externo", {
      reason,
      contentType,
      contentLength,
      url: request.url,
      error,
    })
    target.searchParams.set("erro", "recebimento-v219")
    target.searchParams.set("motivo", reason)
    if (contentLength) target.searchParams.set("bytes", contentLength.slice(0, 24))
    target.searchParams.set("tipo", shortContentType(contentType))
    target.searchParams.set("receiver", "server-v219-error")
    const response = NextResponse.redirect(target, 303)
    response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate")
    response.headers.set("Pragma", "no-cache")
    response.headers.set("X-TaskBoard-Share-Receiver", "V219-error")
    return response
  }
}
