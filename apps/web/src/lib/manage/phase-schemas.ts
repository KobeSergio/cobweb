import { getAddress, isAddress, zeroAddress } from 'viem'
import { z } from 'zod'
import {
  PHASE_DESCRIPTION_MAX,
  PHASE_NAME_EMPTY,
  PHASE_NAME_LONG,
  PHASE_NAME_MAX,
} from '@/components/manage/phase-rules'
import { DESCRIPTION_TOO_LONG, UNSAVED } from '@/lib/art/result'
import { AIRDROP_MAX_PER_ADDRESS, AIRDROP_MAX_RECIPIENTS, AIRDROP_MAX_TOKENS } from './airdrop-view'
import type { SentCall } from './phase-calls'
import { INT_MAX } from './phases-view'
import { ipfsUriValid } from './settings-view'
import { QUOTA_MAX, WHITELIST_CHUNK } from './whitelist-view'

/**
 * What the Phases actions accept from the browser (docs/specs/2026-10-15-phases.md, section 6.4), checked
 * before the session and owner read. A malformed value means the page is out of date (UNSAVED); a name or
 * a description reads as the screen's own sentences.
 */

const UINT256_MAX = 2n ** 256n - 1n

/** A group id as a number: the copy's integer column holds 0 to 2,147,483,647. */
export const onchainIdShape = z.number({ error: UNSAVED }).int(UNSAVED).min(0, UNSAVED).max(INT_MAX, UNSAVED)
export const directionShape = z.enum(['up', 'down'], { error: UNSAVED })
export const visibleShape = z.boolean({ error: UNSAVED })

const nameShape = z
  .string({ error: PHASE_NAME_EMPTY })
  .trim()
  .min(1, PHASE_NAME_EMPTY)
  .max(PHASE_NAME_MAX, PHASE_NAME_LONG)
const descriptionShape = z.string({ error: UNSAVED }).trim().max(PHASE_DESCRIPTION_MAX, DESCRIPTION_TOO_LONG)

/** Edit details: the name trimmed with the screen's sentences, the description at most 500 characters. */
export const phaseDetailsShape = z.object(
  { name: nameShape, description: descriptionShape },
  { error: UNSAVED },
)

/** Add phase's off-chain fields: the id is 1 or more, since 0 is always the public sale. */
export const phaseAddShape = z.object(
  {
    onchainId: onchainIdShape.min(1, UNSAVED),
    name: nameShape,
    description: descriptionShape,
    visible: visibleShape,
  },
  { error: UNSAVED },
)

// One refine each: zod runs every check of a string, so a separate regex would not stop BigInt('1.5').
const idText = z.string().refine((value) => /^\d{1,10}$/.test(value) && Number(value) <= INT_MAX)
const uintText = z.string().refine((value) => /^\d{1,78}$/.test(value) && BigInt(value) <= UINT256_MAX)
// A chunk's parts (docs/specs/2026-10-15-whitelist.md, section 7.1): checksummed addresses and quotas of 0 to 10,000.
const checksummed = z.string().refine((value) => isAddress(value) && value === getAddress(value))
const quotaText = z.string().refine((value) => /^\d{1,5}$/.test(value) && Number(value) <= QUOTA_MAX)
// Airdrop and Settings (docs/specs/2026-10-15-airdrop-settings.md, section 7.1): an airdrop's amounts of 1 to
// 1,000, an address that is not the zero address, a royalty within the app's 10% and the levels Cobweb sends.
/** The app's royalty cap in basis points: the deploy form's 10%. */
const ROYALTY_MAX_BPS = 1_000
const amountText = z
  .string()
  .refine(
    (value) => /^\d{1,4}$/.test(value) && Number(value) >= 1 && Number(value) <= AIRDROP_MAX_PER_ADDRESS,
  )
const notZero = checksummed.refine((value) => value !== zeroAddress)
const bpsText = z.string().refine((value) => /^\d{1,4}$/.test(value) && Number(value) <= ROYALTY_MAX_BPS)

/**
 * A sent call: ids 0 to 2,147,483,647, every uint256 a decimal string, in each function's argument order; a
 * chunk is 1 to 500 checksummed addresses with as many quotas; an airdrop is 1 to 500 checksummed recipients
 * with as many amounts, 1,000 tokens at most, and its value; the level call carries its target. A value or a
 * target on another function is stripped.
 */
export const sentCallShape = z.discriminatedUnion('functionName', [
  z.object({
    functionName: z.literal('registerMintGroup'),
    args: z.tuple([idText, uintText, uintText, uintText]),
  }),
  z.object({ functionName: z.literal('setMintGroupStatus'), args: z.tuple([idText, z.boolean()]) }),
  z.object({ functionName: z.literal('scheduleMintGroupStart'), args: z.tuple([idText, uintText]) }),
  z.object({ functionName: z.literal('changeSalePrice'), args: z.tuple([uintText, idText]) }),
  z.object({ functionName: z.literal('setMintGroupMaxSupply'), args: z.tuple([idText, uintText]) }),
  z.object({ functionName: z.literal('setPublicMaxMintPerWallet'), args: z.tuple([uintText]) }),
  z.object({ functionName: z.literal('stopOrStartAllMintGroups'), args: z.tuple([z.boolean()]) }),
  z.object({
    functionName: z.literal('setMintQuota'),
    args: z
      .tuple([
        z.array(checksummed).min(1).max(WHITELIST_CHUNK),
        idText,
        z.array(quotaText).min(1).max(WHITELIST_CHUNK),
      ])
      .refine(([addresses, , quotas]) => addresses.length === quotas.length),
  }),
  z.object({
    functionName: z.literal('airdropNFTs'),
    args: z
      .tuple([
        z.array(checksummed).min(1).max(AIRDROP_MAX_RECIPIENTS),
        z.array(amountText).min(1).max(AIRDROP_MAX_RECIPIENTS),
      ])
      .refine(
        ([recipients, amounts]) =>
          recipients.length === amounts.length &&
          amounts.reduce((sum, amount) => sum + Number(amount), 0) <= AIRDROP_MAX_TOKENS,
      ),
    value: uintText,
  }),
  z.object({ functionName: z.literal('withdrawMintFunds'), args: z.tuple([]) }),
  z.object({ functionName: z.literal('setOwnerPayoutAddress'), args: z.tuple([notZero]) }),
  z.object({ functionName: z.literal('setDefaultRoyalty'), args: z.tuple([notZero, bpsText]) }),
  z.object({ functionName: z.literal('setBaseURI'), args: z.tuple([z.string().refine(ipfsUriValid)]) }),
  z.object({ functionName: z.literal('setMintOnBehalfStatus'), args: z.tuple([z.boolean()]) }),
  z.object({ functionName: z.literal('setTransferValidator'), args: z.tuple([checksummed]) }),
  z.object({
    functionName: z.literal('setTransferSecurityLevelOfCollection'),
    args: z.tuple([
      checksummed,
      z.enum(['0', '1', '9']),
      z.literal(false),
      z.literal(false),
      z.literal(false),
    ]),
    target: z.object({ contract: z.literal('validator'), address: notZero }),
  }),
])

/**
 * A sent call from the browser, or UNSAVED whatever is wrong with it; with `functions`, also UNSAVED for any
 * other function, so a Phases confirm never accepts an airdrop or a Settings call (PHASE_FUNCTIONS,
 * SETTINGS_FUNCTIONS).
 */
export function parseSentCall(
  input: unknown,
  functions?: ReadonlySet<string>,
): { ok: true; data: SentCall } | { ok: false; error: string } {
  const result = sentCallShape.safeParse(input)
  if (!result.success || (functions && !functions.has(result.data.functionName)))
    return { ok: false, error: UNSAVED }
  return { ok: true, data: result.data }
}
