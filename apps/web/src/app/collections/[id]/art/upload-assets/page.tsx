import { redirect } from 'next/navigation'
import { AssetsScreen } from '@/components/art/assets-screen'
import { StageFooter } from '@/components/shell/stage-footer'
import { StagePage } from '@/components/shell/stage-page'
import { requireOwnedCollection } from '@/lib/auth'
import { DEMO_ASSETS } from '@/lib/demo'
import { artSubSteps, hasArtSubStep, stageHref } from '@/lib/steps'
import { stageContext, type CollectionParams } from '../../_lib/stage'

const DESCRIPTION = {
  one_of_one:
    'Upload your finished artworks. Each one can have several editions and its own attributes; the supply is the total.',
  single_asset:
    'Upload the one image, GIF or video every token shares, and set the quantity. That quantity is the supply.',
} as const

/**
 * Art for 1/1s and single asset projects: one upload screen, where the supply is set. Creating
 * either type lands here. Sample assets in sample-data mode; a real collection starts empty.
 */
export default async function Page({ params }: { params: CollectionParams }) {
  const { id } = await params
  const collection = await requireOwnedCollection(id)
  if (collection.project_type === 'generative' || !hasArtSubStep(collection.project_type, 'upload-assets'))
    redirect(stageHref(collection.id, 'art', collection.project_type))
  const ctx = stageContext(collection, 'art', 'art/upload-assets')
  const subs = artSubSteps(collection.project_type)
  const index = subs.findIndex((sub) => sub.slug === 'upload-assets')

  return (
    <StagePage
      eyebrow={subs.length > 1 ? `Art · Step ${index + 1} of ${subs.length}` : 'Art'}
      title={collection.project_type === 'single_asset' ? 'Asset' : 'Assets'}
      description={DESCRIPTION[collection.project_type]}
      width="wide"
      footer={<StageFooter previous={ctx.previous} next={ctx.next} />}
    >
      <AssetsScreen collection={collection} assets={ctx.demo ? DEMO_ASSETS : []} readOnly={ctx.readOnly} />
    </StagePage>
  )
}
