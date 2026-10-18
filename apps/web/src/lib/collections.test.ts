import { describe, expect, it } from 'vitest'
import {
  DRAFT_CAP_DEFAULT,
  DRAFT_CAP_REFUSAL,
  draftCapOf,
  draftCapSentence,
  RESERVED_SLUGS,
  slugSchema,
} from './collections'

describe('the mint page link', () => {
  it('refuses the reserved links, demo among them, as the database does', () => {
    expect(RESERVED_SLUGS).toContain('demo')
    for (const slug of ['demo', 'api', 'privacy'])
      expect(slugSchema.safeParse(slug).error?.issues[0]?.message).toBe(
        'That link is reserved. Choose another.',
      )
    expect(slugSchema.safeParse('demo-drop').success).toBe(true)
  })
})

describe('the draft cap (docs/specs/2026-10-17-production-hardening.md, section 6.4)', () => {
  it("words the dialog's refusal with the wallet's cap", () => {
    expect(draftCapSentence(20)).toBe(
      'This wallet already has 20 collections that are not deployed, the most it can hold. Delete a draft or deploy one, then create this one.',
    )
    expect(draftCapSentence(22)).toContain('already has 22 collections')
  })

  it("reads the cap from the trigger's refusal and its detail", () => {
    expect(draftCapOf({ code: '23514', message: DRAFT_CAP_REFUSAL, details: '20' })).toBe(20)
    expect(draftCapOf({ code: '23514', message: DRAFT_CAP_REFUSAL, details: '1000' })).toBe(1000)
  })

  it('reads the default cap when the refusal has no usable detail', () => {
    expect(draftCapOf({ code: '23514', message: DRAFT_CAP_REFUSAL })).toBe(DRAFT_CAP_DEFAULT)
    expect(draftCapOf({ code: '23514', message: DRAFT_CAP_REFUSAL, details: 'many' })).toBe(DRAFT_CAP_DEFAULT)
  })

  it('reads no cap from another 23514, another code or no error', () => {
    expect(
      draftCapOf({ code: '23514', message: 'Keep the name under 64 characters.', details: '20' }),
    ).toBeNull()
    expect(draftCapOf({ code: '42501', message: DRAFT_CAP_REFUSAL, details: '20' })).toBeNull()
    expect(draftCapOf(null)).toBeNull()
  })
})
