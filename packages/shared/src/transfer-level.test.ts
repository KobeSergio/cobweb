import { zeroAddress, type Address } from 'viem'
import { describe, expect, it } from 'vitest'
import { levelOf, TRANSFER_LEVELS } from './transfer-level.ts'

const VALIDATOR: Address = '0x721C008fdff27BF06E7E123956E2Fe03B63342e3'

describe('TRANSFER_LEVELS (docs/specs/2026-10-16-freshness-server.md, section 5.1)', () => {
  it('names the three levels Cobweb sends: royalties enforced, royalties not enforced, and locked', () => {
    expect(TRANSFER_LEVELS).toEqual({ enforced: 0, open: 1, locked: 9 })
  })
})

describe('levelOf', () => {
  it('reads no validator, no code, a validator that did not answer, and a level', () => {
    expect(levelOf(zeroAddress, false, null)).toEqual({ kind: 'none', reason: 'zero' })
    expect(levelOf(VALIDATOR, false, null)).toEqual({ kind: 'none', reason: 'no-code' })
    expect(levelOf(VALIDATOR, true, null)).toEqual({ kind: 'unread' })
    expect(levelOf(VALIDATOR, true, 9)).toEqual({ kind: 'level', level: 9 })
    // Level 0 is the default (royalties enforced): a level, not a validator that did not answer.
    expect(levelOf(VALIDATOR, true, 0)).toEqual({ kind: 'level', level: 0 })
  })
})
