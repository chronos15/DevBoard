import { PageHeading } from "@/components/page-heading"
import { AgendaView } from "@/components/agenda/agenda-view"

export default function AgendaPage() {
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <PageHeading
        eyebrow="Planejamento"
        title="Agenda"
        subtitle="Visualize prazos e a distribuição dos projetos ao longo do mês."
      />
      <AgendaView />
    </div>
  )
}
