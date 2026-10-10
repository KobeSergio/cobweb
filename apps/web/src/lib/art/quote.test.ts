import { describe, expect, it } from 'vitest'
import { feeReady, quoteExpired, quoteTotalWei } from './quote'

describe('quoteTotalWei', () => {
  it('is the rate times the tokens, exactly, past 2^53', () => {
    expect(quoteTotalWei('generative', 25_000_000_000_000n, 10_000)).toBe(250_000_000_000_000_000n)
    expect(quoteTotalWei('one_of_one', 3n, 7)).toBe(21n)
  })

  it('is zero for a single asset', () => {
    expect(quoteTotalWei('single_asset', 25_000_000_000_000n, 4_000)).toBe(0n)
  })
})

describe('quoteExpired', () => {
  it('expires after the last second, not at it', () => {
    expect(quoteExpired(100, 99)).toBe(false)
    expect(quoteExpired(100, 100)).toBe(false)
    expect(quoteExpired(100, 101)).toBe(true)
  })
})

describe('feeReady (Review Focus 5)', () => {
  it('refuses an unconfigured chain and a zero rate, which would make a free job', () => {
    expect(feeReady(null)).toBe(false)
    expect(feeReady(0n)).toBe(false)
    expect(feeReady(1n)).toBe(true)
  })
})
