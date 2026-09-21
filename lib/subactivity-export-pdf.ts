export type SubactivityPdfAttachment = {
  id: string
  name: string
  mimeType?: string
  size?: number
  kind?: "image" | "pdf" | "text" | "document" | "video" | "audio" | "other"
  sourceUrl?: string
  textContent?: string
}

export type SubactivityPdfEntry = {
  id: string
  kind: "message" | "attachment" | "log" | "session"
  createdAt: string
  authorName?: string
  title?: string
  content?: string
  replyTo?: string
  durationLabel?: string
  attachments?: SubactivityPdfAttachment[]
}

export type SubactivityPdfInput = {
  projectName: string
  activityTitle: string
  subactivityNumber?: number
  subactivityTitle: string
  statusLabel: string
  assigneeName?: string
  trackedTime?: string
  estimatedTime?: string
  linkedOs?: string
  build?: string
  createdAt?: string
  exportedAt?: string
  notes?: Array<{ content: string; completed?: boolean }>
  entries: SubactivityPdfEntry[]
}

type PreparedImage = {
  key: string
  name: string
  bytes: Uint8Array
  width: number
  height: number
}

type PdfTextOp = {
  type: "text"
  text: string
  x: number
  y: number
  size: number
  bold?: boolean
  mono?: boolean
  gray?: number
}

type PdfLineOp = {
  type: "line"
  x1: number
  y1: number
  x2: number
  y2: number
  gray?: number
  width?: number
}

type PdfRectOp = {
  type: "rect"
  x: number
  y: number
  width: number
  height: number
  fillGray?: number
  strokeGray?: number
  lineWidth?: number
}

type PdfImageOp = {
  type: "image"
  imageKey: string
  x: number
  y: number
  width: number
  height: number
}

type PdfOp = PdfTextOp | PdfLineOp | PdfRectOp | PdfImageOp

type PdfPage = { ops: PdfOp[] }

const PAGE_WIDTH = 595
const PAGE_HEIGHT = 842
const MARGIN_X = 42
const TOP_Y = 796
const BOTTOM_Y = 54
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2
const MAX_INLINE_TEXT = 16_000

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function normalizePdfText(value: string) {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u00A0/g, " ")
    .replace(/[^\u0009\u000A\u0020-\u00FF]/g, "?")
}

function readableMessage(value: string) {
  return normalizePdfText(value)
    .replace(/^#{1,3}\s+/gm, "")
    .replace(/```(?:[a-z0-9_-]+)?\n?([\s\S]*?)```/gi, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|\s)\*([^*\n]+)\*(?=\s|$)/g, "$1$2")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, "$1 ($2)")
    .trim()
}

function displayDate(value?: string, withSeconds = false) {
  if (!value) return "-"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return normalizePdfText(value)
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    ...(withSeconds ? { second: "2-digit" as const } : {}),
  })
}

function formatBytes(bytes?: number) {
  if (!bytes || bytes <= 0) return ""
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function attachmentKindLabel(attachment: SubactivityPdfAttachment) {
  if (attachment.kind === "image") return "Imagem"
  if (attachment.kind === "video") return "Video"
  if (attachment.kind === "audio") return "Audio"
  if (attachment.kind === "pdf") return "PDF"
  if (attachment.kind === "text") return "Arquivo de texto"
  if (attachment.kind === "document") return "Documento"
  return "Anexo"
}

function entryKindLabel(kind: SubactivityPdfEntry["kind"]) {
  if (kind === "message") return "MENSAGEM"
  if (kind === "attachment") return "ANEXO"
  if (kind === "session") return "TRABALHO"
  return "REGISTRO"
}

function estimateCharWidth(size: number, mono = false) {
  return size * (mono ? 0.6 : 0.49)
}

function breakLongWord(word: string, maxChars: number) {
  const output: string[] = []
  for (let index = 0; index < word.length; index += maxChars) output.push(word.slice(index, index + maxChars))
  return output
}

function wrapText(value: string, width: number, size: number, mono = false) {
  const clean = normalizePdfText(value)
  const maxChars = Math.max(12, Math.floor(width / Math.max(3.5, estimateCharWidth(size, mono))))
  const lines: string[] = []
  const paragraphs = clean.split("\n")

  paragraphs.forEach((paragraph, paragraphIndex) => {
    if (!paragraph) {
      lines.push("")
      return
    }
    const words = paragraph.split(/\s+/).filter(Boolean)
    let current = ""
    for (const word of words) {
      if (word.length > maxChars) {
        if (current) {
          lines.push(current)
          current = ""
        }
        const chunks = breakLongWord(word, maxChars)
        lines.push(...chunks.slice(0, -1))
        current = chunks.at(-1) ?? ""
        continue
      }
      if (!current) {
        current = word
      } else if (current.length + 1 + word.length <= maxChars) {
        current += ` ${word}`
      } else {
        lines.push(current)
        current = word
      }
    }
    if (current) lines.push(current)
    if (paragraphIndex < paragraphs.length - 1 && paragraph) lines.push("")
  })

  return lines.length ? lines : [""]
}

async function blobToImageElement(blob: Blob) {
  const url = URL.createObjectURL(blob)
  try {
    const image = new Image()
    image.decoding = "async"
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error("Não foi possível abrir a imagem do anexo."))
      image.src = url
    })
    return image
  } finally {
    // The image keeps decoded pixels after load, so the object URL is no longer needed.
    URL.revokeObjectURL(url)
  }
}

async function canvasToJpeg(canvas: HTMLCanvasElement, quality = 0.82) {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality))
  if (!blob) throw new Error("Não foi possível preparar uma imagem para o PDF.")
  return new Uint8Array(await blob.arrayBuffer())
}

async function prepareImage(attachment: SubactivityPdfAttachment): Promise<PreparedImage | null> {
  if (attachment.kind !== "image" || !attachment.sourceUrl || typeof document === "undefined") return null
  try {
    const response = await fetch(attachment.sourceUrl)
    if (!response.ok) return null
    const blob = await response.blob()
    const image = await blobToImageElement(blob)
    const sourceWidth = image.naturalWidth || image.width
    const sourceHeight = image.naturalHeight || image.height
    if (!sourceWidth || !sourceHeight) return null

    const maxSide = 1280
    const scale = Math.min(1, maxSide / Math.max(sourceWidth, sourceHeight))
    const width = Math.max(1, Math.round(sourceWidth * scale))
    const height = Math.max(1, Math.round(sourceHeight * scale))
    const canvas = document.createElement("canvas")
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext("2d", { willReadFrequently: true })
    if (!ctx) return null
    ctx.fillStyle = "#fff"
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(image, 0, 0, width, height)

    // Exportação A4 foi pedida em preto e branco. Converter pixels deixa o
    // resultado consistente entre Chrome desktop, Android e PWA.
    try {
      const pixels = ctx.getImageData(0, 0, width, height)
      const data = pixels.data
      for (let index = 0; index < data.length; index += 4) {
        const gray = Math.round(data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114)
        data[index] = gray
        data[index + 1] = gray
        data[index + 2] = gray
      }
      ctx.putImageData(pixels, 0, 0)
    } catch {
      // Canvas ainda pode ser exportado normalmente caso o navegador limite getImageData.
    }

    return {
      key: attachment.id,
      name: attachment.name,
      bytes: await canvasToJpeg(canvas),
      width,
      height,
    }
  } catch {
    return null
  }
}

function toWinAnsiChar(char: string) {
  const code = char.charCodeAt(0)
  if (code <= 255) return String.fromCharCode(code)
  const map: Record<number, number> = {
    0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85,
    0x2020: 0x86, 0x2021: 0x87, 0x02C6: 0x88, 0x2030: 0x89, 0x0160: 0x8A,
    0x2039: 0x8B, 0x0152: 0x8C, 0x017D: 0x8E, 0x2018: 0x91, 0x2019: 0x92,
    0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
    0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B, 0x0153: 0x9C,
    0x017E: 0x9E, 0x0178: 0x9F,
  }
  return String.fromCharCode(map[code] ?? 0x3F)
}

function pdfLiteral(value: string) {
  let output = ""
  for (const char of normalizePdfText(value)) {
    const encoded = toWinAnsiChar(char)
    const code = encoded.charCodeAt(0)
    if (code === 0x5C || code === 0x28 || code === 0x29) output += `\\${encoded}`
    else if (code < 0x20 && code !== 0x09) output += " "
    else output += encoded
  }
  return output
}

function binaryBytes(value: string) {
  const bytes = new Uint8Array(value.length)
  for (let index = 0; index < value.length; index += 1) bytes[index] = value.charCodeAt(index) & 0xFF
  return bytes
}

function concatBytes(parts: Uint8Array[]) {
  const length = parts.reduce((sum, part) => sum + part.length, 0)
  const output = new Uint8Array(length)
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.length
  }
  return output
}

function pdfNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.00$/, "")
}

function buildPdf(input: SubactivityPdfInput, images: Map<string, PreparedImage>) {
  const pages: PdfPage[] = [{ ops: [] }]
  let pageIndex = 0
  let y = TOP_Y

  const currentPage = () => pages[pageIndex]
  const addOp = (op: PdfOp) => currentPage().ops.push(op)

  const addContinuationHeader = () => {
    addOp({ type: "text", text: "TaskBoard - Historico da subatividade", x: MARGIN_X, y: 805, size: 8, bold: true, gray: 0.35 })
    addOp({ type: "text", text: normalizePdfText(`${input.projectName} / ${input.activityTitle}`), x: MARGIN_X, y: 792, size: 7.5, gray: 0.45 })
    addOp({ type: "line", x1: MARGIN_X, y1: 782, x2: PAGE_WIDTH - MARGIN_X, y2: 782, gray: 0.82, width: 0.6 })
    y = 765
  }

  const newPage = () => {
    pages.push({ ops: [] })
    pageIndex += 1
    addContinuationHeader()
  }

  const ensureSpace = (height: number) => {
    if (y - height >= BOTTOM_Y) return
    newPage()
  }

  const addText = (text: string, options: { x?: number; width?: number; size?: number; bold?: boolean; mono?: boolean; gray?: number; lineHeight?: number; gapAfter?: number } = {}) => {
    const x = options.x ?? MARGIN_X
    const width = options.width ?? (PAGE_WIDTH - MARGIN_X - x)
    const size = options.size ?? 9.5
    const lineHeight = options.lineHeight ?? Math.max(11.5, size * 1.36)
    const lines = wrapText(text, width, size, options.mono)
    for (const line of lines) {
      ensureSpace(lineHeight)
      addOp({ type: "text", text: line, x, y, size, bold: options.bold, mono: options.mono, gray: options.gray })
      y -= lineHeight
    }
    y -= options.gapAfter ?? 0
  }

  const addSeparator = (gapTop = 3, gapBottom = 8) => {
    y -= gapTop
    ensureSpace(gapBottom + 2)
    addOp({ type: "line", x1: MARGIN_X, y1: y, x2: PAGE_WIDTH - MARGIN_X, y2: y, gray: 0.86, width: 0.55 })
    y -= gapBottom
  }

  const addAttachment = (attachment: SubactivityPdfAttachment) => {
    const details = [attachmentKindLabel(attachment), attachment.mimeType, formatBytes(attachment.size)].filter(Boolean).join(" - ")
    addText(attachment.name || "Anexo", { size: 8.8, bold: true, gapAfter: 1 })
    if (details) addText(details, { size: 7.5, gray: 0.45, gapAfter: 3 })

    const image = images.get(attachment.id)
    if (image) {
      const maxWidth = CONTENT_WIDTH
      const maxHeight = 315
      const scale = Math.min(maxWidth / image.width, maxHeight / image.height, 1)
      const drawWidth = Math.max(40, image.width * scale)
      const drawHeight = Math.max(30, image.height * scale)
      ensureSpace(drawHeight + 12)
      addOp({ type: "rect", x: MARGIN_X, y: y - drawHeight, width: drawWidth, height: drawHeight, strokeGray: 0.78, lineWidth: 0.55 })
      addOp({ type: "image", imageKey: image.key, x: MARGIN_X, y: y - drawHeight, width: drawWidth, height: drawHeight })
      y -= drawHeight + 8
      return
    }

    const textContent = attachment.textContent?.trim()
    if (textContent) {
      const full = normalizePdfText(textContent)
      const truncated = full.length > MAX_INLINE_TEXT
      const visible = truncated ? `${full.slice(0, MAX_INLINE_TEXT)}\n\n[Conteudo abreviado para manter o PDF legivel.]` : full
      addText("Conteudo do arquivo:", { size: 7.4, bold: true, gray: 0.42, gapAfter: 2 })
      addText(visible, { x: MARGIN_X + 8, width: CONTENT_WIDTH - 8, size: 7.2, mono: true, gray: 0.16, lineHeight: 9.4, gapAfter: 5 })
    }
  }

  // Capa/cabecalho da primeira pagina.
  addOp({ type: "text", text: "TASKBOARD", x: MARGIN_X, y, size: 8.5, bold: true, gray: 0.28 })
  y -= 18
  addText("Historico da subatividade", { size: 18, bold: true, lineHeight: 22, gapAfter: 1 })
  const numberedTitle = `${input.subactivityNumber ? `${input.subactivityNumber}. ` : ""}${input.subactivityTitle}`
  addText(numberedTitle, { size: 12.5, bold: true, lineHeight: 16, gapAfter: 2 })
  addText(`${input.projectName} / ${input.activityTitle}`, { size: 9, gray: 0.32, gapAfter: 9 })
  addSeparator(0, 10)

  const metaRows = [
    ["Status", input.statusLabel],
    ["Responsavel", input.assigneeName || "Nao informado"],
    ["Tempo trabalhado", input.trackedTime || "00:00:00"],
    ["Estimativa", input.estimatedTime || "-"],
    ["O.S.", input.linkedOs || "-"],
    ["Versao/Build", input.build || "-"],
    ["Criada em", displayDate(input.createdAt)],
    ["Exportado em", displayDate(input.exportedAt || new Date().toISOString())],
  ]
  for (let index = 0; index < metaRows.length; index += 2) {
    ensureSpace(24)
    const left = metaRows[index]
    const right = metaRows[index + 1]
    const colWidth = (CONTENT_WIDTH - 18) / 2
    addOp({ type: "text", text: left[0], x: MARGIN_X, y, size: 6.8, bold: true, gray: 0.48 })
    addOp({ type: "text", text: normalizePdfText(left[1]), x: MARGIN_X, y: y - 11, size: 8.6, gray: 0.08 })
    if (right) {
      const rightX = MARGIN_X + colWidth + 18
      addOp({ type: "text", text: right[0], x: rightX, y, size: 6.8, bold: true, gray: 0.48 })
      addOp({ type: "text", text: normalizePdfText(right[1]), x: rightX, y: y - 11, size: 8.6, gray: 0.08 })
    }
    y -= 27
  }

  addSeparator(2, 11)

  if (input.notes?.length) {
    addText(`Anotacoes (${input.notes.length})`, { size: 11.5, bold: true, gapAfter: 6 })
    for (const note of input.notes) {
      addText(`${note.completed ? "[x]" : "[ ]"} ${note.content}`, { x: MARGIN_X + 4, width: CONTENT_WIDTH - 4, size: 8.8, gray: note.completed ? 0.42 : 0.12, lineHeight: 11.5, gapAfter: 2 })
    }
    addSeparator(4, 11)
  }

  addText(`Historico (${input.entries.length} ${input.entries.length === 1 ? "registro" : "registros"})`, { size: 11.5, bold: true, gapAfter: 8 })

  if (!input.entries.length) {
    addText("Nenhuma mensagem, anexo ou registro foi encontrado nesta subatividade.", { size: 9.5, gray: 0.35 })
  }

  for (const entry of input.entries) {
    ensureSpace(42)
    const stamp = displayDate(entry.createdAt, false)
    const author = entry.authorName?.trim() || "Sistema"
    addOp({ type: "text", text: entryKindLabel(entry.kind), x: MARGIN_X, y, size: 6.8, bold: true, gray: 0.42 })
    addOp({ type: "text", text: normalizePdfText(`${author} - ${stamp}`), x: MARGIN_X + 73, y, size: 7.6, gray: 0.38 })
    y -= 15

    if (entry.title?.trim()) addText(entry.title.trim(), { size: 9.6, bold: true, gapAfter: 2 })
    if (entry.replyTo?.trim()) addText(`Em resposta a: ${entry.replyTo.trim()}`, { x: MARGIN_X + 10, width: CONTENT_WIDTH - 10, size: 7.7, gray: 0.45, gapAfter: 2 })
    if (entry.content?.trim()) addText(readableMessage(entry.content), { size: 9.2, lineHeight: 12.4, gapAfter: 4 })
    if (entry.durationLabel) addText(entry.durationLabel, { size: 8.4, gray: 0.28, gapAfter: 3 })

    for (const attachment of entry.attachments ?? []) addAttachment(attachment)
    addSeparator(2, 9)
  }

  pages.forEach((page, index) => {
    page.ops.push({ type: "text", text: `Pagina ${index + 1} de ${pages.length}`, x: PAGE_WIDTH - MARGIN_X - 64, y: 28, size: 7.2, gray: 0.45 })
    page.ops.push({ type: "text", text: "TaskBoard", x: MARGIN_X, y: 28, size: 7.2, bold: true, gray: 0.45 })
  })

  const imageList = Array.from(images.values())
  const imageObjectByKey = new Map<string, number>()
  const pageStartObject = 6 + imageList.length
  imageList.forEach((image, index) => imageObjectByKey.set(image.key, 6 + index))
  const objectCount = 5 + imageList.length + pages.length * 2
  const objects = new Map<number, Uint8Array>()

  const pageRefs = pages.map((_, index) => `${pageStartObject + index * 2} 0 R`).join(" ")
  objects.set(1, binaryBytes("<< /Type /Catalog /Pages 2 0 R >>"))
  objects.set(2, binaryBytes(`<< /Type /Pages /Kids [${pageRefs}] /Count ${pages.length} >>`))
  objects.set(3, binaryBytes("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"))
  objects.set(4, binaryBytes("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"))
  objects.set(5, binaryBytes("<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>"))

  imageList.forEach((image) => {
    const objectNumber = imageObjectByKey.get(image.key)!
    objects.set(objectNumber, concatBytes([
      binaryBytes(`<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.bytes.length} >>\nstream\n`),
      image.bytes,
      binaryBytes("\nendstream"),
    ]))
  })

  function pageStream(page: PdfPage) {
    const chunks: Uint8Array[] = []
    const push = (value: string) => chunks.push(binaryBytes(value))
    for (const op of page.ops) {
      if (op.type === "text") {
        const font = op.mono ? "F3" : op.bold ? "F2" : "F1"
        push(`BT\n${pdfNumber(clamp(op.gray ?? 0, 0, 1))} g\n/${font} ${pdfNumber(op.size)} Tf\n1 0 0 1 ${pdfNumber(op.x)} ${pdfNumber(op.y)} Tm\n(${pdfLiteral(op.text)}) Tj\nET\n`)
      } else if (op.type === "line") {
        push(`${pdfNumber(clamp(op.gray ?? 0.8, 0, 1))} G\n${pdfNumber(op.width ?? 0.5)} w\n${pdfNumber(op.x1)} ${pdfNumber(op.y1)} m\n${pdfNumber(op.x2)} ${pdfNumber(op.y2)} l\nS\n`)
      } else if (op.type === "rect") {
        const hasFill = typeof op.fillGray === "number"
        const hasStroke = typeof op.strokeGray === "number"
        if (hasFill) push(`${pdfNumber(clamp(op.fillGray!, 0, 1))} g\n`)
        if (hasStroke) push(`${pdfNumber(clamp(op.strokeGray!, 0, 1))} G\n${pdfNumber(op.lineWidth ?? 0.5)} w\n`)
        push(`${pdfNumber(op.x)} ${pdfNumber(op.y)} ${pdfNumber(op.width)} ${pdfNumber(op.height)} re\n${hasFill && hasStroke ? "B" : hasFill ? "f" : "S"}\n`)
      } else {
        const objectNumber = imageObjectByKey.get(op.imageKey)
        if (!objectNumber) continue
        const resourceName = `Im${objectNumber}`
        push(`q\n${pdfNumber(op.width)} 0 0 ${pdfNumber(op.height)} ${pdfNumber(op.x)} ${pdfNumber(op.y)} cm\n/${resourceName} Do\nQ\n`)
      }
    }
    return concatBytes(chunks)
  }

  pages.forEach((page, index) => {
    const pageObject = pageStartObject + index * 2
    const contentObject = pageObject + 1
    const usedImageObjects = Array.from(new Set(page.ops
      .filter((op): op is PdfImageOp => op.type === "image")
      .map((op) => imageObjectByKey.get(op.imageKey))
      .filter((value): value is number => Boolean(value))))
    const xObjects = usedImageObjects.length
      ? `/XObject << ${usedImageObjects.map((objectNumber) => `/Im${objectNumber} ${objectNumber} 0 R`).join(" ")} >> `
      : ""
    const stream = pageStream(page)
    objects.set(pageObject, binaryBytes(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> ${xObjects}>> /Contents ${contentObject} 0 R >>`))
    objects.set(contentObject, concatBytes([
      binaryBytes(`<< /Length ${stream.length} >>\nstream\n`),
      stream,
      binaryBytes("endstream"),
    ]))
  })

  const header = binaryBytes("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n")
  const parts: Uint8Array[] = [header]
  const offsets = new Array<number>(objectCount + 1).fill(0)
  let offset = header.length
  for (let number = 1; number <= objectCount; number += 1) {
    offsets[number] = offset
    const prefix = binaryBytes(`${number} 0 obj\n`)
    const body = objects.get(number) ?? binaryBytes("<< >>")
    const suffix = binaryBytes("\nendobj\n")
    parts.push(prefix, body, suffix)
    offset += prefix.length + body.length + suffix.length
  }

  const xrefOffset = offset
  const xrefLines = [`xref\n0 ${objectCount + 1}\n`, "0000000000 65535 f \n"]
  for (let number = 1; number <= objectCount; number += 1) xrefLines.push(`${String(offsets[number]).padStart(10, "0")} 00000 n \n`)
  parts.push(binaryBytes(xrefLines.join("")), binaryBytes(`trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`))

  return new Blob(parts, { type: "application/pdf" })
}

export async function createSubactivityHistoryPdf(input: SubactivityPdfInput) {
  const imageAttachments = input.entries.flatMap((entry) => entry.attachments ?? []).filter((attachment) => attachment.kind === "image" && attachment.sourceUrl)
  const prepared = await Promise.all(imageAttachments.map((attachment) => prepareImage(attachment)))
  const images = new Map<string, PreparedImage>()
  for (const image of prepared) if (image) images.set(image.key, image)
  return buildPdf(input, images)
}

export function downloadPdfBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1500)
}

export function safePdfFileName(value: string) {
  const clean = normalizePdfText(value)
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 90)
  return `${clean || "subatividade"}.pdf`
}
