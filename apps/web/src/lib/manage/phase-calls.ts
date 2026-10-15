import { validatorAbi } from '@cobweb/shared'
import { collectionAbi } from '@cobweb/shared/collection-abi'
import {
  getAbiItem,
  zeroAddress,
  type Abi,
  type AbiFunction,
  type Address,
  type ContractFunctionArgs,
} from 'viem'
import { formatBps, formatNative, formatUtc } from '@/lib/demo/helpers'
import type { SupportedChain } from '@/lib/demo/types'
import type { BatchEntry } from './airdrop-types'
import { BURN_ADDRESS, tokensOf } from './airdrop-view'
import { TRANSFER_LEVELS, type TransferLevelValue } from './settings-view'

/**
 * The calls Manage drop sends (docs/specs/2026-10-15-phases.md, section 7.1), built in one place for the
 * browser, the server and the verify scripts. Pure. Whitelist adds `setMintQuota`
 * (docs/specs/2026-10-15-whitelist.md, section 7.1); Airdrop and Settings add theirs, a payable call with its
 * value and the validator's level call with its target (docs/specs/2026-10-15-airdrop-settings.md, section 7.1).
 */
export type ManageFunction =
  | 'registerMintGroup'
  | 'setMintGroupStatus'
  | 'scheduleMintGroupStart'
  | 'changeSalePrice'
  | 'setMintGroupMaxSupply'
  | 'setPublicMaxMintPerWallet'
  | 'stopOrStartAllMintGroups'
  | 'setMintQuota'
  | 'airdropNFTs'
  | 'withdrawMintFunds'
  | 'setOwnerPayoutAddress'
  | 'setDefaultRoyalty'
  | 'setBaseURI'
  | 'setMintOnBehalfStatus'
  | 'setTransferValidator'

/** The call Settings sends to the transfer validator rather than the collection. */
export type ValidatorFunction = 'setTransferSecurityLevelOfCollection'

/** Where a call goes when it is not the collection: the validator, at its address. */
export type CallTarget = { contract: 'validator'; address: Address }

/**
 * A call as viem takes it: the function name and its arguments typed from its contract's ABI, the native value
 * sent with a payable call, and the target for the validator's call (absent for the collection).
 */
export type ManageCall =
  | {
      [F in ManageFunction]: {
        functionName: F
        args: ContractFunctionArgs<typeof collectionAbi, 'nonpayable' | 'payable', F>
        value?: bigint
        target?: undefined
      }
    }[ManageFunction]
  | {
      functionName: ValidatorFunction
      args: ContractFunctionArgs<typeof validatorAbi, 'nonpayable', ValidatorFunction>
      value?: undefined
      target: CallTarget
    }

/**
 * A call as it crosses the server action boundary: every uint256 as a decimal string, booleans as they are, an
 * array as an array of strings, the value as a decimal string and the target with its address.
 */
export type SentCall = {
  functionName: ManageFunction | ValidatorFunction
  args: (string | boolean | string[])[]
  value?: string
  target?: { contract: 'validator'; address: string }
}

/**
 * The event a call must leave in its receipt, with viem's argument names (docs/specs/2026-10-15-phases.md,
 * section 6.3). Close all names only its status: any number of groups may have changed. A withdrawal names no
 * argument: the confirm reads the amount and the payout address from the event it matched.
 */
export type ExpectedEvent =
  | { eventName: 'MintGroupRegistered'; args: { mintGroup: bigint } }
  | { eventName: 'MintGroupStatusChanged'; args: { mintGroup: bigint; status: boolean } }
  | { eventName: 'AllMintGroupsStatusChanged'; args: { status: boolean } }
  | { eventName: 'MintGroupStartTimestampChanged'; args: { mintGroup: bigint; timestamp: bigint } }
  | { eventName: 'SalePriceChanged'; args: { mintGroup: bigint; newPrice: bigint } }
  | { eventName: 'MintGroupMaxSupplyUpdated'; args: { mintGroup: bigint; newMaxSupply: bigint } }
  | { eventName: 'PublicMaxMintPerWalletChanged'; args: { newMaxMintPerWallet: bigint } }
  | { eventName: 'MintQuotasAdded'; args: { mintGroup: bigint; numberOfAddresses: bigint } }
  | { eventName: 'NFTsAirdropped'; args: { recipients: bigint; amount: bigint } }
  | { eventName: 'MintFundsWithdrawn'; args: Record<string, never> }
  | { eventName: 'OwnerPayoutAddressUpdated'; args: { newOwnerPayoutAddress: Address } }
  | { eventName: 'DefaultRoyaltyUpdated'; args: { receiver: Address; feeNumerator: bigint } }
  | { eventName: 'MintOnBehalfUpdated'; args: { newStatus: boolean } }
  | { eventName: 'TransferValidatorUpdated'; args: { newValidator: Address } }
  | { eventName: 'BatchMetadataUpdate'; args: { fromTokenId: bigint; toTokenId: bigint } }
  | { eventName: 'SetTransferSecurityLevel'; args: { collection: Address; level: number } }

/** The functions a Phases confirm accepts. */
export const PHASE_FUNCTIONS: ReadonlySet<string> = new Set<ManageFunction>([
  'registerMintGroup',
  'setMintGroupStatus',
  'scheduleMintGroupStart',
  'changeSalePrice',
  'setMintGroupMaxSupply',
  'setPublicMaxMintPerWallet',
  'stopOrStartAllMintGroups',
])

/** The functions a Settings confirm accepts: six on the collection and the validator's level call. */
export const SETTINGS_FUNCTIONS: ReadonlySet<string> = new Set<ManageFunction | ValidatorFunction>([
  'withdrawMintFunds',
  'setOwnerPayoutAddress',
  'setDefaultRoyalty',
  'setBaseURI',
  'setMintOnBehalfStatus',
  'setTransferValidator',
  'setTransferSecurityLevelOfCollection',
])

/** The builders the Phases and Whitelist dialogs use. Prices are wei as decimal strings, so no wei is lost. */
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
  quotas(id: number, addresses: Address[], quotas: number[]): ManageCall
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
  // The contract takes the addresses first: setMintQuota(addressesToAdd, mintGroup, mintQuotas_).
  quotas: (id, addresses, quotas) => ({
    functionName: 'setMintQuota',
    args: [addresses, BigInt(id), quotas.map((quota) => BigInt(quota))],
  }),
}

/** One batch as `airdropNFTs`: the value is exactly the contract's fee per token times the batch's tokens. */
function airdropCall(entries: BatchEntry[], feePerTokenWei: string): ManageCall {
  return {
    functionName: 'airdropNFTs',
    args: [entries.map((entry) => entry.address), entries.map((entry) => BigInt(entry.amount))],
    value: BigInt(feePerTokenWei) * BigInt(tokensOf(entries)),
  }
}

/** The builders Airdrop uses: a batch to wallets, or a burn, which is one batch to the dead address. */
export const airdropCalls: {
  batch(entries: BatchEntry[], feePerTokenWei: string): ManageCall
  burn(amount: number, feePerTokenWei: string): ManageCall
} = {
  batch: airdropCall,
  burn: (amount, feePerTokenWei) => airdropCall([{ address: BURN_ADDRESS, amount }], feePerTokenWei),
}

/** The builders Settings and the Overview use. The level call goes to the validator, with the three flags off. */
export const settingsCalls: {
  withdraw(): ManageCall
  payout(address: Address): ManageCall
  royalty(receiver: Address, bps: number): ManageCall
  baseUri(uri: string): ManageCall
  mintOnBehalf(on: boolean): ManageCall
  validator(address: Address): ManageCall
  level(validator: Address, collection: Address, level: TransferLevelValue): ManageCall
} = {
  withdraw: () => ({ functionName: 'withdrawMintFunds', args: [] }),
  payout: (address) => ({ functionName: 'setOwnerPayoutAddress', args: [address] }),
  royalty: (receiver, bps) => ({ functionName: 'setDefaultRoyalty', args: [receiver, BigInt(bps)] }),
  baseUri: (uri) => ({ functionName: 'setBaseURI', args: [uri] }),
  mintOnBehalf: (on) => ({ functionName: 'setMintOnBehalfStatus', args: [on] }),
  validator: (address) => ({ functionName: 'setTransferValidator', args: [address] }),
  level: (validator, collection, level) => ({
    functionName: 'setTransferSecurityLevelOfCollection',
    args: [collection, level, false, false, false],
    target: { contract: 'validator', address: validator },
  }),
}

/** The ABI a call is encoded with: the validator's for its level call, else the collection's. */
export function abiOf(call: ManageCall): typeof collectionAbi | typeof validatorAbi {
  return call.target ? validatorAbi : collectionAbi
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
    case 'setMintQuota':
      return {
        eventName: 'MintQuotasAdded',
        args: { mintGroup: call.args[1], numberOfAddresses: BigInt(call.args[0].length) },
      }
    case 'airdropNFTs':
      // The fee is not compared: the proof reads what the event says was paid.
      return {
        eventName: 'NFTsAirdropped',
        args: {
          recipients: BigInt(call.args[0].length),
          amount: call.args[1].reduce((sum, amount) => sum + amount, 0n),
        },
      }
    case 'withdrawMintFunds':
      return { eventName: 'MintFundsWithdrawn', args: {} }
    case 'setOwnerPayoutAddress':
      return { eventName: 'OwnerPayoutAddressUpdated', args: { newOwnerPayoutAddress: call.args[0] } }
    case 'setDefaultRoyalty':
      return {
        eventName: 'DefaultRoyaltyUpdated',
        args: { receiver: call.args[0], feeNumerator: call.args[1] },
      }
    case 'setBaseURI':
      // The event carries no URI: the confirm also reads the URI from the transaction's calldata.
      return { eventName: 'BatchMetadataUpdate', args: { fromTokenId: 1n, toTokenId: 2n ** 256n - 1n } }
    case 'setMintOnBehalfStatus':
      return { eventName: 'MintOnBehalfUpdated', args: { newStatus: call.args[0] } }
    case 'setTransferValidator':
      // The old validator is not compared: a change made outside Cobweb in between still confirms this one.
      return { eventName: 'TransferValidatorUpdated', args: { newValidator: call.args[0] } }
    case 'setTransferSecurityLevelOfCollection':
      return {
        eventName: 'SetTransferSecurityLevel',
        args: { collection: call.args[0], level: call.args[1] },
      }
  }
}

/** One argument of a call, whatever the function. */
type CallArg = bigint | boolean | number | string | readonly (bigint | Address)[]

const sentArg = (arg: CallArg): string | boolean | string[] =>
  typeof arg === 'boolean'
    ? arg
    : typeof arg === 'object'
      ? arg.map((item) => item.toString())
      : arg.toString()

/** A call as the browser sends it to a confirm action. */
export function sentOf(call: ManageCall): SentCall {
  const sent: SentCall = {
    functionName: call.functionName,
    args: (call.args as readonly CallArg[]).map(sentArg),
  }
  if (call.value !== undefined) sent.value = call.value.toString()
  if (call.target) sent.target = { contract: 'validator', address: call.target.address }
  return sent
}

/** A sent call back as viem takes it. The shape is checked first (`parseSentCall`), so every value converts. */
export function callOf(sent: SentCall): ManageCall {
  const uint = (index: number) => BigInt(sent.args[index] as string)
  const bool = (index: number) => sent.args[index] === true
  const list = (index: number) => sent.args[index] as string[]
  const text = (index: number) => sent.args[index] as string
  const address = (index: number) => sent.args[index] as Address
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
    case 'setMintQuota':
      return {
        functionName: 'setMintQuota',
        args: [list(0).map((address) => address as Address), uint(1), list(2).map((quota) => BigInt(quota))],
      }
    case 'airdropNFTs':
      return {
        functionName: 'airdropNFTs',
        args: [list(0).map((recipient) => recipient as Address), list(1).map((amount) => BigInt(amount))],
        value: BigInt(sent.value ?? '0'),
      }
    case 'withdrawMintFunds':
      return { functionName: 'withdrawMintFunds', args: [] }
    case 'setOwnerPayoutAddress':
      return { functionName: 'setOwnerPayoutAddress', args: [address(0)] }
    case 'setDefaultRoyalty':
      return { functionName: 'setDefaultRoyalty', args: [address(0), uint(1)] }
    case 'setBaseURI':
      return { functionName: 'setBaseURI', args: [text(0)] }
    case 'setMintOnBehalfStatus':
      return { functionName: 'setMintOnBehalfStatus', args: [bool(0)] }
    case 'setTransferValidator':
      return { functionName: 'setTransferValidator', args: [address(0)] }
    case 'setTransferSecurityLevelOfCollection':
      return {
        functionName: 'setTransferSecurityLevelOfCollection',
        args: [address(0), Number(text(1)), bool(2), bool(3), bool(4)],
        target: { contract: 'validator', address: (sent.target?.address ?? zeroAddress) as Address },
      }
  }
}

const PRICE_INPUTS = new Set(['price', 'newMintPrice'])

/** The validator's levels Cobweb offers, in the review's words. */
const LEVEL_TITLES = new Map<number, string>([
  [TRANSFER_LEVELS.enforced, 'royalties enforced'],
  [TRANSFER_LEVELS.open, 'royalties not enforced'],
  [TRANSFER_LEVELS.locked, 'locked'],
])

/** `1 address`, `500 addresses`, with thousands separators. */
const counted = (value: number | bigint, one: string, many: string) =>
  `${value.toLocaleString('en-US')} ${value === 1 || value === 1n ? one : many}`

/** An array argument as counts: the addresses, the quotas with their total, or the amounts with their tokens. */
function listValue(name: string, values: readonly (bigint | Address)[]): string {
  const total = values.reduce<bigint>((sum, value) => sum + (typeof value === 'bigint' ? value : 0n), 0n)
  if (name === 'mintQuotas')
    return `${counted(values.length, 'quota', 'quotas')}, ${total.toLocaleString('en-US')} in total`
  if (name === 'amounts')
    return `${counted(values.length, 'amount', 'amounts')}, ${counted(total, 'token', 'tokens')} in total`
  return counted(values.length, 'address', 'addresses')
}

/** One argument in the creator's words. */
function argValue(name: string, arg: CallArg, chain: SupportedChain): string {
  if (typeof arg === 'boolean') return String(arg)
  if (typeof arg === 'object') return listValue(name, arg)
  if (typeof arg === 'number') {
    const title = name === 'level' ? LEVEL_TITLES.get(arg) : undefined
    return title ? `${arg} (${title})` : String(arg)
  }
  if (typeof arg === 'string')
    return name === 'transferValidator' && arg.toLowerCase() === zeroAddress
      ? `${arg} (removes the check)`
      : arg
  if (PRICE_INPUTS.has(name)) return `${formatNative(arg, chain.nativeSymbol, 18)} (${arg} wei)`
  if (name === 'startTimestamp')
    return arg === 0n ? '0 (no scheduled start)' : `${formatUtc(Number(arg))} (${arg})`
  if (name === 'feeNumerator') return `${arg} (${formatBps(Number(arg))})`
  return arg.toString()
}

/**
 * The rows the dialog shows before signing: the ABI's argument names (a trailing underscore dropped) with
 * readable values, a price as the native amount and its wei, a start as UTC and its Unix value, an array as
 * counts, a royalty in basis points and percent, a level with its title; then, for a call with a value, the
 * value as the native amount and its wei.
 */
export function reviewOf(call: ManageCall, chain: SupportedChain): { name: string; value: string }[] {
  const item = getAbiItem({ abi: abiOf(call) as Abi, name: call.functionName }) as AbiFunction
  const rows = (call.args as readonly CallArg[]).map((arg, index) => {
    const name = (item.inputs[index]?.name ?? `argument ${index + 1}`).replace(/_$/, '')
    return { name, value: argValue(name, arg, chain) }
  })
  if (call.value !== undefined)
    rows.push({
      name: 'Value',
      value: `${formatNative(call.value, chain.nativeSymbol, 18)} (${call.value} wei)`,
    })
  return rows
}
