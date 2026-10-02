import type { Enums } from '@/lib/database.types'

export type CollectionStatus = Enums<'collection_status'>

/** The linear launch flow. The order here is the order a creator moves through it. */
export const STEPS = [
  {
    slug: 'details',
    name: 'Details',
    summary: 'The name, symbol, supply and kind of collection.',
    upcoming: 'editing these details, a description, and the banner and avatar for the mint page.',
  },
  {
    slug: 'art',
    name: 'Art',
    summary:
      'Upload layers, generate the collection and curate it. Then lock it and pay the generation fee, and the final images are rendered and stored on IPFS.',
    upcoming: 'layers, rarity, rules, preview and token editing, then lock and pay.',
  },
  {
    slug: 'deploy',
    name: 'Deploy',
    summary: 'Choose a chain and deploy the collection contract from your wallet.',
    upcoming: 'the chain picker, contract settings, royalties and the deploy transaction.',
  },
  {
    slug: 'phases',
    name: 'Phases',
    summary: 'Set up the public sale and any whitelist phases: price, supply and start time.',
    upcoming: 'creating and editing phases, with Open now, Close and Schedule for each.',
  },
  {
    slug: 'whitelist',
    name: 'Whitelist',
    summary: 'Upload a CSV of wallet addresses and how many each may mint.',
    upcoming: 'CSV upload, validation, and writing the list on-chain in batches.',
  },
  {
    slug: 'mint-page',
    name: 'Mint page',
    summary: 'The public page where collectors mint.',
    upcoming: 'a preview of the mint page, its customisation, and the link to share.',
  },
  {
    slug: 'manage',
    name: 'Manage',
    summary: 'Reveal, airdrop, withdraw proceeds and lock transfers after launch.',
    upcoming: 'reveal, airdrops, withdrawals, phase changes and transfer locking.',
  },
] as const

export type Step = (typeof STEPS)[number]
export type StepSlug = Step['slug']
export type StepState = 'done' | 'current' | 'pending'

export function getStep(slug: string): Step | undefined {
  return STEPS.find((step) => step.slug === slug)
}

/** Position of each status in the flow, as the index of the first step that is not yet done. */
const FIRST_OPEN_STEP: Record<CollectionStatus, number> = {
  draft: 1, // details exist; art is next
  art_locked: 1,
  rendering: 1,
  rendered: 2, // art is done; deploy is next
  deployed: 3, // deployed; phases onward are open
}

/** Whether a step is finished for a collection in the given status. */
export function isStepDone(slug: StepSlug, status: CollectionStatus): boolean {
  const index = STEPS.findIndex((step) => step.slug === slug)
  return index < FIRST_OPEN_STEP[status]
}

/** The step a creator should be working on for a collection in the given status. */
export function nextStep(status: CollectionStatus): Step {
  return STEPS[FIRST_OPEN_STEP[status]]!
}
