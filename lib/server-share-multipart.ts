const HEADER_SEPARATOR = Buffer.from("\r\n\r\n")
const CRLF = Buffer.from("\r\n")
const MAX_RAW_SHARE_BYTES = 320 * 1024 * 1024

function extractBoundary(contentType: string) {
  const match = contentType.match(/boundary=(?:"([^"]+)"|([^;\s]+))/i)
  return (match?.[1] || match?.[2] || "").trim()
}

function parseContentDisposition(value: string) {
  const nameMatch = value.match(/(?:^|;)\s*name="([^"]*)"/i)
  const filenameStar = value.match(/(?:^|;)\s*filename\*=UTF-8''([^;]+)/i)
  const filenameMatch = value.match(/(?:^|;)\s*filename="([^"]*)"/i)

  let filename: string | null = null
  if (filenameStar?.[1]) {
    try {
      filename = decodeURIComponent(filenameStar[1])
    } catch {
      filename = filenameStar[1]
    }
  } else if (filenameMatch) {
    filename = filenameMatch[1]
  }

  return {
    name: nameMatch?.[1] || "",
    filename,
    hasFilename: Boolean(filenameStar || filenameMatch),
  }
}

function parseHeaders(raw: Buffer) {
  const headers = new Map<string, string>()
  const text = raw.toString("utf8")
  for (const line of text.split("\r\n")) {
    const colon = line.indexOf(":")
    if (colon <= 0) continue
    headers.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim())
  }
  return headers
}

function trimPartEnvelope(part: Buffer) {
  // A parte começa logo após --boundary e, por especificação, inicia com CRLF.
  // O CRLF anterior ao próximo boundary não entra no recorte, então nenhum byte
  // do final do arquivo precisa ser removido.
  return part.subarray(part.subarray(0, 2).equals(CRLF) ? 2 : 0)
}

function appendPart(formData: FormData, part: Buffer, fallbackIndex: number) {
  const clean = trimPartEnvelope(part)
  if (!clean.length) return false

  const headerEnd = clean.indexOf(HEADER_SEPARATOR)
  if (headerEnd < 0) return false

  const headers = parseHeaders(clean.subarray(0, headerEnd))
  const disposition = headers.get("content-disposition") || ""
  if (!/form-data/i.test(disposition)) return false

  const { name, filename, hasFilename } = parseContentDisposition(disposition)
  if (!name) return false

  const body = clean.subarray(headerEnd + HEADER_SEPARATOR.length)
  const type = headers.get("content-type") || ""
  const looksBinary = hasFilename || Boolean(type && !/^text\//i.test(type))

  if (looksBinary) {
    const fileName = filename?.trim() || `arquivo-compartilhado-${fallbackIndex + 1}`
    formData.append(name, new File([body], fileName, {
      type: type || "application/octet-stream",
      lastModified: Date.now(),
    }))
  } else {
    formData.append(name, body.toString("utf8"))
  }
  return true
}

export type RawMultipartResult = {
  formData: FormData
  rawBytes: number
  declaredBytes: number | null
  partCount: number
  fileCount: number
}

export async function parseTaskBoardShareMultipart(request: Request): Promise<RawMultipartResult> {
  const contentType = request.headers.get("content-type") || ""
  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    throw new Error(`Tipo de conteúdo inesperado no Web Share Target: ${contentType || "ausente"}`)
  }

  const boundary = extractBoundary(contentType)
  if (!boundary) throw new Error("Multipart sem boundary.")

  const declaredRaw = request.headers.get("content-length")
  const declaredBytes = declaredRaw && /^\d+$/.test(declaredRaw) ? Number(declaredRaw) : null
  if (declaredBytes !== null && declaredBytes > MAX_RAW_SHARE_BYTES) {
    throw new Error("O compartilhamento excede o limite temporário de 320 MB do receptor.")
  }

  const raw = Buffer.from(await request.arrayBuffer())
  if (raw.length > MAX_RAW_SHARE_BYTES) {
    throw new Error("O compartilhamento excede o limite temporário de 320 MB do receptor.")
  }

  if (declaredBytes !== null && raw.length < declaredBytes) {
    throw new Error(`Multipart incompleto: esperado ${declaredBytes} bytes, recebido ${raw.length}.`)
  }
  if (raw.length === 0) throw new Error("Multipart vazio: nenhum byte foi recebido.")

  const marker = Buffer.from(`--${boundary}`)
  const delimiter = Buffer.from(`\r\n--${boundary}`)
  const formData = new FormData()
  let cursor = raw.indexOf(marker)
  let partCount = 0
  let fileCount = 0
  let fallbackIndex = 0

  if (cursor < 0) throw new Error("Multipart inválido: boundary inicial não encontrado.")

  while (cursor < raw.length) {
    const markerStart = cursor
    const afterMarker = markerStart + marker.length

    // marcador final: --boundary--
    if (raw.subarray(afterMarker, afterMarker + 2).toString("ascii") === "--") break

    const nextDelimiter = raw.indexOf(delimiter, afterMarker)
    if (nextDelimiter < 0) throw new Error("Multipart incompleto: boundary final não encontrado.")

    const part = raw.subarray(afterMarker, nextDelimiter)
    const beforeFiles = Array.from(formData.values()).filter((value) => typeof value !== "string").length
    if (appendPart(formData, part, fallbackIndex)) {
      partCount += 1
      const afterFiles = Array.from(formData.values()).filter((value) => typeof value !== "string").length
      if (afterFiles > beforeFiles) {
        fileCount += afterFiles - beforeFiles
        fallbackIndex += afterFiles - beforeFiles
      }
    }
    cursor = nextDelimiter + CRLF.length
  }

  if (partCount === 0) throw new Error("Multipart inválido: nenhuma parte form-data foi encontrada.")

  return { formData, rawBytes: raw.length, declaredBytes, partCount, fileCount }
}
