import { redirect } from 'next/navigation'
import { LayersScreen } from '@/components/art/layers-screen'
import { StagePage } from '@/components/shell/stage-page'
import { requireOwnedCollection } from '@/lib/auth'
import { DEMO_LAYERS, DEMO_TRAIT_COUNTS } from '@/lib/demo'
import { artSubSteps, hasArtSubStep, stageHref } from '@/lib/steps'
import { searchParam, stageContext, type CollectionParams, type SearchParams } from '../../_lib/stage'

/**
 * Art, step 1 (generative): layers and rarity. Sample data until the art tables exist. In sample
 * mode `?art=deferred` shows the deferred-art scenario.
 */
export default async function Page({
  params,
  searchParams,
}: {
  params: CollectionParams
  searchParams: SearchParams
}) {
  const { id } = await params
  const collection = await requireOwnedCollection(id)
  if (!hasArtSubStep(collection.project_type, 'layers'))
    redirect(stageHref(collection.id, 'art', collection.project_type))
  const ctx = stageContext(collection, 'art', 'art/layers', { art: await searchParam(searchParams, 'art') })
  const subs = artSubSteps(collection.project_type)
  const index = subs.findIndex((sub) => sub.slug === 'layers')

  return (
    <StagePage
      eyebrow={subs.length > 1 ? `Art · Step ${index + 1} of ${subs.length}` : 'Art'}
      title="Layers"
      description={subs[index]!.summary}
      sampleNotice={ctx.sampleNotice}
      width="wide"
      bodyHasFooter
    >
      <LayersScreen
        collection={collection}
        layers={DEMO_LAYERS}
        traitCounts={DEMO_TRAIT_COUNTS}
        readOnly={ctx.readOnly}
        artDeferred={ctx.artDeferred}
        canDefer={ctx.demo}
      />
    </StagePage>
  )
}
