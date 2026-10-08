'use server'

import { z } from 'zod'
import { done, type ActionResult } from '@/lib/art/result'
import { parse, seed as seedSchema, tokenIds, tokenPatches, tokenSet } from '@/lib/art/schemas'
import type { TokenInput, TokenPatch } from '@/lib/art/token-ops'
import { artWrite, ran } from '@/lib/art/write'

/** Replaces the whole set and records its seed (Generate, Shuffle). */
export async function saveTokens(
  collectionId: string,
  tokens: TokenInput[],
  seed: number,
): Promise<ActionResult> {
  const input = parse(z.object({ tokens: tokenSet, seed: seedSchema }), { tokens, seed })
  if (!input.ok) return input
  return artWrite(collectionId, ({ supabase }) =>
    ran(
      supabase.rpc('art_save_tokens', {
        p_collection_id: collectionId,
        p_tokens: input.data.tokens,
        p_seed: input.data.seed,
      }),
    ),
  )
}

/** Writes changed DNA and descriptions (re-roll, change one trait, describe). */
export async function updateTokens(collectionId: string, rows: TokenPatch[]): Promise<ActionResult> {
  const input = parse(tokenPatches, rows)
  if (!input.ok) return input
  if (input.data.length === 0) return done
  return artWrite(collectionId, ({ supabase }) =>
    ran(supabase.rpc('art_update_tokens', { p_collection_id: collectionId, p_rows: input.data })),
  )
}

/** Swaps two token ids in one statement under the deferrable key. */
export async function swapTokens(collectionId: string, a: number, b: number): Promise<ActionResult> {
  const input = parse(tokenIds, [a, b])
  if (!input.ok) return input
  return artWrite(collectionId, ({ supabase }) =>
    ran(supabase.rpc('swap_token_ids_for_check', { p_collection_id: collectionId, p_a: a, p_b: b })),
  )
}

/** Deletes tokens; later ids move up so ids stay 1 to N. */
export async function deleteTokens(collectionId: string, ids: number[]): Promise<ActionResult> {
  const input = parse(tokenIds, ids)
  if (!input.ok) return input
  return artWrite(collectionId, ({ supabase }) =>
    ran(supabase.rpc('art_delete_tokens', { p_collection_id: collectionId, p_ids: input.data })),
  )
}

/** Adds tokens after the last id (Fill to size). */
export async function appendTokens(collectionId: string, tokens: TokenInput[]): Promise<ActionResult> {
  const input = parse(tokenSet, tokens)
  if (!input.ok) return input
  if (input.data.length === 0) return done
  return artWrite(collectionId, ({ supabase }) =>
    ran(
      supabase.from('tokens').insert(
        input.data.map((token) => ({
          collection_id: collectionId,
          token_id: token.tokenId,
          art_collection_id: token.artCollectionId,
          dna: token.dna,
          description: token.description,
        })),
      ),
    ),
  )
}

/** Clears the generated set before a structural edit. */
export async function clearTokens(collectionId: string): Promise<ActionResult> {
  return artWrite(collectionId, ({ supabase }) =>
    ran(supabase.from('tokens').delete().eq('collection_id', collectionId)),
  )
}
