import { collectionAbi } from '@cobweb/shared/collection-abi'
import type { Address, Hex } from 'viem'
import type { Config } from 'wagmi'
import {
  readContract,
  simulateContract,
  switchChain,
  waitForTransactionReceipt,
  writeContract,
} from 'wagmi/actions'
import type { ActionResult } from '@/lib/art/result'
import type { ManageCall } from '@/lib/manage/phase-calls'

/**
 * What a change in Manage drop does in the browser, in one shape for both modes
 * (docs/specs/2026-10-15-phases.md, section 7.3): `realManageActions` runs wagmi on the collection,
 * `sampleManageActions` (manage-sim.ts) simulates. `TransactionDialog` builds the manage machine's deps
 * from these, the request's confirm and the timers.
 */

/** A contract call as the creator reviews it before signing. */
export type TxRequest = {
  /** The contract the call goes to. */
  contract: 'Collection' | 'Transfer validator'
  /** The function name exactly as in the ABI, e.g. `setMintGroupStatus`. */
  functionName: string
  /** Arguments in ABI order, already formatted for reading. */
  args: { name: string; value: string }[]
  /** Native amount sent with the call, in wei. */
  valueWei?: string
  /**
   * Tabs still on sample data only: the contract's own check mirrored in the browser, answering the
   * error's name or null. The sample actions run it at "Checking the change".
   */
  check?: () => string | null
}

export type ManageActions = {
  switchChain(chainId: number): Promise<void>
  /** Simulates the call on the collection; resolves with the function that sends the simulated request, unchanged. */
  simulate(call: ManageCall): Promise<() => Promise<Hex>>
  wait(hash: Hex): Promise<'success' | 'reverted'>
  /** The id Add phase registers: the highest of `mintGroups()` plus one (0 is the public sale). */
  nextGroupId(): Promise<number>
  /** Sample only: the simulated wallet's answer. */
  answer?(choice: 'approve' | 'reject' | 'approve-revert'): void
  /** Sample only: a tab still on sample data has no call, so its review's `check` stands in for the simulation. */
  review?(review: TxRequest): Promise<() => Promise<Hex>>
}

/** One change as a dialog sends it: the call, what the creator reviews, and how the server confirms it. */
export type ManageRequest<T> = {
  /** Null on a tab still on sample data. */
  call: ManageCall | null
  review: TxRequest
  confirm(hash: Hex): Promise<ActionResult<T>>
  /** Add phase only: keeps the sent hash until the server records the phase. */
  pending?: { remember(hash: Hex): void; forget(): void }
}

/** The real actions: wagmi switches, simulates on the collection, sends the simulated request and waits. */
export function realManageActions(
  config: Config,
  target: { chainId: number; contract: Address; wallet: Address },
): ManageActions {
  return {
    switchChain: async (chainId) => {
      await switchChain(config, { chainId })
    },
    simulate: async (call) => {
      // The chain is named here and carried on the simulated request, so viem checks the send against it.
      // The account is the sign-in wallet: wagmi refuses to send the request from a wallet that does not hold it.
      const simulated = await simulateContract(config, {
        address: target.contract,
        abi: collectionAbi,
        functionName: call.functionName,
        args: call.args,
        chainId: target.chainId,
        account: target.wallet,
      })
      // CLAUDE.md rule 2: the wallet gets exactly the request the simulation passed.
      return () => writeContract(config, simulated.request)
    },
    wait: async (hash) => (await waitForTransactionReceipt(config, { hash, chainId: target.chainId })).status,
    nextGroupId: async () => {
      const ids = await readContract(config, {
        address: target.contract,
        abi: collectionAbi,
        functionName: 'mintGroups',
        chainId: target.chainId,
      })
      return Number(ids.reduce((highest, id) => (id > highest ? id : highest), 0n)) + 1
    },
  }
}
