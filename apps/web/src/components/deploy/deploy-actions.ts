import { factoryAbi } from '@cobweb/shared'
import { COLLECTION_CREATION_CODE } from '@cobweb/shared/collection'
import type { Address, Hex } from 'viem'
import type { Config } from 'wagmi'
import {
  getPublicClient,
  readContract,
  simulateContract,
  switchChain,
  waitForTransactionReceipt,
  writeContract,
} from 'wagmi/actions'
import { confirmDeploy, prepareDeploy } from '@/app/actions/deploy'
import type { ActionResult } from '@/lib/art/result'
import type { FeeSnapshot } from '@/lib/demo/types'
import type { DeployForm, DeployRecord, Prepared } from '@/lib/deploy/deploy-types'

/**
 * What the Deploy screen does, in one shape for both modes (docs/specs/2026-10-14-deploy.md,
 * sections 7.2 and 8): `realDeployActions` runs the server actions and wagmi, `sampleDeployActions`
 * (deploy-sim.ts) simulates in the browser. The deploy machine's `DeployDeps` are built from this plus
 * the browser store and the timers (deploy-flow.tsx).
 */
export type DeployActions = {
  prepare(form: DeployForm): Promise<ActionResult<Prepared>>
  /** The factory's `collectionFees()` on a chain; throws when it cannot be read. */
  fees(chainId: number, factory: Address | null): Promise<FeeSnapshot>
  /** The deploy's cost in wei as text (the gas of the prepared call times the gas price), or null when it cannot be estimated. */
  estimateCost(prepared: Prepared): Promise<string | null>
  switchChain(chainId: number): Promise<void>
  /** Simulates `deployCollection` with the prepared bytes; resolves with the function that sends the simulated request, unchanged. */
  simulate(prepared: Prepared): Promise<() => Promise<Hex>>
  wait(hash: Hex, chainId: number): Promise<'success' | 'reverted'>
  confirm(hash: Hex, form: DeployForm): Promise<ActionResult<DeployRecord>>
}

/** The real actions: the server prepares and confirms; wagmi reads, switches, simulates, sends and waits. */
export function realDeployActions(
  config: Config,
  collectionId: string,
  account: () => Address | undefined,
): DeployActions {
  const callArgs = (prepared: Prepared) =>
    [COLLECTION_CREATION_CODE, prepared.encodedArgs, prepared.salt] as const
  return {
    prepare: (form) => prepareDeploy(collectionId, form),
    fees: async (chainId, factory) => {
      if (!factory) throw new Error(`The factory on chain ${chainId} is not configured.`)
      const [flat, bps, airdrop] = await readContract(config, {
        address: factory,
        abi: factoryAbi,
        functionName: 'collectionFees',
        chainId,
      })
      return {
        mintFeeFlatWei: flat.toString(),
        mintFeeBps: Number(bps),
        airdropFeePerTokenWei: airdrop.toString(),
      }
    },
    estimateCost: async (prepared) => {
      const client = getPublicClient(config, { chainId: prepared.chainId })
      const from = account()
      if (!client || !from) return null
      try {
        const [gas, price] = await Promise.all([
          client.estimateContractGas({
            address: prepared.factory,
            abi: factoryAbi,
            functionName: 'deployCollection',
            args: callArgs(prepared),
            account: from,
          }),
          client.getGasPrice(),
        ])
        return (gas * price).toString()
      } catch {
        // The estimate is a courtesy: the wallet shows the real gas before signing.
        return null
      }
    },
    switchChain: async (chainId) => {
      await switchChain(config, { chainId })
    },
    simulate: async (prepared) => {
      // The deploy chain is named here, and wagmi carries it on the simulated request, so the send below
      // is checked against that chain by viem too: a wallet still on another chain never deploys there.
      // The account is the prepared deployer, not the live one: wagmi refuses to send the request from a
      // wallet that does not hold it, so the deploy can only go out from the address the server predicted for.
      const simulated = await simulateContract(config, {
        address: prepared.factory,
        abi: factoryAbi,
        functionName: 'deployCollection',
        args: callArgs(prepared),
        chainId: prepared.chainId,
        account: prepared.deployer,
      })
      // CLAUDE.md rule 2: the wallet gets exactly the request the simulation passed.
      return () => writeContract(config, simulated.request)
    },
    wait: async (hash, chainId) => (await waitForTransactionReceipt(config, { hash, chainId })).status,
    confirm: (hash, form) => confirmDeploy(collectionId, hash, form),
  }
}
