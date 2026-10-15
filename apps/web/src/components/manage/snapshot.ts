import { getAddress, isAddress } from 'viem'
import type { ActionResult } from '@/lib/art/result'
import { sampleAddress } from '@/lib/demo'
import type { Holder, HolderSnapshot } from '@/lib/manage/holders'

export type { Holder } from '@/lib/manage/holders'

/** Each holder's amount: the tokens they hold (legacy's default), or one number for everyone. */
export type SnapshotAmount = { kind: 'balance' } | { kind: 'fixed'; amount: number }

/**
 * Holders as recipient lines (`address,amount`), the most tokens first, as legacy listed them.
 * Holders with a zero balance are left out; balances above `maxAmount` are capped to it.
 */
export function holdersToText(holders: Holder[], amount: SnapshotAmount, maxAmount: number): string {
  return [...holders]
    .filter((holder) => holder.balance > 0)
    .sort((a, b) => b.balance - a.balance || a.address.localeCompare(b.address))
    .map((holder) => {
      const value = amount.kind === 'fixed' ? amount.amount : Math.min(holder.balance, maxAmount)
      return `${holder.address},${value}`
    })
    .join('\n')
}

/** Why a contract address cannot be snapshotted, or null. */
export function snapshotAddressError(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return 'Enter the address of the collection to snapshot.'
  if (!isAddress(trimmed))
    return /^0x[0-9a-fA-F]{40}$/.test(trimmed)
      ? 'The checksum does not match. Check the address for a typo.'
      : 'Enter a full 0x address, 42 characters.'
  return null
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** The block sample mode's snapshot reads at. */
export const SAMPLE_SNAPSHOT_BLOCK = 21_500_000

/**
 * Sample mode's holder snapshot (docs/specs/2026-10-15-whitelist.md, section 8): after 900 ms, a stable list of
 * 24 holders for the address and chain, the most tokens first, at block 21,500,000, their tokens together as the
 * supply. The real one is the `fetchHolders` action (app/actions/snapshot.ts), which reads the chain at one block.
 */
export async function sampleFetchHolders(
  chainId: number,
  contract: string,
): Promise<ActionResult<HolderSnapshot>> {
  await wait(900)
  const seed = Number.parseInt(getAddress(contract).slice(2, 10), 16) + chainId
  const holders: Holder[] = []
  for (let index = 0; index < 24; index++) {
    const balance = 1 + ((seed + index * 7) % 5 === 0 ? 4 : (seed + index) % 3)
    holders.push({ address: getAddress(sampleAddress(seed + index)), balance })
  }
  holders.sort(
    (a, b) => b.balance - a.balance || a.address.toLowerCase().localeCompare(b.address.toLowerCase()),
  )
  return {
    ok: true,
    data: {
      holders,
      block: SAMPLE_SNAPSHOT_BLOCK,
      supply: holders.reduce((sum, holder) => sum + holder.balance, 0),
    },
  }
}
