import { NextResponse } from "next/server"
import { stageServerShare } from "@/lib/server-share-inbox"

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

export async function handleTaskBoardShareTargetPost(request: Request) {
  const target = new URL("/compartilhar", resolvePublicOrigin(request))

  try {
    const formData = await request.formData()
    const staged = await stageServerShare(formData)

    target.searchParams.set("serverShare", staged.manifest.id)
    target.searchParams.set("serverFiles", String(staged.manifest.files.length))
    target.searchParams.set("receiver", staged.storedLocally && staged.storedRemotely
      ? "server-v218-dual"
      : staged.storedLocally
        ? "server-v218-disk"
        : "server-v218-supabase")

    const response = NextResponse.redirect(target, 303)
    response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate")
    response.headers.set("Pragma", "no-cache")
    return response
  } catch (error) {
    console.error("[TaskBoard/PWA Share V218] Falha ao receber compartilhamento externo", error)
    target.searchParams.set("erro", "recebimento-v218")
    target.searchParams.set("receiver", "server-v218-error")
    const response = NextResponse.redirect(target, 303)
    response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate")
    response.headers.set("Pragma", "no-cache")
    return response
  }
}
