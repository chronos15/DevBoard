"use client"

import * as React from "react"

const DEFAULT_ROOT_MARGIN = "360px 0px"
const DEFAULT_DELAY_MS = 140

/**
 * Adia a hidratação de mídias até que o item esteja próximo da área visível.
 * O pequeno atraso dá tempo para o chat concluir o posicionamento inicial no fim
 * da conversa antes de iniciar requests de mídia mais pesados.
 */
export function useChatMediaActivation<T extends HTMLElement>({
  enabled = true,
  rootMargin = DEFAULT_ROOT_MARGIN,
  delayMs = DEFAULT_DELAY_MS,
}: {
  enabled?: boolean
  rootMargin?: string
  delayMs?: number
} = {}) {
  const targetRef = React.useRef<T | null>(null)
  const [activated, setActivated] = React.useState(false)

  const activate = React.useCallback(() => {
    setActivated(true)
  }, [])

  React.useEffect(() => {
    if (!enabled || activated) return

    const target = targetRef.current
    if (!target) return

    let timer: number | null = null
    const scheduleActivation = () => {
      if (timer !== null) return
      timer = window.setTimeout(() => setActivated(true), delayMs)
    }

    if (!("IntersectionObserver" in window)) {
      scheduleActivation()
      return () => {
        if (timer !== null) window.clearTimeout(timer)
      }
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        observer.disconnect()
        scheduleActivation()
      },
      { root: null, rootMargin, threshold: 0.01 },
    )

    observer.observe(target)

    return () => {
      observer.disconnect()
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [activated, delayMs, enabled, rootMargin])

  return { targetRef, activated, activate }
}
