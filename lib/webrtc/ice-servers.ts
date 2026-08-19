import type { SupabaseClient } from "@supabase/supabase-js"

export type WebRtcIceConfig = {
  iceServers: RTCIceServer[]
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

function hasTurnServer(servers: RTCIceServer[]) {
  return servers.some((server) => {
    const urls = Array.isArray(server.urls) ? server.urls : [server.urls]
    return urls.some((url) => /^turns?:/i.test(url))
  })
}

export async function loadWebRtcIceConfig(supabase: SupabaseClient): Promise<WebRtcIceConfig> {
  try {
    const { data, error } = await supabase.functions.invoke("webrtc-ice-servers", { body: {} })
    if (!error) {
      const servers = validIceServers(data?.iceServers)
      if (servers.length > 0) {
        const hasTurn = hasTurnServer(servers)
        return {
          iceServers: servers,
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
    hasTurn: false,
    source: "public-stun",
    warning: "TURN não está configurado. A chamada pode falhar em rede móvel, CGNAT ou firewall restritivo.",
  }
}
