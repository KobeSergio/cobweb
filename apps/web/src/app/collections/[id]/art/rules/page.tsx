import { analyseRules, buildTraitIndex } from '@cobweb/dna'
import { redirect } from 'next/navigation'
import { RulesScreen } from '@/components/art/rules-screen'
import { StagePage } from '@/components/shell/stage-page'
import { loadArtProject } from '@/lib/art/load'
import { requireOwnedCollection } from '@/lib/auth'
import { DEMO_COLLECTIONS, DEMO_LAYERS, DEMO_RULE_CONFLICTS, DEMO_RULES } from '@/lib/demo'
import { artSubSteps, hasArtSubStep, stageHref } from '@/lib/steps'
import { searchParam, stageContext, type CollectionParams, type SearchParams } from '../../_lib/stage'

/**
 * Art, step 2 (generative): trait-pairing rules. A real collection shows its rows; sample-data mode
 * shows the sample rules, and `?art=deferred` the deferred-art scenario.
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
  if (!hasArtSubStep(collection.project_type, 'rules'))
    redirect(stageHref(collection.id, 'art', collection.project_type))
  const ctx = stageContext(collection, 'art', 'art/rules', { art: await searchParam(searchParams, 'art') })
  const subs = artSubSteps(collection.project_type)
  const index = subs.findIndex((sub) => sub.slug === 'rules')
  const project = ctx.demo ? null : await loadArtProject(collection)
  const layers = project ? (project.layers ?? []) : DEMO_LAYERS
  const rules = project ? (project.rules ?? []) : DEMO_RULES

  return (
    <StagePage
      eyebrow={subs.length > 1 ? `Art · Step ${index + 1} of ${subs.length}` : 'Art'}
      title="Rules"
      description={subs[index]!.summary}
      width="wide"
      bodyHasFooter
    >
      <RulesScreen
        collection={collection}
        collections={project ? (project.collections ?? []) : DEMO_COLLECTIONS}
        layers={layers}
        rules={rules}
        conflicts={project ? analyseRules(layers, rules, buildTraitIndex(layers)) : DEMO_RULE_CONFLICTS}
        readOnly={ctx.readOnly}
        artDeferred={ctx.artDeferred}
      />
    </StagePage>
  )
}
