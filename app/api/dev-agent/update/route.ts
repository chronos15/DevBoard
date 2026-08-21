import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { NextResponse } from "next/server"
import { DEVBOARD_AGENT_VERSION } from "@/lib/developer/agent-version"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const TEMPLATE_URL = "/api/dev-agent/update/binary"

export async function GET() {
  try {
    // Este binário é o template genérico: não contém token, segredo ou dados do usuário.
    // O Agent mantém sua configuração local ao aplicar a atualização.
    const templatePath = path.join(process.cwd(), "public", "downloads", "devboard-agent-setup-template.exe")
    const template = await readFile(templatePath)
    const sha256 = createHash("sha256").update(template).digest("hex")

    return NextResponse.json(
      {
        version: DEVBOARD_AGENT_VERSION,
        download_url: TEMPLATE_URL,
        sha256,
        size: template.length,
      },
      {
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      },
    )
  } catch (error) {
    console.error("Falha ao montar manifesto de atualização do Devboard Agent", error)
    return NextResponse.json({ error: "Atualização do Agent indisponível." }, { status: 503 })
  }
}
