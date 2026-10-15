/**
 * One coherent sample drop, "Night Owls", for sample-data mode and for screens whose backend does
 * not exist yet. Everything is deterministic: fixed timestamps relative to `DEMO_NOW` and seeded
 * values, so the server and the browser render the same thing.
 *
 * The story: 777 owls, generated and rendered, deployed on Base. The whitelist phase is live,
 * the public sale is scheduled, and the team allocation was minted and closed.
 */
import {
  DEMO_COLLECTIONS,
  DEMO_LAYERS,
  DEMO_PREVIEW_COUNT,
  DEMO_RULE_CONFLICTS,
  DEMO_RULES,
  DEMO_SEED,
  DEMO_TOKEN_COUNT,
  tokenLayerUrls,
} from './art'
import {
  attributeKeyOf,
  buildTraitIndex,
  countTraits,
  generateProject,
  rankTokens,
  seededRandom,
} from '@cobweb/dna'
import { mulWei, sampleAddress, sampleHex, sampleTxHash, sumWei, toWei } from './helpers'
import type {
  Address,
  AirdropRecord,
  DeployDraft,
  Deployment,
  DropActivity,
  FeeSnapshot,
  GeneratedToken,
  GroupWhitelist,
  MintGroup,
  MintPageData,
  MintPageSections,
  MintPageSettings,
  MintPageVariant,
  RenderJob,
  RenderJobState,
  RenderPlaceholder,
  SupportedChain,
  TraitCounts,
  UploadedAsset,
  WalletState,
  WhitelistChunk,
  WhitelistEntry,
} from './types'

export { DEMO_COLLECTIONS, DEMO_LAYERS, DEMO_RULES, DEMO_RULE_CONFLICTS, DEMO_TOKEN_COUNT }

/** "Now" for the sample: 2026-10-03 15:00 UTC. Never `Date.now()`. */
export const DEMO_NOW = 1_791_039_600
const HOUR = 3600
const DAY = 24 * HOUR

export const DEMO_COLLECTION = {
  name: 'Night Owls',
  symbol: 'OWLS',
  slug: 'night-owls',
  maxSupply: DEMO_TOKEN_COUNT,
  description:
    'Seven hundred and seventy-seven owls who keep odd hours. Each one is drawn from seven layers of hand-built traits, with a few golden owls hidden among them.',
  /**
   * "Finish the art later" (MASTER_PLAN, Flow: pre-reveal): the creator deploys on a placeholder and locks the real
   * set afterwards. Replaced by: the collection's deferred-art column (Phase 3). The second sample
   * scenario, `DEMO_ART_DEFERRED`, has it on.
   */
  artDeferred: false as boolean,
}

// ---------------------------------------------------------------------------------------------
// Art
// ---------------------------------------------------------------------------------------------

/**
 * The generated set, ranked: the owls are 1 to 600, the owlets 601 to 777. Tokens 1 to 24 have a
 * `previewUrl`; stack `tokenLayerUrls(dna)` for the rest. Same seed as `scripts/make-demo-art.mjs`.
 */
export const DEMO_TOKENS: GeneratedToken[] = rankTokens(
  generateProject(
    { layers: DEMO_LAYERS, rules: DEMO_RULES, collections: DEMO_COLLECTIONS },
    DEMO_SEED,
  ).tokens.map((token) => ({ ...token, name: `${DEMO_COLLECTION.name} #${token.id}` })),
  attributeKeyOf(buildTraitIndex(DEMO_LAYERS)),
).map((token) => ({
  ...token,
  previewUrl: token.id <= DEMO_PREVIEW_COUNT ? `/demo/tokens/${token.id}.svg` : null,
}))

/** How many tokens carry each trait. */
export const DEMO_TRAIT_COUNTS: TraitCounts = countTraits(DEMO_TOKENS)

export { tokenLayerUrls }

/** Sample uploads for the non-generative project types (1/1s and single asset). */
export const DEMO_ASSETS: UploadedAsset[] = DEMO_TOKENS.slice(0, 12).map((token, index) => ({
  id: token.id,
  fileName: `night-owl-${token.id}.svg`,
  imageUrl: token.previewUrl!,
  mediaType: 'image',
  quantity: index === 0 ? 5 : 1,
  attributes: token.dna.flatMap((traitId) => {
    const layer = DEMO_LAYERS.find((candidate) => candidate.traits.some((trait) => trait.id === traitId))!
    const trait = layer.traits.find((candidate) => candidate.id === traitId)!
    return trait.blank ? [] : [{ traitType: layer.name, value: trait.name }]
  }),
}))

// ---------------------------------------------------------------------------------------------
// Chains and fees
// ---------------------------------------------------------------------------------------------

export const SUPPORTED_CHAINS: SupportedChain[] = [
  { id: 1, name: 'Ethereum', nativeSymbol: 'ETH', explorerUrl: 'https://etherscan.io', transferLock: true },
  {
    id: 42161,
    name: 'Arbitrum',
    nativeSymbol: 'ETH',
    explorerUrl: 'https://arbiscan.io',
    transferLock: true,
  },
  { id: 8453, name: 'Base', nativeSymbol: 'ETH', explorerUrl: 'https://basescan.org', transferLock: true },
  {
    id: 80094,
    name: 'Berachain',
    nativeSymbol: 'BERA',
    explorerUrl: 'https://berascan.com',
    transferLock: true,
  },
  { id: 143, name: 'Monad', nativeSymbol: 'MON', explorerUrl: 'https://monadscan.com', transferLock: true },
  // Explorer URL to confirm (MASTER_PLAN, Launch chains: Blockscout).
  {
    id: 4663,
    name: 'Robinhood Chain',
    nativeSymbol: 'ETH',
    explorerUrl: 'https://explorer.robinhood.com',
    transferLock: true,
  },
]

export function getChain(chainId: number): SupportedChain | undefined {
  return SUPPORTED_CHAINS.find((chain) => chain.id === chainId)
}

const ethFees: FeeSnapshot = {
  mintFeeFlatWei: toWei('0.0001'),
  mintFeeBps: 100,
  airdropFeePerTokenWei: toWei('0.00005'),
}

/** The factory's current `collectionFees()` on each chain: what a collection deployed now would snapshot. */
export const DEMO_FACTORY_FEES: Record<number, FeeSnapshot> = {
  1: { mintFeeFlatWei: toWei('0.0003'), mintFeeBps: 100, airdropFeePerTokenWei: toWei('0.0001') },
  42161: ethFees,
  8453: ethFees,
  80094: { mintFeeFlatWei: toWei('0.15'), mintFeeBps: 100, airdropFeePerTokenWei: toWei('0.08') },
  143: { mintFeeFlatWei: toWei('8'), mintFeeBps: 100, airdropFeePerTokenWei: toWei('4') },
  4663: ethFees,
}

/** The factory's `artFeePerToken()` on each chain. */
export const DEMO_ART_FEE_PER_TOKEN: Record<number, string> = {
  1: toWei('0.00006'),
  42161: toWei('0.00002'),
  8453: toWei('0.00002'),
  80094: toWei('0.03'),
  143: toWei('1.5'),
  4663: toWei('0.00002'),
}

/** Rough cost to deploy a collection (about 4.5M gas) on each chain, in wei. Replaced by: a gas estimate at deploy time. */
export const DEMO_DEPLOY_COST_ESTIMATE: Record<number, string> = {
  1: toWei('0.0135'),
  42161: toWei('0.00009'),
  8453: toWei('0.00005'),
  80094: toWei('0.02'),
  143: toWei('0.45'),
  4663: toWei('0.00006'),
}

// ---------------------------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------------------------

export const DEMO_CREATOR: Address = '0x7a3c51e9d2b04f68a1c3e5b7d9f0a2c4e6b8d0f2'
export const DEMO_PAYOUT: Address = '0x5e1f0c9b8a7d6e5f4c3b2a1908f7e6d5c4b3a291'
export const DEMO_MINTER: Address = '0x3b9d2c1a0f8e7d6c5b4a39281706f5e4d3c2b1a0'
export const DEMO_VAULT: Address = '0x9c8b7a6f5e4d3c2b1a09f8e7d6c5b4a392817065'

// ---------------------------------------------------------------------------------------------
// Lock and upload
// ---------------------------------------------------------------------------------------------

const RENDER_CHAIN = 8453
const lockedAt = DEMO_NOW - 9 * DAY
const quote = {
  chainId: RENDER_CHAIN,
  perTokenWei: DEMO_ART_FEE_PER_TOKEN[RENDER_CHAIN]!,
  tokenCount: DEMO_TOKEN_COUNT,
  totalWei: mulWei(DEMO_ART_FEE_PER_TOKEN[RENDER_CHAIN]!, DEMO_TOKEN_COUNT),
  payer: DEMO_CREATOR,
  expiresAt: lockedAt + DAY,
}
const jobBase = {
  id: 'job_night_owls_01',
  jobId: sampleHex(7, 32),
  tokenCount: DEMO_TOKEN_COUNT,
  lockedAt,
  tokenListHash: sampleHex(8, 32),
  quote,
  lockOptions: { allowDuplicates: false },
  credited: false,
}
const payment = { txHash: sampleTxHash(1), paidAt: lockedAt + 20 * 60, amountWei: quote.totalWei }
const BATCH_SIZE = 50
const batchTotal = Math.ceil(DEMO_TOKEN_COUNT / BATCH_SIZE)

/** The pre-reveal placeholder the sample creator chose with "Reveal later" (MASTER_PLAN, Flow: pre-reveal). */
export const DEMO_PLACEHOLDER: RenderPlaceholder = {
  cid: 'bafkreie7q3iidccmpvszul7kudcvvuavuo7u6gzlbobczuk5nqk3b4akba',
  mediaType: 'image',
  imageUrl: '/demo/placeholder.svg',
}

/** The placeholder's description, shown as every token's description until the reveal. */
export const DEMO_PLACEHOLDER_DESCRIPTION =
  'Something is stirring in the dark. Every Night Owl is revealed once the sale ends.'

/** The states the sample shows on Lock and upload (`?job=`). */
export type SampleJobState = Extract<
  RenderJobState,
  'locked' | 'payment_due' | 'rendering' | 'finalizing' | 'failed' | 'done'
>

type RenderJobsByState = {
  [S in SampleJobState]: Extract<RenderJob, { state: S }>
}

const SAMPLE_IMAGES_CID = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'
const SAMPLE_METADATA_CID = 'bafybeihkoviema7g3gxyt6la7vd5ho32ictqbilu3wnlo3rs7ewhnp7lly'
/** The deferred run's placeholder metadata: one file, `metadata.json`. */
const SAMPLE_PLACEHOLDER_METADATA_CID = 'bafybeie5gq4jxvzmsym6hjlwxej4rwdoxt7wadqvmmwbqi7r27fclha2va'

/**
 * The render job in each of its states, for the Lock and upload screen. "Reveal later" was on, so
 * every state after the lock carries the placeholder; the finished job has the real set too.
 */
export const DEMO_RENDER_JOBS: RenderJobsByState = {
  locked: { ...jobBase, state: 'locked', placeholder: null },
  payment_due: { ...jobBase, state: 'payment_due', placeholder: DEMO_PLACEHOLDER, payment: null },
  rendering: {
    ...jobBase,
    state: 'rendering',
    placeholder: DEMO_PLACEHOLDER,
    payment,
    batches: { total: batchTotal, done: 9, size: BATCH_SIZE },
    startedAt: payment.paidAt + 60,
    failedBatch: null,
  },
  finalizing: {
    ...jobBase,
    state: 'finalizing',
    placeholder: DEMO_PLACEHOLDER,
    payment,
    batches: { total: batchTotal, done: batchTotal, size: BATCH_SIZE },
    startedAt: payment.paidAt + 60,
  },
  // The rendering sample stopped by the worker at batch 10: the retry face.
  failed: {
    ...jobBase,
    state: 'failed',
    placeholder: DEMO_PLACEHOLDER,
    payment,
    batches: { total: batchTotal, done: 9, size: BATCH_SIZE },
    error: 'The pinning service answered with a different CID.',
    errorCode: 'cid-mismatch',
    retries: 1,
    failedBatch: 10,
    retryable: true,
  },
  done: {
    ...jobBase,
    state: 'done',
    placeholder: DEMO_PLACEHOLDER,
    payment,
    batches: { total: batchTotal, done: batchTotal, size: BATCH_SIZE },
    startedAt: payment.paidAt + 60,
    finishedAt: payment.paidAt + 60 + 26 * 60,
    metadataCid: SAMPLE_METADATA_CID,
    baseUri: `ipfs://${SAMPLE_METADATA_CID}/`,
    batchCids: [SAMPLE_IMAGES_CID],
    placeholderImageCid: null,
    // The sample done step shows the static collage at /demo/collage.svg; the key only says there is one.
    collageKey: 'night-owls/collage/job_night_owls_01.png',
  },
}

// The deferred scenario's first run renders the placeholder alone: one file, one batch.
const deferredQuote = {
  ...quote,
  tokenCount: 1,
  totalWei: DEMO_ART_FEE_PER_TOKEN[RENDER_CHAIN]!,
}
const deferredBase = {
  ...jobBase,
  id: 'job_night_owls_placeholder',
  jobId: sampleHex(9, 32),
  tokenCount: 1,
  tokenListHash: sampleHex(10, 32),
  quote: deferredQuote,
}
const deferredPayment = { ...payment, amountWei: deferredQuote.totalWei }

/**
 * The deferred-art scenario's render jobs: the art is not finished, so this run locks and renders
 * only the placeholder. The real set has no CIDs until it is locked and rendered in a second run.
 */
export const DEMO_DEFERRED_RENDER_JOBS: RenderJobsByState = {
  locked: { ...deferredBase, state: 'locked', placeholder: null },
  payment_due: { ...deferredBase, state: 'payment_due', placeholder: DEMO_PLACEHOLDER, payment: null },
  rendering: {
    ...deferredBase,
    state: 'rendering',
    placeholder: DEMO_PLACEHOLDER,
    payment: deferredPayment,
    batches: { total: 1, done: 0, size: 1 },
    startedAt: payment.paidAt + 60,
    failedBatch: null,
  },
  finalizing: {
    ...deferredBase,
    state: 'finalizing',
    placeholder: DEMO_PLACEHOLDER,
    payment: deferredPayment,
    batches: { total: 1, done: 1, size: 1 },
    startedAt: payment.paidAt + 60,
  },
  failed: {
    ...deferredBase,
    state: 'failed',
    placeholder: DEMO_PLACEHOLDER,
    payment: deferredPayment,
    batches: { total: 1, done: 0, size: 1 },
    error: 'The pinning service answered with a different CID.',
    errorCode: 'cid-mismatch',
    retries: 1,
    failedBatch: 1,
    retryable: true,
  },
  done: {
    ...deferredBase,
    state: 'done',
    placeholder: DEMO_PLACEHOLDER,
    payment: deferredPayment,
    batches: { total: 1, done: 1, size: 1 },
    startedAt: payment.paidAt + 60,
    finishedAt: payment.paidAt + 2 * 60,
    metadataCid: SAMPLE_PLACEHOLDER_METADATA_CID,
    baseUri: `ipfs://${SAMPLE_PLACEHOLDER_METADATA_CID}/metadata.json`,
    batchCids: [DEMO_PLACEHOLDER.cid],
    placeholderImageCid: DEMO_PLACEHOLDER.cid,
    collageKey: null,
  },
}

/**
 * The second sample scenario: Night Owls deployed before its art was finished (MASTER_PLAN, Flow: pre-reveal).
 * Reached with `?art=deferred` on the Art, Lock and upload, Deploy and Settings pages in sample mode.
 */
export const DEMO_ART_DEFERRED = {
  collection: { ...DEMO_COLLECTION, artDeferred: true },
  renderJobs: DEMO_DEFERRED_RENDER_JOBS,
}

/** Whether the sample collection's art is deferred: `?art=deferred` picks the second scenario. */
export function sampleArtDeferred(artParam: string | undefined): boolean {
  return artParam === 'deferred' ? DEMO_ART_DEFERRED.collection.artDeferred : DEMO_COLLECTION.artDeferred
}

export function getRenderJob(state: SampleJobState, options: { artDeferred?: boolean } = {}): RenderJob {
  return (options.artDeferred ? DEMO_DEFERRED_RENDER_JOBS : DEMO_RENDER_JOBS)[state]
}

// ---------------------------------------------------------------------------------------------
// Deploy
// ---------------------------------------------------------------------------------------------

/** The deploy form before anything is chosen. */
export const DEMO_DEPLOY_DRAFT: DeployDraft = {
  chainId: null,
  payoutAddress: DEMO_PAYOUT,
  royaltyReceiver: DEMO_PAYOUT,
  royaltyBps: 500,
  publicMaxMintPerWallet: 3,
  initialBaseUri: `ipfs://${DEMO_PLACEHOLDER.cid}`,
}

export const DEMO_DEPLOYMENT: Deployment = {
  chainId: 8453,
  contractAddress: '0x4f2a9c7e1b3d5f6a8c0e2b4d6f8a1c3e5b7d9f0a',
  txHash: sampleTxHash(2),
  deployer: DEMO_CREATOR,
  deployedAt: DEMO_NOW - 6 * DAY,
  fees: ethFees,
  royaltyBps: 500,
  royaltyReceiver: DEMO_PAYOUT,
  payoutAddress: DEMO_PAYOUT,
  baseUri: `ipfs://${DEMO_PLACEHOLDER.cid}`,
  revealed: false,
  transfersLocked: false,
  mintOnBehalfActive: false,
}

// ---------------------------------------------------------------------------------------------
// Phases and whitelist
// ---------------------------------------------------------------------------------------------

export const DEMO_PUBLIC_MAX_PER_WALLET = 3
const WHITELIST_OPENED = DEMO_NOW - 30 * HOUR
const PUBLIC_START = DEMO_NOW + 2 * DAY + 2 * HOUR // 2026-10-05 17:00 UTC

/**
 * The phases as the contract reports them: the whitelist is live, the public sale is scheduled,
 * the team allocation is minted and closed.
 */
export const DEMO_MINT_GROUPS: MintGroup[] = [
  {
    id: 0,
    name: 'Public',
    kind: 'public',
    priceWei: toWei('0.003'),
    maxSupply: 477,
    minted: 0,
    flag: false,
    scheduledStart: PUBLIC_START,
    active: false,
    description: 'Open to everyone, up to three per wallet.',
    visible: true,
  },
  {
    id: 1,
    name: 'Owl List',
    kind: 'whitelist',
    priceWei: toWei('0.0015'),
    maxSupply: 250,
    minted: 186,
    flag: true,
    scheduledStart: 0,
    active: true,
    description: 'Early supporters from the Discord. Your quota is on the list.',
    visible: true,
  },
  {
    id: 2,
    name: 'Team',
    kind: 'whitelist',
    priceWei: '0',
    maxSupply: 50,
    minted: 40,
    flag: false,
    scheduledStart: 0,
    active: false,
    description: 'Reserved for the artists and the team.',
    visible: false,
  },
]

/** Builds a whitelist whose used quota adds up to `mintedTotal`. */
function buildWhitelist(
  seed: number,
  count: number,
  quotas: number[],
  mintedTotal: number,
): WhitelistEntry[] {
  const random = seededRandom(seed)
  const entries: WhitelistEntry[] = Array.from({ length: count }, (_, index) => ({
    address: sampleAddress(seed * 10_000 + index),
    quota: quotas[Math.floor(random() * quotas.length)]!,
    minted: 0,
  }))
  let remaining = mintedTotal
  let guard = 0
  while (remaining > 0 && guard++ < 100_000) {
    const entry = entries[Math.floor(random() * entries.length)]!
    if (entry.minted < entry.quota) {
      entry.minted++
      remaining--
    }
  }
  return entries
}

function chunks(entries: WhitelistEntry[], size: number, written: number, seed: number): WhitelistChunk[] {
  const result: WhitelistChunk[] = []
  for (let from = 0, index = 0; from < entries.length; from += size, index++) {
    const done = index < written
    result.push({
      index,
      from,
      to: Math.min(from + size, entries.length),
      status: done ? 'written' : 'pending',
      ...(done ? { txHash: sampleTxHash(seed + index) } : {}),
    })
  }
  return result
}

/** Addresses per `setMintQuota` transaction (MASTER_PLAN, Contracts: whitelist chunks). */
export const WHITELIST_CHUNK_SIZE = 500

const owlList = buildWhitelist(1, 620, [1, 1, 1, 2, 2, 3], 186)
const team = buildWhitelist(2, 12, [3, 5], 40)
// The connected sample wallet is on the Owl List with a quota of 2, one used.
owlList[0] = { address: DEMO_MINTER, quota: 2, minted: 1 }

/**
 * Whitelists per group. The Owl List's second chunk has not been written yet (120 addresses
 * waiting), so the screen can show a resumable upload.
 */
export const DEMO_WHITELISTS: GroupWhitelist[] = [
  {
    groupId: 1,
    entries: owlList,
    chunkSize: WHITELIST_CHUNK_SIZE,
    chunks: chunks(owlList, WHITELIST_CHUNK_SIZE, 1, 300),
  },
  {
    groupId: 2,
    entries: team,
    chunkSize: WHITELIST_CHUNK_SIZE,
    chunks: chunks(team, WHITELIST_CHUNK_SIZE, 1, 400),
  },
]

// ---------------------------------------------------------------------------------------------
// Airdrops and activity
// ---------------------------------------------------------------------------------------------

export const DEMO_AIRDROPS: AirdropRecord[] = [
  {
    txHash: sampleTxHash(20),
    at: DEMO_NOW - 4 * DAY,
    recipients: 4,
    tokens: 10,
    feePaidWei: mulWei(ethFees.airdropFeePerTokenWei, 10),
    burn: false,
    firstTokenId: 1,
  },
  {
    txHash: sampleTxHash(21),
    at: DEMO_NOW - 2 * DAY,
    recipients: 1,
    tokens: 2,
    feePaidWei: mulWei(ethFees.airdropFeePerTokenWei, 2),
    burn: true,
    firstTokenId: 11,
  },
]

/** Hourly mints for the last 48 hours: the whitelist opened 30 hours ago with a rush, then settled. */
function mintsOverTime(): { at: number; count: number }[] {
  const random = seededRandom(31)
  const buckets: { at: number; count: number }[] = []
  for (let hour = 47; hour >= 0; hour--) buckets.push({ at: DEMO_NOW - (hour + 1) * HOUR, count: 0 })
  const opened = buckets.findIndex((bucket) => bucket.at >= WHITELIST_OPENED)
  let left = 186
  for (let index = opened; index < buckets.length && left > 0; index++) {
    const since = index - opened
    const expected = Math.max(1, Math.round(48 * Math.exp(-since / 3) + random() * 3))
    const count = Math.min(left, expected)
    buckets[index]!.count = count
    left -= count
  }
  buckets[buckets.length - 1]!.count += left
  return buckets
}

const mintPrice = DEMO_MINT_GROUPS[1]!.priceWei
const gross = mulWei(mintPrice, 186)
const platformPerToken = sumWei(
  ethFees.mintFeeFlatWei,
  (BigInt(mintPrice) * BigInt(ethFees.mintFeeBps)) / 10_000n,
)

export const DEMO_ACTIVITY: DropActivity = {
  mintsOverTime: mintsOverTime(),
  recentMints: Array.from({ length: 12 }, (_, index) => ({
    txHash: sampleTxHash(50 + index),
    minter: index === 3 ? DEMO_MINTER : sampleAddress(500 + index),
    amount: [1, 2, 1, 1, 3, 1, 2, 1, 1, 2, 1, 1][index]!,
    groupId: 1,
    at: DEMO_NOW - (index * 17 + 4) * 60,
    firstTokenId: 238 - index * 2,
  })),
  holders: 171,
  proceeds: {
    grossWei: gross,
    withdrawnWei: toWei('0.15'),
    withdrawableWei: (BigInt(gross) - BigInt(toWei('0.15'))).toString(),
    platformFeesWei: mulWei(platformPerToken, 186 + 40),
  },
}

/** Total minted so far: phases plus airdrops. */
export const DEMO_TOTAL_MINTED =
  DEMO_MINT_GROUPS.reduce((sum, group) => sum + group.minted, 0) +
  DEMO_AIRDROPS.reduce((sum, airdrop) => sum + airdrop.tokens, 0)

// ---------------------------------------------------------------------------------------------
// Mint page
// ---------------------------------------------------------------------------------------------

export const DEMO_MINT_PAGE_SETTINGS: MintPageSettings = {
  slug: DEMO_COLLECTION.slug,
  description: DEMO_COLLECTION.description,
  bannerUrl: '/demo/banner.svg',
  avatarUrl: '/demo/avatar.svg',
  socials: {
    website: 'https://example.com/night-owls',
    x: 'https://x.com/example',
    discord: 'https://discord.gg/example',
  },
  featuredTokenIds: [5, 10, 12, 15, 4, 18],
  published: true,
}

/** The Phase 6 sections of the sample mint page, as the Mint page tab edits them. */
export const DEMO_MINT_PAGE_SECTIONS: MintPageSections = {
  team: {
    enabled: true,
    members: [
      {
        id: 'team-1',
        name: 'Mara Quill',
        role: 'Artist',
        bio: 'Draws every owl by hand before it is layered.',
        imageUrl: '/demo/avatar.svg',
        x: 'https://x.com/example',
      },
      {
        id: 'team-2',
        name: 'Tobin Reyes',
        role: 'Community',
        bio: 'Runs the Discord and the holder calls.',
        imageUrl: '',
        discord: 'https://discord.gg/example',
      },
    ],
  },
  roadmap: {
    enabled: true,
    items: [
      { id: 'road-1', date: 'Q4 2026', title: 'Mint', description: 'Whitelist first, then the public sale.' },
      {
        id: 'road-2',
        date: 'Q1 2027',
        title: 'Reveal',
        description: 'Every owl revealed a week after sell out.',
      },
    ],
  },
  faq: {
    enabled: true,
    items: [
      {
        id: 'faq-1',
        question: 'How many can I mint?',
        answer: 'Up to three in the public sale. Whitelist wallets have their own quota.',
      },
    ],
  },
  music: { enabled: false, fileName: null, url: null },
  carousel: {
    enabled: true,
    items: [
      { id: 'slide-1', kind: 'token', tokenId: 5 },
      { id: 'slide-2', kind: 'token', tokenId: 12 },
    ],
  },
}

function withGroups(overrides: Partial<Record<number, Partial<MintGroup>>>): MintGroup[] {
  return DEMO_MINT_GROUPS.map((group) => ({ ...group, ...overrides[group.id] }))
}

/**
 * The groups for each mint page variant. `active` is set here as the freshness server would
 * report it from `mintGroupActive`; nothing derives it from a clock.
 */
const VARIANT_GROUPS: Record<MintPageVariant, MintGroup[]> = {
  upcoming: withGroups({
    0: { minted: 0 },
    1: { minted: 0, flag: false, scheduledStart: DEMO_NOW + 5 * HOUR, active: false },
    2: { minted: 0 },
  }),
  'allowlist-live': withGroups({}),
  'public-live': withGroups({
    0: { minted: 268, scheduledStart: DEMO_NOW - 3 * HOUR, active: true },
    1: { minted: 231 },
  }),
  'sold-out': withGroups({
    0: { minted: 477, scheduledStart: DEMO_NOW - 20 * HOUR, active: true },
    1: { minted: 250 },
    2: { minted: 38 },
  }),
  closed: withGroups({
    0: { minted: 301, flag: false, scheduledStart: 0, active: false },
    1: { minted: 238, flag: false, active: false },
  }),
}

const AIRDROPPED = DEMO_AIRDROPS.reduce((sum, airdrop) => sum + airdrop.tokens, 0)

function walletFor(variant: MintPageVariant, groups: MintGroup[]): WalletState {
  const used = variant === 'upcoming' ? 0 : variant === 'allowlist-live' ? 1 : 2
  return {
    address: DEMO_MINTER,
    publicMinted: variant === 'public-live' ? 1 : variant === 'sold-out' ? 3 : 0,
    groups: groups.map((group) => {
      if (group.id === 0) return { groupId: 0, quota: DEMO_PUBLIC_MAX_PER_WALLET, used: 0, eligible: true }
      if (group.id === 1) return { groupId: 1, quota: 2, used, eligible: true }
      return { groupId: group.id, quota: 0, used: 0, eligible: false }
    }),
    delegatedVaults: [{ vault: DEMO_VAULT, groups: [{ groupId: 1, quota: 3, used: 0 }] }],
  }
}

/**
 * Sample data for the public mint page. `variant` picks the moment in the sale; `connected`
 * false leaves the wallet out. Liveness is a field of each group, as the freshness server will
 * send it.
 */
export function getMintPageData(
  slug: string,
  variant: MintPageVariant,
  options: { connected?: boolean } = {},
): MintPageData {
  const groups = VARIANT_GROUPS[variant]
  const minted =
    variant === 'sold-out'
      ? DEMO_TOKEN_COUNT
      : groups.reduce((sum, group) => sum + group.minted, 0) + (variant === 'upcoming' ? 0 : AIRDROPPED)
  const chain = getChain(DEMO_DEPLOYMENT.chainId)!
  return {
    variant,
    collection: {
      name: DEMO_COLLECTION.name,
      symbol: DEMO_COLLECTION.symbol,
      slug,
      description: DEMO_MINT_PAGE_SETTINGS.description,
      bannerUrl: DEMO_MINT_PAGE_SETTINGS.bannerUrl,
      avatarUrl: DEMO_MINT_PAGE_SETTINGS.avatarUrl,
      socials: DEMO_MINT_PAGE_SETTINGS.socials,
      chain,
      contractAddress: DEMO_DEPLOYMENT.contractAddress,
      revealed: variant === 'sold-out' || variant === 'closed',
      transfersLocked: false,
      featured: DEMO_MINT_PAGE_SETTINGS.featuredTokenIds.map((id) => ({
        id,
        name: `${DEMO_COLLECTION.name} #${id}`,
        imageUrl: `/demo/tokens/${id}.svg`,
      })),
    },
    supply: { max: DEMO_TOKEN_COUNT, minted },
    publicMaxMintPerWallet: DEMO_PUBLIC_MAX_PER_WALLET,
    fees: DEMO_DEPLOYMENT.fees,
    groups,
    blockTimestamp: DEMO_NOW,
    readAt: DEMO_NOW,
    wallet: options.connected === false ? null : walletFor(variant, groups),
  }
}

export const MINT_PAGE_VARIANTS: MintPageVariant[] = [
  'upcoming',
  'allowlist-live',
  'public-live',
  'sold-out',
  'closed',
]
