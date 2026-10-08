import { countTraits } from '@cobweb/dna'
import { redirect } from 'next/navigation'
import { GenerateScreen } from '@/components/art/generate-screen'
import { StagePage } from '@/components/shell/stage-page'
import { loadArtProject } from '@/lib/art/load'
import { requireOwnedCollection } from '@/lib/auth'
import { DEMO_COLLECTIONS, DEMO_LAYERS, DEMO_RULES, DEMO_TOKENS, DEMO_TRAIT_COUNTS } from '@/lib/demo'
import { artSubSteps, hasArtSubStep, stageHref } from '@/lib/steps'
import { searchParam, stageContext, type CollectionParams, type SearchParams } from '../../_lib/stage'

/**
 * Art, step 3 (generative): generate and curate the tokens. A real collection shows its rows and its
 * saved set; sample-data mode shows the sample set, and `?art=deferred` the deferred-art scenario.
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
  if (!hasArtSubStep(collection.project_type, 'generate'))
    redirect(stageHref(collection.id, 'art', collection.project_type))
  const ctx = stageContext(collection, 'art', 'art/generate', { art: await searchParam(searchParams, 'art') })
  const subs = artSubSteps(collection.project_type)
  const index = subs.findIndex((sub) => sub.slug === 'generate')
  const project = ctx.demo ? null : await loadArtProject(collection)

  return (
    <StagePage
      eyebrow={subs.length > 1 ? `Art · Step ${index + 1} of ${subs.length}` : 'Art'}
      title="Generate"
      description={subs[index]!.summary}
      width="wide"
      bodyHasFooter
    >
      <GenerateScreen
        collection={collection}
        collections={project ? (project.collections ?? []) : DEMO_COLLECTIONS}
        layers={project ? (project.layers ?? []) : DEMO_LAYERS}
        rules={project ? (project.rules ?? []) : DEMO_RULES}
        tokens={project ? (project.tokens ?? null) : DEMO_TOKENS}
        traitCounts={project ? countTraits(project.tokens ?? []) : DEMO_TRAIT_COUNTS}
        readOnly={ctx.readOnly}
        artDeferred={ctx.artDeferred}
      />
    </StagePage>
  )
}
