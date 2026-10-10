import { describe, expect, it } from 'vitest'
import { lockArtInput, txHash } from './lock-schemas'
import { NO_CHAIN, NOT_A_HASH } from './result'
import { parse } from './schemas'

describe('lockArtInput', () => {
  it('takes the duplicates choice and a chain id', () => {
    expect(parse(lockArtInput, { allowDuplicates: true, chainId: 31337 })).toEqual({
      ok: true,
      data: { allowDuplicates: true, chainId: 31337 },
    })
  })

  it('refuses a missing or invalid chain', () => {
    expect(parse(lockArtInput, { allowDuplicates: false, chainId: 0 })).toEqual({
      ok: false,
      error: NO_CHAIN,
    })
    expect(parse(lockArtInput, { allowDuplicates: false, chainId: 1.5 })).toEqual({
      ok: false,
      error: NO_CHAIN,
    })
    expect(parse(lockArtInput, { chainId: 1 }).ok).toBe(false)
  })
})

describe('txHash', () => {
  it('lowercases a hash and refuses anything else', () => {
    expect(parse(txHash, `0x${'AB'.repeat(32)}`)).toEqual({ ok: true, data: `0x${'ab'.repeat(32)}` })
    expect(parse(txHash, '0x1234')).toEqual({ ok: false, error: NOT_A_HASH })
  })
})
