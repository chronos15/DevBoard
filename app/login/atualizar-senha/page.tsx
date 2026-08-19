"use client"

import * as React from "react"
import { Loader2, LockKeyhole } from "lucide-react"
import { createClient } from "@/lib/supabase/client"

export default function UpdatePasswordPage() {
  const supabase = React.useMemo(() => createClient(), [])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState("")
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLoading(true); setError("")
    const form = new FormData(event.currentTarget)
    const password = String(form.get("password") ?? "")
    const confirmation = String(form.get("confirmation") ?? "")
    if (password.length < 8) { setError("Use pelo menos 8 caracteres."); setLoading(false); return }
    if (password !== confirmation) { setError("As senhas não coincidem."); setLoading(false); return }
    const { error: updateError } = await supabase.auth.updateUser({ password })
    if (updateError) { setError(updateError.message); setLoading(false); return }
    window.location.assign("/")
  }
  return <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10"><div className="w-full max-w-md rounded-2xl bg-card p-6 ring-1 ring-foreground/8 md:p-8"><div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><LockKeyhole className="size-5" /></div><h1 className="mt-5 text-2xl font-semibold">Definir nova senha</h1><p className="mt-1 text-sm text-muted-foreground">Escolha uma nova senha para sua conta.</p>{error && <div className="mt-5 rounded-xl border border-destructive/25 bg-destructive/8 p-3 text-sm text-destructive">{error}</div>}<form onSubmit={submit} className="mt-6 space-y-4"><input name="password" type="password" required minLength={8} placeholder="Nova senha" className="h-11 w-full rounded-xl border border-border bg-muted/40 px-3 text-sm outline-none focus:border-ring" /><input name="confirmation" type="password" required minLength={8} placeholder="Confirmar nova senha" className="h-11 w-full rounded-xl border border-border bg-muted/40 px-3 text-sm outline-none focus:border-ring" /><button disabled={loading} className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-60">{loading && <Loader2 className="size-4 animate-spin" />}Salvar nova senha</button></form></div></main>
}
