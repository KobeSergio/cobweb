import { getAddress, type Address, type Hex } from 'viem'
import type { AirdropRow, AirdropState, AirdropView, BatchEntry, RecipientRow } from './airdrop-types'

/**
 * The Airdrop view, pure (docs/specs/2026-10-15-airdrop-settings.md, section 6.1), for the browser and the
 * server: the batches a list is sent in, History's rows, and the view from a read or from Cobweb's record alone.
 */

/** Wallets in one `airdropNFTs` transaction (provisional until the gas measurement, section 12). */
export const AIRDROP_MAX_RECIPIENTS = 500
/** Tokens in one `airdropNFTs` transaction, a burn included. */
export const AIRDROP_MAX_TOKENS = 1_000
/** Tokens one address gets from one list, its repeated lines summed. */
export const AIRDROP_MAX_PER_ADDRESS = 1_000
/** Where a burn mints its tokens: the dead address, which nobody can use (MASTER_PLAN, Contracts: burn). */
export const BURN_ADDRESS: Address = '0x000000000000000000000000000000000000dEaD'

/** An `airdrops` row as the server reads it: the fee as text, so no wei is lost. */
export type AirdropDbRow = {
  tx_hash: string
  kind: string
  recipients: number
  tokens: number
  fee_paid_wei: string
  first_token_id: number
  last_token_id: number
  block: number
  confirmed_at: string
  /** The block's time, set once the indexer has read the airdrop. */
  block_time: string | null
}

/** An `airdrop_recipients` row as the server reads it. */
export type RecipientDbRow = {
  tx_hash: string
  recipient: string
  tokens: number
  first_token_id: number
  block_time: string
}

/** The tokens of some entries. */
export function tokensOf(entries: readonly BatchEntry[]): number {
  return entries.reduce((sum, entry) => sum + entry.amount, 0)
}

/**
 * The entries in batches, in the list's order: a new batch starts when the next entry would take the current
 * one past 500 wallets or 1,000 tokens. An entry carries 1 to 1,000 tokens, so each fits a batch.
 */
export function batchesOf(entries: readonly BatchEntry[]): BatchEntry[][] {
  const batches: BatchEntry[][] = []
  let current: BatchEntry[] = []
  let tokens = 0
  for (const entry of entries) {
    if (
      current.length > 0 &&
      (current.length === AIRDROP_MAX_RECIPIENTS || tokens + entry.amount > AIRDROP_MAX_TOKENS)
    ) {
      batches.push(current)
      current = []
      tokens = 0
    }
    current.push({ address: entry.address, amount: entry.amount })
    tokens += entry.amount
  }
  if (current.length > 0) batches.push(current)
  return batches
}

/**
 * The rows as History shows them, in the order read (newest first). When is the block's time once the indexer has
 * read the airdrop, else the time Cobweb recorded it, in Unix seconds (docs/specs/2026-10-16-indexer-overview.md,
 * decision 21).
 */
export function airdropRowsOf(rows: AirdropDbRow[]): AirdropRow[] {
  return rows.map((row) => ({
    txHash: row.tx_hash as Hex,
    kind: row.kind === 'burn' ? 'burn' : 'airdrop',
    recipients: row.recipients,
    tokens: row.tokens,
    feePaidWei: row.fee_paid_wei,
    firstTokenId: row.first_token_id,
    lastTokenId: row.last_token_id,
    block: row.block,
    confirmedAt: Math.floor(Date.parse(row.block_time ?? row.confirmed_at) / 1000),
  }))
}

/**
 * The view from a read: the fee, the owner, minted and left at the read's block, its time as `readAt`. Without
 * one (the chain did not answer), Cobweb's record alone: the history, the collection's supply and the copy's time.
 * `counted` says whether the indexer has read every block since the deploy.
 */
export function airdropViewOf(
  base: { chainId: number; contract: Address; maxSupply: number; readAt: number; counted: boolean },
  history: AirdropRow[],
  state: AirdropState | null,
): AirdropView {
  if (!state)
    return {
      chainId: base.chainId,
      contract: base.contract,
      owner: null,
      feePerTokenWei: null,
      maxSupply: base.maxSupply,
      totalMinted: null,
      left: null,
      history,
      blockTimestamp: base.readAt,
      readAt: base.readAt,
      chainReachable: false,
      counted: base.counted,
    }
  return {
    chainId: base.chainId,
    contract: base.contract,
    owner: state.owner,
    feePerTokenWei: state.feePerTokenWei,
    maxSupply: state.maxSupply,
    totalMinted: state.totalMinted,
    left: Math.max(0, state.maxSupply - state.totalMinted),
    history,
    blockTimestamp: state.blockTimestamp,
    readAt: state.blockTimestamp,
    chainReachable: true,
    counted: base.counted,
  }
}

/** Token ids from the first to the last, as History writes them: `#41 to #50`, or `#41` for one. */
export function tokenIdsText(first: number, last: number): string {
  return first === last ? `#${first}` : `#${first} to #${last}`
}

/**
 * By recipient's search as the server applies it (docs/specs/2026-10-16-indexer-overview.md, section 7.3): the
 * hex digits typed, lowercase, a leading 0x dropped, so it matches any part of a stored address and carries no
 * LIKE wildcard.
 */
export function recipientSearchOf(input: string): string {
  const text = input.trim().toLowerCase()
  return (text.startsWith('0x') ? text.slice(2) : text).replace(/[^0-9a-f]/g, '')
}

/** The rows as By recipient shows them, in the order read: wallets checksummed, the dead address a burn. */
export function recipientRowsOf(rows: RecipientDbRow[]): RecipientRow[] {
  return rows.map((row) => ({
    txHash: row.tx_hash as Hex,
    wallet: getAddress(row.recipient),
    tokens: row.tokens,
    firstTokenId: row.first_token_id,
    lastTokenId: row.first_token_id + row.tokens - 1,
    at: Math.floor(Date.parse(row.block_time) / 1000),
    burn: row.recipient.toLowerCase() === BURN_ADDRESS.toLowerCase(),
  }))
}

/** By recipient as CSV rows, the header first, then one row per run in the order given. */
export function recipientsCsvRows(rows: RecipientRow[]): string[][] {
  return [
    ['date_utc', 'wallet', 'tokens', 'token_ids', 'tx_hash'],
    ...rows.map((row) => [
      new Date(row.at * 1000).toISOString(),
      row.wallet,
      String(row.tokens),
      tokenIdsText(row.firstTokenId, row.lastTokenId),
      row.txHash,
    ]),
  ]
}
