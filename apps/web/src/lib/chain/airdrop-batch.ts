import { collectionAbi } from '@cobweb/shared/collection-abi'
import { decodeEventLog, decodeFunctionData, zeroAddress, type Address, type Hex } from 'viem'
import { NOT_FROM_WALLET, NOT_THIS_CHANGE, NOT_THIS_CONTRACT } from '@/lib/art/result'
import type { AirdropKind } from '@/lib/manage/airdrop-types'
import { BURN_ADDRESS } from '@/lib/manage/airdrop-view'
import { matchPhaseEvent, type PhaseReceipt } from './phase-events'

/** What a proven batch did, from its calldata and its logs, or why the transaction is not a batch of this collection. */
export type AirdropProof =
  | {
      ok: true
      batch: {
        kind: AirdropKind
        recipients: number
        tokens: number
        feePaidWei: string
        firstTokenId: number
        lastTokenId: number
      }
    }
  | { ok: false; error: string }

const REFUSED: AirdropProof = { ok: false, error: NOT_THIS_CHANGE }

/** The arguments of an `airdropNFTs` call, or null for any other input. */
function airdropArgs(input: Hex) {
  try {
    const call = decodeFunctionData({ abi: collectionAbi, data: input })
    return call.functionName === 'airdropNFTs' ? call.args : null
  } catch {
    // Not a call of the collection's ABI.
    return null
  }
}

/**
 * The ids the collection minted in the receipt, in order: its `Transfer` logs from the zero address. A token a
 * recipient contract passes on in `onERC721Received` adds a `Transfer` from that contract, which is not a mint.
 */
function mintedIds(receipt: PhaseReceipt, contract: string): bigint[] {
  const ids: bigint[] = []
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== contract) continue
    try {
      const event = decodeEventLog({
        abi: collectionAbi,
        eventName: 'Transfer',
        data: log.data,
        topics: log.topics,
      })
      // viem decodes any event of the ABI by its topic, whatever `eventName` says: the name is compared here.
      if (event.eventName !== 'Transfer') continue
      if (event.args.from.toLowerCase() === zeroAddress) ids.push(event.args.tokenId)
    } catch {
      // A log the collection's ABI does not decode.
    }
  }
  return ids.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}

/**
 * Proves a batch from its receipt and the transaction's input (docs/specs/2026-10-15-airdrop-settings.md, section
 * 6.3): sent to the collection (`NOT_THIS_CONTRACT`) from the sign-in wallet (`NOT_FROM_WALLET`), as
 * `matchPhaseEvent` checks; then succeeded, decoded as `airdropNFTs` with as many amounts as recipients and at
 * least one token, carrying `NFTsAirdropped` for the decoded counts (its fee is what was paid), and minting
 * exactly that many consecutive ids (`NOT_THIS_CHANGE`). The kind is a burn when the only recipient is the dead
 * address, compared without case.
 */
export function proveAirdrop(
  receipt: PhaseReceipt,
  input: Hex,
  expected: { contract: Address; from: string },
): AirdropProof {
  const contract = expected.contract.toLowerCase()
  if (receipt.to?.toLowerCase() !== contract) return { ok: false, error: NOT_THIS_CONTRACT }
  if (receipt.from.toLowerCase() !== expected.from.toLowerCase()) return { ok: false, error: NOT_FROM_WALLET }
  if (receipt.status !== 'success') return REFUSED
  const args = airdropArgs(input)
  if (!args) return REFUSED
  const [recipients, amounts] = args
  const tokens = amounts.reduce((sum, amount) => sum + amount, 0n)
  if (recipients.length !== amounts.length || tokens === 0n) return REFUSED
  const event = matchPhaseEvent(receipt, {
    contract: expected.contract,
    from: expected.from,
    event: { eventName: 'NFTsAirdropped', args: { recipients: BigInt(recipients.length), amount: tokens } },
  })
  if (!event.ok) return event
  const ids = mintedIds(receipt, contract)
  const [first] = ids
  const last = ids.at(-1)
  if (first === undefined || last === undefined || BigInt(ids.length) !== tokens) return REFUSED
  if (ids.some((id, index) => id !== first + BigInt(index))) return REFUSED
  const [only] = recipients
  const burn = recipients.length === 1 && only?.toLowerCase() === BURN_ADDRESS.toLowerCase()
  return {
    ok: true,
    batch: {
      kind: burn ? 'burn' : 'airdrop',
      recipients: recipients.length,
      tokens: Number(tokens),
      feePaidWei: String(event.args.feePaid),
      firstTokenId: Number(first),
      lastTokenId: Number(last),
    },
  }
}
