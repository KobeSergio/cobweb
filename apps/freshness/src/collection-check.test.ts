import type { Address } from 'viem'
import { describe, expect, it } from 'vitest'
import { collectionCheck, NEGATIVE_MAX, NEGATIVE_TTL_MS } from './collection-check.ts'

const A: Address = '0x0409454C375c8a6aB05383bFB6D9FcDe9ebB8F85'

/** A fake factory read that counts its asks and answers what `answer` says. */
function counted(answer: (address: Address) => Promise<boolean>) {
  const asked: string[] = []
  const read = async (chainId: number, address: Address) => {
    asked.push(`${chainId}:${address}`)
    return answer(address)
  }
  return { read, asked }
}

/** The address of index `n`, distinct for every n. */
const address = (n: number) => `0x${n.toString(16).padStart(40, '0')}` as Address

describe('collectionCheck (docs/specs/2026-10-16-freshness-server.md, section 6.3)', () => {
  it('keeps a true answer for the life of the process, whatever the case', async () => {
    const { read, asked } = counted(async () => true)
    let now = 0
    const check = collectionCheck(read, () => now)
    expect(await check(31337, A)).toBe(true)
    now = 365 * 86_400_000
    expect(await check(31337, A.toLowerCase() as Address)).toBe(true)
    expect(asked).toEqual([`31337:${A}`])
  })

  it('keeps a false answer for 60 s, then asks again', async () => {
    const { read, asked } = counted(async () => false)
    let now = 0
    const check = collectionCheck(read, () => now)
    expect(await check(31337, A)).toBe(false)
    now = NEGATIVE_TTL_MS - 1
    expect(await check(31337, A)).toBe(false)
    expect(asked).toHaveLength(1)
    now = NEGATIVE_TTL_MS
    expect(await check(31337, A)).toBe(false)
    expect(asked).toHaveLength(2)
  })

  it('keys by chain: the same address on another chain is asked there', async () => {
    const { read, asked } = counted(async () => true)
    const check = collectionCheck(read, () => 0)
    await check(31337, A)
    await check(1, A)
    expect(asked).toEqual([`31337:${A}`, `1:${A}`])
  })

  it('keeps at most 10,000 false answers, forgetting the oldest first', async () => {
    const { read, asked } = counted(async () => false)
    const check = collectionCheck(read, () => 0)
    for (let n = 0; n <= NEGATIVE_MAX; n++) await check(31337, address(n))
    expect(asked).toHaveLength(NEGATIVE_MAX + 1)
    await check(31337, address(1))
    expect(asked).toHaveLength(NEGATIVE_MAX + 1)
    await check(31337, address(0))
    expect(asked).toHaveLength(NEGATIVE_MAX + 2)
  })

  it('shares one read between two asks of one address in flight', async () => {
    let settle: (answer: boolean) => void = () => {}
    const { read, asked } = counted(() => new Promise<boolean>((resolve) => (settle = resolve)))
    const check = collectionCheck(read, () => 0)
    const first = check(31337, A)
    const second = check(31337, A.toLowerCase() as Address)
    settle(true)
    expect(await Promise.all([first, second])).toEqual([true, true])
    expect(asked).toHaveLength(1)
  })

  it('keeps nothing from a failed read: the ask fails and the next one reads again', async () => {
    let fail = true
    const { read, asked } = counted(async () => {
      if (fail) throw new Error('fetch failed')
      return true
    })
    const check = collectionCheck(read, () => 0)
    await expect(check(31337, A)).rejects.toThrow('fetch failed')
    fail = false
    expect(await check(31337, A)).toBe(true)
    expect(asked).toHaveLength(2)
  })
})
