import type { Metadata } from "next"
import { Clock3, BarChart3, Users } from "lucide-react"
import { LoginForm } from "@/components/auth/login-form"
import { ThemeToggle } from "@/components/theme-toggle"
import { DevboardLogo } from "@/components/devboard-logo"

export const metadata: Metadata = {
  title: "Entrar — Devboard",
  description: "Acesse sua conta Devboard para gerenciar projetos e horas.",
}

const highlights = [
  { icon: Clock3, label: "Controle de horas em tempo real" },
  { icon: BarChart3, label: "Relatórios de desempenho por projeto" },
  { icon: Users, label: "Colaboração com toda a equipe" },
]

export default function LoginPage() {
  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      {/* Brand panel — hidden on small screens */}
      <section className="relative hidden flex-col justify-between bg-sidebar p-10 text-sidebar-foreground lg:flex xl:p-14">
        <div className="flex items-center gap-2.5">
          <DevboardLogo className="size-9" priority />
          <span className="text-lg font-bold tracking-tight text-sidebar-accent-foreground">
            Devboard
          </span>
        </div>

        <div className="max-w-md">
          <p className="font-mono text-[0.7rem] tracking-widest text-primary uppercase">
            Gestão de projetos
          </p>
          <h1 className="mt-4 text-4xl leading-tight font-bold text-balance text-sidebar-accent-foreground xl:text-5xl">
            Cada hora no ritmo certo.
          </h1>
          <p className="mt-4 text-pretty text-sidebar-foreground/70">
            Acompanhe projetos, atividades e o tempo da sua equipe em um só
            lugar, com clareza do começo ao fim.
          </p>

          <ul className="mt-8 flex flex-col gap-3">
            {highlights.map((item) => (
              <li key={item.label} className="flex items-center gap-3">
                <span className="flex size-8 items-center justify-center rounded-lg bg-sidebar-accent text-primary">
                  <item.icon className="size-4" />
                </span>
                <span className="text-sm text-sidebar-foreground/85">
                  {item.label}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-xs text-sidebar-foreground/50">
          © {new Date().getFullYear()} Devboard. Todos os direitos reservados.
        </p>
      </section>

      {/* Form panel */}
      <section className="relative flex items-center justify-center px-5 py-10 sm:px-8">
        <div className="absolute top-5 right-5">
          <ThemeToggle />
        </div>

        <div className="w-full max-w-sm">
          {/* Compact logo for mobile */}
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <DevboardLogo className="size-9" priority />
            <span className="text-lg font-bold tracking-tight text-foreground">
              Devboard
            </span>
          </div>

          <div className="mb-7">
            <h2 className="text-2xl font-bold tracking-tight text-balance">
              Bem-vindo de volta
            </h2>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Entre com suas credenciais para acessar o painel.
            </p>
          </div>

          <LoginForm />
        </div>
      </section>
    </main>
  )
}
