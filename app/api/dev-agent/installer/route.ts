import { readFile } from "node:fs/promises"
import path from "node:path"
import { NextResponse, type NextRequest } from "next/server"
import { createClient } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const AGENT_VERSION = "0.2.0"
const CONFIG_MARKER = "\nDEVBOARD_AGENT_CONFIG_V1\n"

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: userData, error: userError } = await supabase.auth.getUser()
    if (userError || !userData.user) {
      return NextResponse.json({ error: "Sessão inválida." }, { status: 401 })
    }

    const { data: membership, error: membershipError } = await supabase
      .from("workspace_members")
      .select("role")
      .eq("user_id", userData.user.id)
      .eq("active", true)
      .eq("role", "developer")
      .limit(1)
      .maybeSingle()

    if (membershipError || !membership) {
      return NextResponse.json({ error: "O Devboard Agent é exclusivo para a role developer." }, { status: 403 })
    }

    const { data: registration, error: registrationError } = await supabase.rpc("register_developer_agent")
    if (registrationError) {
      return NextResponse.json(
        { error: "Backend do Devboard Agent ainda não está preparado. Execute a migration 018." },
        { status: 503 },
      )
    }

    const row = Array.isArray(registration) ? registration[0] : registration
    if (!row?.agent_id || !row?.agent_secret) {
      return NextResponse.json({ error: "Não foi possível registrar esta instalação." }, { status: 500 })
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json({ error: "Supabase não configurado no servidor." }, { status: 500 })
    }

    const templatePath = path.join(process.cwd(), "public", "downloads", "devboard-agent-setup-template.exe")
    const template = await readFile(templatePath)
    const config = Buffer.from(
      JSON.stringify({
        agent_id: row.agent_id,
        agent_secret: row.agent_secret,
        app_url: request.nextUrl.origin,
        supabase_url: supabaseUrl,
        supabase_key: supabaseKey,
        agent_version: AGENT_VERSION,
      }),
      "utf8",
    )

    const payload = Buffer.concat([template, Buffer.from(CONFIG_MARKER, "utf8"), config])

    return new NextResponse(payload, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.microsoft.portable-executable",
        "Content-Disposition": 'attachment; filename="DevboardAgentSetup.exe"',
        "Cache-Control": "private, no-store, max-age=0",
        "Content-Length": String(payload.length),
      },
    })
  } catch (error) {
    console.error("Falha ao gerar instalador do Devboard Agent", error)
    return NextResponse.json({ error: "Não foi possível gerar o instalador agora." }, { status: 500 })
  }
}
