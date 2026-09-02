"use client"

import * as React from "react"
import { useTheme } from "next-themes"
import { useStore } from "@/lib/store"

const THEME_VARIABLES = [
  "--primary",
  "--primary-foreground",
  "--ring",
  "--chart-1",
  "--sidebar-primary",
  "--sidebar-primary-foreground",
  "--sidebar-ring",
  "--accent",
  "--accent-foreground",
] as const

function normalizeHex(value?: string | null) {
  return /^#[0-9a-f]{6}$/i.test(value ?? "") ? String(value).toUpperCase() : null
}

function hexToRgb(hex: string) {
  return {
    r: Number.parseInt(hex.slice(1, 3), 16),
    g: Number.parseInt(hex.slice(3, 5), 16),
    b: Number.parseInt(hex.slice(5, 7), 16),
  }
}

function channelLuminance(channel: number) {
  const value = channel / 255
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

function foregroundFor(hex: string) {
  const { r, g, b } = hexToRgb(hex)
  const luminance = 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b)
  return luminance > 0.48 ? "#171717" : "#FFFFFF"
}

export function PrimaryColorSync() {
  const { preferences } = useStore()
  const { resolvedTheme } = useTheme()

  React.useEffect(() => {
    const root = document.documentElement
    const primary = normalizeHex(preferences.primaryColor)

    if (!primary) {
      for (const variable of THEME_VARIABLES) root.style.removeProperty(variable)
      root.removeAttribute("data-custom-primary")
      return
    }

    const foreground = foregroundFor(primary)
    const dark = resolvedTheme === "dark"

    root.style.setProperty("--primary", primary)
    root.style.setProperty("--primary-foreground", foreground)
    root.style.setProperty("--ring", primary)
    root.style.setProperty("--chart-1", primary)
    root.style.setProperty("--sidebar-primary", primary)
    root.style.setProperty("--sidebar-primary-foreground", foreground)
    root.style.setProperty("--sidebar-ring", primary)
    root.style.setProperty("--accent", `color-mix(in oklab, ${primary} ${dark ? 18 : 11}%, var(--background))`)
    root.style.setProperty("--accent-foreground", primary)
    root.setAttribute("data-custom-primary", primary)

    return () => {
      // O cleanup evita que a cor de um usuário permaneça brevemente ao trocar
      // de sessão antes das preferências do próximo perfil serem carregadas.
      for (const variable of THEME_VARIABLES) root.style.removeProperty(variable)
      root.removeAttribute("data-custom-primary")
    }
  }, [preferences.primaryColor, resolvedTheme])

  return null
}
