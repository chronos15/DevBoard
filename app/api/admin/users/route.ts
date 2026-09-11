import { NextResponse } from "next/server"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import { createClient as createServerClient } from "@/lib/supabase/server"

const VALID_ROLES = new Set(["admin", "developer", "aqs", "support", "member"])

function normalizeWorkDays(value: unknown) {
  if (!Array.isArray(value)) return [1, 2, 3, 4, 5]
  return Array.from(new Set(value.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))).sort((a, b) => a - b)
}

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: authData, error: authError } = await supabase.auth.getUser()
    if (authError || !authData.user) {
      return NextResponse.json({ error: "Sessão inválida." }, { status: 401 })
    }

    const { data: membership, error: membershipError } = await supabase
      .from("workspace_members")
      .select("workspace_id,role,active")
      .eq("user_id", authData.user.id)
      .eq("active", true)
      .maybeSingle()

    if (membershipError || !membership || membership.role !== "admin") {
      return NextResponse.json({ error: "Somente administradores podem adicionar usuários." }, { status: 403 })
    }

    const body = await request.json().catch(() => ({})) as {
      name?: string
      email?: string
      password?: string
      role?: string
      workDays?: number[]
      dailyHours?: number
    }
    const name = String(body.name ?? "").trim()
    const email = String(body.email ?? "").trim().toLowerCase()
    const password = String(body.password ?? "")
    const role = VALID_ROLES.has(String(body.role)) ? String(body.role) : "member"
    const workDays = normalizeWorkDays(body.workDays)
    const dailyHours = Number(body.dailyHours ?? 8)

    if (name.length < 2) return NextResponse.json({ error: "Informe o nome do usuário." }, { status: 400 })
    if (!/^\S+@\S+\.\S+$/.test(email)) return NextResponse.json({ error: "Informe um e-mail válido." }, { status: 400 })
    if (password.length < 6) return NextResponse.json({ error: "A senha deve ter pelo menos 6 caracteres." }, { status: 400 })
    if (!Number.isFinite(dailyHours) || dailyHours <= 0 || dailyHours > 24) {
      return NextResponse.json({ error: "A carga diária deve ser maior que 0 e de no máximo 24 horas." }, { status: 400 })
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !serviceRoleKey) {
      console.error("[TaskBoard/Admin Users] SUPABASE_SERVICE_ROLE_KEY não configurada")
      return NextResponse.json({ error: "A criação direta de usuários ainda não foi configurada no servidor." }, { status: 503 })
    }

    const admin = createAdminClient(url, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: name, name },
    })
    if (createError || !created.user) {
      const message = createError?.message?.toLowerCase().includes("already")
        ? "Já existe um usuário com este e-mail."
        : createError?.message || "Não foi possível criar o usuário."
      return NextResponse.json({ error: message }, { status: 400 })
    }

    const userId = created.user.id
    const { error: profileError } = await admin.from("profiles").update({
      name,
      initials: name.split(/\s+/).filter(Boolean).slice(0, 2).map((piece) => piece[0]).join("").toUpperCase() || "US",
      updated_at: new Date().toISOString(),
    }).eq("id", userId)

    const { error: memberError } = await admin.from("workspace_members").upsert({
      workspace_id: membership.workspace_id,
      user_id: userId,
      role,
      active: true,
      work_days: workDays,
      daily_hours: Math.round(dailyHours * 100) / 100,
    }, { onConflict: "workspace_id,user_id" })

    if (profileError || memberError) {
      await admin.auth.admin.deleteUser(userId).catch(() => undefined)
      return NextResponse.json({ error: "O usuário foi criado, mas não foi possível vinculá-lo à equipe. A operação foi desfeita." }, { status: 500 })
    }

    return NextResponse.json({ userId, email, name }, { status: 201 })
  } catch (error) {
    console.error("[TaskBoard/Admin Users]", error)
    return NextResponse.json({ error: "Não foi possível adicionar o usuário agora." }, { status: 500 })
  }
}
