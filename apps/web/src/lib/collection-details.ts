import { z } from 'zod'
import { createCollectionSchema } from '@/lib/collections'

/**
 * Editing a collection's details. The same field rules as creating one; the project type is not
 * editable. Which fields may still change depends on the status (`frozenDetailFields` in
 * `lib/steps`), which the action checks against the stored row.
 */
export const updateDetailsSchema = z.object({
  name: createCollectionSchema.shape.name,
  symbol: createCollectionSchema.shape.symbol,
  description: z.string().trim().max(2000, 'Keep the description under 2,000 characters.'),
  maxSupply: createCollectionSchema.shape.maxSupply,
})

export type UpdateDetailsInput = z.infer<typeof updateDetailsSchema>
export type DetailsField = keyof UpdateDetailsInput
