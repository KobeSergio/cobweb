import type { Address, Hex } from 'viem'
import {
  CONFIRM_INTERVAL_MS,
  CONFIRM_TIMEOUT_MS,
  type DeployEvent,
  type KeyStore,
} from '@/components/deploy/deploy-machine'
import { classifyError } from '@/components/deploy/tx-errors'
import type { TxFailure } from '@/components/deploy/tx-progress'
import {
  NOT_FROM_WALLET,
  NOT_THIS_CHANGE,
  NOT_THIS_CONTRACT,
  PHASE_NAME_TAKEN,
  PHASE_NOT_CONFIRMED,
  PHASE_REVERTED,
  PHASE_TIMED_OUT,
  THROWN,
  WHITELIST_NOT_CONFIRMED,
  WHITELIST_TIMED_OUT,
  type ActionResult,
} from '@/lib/art/result'
import type { ManageCall } from '@/lib/manage/phase-calls'
import type { PhaseAdd } from '@/lib/manage/phases-types'
import type { SentChunk } from '@/lib/manage/whitelist-types'

/**
 * Every on-chain change in Manage drop as one pure machine (docs/specs/2026-10-15-phases.md, section 7.2):
 * the deploy machine without prepare, reporting through its events and reducer. The wallet must be the
 * sign-in wallet and on the collection's chain (it is switched when it is not); the call is simulated on
 * the collection and the wallet signs exactly the simulated request (CLAUDE.md rule 2); the receipt lands;
 * then the server's confirmation, which reads the chain again, is polled every 3 seconds for up to 2
 * minutes. `TransactionDialog` wires the actions in.
 */
export type ManageInput = {
  /**
   * The change. Null on a tab still on sample data, whose sample actions check its review instead, and
   * for "Check again", which never simulates (`sentHash` is set).
   */
  call: ManageCall | null
  /** The connected account, if any. */
  account: string | undefined
  /** The sign-in wallet: the server accepts only a receipt sent from it. */
  wallet: Address
  /** The collection's chain. */
  chainId: number
  connectedChainId: number | undefined
  /** A remembered add: checked, never sent again. */
  sentHash?: Hex
  /** The id an add registers, named in the sentence when its name turns out to be taken. */
  addId?: number
}

export type ManageDeps<T> = {
  switchChain(chainId: number): Promise<void>
  /** Simulates the call on the collection; resolves with the function that sends the simulated request, unchanged. */
  simulate(call: ManageCall | null): Promise<() => Promise<Hex>>
  wait(hash: Hex): Promise<'success' | 'reverted'>
  confirm(hash: Hex): Promise<ActionResult<T>>
  /** Add phase and the chunk write: keep the sent hash until the server confirms it. */
  remember?(hash: Hex): void
  forget?(): void
  sleep(ms: number): Promise<void>
  now(): number
}

const NO_WALLET: TxFailure = {
  kind: 'refused',
  title: 'Connect your wallet',
  message: 'Connect your wallet to make this change. Nothing was sent.',
}
const REVERTED_ON_CHAIN: TxFailure = {
  kind: 'reverted',
  title: 'The change failed on chain',
  message: 'The transaction was included but reverted, so nothing changed. You paid gas only. Try again.',
}

/**
 * The answers that mean "not confirmed yet", each with what the machine says when the wait runs out: a phase
 * change's, and a whitelist chunk's (docs/specs/2026-10-15-whitelist.md, section 7.1).
 */
const NOT_CONFIRMED_YET = new Map([
  [PHASE_NOT_CONFIRMED, PHASE_TIMED_OUT],
  [WHITELIST_NOT_CONFIRMED, WHITELIST_TIMED_OUT],
])

/**
 * Asks the server to confirm a change every 3 seconds while it answers "not confirmed yet", for up to 2
 * minutes. A confirm that throws is a transient failure.
 */
export async function verifyManage<T>(
  hash: Hex,
  deps: Pick<ManageDeps<T>, 'confirm' | 'sleep' | 'now'>,
): Promise<{ result: T } | { error: string }> {
  const started = deps.now()
  for (;;) {
    let answer: ActionResult<T>
    try {
      answer = await deps.confirm(hash)
    } catch {
      return { error: THROWN }
    }
    if (answer.ok) return { result: answer.data }
    const timedOut = NOT_CONFIRMED_YET.get(answer.error)
    if (!timedOut) return { error: answer.error }
    if (deps.now() - started + CONFIRM_INTERVAL_MS > CONFIRM_TIMEOUT_MS) return { error: timedOut }
    await deps.sleep(CONFIRM_INTERVAL_MS)
  }
}

/**
 * Whether the server's answer ends this attempt for good, so a remembered add is forgotten: the receipt
 * reverted or proved something else, or the added phase's name is taken. Any other refusal (a session that
 * ended, a thrown action, a chain not ready) says nothing about the transaction: the hash stays and
 * "Check again" is offered.
 */
export function isTerminalManageAnswer(error: string): boolean {
  return (
    error === PHASE_REVERTED ||
    error === NOT_THIS_CONTRACT ||
    error === NOT_FROM_WALLET ||
    error === NOT_THIS_CHANGE ||
    error === PHASE_NAME_TAKEN
  )
}

/** A terminal answer in the creator's words: a taken name after an add says where the phase is. */
export function terminalMessage(error: string, addId: number | undefined): string {
  if (error === PHASE_NAME_TAKEN && addId !== undefined)
    return `The phase is on the contract as Group ${addId}, but its name is taken. Name it from its menu.`
  return error
}

/** Makes the change, or checks a remembered add, reporting each step through `dispatch`. */
export async function runManage<T>(
  input: ManageInput,
  deps: ManageDeps<T>,
  dispatch: (event: DeployEvent) => void,
): Promise<T | null> {
  let hash = input.sentHash
  if (!hash) {
    if (!input.account) {
      dispatch({ type: 'failed', failure: NO_WALLET })
      return null
    }
    // The server accepts only a receipt from the sign-in wallet: another account must not reach the wallet.
    if (input.account.toLowerCase() !== input.wallet.toLowerCase()) {
      dispatch({
        type: 'failed',
        failure: {
          kind: 'refused',
          title: 'Use your sign-in wallet',
          message: `Cobweb checks changes sent from ${input.wallet}, your sign-in wallet. Switch to that account in your wallet, then try again.`,
        },
      })
      return null
    }
    if (input.connectedChainId !== input.chainId) {
      dispatch({ type: 'switching' })
      try {
        await deps.switchChain(input.chainId)
      } catch (error) {
        dispatch({ type: 'failed', failure: classifyError(error, 'switching', 'manage') })
        return null
      }
    }
    dispatch({ type: 'simulating' })
    let send: () => Promise<Hex>
    try {
      send = await deps.simulate(input.call)
    } catch (error) {
      dispatch({ type: 'failed', failure: classifyError(error, 'simulating', 'manage') })
      return null
    }
    dispatch({ type: 'wallet' })
    try {
      hash = await send()
    } catch (error) {
      dispatch({ type: 'failed', failure: classifyError(error, 'wallet', 'manage') })
      return null
    }
    deps.remember?.(hash)
    dispatch({ type: 'confirming', txHash: hash })
    let status: 'success' | 'reverted'
    try {
      status = await deps.wait(hash)
    } catch (error) {
      // The receipt could not be read: the transaction may still land, so keep the hash and offer a check.
      dispatch({
        type: 'failed',
        failure: { ...classifyError(error, 'confirming', 'manage'), kind: 'unconfirmed' },
      })
      return null
    }
    if (status === 'reverted') {
      deps.forget?.()
      dispatch({ type: 'failed', failure: REVERTED_ON_CHAIN })
      return null
    }
  }
  dispatch({ type: 'verifying', txHash: hash })
  const verified = await verifyManage(hash, deps)
  if ('result' in verified) {
    deps.forget?.()
    dispatch({ type: 'success', txHash: hash })
    return verified.result
  }
  if (!isTerminalManageAnswer(verified.error)) {
    // Timed out or a transient refusal: the change may still be confirmed, so the hash stays.
    dispatch({
      type: 'failed',
      failure: { kind: 'unconfirmed', title: 'Change not confirmed yet', message: verified.error },
    })
  } else {
    deps.forget?.()
    dispatch({
      type: 'failed',
      failure: {
        kind: 'refused',
        title: 'Cobweb could not confirm this change',
        message: terminalMessage(verified.error, input.addId),
      },
    })
  }
  return null
}

/** What the browser keeps until the server records an added phase: the sent hash and the add's own fields. */
export type PendingAdd = { hash: Hex; form: PhaseAdd }

const keyFor = (collectionId: string) => `cobweb-phase:${collectionId}`
const HASH_RE = /^0x[0-9a-fA-F]{64}$/

export function rememberAdd(store: KeyStore | null, collectionId: string, pending: PendingAdd): void {
  try {
    store?.setItem(keyFor(collectionId), JSON.stringify(pending))
  } catch {
    // Storage blocked: the add is still checked in this visit.
  }
}

/** An add this browser sent for the collection and the server has not recorded yet, or null. */
export function pendingAdd(store: KeyStore | null, collectionId: string): PendingAdd | null {
  try {
    const value = store?.getItem(keyFor(collectionId)) ?? null
    if (!value) return null
    const parsed = JSON.parse(value) as { hash?: unknown; form?: Partial<Record<keyof PhaseAdd, unknown>> }
    const form = parsed.form
    if (typeof parsed.hash !== 'string' || !HASH_RE.test(parsed.hash) || !form) return null
    if (
      typeof form.onchainId !== 'number' ||
      !Number.isInteger(form.onchainId) ||
      form.onchainId < 1 ||
      typeof form.name !== 'string' ||
      !form.name ||
      typeof form.description !== 'string' ||
      typeof form.visible !== 'boolean'
    )
      return null
    return {
      hash: parsed.hash as Hex,
      form: {
        onchainId: form.onchainId,
        name: form.name,
        description: form.description,
        visible: form.visible,
      },
    }
  } catch {
    return null
  }
}

export function forgetAdd(store: KeyStore | null, collectionId: string): void {
  try {
    store?.removeItem(keyFor(collectionId))
  } catch {
    // Storage blocked: nothing was kept.
  }
}

const chunkKeyFor = (collectionId: string) => `cobweb-whitelist:${collectionId}`

/** Keeps a chunk this browser sent until the server confirms it: one per collection. */
export function rememberChunk(store: KeyStore | null, collectionId: string, sent: SentChunk): void {
  try {
    store?.setItem(chunkKeyFor(collectionId), JSON.stringify(sent))
  } catch {
    // Storage blocked: the chunk is still checked in this visit.
  }
}

/** A chunk this browser sent for the collection and the server has not confirmed yet, or null. */
export function sentChunk(store: KeyStore | null, collectionId: string): SentChunk | null {
  try {
    const value = store?.getItem(chunkKeyFor(collectionId)) ?? null
    if (!value) return null
    const parsed = JSON.parse(value) as { hash?: unknown; onchainId?: unknown }
    if (typeof parsed.hash !== 'string' || !HASH_RE.test(parsed.hash)) return null
    if (typeof parsed.onchainId !== 'number' || !Number.isInteger(parsed.onchainId) || parsed.onchainId < 1)
      return null
    return { hash: parsed.hash as Hex, onchainId: parsed.onchainId }
  } catch {
    return null
  }
}

export function forgetChunk(store: KeyStore | null, collectionId: string): void {
  try {
    store?.removeItem(chunkKeyFor(collectionId))
  } catch {
    // Storage blocked: nothing was kept.
  }
}
