import { readFile } from "node:fs/promises"
import path from "node:path"
import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    // Binário genérico do Agent. Não contém agent_id, segredo, sessão ou dados do usuário.
    // A configuração individual é reaplicada pelo updater local depois da validação SHA-256.
    const templatePath = path.join(process.cwd(), "public", "downloads", "devboard-agent-setup-template.exe")
    const template = await readFile(templatePath)

    return new NextResponse(template, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.microsoft.portable-executable",
        "Content-Disposition": 'inline; filename="DevboardAgentUpdate.exe"',
        "Cache-Control": "public, no-store, max-age=0, must-revalidate",
        "Content-Length": String(template.length),
        "X-Content-Type-Options": "nosniff",
      },
    })
  } catch (error) {
    console.error("Falha ao servir binário de atualização do Devboard Agent", error)
    return NextResponse.json({ error: "Binário de atualização indisponível." }, { status: 503 })
  }
}
