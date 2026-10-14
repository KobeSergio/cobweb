/**
 * Sample mode only (`NEXT_PUBLIC_DEMO_DATA=1`): the deploy actions simulated in client state, so
 * every state can be reviewed without a wallet, a chain or a database (docs/specs/2026-10-14-deploy.md,
 * section 8). Real mode uses `realDeployActions` (deploy-actions.ts). Failures are driven by
 * `?outcome=` and fire once, on the first run of the step they belong to, so a retry then goes through.
 */
import { collectionSalt } from '@cobweb/shared'
import type { Address, Hex } from 'viem'
import { useAccount } from 'wagmi'
import { DEMO_DEPLOY_COST_ESTIMATE, DEMO_DEPLOYMENT, DEMO_FACTORY_FEES } from '@/lib/demo'
import { sampleAddress, sampleTxHash } from '@/lib/demo/helpers'
import type { DeployForm, DeployRecord, Prepared } from '@/lib/deploy/deploy-types'
import type { DeployActions } from './deploy-actions'

export type DeployOutcome = 'rejected' | 'reverted' | 'balance' | 'switch-rejected' | 'fees-error'

export const DEPLOY_OUTCOMES: DeployOutcome[] = [
  'rejected',
  'reverted',
  'balance',
  'switch-rejected',
  'fees-error',
]

/** The chain a wallet reports in sample mode when none is connected, so a switch shows when another is picked. */
const SAMPLE_WALLET_CHAIN = 1
const SAMPLE_FACTORY: Address = '0x5FbDB2315678afecb367f032d93F642f64180aa3'
const SAMPLE_CODE_HASH: Hex = `0x${'7'.repeat(64)}`

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * The connected wallet and its chain, or the fallback address (the session's wallet in real mode, the
 * sample creator in sample mode) and, in sample mode only, Ethereum as the chain.
 */
export function useCreatorWallet(
  fallback: Address,
  sample: boolean,
): { address: Address; connected: boolean; chainId: number | undefined } {
  const account = useAccount()
  return {
    address: account.address ?? fallback,
    connected: account.address !== undefined,
    chainId: account.chainId ?? (sample ? SAMPLE_WALLET_CHAIN : undefined),
  }
}

/** The address the sample "predicts" for these settings: a stable hash of them. */
export function sampleAddressFor(collectionId: string, form: DeployForm): Address {
  const text = `${collectionId}|${JSON.stringify(form)}`
  let hash = 2166136261
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return sampleAddress(hash >>> 0)
}

export type SampleDeployInput = {
  collectionId: string
  collection: { name: string; symbol: string; maxSupply: number }
  /** The wallet the sample deploys from. */
  wallet: Address
  baseUri: string
  revealsTo: string | null
  outcome?: DeployOutcome
}

function samplePrepared(input: SampleDeployInput, form: DeployForm): Prepared {
  return {
    chainId: form.chainId,
    factory: SAMPLE_FACTORY,
    deployer: input.wallet,
    salt: collectionSalt(input.collectionId),
    codeHash: SAMPLE_CODE_HASH,
    args: {
      name: input.collection.name,
      symbol: input.collection.symbol,
      payout: form.payout,
      baseUri: input.baseUri,
      maxSupply: String(input.collection.maxSupply),
      groupSupplies: form.groups.map((group) => String(group.maxSupply)),
      groupPrices: form.groups.map((group) => group.priceWei),
      publicMaxPerWallet: String(form.publicMaxPerWallet),
      royaltyBps: form.royaltyBps,
      owner: input.wallet,
      royaltyReceiver: form.royaltyReceiver,
    },
    groups: form.groups,
    encodedArgs: '0x',
    predicted: sampleAddressFor(input.collectionId, form),
    baseUri: input.baseUri,
    revealsTo: input.revealsTo,
    fees: DEMO_FACTORY_FEES[form.chainId] ?? DEMO_DEPLOYMENT.fees,
  }
}

/** The record of a sample deploy that just landed: the creator's own settings at the sample's prediction. */
function recordOf(prepared: Prepared, hash: Hex): DeployRecord {
  return {
    chainId: prepared.chainId,
    contractAddress: prepared.predicted,
    txHash: hash,
    deployer: prepared.deployer,
    deployedAt: Math.floor(Date.now() / 1000),
    baseUri: prepared.baseUri,
    payout: prepared.args.payout,
    royaltyBps: prepared.args.royaltyBps,
    royaltyReceiver: prepared.args.royaltyReceiver,
    publicMaxPerWallet: Number(prepared.args.publicMaxPerWallet),
    fees: prepared.fees,
    groups: prepared.groups.map((group, index) => ({
      onchainId: index,
      name: group.name,
      priceWei: group.priceWei,
      maxSupply: group.maxSupply,
    })),
  }
}

const rejection = () => Object.assign(new Error('User rejected the request.'), { code: 4001 })

/** The screen's actions in sample mode: they wait like the real ones and write nothing. */
export function sampleDeployActions(input: SampleDeployInput): DeployActions {
  // The outcome fires once, on the first run of its step: a retry then goes through.
  let fired = false
  const failsNow = (kind: DeployOutcome) => {
    if (input.outcome !== kind || fired) return false
    fired = true
    return true
  }
  return {
    prepare: async (form) => {
      await sleep(300)
      return { ok: true, data: samplePrepared(input, form) }
    },
    fees: async (chainId) => {
      await sleep(550)
      if (failsNow('fees-error')) throw new Error('The factory did not answer.')
      const fees = DEMO_FACTORY_FEES[chainId]
      if (!fees) throw new Error(`No sample fees for chain ${chainId}.`)
      return fees
    },
    estimateCost: async (prepared) => DEMO_DEPLOY_COST_ESTIMATE[prepared.chainId] ?? null,
    switchChain: async () => {
      await sleep(1200)
      if (failsNow('switch-rejected')) throw rejection()
    },
    simulate: async () => {
      await sleep(1000)
      if (failsNow('balance')) throw new Error('insufficient funds for gas * price + value')
      if (failsNow('reverted'))
        throw Object.assign(new Error('reverted'), { shortMessage: 'Execution reverted: DeploymentFailed.' })
      return async () => {
        await sleep(1700)
        if (failsNow('rejected')) throw rejection()
        return sampleTxHash(Math.floor(Date.now() / 1000) % 100_000)
      }
    },
    wait: async () => {
      await sleep(2200)
      return 'success'
    },
    confirm: async (hash, form) => {
      await sleep(800)
      return { ok: true, data: recordOf(samplePrepared(input, form), hash) }
    },
  }
}
