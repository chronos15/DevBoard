import type { SupabaseClient } from "@supabase/supabase-js"

export type WebRtcIceConfig = {
  /** Servidores usados na primeira tentativa. Com TURN, prioriza UDP para evitar
   *  que falhas TCP/TLS/IPv6 atrasem a negociação em Chrome/Windows/Android. */
  iceServers: RTCIceServer[]
  /** Configuração completa devolvida pelo provedor. É ativada somente se a
   *  primeira tentativa não conectar, preservando TCP/TLS como fallback. */
  fallbackIceServers: RTCIceServer[]
  hasTurn: boolean
  source: "edge-turn" | "public-stun"
  warning?: string
}

const FALLBACK_STUN: RTCIceServer[] = [
  { urls: ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"] },
]

function validIceServers(value: unknown): RTCIceServer[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is RTCIceServer => {
    if (!item || typeof item !== "object") return false
    const urls = (item as RTCIceServer).urls
    return typeof urls === "string" || (Array.isArray(urls) && urls.every((url) => typeof url === "string"))
  })
}

function asUrls(server: RTCIceServer): string[] {
  return Array.isArray(server.urls) ? server.urls : [server.urls]
}

function hasTurnServer(servers: RTCIceServer[]) {
  return servers.some((server) => asUrls(server).some((url) => /^turns?:/i.test(url)))
}

function hasUdpTurnServer(servers: RTCIceServer[]) {
  return servers.some((server) => asUrls(server).some((url) => /^turn:/i.test(url) && /[?&]transport=udp(?:&|$)/i.test(url)))
}

/**
 * Cloudflare entrega UDP, TCP e TLS no mesmo conjunto de credenciais. Em
 * Chromium, uma interface IPv6 pode emitir icecandidateerror 701 para os
 * endpoints TCP/TLS mesmo quando a rota UDP é válida. Começar com UDP evita
 * que esses endpoints concorram com a primeira negociação. Se UDP/direto não
 * conectar, CallRoom promove o peer para a lista completa e faz ICE restart.
 */
function udpFirstServers(servers: RTCIceServer[]): RTCIceServer[] {
  const preferred = servers.flatMap((server) => {
    const urls = asUrls(server).filter((url) => {
      if (!/^turns?:/i.test(url)) return true
      return /^turn:/i.test(url) && /[?&]transport=udp(?:&|$)/i.test(url)
    })
    if (urls.length === 0) return []
    return [{ ...server, urls } satisfies RTCIceServer]
  })

  // Provedores diferentes podem não fornecer TURN/UDP. Nesse caso não
  // descartamos TURN: usa a configuração original desde a primeira tentativa.
  if (hasTurnServer(servers) && !hasUdpTurnServer(preferred)) return servers
  return preferred.length > 0 ? preferred : servers
}

export async function loadWebRtcIceConfig(supabase: SupabaseClient): Promise<WebRtcIceConfig> {
  try {
    const { data, error } = await supabase.functions.invoke("webrtc-ice-servers", { body: {} })
    if (!error) {
      const servers = validIceServers(data?.iceServers)
      if (servers.length > 0) {
        const hasTurn = hasTurnServer(servers)
        const preferred = hasTurn ? udpFirstServers(servers) : servers
        return {
          iceServers: preferred,
          fallbackIceServers: servers,
          hasTurn,
          source: hasTurn ? "edge-turn" : "public-stun",
          warning: hasTurn
            ? undefined
            : "A função de ICE respondeu sem servidor TURN. Redes móveis/restritivas podem não conectar.",
        }
      }
    }
  } catch {
    // A função é opcional em desenvolvimento. O fallback STUN mantém chamadas em redes permissivas.
  }

  return {
    iceServers: FALLBACK_STUN,
    fallbackIceServers: FALLBACK_STUN,
    hasTurn: false,
    source: "public-stun",
    warning: "TURN não está configurado. A chamada pode falhar em rede móvel, CGNAT ou firewall restritivo.",
  }
}
