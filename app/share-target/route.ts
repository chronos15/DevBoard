import { NextResponse } from "next/server"

export async function POST(request: Request) {
  // Normalmente este POST é interceptado pelo service worker, que preserva os
  // arquivos localmente no aparelho antes de abrir /compartilhar. Este handler
  // é apenas um fallback amigável para instalações antigas ainda não controladas
  // pelo service worker atualizado.
  const target = new URL("/compartilhar", request.url)
  target.searchParams.set("fallback", "1")

  try {
    const formData = await request.formData()
    const title = String(formData.get("title") || "").trim()
    const text = String(formData.get("text") || "").trim()
    const url = String(formData.get("url") || "").trim()
    const fileNames = formData.getAll("files")
      .filter((entry): entry is File => entry instanceof File && entry.size > 0)
      .map((file) => file.name)
      .slice(0, 5)

    if (title) target.searchParams.set("title", title.slice(0, 300))
    if (text) target.searchParams.set("text", text.slice(0, 4000))
    if (url) target.searchParams.set("url", url.slice(0, 2000))
    if (fileNames.length) target.searchParams.set("files", fileNames.join("|"))
  } catch {
    // O redirect continua útil mesmo se o navegador não permitir reler o POST.
  }

  return NextResponse.redirect(target, 303)
}
