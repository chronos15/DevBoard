import { NextResponse } from "next/server"
import { stageServerShare, collectSharedFiles } from "@/lib/server-share-inbox"

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

function stringValue(formData: FormData, name: string) {
  const value = formData.get(name)
  return typeof value === "string" ? value.trim() : ""
}

function describeFormData(formData: FormData) {
  const entries: Array<{ field: string; kind: "text" | "file"; name?: string; type?: string; size?: number }> = []
  for (const [field, value] of formData.entries()) {
    if (typeof value === "string") {
      entries.push({ field, kind: "text", size: value.length })
    } else {
      entries.push({
        field,
        kind: "file",
        name: value.name || "",
        type: value.type || "",
        size: value.size,
      })
    }
  }
  return entries
}

export async function handleTaskBoardShareTargetPost(request: Request) {
  const target = new URL("/compartilhar", resolvePublicOrigin(request))
  const contentType = request.headers.get("content-type")
  const contentLength = request.headers.get("content-length") || ""
  const userAgent = request.headers.get("user-agent") || ""

  try {
    if (!contentType?.toLowerCase().includes("multipart/form-data")) {
      throw new Error(`Tipo de conteúdo inesperado no Web Share Target: ${contentType || "ausente"}`)
    }

    // V224: usa o parser multipart nativo da Fetch API/Node/Next.
    // O parser artesanal V219 foi removido do fluxo porque os logs de produção
    // provaram que o boundary chegava, mas nenhuma parte era reconhecida.
    const formData = await request.formData()
    const files = collectSharedFiles(formData)
    const title = stringValue(formData, "title")
    const text = stringValue(formData, "text")
    const url = stringValue(formData, "url")

    if (files.length === 0 && !title && !text && !url) {
      console.error("[TaskBoard/PWA Share V224] POST multipart recebido sem conteúdo utilizável", {
        contentType,
        contentLength,
        url: request.url,
        userAgent,
        entries: describeFormData(formData),
      })
      throw new Error("O Android abriu o TaskBoard, mas o multipart nativo não contém arquivo, texto ou link.")
    }

    const staged = await stageServerShare(formData)

    target.searchParams.set("serverShare", staged.manifest.id)
    target.searchParams.set("serverFiles", String(staged.manifest.files.length))
    target.searchParams.set("receiver", staged.storedLocally && staged.storedRemotely
      ? "server-v223-native-dual"
      : staged.storedLocally
        ? "server-v223-native-disk"
        : "server-v223-native-supabase")

    const response = NextResponse.redirect(target, 303)
    response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate")
    response.headers.set("Pragma", "no-cache")
    response.headers.set("X-TaskBoard-Share-Receiver", "V224-native-formdata")
    response.headers.set("X-TaskBoard-Share-Files", String(staged.manifest.files.length))
    return response
  } catch (error) {
    console.error("[TaskBoard/PWA Share V224] Falha ao receber compartilhamento externo", {
      contentType,
      contentLength,
      url: request.url,
      userAgent,
      error,
    })

    const message = error instanceof Error ? error.message : String(error || "")
    const lower = message.toLowerCase()
    const reason = !contentType?.toLowerCase().includes("multipart/form-data")
      ? "tipo-invalido"
      : lower.includes("formdata") || lower.includes("multipart") || lower.includes("boundary")
        ? "multipart"
        : lower.includes("excede") || lower.includes("limit")
          ? "limite"
          : "persistencia"

    target.searchParams.set("erro", "recebimento-v223")
    target.searchParams.set("motivo", reason)
    if (contentLength) target.searchParams.set("bytes", contentLength.slice(0, 24))
    target.searchParams.set("tipo", shortContentType(contentType))
    target.searchParams.set("receiver", "server-v223-error")

    const response = NextResponse.redirect(target, 303)
    response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate")
    response.headers.set("Pragma", "no-cache")
    response.headers.set("X-TaskBoard-Share-Receiver", "V224-error")
    return response
  }
}
