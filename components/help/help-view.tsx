"use client"

import * as React from "react"
import {
  Search,
  Rocket,
  Clock3,
  BarChart3,
  Users,
  ChevronDown,
  MessageCircle,
  BookOpen,
} from "lucide-react"
import { cn } from "@/lib/utils"

const topics = [
  {
    icon: Rocket,
    title: "Primeiros passos",
    desc: "Configure seu workspace e crie o primeiro projeto.",
    tone: "text-primary",
    bg: "bg-primary/12",
    search: "projeto",
  },
  {
    icon: Clock3,
    title: "Controle de horas",
    desc: "Aprenda a registrar e revisar o tempo das atividades.",
    tone: "text-chart-3",
    bg: "bg-chart-3/15",
    search: "horas",
  },
  {
    icon: BarChart3,
    title: "Relatórios",
    desc: "Interprete métricas de horas e desempenho da equipe.",
    tone: "text-chart-4",
    bg: "bg-chart-4/12",
    search: "relatórios",
  },
  {
    icon: Users,
    title: "Gestão de equipe",
    desc: "Convide membros e defina responsabilidades.",
    tone: "text-success",
    bg: "bg-success/15",
    search: "membro",
  },
]

const faqs = [
  {
    q: "Como iniciar o cronômetro de uma atividade?",
    a: "Vá até Controle de horas, localize a subatividade desejada e clique no botão de play. O tempo passa a ser contabilizado em tempo real e a atividade muda para 'Em execução'.",
  },
  {
    q: "Posso ajustar as horas estimadas de um projeto?",
    a: "Sim. Ao criar ou editar uma subatividade você define as horas estimadas, que servem de base para o cálculo de utilização nos relatórios.",
  },
  {
    q: "Como funciona a taxa de conclusão?",
    a: "Ela é calculada pela proporção de subatividades marcadas como concluídas em relação ao total de subatividades do escopo.",
  },
  {
    q: "É possível exportar os relatórios?",
    a: "Na página de Relatórios use o botão Exportar no topo para baixar um resumo de horas e progresso respeitando o seu nível de acesso.",
  },
  {
    q: "Como convidar novos membros para o time?",
    a: "Em Configurações, abra a aba Equipe e use 'Convidar membro' para adicionar pessoas ao workspace e atribuir seus cargos.",
  },
]

export function HelpView() {
  const [query, setQuery] = React.useState("")
  const [open, setOpen] = React.useState<number | null>(0)

  const filtered = faqs.filter(
    (f) =>
      f.q.toLowerCase().includes(query.toLowerCase()) ||
      f.a.toLowerCase().includes(query.toLowerCase()),
  )

  return (
    <div className="flex flex-col gap-4">
      <div className="relative overflow-hidden rounded-2xl bg-sidebar p-6 md:p-8">
        <div className="relative z-10 mx-auto max-w-xl text-center">
          <h2 className="text-xl font-bold text-sidebar-accent-foreground text-balance md:text-2xl">
            Como podemos ajudar?
          </h2>
          <p className="mt-1.5 text-sm text-sidebar-foreground/80">
            Busque por um tema ou navegue pelas perguntas frequentes.
          </p>
          <div className="relative mt-5">
            <Search className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              type="search"
              placeholder="Buscar na central de ajuda..."
              className="h-12 w-full rounded-xl border border-transparent bg-card pr-4 pl-11 text-sm outline-none transition-colors focus:border-ring"
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {topics.map((t) => (
          <button
            key={t.title}
            onClick={() => setQuery(t.search)}
            className="flex flex-col gap-3 rounded-2xl bg-card p-5 text-left ring-1 ring-foreground/8 transition-colors hover:bg-muted/50"
          >
            <span
              className={cn(
                "flex size-10 items-center justify-center rounded-xl",
                t.bg,
                t.tone,
              )}
            >
              <t.icon className="size-5" />
            </span>
            <div>
              <p className="text-sm font-semibold">{t.title}</p>
              <p className="mt-0.5 text-xs text-muted-foreground text-pretty">
                {t.desc}
              </p>
            </div>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div id="faq" className="rounded-2xl bg-card ring-1 ring-foreground/8 lg:col-span-2">
          <div className="flex items-center gap-2 border-b border-border p-5">
            <BookOpen className="size-4 text-primary" />
            <h2 className="text-base font-semibold">Perguntas frequentes</h2>
          </div>
          {filtered.length === 0 ? (
            <p className="p-5 text-sm text-muted-foreground">
              Nenhum resultado para “{query}”.
            </p>
          ) : (
            <ul>
              {filtered.map((f, i) => {
                const isOpen = open === i
                return (
                  <li key={f.q} className="border-b border-border last:border-0">
                    <button
                      onClick={() => setOpen(isOpen ? null : i)}
                      className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
                    >
                      <span className="text-sm font-medium">{f.q}</span>
                      <ChevronDown
                        className={cn(
                          "size-4 shrink-0 text-muted-foreground transition-transform",
                          isOpen && "rotate-180",
                        )}
                      />
                    </button>
                    {isOpen && (
                      <p className="px-5 pb-4 text-sm text-muted-foreground text-pretty">
                        {f.a}
                      </p>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div className="flex flex-col rounded-2xl bg-card p-5 ring-1 ring-foreground/8">
          <span className="flex size-10 items-center justify-center rounded-xl bg-primary/12 text-primary">
            <MessageCircle className="size-5" />
          </span>
          <h2 className="mt-4 text-base font-semibold">Ainda com dúvidas?</h2>
          <p className="mt-1 text-sm text-muted-foreground text-pretty">
            Nosso time responde em até um dia útil. Envie sua mensagem e retornamos por e-mail.
          </p>
          <a href="mailto:suporte@devboard.app" className="mt-4 flex w-full items-center justify-center rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90">
            Falar com o suporte
          </a>
          <a href="#faq" className="mt-2 flex w-full items-center justify-center rounded-xl border border-border py-2.5 text-sm font-medium transition-colors hover:bg-muted">
            Ver documentação
          </a>
        </div>
      </div>
    </div>
  )
}
