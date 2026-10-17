import { collectionAbi } from '@cobweb/shared/collection-abi'
import { getAbiItem, zeroAddress, type Address, type Hex } from 'viem'
import { byBlock } from './indexer-plan.ts'

/**
 * What a segment's logs record (docs/specs/2026-10-16-indexer-overview.md, section 6.4), pure, in the shape
 * `indexer_record` takes: addresses lowercase, times in Unix seconds, wei as decimal strings. Within a
 * transaction, a collection's transfers from the zero address since its last mint or airdrop event belong to
 * its next `TokensMinted`, `TokensDelegateMinted` or `NFTsAirdropped`, the order the contract emits them in.
 * A mint or an airdrop that does not pair with its transfers is not recorded and is named among the unpaired,
 * while every `Transfer` still moves its token's owner.
 */

/** Where a burn mints its tokens (MASTER_PLAN, Contracts: burn), lowercase as the tables hold it. */
export const DEAD_ADDRESS: Address = '0x000000000000000000000000000000000000dead'

/** The five events the indexer reads (decision 5), from the collection's ABI. */
export const INDEX_EVENTS = [
  getAbiItem({ abi: collectionAbi, name: 'Transfer' }),
  getAbiItem({ abi: collectionAbi, name: 'TokensMinted' }),
  getAbiItem({ abi: collectionAbi, name: 'TokensDelegateMinted' }),
  getAbiItem({ abi: collectionAbi, name: 'NFTsAirdropped' }),
  getAbiItem({ abi: collectionAbi, name: 'MintFundsWithdrawn' }),
] as const

export type IndexEventName = (typeof INDEX_EVENTS)[number]['name']

/** A log as viem's `getLogs` answers it for `INDEX_EVENTS` with `strict: true`: decoded, its args by name. */
export type IndexLog = {
  address: Address
  eventName: IndexEventName
  args: unknown
  blockNumber: bigint
  logIndex: number
  transactionHash: Hex
}

export type MintRecord = {
  collectionId: string
  tx: Hex
  /** The mint event's own log index. */
  logIndex: number
  block: number
  blockTime: number
  recipient: Address
  /** The vault whose allowance a delegated mint used; null for `TokensMinted`. */
  vault: Address | null
  groupId: number
  amount: number
  firstTokenId: number
}

export type OwnerRecord = {
  collectionId: string
  tokenId: number
  owner: Address
  block: number
  logIndex: number
}

/** Consecutive transfers of one airdrop to one address. */
export type RunRecord = { recipient: Address; tokens: number; firstTokenId: number }

export type AirdropRecord = {
  collectionId: string
  tx: Hex
  block: number
  blockTime: number
  kind: 'airdrop' | 'burn'
  recipients: number
  tokens: number
  feePaidWei: string
  firstTokenId: number
  lastTokenId: number
  runs: RunRecord[]
}

export type WithdrawalRecord = {
  collectionId: string
  tx: Hex
  block: number
  payoutAddress: Address
  amountWei: string
}

export type Records = {
  mints: MintRecord[]
  owners: OwnerRecord[]
  airdrops: AirdropRecord[]
  withdrawals: WithdrawalRecord[]
}

/** The events that pair with transfers, whose blocks' times the records carry. */
const PAIRING: ReadonlySet<IndexEventName> = new Set([
  'TokensMinted',
  'TokensDelegateMinted',
  'NFTsAirdropped',
])

/** The largest group id `mints.group_id` takes: 2^53 - 1, the largest whole number JSON carries exactly. */
const MAX_GROUP_ID = BigInt(Number.MAX_SAFE_INTEGER)

const lower = (address: Address) => address.toLowerCase() as Address

/** The blocks with a mint or an airdrop event, ascending: the blocks whose times `recordsOf` needs. */
export function eventBlocksOf(logs: readonly IndexLog[]): bigint[] {
  const blocks = new Set<bigint>()
  for (const log of logs) if (PAIRING.has(log.eventName)) blocks.add(log.blockNumber)
  return [...blocks].sort(byBlock)
}

/** A transfer from the zero address waiting for its mint or airdrop event. */
type Pending = { tokenId: bigint; to: Address }

/** The lowest and the highest of the pending ids. */
function idRange(pending: readonly Pending[]): { first: bigint; last: bigint } {
  let first = pending[0]!.tokenId
  let last = first
  for (const { tokenId } of pending) {
    if (tokenId < first) first = tokenId
    if (tokenId > last) last = tokenId
  }
  return { first, last }
}

/** Consecutive pending transfers to one address, in log order. */
function runsOf(pending: readonly Pending[]): RunRecord[] {
  const runs: RunRecord[] = []
  for (const { tokenId, to } of pending) {
    const run = runs[runs.length - 1]
    if (run && run.recipient === to) run.tokens += 1
    else runs.push({ recipient: to, tokens: 1, firstTokenId: Number(tokenId) })
  }
  return runs
}

/**
 * The records of a segment's logs for the collections given (lowercase contract to collection id; a log of
 * any other address is ignored), walking each transaction's logs in log index order. `blockTimes` holds the
 * time of each block `eventBlocksOf` names. `unpaired` names the transaction of each mint or airdrop that did
 * not pair, once per event, and once per collection whose transfers from the zero address were left at the
 * end of a transaction.
 */
export function recordsOf(
  logs: readonly IndexLog[],
  collections: ReadonlyMap<string, string>,
  blockTimes: ReadonlyMap<bigint, number>,
): { records: Records; unpaired: Hex[] } {
  const records: Records = { mints: [], owners: [], airdrops: [], withdrawals: [] }
  const unpaired: Hex[] = []
  const owners = new Map<string, OwnerRecord>()
  const ours = logs
    .filter((log) => collections.has(log.address.toLowerCase()))
    .sort((a, b) => byBlock(a.blockNumber, b.blockNumber) || a.logIndex - b.logIndex)
  let tx: Hex | null = null
  let pending = new Map<string, Pending[]>()
  const endTransaction = () => {
    for (const left of pending.values()) if (left.length && tx) unpaired.push(tx)
    pending = new Map()
  }

  for (const log of ours) {
    const hash = log.transactionHash.toLowerCase() as Hex
    if (hash !== tx) {
      endTransaction()
      tx = hash
    }
    const collectionId = collections.get(log.address.toLowerCase())!
    const block = Number(log.blockNumber)
    const timeOf = () => {
      const time = blockTimes.get(log.blockNumber)
      if (time === undefined) throw new Error(`The time of block ${log.blockNumber} was not read.`)
      return time
    }
    /** The collection's pending transfers, which this event takes. */
    const take = () => {
      const taken = pending.get(collectionId) ?? []
      pending.delete(collectionId)
      return taken
    }

    if (log.eventName === 'Transfer') {
      const { from, to, tokenId } = log.args as { from: Address; to: Address; tokenId: bigint }
      const owner = lower(to)
      // Only the latest transfer of each token is kept: the logs run in block and log index order.
      owners.set(`${collectionId}:${tokenId}`, {
        collectionId,
        tokenId: Number(tokenId),
        owner,
        block,
        logIndex: log.logIndex,
      })
      if (lower(from) === zeroAddress)
        pending.set(collectionId, [...(pending.get(collectionId) ?? []), { tokenId, to: owner }])
    } else if (log.eventName === 'TokensMinted' || log.eventName === 'TokensDelegateMinted') {
      const args = log.args as { vault?: Address; recipient: Address; amount: bigint; mintGroup: bigint }
      const transfers = take()
      const recipient = lower(args.recipient)
      const paired =
        transfers.length > 0 &&
        BigInt(transfers.length) === args.amount &&
        transfers.every((transfer) => transfer.to === recipient) &&
        args.mintGroup <= MAX_GROUP_ID
      if (!paired) {
        unpaired.push(hash)
        continue
      }
      records.mints.push({
        collectionId,
        tx: hash,
        logIndex: log.logIndex,
        block,
        blockTime: timeOf(),
        recipient,
        vault: log.eventName === 'TokensDelegateMinted' && args.vault ? lower(args.vault) : null,
        groupId: Number(args.mintGroup),
        amount: transfers.length,
        firstTokenId: Number(idRange(transfers).first),
      })
    } else if (log.eventName === 'NFTsAirdropped') {
      const args = log.args as { recipients: bigint; amount: bigint; feePaid: bigint }
      const transfers = take()
      // An airdrop of 0 tokens records nothing; a count that does not match its transfers is unpaired.
      if (args.amount === 0n && transfers.length === 0) continue
      if (BigInt(transfers.length) !== args.amount) {
        unpaired.push(hash)
        continue
      }
      const runs = runsOf(transfers)
      const { first, last } = idRange(transfers)
      records.airdrops.push({
        collectionId,
        tx: hash,
        block,
        blockTime: timeOf(),
        kind:
          args.recipients === 1n && runs.every((run) => run.recipient === DEAD_ADDRESS) ? 'burn' : 'airdrop',
        recipients: Number(args.recipients),
        tokens: transfers.length,
        feePaidWei: args.feePaid.toString(),
        firstTokenId: Number(first),
        lastTokenId: Number(last),
        runs,
      })
    } else {
      const args = log.args as { payoutAddress: Address; amount: bigint }
      records.withdrawals.push({
        collectionId,
        tx: hash,
        block,
        payoutAddress: lower(args.payoutAddress),
        amountWei: args.amount.toString(),
      })
    }
  }
  endTransaction()
  records.owners = [...owners.values()]
  return { records, unpaired }
}
