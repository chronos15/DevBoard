import type { NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/proxy'

export async function proxy(request: NextRequest) {
  return updateSession(request)
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|share-target(?:/|$)|share-target-v218(?:/|$)|share-target-v219(?:/|$)|share-target-v221(?:/|$)|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
