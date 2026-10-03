import { redirect } from 'next/navigation'
import { RulesScreen } from '@/components/art/rules-screen'
import { StagePage } from '@/components/shell/stage-page'
import { requireOwnedCollection } from '@/lib/auth'
import { DEMO_LAYERS, DEMO_RULE_CONFLICTS, DEMO_RULES } from '@/lib/demo'
import { artSubSteps, hasArtSubStep, stageHref } from '@/lib/steps'
import { stageContext, type CollectionParams } from '../../_lib/stage'

/** Art, step 2 (generative): trait-pairing rules. Sample data until the art tables exist. */
export default async function Page({ params }: { params: CollectionParams }) {
  const { id } = await params
  const collection = await requireOwnedCollection(id)
  if (!hasArtSubStep(collection.project_type, 'rules'))
    redirect(stageHref(collection.id, 'art', collection.project_type))
  const ctx = stageContext(collection, 'art', 'art/rules')
  const subs = artSubSteps(collection.project_type)
  const index = subs.findIndex((sub) => sub.slug === 'rules')

  return (
    <StagePage
      eyebrow={subs.length > 1 ? `Art · Step ${index + 1} of ${subs.length}` : 'Art'}
      title="Rules"
      description={subs[index]!.summary}
      sampleNotice={ctx.sampleNotice}
      width="wide"
      bodyHasFooter
    >
      <RulesScreen
        collection={collection}
        layers={DEMO_LAYERS}
        rules={DEMO_RULES}
        conflicts={DEMO_RULE_CONFLICTS}
        readOnly={ctx.readOnly}
      />
    </StagePage>
  )
}
