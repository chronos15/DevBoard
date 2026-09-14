import type { AttachmentKind } from "@/lib/types"

const TEXT_EXTENSIONS = new Set([
  "txt", "sql", "md", "markdown", "json", "xml", "csv", "log", "yaml", "yml", "toml", "ini", "env", "conf", "config",
  "js", "mjs", "cjs", "ts", "tsx", "jsx", "css", "scss", "sass", "less", "html", "htm", "vue", "svelte",
  "dart", "pas", "pp", "py", "rb", "php", "java", "kt", "kts", "go", "rs", "c", "cc", "cpp", "cxx", "h", "hh", "hpp", "cs",
  "sh", "bash", "zsh", "fish", "ps1", "bat", "cmd", "properties", "gradle", "dockerfile", "gitignore",
])

const DOCUMENT_EXTENSIONS = new Set([
  "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp", "rtf",
])

export function attachmentExtension(name?: string) {
  if (!name) return ""
  const clean = name.split(/[?#]/, 1)[0] ?? name
  const index = clean.lastIndexOf(".")
  return index >= 0 ? clean.slice(index + 1).toLowerCase() : ""
}

export function inferAttachmentKind({
  name,
  mimeType,
  kind,
}: {
  name?: string
  mimeType?: string
  kind?: AttachmentKind
}): AttachmentKind {
  const mime = (mimeType ?? "").toLowerCase()
  const ext = attachmentExtension(name)

  if (mime.startsWith("image/")) return "image"
  if (mime.startsWith("video/")) return "video"
  if (mime.startsWith("audio/")) return "audio"
  if (mime === "application/pdf" || ext === "pdf") return "pdf"
  if (mime.startsWith("text/") || TEXT_EXTENSIONS.has(ext)) return "text"
  if (DOCUMENT_EXTENSIONS.has(ext) || /officedocument|msword|ms-excel|ms-powerpoint/.test(mime)) return "document"

  if (kind && kind !== "other") return kind
  return "other"
}

export function isTextPreviewable(input: { name?: string; mimeType?: string; kind?: AttachmentKind }) {
  return inferAttachmentKind(input) === "text"
}
