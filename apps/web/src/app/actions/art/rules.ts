'use server'

import { isBidirectional } from '@cobweb/dna'
import type { ActionResult } from '@/lib/art/result'
import { ruleKindToDb } from '@/lib/art/rows'
import { parse, ruleInput, uuid, type RuleInput } from '@/lib/art/schemas'
import { artWrite, created, one } from '@/lib/art/write'

const row = (rule: RuleInput) => ({
  kind: ruleKindToDb(rule.kind),
  trait_id: rule.traitId,
  related_trait_ids: rule.relatedTraitIds,
  bidirectional: isBidirectional(rule.kind),
})

export async function addRule(collectionId: string, rule: RuleInput): Promise<ActionResult<{ id: string }>> {
  const input = parse(ruleInput, rule)
  if (!input.ok) return input
  return artWrite(collectionId, ({ supabase }) =>
    created(
      supabase
        .from('rules')
        .insert({ collection_id: collectionId, ...row(input.data) })
        .select('id')
        .single(),
    ),
  )
}

export async function updateRule(collectionId: string, id: string, rule: RuleInput): Promise<ActionResult> {
  const ruleId = parse(uuid, id)
  if (!ruleId.ok) return ruleId
  const input = parse(ruleInput, rule)
  if (!input.ok) return input
  return artWrite(collectionId, ({ supabase }) =>
    one(
      supabase
        .from('rules')
        .update(row(input.data))
        .eq('id', ruleId.data)
        .eq('collection_id', collectionId)
        .select('id'),
    ),
  )
}

export async function deleteRule(collectionId: string, id: string): Promise<ActionResult> {
  const input = parse(uuid, id)
  if (!input.ok) return input
  return artWrite(collectionId, ({ supabase }) =>
    one(supabase.from('rules').delete().eq('id', input.data).eq('collection_id', collectionId).select('id')),
  )
}
