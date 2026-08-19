"use client"

import * as React from "react"
import Link from "next/link"
import { ArrowLeft, Loader2, Mail } from "lucide-react"
import { createClient } from "@/lib/supabase/client"

export default function RecoverPasswordPage() {
  const supabase = React.useMemo(() => createClient(), [])
  const [loading, setLoading] = React.useState(false)
  const [message, setMessage] = React.useState("")
  const [error, setError] = React.useState("")
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLoading(true); setError(""); setMessage("")
    const email = String(new FormData(event.currentTarget).get("email") ?? "").trim()
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || window.location.origin
    const callback = new URL("/auth/callback", appUrl)
    callback.searchParams.set("next", "/login/atualizar-senha")
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: callback.toString() })
    if (resetError) setError(resetError.message)
    else setMessage("Se o e-mail existir, você receberá um link para definir uma nova senha.")
    setLoading(false)
  }
  return <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10"><div className="w-full max-w-md rounded-2xl bg-card p-6 ring-1 ring-foreground/8 md:p-8">
    <Link href="/login" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Voltar ao login</Link>
    <h1 className="mt-6 text-2xl font-semibold tracking-tight">Recuperar senha</h1><p className="mt-1 text-sm text-muted-foreground">O Supabase enviará um link seguro para redefinição.</p>
    {message && <div className="mt-5 rounded-xl border border-primary/20 bg-primary/5 p-3 text-sm">{message}</div>}{error && <div className="mt-5 rounded-xl border border-destructive/25 bg-destructive/8 p-3 text-sm text-destructive">{error}</div>}
    <form onSubmit={submit} className="mt-6 space-y-4"><label className="block"><span className="mb-1.5 block text-xs font-medium text-muted-foreground">E-mail</span><span className="relative block"><Mail className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" /><input name="email" type="email" required placeholder="voce@empresa.com" className="h-11 w-full rounded-xl border border-border bg-muted/40 pr-3 pl-10 text-sm outline-none focus:border-ring" /></span></label><button disabled={loading} type="submit" className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60">{loading && <Loader2 className="size-4 animate-spin" />}{loading ? "Enviando..." : "Enviar instruções"}</button></form>
  </div></main>
}
