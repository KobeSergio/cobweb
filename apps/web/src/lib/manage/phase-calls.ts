import { collectionAbi } from '@cobweb/shared/collection-abi'
import { getAbiItem, type AbiFunction, type ContractFunctionArgs } from 'viem'
import { formatNative, formatUtc } from '@/lib/demo/helpers'
import type { SupportedChain } from '@/lib/demo/types'

/**
 * The collection calls Manage drop sends (docs/specs/2026-10-15-phases.md, section 7.1), built in one
 * place for the browser, the server and verify:phases. Pure. The next two sub-projects add their
 * functions to `ManageFunction`.
 */
export type ManageFunction =
  | 'registerMintGroup'
  | 'setMintGroupStatus'
  | 'scheduleMintGroupStart'
  | 'changeSalePrice'
  | 'setMintGroupMaxSupply'
  | 'setPublicMaxMintPerWallet'
  | 'stopOrStartAllMintGroups'

/** A call as viem takes it: the function name and its arguments typed from the collection's ABI. */
export type ManageCall = {
  [F in ManageFunction]: {
    functionName: F
    args: ContractFunctionArgs<typeof collectionAbi, 'nonpayable', F>
  }
}[ManageFunction]

/** A call as it crosses the server action boundary: every uint256 as a decimal string, booleans as they are. */
export type SentCall = { functionName: ManageFunction; args: (string | boolean)[] }

/**
 * The collection event a call must leave in its receipt, with viem's argument names (section 6.3). Close
 * all names only its status: any number of groups may have changed.
 */
export type ExpectedEvent =
  | { eventName: 'MintGroupRegistered'; args: { mintGroup: bigint } }
  | { eventName: 'MintGroupStatusChanged'; args: { mintGroup: bigint; status: boolean } }
  | { eventName: 'AllMintGroupsStatusChanged'; args: { status: boolean } }
  | { eventName: 'MintGroupStartTimestampChanged'; args: { mintGroup: bigint; timestamp: bigint } }
  | { eventName: 'SalePriceChanged'; args: { mintGroup: bigint; newPrice: bigint } }
  | { eventName: 'MintGroupMaxSupplyUpdated'; args: { mintGroup: bigint; newMaxSupply: bigint } }
  | { eventName: 'PublicMaxMintPerWalletChanged'; args: { newMaxMintPerWallet: bigint } }

/** The builders the Phases dialogs use. Prices are wei as decimal strings, so no wei is lost. */
export const phaseCalls: {
  register(id: number, priceWei: string, maxSupply: number, startUnix: number): ManageCall
  open(id: number): ManageCall
  close(id: number): ManageCall
  closeAll(): ManageCall
  publicCap(cap: number): ManageCall
  schedule(id: number, startUnix: number): ManageCall
  clearSchedule(id: number): ManageCall
  price(id: number, priceWei: string): ManageCall
  allocation(id: number, maxSupply: number): ManageCall
} = {
  register: (id, priceWei, maxSupply, startUnix) => ({
    functionName: 'registerMintGroup',
    args: [BigInt(id), BigInt(priceWei), BigInt(maxSupply), BigInt(startUnix)],
  }),
  open: (id) => ({ functionName: 'setMintGroupStatus', args: [BigInt(id), true] }),
  close: (id) => ({ functionName: 'setMintGroupStatus', args: [BigInt(id), false] }),
  closeAll: () => ({ functionName: 'stopOrStartAllMintGroups', args: [false] }),
  publicCap: (cap) => ({ functionName: 'setPublicMaxMintPerWallet', args: [BigInt(cap)] }),
  schedule: (id, startUnix) => ({
    functionName: 'scheduleMintGroupStart',
    args: [BigInt(id), BigInt(startUnix)],
  }),
  clearSchedule: (id) => ({ functionName: 'scheduleMintGroupStart', args: [BigInt(id), 0n] }),
  // The contract takes the price first: changeSalePrice(newMintPrice, mintGroup).
  price: (id, priceWei) => ({ functionName: 'changeSalePrice', args: [BigInt(priceWei), BigInt(id)] }),
  allocation: (id, maxSupply) => ({
    functionName: 'setMintGroupMaxSupply',
    args: [BigInt(id), BigInt(maxSupply)],
  }),
}

/** The event the confirm looks for in the receipt (section 6.3). */
export function expectedEvent(call: ManageCall): ExpectedEvent {
  switch (call.functionName) {
    case 'registerMintGroup':
      return { eventName: 'MintGroupRegistered', args: { mintGroup: call.args[0] } }
    case 'setMintGroupStatus':
      return { eventName: 'MintGroupStatusChanged', args: { mintGroup: call.args[0], status: call.args[1] } }
    case 'stopOrStartAllMintGroups':
      return { eventName: 'AllMintGroupsStatusChanged', args: { status: call.args[0] } }
    case 'scheduleMintGroupStart':
      return {
        eventName: 'MintGroupStartTimestampChanged',
        args: { mintGroup: call.args[0], timestamp: call.args[1] },
      }
    case 'changeSalePrice':
      return { eventName: 'SalePriceChanged', args: { mintGroup: call.args[1], newPrice: call.args[0] } }
    case 'setMintGroupMaxSupply':
      return {
        eventName: 'MintGroupMaxSupplyUpdated',
        args: { mintGroup: call.args[0], newMaxSupply: call.args[1] },
      }
    case 'setPublicMaxMintPerWallet':
      return { eventName: 'PublicMaxMintPerWalletChanged', args: { newMaxMintPerWallet: call.args[0] } }
  }
}

/** A call as the browser sends it to the confirm action. */
export function sentOf(call: ManageCall): SentCall {
  return {
    functionName: call.functionName,
    args: call.args.map((arg) => (typeof arg === 'boolean' ? arg : arg.toString())),
  }
}

/** A sent call back as viem takes it. The shape is checked first (`parseSentCall`), so every value converts. */
export function callOf(sent: SentCall): ManageCall {
  const uint = (index: number) => BigInt(sent.args[index] as string)
  const bool = (index: number) => sent.args[index] === true
  switch (sent.functionName) {
    case 'registerMintGroup':
      return { functionName: 'registerMintGroup', args: [uint(0), uint(1), uint(2), uint(3)] }
    case 'setMintGroupStatus':
      return { functionName: 'setMintGroupStatus', args: [uint(0), bool(1)] }
    case 'scheduleMintGroupStart':
      return { functionName: 'scheduleMintGroupStart', args: [uint(0), uint(1)] }
    case 'changeSalePrice':
      return { functionName: 'changeSalePrice', args: [uint(0), uint(1)] }
    case 'setMintGroupMaxSupply':
      return { functionName: 'setMintGroupMaxSupply', args: [uint(0), uint(1)] }
    case 'setPublicMaxMintPerWallet':
      return { functionName: 'setPublicMaxMintPerWallet', args: [uint(0)] }
    case 'stopOrStartAllMintGroups':
      return { functionName: 'stopOrStartAllMintGroups', args: [bool(0)] }
  }
}

const PRICE_INPUTS = new Set(['price', 'newMintPrice'])

/**
 * The rows the dialog shows before signing: the ABI's argument names (a trailing underscore dropped) with
 * readable values, a price as the native amount and its wei, a start as UTC and its Unix value.
 */
export function reviewOf(call: ManageCall, chain: SupportedChain): { name: string; value: string }[] {
  const item = getAbiItem({ abi: collectionAbi, name: call.functionName }) as AbiFunction
  return call.args.map((arg, index) => {
    const name = (item.inputs[index]?.name ?? `argument ${index + 1}`).replace(/_$/, '')
    if (typeof arg === 'boolean') return { name, value: String(arg) }
    if (PRICE_INPUTS.has(name))
      return { name, value: `${formatNative(arg, chain.nativeSymbol, 18)} (${arg} wei)` }
    if (name === 'startTimestamp')
      return { name, value: arg === 0n ? '0 (no scheduled start)' : `${formatUtc(Number(arg))} (${arg})` }
    return { name, value: arg.toString() }
  })
}
