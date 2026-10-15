import type { Address } from 'viem'
import { describe, expect, it } from 'vitest'
import { CHECK_MAX, collectionCheck, NEGATIVE_MAX, NEGATIVE_TTL_MS } from './collection-check.ts'

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

  it('keeps a false answer read again as the newest, so the next one past the limit forgets another', async () => {
    const { read, asked } = counted(async () => false)
    let now = 0
    const check = collectionCheck(read, () => now)
    await check(31337, address(0))
    now = 1
    for (let n = 1; n < NEGATIVE_MAX; n++) await check(31337, address(n))
    now = NEGATIVE_TTL_MS
    await check(31337, address(0))
    await check(31337, address(NEGATIVE_MAX))
    expect(asked).toHaveLength(NEGATIVE_MAX + 2)
    expect(await check(31337, address(0))).toBe(false)
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

  it('answers busy without reading once 50 reads are in flight on a chain, and keeps answering what it holds', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    // A is a collection, read at once; every other address waits at the gate and is not one.
    const { read, asked } = counted(async (target) => {
      if (target !== A) await gate
      return target === A
    })
    const check = collectionCheck(read, () => 0)
    expect(await check(31337, A)).toBe(true)
    const flying = Array.from({ length: CHECK_MAX }, (_, n) => check(31337, address(n)))
    expect(check.pending(31337)).toBe(CHECK_MAX)
    const busy = check(31337, address(CHECK_MAX))
    expect(asked).toHaveLength(CHECK_MAX + 1)
    expect(await busy).toBe('busy')
    // The answer held, an ask that shares a read in flight and another chain go on as before.
    expect(await check(31337, A)).toBe(true)
    const shared = check(31337, address(0))
    const elsewhere = check(1, address(CHECK_MAX))
    expect([asked.length, check.pending(31337), check.pending(1)]).toEqual([CHECK_MAX + 2, CHECK_MAX, 1])
    release()
    expect(await Promise.all([...flying, shared, elsewhere])).toEqual(Array(CHECK_MAX + 2).fill(false))
    expect([check.pending(31337), check.pending(1)]).toEqual([0, 0])
    expect(await check(31337, address(CHECK_MAX))).toBe(false)
    expect(asked).toHaveLength(CHECK_MAX + 3)
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
