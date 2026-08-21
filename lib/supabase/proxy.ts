import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

const PUBLIC_PATHS = ['/login', '/auth', '/api/dev-agent/update']

type SessionCookie = {
  name: string
  value: string
  options?: Record<string, unknown>
}

export async function updateSession(request: NextRequest) {
  const pathname = request.nextUrl.pathname
  const isAgentUpdateEndpoint = pathname === '/api/dev-agent/update' || pathname.startsWith('/api/dev-agent/update/')

  // O Agent não possui cookie/JWT do navegador. O manifesto e o binário genérico
  // precisam ser públicos para que versões já instaladas consigam fazer bootstrap
  // do auto-update. Nenhum dos dois contém agent_id, segredo ou dados do usuário.
  if (isAgentUpdateEndpoint) {
    return NextResponse.next({ request })
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

  if (!url || !key) {
    return NextResponse.next({ request })
  }

  let response = NextResponse.next({ request })
  let refreshedCookies: SessionCookie[] = []
  let refreshedHeaders: Record<string, string> = {}

  const applySessionTo = (target: NextResponse) => {
    refreshedCookies.forEach(({ name, value, options }) =>
      target.cookies.set(name, value, options as any),
    )
    Object.entries(refreshedHeaders).forEach(([header, value]) => target.headers.set(header, value))
    return target
  }

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet, headersToSet) {
        refreshedCookies = cookiesToSet as SessionCookie[]
        refreshedHeaders = headersToSet ?? {}

        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
        response = NextResponse.next({ request })
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
        Object.entries(headersToSet ?? {}).forEach(([header, value]) => response.headers.set(header, value))
      },
    },
  })

  // Mantém a sessão SSR sincronizada e valida assinatura/expiração do JWT.
  const { data, error } = await supabase.auth.getClaims()
  const authenticated = !error && Boolean(data?.claims?.sub)
  const isPublic = PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))

  if (!authenticated && !isPublic) {
    const loginUrl = request.nextUrl.clone()
    loginUrl.pathname = '/login'
    loginUrl.searchParams.set('next', `${pathname}${request.nextUrl.search}`)
    return applySessionTo(NextResponse.redirect(loginUrl))
  }

  if (authenticated && pathname === '/login') {
    const nextUrl = request.nextUrl.clone()
    nextUrl.pathname = '/'
    nextUrl.search = ''
    return applySessionTo(NextResponse.redirect(nextUrl))
  }

  return response
}
