import type { CollectionArgs } from '@cobweb/shared'
import { getAddress, isAddress, type Address } from 'viem'
import { z } from 'zod'
import { parse } from '@/lib/art/schemas'
import type { RenderJobState } from '@/lib/demo/types'
import type { DeployForm, DeployRecordGroup, PreparedArgs } from './deploy-types'

/**
 * The deploy form's rules and the constructor built from it (docs/specs/2026-10-14-deploy.md,
 * section 6.1). Pure, so the screen, the cores and the tests share them.
 */
export const MAX_LAUNCH_GROUPS = 10
export const GROUP_NAME_MAX = 40
export const MAX_ROYALTY_BPS = 1000

export const CHAIN_REQUIRED = 'Choose a chain to deploy on.'
export const PAYOUT_INVALID = 'Enter a valid payout address.'
export const PAYOUT_ZERO = 'The zero address cannot receive proceeds.'
export const RECEIVER_INVALID = 'Enter a valid royalty receiver.'
export const RECEIVER_ZERO = 'The zero address cannot receive royalties.'
export const ROYALTY_RANGE = 'The royalty is 0 to 1,000 basis points.'
export const CAP_RANGE = 'The public mint limit is a whole number from 1 to the supply.'
export const GROUP_COUNT = 'The contract starts with 1 to 10 phases.'
export const GROUP_NAME = 'A phase name has 1 to 40 characters.'
export const GROUP_NAMES_UNIQUE = 'Two phases cannot have the same name.'
export const GROUP_PRICE = 'A phase price is a whole number of wei.'
export const GROUP_SUPPLY = 'A phase allocation is a whole number of tokens.'
export const GROUPS_OVER_SUPPLY = 'The phases hold more tokens than the supply.'

const ZERO_ADDRESS = /^0x0{40}$/i
const address = (invalid: string, zero: string) =>
  z
    .string()
    .refine((value) => isAddress(value), invalid)
    .refine((value) => !ZERO_ADDRESS.test(value), zero)

/** The form's shape, before the bounds the supply sets (`validateDeployForm`). */
export const deployFormShape = z.object({
  chainId: z.number().int(CHAIN_REQUIRED).positive(CHAIN_REQUIRED),
  payout: address(PAYOUT_INVALID, PAYOUT_ZERO),
  royaltyBps: z.number().int(ROYALTY_RANGE).min(0, ROYALTY_RANGE).max(MAX_ROYALTY_BPS, ROYALTY_RANGE),
  royaltyReceiver: address(RECEIVER_INVALID, RECEIVER_ZERO),
  publicMaxPerWallet: z.number().int(CAP_RANGE).min(1, CAP_RANGE),
  groups: z
    .array(
      z.object({
        name: z.string().trim().min(1, GROUP_NAME).max(GROUP_NAME_MAX, GROUP_NAME),
        priceWei: z.string().regex(/^\d+$/, GROUP_PRICE),
        maxSupply: z.number().int(GROUP_SUPPLY).min(0, GROUP_SUPPLY),
      }),
    )
    .min(1, GROUP_COUNT)
    .max(MAX_LAUNCH_GROUPS, GROUP_COUNT)
    .refine(
      (groups) => new Set(groups.map((group) => group.name.toLowerCase())).size === groups.length,
      GROUP_NAMES_UNIQUE,
    ),
})

/** The form as the core accepts it: the shape, then the bounds the supply sets. Addresses come back checksummed. */
export function validateDeployForm(
  input: unknown,
  maxSupply: number,
): { ok: true; data: DeployForm } | { ok: false; error: string } {
  const shape = parse(deployFormShape, input)
  if (!shape.ok) return shape
  const form = shape.data
  if (form.publicMaxPerWallet > maxSupply) return { ok: false, error: CAP_RANGE }
  const allocated = form.groups.reduce((sum, group) => sum + group.maxSupply, 0)
  if (allocated > maxSupply) return { ok: false, error: GROUPS_OVER_SUPPLY }
  return {
    ok: true,
    data: {
      chainId: form.chainId,
      payout: getAddress(form.payout),
      royaltyBps: form.royaltyBps,
      royaltyReceiver: getAddress(form.royaltyReceiver),
      publicMaxPerWallet: form.publicMaxPerWallet,
      groups: form.groups.map((group) => ({
        name: group.name,
        priceWei: group.priceWei,
        maxSupply: group.maxSupply,
      })),
    },
  }
}

/**
 * The chain the contract goes on (spec decision 2): the chain the fee was paid on when a done real
 * job set one (the form must agree), else the form's. Null on a mismatch.
 */
export function resolveDeployChain(paidChainId: number | null, formChainId: number): number | null {
  if (paidChainId !== null && paidChainId !== formChainId) return null
  return paidChainId ?? formChainId
}

/**
 * Which done job the contract starts on (section 6.1): the placeholder job when the collection
 * finishes its art later or the real job carries "Reveal later" (`placeholder_upload_id` set), else
 * the real job; null when there is nothing to start on.
 */
export function startJobOf<T extends { placeholder_upload_id: string | null }>(input: {
  artDeferred: boolean
  real: T | null
  placeholder: T | null
}): T | null {
  const wantsPlaceholder =
    input.artDeferred || (input.real !== null && input.real.placeholder_upload_id !== null)
  if (wantsPlaceholder && input.placeholder) return input.placeholder
  return input.real
}

/**
 * Whether a collection that finishes its art later has a placeholder job still open (neither done
 * nor failed): the creator locked the placeholder again after a finish, so the done placeholder is
 * stale and the contract must not start on it. The database's readiness check cannot tell (it is
 * true once any placeholder job is done); ruling on Task 3's review.
 */
export function placeholderPending(input: {
  artDeferred: boolean
  /** The state of the latest placeholder job by creation, whatever it is, or null without one. */
  latestPlaceholderState: RenderJobState | null
}): boolean {
  const state = input.latestPlaceholderState
  return input.artDeferred && state !== null && state !== 'done' && state !== 'failed'
}

/** The real set's base URI, when the contract starts on another job and the real set is rendered. */
export function revealsToOf(
  start: { id: string } | null,
  real: { id: string; base_uri: string | null } | null,
): string | null {
  if (!start || !real || real.id === start.id) return null
  return real.base_uri
}

/**
 * The constructor arguments: the collection row's name, symbol and supply, the start job's base URI,
 * the validated form, and the session wallet as the owner (the deployer).
 */
export function deployArgs(
  collection: { name: string; symbol: string; max_supply: number },
  job: { base_uri: string },
  form: DeployForm,
  wallet: Address,
): PreparedArgs {
  return {
    name: collection.name,
    symbol: collection.symbol,
    payout: form.payout,
    baseUri: job.base_uri,
    maxSupply: String(collection.max_supply),
    groupSupplies: form.groups.map((group) => String(group.maxSupply)),
    groupPrices: form.groups.map((group) => group.priceWei),
    publicMaxPerWallet: String(form.publicMaxPerWallet),
    royaltyBps: form.royaltyBps,
    owner: wallet,
    royaltyReceiver: form.royaltyReceiver,
  }
}

/** `PreparedArgs` as `encodeCollectionArgs` takes them. */
export function collectionArgsOf(args: PreparedArgs): CollectionArgs {
  return {
    name: args.name,
    symbol: args.symbol,
    payout: args.payout,
    baseUri: args.baseUri,
    maxSupply: BigInt(args.maxSupply),
    groupSupplies: args.groupSupplies.map((value) => BigInt(value)),
    groupPrices: args.groupPrices.map((value) => BigInt(value)),
    publicMaxPerWallet: BigInt(args.publicMaxPerWallet),
    royaltyBps: args.royaltyBps,
    owner: args.owner,
    royaltyReceiver: args.royaltyReceiver,
  }
}

/**
 * The launch phases as the constructor took them (docs/specs/2026-10-15-phases.md, section 7.5): prices and
 * allocations from `deployments.args`, each name from its `mint_groups` row by `onchain_id`, "Group N"
 * without one. Phases changes the live values and the copies; the deployed view keeps showing what landed.
 */
export function launchPhasesOf(
  args: Pick<PreparedArgs, 'groupPrices' | 'groupSupplies'>,
  rows: { onchain_id: number; name: string }[],
): DeployRecordGroup[] {
  return args.groupPrices.map((priceWei, index) => ({
    onchainId: index,
    name: rows.find((row) => row.onchain_id === index)?.name ?? `Group ${index}`,
    priceWei,
    maxSupply: Number(args.groupSupplies[index] ?? '0'),
  }))
}
