import { PageHeading } from "@/components/page-heading"
import { AgendaView } from "@/components/agenda/agenda-view"

export default function AgendaPage() {
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5">
      <PageHeading
        eyebrow="Planejamento"
        title="Agenda"
        subtitle="Acompanhe vencimentos dos projetos, identifique os próximos prazos e alterne a agenda entre dia, semana ou mês."
      />
      <AgendaView />
    </div>
  )
}
