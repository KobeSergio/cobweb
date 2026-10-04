import { z } from 'zod'
import { createCollectionSchema } from '@/lib/collections'

/**
 * Editing a collection's details. The same field rules as creating one. The project type is not
 * editable, and neither is the supply here: it is set at Generate or from the uploads
 * (`setCollectionSupply`). Which fields may still change depends on the status
 * (`frozenDetailFields` in `lib/steps`), which the action checks against the stored row.
 */
export const updateDetailsSchema = z.object({
  name: createCollectionSchema.shape.name,
  symbol: createCollectionSchema.shape.symbol,
  description: z.string().trim().max(2000, 'Keep the description under 2,000 characters.'),
})

export type UpdateDetailsInput = z.infer<typeof updateDetailsSchema>
export type DetailsField = keyof UpdateDetailsInput
