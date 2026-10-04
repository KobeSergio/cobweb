import type { Enums } from '@/lib/database.types'

export type CollectionStatus = Enums<'collection_status'>
export type ProjectType = Enums<'project_type'>

/**
 * The four build stages of a launch, in the order a creator moves through them. Each stage is a
 * route segment under `/collections/[id]/`. Art has its own second level (sub-steps, below).
 * Manage drop is not a stage: it is where a deployed collection lives (`MANAGE_STAGE`).
 */
export const STAGES = [
  {
    slug: 'details',
    name: 'Details',
    summary: 'The name and symbol, and the description collectors will read.',
  },
  {
    slug: 'art',
    name: 'Art',
    summary:
      'Upload your layers, set rarity and the rules for which traits go together, then generate and curate the collection.',
  },
  {
    slug: 'upload',
    name: 'Lock and upload',
    summary:
      'Lock the art and generate it to IPFS. The final images and metadata are rendered and stored there.',
  },
  {
    slug: 'deploy',
    name: 'Deploy',
    summary:
      'Choose a chain, set royalties and the payout address, and deploy the contract from your wallet.',
  },
] as const

/**
 * Manage drop: not a stage of the stepper. A deployed collection opens here, with its tabs under
 * the top bar and no stepper; the setup is done. Only deferred art stays reachable, from a
 * "Finish the art" entry beside the tabs.
 */
export const MANAGE_STAGE = {
  slug: 'manage',
  name: 'Manage drop',
  summary:
    'Set up phases and whitelists, customise the mint page, then reveal, airdrop and withdraw once it is live.',
} as const

/** Kept for the sign-in and help pages, which list the flow. Same list as `STAGES`. */
export const STEPS = STAGES

/** One of the four build stages in the stepper. */
export type BuildStage = (typeof STAGES)[number]
export type BuildStageSlug = BuildStage['slug']
/** A build stage or Manage drop: every first-level route of the collection workspace. */
export type Stage = BuildStage | typeof MANAGE_STAGE
export type StageSlug = Stage['slug']
/** Display state in the stage navigation. */
export type StageState = 'done' | 'current' | 'next' | 'pending'
/** Whether a stage can be opened. Done stages stay open (read-only where that applies). */
export type StageAccess = 'open' | 'locked'

/** @deprecated Use `Stage`. */
export type Step = Stage
/** @deprecated Use `StageSlug`. */
export type StepSlug = StageSlug

export function getStage(slug: string): Stage | undefined {
  if (slug === MANAGE_STAGE.slug) return MANAGE_STAGE
  return STAGES.find((stage) => stage.slug === slug)
}

/** Position of a build stage in `STAGES`, or -1 for Manage drop. */
export function stageIndex(stage: StageSlug): number {
  return STAGES.findIndex((entry) => entry.slug === stage)
}

/** @deprecated Use `getStage`. */
export const getStep = getStage

// ---------------------------------------------------------------------------------------------
// Art sub-steps. They depend on the project type: a generative project builds its art from
// layers; every other type uploads finished assets on one screen.
// ---------------------------------------------------------------------------------------------

export const ART_SUBSTEPS = {
  layers: { slug: 'layers', name: 'Layers', summary: 'Upload trait layers, order them and set rarity.' },
  rules: { slug: 'rules', name: 'Rules', summary: 'Choose which traits must, always or never go together.' },
  generate: {
    slug: 'generate',
    name: 'Generate',
    summary: 'Generate the tokens, then review, edit and curate them.',
  },
  'upload-assets': {
    slug: 'upload-assets',
    name: 'Assets',
    summary: 'Upload your finished artwork.',
  },
} as const

export type ArtSubStep = (typeof ART_SUBSTEPS)[keyof typeof ART_SUBSTEPS]
export type ArtSubStepSlug = ArtSubStep['slug']

const GENERATIVE_ART: readonly ArtSubStep[] = [ART_SUBSTEPS.layers, ART_SUBSTEPS.rules, ART_SUBSTEPS.generate]
const ASSET_ART: readonly ArtSubStep[] = [ART_SUBSTEPS['upload-assets']]

/** The Art sub-steps for a project type, in order. */
export function artSubSteps(projectType: ProjectType): readonly ArtSubStep[] {
  return projectType === 'generative' ? GENERATIVE_ART : ASSET_ART
}

/** Whether a sub-step belongs to this project type's Art stage. */
export function hasArtSubStep(projectType: ProjectType, slug: ArtSubStepSlug): boolean {
  return artSubSteps(projectType).some((sub) => sub.slug === slug)
}

// ---------------------------------------------------------------------------------------------
// Manage tabs. Not a sequence: once deployed, the creator moves between them freely.
// ---------------------------------------------------------------------------------------------

/** `slug` is the route segment under `manage/`; the overview is `manage` itself (empty segment). */
export const MANAGE_TABS = [
  { slug: '', key: 'overview', name: 'Overview' },
  { slug: 'phases', key: 'phases', name: 'Phases' },
  { slug: 'whitelist', key: 'whitelist', name: 'Whitelist' },
  { slug: 'mint-page', key: 'mint-page', name: 'Mint page' },
  { slug: 'airdrop', key: 'airdrop', name: 'Airdrop' },
  { slug: 'settings', key: 'settings', name: 'Settings' },
] as const

export type ManageTab = (typeof MANAGE_TABS)[number]
export type ManageTabKey = ManageTab['key']

// ---------------------------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------------------------

/** `/collections/<id>` plus any segments. */
export function collectionHref(collectionId: string, ...segments: string[]): string {
  return ['/collections', collectionId, ...segments.filter(Boolean)].join('/')
}

/** The landing route of a stage. Art opens on its first sub-step for the project type. */
export function stageHref(collectionId: string, stage: StageSlug, projectType: ProjectType): string {
  if (stage === 'art') return artSubStepHref(collectionId, artSubSteps(projectType)[0]!.slug)
  return collectionHref(collectionId, stage)
}

export function artSubStepHref(collectionId: string, sub: ArtSubStepSlug): string {
  return collectionHref(collectionId, 'art', sub)
}

export function manageTabHref(collectionId: string, tab: ManageTabKey): string {
  const entry = MANAGE_TABS.find((candidate) => candidate.key === tab)!
  return collectionHref(collectionId, 'manage', entry.slug)
}

// ---------------------------------------------------------------------------------------------
// Progress from the collection's status
// ---------------------------------------------------------------------------------------------

/**
 * Index in `STAGES` of the stage to work on next, for each status. `STAGES.length` means every
 * build stage is done and the collection lives in Manage drop.
 */
const NEXT_STAGE_INDEX: Record<CollectionStatus, number> = {
  draft: 1, // details exist; art is next
  art_locked: 2, // art is locked; generate it to IPFS
  rendering: 2,
  rendered: 3, // on IPFS; deploy is next
  deployed: STAGES.length, // deployed; manage the drop
}

/**
 * Whether a build stage is finished. A deployed collection has finished all four. Manage drop is
 * never finished: it is where a deployed collection lives.
 */
export function isStageDone(stage: StageSlug, status: CollectionStatus): boolean {
  if (stage === MANAGE_STAGE.slug) return false
  return stageIndex(stage) < NEXT_STAGE_INDEX[status]
}

/** @deprecated Use `isStageDone`. */
export const isStepDone = isStageDone

/**
 * Where a collection in the given status opens: the build stage to work on next, or Manage drop
 * once it is deployed.
 */
export function nextStage(status: CollectionStatus): Stage {
  return STAGES[NEXT_STAGE_INDEX[status]] ?? MANAGE_STAGE
}

/** Whether the collection lives in Manage drop: the stepper is gone and the Manage tabs replace it. */
export function isDeployed(status: CollectionStatus): boolean {
  return status === 'deployed'
}

/** @deprecated Use `nextStage`. Returns the stage, which has `slug` and `name`. */
export const nextStep = nextStage

/** Sample-data mode: every stage is open and screens render `lib/demo`. Set in `.env.local`. */
export function isDemoMode(): boolean {
  return process.env.NEXT_PUBLIC_DEMO_DATA === '1'
}

/**
 * Options shared by the access rules. `artDeferred`: the creator chose "Finish the art later"
 * (MASTER_PLAN, Flow: pre-reveal) and has not locked the real set yet.
 */
export type StageOptions = { demo?: boolean; artDeferred?: boolean }

/**
 * Whether a stage can be opened. A build stage is locked until the one before it is done; done
 * stages stay open. With deferred art, Lock and upload opens without finished art, for the
 * placeholder. Manage drop opens once the contract is deployed. In sample-data mode everything
 * is open.
 */
export function stageAccess(
  status: CollectionStatus,
  stage: StageSlug,
  options: StageOptions = {},
): StageAccess {
  if (options.demo ?? isDemoMode()) return 'open'
  if (stage === MANAGE_STAGE.slug) return isDeployed(status) ? 'open' : 'locked'
  if (stage === 'upload' && options.artDeferred) return 'open'
  const index = stageIndex(stage)
  if (index === 0) return 'open'
  return isStageDone(STAGES[index - 1]!.slug, status) ? 'open' : 'locked'
}

/**
 * Whether a stage's screens are read-only: the stage is done and its result is frozen. Before
 * deploy, Details is never wholly read-only; individual fields freeze instead (see
 * `frozenDetailFields`). Once deployed, all four build stages are read-only history (the mint
 * page's description is edited in Manage drop). Deferred art is the one exception for a done
 * stage: Art stays editable after lock, render and deploy until the real set is locked. Not
 * read-only in sample-data mode, so every control can be tried.
 */
export function isStageReadOnly(
  status: CollectionStatus,
  stage: StageSlug,
  options: StageOptions = {},
): boolean {
  if (options.demo ?? isDemoMode()) return false
  if (stage === MANAGE_STAGE.slug) return false
  if (stage === 'art' && options.artDeferred) return false
  if (stage === 'details') return isDeployed(status)
  return isStageDone(stage, status)
}

/**
 * Detail fields the database will refuse to change in this status
 * (the `collections_guard_frozen_fields` trigger). The project type never changes after creation.
 */
export function frozenDetailFields(
  status: CollectionStatus,
): ReadonlySet<'name' | 'symbol' | 'maxSupply' | 'projectType'> {
  const frozen = new Set<'name' | 'symbol' | 'maxSupply' | 'projectType'>(['projectType'])
  if (status !== 'draft') frozen.add('maxSupply')
  if (status === 'deployed') {
    frozen.add('name')
    frozen.add('symbol')
  }
  return frozen
}

/** What has to happen before a locked stage opens, and where to do it. */
export const UNLOCK_REQUIREMENTS: Record<
  Exclude<StageSlug, 'details' | 'art'>,
  { requirement: string; action: string; stage: StageSlug }
> = {
  upload: {
    requirement: 'Finish your art and lock it before it can be rendered and uploaded.',
    action: 'Go to Art',
    stage: 'art',
  },
  deploy: {
    requirement: 'Your art has to be rendered and stored on IPFS before the contract can be deployed.',
    action: 'Go to Lock and upload',
    stage: 'upload',
  },
  manage: {
    requirement: 'Deploy the contract first. Phases, whitelists and the mint page are set up on it.',
    action: 'Go to Deploy',
    stage: 'deploy',
  },
}

// ---------------------------------------------------------------------------------------------
// The linear path, for Back and Continue
// ---------------------------------------------------------------------------------------------

export type FlowLink = { href: string; name: string }

/**
 * Every screen of the linear flow, in order, as `[path under the collection, name]`. Manage drop
 * closes the list: it is not a stage, but it is where Deploy's Continue leads.
 */
export function flowScreens(projectType: ProjectType): { path: string; name: string }[] {
  return [
    { path: 'details', name: 'Details' },
    ...artSubSteps(projectType).map((sub) => ({ path: `art/${sub.slug}`, name: sub.name })),
    { path: 'upload', name: 'Lock and upload' },
    { path: 'deploy', name: 'Deploy' },
    { path: 'manage', name: 'Manage drop' },
  ]
}

/**
 * The screens before and after `path` in the linear flow, for a page's Back and Continue
 * buttons. `path` is relative to the collection, for example `art/rules` or `deploy`.
 */
export function flowNeighbours(
  collectionId: string,
  projectType: ProjectType,
  path: string,
): { previous?: FlowLink; next?: FlowLink } {
  const screens = flowScreens(projectType)
  const index = screens.findIndex((screen) => screen.path === path)
  if (index === -1) return {}
  const link = (screen: { path: string; name: string } | undefined) =>
    screen && { href: collectionHref(collectionId, screen.path), name: screen.name }
  return { previous: link(screens[index - 1]), next: link(screens[index + 1]) }
}
