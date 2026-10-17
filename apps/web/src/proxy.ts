import { availableChains } from '@cobweb/shared'
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { cspHeaders, cspModeOf, cspSourcesOf, newNonce, routeClassOf } from '@/lib/security/csp'

/** Request headers that would choose the policy or the nonce Next applies, which no client may send. */
const CLIENT_CHOSEN = ['content-security-policy', 'content-security-policy-report-only', 'x-nonce']

/**
 * Runs before every request its matcher admits. It sets the Content-Security-Policy with a fresh nonce
 * (docs/specs/2026-10-17-production-hardening.md, section 5.3): on the request, where Next reads the nonce and
 * puts it on every script of the page it renders, and on the response. It keeps the Supabase session fresh: it
 * refreshes an expiring token and writes the new cookies to both the request (for the page about to render) and
 * the response (for the browser). It makes no access decisions; pages do that through `lib/auth`.
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  for (const name of CLIENT_CHOSEN) request.headers.delete(name)
  const csp = cspHeaders({
    mode: cspModeOf(process.env),
    routeClass: routeClassOf(request.nextUrl.pathname),
    nonce: newNonce(),
    sources: cspSourcesOf(process.env, availableChains(), request.nextUrl.host),
    reportOrigin: request.nextUrl.origin,
  })
  for (const [name, value] of Object.entries(csp.request)) request.headers.set(name, value)

  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet, headers) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value)
          }
          response = NextResponse.next({ request })
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options)
          }
          // A response that carries a refreshed session must never be stored by a shared cache.
          for (const [key, value] of Object.entries(headers ?? {})) {
            response.headers.set(key, value)
          }
        },
      },
    },
  )

  // Validates the token and refreshes it if needed. Nothing may run between creating the client
  // and this call.
  await supabase.auth.getClaims()

  for (const [name, value] of Object.entries(csp.response)) response.headers.set(name, value)
  return response
}

export const config = {
  // The report endpoint is skipped too: its posts need no session and carry no page.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|assets/|api/csp-report|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
