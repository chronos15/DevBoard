const denoRuntime = (globalThis as any).Deno

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

denoRuntime.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Método não permitido" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  const keyId = denoRuntime.env.get("CLOUDFLARE_TURN_KEY_ID")?.trim()
  const apiToken = denoRuntime.env.get("CLOUDFLARE_TURN_API_TOKEN")?.trim()
  const ttlRaw = Number(denoRuntime.env.get("CLOUDFLARE_TURN_TTL") ?? "86400")
  const ttl = Number.isFinite(ttlRaw) ? Math.min(Math.max(Math.floor(ttlRaw), 3600), 86400) : 86400

  if (!keyId || !apiToken) {
    return new Response(JSON.stringify({ error: "TURN não configurado no Supabase" }), {
      status: 503,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  try {
    const response = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ttl }),
      },
    )

    const payload = await response.json().catch(() => null)
    if (!response.ok || !payload?.iceServers) {
      console.error("Cloudflare TURN credential error", response.status, payload)
      return new Response(JSON.stringify({ error: "Não foi possível gerar credenciais TURN" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // A porta 53 é conhecida por ser bloqueada por navegadores; removemos para evitar timeouts desnecessários.
    const iceServers = payload.iceServers.map((server: { urls: string | string[]; username?: string; credential?: string }) => {
      const urls = (Array.isArray(server.urls) ? server.urls : [server.urls]).filter(
        (url: string) => !/:53(?:\?|$)/.test(url),
      )
      return { ...server, urls }
    }).filter((server: { urls: string[] }) => server.urls.length > 0)

    return new Response(JSON.stringify({ iceServers, ttl }), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    })
  } catch (error) {
    console.error("TURN credential exception", error)
    return new Response(JSON.stringify({ error: "Falha ao consultar o serviço TURN" }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }
})
