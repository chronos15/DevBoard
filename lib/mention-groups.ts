import type { ChatMention, Member, MemberPresence } from "@/lib/types"

export type MentionGroupKey = "here" | "todos" | "desenvolvedores" | "aqs" | "admin"

export type MentionGroupCandidate = {
  kind: "group"
  key: MentionGroupKey
  label: string
  title: string
  description: string
  userIds: string[]
}

export type MentionUserCandidate = {
  kind: "user"
  id: string
  label: string
  member: Member
  description?: string
}

export type MentionCandidate = MentionGroupCandidate | MentionUserCandidate

function uniqueActiveIds(ids: Iterable<string>, members: Member[], currentUserId: string) {
  const active = new Set(members.map((member) => member.id))
  return Array.from(new Set(Array.from(ids))).filter((id) => id !== currentUserId && active.has(id))
}

export function buildMentionGroups({
  members,
  currentUserId,
  memberPresence,
  hereUserIds,
}: {
  members: Member[]
  currentUserId: string
  memberPresence?: Record<string, MemberPresence>
  hereUserIds?: string[]
}): MentionGroupCandidate[] {
  const onlineIds = members
    .filter((member) => memberPresence?.[member.id]?.online)
    .map((member) => member.id)

  const groups: MentionGroupCandidate[] = [
    {
      kind: "group",
      key: "here",
      label: "here",
      title: "@here",
      description: hereUserIds ? "Pessoas presentes neste contexto agora" : "Pessoas online agora",
      userIds: uniqueActiveIds(hereUserIds ?? onlineIds, members, currentUserId),
    },
    {
      kind: "group",
      key: "todos",
      label: "todos",
      title: "@todos",
      description: "Todos os usuários ativos do ambiente",
      userIds: uniqueActiveIds(members.map((member) => member.id), members, currentUserId),
    },
    {
      kind: "group",
      key: "desenvolvedores",
      label: "desenvolvedores",
      title: "@desenvolvedores",
      description: "Todos os desenvolvedores",
      userIds: uniqueActiveIds(members.filter((member) => member.role === "developer").map((member) => member.id), members, currentUserId),
    },
    {
      kind: "group",
      key: "aqs",
      label: "aqs",
      title: "@aqs",
      description: "Toda a equipe de AQS",
      userIds: uniqueActiveIds(members.filter((member) => member.role === "aqs").map((member) => member.id), members, currentUserId),
    },
    {
      kind: "group",
      key: "admin",
      label: "admin",
      title: "@admin",
      description: "Todos os administradores",
      userIds: uniqueActiveIds(members.filter((member) => member.role === "admin").map((member) => member.id), members, currentUserId),
    },
  ]

  return groups
}

export function mentionCandidates({
  members,
  currentUserId,
  query,
  memberPresence,
  hereUserIds,
  userLimit = 8,
}: {
  members: Member[]
  currentUserId: string
  query: string
  memberPresence?: Record<string, MemberPresence>
  hereUserIds?: string[]
  userLimit?: number
}): MentionCandidate[] {
  const normalized = query.trim().toLocaleLowerCase("pt-BR")
  const groups = buildMentionGroups({ members, currentUserId, memberPresence, hereUserIds })
    .filter((group) => group.userIds.length > 0)
    .filter((group) => !normalized || group.label.includes(normalized) || group.title.toLocaleLowerCase("pt-BR").includes(normalized))

  const users = members
    .filter((member) => member.id !== currentUserId)
    .filter((member) => !normalized
      || member.name.toLocaleLowerCase("pt-BR").includes(normalized)
      || member.email?.toLocaleLowerCase("pt-BR").includes(normalized))
    .sort((a, b) => {
      const aStarts = a.name.toLocaleLowerCase("pt-BR").startsWith(normalized) ? 0 : 1
      const bStarts = b.name.toLocaleLowerCase("pt-BR").startsWith(normalized) ? 0 : 1
      return aStarts - bStarts || a.name.localeCompare(b.name, "pt-BR")
    })
    .slice(0, userLimit)
    .map<MentionUserCandidate>((member) => ({
      kind: "user",
      id: member.id,
      label: member.name,
      member,
      description: member.email ?? member.role,
    }))

  return [...groups, ...users]
}

export function mentionsForCandidate(candidate: MentionCandidate): ChatMention[] {
  if (candidate.kind === "user") {
    return [{ kind: "user", id: candidate.id, label: candidate.label }]
  }
  return candidate.userIds.map((id) => ({ kind: "user" as const, id, label: candidate.label }))
}

export function mergeMentions(current: ChatMention[], incoming: ChatMention[]) {
  const byKey = new Map(current.map((mention) => [`${mention.kind}:${mention.id}:${mention.label}`, mention]))
  for (const mention of incoming) byKey.set(`${mention.kind}:${mention.id}:${mention.label}`, mention)
  return Array.from(byKey.values())
}

export function mentionTokenForCandidate(candidate: MentionCandidate) {
  return `@${candidate.label}`
}

export function isGroupCandidate(candidate: MentionCandidate): candidate is MentionGroupCandidate {
  return candidate.kind === "group"
}
