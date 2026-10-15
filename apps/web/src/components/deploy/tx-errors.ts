import { WRONG_GROUP } from '@/lib/art/result'
import type { TxFailure } from './tx-progress'

/**
 * A wallet or chain error as the creator reads it, shared by the pay machine, the deploy machine and the
 * manage machine (docs/specs/2026-10-14-deploy.md, section 7.1; docs/specs/2026-10-15-phases.md, section
 * 7.2). The wording follows the subject: the payment sentences are the ones the pay step has shown since
 * Phase 3, and a change in Manage drop names the collection's own custom errors.
 */
export type TxSubject = 'payment' | 'deploy' | 'manage'
export type TxErrorStep = 'switching' | 'simulating' | 'wallet' | 'confirming'

type Words = {
  rejected: TxFailure
  balance: TxFailure
  switchRejected: string
  simulateTitle: string
  walletTitle: string
  walletTail: string
  confirmTitle: string
  confirmTail: string
}

const WORDS: Record<TxSubject, Words> = {
  payment: {
    rejected: {
      kind: 'rejected',
      title: 'Payment cancelled in your wallet',
      message: 'Nothing was sent and nothing was charged. Try again when you are ready.',
    },
    balance: {
      kind: 'balance',
      title: 'Not enough funds in this wallet',
      message:
        'The fee and network gas are more than this wallet holds on the network. Add funds, then try again.',
    },
    switchRejected:
      'Your wallet stayed on its current network, so nothing was paid. Try again and approve the switch.',
    simulateTitle: 'The payment would fail',
    walletTitle: 'The wallet did not send the payment',
    walletTail: 'Nothing was charged.',
    confirmTitle: 'The payment could not be confirmed',
    confirmTail: "Check your wallet's activity before you pay again.",
  },
  deploy: {
    rejected: {
      kind: 'rejected',
      title: 'Deploy cancelled in your wallet',
      message: 'Nothing was sent and no gas was spent. Try again when you are ready.',
    },
    balance: {
      kind: 'balance',
      title: 'Not enough funds for gas',
      message: 'This wallet cannot cover the deploy cost on this network. Add funds, then try again.',
    },
    switchRejected:
      'Your wallet stayed on its current network, so nothing was deployed. Try again and approve the switch.',
    simulateTitle: 'The deploy would fail',
    walletTitle: 'The wallet did not send the deploy',
    walletTail: 'No gas was spent.',
    confirmTitle: 'The deploy could not be confirmed',
    confirmTail: "Check your wallet's activity before you deploy again.",
  },
  manage: {
    rejected: {
      kind: 'rejected',
      title: 'Cancelled in your wallet',
      message: 'Nothing was sent and no gas was spent. Try again when you are ready.',
    },
    balance: {
      kind: 'balance',
      title: 'Not enough funds for gas',
      message: 'This wallet cannot cover the gas for this change on this network. Add funds, then try again.',
    },
    switchRejected:
      'Your wallet stayed on its current network, so nothing was sent. Try again and approve the switch.',
    simulateTitle: 'The change would fail',
    walletTitle: 'The wallet did not send the change',
    walletTail: 'No gas was spent.',
    confirmTitle: 'The change could not be confirmed',
    confirmTail: "Check your wallet's activity before you send it again.",
  },
}

function causes(error: unknown): unknown[] {
  const list: unknown[] = []
  let current: unknown = error
  for (let depth = 0; current && depth < 10; depth++) {
    list.push(current)
    current = (current as { cause?: unknown }).cause
  }
  return list
}

/** The error's `shortMessage` (viem) or `message`, read so a null or undefined rejection never throws inside a catch. */
function shortMessageOf(error: unknown): string {
  const shaped = error as { shortMessage?: unknown; message?: unknown } | null | undefined
  const message = shaped?.shortMessage ?? shaped?.message
  return typeof message === 'string' && message ? message : 'Unknown error.'
}

/** The custom error viem decoded from a failed simulation (`ContractFunctionRevertedError.data`), or null. */
function revertOf(chain: unknown[]): { errorName: string; args: readonly unknown[] } | null {
  for (const entry of chain) {
    const shaped = entry as { name?: unknown; data?: { errorName?: unknown; args?: unknown } }
    if (shaped.name !== 'ContractFunctionRevertedError' || typeof shaped.data?.errorName !== 'string')
      continue
    return { errorName: shaped.data.errorName, args: Array.isArray(shaped.data.args) ? shaped.data.args : [] }
  }
  return null
}

/**
 * The collection's custom errors in the creator's words (docs/specs/2026-10-15-phases.md, section 7.2; the
 * quota errors from docs/specs/2026-10-15-whitelist.md, section 6.6), or null for any other. Phases' owner
 * check is OpenZeppelin's `OwnableUnauthorizedAccount`, read as `Unauthorized`.
 */
export function revertSentence(errorName: string, args: readonly unknown[]): string | null {
  const count = (value: unknown) => Number(value).toLocaleString('en-US')
  switch (errorName) {
    case 'BelowMinted':
      return `It cannot go below ${count(args[0])}, the tokens this phase has already minted.`
    case 'AllocationsExceedMaxSupply':
      return "The phases' allocations together would be more than the collection's supply. Lower another phase first."
    case 'MintGroupAlreadyExists':
      return `Phase ${String(args[0])} is already on the contract. Read the contract again, then add the phase.`
    case 'MintGroupDoesNotExist':
      return `Phase ${String(args[0])} is not on the contract. Read the contract again.`
    case 'AddressZero':
      return 'The address cannot be the zero address.'
    case 'Unauthorized':
    case 'OwnableUnauthorizedAccount':
      return `Only the contract's owner can make this change, and ${String(args[0])} is not the owner.`
    case 'ArrayLengthMismatch':
      return 'The addresses and quotas do not line up. Reload and try again.'
    case 'PublicGroupHasNoQuota':
      return WRONG_GROUP
    case 'NotInWhitelist':
      return `${String(args[0])} is not on the whitelist of phase ${String(args[1])}.`
    case 'ExceedsMintQuota':
      return `This wallet can mint ${count(args[1])} more in this phase, not ${count(args[0])}.`
    default:
      return null
  }
}

/** A wallet or chain error as the creator reads it, for the step it happened at. */
export function classifyError(error: unknown, at: TxErrorStep, subject: TxSubject = 'payment'): TxFailure {
  const words = WORDS[subject]
  const chain = causes(error)
  const rejected = chain.some(
    (entry) =>
      (entry as { name?: string }).name === 'UserRejectedRequestError' ||
      (entry as { code?: unknown }).code === 4001,
  )
  if (at === 'switching') {
    return rejected
      ? { kind: 'switch', title: 'Network switch cancelled', message: words.switchRejected }
      : {
          kind: 'switch',
          title: 'The network switch failed',
          message: `${shortMessageOf(error)} Switch your wallet by hand, then try again.`,
        }
  }
  if (rejected) return words.rejected
  const text = chain.map((entry) => (entry instanceof Error ? entry.message : String(entry))).join(' ')
  if (/insufficient funds/i.test(text)) return words.balance
  const short = shortMessageOf(error)
  if (at === 'simulating') {
    if (subject === 'manage') {
      const revert = revertOf(chain)
      const sentence =
        (revert && revertSentence(revert.errorName, revert.args)) ??
        `The check against the contract failed: ${short}`
      return { kind: 'reverted', title: words.simulateTitle, message: `${sentence} Nothing was sent.` }
    }
    return {
      kind: 'reverted',
      title: words.simulateTitle,
      message: `The check against the factory failed: ${short} Nothing was sent.`,
    }
  }
  if (at === 'wallet')
    return { kind: 'rejected', title: words.walletTitle, message: `${short} ${words.walletTail}` }
  return { kind: 'reverted', title: words.confirmTitle, message: `${short} ${words.confirmTail}` }
}
