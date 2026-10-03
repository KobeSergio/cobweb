import { redirect } from 'next/navigation'
import { AssetsScreen } from '@/components/art/assets-screen'
import { StageFooter } from '@/components/shell/stage-footer'
import { StagePage } from '@/components/shell/stage-page'
import { requireOwnedCollection } from '@/lib/auth'
import { DEMO_ASSETS } from '@/lib/demo'
import { artSubSteps, hasArtSubStep, stageHref } from '@/lib/steps'
import { stageContext, type CollectionParams } from '../../_lib/stage'

/** Art for 1/1s, metadata and single asset projects: one upload screen. Sample data until uploads exist. */
export default async function Page({ params }: { params: CollectionParams }) {
  const { id } = await params
  const collection = await requireOwnedCollection(id)
  if (!hasArtSubStep(collection.project_type, 'upload-assets'))
    redirect(stageHref(collection.id, 'art', collection.project_type))
  const ctx = stageContext(collection, 'art', 'art/upload-assets')
  const subs = artSubSteps(collection.project_type)
  const index = subs.findIndex((sub) => sub.slug === 'upload-assets')

  return (
    <StagePage
      eyebrow={subs.length > 1 ? `Art · Step ${index + 1} of ${subs.length}` : 'Art'}
      title="Assets"
      description={subs[index]!.summary}
      sampleNotice={ctx.sampleNotice}
      width="wide"
      footer={<StageFooter previous={ctx.previous} next={ctx.next} />}
    >
      <AssetsScreen collection={collection} assets={DEMO_ASSETS} readOnly={ctx.readOnly} />
    </StagePage>
  )
}
