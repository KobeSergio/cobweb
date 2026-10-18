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

  it('words a cap of 1 in the singular, and a cap of 0 as none to delete or deploy', () => {
    expect(draftCapSentence(1)).toBe(
      'This wallet already has 1 collection that is not deployed, the most it can hold. Delete a draft or deploy one, then create this one.',
    )
    expect(draftCapSentence(2)).toBe(
      'This wallet already has 2 collections that are not deployed, the most it can hold. Delete a draft or deploy one, then create this one.',
    )
    expect(draftCapSentence(0)).toBe(
      'This wallet cannot hold a collection that is not deployed. Ask support to raise its limit.',
    )
  })

  it("reads the cap from the trigger's refusal and its detail", () => {
    expect(draftCapOf({ code: '23514', message: DRAFT_CAP_REFUSAL, details: '20' })).toBe(20)
    expect(draftCapOf({ code: '23514', message: DRAFT_CAP_REFUSAL, details: '1000' })).toBe(1000)
    expect(draftCapOf({ code: '23514', message: DRAFT_CAP_REFUSAL, details: '0' })).toBe(0)
  })

  it('reads the default cap when the refusal has no usable detail', () => {
    expect(draftCapOf({ code: '23514', message: DRAFT_CAP_REFUSAL })).toBe(DRAFT_CAP_DEFAULT)
    expect(draftCapOf({ code: '23514', message: DRAFT_CAP_REFUSAL, details: 'many' })).toBe(DRAFT_CAP_DEFAULT)
  })

  it('reads a detail as the cap only when it is digits alone, which Number() would not tell from a blank', () => {
    for (const details of ['', ' ', '\t', ' 20', '20 ', '1e3', '20.0', '-1', '0x14', '+20'])
      expect(draftCapOf({ code: '23514', message: DRAFT_CAP_REFUSAL, details }), details).toBe(
        DRAFT_CAP_DEFAULT,
      )
  })

  it('reads no cap from another 23514, another code or no error', () => {
    expect(
      draftCapOf({ code: '23514', message: 'Keep the name under 64 characters.', details: '20' }),
    ).toBeNull()
    expect(draftCapOf({ code: '42501', message: DRAFT_CAP_REFUSAL, details: '20' })).toBeNull()
    expect(draftCapOf(null)).toBeNull()
  })
})
