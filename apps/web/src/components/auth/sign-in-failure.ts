/** Why a sign-in failed, as the button words it (docs/specs/2026-10-17-production-hardening.md, section 6.2). */
export type SignInFailure = 'rejected' | 'captcha' | 'other'

/**
 * `captcha` for Supabase Auth's `captcha_failed`, `rejected` for a wallet that refused to sign (code 4001, or a
 * message saying it rejected or denied the request), `other` for anything else.
 */
export function signInFailureOf(error: unknown): SignInFailure {
  const { code, message } = (typeof error === 'object' && error !== null ? error : {}) as {
    code?: unknown
    message?: unknown
  }
  if (code === 'captcha_failed') return 'captcha'
  if (code === 4001 || (typeof message === 'string' && /reject|denied/i.test(message))) return 'rejected'
  return 'other'
}
