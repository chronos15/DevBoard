export function formatDecimalHoursAsHHMM(value: number | null | undefined) {
  const hours = Number(value ?? 0)
  const totalMinutes = Number.isFinite(hours) ? Math.max(0, Math.round(hours * 60)) : 0
  const hh = Math.floor(totalMinutes / 60)
  const mm = totalMinutes % 60
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`
}

export function parseHHMMToDecimalHours(value: string) {
  const match = value.trim().match(/^(\d+):([0-5]\d)$/)
  if (!match) return null

  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (!Number.isSafeInteger(hours) || hours < 0) return null

  const totalMinutes = (hours * 60) + minutes
  return {
    hours: totalMinutes / 60,
    totalMinutes,
  }
}

export function normalizeHHMMInput(value: string) {
  const sanitized = value.replace(/[^\d:]/g, "")
  const firstColon = sanitized.indexOf(":")

  if (firstColon < 0) {
    const digits = sanitized.replace(/:/g, "").slice(0, 6)
    if (digits.length <= 2) return digits
    return `${digits.slice(0, -2)}:${digits.slice(-2)}`
  }

  const hours = sanitized.slice(0, firstColon).replace(/:/g, "").slice(0, 4)
  const minutes = sanitized.slice(firstColon + 1).replace(/:/g, "").slice(0, 2)
  return `${hours}:${minutes}`
}

export function normalizeHHMMOnBlur(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return trimmed

  const flexible = trimmed.match(/^(\d+):(\d{1,2})$/)
  if (flexible) {
    const hours = Number(flexible[1])
    const minutes = Number(flexible[2])
    if (Number.isSafeInteger(hours) && hours >= 0 && Number.isSafeInteger(minutes) && minutes >= 0 && minutes <= 59) {
      return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`
    }
  }

  const onlyDigits = trimmed.match(/^\d+$/)
  if (onlyDigits) {
    // Entrada compacta para digitação rápida: 400 -> 04:00, 130 -> 01:30, 1230 -> 12:30.
    // Com 1-2 dígitos, preservamos o comportamento intuitivo de horas inteiras.
    if (trimmed.length <= 2) {
      const hours = Number(trimmed)
      if (Number.isSafeInteger(hours) && hours >= 0) return `${String(hours).padStart(2, "0")}:00`
    }

    const hoursPart = trimmed.slice(0, -2)
    const minutesPart = trimmed.slice(-2)
    const hours = Number(hoursPart)
    const minutes = Number(minutesPart)
    if (Number.isSafeInteger(hours) && hours >= 0 && Number.isSafeInteger(minutes) && minutes >= 0 && minutes <= 59) {
      return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`
    }
  }

  return trimmed
}

export function sanitizeHHMMTyping(value: string) {
  const sanitized = value.replace(/[^\d:]/g, "")
  const colonIndex = sanitized.indexOf(":")

  if (colonIndex < 0) return sanitized.slice(0, 6)

  const hours = sanitized.slice(0, colonIndex).replace(/:/g, "").slice(0, 4)
  const minutes = sanitized.slice(colonIndex + 1).replace(/:/g, "").slice(0, 2)
  return `${hours}:${minutes}`
}
