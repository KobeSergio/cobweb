import { describe, expect, it } from 'vitest'
import { pointerOf, type RevealTargets } from './reveal-pointer.ts'

const CID = (letter: string) => `bafybei${letter.repeat(52)}`
const REAL = `ipfs://${CID('e')}/`
const PLACEHOLDER = `ipfs://${CID('q')}/metadata.json`
const targets: RevealTargets = { real: REAL, placeholder: PLACEHOLDER, start: PLACEHOLDER }

describe('pointerOf (docs/specs/2026-10-16-freshness-server.md, section 5.1)', () => {
  it('reads revealed for the real job first, so a collection deployed on its real job reads revealed', () => {
    expect(pointerOf(REAL, { real: REAL, placeholder: null, start: REAL })).toBe('revealed')
    expect(pointerOf(REAL, targets)).toBe('revealed')
  })

  it('reads the placeholder for the placeholder job or the deploy-time link, and custom otherwise, exactly', () => {
    expect(pointerOf(PLACEHOLDER, targets)).toBe('placeholder')
    // Deployed on its real job, then pointed at the placeholder job's link: the placeholder, not custom.
    expect(pointerOf(PLACEHOLDER, { real: REAL, placeholder: PLACEHOLDER, start: REAL })).toBe('placeholder')
    expect(
      pointerOf(`ipfs://${CID('s')}`, { real: null, placeholder: null, start: `ipfs://${CID('s')}` }),
    ).toBe('placeholder')
    expect(pointerOf(`ipfs://${CID('f')}/`, targets)).toBe('custom')
    expect(pointerOf(REAL.slice(0, -1), targets)).toBe('custom')
    expect(pointerOf(REAL, { real: null, placeholder: PLACEHOLDER, start: PLACEHOLDER })).toBe('custom')
  })
})
