import Link from "next/link"
import { Plus } from "lucide-react"
import { PageHeading } from "@/components/page-heading"
import { ProjectsView } from "@/components/projects/projects-view"

export default function ProjetosPage() {
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <PageHeading
        eyebrow="Portfólio"
        title="Projetos"
        subtitle="Gerencie todos os seus projetos, atividades e horas em um só lugar."
        action={
          <Link href="/projetos/novo" className="flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90">
            <Plus className="size-4" />
            Novo projeto
          </Link>
        }
      />
      <ProjectsView />
    </div>
  )
}
