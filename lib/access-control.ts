import type { AccessRole, ActionAccessKey, MemberAccessPolicy, ScreenAccessKey } from "@/lib/types"

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
  { key: "reports", label: "Administrativo", description: "Central administrativa de relatórios." },
  { key: "settings", label: "Configurações", description: "Preferências e, para administradores, gestão da equipe e permissões." },
]

export const ACTION_ACCESS_DEFINITIONS: Array<{ key: ActionAccessKey; label: string; description: string }> = [
  { key: "createProjects", label: "Adicionar projetos", description: "Permite criar novos projetos no workspace." },
  { key: "editProjects", label: "Editar projetos", description: "Permite alterar projetos quando a regra base da role também permitir." },
  { key: "createActivities", label: "Adicionar atividades", description: "Permite criar atividades dentro dos projetos acessíveis." },
  { key: "createSubactivities", label: "Adicionar subatividades", description: "Permite criar subatividades dentro das atividades acessíveis." },
]

export function defaultActionPermissions(role: AccessRole): Record<ActionAccessKey, boolean> {
  return {
    createProjects: role === "admin" || role === "developer",
    editProjects: role === "admin" || role === "developer",
    createActivities: role === "admin" || role === "developer",
    createSubactivities: role === "admin" || role === "developer",
  }
}

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
    settings: true,
  }
}

export function defaultReadOnlyScreens(): Record<ScreenAccessKey, boolean> {
  return {
    dashboard: false,
    developer: false,
    projects: false,
    followup: false,
    requests: false,
    requestsAqs: false,
    requestsDev: false,
    analysis: false,
    hours: false,
    agenda: false,
    chat: false,
    reports: false,
    settings: false,
  }
}

export function defaultMemberAccessPolicy(role: AccessRole = "member"): MemberAccessPolicy {
  return {
    enabled: false,
    screenPermissions: defaultScreenPermissions(role),
    actionPermissions: defaultActionPermissions(role),
    readOnlyScreens: defaultReadOnlyScreens(),
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

  const rawActions = row.actionPermissions && typeof row.actionPermissions === "object"
    ? row.actionPermissions as Record<string, unknown>
    : row.action_permissions && typeof row.action_permissions === "object"
      ? row.action_permissions as Record<string, unknown>
      : {}
  const actionPermissions = { ...defaults.actionPermissions }
  for (const definition of ACTION_ACCESS_DEFINITIONS) {
    if (typeof rawActions[definition.key] === "boolean") actionPermissions[definition.key] = Boolean(rawActions[definition.key])
  }

  const rawReadOnly = row.readOnlyScreens && typeof row.readOnlyScreens === "object"
    ? row.readOnlyScreens as Record<string, unknown>
    : row.read_only_screens && typeof row.read_only_screens === "object"
      ? row.read_only_screens as Record<string, unknown>
      : {}
  const readOnlyScreens = { ...defaults.readOnlyScreens }
  for (const definition of SCREEN_ACCESS_DEFINITIONS) {
    if (typeof rawReadOnly[definition.key] === "boolean") readOnlyScreens[definition.key] = Boolean(rawReadOnly[definition.key])
  }

  return {
    enabled: row.enabled === true,
    screenPermissions,
    actionPermissions,
    readOnlyScreens,
    restrictProjects: row.restrictProjects === true || row.restrict_projects === true,
    restrictActivities: row.restrictActivities === true || row.restrict_activities === true,
    restrictSubactivities: row.restrictSubactivities === true || row.restrict_subactivities === true,
  }
}

export function canAccessScreen(role: AccessRole, policy: MemberAccessPolicy | undefined, screen: ScreenAccessKey) {
  const roleAllows = defaultScreenPermissions(role)[screen]
  if (!roleAllows) return false
  if (!policy?.enabled) return true
  return policy.screenPermissions[screen] !== false
}

export function isScreenReadOnly(role: AccessRole, policy: MemberAccessPolicy | undefined, screen: ScreenAccessKey) {
  if (!canAccessScreen(role, policy, screen)) return false
  if (!policy?.enabled) return false
  return policy.readOnlyScreens?.[screen] === true
}

export function canWriteScreen(role: AccessRole, policy: MemberAccessPolicy | undefined, screen: ScreenAccessKey) {
  return canAccessScreen(role, policy, screen) && !isScreenReadOnly(role, policy, screen)
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
  if (pathname.startsWith("/config")) return "settings"
  if (pathname === "/") return "dashboard"
  // Ajuda, compartilhar e rotas auxiliares permanecem disponíveis.
  return null
}

const ACTION_SCREEN: Record<ActionAccessKey, ScreenAccessKey> = {
  createProjects: "projects",
  editProjects: "projects",
  createActivities: "projects",
  createSubactivities: "projects",
}

export function canPerformAction(role: AccessRole, policy: MemberAccessPolicy | undefined, action: ActionAccessKey) {
  const roleAllows = defaultActionPermissions(role)[action]
  if (!roleAllows) return false
  if (!policy?.enabled) return true
  if (policy.readOnlyScreens?.[ACTION_SCREEN[action]] === true) return false
  return policy.actionPermissions[action] !== false
}
