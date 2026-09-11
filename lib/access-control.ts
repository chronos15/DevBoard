import type { AccessRole, MemberAccessPolicy, ScreenAccessKey } from "@/lib/types"

export const SCREEN_ACCESS_DEFINITIONS: Array<{ key: ScreenAccessKey; label: string; description: string }> = [
  { key: "dashboard", label: "Painel", description: "Resumo geral e indicadores do workspace." },
  { key: "developer", label: "Painel Dev", description: "Ferramentas pessoais do desenvolvedor." },
  { key: "projects", label: "Projetos", description: "Projetos, atividades e subatividades." },
  { key: "followup", label: "Acompanhamento", description: "Modo completo e resumido de acompanhamento." },
  { key: "requests", label: "Solicitações", description: "Caixa de entrada, próprias e concluídas." },
  { key: "requestsAqs", label: "Solicitações · AQS", description: "Fila AQS das solicitações." },
  { key: "requestsDev", label: "Solicitações · DEV", description: "Fila DEV das solicitações." },
  { key: "analysis", label: "Análise AQS", description: "Tela de validação e qualidade." },
  { key: "hours", label: "Controle de horas", description: "Apontamentos e histórico de horas." },
  { key: "agenda", label: "Agenda", description: "Agenda e prazos do workspace." },
  { key: "chat", label: "Chat", description: "Canais, conversas e mensagens." },
  { key: "reports", label: "Relatórios", description: "Central administrativa de relatórios." },
]

export function defaultScreenPermissions(role: AccessRole): Record<ScreenAccessKey, boolean> {
  return {
    dashboard: true,
    developer: role === "developer",
    projects: role === "admin" || role === "developer",
    followup: true,
    requests: true,
    requestsAqs: role === "admin" || role === "aqs",
    requestsDev: role === "admin" || role === "developer",
    analysis: role === "admin" || role === "aqs" || role === "developer",
    hours: role === "admin" || role === "developer",
    agenda: role === "admin" || role === "developer",
    chat: true,
    reports: role === "admin",
  }
}

export function defaultMemberAccessPolicy(role: AccessRole = "member"): MemberAccessPolicy {
  return {
    enabled: false,
    screenPermissions: defaultScreenPermissions(role),
    restrictProjects: false,
    restrictActivities: false,
    restrictSubactivities: false,
  }
}

export function normalizeMemberAccessPolicy(value: unknown, role: AccessRole = "member"): MemberAccessPolicy {
  const defaults = defaultMemberAccessPolicy(role)
  if (!value || typeof value !== "object") return defaults
  const row = value as Record<string, unknown>
  const rawScreens = row.screenPermissions && typeof row.screenPermissions === "object"
    ? row.screenPermissions as Record<string, unknown>
    : row.screen_permissions && typeof row.screen_permissions === "object"
      ? row.screen_permissions as Record<string, unknown>
      : {}
  const screenPermissions = { ...defaults.screenPermissions }
  for (const definition of SCREEN_ACCESS_DEFINITIONS) {
    if (typeof rawScreens[definition.key] === "boolean") screenPermissions[definition.key] = Boolean(rawScreens[definition.key])
  }
  return {
    enabled: row.enabled === true,
    screenPermissions,
    restrictProjects: row.restrictProjects === true || row.restrict_projects === true,
    restrictActivities: row.restrictActivities === true || row.restrict_activities === true,
    restrictSubactivities: row.restrictSubactivities === true || row.restrict_subactivities === true,
  }
}

export function canAccessScreen(role: AccessRole, policy: MemberAccessPolicy | undefined, screen: ScreenAccessKey) {
  // O perfil base continua sendo o teto de permissão. O acesso personalizado é
  // propositalmente restritivo: ele pode esconder áreas, nunca promover a role.
  if (role === "admin") return screen !== "developer"
  const roleAllows = defaultScreenPermissions(role)[screen]
  if (!roleAllows) return false
  if (!policy?.enabled) return true
  return policy.screenPermissions[screen] !== false
}

export function screenAccessForPath(pathname: string): ScreenAccessKey | null {
  if (pathname.startsWith("/dev")) return "developer"
  if (pathname.startsWith("/relatorios")) return "reports"
  if (pathname.startsWith("/solicitacoes/aqs")) return "requestsAqs"
  if (pathname.startsWith("/solicitacoes/dev")) return "requestsDev"
  if (pathname.startsWith("/solicitacoes")) return "requests"
  if (pathname.startsWith("/analise")) return "analysis"
  if (pathname.startsWith("/projetos")) return "projects"
  if (pathname.startsWith("/acompanhamento") || pathname.startsWith("/minhas-tarefas")) return "followup"
  if (pathname.startsWith("/horas")) return "hours"
  if (pathname.startsWith("/agenda")) return "agenda"
  if (pathname.startsWith("/chat")) return "chat"
  if (pathname === "/") return "dashboard"
  // Configurações, ajuda, compartilhar e rotas auxiliares permanecem disponíveis.
  return null
}
