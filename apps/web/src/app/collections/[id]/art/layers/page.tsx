import { redirect } from 'next/navigation'
import { LayersScreen } from '@/components/art/layers-screen'
import { StagePage } from '@/components/shell/stage-page'
import { requireOwnedCollection } from '@/lib/auth'
import { DEMO_COLLECTIONS, DEMO_LAYERS, DEMO_TRAIT_COUNTS } from '@/lib/demo'
import { artSubSteps, hasArtSubStep, stageHref } from '@/lib/steps'
import { searchParam, stageContext, type CollectionParams, type SearchParams } from '../../_lib/stage'

/**
 * Art, step 1 (generative): layers and rarity. A new generative collection lands here, and with no
 * layers it opens as the folder upload. Sample layers in sample-data mode (`?layers=empty` shows the
 * folder upload there; `?art=deferred` the deferred-art scenario); a real collection starts empty
 * until the art tables exist.
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
  const sample = ctx.demo && (await searchParam(searchParams, 'layers')) !== 'empty'

  return (
    <StagePage
      eyebrow={subs.length > 1 ? `Art · Step ${index + 1} of ${subs.length}` : 'Art'}
      title="Layers"
      description={subs[index]!.summary}
      width="wide"
      bodyHasFooter
    >
      <LayersScreen
        collection={collection}
        collections={sample ? DEMO_COLLECTIONS : []}
        layers={sample ? DEMO_LAYERS : []}
        traitCounts={sample ? DEMO_TRAIT_COUNTS : {}}
        readOnly={ctx.readOnly}
        artDeferred={ctx.artDeferred}
      />
    </StagePage>
  )
}
