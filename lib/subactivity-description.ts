/**
 * Helpers for presenting and normalizing the (legacy) subactivity `title` field,
 * which is used as the descriptive text throughout TaskBoard.
 *
 * Quoted fragments are intentionally preserved verbatim so identifiers and
 * excerpts such as “SQL SERVER”, "API XPTO" or "CLIENTE ABC" are not altered.
 */

const LETTER_RE = /[A-Za-zÀ-ÖØ-öø-ÿ]/u
const UPPER_RE = /[A-ZÀ-ÖØ-Þ]/u
const LOWER_RE = /[a-zà-öø-ÿ]/u

function isOpeningQuote(char: string) {
  return char === '“' || char === '"'
}

function isClosingQuote(char: string) {
  return char === '”' || char === '"'
}

function outsideQuotedText(value: string) {
  let quoted = false
  let result = ""

  for (const char of value) {
    if (!quoted && isOpeningQuote(char)) {
      quoted = true
      continue
    }
    if (quoted && isClosingQuote(char)) {
      quoted = false
      continue
    }
    if (!quoted) result += char
  }

  return result
}

/** Force sentence case outside quoted fragments. */
export function normalizeSubactivityDescription(value: string) {
  if (!value) return value

  let quoted = false
  let capitalizeNext = true
  let result = ""

  for (const char of value) {
    if (!quoted && isOpeningQuote(char)) {
      quoted = true
      result += char
      continue
    }

    if (quoted) {
      result += char
      if (LETTER_RE.test(char)) capitalizeNext = false
      if (char === "." || char === "!" || char === "?" || char === "\n" || char === "\r") capitalizeNext = true
      if (isClosingQuote(char)) quoted = false
      continue
    }

    if (LETTER_RE.test(char)) {
      const lowered = char.toLocaleLowerCase("pt-BR")
      result += capitalizeNext ? lowered.toLocaleUpperCase("pt-BR") : lowered
      capitalizeNext = false
      continue
    }

    result += char
    if (char === "." || char === "!" || char === "?" || char === "\n" || char === "\r") capitalizeNext = true
  }

  return result
}

/**
 * Display helper: only normalizes descriptions that are effectively ALL CAPS
 * outside quotes. Normal/mixed-case descriptions are left untouched.
 */
export function formatSubactivityDescription(value: string) {
  if (!value) return value

  const unquoted = outsideQuotedText(value)
  let upperCount = 0
  let lowerCount = 0

  for (const char of unquoted) {
    if (UPPER_RE.test(char)) upperCount += 1
    else if (LOWER_RE.test(char)) lowerCount += 1
  }

  if (upperCount < 3 || lowerCount > 0) return value
  return normalizeSubactivityDescription(value)
}
