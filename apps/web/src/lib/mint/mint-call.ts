import { collectionAbi } from '@cobweb/shared/collection-abi'
import { decodeEventLog, zeroAddress, type Address, type TransactionReceipt } from 'viem'
import type { FeeSnapshot } from '@/lib/demo/types'

/**
 * The mint as the collection takes it (docs/specs/2026-10-16-mint-page-live-data.md, section 7.5), pure: the
 * total the contract's `quoteBatchMint` charges, the call (`batchMint`, or `delegateMint` with a vault), and the
 * ids a receipt minted to the wallet.
 */

/** What the page mints: the group, how many, against whose allowance, and the total it sends. */
export type MintParams = {
  contract: Address
  chainId: number
  groupId: number
  amount: number
  /** Mint against this vault's allowance (delegate.xyz). Tokens still go to the caller. */
  vault: Address | null
  /** The state's quote for `amount` tokens, in wei: exactly what the contract charges. */
  valueWei: bigint
  account: Address
}

/** The call the wallet sends, as wagmi's `simulateContract` takes it. */
export type MintCall = {
  address: Address
  abi: typeof collectionAbi
  functionName: 'batchMint' | 'delegateMint'
  args: readonly [bigint, bigint] | readonly [bigint, bigint, Address]
  value: bigint
  chainId: number
  account: Address
}

export type Quote = { priceWei: bigint; feeWei: bigint; totalWei: bigint; quantity: number }

/**
 * The contract's `quoteBatchMint`: per token the price plus the flat fee and the basis points of the price, the
 * division rounding down as Solidity's does, times the quantity.
 */
export function quoteOf(
  fees: Pick<FeeSnapshot, 'mintFeeFlatWei' | 'mintFeeBps'>,
  priceWei: string,
  quantity: number,
): Quote {
  const price = BigInt(priceWei)
  const count = BigInt(quantity)
  const feeWei = (BigInt(fees.mintFeeFlatWei) + (price * BigInt(fees.mintFeeBps)) / 10_000n) * count
  return { priceWei: price * count, feeWei, totalWei: price * count + feeWei, quantity }
}

/** The call for a mint: `delegateMint(amount, group, vault)` with a vault, else `batchMint(amount, group)`. */
export function mintCallOf(params: MintParams): MintCall {
  const amount = BigInt(params.amount)
  const group = BigInt(params.groupId)
  return {
    address: params.contract,
    abi: collectionAbi,
    functionName: params.vault ? 'delegateMint' : 'batchMint',
    args: params.vault ? [amount, group, params.vault] : [amount, group],
    value: params.valueWei,
    chainId: params.chainId,
    account: params.account,
  }
}

/**
 * The ids a receipt minted to the receiver, sorted: the collection's `Transfer` logs from the zero address to it.
 * A transfer between holders, another contract's log and a mint to someone else are not this mint's.
 */
export function mintedTokenIds(
  receipt: Pick<TransactionReceipt, 'logs'>,
  contract: Address,
  receiver: Address,
): number[] {
  const ids: number[] = []
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== contract.toLowerCase()) continue
    try {
      const event = decodeEventLog({
        abi: collectionAbi,
        eventName: 'Transfer',
        data: log.data,
        topics: log.topics,
      })
      // viem decodes any event of the ABI by its topic, whatever `eventName` says: the name is compared here.
      if (event.eventName !== 'Transfer') continue
      if (
        event.args.from.toLowerCase() === zeroAddress &&
        event.args.to.toLowerCase() === receiver.toLowerCase()
      )
        ids.push(Number(event.args.tokenId))
    } catch {
      // A log the collection's ABI does not decode.
    }
  }
  return ids.sort((a, b) => a - b)
}
