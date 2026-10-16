// The chain half of the local fixture (docs/specs/2026-10-16-freshness-server.md, section 7.3), so the
// scripts that send to Anvil cannot drift: the local chain settings with a non-local endpoint refused (from
// chain-settings.ts, re-exported), the Anvil client, the PASS and FAIL lines, the payment and the factory
// call, a simulated request sent as it is, a manage call simulated and sent as the manage machine does, and
// the mint page's wallet: a wagmi config with the mock connector on an impersonated address, and its release
// (docs/specs/2026-10-16-mint-page-live-data.md, section 10). deploy-fixture.ts re-exports it with the
// Supabase half; verify:freshness imports it alone, so it needs Anvil and nothing else. Never prints a key.

import { connect, createConfig, disconnect, mock, type Config } from '@wagmi/core'
import {
  createTestClient,
  createWalletClient,
  http,
  parseAbi,
  publicActions,
  type Abi,
  type Address,
  type Chain,
  type ContractFunctionArgs,
  type ContractFunctionName,
  type Hex,
  type WriteContractParameters,
} from 'viem'
import type { PrivateKeyAccount } from 'viem/accounts'
import { anvil } from 'viem/chains'
import { collectionAbi } from '@cobweb/shared/collection-abi'
import { localChainConfig } from './chain-settings.ts'

export { localChainConfig, refuseRemote } from './chain-settings.ts'

const chainSettings = localChainConfig()
export const rpc: string = chainSettings.rpc
export const factory: Address = chainSettings.factory

// These imports only bind names: `@cobweb/shared` is already loaded (chain-settings.ts imports it
// statically), and neither it nor the two app modules read the environment as they load, only when called.
export const { collectionSalt, encodeCollectionArgs, factoryAbi, predictCollectionAddress } =
  await import('@cobweb/shared')
export const { COLLECTION_CODE_HASH, COLLECTION_CREATION_CODE } = await import('@cobweb/shared/collection')
const { abiOf } = await import('../src/lib/manage/phase-calls.ts')
const { classifyError } = await import('../src/components/deploy/tx-errors.ts')
export type ManageCall = import('../src/lib/manage/phase-calls.ts').ManageCall

export const chain = createTestClient({ chain: anvil, mode: 'anvil', transport: http(rpc) }).extend(
  publicActions,
)
export const CID = (letter: string) => `bafybei${letter.repeat(52)}`
export const HEX64 = (n: number) => n.toString(16).padStart(64, '0')
/** The factory's approval view, which the shipped ABI leaves out (the app never asks it). */
const approvalAbi = parseAbi(['function isCreationCodeApproved(bytes32 codeHash) view returns (bool)'])

let passed = 0
const failed: string[] = []

/** A check returns null on success, or a description of what happened instead. */
export async function check(name: string, fn: () => Promise<string | null>): Promise<void> {
  let problem: string | null
  try {
    problem = await fn()
  } catch (e) {
    problem = `threw ${e instanceof Error ? e.message : String(e)}`
  }
  if (problem === null) {
    passed++
    console.log(`PASS ${name}`)
  } else {
    failed.push(name)
    console.log(`FAIL ${name}: ${problem}`)
  }
}

/**
 * Runs the checks, then the cleanup whatever happened, prints the totals and exits non-zero on any failure.
 */
export async function runChecks(main: () => Promise<void>, cleanup: () => Promise<void>): Promise<never> {
  try {
    await main()
  } catch (e) {
    failed.push('run')
    console.log(`FAIL run: ${e instanceof Error ? e.message : String(e)}`)
  } finally {
    await cleanup()
  }
  console.log(`\n${passed} passed, ${failed.length} failed`)
  process.exit(failed.length ? 1 : 0)
}

/** Pays for a job from the account through the factory and waits for the receipt. */
export async function pay(account: PrivateKeyAccount, jobId: Hex, value: bigint): Promise<Hex> {
  const wallet = createWalletClient({ account, chain: anvil, transport: http(rpc) })
  const hash = await wallet.writeContract({
    address: factory,
    abi: factoryAbi,
    functionName: 'payForArt',
    args: [jobId],
    value,
  })
  const receipt = await chain.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error(`payForArt reverted: ${hash}`)
  return hash
}

/**
 * Sends a simulated request as it is from the account, waits for its receipt, and throws on a revert. Typed
 * as an Anvil wallet's `writeContract`, so any request `simulateContract` answers on Anvil fits.
 */
export async function sendRequest<
  const abi extends Abi | readonly unknown[],
  functionName extends ContractFunctionName<abi, 'nonpayable' | 'payable'>,
  args extends ContractFunctionArgs<abi, 'nonpayable' | 'payable', functionName>,
  chainOverride extends Chain | undefined = undefined,
>(
  account: PrivateKeyAccount,
  request: WriteContractParameters<abi, functionName, args, typeof anvil, PrivateKeyAccount, chainOverride>,
): Promise<Hex> {
  const wallet = createWalletClient({ account, chain: anvil, transport: http(rpc) })
  const hash = await wallet.writeContract(request)
  const receipt = await chain.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error(`${request.functionName} reverted: ${hash}`)
  return hash
}

/**
 * Sends deployCollection with the shipped creation code, the given arguments and salt, and waits for the
 * receipt.
 */
export async function deploy(account: PrivateKeyAccount, encodedArgs: Hex, salt: Hex): Promise<Hex> {
  const wallet = createWalletClient({ account, chain: anvil, transport: http(rpc) })
  const hash = await wallet.writeContract({
    address: factory,
    abi: factoryAbi,
    functionName: 'deployCollection',
    args: [COLLECTION_CREATION_CODE, encodedArgs, salt],
  })
  const receipt = await chain.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error(`deployCollection reverted: ${hash}`)
  return hash
}

/**
 * The simulation the manage machine runs for a call (docs/specs/2026-10-15-airdrop-settings.md, section 7.1):
 * on the call's contract (the collection, or the validator for the level call), with its ABI and its value.
 */
function simulateCall(account: PrivateKeyAccount, collection: Address, call: ManageCall) {
  return chain.simulateContract({
    address: call.target?.address ?? collection,
    abi: abiOf(call) as Abi,
    functionName: call.functionName,
    args: call.args,
    value: call.value,
    account,
  })
}

/** Simulates a manage call as wagmi does, sends exactly the simulated request from the account and waits. */
export async function sendCall(
  account: PrivateKeyAccount,
  collection: Address,
  call: ManageCall,
): Promise<Hex> {
  const { request } = await simulateCall(account, collection, call)
  const wallet = createWalletClient({ account, chain: anvil, transport: http(rpc) })
  const hash = await wallet.writeContract(request)
  const receipt = await chain.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error(`${call.functionName} reverted: ${hash}`)
  return hash
}

/**
 * How the simulation refuses a manage call, in the creator's words with the chain's symbol, or that it
 * passed.
 */
export async function simulationSentence(
  account: PrivateKeyAccount,
  collection: Address,
  call: ManageCall,
): Promise<string> {
  try {
    await simulateCall(account, collection, call)
    return 'the simulation passed'
  } catch (error) {
    return classifyError(error, 'simulating', 'manage', 'ETH').message
  }
}

/** `transferOwnership(to)` from the account (the scripts' owner check; Cobweb never sends it), and waits. */
export async function handOver(account: PrivateKeyAccount, collection: Address, to: Address): Promise<void> {
  const owner = createWalletClient({ account, chain: anvil, transport: http(rpc) })
  const hash = await owner.writeContract({
    address: collection,
    abi: collectionAbi,
    functionName: 'transferOwnership',
    args: [to],
  })
  const receipt = await chain.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error(`transferOwnership reverted: ${hash}`)
}

/** Anvil answers as 31337 and the factory approves the shipped creation code hash, or why not. */
export async function chainReady(): Promise<string | null> {
  if ((await chain.getChainId()) !== 31337) return 'not chain 31337'
  const code = await chain.getCode({ address: factory })
  if (!code || code === '0x') return `no contract at ${factory}; run chain:local again`
  const approved = await chain.readContract({
    address: factory,
    abi: approvalAbi,
    functionName: 'isCreationCodeApproved',
    args: [COLLECTION_CODE_HASH],
  })
  return approved
    ? null
    : `the factory does not approve ${COLLECTION_CODE_HASH}; run forge build, the copy script and chain:local again`
}

/** A wagmi wallet on Anvil and its release, which the caller's cleanup runs. */
export type WagmiWallet = {
  config: Config
  /** Disconnects the connector, then stops Anvil impersonating the address even if the disconnect fails. */
  release: () => Promise<void>
}

/**
 * The mint page's wallet on Anvil: a wagmi config on the local chain with the mock connector connected as the
 * address, which Anvil impersonates, so the page's `wagmiMintChain` simulates through the transport and sends
 * the simulated request through the connector, which hands `eth_sendTransaction` to Anvil as a wallet hands it
 * to its node. No key: Anvil signs for the impersonated address. The mock's connect stays in the process, so
 * the impersonation starts after it: a wallet that fails to connect leaves Anvil as it was, and the caller's
 * cleanup runs `release` on each wallet it got.
 */
export async function wagmiWallet(address: Address): Promise<WagmiWallet> {
  const local = { ...anvil, rpcUrls: { default: { http: [rpc] } } }
  const config = createConfig({
    chains: [local],
    connectors: [mock({ accounts: [address] })],
    transports: { [anvil.id]: http(rpc) },
    multiInjectedProviderDiscovery: false,
    storage: null,
  })
  const [connector] = config.connectors
  if (!connector) throw new Error('the mock connector is missing')
  await connect(config, { connector })
  await chain.impersonateAccount({ address })
  return {
    config,
    release: async () => {
      try {
        await disconnect(config, { connector })
      } finally {
        await chain.stopImpersonatingAccount({ address })
      }
    },
  }
}
