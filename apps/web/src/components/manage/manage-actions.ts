import { collectionAbi } from '@cobweb/shared/collection-abi'
import type { Abi, Address, Hex } from 'viem'
import type { Config } from 'wagmi'
import { getPublicClient, readContract, simulateContract, switchChain, writeContract } from 'wagmi/actions'
import type { ActionResult } from '@/lib/art/result'
import { abiOf, type ManageCall } from '@/lib/manage/phase-calls'

/**
 * What a change in Manage drop does in the browser, in one shape for both modes
 * (docs/specs/2026-10-15-phases.md, section 7.3): `realManageActions` runs wagmi on the call's contract,
 * `sampleManageActions` (manage-sim.ts) simulates. `TransactionDialog` builds the manage machine's deps
 * from these, the request's confirm and the timers.
 */

/** A contract call as the creator reviews it before signing; a value sent with it is its last row. */
export type TxRequest = {
  /** The contract the call goes to. */
  contract: 'Collection' | 'Transfer validator'
  /** The function name exactly as in the ABI, e.g. `setMintGroupStatus`. */
  functionName: string
  /** Arguments in ABI order, already formatted for reading (`reviewOf`). */
  args: { name: string; value: string }[]
}

export type ManageActions = {
  switchChain(chainId: number): Promise<void>
  /**
   * Simulates the call on its contract (the collection, or the validator for the level call) with its value;
   * resolves with the function that sends the simulated request, unchanged.
   */
  simulate(call: ManageCall): Promise<() => Promise<Hex>>
  wait(hash: Hex): Promise<'success' | 'reverted'>
  /** The id Add phase registers: the highest of `mintGroups()` plus one (0 is the public sale). */
  nextGroupId(): Promise<number>
  /** Sample only: the simulated wallet's answer. */
  answer?(choice: 'approve' | 'reject' | 'approve-revert'): void
}

/** One change as a dialog sends it: the call, what the creator reviews, and how the server confirms it. */
export type ManageRequest<T> = {
  call: ManageCall
  review: TxRequest
  confirm(hash: Hex): Promise<ActionResult<T>>
  /** Add phase, the chunk write and an airdrop batch: keep the sent hash until the server confirms it. */
  pending?: { remember(hash: Hex): void; forget(): void }
}

/** The real actions: wagmi switches, simulates on the call's contract, sends the simulated request and waits. */
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
      // A payable call carries its value, and the level call goes to the validator with the validator's ABI.
      const simulated = await simulateContract(config, {
        address: call.target?.address ?? target.contract,
        abi: abiOf(call) as Abi,
        functionName: call.functionName,
        args: call.args,
        value: call.value,
        chainId: target.chainId,
        account: target.wallet,
      })
      // CLAUDE.md rule 2: the wallet gets exactly the request the simulation passed.
      return () => writeContract(config, simulated.request)
    },
    // viem answers a reverted receipt with its status, where wagmi's wait throws. After three minutes a
    // dropped transaction ends in a throw, which the machine shows as unconfirmed with "Check again".
    wait: async (hash) => {
      const client = getPublicClient(config, { chainId: target.chainId })
      if (!client) throw new Error('No RPC for this chain')
      return (await client.waitForTransactionReceipt({ hash, timeout: 180_000 })).status
    },
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
