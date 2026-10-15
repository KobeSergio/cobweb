import { getAddress, isAddress, zeroAddress, type Address } from 'viem'
import { z } from 'zod'
import { QUOTA_RANGE, UNSAVED, WHITELIST_FULL, WRONG_GROUP, ZERO_ADDRESS } from '@/lib/art/result'
import { onchainIdShape } from './phase-schemas'
import type { ChunkEntry } from './whitelist-types'
import { QUOTA_MAX, USAGE_PAGE, WHITELIST_MAX } from './whitelist-view'

/**
 * What the Whitelist actions accept from the browser (docs/specs/2026-10-15-whitelist.md, section 6.5),
 * checked before the session and owner read (CLAUDE.md rule 4). A malformed value means the page is out of
 * date (UNSAVED) unless a sentence is named.
 */

/** A whitelist group: 1 or more, since 0 is the public sale. */
export const groupIdShape = onchainIdShape.min(1, WRONG_GROUP)

/** A quota: a whole number from 1 to 10,000. */
export const quotaShape = z
  .number({ error: QUOTA_RANGE })
  .int(QUOTA_RANGE)
  .min(1, QUOTA_RANGE)
  .max(QUOTA_MAX, QUOTA_RANGE)

/** A valid address (mixed case must pass its checksum), not the zero address, answered checksummed. */
export const addressShape: z.ZodType<Address> = z
  .string({ error: UNSAVED })
  .refine((value) => isAddress(value), UNSAVED)
  .refine((value) => value.toLowerCase() !== zeroAddress, ZERO_ADDRESS)
  .transform((value) => getAddress(value))

const entryShape = z.object({ address: addressShape, quota: quotaShape }, { error: UNSAVED })

/**
 * An add: 1 to 10,000 rows (more is a full whitelist), an address repeated in any case merged into one row
 * with its last quota, since the database keys rows by the lowercase address.
 */
export const addEntriesShape: z.ZodType<ChunkEntry[]> = z
  .array(entryShape, { error: UNSAVED })
  .min(1, UNSAVED)
  .max(WHITELIST_MAX, WHITELIST_FULL)
  .transform((rows) => {
    const merged = new Map<string, ChunkEntry>()
    for (const row of rows) merged.set(row.address.toLowerCase(), row)
    return [...merged.values()]
  })

/** A page of the table's addresses for the usage read: 1 to 25. */
export const usageShape: z.ZodType<Address[]> = z
  .array(addressShape, { error: UNSAVED })
  .min(1, UNSAVED)
  .max(USAGE_PAGE, UNSAVED)

/** A holder snapshot's chain and contract. */
export const snapshotShape: z.ZodType<{ chainId: number; contract: Address }> = z.object(
  { chainId: z.number({ error: UNSAVED }).int(UNSAVED).positive(UNSAVED), contract: addressShape },
  { error: UNSAVED },
)
