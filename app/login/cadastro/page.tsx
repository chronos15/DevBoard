"use client"

import * as React from "react"
import Link from "next/link"
import { ArrowLeft, Loader2 } from "lucide-react"
import { createClient } from "@/lib/supabase/client"

export default function SignUpPage() {
  const supabase = React.useMemo(() => createClient(), [])
  const [loading, setLoading] = React.useState(false)
  const [message, setMessage] = React.useState("")
  const [error, setError] = React.useState("")

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoading(true); setError(""); setMessage("")
    const form = new FormData(event.currentTarget)
    const name = String(form.get("name") ?? "").trim()
    const email = String(form.get("email") ?? "").trim()
    const password = String(form.get("password") ?? "")
    if (password.length < 8) { setError("Use uma senha com pelo menos 8 caracteres."); setLoading(false); return }
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || window.location.origin
    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: name },
        emailRedirectTo: `${appUrl}/auth/callback`,
      },
    })
    if (signUpError) setError(signUpError.message)
    else if (data.session) window.location.assign("/")
    else setMessage("Conta criada. Confirme o e-mail enviado para concluir o acesso.")
    setLoading(false)
  }

  return <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10"><div className="w-full max-w-md rounded-2xl bg-card p-6 ring-1 ring-foreground/8 md:p-8">
    <Link href="/login" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Voltar ao login</Link>
    <h1 className="mt-6 text-2xl font-semibold tracking-tight">Criar conta</h1>
    <p className="mt-1 text-sm text-muted-foreground">Crie seu usuário. O perfil será registrado automaticamente no workspace pelo Supabase.</p>
    {message && <div className="mt-5 rounded-xl border border-primary/20 bg-primary/5 p-3 text-sm">{message}</div>}
    {error && <div className="mt-5 rounded-xl border border-destructive/25 bg-destructive/8 p-3 text-sm text-destructive">{error}</div>}
    <form onSubmit={submit} className="mt-6 space-y-4">
      <input name="name" required minLength={2} placeholder="Nome completo" className="h-11 w-full rounded-xl border border-border bg-muted/40 px-3 text-sm outline-none focus:border-ring" />
      <input name="email" type="email" required placeholder="E-mail" className="h-11 w-full rounded-xl border border-border bg-muted/40 px-3 text-sm outline-none focus:border-ring" />
      <input name="password" type="password" required minLength={8} placeholder="Senha (mín. 8 caracteres)" className="h-11 w-full rounded-xl border border-border bg-muted/40 px-3 text-sm outline-none focus:border-ring" />
      <button disabled={loading} type="submit" className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60">{loading && <Loader2 className="size-4 animate-spin" />}{loading ? "Criando..." : "Criar conta"}</button>
    </form>
  </div></main>
}
