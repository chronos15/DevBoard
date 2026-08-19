import { PageHeading } from "@/components/page-heading"
import { ConfigView } from "@/components/config/config-view"

export default function ConfigPage() {
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <PageHeading
        eyebrow="Preferências"
        title="Configurações"
        subtitle="Gerencie seu perfil, equipe e preferências do workspace."
      />
      <ConfigView />
    </div>
  )
}
