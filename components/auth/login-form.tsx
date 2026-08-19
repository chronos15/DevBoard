"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Eye, EyeOff, Loader2, Lock, Mail } from "lucide-react"
import { createClient } from "@/lib/supabase/client"

export function LoginForm() {
  const router = useRouter()
  const supabase = React.useMemo(() => createClient(), [])
  const [showPassword, setShowPassword] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState("")
  const googleEnabled = process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED === "true"

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError("")
    const form = new FormData(e.currentTarget)
    const email = String(form.get("email") ?? "").trim()
    const password = String(form.get("password") ?? "")

    const { error: authError } = await supabase.auth.signInWithPassword({ email, password })
    if (authError) {
      setError(authError.message === "Invalid login credentials" ? "E-mail ou senha inválidos." : authError.message)
      setLoading(false)
      return
    }

    const next = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("next") : null
    router.replace(next?.startsWith("/") ? next : "/")
    router.refresh()
  }

  async function signInWithGoogle() {
    setLoading(true)
    setError("")
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || window.location.origin
    const next = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("next") : null
    const callback = new URL("/auth/callback", appUrl)
    if (next?.startsWith("/")) callback.searchParams.set("next", next)
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: callback.toString() },
    })
    if (oauthError) {
      setError(oauthError.message)
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      {error && <div role="alert" className="rounded-xl border border-destructive/25 bg-destructive/8 px-3 py-2.5 text-xs text-destructive">{error}</div>}
      <div className="flex flex-col gap-2">
        <label htmlFor="email" className="font-mono text-[0.7rem] tracking-widest text-muted-foreground uppercase">E-mail</label>
        <div className="relative">
          <Mail className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <input id="email" name="email" type="email" required autoComplete="email" placeholder="voce@empresa.com" className="h-12 w-full rounded-xl border border-border bg-muted/50 pr-4 pl-10 text-sm outline-none transition-colors focus:border-ring focus:bg-card" />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <label htmlFor="password" className="font-mono text-[0.7rem] tracking-widest text-muted-foreground uppercase">Senha</label>
          <Link href="/login/recuperar" className="text-xs font-medium text-primary transition-opacity hover:opacity-80">Esqueceu a senha?</Link>
        </div>
        <div className="relative">
          <Lock className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <input id="password" name="password" type={showPassword ? "text" : "password"} required autoComplete="current-password" placeholder="••••••••" className="h-12 w-full rounded-xl border border-border bg-muted/50 pr-11 pl-10 text-sm outline-none transition-colors focus:border-ring focus:bg-card" />
          <button type="button" onClick={() => setShowPassword((v) => !v)} className="absolute top-1/2 right-3 -translate-y-1/2 rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground" aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}>
            {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
      </div>

      <button type="submit" disabled={loading} className="mt-1 flex h-12 items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-70">
        {loading && <Loader2 className="size-4 animate-spin" />}
        {loading ? "Entrando..." : "Entrar"}
      </button>

      {googleEnabled && (
        <>
          <div className="flex items-center gap-3 py-1"><span className="h-px flex-1 bg-border" /><span className="font-mono text-[0.65rem] tracking-widest text-muted-foreground uppercase">ou</span><span className="h-px flex-1 bg-border" /></div>
          <button type="button" disabled={loading} onClick={() => void signInWithGoogle()} className="flex h-12 items-center justify-center gap-2.5 rounded-xl border border-border bg-card text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-60">
            <GoogleMark /> Continuar com Google
          </button>
        </>
      )}

      <p className="text-center text-sm text-muted-foreground">{"Não tem uma conta? "}<Link href="/login/cadastro" className="font-semibold text-primary transition-opacity hover:opacity-80">Criar conta</Link></p>
    </form>
  )
}

function GoogleMark() {
  return <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true"><path fill="#EA4335" d="M12 10.2v3.9h5.5c-.24 1.4-1.7 4.1-5.5 4.1-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C17.1 3.4 14.8 2.4 12 2.4 6.9 2.4 2.8 6.5 2.8 11.6S6.9 20.8 12 20.8c5.9 0 9.8-4.1 9.8-9.9 0-.7-.1-1.2-.2-1.7H12z" /></svg>
}
