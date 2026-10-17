/**
 * Cloudflare Turnstile, the browser check on wallet sign-in (docs/specs/2026-10-17-production-hardening.md,
 * section 6.1): the site key and the script's loader. The token travels with the signed message to Supabase Auth,
 * which verifies it with Cloudflare before it checks the signature. Without a site key the check is off, as it is
 * locally and in every verify.
 */

export const TURNSTILE_SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
export const TURNSTILE_LOAD_MS = 15_000

export type TurnstileApi = {
  render(container: HTMLElement, options: Record<string, unknown>): string
  reset(widgetId: string): void
  remove(widgetId: string): void
}

/**
 * The site key, or null when it is blank. `process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY` is written out literally so
 * Next inlines the build's value, as it does `NEXT_PUBLIC_DEMO_DATA`.
 */
export function turnstileSiteKey(
  value: string | undefined = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
): string | null {
  const key = value?.trim()
  return key ? key : null
}

/** One load per document: a second call answers the first one's promise. */
const loads = new WeakMap<Document, Promise<TurnstileApi>>()

/**
 * Appends Turnstile's script once and resolves with `window.turnstile` when it loads; rejects on the script's
 * error or after 15 s. The app's nonced bundle inserts the script, which `'strict-dynamic'` admits.
 */
export function loadTurnstile(
  doc: Document = document,
  timeoutMs = TURNSTILE_LOAD_MS,
): Promise<TurnstileApi> {
  const known = loads.get(doc)
  if (known) return known
  const loaded = new Promise<TurnstileApi>((resolve, reject) => {
    const script = doc.createElement('script')
    const timer = setTimeout(() => reject(new Error('The browser check did not load in time.')), timeoutMs)
    script.src = TURNSTILE_SCRIPT_URL
    script.async = true
    script.onload = () => {
      clearTimeout(timer)
      const api = (doc.defaultView as { turnstile?: TurnstileApi } | null)?.turnstile
      if (api) resolve(api)
      else reject(new Error('The browser check loaded without its interface.'))
    }
    script.onerror = () => {
      clearTimeout(timer)
      reject(new Error('The browser check could not load.'))
    }
    doc.head.appendChild(script)
  })
  loads.set(doc, loaded)
  return loaded
}
