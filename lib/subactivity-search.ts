export function normalizeSubactivitySearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .trim()
}

export function matchesSubactivityHeaderSearch(title: string, sequence: number | undefined, query: string) {
  const normalizedQuery = normalizeSubactivitySearch(query)
  if (!normalizedQuery) return true

  const numericToken = normalizedQuery.replace(/^#\s*/, "").replace(/\.$/, "").trim()
  if (/^\d+$/.test(numericToken)) {
    return sequence !== undefined && String(sequence) === numericToken
  }

  const normalizedTitle = normalizeSubactivitySearch(title)
  if (normalizedTitle.includes(normalizedQuery)) return true
  if (sequence === undefined) return false
  return normalizeSubactivitySearch(`${sequence}. ${title}`).includes(normalizedQuery)
}
