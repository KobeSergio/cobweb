import { z } from 'zod'
import { NO_CHAIN, NOT_A_HASH } from './result'

/** lockArt's options: the duplicates choice and the chain the creator's wallet is on (spec section 7). */
export const lockArtInput = z.object({
  allowDuplicates: z.boolean(),
  chainId: z.number().int(NO_CHAIN).positive(NO_CHAIN),
})
export type LockArtInput = z.input<typeof lockArtInput>

/** A transaction hash, lowercased as the database stores it. */
export const txHash = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, NOT_A_HASH)
  .transform((value) => value.toLowerCase() as `0x${string}`)
