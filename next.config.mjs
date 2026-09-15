/** @type {import('next').NextConfig} */
const taskboardVersion = process.env.TASKBOARD_VERSION?.trim() || "V139"
const taskboardBuild = (() => {
  const explicitBuild = process.env.TASKBOARD_BUILD?.trim()
  if (explicitBuild) return explicitBuild

  const commit = (
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.GITHUB_SHA ||
    process.env.COMMIT_SHA ||
    process.env.SOURCE_VERSION ||
    ""
  ).trim()

  if (commit) return commit.slice(0, 7)

  // Build local: mantém um identificador curto, legível e diferente a cada compilação.
  const now = new Date()
  const yy = String(now.getUTCFullYear()).slice(-2)
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0")
  const dd = String(now.getUTCDate()).padStart(2, "0")
  const hh = String(now.getUTCHours()).padStart(2, "0")
  const min = String(now.getUTCMinutes()).padStart(2, "0")
  return `${yy}${mm}${dd}-${hh}${min}`
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
    NEXT_PUBLIC_TASKBOARD_BUILD: taskboardBuild,
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
