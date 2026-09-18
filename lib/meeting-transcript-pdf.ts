export type MeetingTranscriptMessage = {
  id: string
  senderName: string
  createdAt: string
  content?: string
  messageType?: "text" | "audio" | "media"
  mediaName?: string
  mediaMimeType?: string
  editedAt?: string
  replyToLabel?: string
  reactions?: string
}

type TranscriptPdfInput = {
  meetingTitle: string
  startedAt: string
  endedAt: string
  messages: MeetingTranscriptMessage[]
}

type PdfLine = {
  text: string
  size?: number
  bold?: boolean
  gapAfter?: number
}

const PAGE_WIDTH = 595
const PAGE_HEIGHT = 842
const MARGIN_X = 48
const TOP_Y = 794
const BOTTOM_Y = 54
const DEFAULT_FONT_SIZE = 9.5
const DEFAULT_LINE_HEIGHT = 13
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2

function displayDate(value: string) {
  try {
    return new Date(value).toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
  } catch {
    return value
  }
}

function normalizePdfText(value: string) {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u00A0/g, " ")
    .replace(/[^\u0009\u000A\u0020-\u00FF]/g, "?")
}

function estimateMaxChars(size = DEFAULT_FONT_SIZE, indent = 0) {
  const usable = Math.max(120, CONTENT_WIDTH - indent)
  const averageGlyphWidth = Math.max(3.7, size * 0.48)
  return Math.max(28, Math.floor(usable / averageGlyphWidth))
}

function wrapParagraph(value: string, maxChars: number) {
  const text = normalizePdfText(value).trimEnd()
  if (!text) return [""]
  const words = text.split(/\s+/)
  const lines: string[] = []
  let current = ""
  for (const word of words) {
    if (!current) {
      if (word.length <= maxChars) {
        current = word
      } else {
        for (let i = 0; i < word.length; i += maxChars) lines.push(word.slice(i, i + maxChars))
      }
      continue
    }
    if ((current.length + 1 + word.length) <= maxChars) {
      current += ` ${word}`
      continue
    }
    lines.push(current)
    if (word.length <= maxChars) {
      current = word
    } else {
      for (let i = 0; i < word.length; i += maxChars) {
        const chunk = word.slice(i, i + maxChars)
        if (chunk.length === maxChars) lines.push(chunk)
        else current = chunk
      }
    }
  }
  if (current) lines.push(current)
  return lines.length ? lines : [""]
}

function wrapText(value: string, size = DEFAULT_FONT_SIZE, indent = 0) {
  const maxChars = estimateMaxChars(size, indent)
  const paragraphs = normalizePdfText(value).split("\n")
  const lines: string[] = []
  paragraphs.forEach((paragraph, index) => {
    lines.push(...wrapParagraph(paragraph, maxChars))
    if (index < paragraphs.length - 1) lines.push("")
  })
  return lines
}

function buildDocumentLines(input: TranscriptPdfInput) {
  const lines: PdfLine[] = []
  lines.push({ text: "TaskBoard - Chat da reuniao", size: 17, bold: true, gapAfter: 6 })
  lines.push({ text: normalizePdfText(input.meetingTitle || "Reuniao"), size: 12, bold: true, gapAfter: 4 })
  lines.push({ text: `Inicio: ${displayDate(input.startedAt)}`, size: 8.5 })
  lines.push({ text: `Fim: ${displayDate(input.endedAt)}`, size: 8.5 })
  lines.push({ text: `Mensagens registradas: ${input.messages.length}`, size: 8.5, gapAfter: 10 })

  if (!input.messages.length) {
    lines.push({ text: "Nenhuma mensagem foi enviada no chat durante esta reuniao.", size: 10 })
    return lines
  }

  input.messages.forEach((message, index) => {
    const stamp = displayDate(message.createdAt)
    lines.push({ text: `${message.senderName || "Usuario"} - ${stamp}`, size: 10, bold: true, gapAfter: 2 })
    if (message.replyToLabel) {
      wrapText(`Em resposta a: ${message.replyToLabel}`, 8.5, 10).forEach((text) => lines.push({ text, size: 8.5 }))
    }

    const content = message.content?.trim()
    if (content) {
      wrapText(content, 9.5).forEach((text) => lines.push({ text, size: 9.5 }))
    }

    if (message.messageType === "audio") {
      lines.push({ text: `[Audio${message.mediaName ? `: ${normalizePdfText(message.mediaName)}` : ""}]`, size: 8.8 })
    } else if (message.messageType === "media" || message.mediaName) {
      const mime = message.mediaMimeType ? ` - ${normalizePdfText(message.mediaMimeType)}` : ""
      lines.push({ text: `[Arquivo: ${normalizePdfText(message.mediaName || "anexo")}${mime}]`, size: 8.8 })
    }

    if (message.reactions) {
      lines.push({ text: `Reacoes: ${message.reactions}`, size: 8.2 })
    }
    if (message.editedAt) {
      lines.push({ text: `(editada em ${displayDate(message.editedAt)})`, size: 7.8 })
    }
    if (index < input.messages.length - 1) lines.push({ text: "", size: 5, gapAfter: 4 })
  })
  return lines
}

function paginate(lines: PdfLine[]) {
  const pages: PdfLine[][] = []
  let current: PdfLine[] = []
  let y = TOP_Y

  for (const line of lines) {
    const size = line.size ?? DEFAULT_FONT_SIZE
    const height = Math.max(DEFAULT_LINE_HEIGHT, size * 1.34) + (line.gapAfter ?? 0)
    if (current.length && y - height < BOTTOM_Y) {
      pages.push(current)
      current = []
      y = TOP_Y
    }
    current.push(line)
    y -= height
  }
  if (current.length || !pages.length) pages.push(current)
  return pages
}

function toWinAnsiChar(char: string) {
  const code = char.charCodeAt(0)
  if (code <= 255) return String.fromCharCode(code)
  const map: Record<number, number> = {
    0x20AC: 0x80,
    0x201A: 0x82,
    0x0192: 0x83,
    0x201E: 0x84,
    0x2026: 0x85,
    0x2020: 0x86,
    0x2021: 0x87,
    0x02C6: 0x88,
    0x2030: 0x89,
    0x0160: 0x8A,
    0x2039: 0x8B,
    0x0152: 0x8C,
    0x017D: 0x8E,
    0x2018: 0x91,
    0x2019: 0x92,
    0x201C: 0x93,
    0x201D: 0x94,
    0x2022: 0x95,
    0x2013: 0x96,
    0x2014: 0x97,
    0x02DC: 0x98,
    0x2122: 0x99,
    0x0161: 0x9A,
    0x203A: 0x9B,
    0x0153: 0x9C,
    0x017E: 0x9E,
    0x0178: 0x9F,
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
  for (let i = 0; i < value.length; i += 1) bytes[i] = value.charCodeAt(i) & 0xFF
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

function pageStream(lines: PdfLine[], pageNumber: number, pageCount: number) {
  let y = TOP_Y
  const chunks: string[] = ["BT\n"]
  for (const line of lines) {
    const size = line.size ?? DEFAULT_FONT_SIZE
    const font = line.bold ? "F2" : "F1"
    chunks.push(`/${font} ${size.toFixed(1)} Tf\n`)
    chunks.push(`1 0 0 1 ${MARGIN_X} ${y.toFixed(1)} Tm\n`)
    chunks.push(`(${pdfLiteral(line.text)}) Tj\n`)
    y -= Math.max(DEFAULT_LINE_HEIGHT, size * 1.34) + (line.gapAfter ?? 0)
  }
  chunks.push(`/F1 7.5 Tf\n1 0 0 1 ${MARGIN_X} 30 Tm\n(Pagina ${pageNumber} de ${pageCount}) Tj\n`)
  chunks.push("ET\n")
  return binaryBytes(chunks.join(""))
}

export function createMeetingTranscriptPdf(input: TranscriptPdfInput) {
  const pages = paginate(buildDocumentLines(input))
  const pageCount = pages.length
  const objectCount = 4 + pageCount * 2
  const objects = new Map<number, Uint8Array>()

  const pageRefs = pages.map((_, index) => `${5 + index * 2} 0 R`).join(" ")
  objects.set(1, binaryBytes("<< /Type /Catalog /Pages 2 0 R >>"))
  objects.set(2, binaryBytes(`<< /Type /Pages /Kids [${pageRefs}] /Count ${pageCount} >>`))
  objects.set(3, binaryBytes("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"))
  objects.set(4, binaryBytes("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"))

  pages.forEach((pageLines, index) => {
    const pageObject = 5 + index * 2
    const contentObject = pageObject + 1
    const stream = pageStream(pageLines, index + 1, pageCount)
    objects.set(pageObject, binaryBytes(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObject} 0 R >>`))
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
  for (let number = 1; number <= objectCount; number += 1) {
    xrefLines.push(`${String(offsets[number]).padStart(10, "0")} 00000 n \n`)
  }
  const trailer = `trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  parts.push(binaryBytes(xrefLines.join("")), binaryBytes(trailer))

  return new Blob(parts, { type: "application/pdf" })
}
