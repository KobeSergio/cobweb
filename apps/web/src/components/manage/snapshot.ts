import { getAddress, isAddress } from 'viem'
import { sampleAddress, type Address } from '@/lib/demo'

/** One holder of the snapshotted collection and how many of its tokens they hold. */
export type Holder = { address: Address; balance: number }

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

/**
 * The holders of an ERC-721 collection on a chain.
 * Seam: a serverless function (MASTER_PLAN, Holder snapshot import) that checks the session, reads
 * `totalSupply()` and loops `ownerOf(id)` in batches over a private RPC endpoint, then sums the
 * balance per owner. No indexer. It reports a contract that is not an ERC-721 or has no tokens.
 * Here it returns a stable sample list for the address.
 */
export async function fetchHolders(chainId: number, contract: string): Promise<Holder[]> {
  await wait(900)
  const seed = Number.parseInt(getAddress(contract).slice(2, 10), 16) + chainId
  const holders: Holder[] = []
  for (let index = 0; index < 24; index++) {
    const balance = 1 + ((seed + index * 7) % 5 === 0 ? 4 : (seed + index) % 3)
    holders.push({ address: getAddress(sampleAddress(seed + index)), balance })
  }
  return holders
}
