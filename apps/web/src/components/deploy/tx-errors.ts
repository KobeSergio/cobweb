import type { TxFailure } from './tx-progress'

/**
 * A wallet or chain error as the creator reads it, shared by the pay machine and the deploy machine
 * (docs/specs/2026-10-14-deploy.md, section 7.1). The wording follows the subject: the payment
 * sentences are the ones the pay step has shown since Phase 3.
 */
export type TxSubject = 'payment' | 'deploy'
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

function shortMessageOf(error: unknown): string {
  return (
    (error as { shortMessage?: string }).shortMessage ??
    (error instanceof Error ? error.message : 'Unknown error.')
  )
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
  if (at === 'simulating')
    return {
      kind: 'reverted',
      title: words.simulateTitle,
      message: `The check against the factory failed: ${short} Nothing was sent.`,
    }
  if (at === 'wallet')
    return { kind: 'rejected', title: words.walletTitle, message: `${short} ${words.walletTail}` }
  return { kind: 'reverted', title: words.confirmTitle, message: `${short} ${words.confirmTail}` }
}
