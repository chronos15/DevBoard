function normalizeLogReference(value: string) {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase("pt-BR")
}

/**
 * Project logs are legacy project-wide records and do not carry a subactivity id.
 * Match the subactivity only when its complete title appears as a quoted reference.
 * This avoids leaking logs between similarly named items such as "UIX" and "UI/UIX".
 */
export function logReferencesSubactivityTitle(title: string, logTitle: string, description?: string) {
  const normalizedTitle = normalizeLogReference(title)
  if (!normalizedTitle) return false

  const haystack = normalizeLogReference(`${logTitle} ${description ?? ""}`)
  return [
    `“${normalizedTitle}”`,
    `"${normalizedTitle}"`,
    `‘${normalizedTitle}’`,
    `'${normalizedTitle}'`,
  ].some((reference) => haystack.includes(reference))
}
