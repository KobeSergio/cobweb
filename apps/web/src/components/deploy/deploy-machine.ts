import type { Hex } from 'viem'
import {
  ALREADY_DEPLOYED,
  DEPLOY_NOT_CONFIRMED,
  DEPLOY_REVERTED,
  DEPLOY_TIMED_OUT,
  DEPLOY_USED,
  NOT_THIS_DEPLOY,
  OTHER_CODE,
  OTHER_CONTRACT,
  THROWN,
  type ActionResult,
} from '@/lib/art/result'
import type { DeployForm, DeployRecord, Prepared } from '@/lib/deploy/deploy-types'
import { classifyError } from './tx-errors'
import type { TxFailure, TxPhase } from './tx-progress'

/**
 * The deploy as a pure machine (docs/specs/2026-10-14-deploy.md, section 7.1), shaped like the pay
 * machine so every path is tested in Node: the server prepares the constructor and the prediction, the
 * wallet switches chain when it is elsewhere, simulates, signs, the receipt lands, then the server's
 * confirmation is polled every 3 seconds for up to 2 minutes. `DeployFlow` wires the actions in.
 * CLAUDE.md rule 2 holds by construction: `simulate` returns the only way to send, and it sends the
 * simulated request.
 */
export const CONFIRM_INTERVAL_MS = 3_000
export const CONFIRM_TIMEOUT_MS = 120_000

export type DeployEvent =
  | { type: 'set'; phase: TxPhase }
  | { type: 'preparing' }
  | { type: 'switching' }
  | { type: 'simulating' }
  | { type: 'wallet' }
  | { type: 'confirming'; txHash: Hex }
  | { type: 'verifying'; txHash: Hex }
  | { type: 'success'; txHash: Hex }
  | { type: 'failed'; failure: TxFailure }

export function deployReducer(phase: TxPhase, event: DeployEvent): TxPhase {
  switch (event.type) {
    case 'set':
      return event.phase
    case 'preparing':
      return { step: 'preparing' }
    case 'switching':
      return { step: 'switching' }
    case 'simulating':
      return { step: 'simulating' }
    case 'wallet':
      return { step: 'wallet' }
    case 'confirming':
      return { step: 'confirming', txHash: event.txHash }
    case 'verifying':
      return { step: 'verifying', txHash: event.txHash }
    case 'success':
      return { step: 'success', txHash: event.txHash }
    case 'failed': {
      if (phase.step === 'idle' || phase.step === 'success')
        return { step: 'failed', at: 'preparing', failure: event.failure }
      const at = phase.step === 'failed' ? phase.at : phase.step
      return phase.txHash
        ? { step: 'failed', at, failure: event.failure, txHash: phase.txHash }
        : { step: 'failed', at, failure: event.failure }
    }
  }
}

export type DeployInput = {
  form: DeployForm
  /** The connected account, if any. It must be the sign-in wallet: the server prepares for that deployer. */
  account: string | undefined
  connectedChainId: number | undefined
  /** A transaction already sent for this collection: check it instead of deploying again. */
  sentHash?: Hex
}

export type DeployDeps = {
  prepare(form: DeployForm): Promise<ActionResult<Prepared>>
  switchChain(chainId: number): Promise<void>
  /** Simulates `deployCollection` with the prepared bytes; resolves with the function that sends the simulated request, unchanged. */
  simulate(prepared: Prepared): Promise<() => Promise<Hex>>
  wait(hash: Hex): Promise<'success' | 'reverted'>
  confirm(hash: Hex, form: DeployForm): Promise<ActionResult<DeployRecord>>
  remember(hash: Hex, form: DeployForm): void
  forget(): void
  sleep(ms: number): Promise<void>
  now(): number
}

const NO_WALLET: TxFailure = {
  kind: 'refused',
  title: 'Connect your wallet',
  message: 'Connect your wallet to deploy. Nothing was sent.',
}
const PREPARE_FAILED = 'Cobweb could not prepare the deploy'
const REVERTED_ON_CHAIN: TxFailure = {
  kind: 'reverted',
  title: 'The deploy failed on chain',
  message: 'The transaction was included but reverted, so no contract was created. Try again.',
}

/**
 * Asks the server to confirm a deployment every 3 seconds while it answers "not confirmed yet", for up
 * to 2 minutes. A confirm that throws is a transient failure.
 */
export async function verifyDeploy(
  hash: Hex,
  form: DeployForm,
  deps: Pick<DeployDeps, 'confirm' | 'sleep' | 'now'>,
): Promise<{ record: DeployRecord } | { error: string }> {
  const started = deps.now()
  for (;;) {
    let result: ActionResult<DeployRecord>
    try {
      result = await deps.confirm(hash, form)
    } catch {
      return { error: THROWN }
    }
    if (result.ok) return { record: result.data }
    if (result.error !== DEPLOY_NOT_CONFIRMED) return { error: result.error }
    if (deps.now() - started + CONFIRM_INTERVAL_MS > CONFIRM_TIMEOUT_MS) return { error: DEPLOY_TIMED_OUT }
    await deps.sleep(CONFIRM_INTERVAL_MS)
  }
}

/**
 * Whether the server's answer ends this deploy attempt for good, so this browser forgets the hash:
 * the receipt proved something else, or the collection is already deployed. Any other refusal (the
 * link lapsed meanwhile, a session that ended, a thrown action, a chain not ready) says nothing about
 * the transaction: the hash stays and "Check again" is offered once the cause is fixed.
 */
export function isTerminalDeployAnswer(error: string): boolean {
  return (
    error === NOT_THIS_DEPLOY ||
    error === OTHER_CODE ||
    error === OTHER_CONTRACT ||
    error === DEPLOY_REVERTED ||
    error === DEPLOY_USED ||
    error === ALREADY_DEPLOYED
  )
}

/** Deploys the contract, or checks a deploy already sent, reporting each step through `dispatch`. */
export async function runDeploy(
  input: DeployInput,
  deps: DeployDeps,
  dispatch: (event: DeployEvent) => void,
): Promise<DeployRecord | null> {
  let hash = input.sentHash
  if (!hash) {
    if (!input.account) {
      dispatch({ type: 'failed', failure: NO_WALLET })
      return null
    }
    dispatch({ type: 'preparing' })
    let prepared: Prepared
    try {
      const result = await deps.prepare(input.form)
      if (!result.ok) {
        dispatch({
          type: 'failed',
          failure: { kind: 'refused', title: PREPARE_FAILED, message: result.error },
        })
        return null
      }
      prepared = result.data
    } catch {
      dispatch({ type: 'failed', failure: { kind: 'refused', title: PREPARE_FAILED, message: THROWN } })
      return null
    }
    // The server prepared for the sign-in wallet; a deploy from any other account lands at another
    // address and is never recorded, so it must not reach the wallet.
    if (input.account.toLowerCase() !== prepared.deployer.toLowerCase()) {
      dispatch({
        type: 'failed',
        failure: {
          kind: 'refused',
          title: 'Use your sign-in wallet',
          message: `Only a deploy from ${prepared.deployer} is recorded. Switch to that account in your wallet, then try again.`,
        },
      })
      return null
    }
    if (input.connectedChainId !== prepared.chainId) {
      dispatch({ type: 'switching' })
      try {
        await deps.switchChain(prepared.chainId)
      } catch (error) {
        dispatch({ type: 'failed', failure: classifyError(error, 'switching', 'deploy') })
        return null
      }
    }
    dispatch({ type: 'simulating' })
    let send: () => Promise<Hex>
    try {
      send = await deps.simulate(prepared)
    } catch (error) {
      dispatch({ type: 'failed', failure: classifyError(error, 'simulating', 'deploy') })
      return null
    }
    dispatch({ type: 'wallet' })
    try {
      hash = await send()
    } catch (error) {
      dispatch({ type: 'failed', failure: classifyError(error, 'wallet', 'deploy') })
      return null
    }
    deps.remember(hash, input.form)
    dispatch({ type: 'confirming', txHash: hash })
    let status: 'success' | 'reverted'
    try {
      status = await deps.wait(hash)
    } catch (error) {
      // The receipt could not be read: the transaction may still land, so keep the hash and offer a check.
      dispatch({
        type: 'failed',
        failure: { ...classifyError(error, 'confirming', 'deploy'), kind: 'unconfirmed' },
      })
      return null
    }
    if (status === 'reverted') {
      deps.forget()
      dispatch({ type: 'failed', failure: REVERTED_ON_CHAIN })
      return null
    }
  }
  dispatch({ type: 'verifying', txHash: hash })
  const verified = await verifyDeploy(hash, input.form, deps)
  if ('record' in verified) {
    deps.forget()
    dispatch({ type: 'success', txHash: hash })
    return verified.record
  }
  if (!isTerminalDeployAnswer(verified.error)) {
    // Timed out or a transient refusal: the contract may still be recorded, so the hash stays.
    dispatch({
      type: 'failed',
      failure: { kind: 'unconfirmed', title: 'Deploy not confirmed yet', message: verified.error },
    })
  } else {
    deps.forget()
    dispatch({
      type: 'failed',
      failure: { kind: 'refused', title: 'Cobweb could not record this deploy', message: verified.error },
    })
  }
  return null
}

/** The hash "Check again" checks instead of deploying: a deploy sent but not confirmed in time. */
export function retryHash(phase: TxPhase): Hex | undefined {
  return phase.step === 'failed' && phase.failure.kind === 'unconfirmed' ? phase.txHash : undefined
}

export type KeyStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
/** What the browser keeps until the server records the contract: the sent hash and the form it was sent with. */
export type PendingDeploy = { hash: Hex; form: DeployForm }

const keyFor = (collectionId: string) => `cobweb-deploy:${collectionId}`
const HASH_RE = /^0x[0-9a-fA-F]{64}$/

/** The browser's localStorage, or null where it is blocked or absent. */
export function browserStore(): KeyStore | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

export function rememberDeploy(store: KeyStore | null, collectionId: string, pending: PendingDeploy): void {
  try {
    store?.setItem(keyFor(collectionId), JSON.stringify(pending))
  } catch {
    // Storage blocked: the deploy is still checked in this visit.
  }
}

/** A deploy this browser sent for the collection and the server has not recorded yet, or null. */
export function pendingDeploy(store: KeyStore | null, collectionId: string): PendingDeploy | null {
  try {
    const value = store?.getItem(keyFor(collectionId)) ?? null
    if (!value) return null
    const parsed = JSON.parse(value) as { hash?: unknown; form?: unknown }
    if (typeof parsed.hash !== 'string' || !HASH_RE.test(parsed.hash)) return null
    const form = parsed.form as DeployForm | undefined
    if (!form || typeof form !== 'object' || typeof form.chainId !== 'number' || !Array.isArray(form.groups))
      return null
    return { hash: parsed.hash as Hex, form }
  } catch {
    return null
  }
}

export function forgetDeploy(store: KeyStore | null, collectionId: string): void {
  try {
    store?.removeItem(keyFor(collectionId))
  } catch {
    // Storage blocked: nothing was kept.
  }
}
