import { PageHeading } from "@/components/page-heading"
import { HoursView } from "@/components/hours/hours-view"

export default function HorasPage() {
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <PageHeading
        eyebrow="Time tracking"
        title="Controle de horas"
        subtitle="Registre e acompanhe o tempo investido em cada subatividade."
      />
      <HoursView />
    </div>
  )
}
