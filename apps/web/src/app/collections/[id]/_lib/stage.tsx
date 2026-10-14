import 'server-only'
import { cache } from 'react'
import { StageFooter } from '@/components/shell/stage-footer'
import { StageLocked } from '@/components/shell/stage-locked'
import { StagePage } from '@/components/shell/stage-page'
import { errorSummary } from '@/lib/art/lock-core'
import type { Tables } from '@/lib/database.types'
import { createClient } from '@/lib/supabase/server'
import { sampleArtDeferred } from '@/lib/demo'
import {
  flowNeighbours,
  getStage,
  isDemoMode,
  isStageReadOnly,
  stageAccess,
  stageIndex,
  STAGES,
  UNLOCK_REQUIREMENTS,
  type StageSlug,
} from '@/lib/steps'

/** Route params of every page under `/collections/[id]`. */
export type CollectionParams = Promise<{ id: string }>
export type SearchParams = Promise<Record<string, string | string[] | undefined>>

/**
 * What a stage page needs to know about where it is, for an owned collection (the page has
 * already called `requireOwnedCollection`). `path` is the screen's path under the collection,
 * e.g. `art/rules`.
 *
 * `artDeferred` ("Finish the art later", MASTER_PLAN, Flow: pre-reveal) is the collection's
 * `art_deferred`; in sample mode it comes from the sample data, where `sample.art` (the page's
 * `?art=` param) picks the deferred scenario. The Art screens are read only once the art is locked
 * (`art_locked_at`), whatever the status says.
 */
export function stageContext(
  collection: Tables<'collections'>,
  stage: StageSlug,
  path: string,
  sample: { art?: string } = {},
  options: { placeholderReady?: boolean } = {},
) {
  const demo = isDemoMode()
  const artDeferred = demo ? sampleArtDeferred(sample.art) : collection.art_deferred
  const placeholderReady = options.placeholderReady ?? false
  const readOnly =
    !demo && stage === 'art'
      ? collection.art_locked_at !== null
      : isStageReadOnly(collection.status, stage, { demo, artDeferred })
  return {
    demo,
    artDeferred,
    access: stageAccess(collection.status, stage, { demo, artDeferred, placeholderReady }),
    readOnly,
    /** "Stage 2 of 4" for a build stage; none for Manage drop, which is not a stage. */
    eyebrow: stageIndex(stage) === -1 ? undefined : `Stage ${stageIndex(stage) + 1} of ${STAGES.length}`,
    ...flowNeighbours(collection.id, collection.project_type, path),
  }
}

/**
 * Whether a deferred collection's placeholder job is done, which opens Deploy while the collection is
 * still a draft (docs/specs/2026-10-14-deploy.md, section 9): one `collection_placeholder_ready` call
 * under the creator's session. False without a call for a collection that is not deferred or is
 * already deployed (Deploy is open and read-only there), and in sample mode, where every stage is
 * open anyway. A read that fails is logged and answers false, so a transient error never breaks the
 * workspace layout: Deploy stays locked until the next load. `cache` shares the answer within a
 * request: the layout and the page both pass the row `requireOwnedCollection` returns (cached by id,
 * so the same object), which makes one call. Pass that row, not a copy. The deploy page and the
 * collection layout pass the answer to `stageContext` and the stepper.
 */
export const placeholderReady = cache(
  async (collection: Pick<Tables<'collections'>, 'id' | 'art_deferred' | 'status'>): Promise<boolean> => {
    if (isDemoMode() || !collection.art_deferred || collection.status === 'deployed') return false
    try {
      const supabase = await createClient()
      const { data, error } = await supabase.rpc('collection_placeholder_ready', {
        p_collection_id: collection.id,
      })
      if (error) throw error
      return data === true
    } catch (error) {
      console.error(
        `The placeholder readiness could not be read for ${collection.id}: ${errorSummary(error)}`,
      )
      return false
    }
  },
)

/** The page for a stage that cannot be opened yet. */
export function LockedStagePage({
  collection,
  stage,
}: {
  collection: Tables<'collections'>
  stage: keyof typeof UNLOCK_REQUIREMENTS
}) {
  const { previous } = flowNeighbours(collection.id, collection.project_type, stage)
  return (
    <StagePage
      eyebrow={stageContext(collection, stage, stage).eyebrow}
      title={getStage(stage)!.name}
      description={getStage(stage)!.summary}
      footer={<StageFooter previous={previous} />}
    >
      <StageLocked collectionId={collection.id} projectType={collection.project_type} stage={stage} />
    </StagePage>
  )
}

/** A single search param as a string. */
export async function searchParam(searchParams: SearchParams, name: string): Promise<string | undefined> {
  const value = (await searchParams)[name]
  return Array.isArray(value) ? value[0] : value
}
