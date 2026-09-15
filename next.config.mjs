/** @type {import('next').NextConfig} */
const taskboardVersion = process.env.TASKBOARD_VERSION?.trim() || "V152"
const taskboardBuildDate = (() => {
  const explicitBuildDate = process.env.TASKBOARD_BUILD_DATE?.trim()
  if (explicitBuildDate) return explicitBuildDate

  // Registra uma única vez o momento desta compilação/inicialização do Next.
  // O timezone é fixado em Brasília para que o valor exibido seja consistente
  // mesmo quando a build roda em servidores UTC (ex.: Vercel).
  const parts = new Intl.DateTimeFormat("pt-BR", {
    timeZone: process.env.TASKBOARD_BUILD_TIMEZONE?.trim() || "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date())

  const get = (type) => parts.find((part) => part.type === type)?.value || "00"
  return `${get("day")}/${get("month")} ${get("hour")}:${get("minute")}`
})()

const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  env: {
    NEXT_PUBLIC_TASKBOARD_VERSION: taskboardVersion,
    NEXT_PUBLIC_TASKBOARD_BUILD_DATE: taskboardBuildDate,
    // Alias legado da primeira implementação da V139.
    NEXT_PUBLIC_TASKBOARD_BUILD: taskboardBuildDate,
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "geolocation=(), camera=(self), microphone=(self), display-capture=(self)" },
        ],
      },
    ]
  },
}

export default nextConfig
