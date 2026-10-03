import 'server-only'
import { StageFooter } from '@/components/shell/stage-footer'
import { StageLocked } from '@/components/shell/stage-locked'
import { StagePage } from '@/components/shell/stage-page'
import type { Tables } from '@/lib/database.types'
import { sampleArtDeferred } from '@/lib/demo'
import {
  flowNeighbours,
  getStage,
  isDemoMode,
  isStageReadOnly,
  stageAccess,
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
 * `artDeferred` ("Finish the art later", decision D25) comes from the sample data in sample mode,
 * where `sample.art` (the page's `?art=` param) can pick the deferred scenario. Outside sample
 * mode it is false until Phase 3 adds the collection's column.
 */
export function stageContext(
  collection: Tables<'collections'>,
  stage: StageSlug,
  path: string,
  sample: { art?: string } = {},
) {
  const demo = isDemoMode()
  const artDeferred = demo ? sampleArtDeferred(sample.art) : false
  return {
    demo,
    artDeferred,
    access: stageAccess(collection.status, stage, { demo, artDeferred }),
    readOnly: isStageReadOnly(collection.status, stage, { demo, artDeferred }),
    /** The screen renders `lib/demo` sample data while sample-data mode is off: say so on the page. */
    sampleNotice: !demo,
    eyebrow: `Stage ${STAGES.findIndex((entry) => entry.slug === stage) + 1} of ${STAGES.length}`,
    ...flowNeighbours(collection.id, collection.project_type, path),
  }
}

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
