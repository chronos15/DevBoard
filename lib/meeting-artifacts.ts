export type MeetingArtifactKind = "recording" | "transcript"

/**
 * Identifica somente os nomes reservados gerados automaticamente pelo TaskBoard.
 * Mantemos esta regra centralizada para que UI, Realtime e carregamento inicial
 * tratem gravação/PDF da reunião da mesma forma sem alterar o fluxo de upload.
 */
export function meetingArtifactKindFromName(name: string | null | undefined): MeetingArtifactKind | undefined {
  const normalized = String(name ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLocaleLowerCase("pt-BR")

  if (normalized.startsWith("gravacao - ")) return "recording"
  if (normalized.startsWith("chat da reuniao - ") && normalized.endsWith(".pdf")) return "transcript"
  return undefined
}
