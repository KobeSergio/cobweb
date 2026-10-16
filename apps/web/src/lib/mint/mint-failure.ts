import type { Hex } from 'viem'
import { causes, revertOf, shortMessageOf } from '@/components/deploy/tx-errors'

/**
 * How a mint fails, in words (docs/specs/2026-10-16-mint-page-live-data.md, section 7.6), pure: the error's cause
 * chain read as tx-errors.ts reads it (a rejection is `UserRejectedRequestError` or code 4001, "insufficient
 * funds" anywhere is the balance, the revert is viem's decoded `ContractFunctionRevertedError`), each kind's
 * title and sentence with the revert's counts, and its ways forward. Every kind before the wallet sends says
 * nothing was sent.
 */
export type MintFailureKind =
  | 'rejected'
  | 'phase-closed'
  | 'sold-out'
  | 'quota-exceeded'
  | 'not-listed'
  | 'not-delegate'
  | 'price-changed'
  | 'insufficient-balance'
  | 'contract-wallet'
  | 'wrong-network'
  | 'check-failed'
  | 'wallet-failed'
  | 'reverted'
  | 'unconfirmed'

/** Where the mint was: the check, the wallet, or waiting for the chain. */
export type MintStep = 'checking' | 'wallet' | 'confirming'

/**
 * What a failure's words need: the tokens left and whether the phase's cap or the collection's ran out, what the
 * wallet may still mint, the wallet's message, the hash.
 */
export type MintFailureDetail = {
  left?: number
  leftOf?: 'phase' | 'collection'
  allowed?: number
  message?: string
  hash?: Hex
}

export class MintFailure extends Error {
  readonly kind: MintFailureKind
  readonly detail: MintFailureDetail

  constructor(kind: MintFailureKind, detail: MintFailureDetail = {}, options?: { cause?: unknown }) {
    super(kind, options)
    this.name = 'MintFailure'
    this.kind = kind
    this.detail = detail
  }
}

/** The collection's custom errors a mint can revert with, by kind. */
const REVERTS: Record<string, MintFailureKind> = {
  MintGroupInactive: 'phase-closed',
  ExceedsMintGroupMaxSupply: 'sold-out',
  ExceedsMaxSupply: 'sold-out',
  ExceedsPublicMaxPerWallet: 'quota-exceeded',
  ExceedsMintQuota: 'quota-exceeded',
  NotInWhitelist: 'not-listed',
  NotDelegate: 'not-delegate',
  InsufficientEther: 'price-changed',
  TransferToNonERC721ReceiverImplementer: 'contract-wallet',
}

/** The custom error's name a failed simulation decoded, or null. */
export function revertNameOf(error: unknown): string | null {
  return revertOf(causes(error))?.errorName ?? null
}

/**
 * A failure in words for the step it happened at. Once sent, any failure is the receipt's not arriving, so nothing
 * after the send reads "Nothing was sent". Before it, a rejection, the balance and a changed network read the same
 * at the check and in the wallet; a decoded revert reads as its kind with its counts; any other failure is the
 * check's or the wallet's.
 */
export function mintFailureOf(error: unknown, at: MintStep, hash?: Hex): MintFailure {
  if (error instanceof MintFailure) return error
  const chain = causes(error)
  const named = (name: string) => chain.some((entry) => (entry as { name?: unknown }).name === name)
  const fail = (kind: MintFailureKind, detail: MintFailureDetail = {}) =>
    new MintFailure(kind, hash ? { ...detail, hash } : detail, { cause: error })
  if (at === 'confirming') return fail('unconfirmed')
  if (named('UserRejectedRequestError') || chain.some((entry) => (entry as { code?: unknown }).code === 4001))
    return fail('rejected')
  const text = chain.map((entry) => (entry instanceof Error ? entry.message : String(entry))).join(' ')
  if (/insufficient funds/i.test(text)) return fail('insufficient-balance')
  if (named('ChainMismatchError')) return fail('wrong-network')
  const revert = revertOf(chain)
  const kind = revert ? REVERTS[revert.errorName] : undefined
  if (revert && kind) {
    if (kind === 'sold-out')
      return fail(kind, {
        left: Number(revert.args[1]),
        leftOf: revert.errorName === 'ExceedsMaxSupply' ? 'collection' : 'phase',
      })
    if (kind === 'quota-exceeded') return fail(kind, { allowed: Number(revert.args[1]) })
    return fail(kind)
  }
  if (at === 'checking') return fail('check-failed')
  return fail('wallet-failed', { message: shortMessageOf(error) })
}

/**
 * A failure's title and sentence, with its counts and the collection's chain. A mint with a vault's allowance
 * names the vault where the list or the quota is the vault's.
 */
export function failureCopy(
  failure: MintFailure,
  chainName: string,
  minter: { vault: boolean } = { vault: false },
): { title: string; sentence: string } {
  const { left = 0, leftOf = 'phase', allowed = 0, message } = failure.detail
  const holder = minter.vault ? 'vault' : 'wallet'
  switch (failure.kind) {
    case 'rejected':
      return {
        title: 'You cancelled in your wallet',
        sentence: 'Nothing was sent and nothing was charged. You can try again whenever you are ready.',
      }
    case 'phase-closed':
      return {
        title: 'This phase is not open',
        sentence:
          'The check found the phase closed, so nothing was sent. The page shows which phases are open.',
      }
    case 'sold-out':
      return left === 0
        ? {
            title: 'No tokens are left',
            sentence: `Every token of this ${leftOf} is minted. Nothing was sent.`,
          }
        : {
            title: 'Fewer tokens are left',
            sentence: `Only ${left.toLocaleString('en-US')} ${left === 1 ? 'is' : 'are'} left, so nothing was sent.`,
          }
    case 'quota-exceeded':
      return {
        title: `That is more than this ${holder} can mint`,
        sentence: `This ${holder} ${allowed === 0 ? 'cannot mint more' : `can mint ${allowed.toLocaleString('en-US')} more`} in this phase, often because another of its mints landed first. Nothing was sent.`,
      }
    case 'not-listed':
      return {
        title: `This ${holder} is not on the list`,
        sentence: `The contract does not list this ${holder} for this phase. Nothing was sent.`,
      }
    case 'not-delegate':
      return {
        title: 'The vault no longer delegates to this wallet',
        sentence:
          'delegate.xyz shows no delegation from this vault to this wallet for the collection. Nothing was sent.',
      }
    case 'price-changed':
      return {
        title: 'The price changed',
        sentence:
          'The total changed after this page read it, so nothing was sent. The page shows the new total.',
      }
    case 'insufficient-balance':
      return {
        title: 'Not enough funds in this wallet',
        sentence: 'The wallet cannot cover the total plus gas. Nothing was sent.',
      }
    case 'contract-wallet':
      return {
        title: 'This wallet cannot hold the tokens',
        sentence:
          'It is a contract that cannot receive ERC-721 tokens. Mint from another wallet. Nothing was sent.',
      }
    case 'wrong-network':
      return {
        title: 'Your wallet changed network',
        sentence: `Switch back to ${chainName}, then try again. Nothing was sent.`,
      }
    case 'check-failed':
      return {
        title: 'The check could not be completed',
        sentence:
          'The mint could not be checked against the contract. Nothing was sent. Try again in a moment.',
      }
    case 'wallet-failed':
      return {
        title: 'Your wallet did not send it',
        sentence: `${message ?? 'Unknown error.'} Nothing was charged.`,
      }
    case 'reverted':
      return {
        title: 'The transaction failed on chain',
        sentence:
          'The network rejected it, usually because the phase closed or sold out while it waited. No tokens were minted; only gas was spent.',
      }
    case 'unconfirmed':
      return {
        title: 'Not confirmed yet',
        sentence:
          'The transaction was sent but is not confirmed after three minutes. It may still land: check it on the explorer before you mint again.',
      }
  }
}

/** A way forward from a failure, as the dialog's buttons offer them, in order. */
export type FailureAction =
  | { kind: 'retry' }
  | { kind: 'close' }
  | { kind: 'see-phases' }
  /** Sets the quantity to the count the revert named, then closes. */
  | { kind: 'mint-count'; count: number }
  | { kind: 'mint-fewer'; count: number }
  /** Mints from this wallet instead of the vault. */
  | { kind: 'use-wallet' }
  | { kind: 'view-transaction' }

export function failureActions(failure: MintFailure): FailureAction[] {
  const { left = 0, allowed = 0 } = failure.detail
  switch (failure.kind) {
    case 'phase-closed':
    case 'not-listed':
      return [{ kind: 'see-phases' }]
    case 'sold-out':
      return left > 0 ? [{ kind: 'mint-count', count: left }, { kind: 'close' }] : [{ kind: 'close' }]
    case 'quota-exceeded':
      // With nothing left to mint, a retry would be refused the same way.
      return allowed > 0 ? [{ kind: 'mint-fewer', count: allowed }, { kind: 'retry' }] : [{ kind: 'close' }]
    case 'insufficient-balance':
      return [{ kind: 'mint-fewer', count: 1 }, { kind: 'retry' }]
    case 'not-delegate':
      return [{ kind: 'use-wallet' }, { kind: 'close' }]
    case 'price-changed':
    case 'wrong-network':
      return [{ kind: 'retry' }]
    case 'contract-wallet':
      return [{ kind: 'close' }]
    case 'unconfirmed':
      return [{ kind: 'view-transaction' }, { kind: 'close' }]
    case 'rejected':
    case 'check-failed':
    case 'wallet-failed':
    case 'reverted':
      return [{ kind: 'retry' }, { kind: 'close' }]
  }
}
