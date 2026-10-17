import { UserRejectedRequestError } from 'viem'
import { describe, expect, it } from 'vitest'
import { signInFailureOf } from './sign-in-failure'

describe('signInFailureOf (docs/specs/2026-10-17-production-hardening.md, section 6.2)', () => {
  it("reads a wallet's refusal as rejected, by its words or its code", () => {
    expect(signInFailureOf(new UserRejectedRequestError(new Error('User rejected the request.')))).toBe(
      'rejected',
    )
    expect(signInFailureOf(new Error('MetaMask Tx Signature: User denied message signature.'))).toBe(
      'rejected',
    )
    expect(signInFailureOf({ code: 4001, message: 'Request refused' })).toBe('rejected')
  })

  it("reads Supabase Auth's captcha_failed as captcha", () => {
    expect(
      signInFailureOf({ code: 'captcha_failed', message: 'captcha protection: request disallowed' }),
    ).toBe('captcha')
  })

  it('reads captcha_failed before the rejection words, so a captcha message that says denied is still captcha', () => {
    expect(signInFailureOf({ code: 'captcha_failed', message: 'captcha protection: request denied' })).toBe(
      'captcha',
    )
  })

  it('reads anything else as other', () => {
    for (const error of [
      new Error('Signature verification failed'),
      { code: 'over_request_rate_limit' },
      null,
      'x',
    ])
      expect(signInFailureOf(error)).toBe('other')
  })
})
