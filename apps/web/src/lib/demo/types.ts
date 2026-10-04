/**
 * Shapes of the sample data the creator screens and the mint page render until their backends
 * exist. Each type names the real source that will replace it. Amounts of the native token are
 * wei as decimal strings (a uint256 does not fit in a JS number); times are unix seconds.
 */

export type Address = `0x${string}`
export type Hex = `0x${string}`

// ---------------------------------------------------------------------------------------------
// Art (Phase 3: art generator)
// ---------------------------------------------------------------------------------------------

/** One trait of a layer. Replaced by: the project's layer and trait rows (Phase 3 art tables). */
export type Trait = {
  /** Unique within the project, e.g. `eyes-starry`. DNA and rules refer to traits by this id. */
  id: string
  layerId: string
  name: string
  /** Chance in percent among the layer's weighted traits. 0 for a constant. Weights sum to 100 per layer. */
  weight: number
  /**
   * A fixed-quantity trait: placed on at most this many tokens instead of by weight. A cap, not an
   * exact count (MASTER_PLAN, Art: maximum counts): rules and uniqueness can stop the generator from reaching it.
   */
  constant?: number
  /** The empty trait: the layer is left out of a token. Has no image. */
  blank: boolean
  /** Full-size layer image, or null for a blank. Square, transparent, stacks in layer order. */
  imageUrl: string | null
}

/**
 * One collection of a generative project, as in the legacy app (for example male and female). Each
 * has its own layers and rules and its own size; token ids run on across collections (1 to N) and
 * uniqueness is checked within a collection. Replaced by: the project's collection rows (Phase 3).
 */
export type Collection = {
  id: string
  name: string
  /** Tokens to generate for this collection. The supply is the sum of the sizes. */
  size: number
}

/** A layer, bottom first. Replaced by: the project's layer rows (Phase 3), ordered by position. */
export type Layer = {
  id: string
  /** The collection this layer belongs to. Each collection has its own stack. */
  collectionId: string
  name: string
  /** 0 is the bottom of the collection's stack. */
  position: number
  traits: Trait[]
}

/** The three legacy rule kinds, worded as the creator sees them. Replaced by: the rules enum (Phase 3). */
export type RuleKind = "doesn't mix with" | 'always pairs with' | 'must pair with'

/**
 * A trait-pairing rule, stored on its source trait. Replaced by: the project's rule rows (Phase 3).
 *  - doesn't mix with: never in the same token as any related trait (both directions).
 *  - always pairs with: appears only with one of the related traits, and they only with it (both directions).
 *  - must pair with: whenever this trait appears, one of the related traits does too (one direction).
 */
export type ArtRule = {
  id: string
  kind: RuleKind
  traitId: string
  relatedTraitIds: string[]
  bidirectional: boolean
}

/**
 * A contradiction the Rules screen surfaces. Rules name traits, and trait ids are unique in the
 * project, so a rule applies within its traits' collection. Replaced by: the rule analyser in `packages/dna`.
 */
export type RuleConflict = {
  kind: 'isolated' | 'mixing' | 'circular'
  ruleIds: string[]
  message: string
  /** The rules generation skips to get round the conflict. Unset: every rule but the first. */
  skip?: string[]
}

/** One generated token. Replaced by: the token list the browser submits at lock (MASTER_PLAN, Art: lock check). */
export type GeneratedToken = {
  /** Token id, starting at 1 and running on across collections. Also the number in the name. */
  id: number
  /** "<token name> #<id>", the token name chosen at Generate (legacy auto-populate). */
  name: string
  /** The metadata description: the one chosen at Generate, or this token's own after an edit. */
  description?: string
  /** The collection the token belongs to; its DNA follows that collection's layers. */
  collectionId: string
  /** The chosen trait id for each of its collection's layers, in layer order (`dna[i]` belongs to `layers[i]`). */
  dna: string[]
  /** 1 is the rarest. */
  rank: number
  /** Pre-rendered composite for the first tokens, else null: stack `tokenLayerUrls` instead. */
  previewUrl: string | null
}

/** How often each trait occurs in the generated set. Replaced by: counts from the stored token list. */
export type TraitCounts = Record<string, number>

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
  mediaType: MediaType
  /** Editions of this artwork (1/1s); 1 otherwise. */
  quantity: number
  attributes: { traitType: string; value: string }[]
}

// ---------------------------------------------------------------------------------------------
// Lock and upload (Phase 4: render pipeline)
// ---------------------------------------------------------------------------------------------

/** A render job's state. Replaced by: `render_jobs.state` (Phase 4). */
export type RenderJobState = 'locked' | 'payment_due' | 'rendering' | 'done'

/** The art-fee quote issued at lock. Replaced by: the quote row written at lock, from the factory's `artFeePerToken()`. */
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
}

/**
 * The pre-reveal placeholder (MASTER_PLAN, Flow: pre-reveal): one file every token shows until the reveal, pinned
 * to its own small CID. Replaced by: the placeholder columns of `render_jobs` (Phase 4).
 */
export type RenderPlaceholder = {
  cid: string
  mediaType: MediaType
  /** A preview of the file. For a video this is the MP4. */
  imageUrl: string
}

type RenderJobBase = {
  id: string
  /** The factory job id passed to `payForArt(jobId)`. */
  jobId: Hex
  tokenCount: number
  lockedAt: number
  /** Hash of the token list stored at lock (MASTER_PLAN, Art: lock check). */
  tokenListHash: Hex
  quote: ArtFeeQuote
  /**
   * What the creator chose under "Lock options". `allowDuplicates`: identical trait combinations are
   * accepted. Seam: the server honours it when it validates the submitted token list at lock
   * (decision C1; MASTER_PLAN, Art: assignment integrity at lock).
   */
  lockOptions: { allowDuplicates: boolean }
  /**
   * Set when the creator chose "Reveal later": the contract starts on this placeholder and reveals
   * to the real metadata from Settings. Null when the contract starts on the real art.
   */
  placeholder: RenderPlaceholder | null
}

/**
 * A render job in one of its states. Replaced by: `render_jobs` rows and the render Lambda's progress (Phase 4).
 * Progress is coarse on purpose: batches done of total, then metadata. There is no per-image status.
 */
export type RenderJob =
  | (RenderJobBase & { state: 'locked' })
  | (RenderJobBase & { state: 'payment_due' })
  | (RenderJobBase & {
      state: 'rendering'
      payment: { txHash: Hex; paidAt: number; amountWei: string }
      batches: { total: number; done: number; size: number }
      startedAt: number
    })
  | (RenderJobBase & {
      state: 'done'
      payment: { txHash: Hex; paidAt: number; amountWei: string }
      batches: { total: number; done: number; size: number }
      startedAt: number
      finishedAt: number
      /**
       * The real set. Null when the art is deferred (MASTER_PLAN, Flow: pre-reveal) and this run rendered only the
       * placeholder; the real set is locked and rendered in a second run once the art is finished.
       */
      imagesCid: string | null
      metadataCid: string | null
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
