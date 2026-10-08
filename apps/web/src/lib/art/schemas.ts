import { z } from 'zod'
import { tokenNameProblem } from '@/components/art/state/generation'
import { TOKEN_CHUNK } from './token-ops'
import { MAX_ATTRIBUTES } from './limits'
import { UNSAVED } from './result'

/**
 * The input rules the Art actions check before the database does, so the creator reads a sentence
 * and not a constraint name (spec section 6). Pure, so the tests run them directly.
 */
export function parse<S extends z.ZodType>(
  schema: S,
  input: unknown,
): { ok: true; data: z.output<S> } | { ok: false; error: string } {
  const result = schema.safeParse(input)
  return result.success
    ? { ok: true, data: result.data }
    : { ok: false, error: result.error.issues[0]?.message ?? UNSAVED }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const NAME = 'A name needs 1 to 48 characters.'
const TRAIT_NAME = 'A trait name needs 1 to 64 characters.'
const WEIGHT = 'A weight is a percent from 0 to 100.'
const CONSTANT = 'A fixed quantity is a whole number from 1 to 10,000.'
const DESCRIPTION = 'A description has at most 500 characters.'
const SIZE = 'A size is a whole number from 0 to 10,000.'

/** A row id from the browser. A malformed one means the page is out of date. */
export const uuid = z.string().regex(UUID, UNSAVED)
export const artName = z.string().trim().min(1, NAME).max(48, NAME)
export const traitName = z.string().trim().min(1, TRAIT_NAME).max(64, TRAIT_NAME)
export const artCollectionSize = z.number().int(SIZE).min(0, SIZE).max(10_000, SIZE)

const twoDecimals = (value: number) => Math.abs(Math.round(value * 100) - value * 100) < 1e-6

export const weightTable = z
  .array(
    z
      .object({
        traitId: uuid,
        weight: z
          .number()
          .min(0, WEIGHT)
          .max(100, WEIGHT)
          .refine(twoDecimals, 'A weight has at most two decimals.'),
        constant: z.number().int(CONSTANT).min(1, CONSTANT).max(10_000, CONSTANT).nullable(),
      })
      // A constant is a cap on a number of tokens, not a share.
      .transform((row) => (row.constant === null ? row : { ...row, weight: 0 })),
  )
  .max(501, UNSAVED)

export const ruleInput = z.object({
  kind: z.enum(["doesn't mix with", 'always pairs with', 'must pair with'], { error: UNSAVED }),
  traitId: uuid,
  relatedTraitIds: z.array(uuid).min(1, 'A rule needs at least one related trait.').max(500, UNSAVED),
})
export type RuleInput = z.infer<typeof ruleInput>

export const groupTraits = z
  .array(uuid)
  .min(2, 'An "at least one" group needs at least two traits.')
  .max(500, UNSAVED)

export const newTraits = z
  .array(z.object({ name: traitName, uploadId: uuid }))
  .min(1, UNSAVED)
  .max(500, UNSAVED)
export type NewTraitInput = z.infer<typeof newTraits>[number]

export const tokenName = z
  .string()
  .max(64, 'A token name has at most 64 characters.')
  .superRefine((value, ctx) => {
    const problem = tokenNameProblem(value)
    if (problem) ctx.addIssue({ code: 'custom', message: problem })
  })
  .transform((value) => value.trim())

export const artSettings = z
  .object({
    tokenName: tokenName.optional(),
    tokenDescription: z.string().max(500, DESCRIPTION).optional(),
    showBlankTraits: z.boolean().optional(),
    artDeferred: z.boolean().optional(),
  })
  .strict()
export type ArtSettingsPatch = z.input<typeof artSettings>

export const importPayload = z.object({
  collections: z
    .array(
      z.object({
        name: artName,
        layers: z
          .array(
            z.object({
              name: artName,
              traits: z
                .array(z.object({ name: traitName, uploadId: uuid }))
                .min(1, UNSAVED)
                .max(500, UNSAVED),
            }),
          )
          .max(50, UNSAVED),
      }),
    )
    .min(1, 'The folder has no layers to import.')
    .max(20, UNSAVED),
  activeCollectionId: uuid.nullable(),
})
export type ImportPayload = z.infer<typeof importPayload>
export type ImportResult = {
  collections: { id: string; layers: { id: string; traits: { id: string }[] }[] }[]
}

const tokenId = z.number().int(UNSAVED).min(1, UNSAVED).max(100_000, UNSAVED)
const dna = z.array(uuid).max(200, UNSAVED)
const tokenDescription = z.string().max(500, DESCRIPTION).nullable()

/** One call carries at most one chunk; a larger set is saved chunk by chunk (see `TOKEN_CHUNK`). */
const capped = <T extends z.ZodType>(item: T) =>
  z.array(z.unknown()).max(TOKEN_CHUNK, UNSAVED).pipe(z.array(item))

export const tokenSet = capped(
  z.object({ tokenId, artCollectionId: uuid, dna, description: tokenDescription }),
)
export const tokenPatches = capped(
  z.object({ tokenId, dna: dna.optional(), description: tokenDescription.optional() }),
)
export const tokenIds = capped(tokenId)
export const seed = z.number().int(UNSAVED).min(0, UNSAVED).max(4_294_967_295, UNSAVED)

const EDITIONS = 'Editions are a whole number from 1 to 10,000.'
const ATTRIBUTE = 'An attribute needs a trait type and a value of 1 to 64 characters each.'
const attributeText = z.string().trim().min(1, ATTRIBUTE).max(64, ATTRIBUTE)

export const assetPatch = z
  .object({
    quantity: z.number().int(EDITIONS).min(1, EDITIONS).max(10_000, EDITIONS).optional(),
    attributes: z
      .array(z.object({ traitType: attributeText, value: attributeText }))
      .max(MAX_ATTRIBUTES, UNSAVED)
      .optional(),
  })
  .strict()
export type AssetPatch = z.input<typeof assetPatch>

/** The list order of a 1/1 or single asset project's files: each stored file and its place. */
export const assetOrder = z
  .array(z.object({ uploadId: uuid, position: z.number().int(UNSAVED).min(0, UNSAVED) }))
  .max(10_000, UNSAVED)
export type AssetOrderRow = z.infer<typeof assetOrder>[number]
