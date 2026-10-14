import { z } from 'zod'
import {
  PHASE_DESCRIPTION_MAX,
  PHASE_NAME_EMPTY,
  PHASE_NAME_LONG,
  PHASE_NAME_MAX,
} from '@/components/manage/phase-rules'
import { DESCRIPTION_TOO_LONG, UNSAVED } from '@/lib/art/result'
import type { SentCall } from './phase-calls'
import { INT_MAX } from './phases-view'

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

/** A sent call: ids 0 to 2,147,483,647, every uint256 a decimal string, in each function's argument order. */
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
])

/** A sent call from the browser, or UNSAVED whatever is wrong with it. */
export function parseSentCall(input: unknown): { ok: true; data: SentCall } | { ok: false; error: string } {
  const result = sentCallShape.safeParse(input)
  return result.success ? { ok: true, data: result.data } : { ok: false, error: UNSAVED }
}
