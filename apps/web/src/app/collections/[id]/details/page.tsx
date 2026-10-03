import { DetailsForm } from '@/components/details/details-form'
import { StagePage } from '@/components/shell/stage-page'
import { requireOwnedCollection } from '@/lib/auth'
import { getStage } from '@/lib/steps'
import { stageContext, type CollectionParams } from '../_lib/stage'

/** Stage 1: the collection's details. Real data: reads and writes the `collections` row. */
export default async function DetailsPage({ params }: { params: CollectionParams }) {
  const { id } = await params
  const collection = await requireOwnedCollection(id)
  const { eyebrow, next } = stageContext(collection, 'details', 'details')

  return (
    <StagePage
      eyebrow={eyebrow}
      title="Details"
      description={getStage('details')!.summary}
      width="narrow"
      bodyHasFooter
    >
      <DetailsForm collection={collection} next={next} />
    </StagePage>
  )
}
