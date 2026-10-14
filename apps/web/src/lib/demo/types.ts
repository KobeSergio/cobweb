/**
 * Shapes of the sample data the creator screens and the mint page render until their backends
 * exist. Each type names the real source that will replace it. Amounts of the native token are
 * wei as decimal strings (a uint256 does not fit in a JS number); times are unix seconds.
 */

export type Address = `0x${string}`
export type Hex = `0x${string}`

// ---------------------------------------------------------------------------------------------
// Art (Phase 3: art generator). The shapes live in `@cobweb/dna`; the screens import them from here.
// ---------------------------------------------------------------------------------------------

export type {
  ArtRule,
  AtLeastOne,
  Collection,
  Layer,
  Project,
  Ranked,
  RuleConflict,
  RuleKind,
  TokenCore,
  Trait,
  TraitCounts,
} from '@cobweb/dna'
import type { Ranked, TokenCore } from '@cobweb/dna'

/**
 * One generated token as the screens show it: the engine's core (id, collection, DNA) with its rank,
 * plus the name chosen at Generate, an optional description and a pre-rendered preview for the
 * first sample tokens (null: stack `tokenLayerUrls` instead).
 */
export type GeneratedToken = Ranked<TokenCore> & {
  /** "<token name> #<id>", the token name chosen at Generate (legacy auto-populate). */
  name: string
  /** The metadata description: the one chosen at Generate, or this token's own after an edit. */
  description?: string
  previewUrl: string | null
}

/**
 * What an uploaded file is (MASTER_PLAN, Art: media types). 1/1s take images only (PNG, JPG,
 * WebP); a single asset may also be a GIF or an MP4 video, and so may a pre-reveal placeholder.
 */
export type MediaType = 'image' | 'gif' | 'video'

/** The art for a 1/1s or single asset project. Replaced by: the uploads table (Phase 3). */
export type UploadedAsset = {
  id: number
  fileName: string
  /** The file's URL. For a video this is the MP4, not a still. */
  imageUrl: string
  /** The `uploads` row behind the file. Sample data has none; sample mode never uploads. */
  uploadId?: string
  mediaType: MediaType
  /** Editions of this artwork (1/1s); 1 otherwise. */
  quantity: number
  attributes: { traitType: string; value: string }[]
  /** When the file was added (ms since 1970), which "In file order" sorts by. Sample data counts by id. */
  addedAt?: number
}

// ---------------------------------------------------------------------------------------------
// Lock and upload (Phase 4: render pipeline)
// ---------------------------------------------------------------------------------------------

/** A render job's state: `render_jobs.state`. */
export type RenderJobState =
  'locked' | 'payment_due' | 'paid' | 'waived' | 'rendering' | 'finalizing' | 'done' | 'failed'

/** The art-fee quote issued at lock, from the factory's `artFeePerToken()` (render_jobs quote columns). */
export type ArtFeeQuote = {
  chainId: number
  /** `artFeePerToken` at the time of the quote. */
  perTokenWei: string
  tokenCount: number
  totalWei: string
  /** The wallet the quote was issued to; only its payment counts. */
  payer: Address
  /** Quote expiry, unix seconds. */
  expiresAt: number
  /**
   * The factory `payForArt` is paid to, filled in by the server from `FACTORY_ADDRESS_<chainId>`;
   * null when the chain is not configured. Sample data has none.
   */
  factory?: Address | null
}

/**
 * The pre-reveal placeholder (MASTER_PLAN, Flow: pre-reveal): one file every token shows until the
 * reveal, pinned to its own small CID (`cid` is '' until its placeholder job is done).
 */
export type RenderPlaceholder = {
  cid: string
  mediaType: MediaType
  /** A preview of the file. For a video this is the MP4. */
  imageUrl: string
  /** The `uploads` row behind the file. Sample data has none. */
  uploadId?: string
}

export type RenderJobBase = {
  id: string
  /** The factory job id passed to `payForArt(jobId)` (`render_jobs.onchain_job_id`). */
  jobId: Hex
  tokenCount: number
  lockedAt: number
  /** Hash of the token list stored at lock (MASTER_PLAN, Art: lock check). */
  tokenListHash: Hex
  quote: ArtFeeQuote
  /** What the creator chose under "Lock options". `allowDuplicates`: identical trait combinations are accepted. */
  lockOptions: { allowDuplicates: boolean }
  /**
   * Set when the creator chose "Reveal later": the contract starts on this placeholder and reveals
   * to the real metadata from Settings. Null when the contract starts on the real art.
   */
  placeholder: RenderPlaceholder | null
  /** True when the lock was recorded waived on the credit of a paid render that failed (`render_jobs.credit_job_id`). */
  credited: boolean
}

/** The payment recorded from the factory's `ArtPaid` event. */
export type RenderPayment = { txHash: Hex; paidAt: number; amountWei: string }

/** Coarse progress: batches done of total. There is no per-image status. */
export type RenderBatches = { total: number; done: number; size: number }

/**
 * A render job in one of its states (`render_jobs`). Every state after payment carries the payment,
 * or null when nothing was owed (a single asset, a placeholder) or the job was waived. A job waiting
 * for payment carries a short payment if one was recorded.
 */
export type RenderJob =
  | (RenderJobBase & { state: 'locked' })
  | (RenderJobBase & {
      state: 'payment_due'
      /** Set when a payment was recorded but fell short of the quote; the job stays waiting. */
      payment: RenderPayment | null
    })
  | (RenderJobBase & { state: 'paid' | 'waived'; payment: RenderPayment | null; batches: RenderBatches })
  | (RenderJobBase & {
      state: 'rendering'
      payment: RenderPayment | null
      batches: RenderBatches
      startedAt: number
      /** The 1-based number of the lowest batch that failed and waits for the worker's retry, or null. */
      failedBatch: number | null
    })
  | (RenderJobBase & {
      /** Every batch is in; the metadata is being written and pinned. */
      state: 'finalizing'
      payment: RenderPayment | null
      batches: RenderBatches
      startedAt: number
    })
  | (RenderJobBase & {
      state: 'failed'
      payment: RenderPayment | null
      batches: RenderBatches
      /** The worker's sentence, or `unlocked` for a job an unlock cancelled. */
      error: string
      /** `RenderProblem.code` or the worker's own code; `unlocked` for an unlock. */
      errorCode: string | null
      /** How many times the creator retried this job; the cap is five. */
      retries: number
      /** The 1-based number of the lowest failed batch, or null. */
      failedBatch: number | null
      /**
       * False for a job an unlock cancelled (error code or sentence `unlocked`: the creator locks the art
       * again), for a job failed with the code `payment-mismatch` (only support may look at it), and
       * once the retry cap is reached.
       */
      retryable: boolean
    })
  | (RenderJobBase & {
      state: 'done'
      payment: RenderPayment | null
      batches: RenderBatches
      startedAt: number
      finishedAt: number
      /** The metadata directory, or the placeholder's metadata on a placeholder job. */
      metadataCid: string
      /** What the contract gets: `ipfs://<cid>/`, or `ipfs://<cid>/metadata.json` for a single asset and the placeholder. */
      baseUri: string
      /** Each batch directory's CID, in batch order. */
      batchCids: string[]
      /** The placeholder's image directory; set on a placeholder job only. */
      placeholderImageCid: string | null
      /** The storage key of the preview collage, or null. */
      collageKey: string | null
    })

// ---------------------------------------------------------------------------------------------
// Deploy (Phase 5)
// ---------------------------------------------------------------------------------------------

/** A launch chain. Replaced by: `packages/shared` chain config. */
export type SupportedChain = {
  id: number
  name: string
  nativeSymbol: string
  explorerUrl: string
  /** Whether the Limit Break transfer validator exists there, so transfers can be locked. */
  transferLock: boolean
}

/** Fee rates, native amounts. Replaced by: the factory's `collectionFees()` before deploy, the collection's `fees()` after. */
export type FeeSnapshot = {
  mintFeeFlatWei: string
  /** Basis points of the price, on top of the flat fee. */
  mintFeeBps: number
  airdropFeePerTokenWei: string
}

/** Settings the creator fills in before deploying. Replaced by: the deploy form's state and the constructor arguments. */
export type DeployDraft = {
  chainId: number | null
  payoutAddress: Address
  royaltyReceiver: Address
  /** Basis points; 500 is 5%. */
  royaltyBps: number
  publicMaxMintPerWallet: number
  /** The base URI set at deploy: the placeholder's CID with "Reveal later" or deferred art, else the real metadata. */
  initialBaseUri: string
}

/** A deployed collection. Replaced by: `collections.chain_id`, `contract_address` and the deploy tx, plus contract views. */
export type Deployment = {
  chainId: number
  contractAddress: Address
  txHash: Hex
  deployer: Address
  deployedAt: number
  fees: FeeSnapshot
  royaltyBps: number
  royaltyReceiver: Address
  payoutAddress: Address
  baseUri: string
  revealed: boolean
  /** The transfer validator's level: locked is the non-transferable level (MASTER_PLAN, Contracts: lock). */
  transfersLocked: boolean
  mintOnBehalfActive: boolean
}

// ---------------------------------------------------------------------------------------------
// Manage: phases and whitelist (Phase 5)
// ---------------------------------------------------------------------------------------------

/**
 * A mint group as `collectionState()` reports it. Replaced by: that view through the freshness
 * server, joined with `mint_groups.name`.
 */
export type MintGroup = {
  /** On-chain group id. 0 is the public sale. */
  id: number
  name: string
  kind: 'public' | 'whitelist'
  priceWei: string
  /** The group's supply allocation. */
  maxSupply: number
  minted: number
  /** The raw open flag (`mintGroupActiveFlag`). Ignores the schedule. */
  flag: boolean
  /** Scheduled start in unix seconds, or 0 for none. */
  scheduledStart: number
  /** Live right now, as the contract's `mintGroupActive` view reports it. Never computed in the browser. */
  active: boolean
  /** Who the phase is for, shown on the mint page. Off chain: `mint_groups.description`. */
  description?: string
  /** False hides the phase from the mint page; it still mints if open. Off chain: `mint_groups.visible`. */
  visible?: boolean
}

/** One wallet on a group's whitelist. Replaced by: `whitelist_entries` joined with `walletState` usage. */
export type WhitelistEntry = {
  address: Address
  quota: number
  /** Quota already used, from `quotaClaimed`. */
  minted: number
}

/** One `setMintQuota` transaction's worth of entries. Replaced by: a chunk table written as the upload is sent (Phase 5). */
export type WhitelistChunk = {
  index: number
  /** Index range in `entries`, end exclusive. */
  from: number
  to: number
  status: 'written' | 'sending' | 'pending' | 'failed'
  txHash?: Hex
  error?: string
}

/** A group's whitelist and its on-chain write progress. Replaced by: `whitelist_entries` plus the chunk table. */
export type GroupWhitelist = {
  groupId: number
  entries: WhitelistEntry[]
  /** Addresses per `setMintQuota` transaction: 500 (MASTER_PLAN, Contracts: whitelist chunks). */
  chunkSize: number
  chunks: WhitelistChunk[]
}

// ---------------------------------------------------------------------------------------------
// Mint page (Phase 6)
// ---------------------------------------------------------------------------------------------

export type Socials = { website?: string; x?: string; discord?: string; telegram?: string }

/** The creator's mint page customisation. Replaced by: a mint page settings table (Phase 6). */
export type MintPageSettings = {
  slug: string
  description: string
  bannerUrl: string
  avatarUrl: string
  socials: Socials
  /** Token ids shown in the page's gallery strip. */
  featuredTokenIds: number[]
  published: boolean
}

/** A team member on the mint page (Phase 6). Limits are legacy's: see the spec, section 13. */
export type TeamMember = {
  id: string
  name: string
  role: string
  bio: string
  imageUrl: string
  x?: string
  discord?: string
  telegram?: string
}
export type RoadmapItem = { id: string; date: string; title: string; description: string }
export type FaqItem = { id: string; question: string; answer: string }
/** A carousel slide: an uploaded image or MP4, or one of the collection's tokens. */
export type CarouselItem =
  | { id: string; kind: 'upload'; url: string; fileName: string; mediaType: 'image' | 'video' }
  | { id: string; kind: 'token'; tokenId: number }

/**
 * The mint page sections that return in Phase 6, each with its own on/off switch, as legacy had
 * them. Replaced by: the mint page section tables (Phase 6).
 */
export type MintPageSections = {
  team: { enabled: boolean; members: TeamMember[] }
  roadmap: { enabled: boolean; items: RoadmapItem[] }
  faq: { enabled: boolean; items: FaqItem[] }
  music: { enabled: boolean; fileName: string | null; url: string | null }
  carousel: { enabled: boolean; items: CarouselItem[] }
}

/** What a connected wallet may mint. Replaced by: `walletState(wallet)` through the freshness server. */
export type WalletState = {
  address: Address
  /** Tokens minted from the public group, against `publicMaxMintPerWallet`. */
  publicMinted: number
  groups: { groupId: number; quota: number; used: number; eligible: boolean }[]
  /** Vaults that delegated to this wallet on delegate.xyz, with their own quotas (MASTER_PLAN, Contracts: delegated mint). */
  delegatedVaults: { vault: Address; groups: { groupId: number; quota: number; used: number }[] }[]
}

export type MintPageVariant = 'upcoming' | 'allowlist-live' | 'public-live' | 'sold-out' | 'closed'

/** Everything the public mint page renders. Replaced by: the freshness server's collection endpoint plus mint page settings. */
export type MintPageData = {
  variant: MintPageVariant
  collection: {
    name: string
    symbol: string
    slug: string
    description: string
    bannerUrl: string
    avatarUrl: string
    socials: Socials
    chain: SupportedChain
    contractAddress: Address
    revealed: boolean
    transfersLocked: boolean
    featured: { id: number; name: string; imageUrl: string }[]
  }
  supply: { max: number; minted: number }
  publicMaxMintPerWallet: number
  fees: FeeSnapshot
  /** Each group's `active` is the contract's `mintGroupActive`, as read by the freshness server. */
  groups: MintGroup[]
  /** The chain's block timestamp at the read. Use it, not the browser clock, for countdowns. */
  blockTimestamp: number
  /** When the freshness server read the chain. */
  readAt: number
  /** Null when no wallet is connected. */
  wallet: WalletState | null
}

// ---------------------------------------------------------------------------------------------
// Manage: overview
// ---------------------------------------------------------------------------------------------

/** Mint activity and money. Replaced by: indexed `TokensMinted` events and `creatorBalance()` / `platformBalance()`. */
export type DropActivity = {
  /** Mints per hour, oldest first. */
  mintsOverTime: { at: number; count: number }[]
  recentMints: {
    txHash: Hex
    minter: Address
    amount: number
    groupId: number
    at: number
    firstTokenId: number
  }[]
  holders: number
  proceeds: {
    /** Everything minters paid the creator, before withdrawals. */
    grossWei: string
    withdrawnWei: string
    /** `creatorBalance()`: what the payout address can withdraw now. */
    withdrawableWei: string
    /** `platformBalance()`: fees owed to the treasury, withdrawable by anyone. */
    platformFeesWei: string
  }
}

/** A past airdrop. Replaced by: indexed `NFTsAirdropped` events. */
export type AirdropRecord = {
  txHash: Hex
  at: number
  recipients: number
  tokens: number
  feePaidWei: string
  /** An airdrop to the dead address is a burn (MASTER_PLAN, Contracts: burn). */
  burn: boolean
  /**
   * The first token id it minted; ids run on from there, one per token. Seam: read from the
   * `Transfer` logs of the receipt (legacy parsed `topics[3]`), or from the indexer.
   */
  firstTokenId?: number
}
