# Creator flow and mint page UI: specification

Written on 3 October 2026, after the build. The UI pass on branch `phase-2b-ui-flow` was built from
agent briefs without a written spec. This document records what was asked for, what was decided
along the way, and what is still open, so the next phases have a contract to build against and the
owner has a list of decisions to confirm or reverse.

Companion plan: [../plans/2026-10-03-creator-flow-ui.md](../plans/2026-10-03-creator-flow-ui.md).
Design language: `docs/DESIGN.md` on the branch. Product decisions: `docs/MASTER_PLAN.md`, Decided table.

## 1. Goal

Replace the placeholder seven-step shell with a finished creator UI and a public mint page, so the
whole product can be walked and judged before the backends exist. Three requests from the owner:

1. "Design looks bland." Apply the taste skill; keep the gray palette, yellow accent, Poppins, the
   legacy layout and the Kingdomly logo.
2. The flow is `Details -> Art (Layers -> Rules -> Generate) -> Lock and upload -> Deploy -> Manage drop`.
   Phases, whitelist, mint page details, airdrop and settings are tabs inside Manage drop, not steps.
3. Every screen exists as real UI, including the art project setup the legacy app had, and the
   public mint page, which "needs to be the most aesthetic and friendliest UX among all UI."

## 2. Scope

### In scope

- Design foundation: tokens, type scale, radius rule, every shadcn component restyled, shell,
  sign-in, dashboard, new-collection dialog, help, 404.
- Five-stage flow with routes, stage navigation, access rules and a Details form wired to the
  database.
- Complete, interactive UI for Art, Lock and upload, Deploy, the six Manage drop tabs and the public
  mint page, running on typed sample data with simulated transactions.
- A sample collection ("Night Owls", 777 tokens, seven layers) with generated SVG art, so every
  screen is judged with real-looking content.

### Out of scope (later phases)

- Storage, art tables and the real trait engine (`packages/dna`): Phase 3.
- Render pipeline and IPFS: Phase 4.
- Factory and collection transactions, whitelist writes, phase management on chain: Phase 5.
- Freshness server and live mint page data: Phase 6.
- Any persistence for Art, Lock and upload, Deploy, Manage drop or mint page settings.

## 3. Flow

| # | Stage | Route | Sub-navigation | Done when (status) |
| --- | --- | --- | --- | --- |
| 1 | Details | `/collections/[id]/details` | none | always (a collection exists) |
| 2 | Art | `/collections/[id]/art/*` | Layers, Rules, Generate (generative); Upload assets (other types) | `art_locked` or later |
| 3 | Lock and upload | `/collections/[id]/upload` | none; four states on one screen | `rendered` or later |
| 4 | Deploy | `/collections/[id]/deploy` | none | `deployed` |
| 5 | Manage drop | `/collections/[id]/manage/*` | Overview, Phases, Whitelist, Mint page, Airdrop, Settings | never (ongoing) |

Rules:

- A stage is locked until the stage before it is done. Done stages stay viewable; where editing
  no longer applies (Art after lock, Details fields after deploy) the screen is read-only with a
  notice.
- `collection_status` is unchanged: `draft` points to Art, `art_locked` and `rendering` to Lock and
  upload, `rendered` to Deploy, `deployed` to Manage drop.
- `/collections/[id]` redirects to the stage the collection needs next.
- Every page calls `requireOwnedCollection(id)`. Every server action checks the session with
  `getVerifiedUser` and ownership.
- Sample mode (`NEXT_PUBLIC_DEMO_DATA=1`): every stage is open and renders the sample data; the top
  bar shows a "Sample data" chip. Off: locked stages show what must happen first.

## 4. Screens

### 4.1 Shell, sign-in, dashboard

- Sidebar and top bar keep the legacy dimensions. Dark only. Surface scale: sidebar, page,
  card, two raised levels, and a recessed "well" for fields.
- Sign-in: split screen, headline and one button on the left, sample art and the five stages on
  the right. Signing in is a free signature.
- Dashboard: artwork-led cards with status badge, mono meta line, five stage-progress segments and
  the next stage, read from `nextStep()`. Empty state explains what to do first.
- New collection dialog: name, symbol, type (four choice cards), mint page address, supply (limit
  depends on type; 4,000 for single asset).

### 4.2 Details

Name, symbol, mint page address, description, supply, type (read-only). Fields freeze when the
database says so (`collections_guard_frozen_fields`): name, symbol and slug until deploy, supply
until the art is locked. The action reports a taken address and a frozen-field rejection in plain
words.

### 4.3 Art

**Layers.** Layer list in stacking order (top first), drag or keyboard to reorder, rename, delete,
add; per-layer visibility in the live composite preview; "Randomise" respecting rules. Selected
layer shows its traits with weight (slider plus number), expected count for the supply, generated
count, running total that must equal 100, "Even out", fixed-quantity traits, blank trait on or
off, add traits by file picker or drop zone with browser validation (PNG, square, at most 2048 x
2048, same size across the project, 10 MB per file), rename, delete.

Legacy defects designed out: adding or deleting a trait does not touch other weights (only "Even
out" redistributes); a structural change that would clear generated tokens asks first and says
how many; weight changes mark the set "out of date" instead of wiping it.

**Rules.** Three kinds, worded as the creator sees them: "doesn't mix with", "always pairs with"
(both directions), "must pair with" (one direction). Rules read as sentences with trait thumbnails;
filter by kind; add or edit in a dialog with duplicate detection; delete with confirmation. The
conflict analyser lists each conflict in plain words with a jump to the rules involved; conflicting
rules are marked in the list.

**Generate.** Generate or regenerate the set (seeded); supply shown; unreachable supply explained
with links back. Gallery paginated at 48 with search by id, filter by trait with counts, sort by id
or rarity, rarity tier badge (top 5%, 15%, 30%, 50%, rest). Token detail: large preview, change a
trait (refused with a reason when it breaks a rule, duplicates a token or exceeds a fixed
quantity), swap ids, regenerate, delete. Selection mode for bulk regenerate, shuffle and delete.
Statistics tab with expected against actual per trait. Continue is disabled, with the reason, until
the set is full and follows the rules; the footer says the art cannot be edited after locking.

**Upload assets** (1/1s, metadata, single asset). One screen that adapts to the type: single asset
is one image plus a quantity capped at 4,000; 1/1s are many images each with an edition count and
editable attributes; metadata is images plus JSON with the legacy validation rules shown as a live
checklist. A summary compares total tokens to the supply.

### 4.4 Lock and upload

Four states on one screen as a vertical progression; the current state is expanded and finished
ones collapse to a one-line receipt.

1. Review and lock: supply, layer, trait and rule counts, a strip of sample tokens, the four server
   checks (supply matches, no duplicates, rules satisfied, constants respected), a statement that
   the art cannot be edited after locking, confirmation dialog.
2. Pay: tokens x per-token fee = total in the chain's native token, the payer wallet; simulate,
   then wallet, then confirming, then "waiting for confirmation" (the job becomes paid only from the
   verified on-chain event); failure states for rejected, simulation failed with reason,
   insufficient balance.
3. Rendering: batch progress, latest thumbnails, metadata upload after images, time estimate, a
   note that the creator can leave, retry for a failed batch.
4. Done: image and metadata CIDs with copy and gateway links, a gallery sample, continue to Deploy.

### 4.5 Deploy

Two columns on wide viewports. Left: chain picker (Ethereum, Arbitrum, Base, Berachain, Monad,
Robinhood Chain; the connected chain marked; switching is part of the deploy action), name and
symbol read-only with a note that they are fixed after deploy, max supply, payout address (default
the creator's wallet, `isAddress` validated), royalty 0 to 10% shown as bps, royalty recipient,
public mint limit per wallet (a constructor argument). Right: summary with the predicted contract
address (same on every chain), the fee snapshot read from the factory (flat mint fee, bps, airdrop
fee), estimated deploy cost, starting URI and reveal URI. Deploy: final-check dialog, then switch
chain if needed, simulate, wallet, confirming. Deployed: contract address and tx with copy and
explorer links, deploy time, payout, royalty, mint fee, and three links into Manage drop.

### 4.6 Manage drop

Every transaction uses one shared sequence: checking (simulate), confirm in wallet, confirming,
done, with failure at any step and a way forward.

- **Overview:** minted of supply with a meter split by phase, airdrops and remaining; contract
  address, deployed age, holders; "View mint page"; live phases with price and progress; next
  scheduled phase in UTC and the creator's time zone; mints per hour (CSS chart, hidden table for
  screen readers, busiest hour emphasised, the current hour in yellow only when a phase is live);
  proceeds (withdrawable, paid by minters, withdrawn, platform fees apart); recent mints; a setup
  checklist.
- **Phases:** supply strip with labelled segments in the same order as the list; rows with name,
  kind, price, minted of allocation, per-wallet limit (public), status. Status comes only from the
  group's `active` field; a scheduled start is shown as a time and never decides "live". Actions:
  Open now, Close (clears the schedule, and says so), Schedule or change start (date and time in the
  creator's time zone, with UTC and the Unix value sent, warning when already past on chain), Clear
  schedule, Edit price, Edit max supply (floor at minted), Edit per-wallet limit, Add phase, Close
  all. Overlap is explained: phases do not end by themselves.
- **Whitelist:** per whitelist phase: addresses, total quota, quota used, phase supply; on-chain
  write panel with chunks of 300 (written with tx link, next, waiting, failed with error), "Write
  chunk N" or "Retry chunk N", resume after failure; table with search, All / Not written filter, 25
  per page, quota edit, remove (staged as quota 0 when already on chain), set quota for all, add
  addresses (CSV upload or drop, paste, one at a time; `isAddress`, checksum normalisation, dedupe,
  header detection, rejected lines with numbers), CSV template and export.
- **Mint page:** public link with copy and open, "Page is public" switch, description with counter,
  banner (3:1, 5 MB) and avatar (square, 400 px, 2 MB) with type, size and shape checks, website, X
  and Discord links validated per host, up to six featured tokens numbered in pick order, a
  miniature preview with unsaved values laid over it, Save and Discard.
- **Airdrop:** recipients by the shared input with quantity per address; quote (recipients, tokens,
  fee per token, transactions at 300 recipients per batch, total fee, left to mint before and
  after, over-supply error); batches sent in order with per-batch retry; history with burns marked.
  Burn is a separate red section: mints to the dead address, costs the airdrop fee, requires typing
  "burn N".
- **Settings:** grouped as Money (withdraw, payout address, royalties), Metadata (reveal to the
  rendered CID or a custom CID, with token 1's URI before and after; no trailing slash for single
  asset), Minting (mint on behalf switch with the risk explained), Transfers (lock or unlock, red,
  confirmed, marketplaces blocked while locked, disabled where the chain has no validator).

### 4.7 Public mint page (`/[slug]`)

- Stands alone: slim top bar with identity and wallet button, no app sidebar, "Powered by Cobweb"
  in the footer. Dark, the app's palette, the artwork supplying the rest of the colour.
- Hero: artwork left (7 of 12 columns, sticky on desktop; featured token in front with two behind,
  turning every 5.6 s, paused on hover, focus, a button, or reduced motion), mint panel right.
- Mint panel: status chip, name, creator, chain, minted of supply, current phase and price, quantity
  stepper bounded by what this wallet may still mint, total with platform fee itemised, one primary
  button whose label always says exactly what will happen or why it cannot (Connect wallet, Mint 2
  for 0.003 ETH, Not on the whitelist for this phase, Wallet limit reached, Starts in 02:14:09,
  Switch to Base). Yellow only when pressing it does something. Eligibility per phase for the
  connected wallet. Delegated vaults offered as "mint using the allowance of".
- Phases grouped as Open now, Coming up, Finished, each with name, kind, price, allocation,
  status, and whether this wallet is on the list. Overlapping open phases are shown and
  selectable.
- Mint flow: checking (simulate), confirm in wallet, confirming, success. Success reveals the
  minted tokens with ids, a transaction link, share, and "Mint more" when allowed. Failures:
  rejected, simulation failed (phase closed, quota exceeded, insufficient balance), reverted.
- Below the fold: featured tokens as a gallery wall, about with socials, details (contract with copy
  and explorer link, chain, token standard, supply, royalties, transfers, reveal status), footer.
- States: not connected; upcoming (countdown leads); whitelist live eligible and not eligible;
  public live; wallet limit reached; sold out (no button; links onward); closed between phases;
  wrong network; data degraded banner; loading skeleton; not found.
- Phone: one column, sticky mint bar whenever the panel's button is off screen, flow as a bottom
  sheet. Root font size 14 px on this page under 640 px (the app's 12 px made small text 10 px).

Hard rules, from `CLAUDE.md`:

1. Liveness comes only from the data's `active` field (the contract's `mintGroupActive` view, read
   by the freshness server). A countdown at zero shows "Starting, waiting for the chain" until the
   data says active. Countdowns run from `blockTimestamp`, not the browser clock.
2. Simulate, then send the simulated request. The wallet opens only after the simulation passes.
3. The page makes no shared-state RPC calls.

## 5. Sample data contract

`apps/web/src/lib/demo/types.ts` is the contract the screens render. Each type names the source
that replaces it. Amounts of the native token are wei as decimal strings; times are unix seconds.
When a phase wires a real source, it must match these shapes or change the screen deliberately.

| Type | Replaced by | Phase |
| --- | --- | --- |
| `Layer`, `Trait`, `ArtRule`, `RuleConflict`, `GeneratedToken`, `TraitCounts`, `UploadedAsset` | art tables, the rule analyser in `packages/dna`, the token list submitted at lock (C1) | 3 |
| `RenderJob` (`locked`, `payment_due`, `rendering`, `done`), `ArtFeeQuote` | `render_jobs` rows, the quote written at lock from `artFeePerToken()`, render progress | 4 |
| `SupportedChain`, `FeeSnapshot`, `DeployDraft`, `Deployment` | `packages/shared` chain config, factory `collectionFees()`, collection `fees()`, `collections` columns | 5 |
| `MintGroup`, `WhitelistEntry`, `WhitelistChunk`, `GroupWhitelist` | `collectionState()` joined with `mint_groups.name`, `whitelist_entries`, a chunk table | 5 |
| `MintPageSettings`, `WalletState`, `MintPageData` | a mint page settings table, `walletState(wallet)` and the collection endpoint of the freshness server | 6 |
| `DropActivity`, `AirdropRecord` | indexed `TokensMinted` and `NFTsAirdropped` events, `creatorBalance()`, `platformBalance()` | 5 and 6 |

Fields that must exist in the real sources because the screens already depend on them:

- `MintGroup.active` and `MintGroup.flag` as separate fields; `scheduledStart` as unix seconds or 0.
- `MintPageData.blockTimestamp` and `readAt`.
- `WalletState.groups[].eligible` and `delegatedVaults`.
- `RenderJob.quote.payer`: only a payment from that wallet counts.

Known gaps the mint page worked around, to add in Phase 6: `MintPageData` has no creator address,
royalty or `degraded` flag; the public phase's per-wallet usage is `WalletState.publicMinted`, not
`groups[0].used`.

Seams: every place a real backend plugs in is marked with a `Seam:` or `SEAM:` comment
(`components/art/state`, `components/upload/upload-sim.ts`, `components/deploy/deploy-sim.ts`,
`components/manage/simulate.ts`, `components/mint/mint-transaction.ts`, `app/[slug]/sample-data.ts`).

## 6. Design language (summary; `docs/DESIGN.md` is authoritative)

- Surfaces, darkest to lightest: sidebar `#161614`, page `#1a1a18`, card `#222220`, raised
  `#2a2a28` and `#343431`, well `#141413`. Lines tinted from the foreground; shadows tinted to the
  base with a 1 px inner top light; no outer glows.
- Type: Poppins; `text-display`, `text-title`, `text-heading`, `text-caption`; Geist Mono via the
  `numeric` utility for numbers, prices, addresses and countdowns.
- Accent `#fadc69` for the primary action, live state and progress only. Status colours: success,
  warning, destructive, each with `-foreground` and `-soft`.
- Radius: controls 10 px, menus 12 px, cards and dialogs 16 px, chips round.
- Motion from `motion/react`, transform and opacity only, reduced motion respected (the accordion's
  height animation is the one exception).
- Copy: professional, no "Kingdomly" or "realm", "Whitelist" is the term, no em or en dashes, no
  emoji. Icons from lucide only.

## 7. Decisions made during the build, for the owner to confirm or reverse

| # | Decision | Made by | Default if unanswered |
| --- | --- | --- | --- |
| S1 | Manage drop drops holder-snapshot import (needs an indexer), gate submissions, the Team, Roadmap, FAQ, music and carousel tabs, iframe customisation, email reminders, per-token royalty, changing the validator address | Manage builder | stays dropped |
| S2 | "Close all phases" added as an emergency stop (replaces the legacy global toggle, within D12) | Manage builder | keep |
| S3 | Whitelist chunk size 300 (legacy 1,000; C3 says 300 to 500) | Manage builder | keep |
| S4 | Rarity tiers use warning (top 5%), success (top 15%), foreground, muted, faint; no dedicated tier tokens | Art builder | add tier tokens in Phase 3 |
| S5 | Fixed-quantity traits are exact, not a cap as in legacy | Art builder | keep |
| S6 | Changing a token's trait checks rules as well as uniqueness (legacy checked uniqueness only) | Art builder | keep |
| S7 | No video uploads and no placement options for 1/1s | Art builder | revisit in Phase 3 |
| S8 | Sold out shows no button, only links onward | Mint builder | keep |
| S9 | Mint page root font 14 px under 640 px | Mint builder | keep |
| S10 | Payout address defaults to the connected wallet, not `DEMO_DEPLOY_DRAFT.payoutAddress` | Deploy builder | keep |
| S11 | Public mint limit per wallet is set at Deploy (constructor argument) and editable in Phases | Deploy builder | keep |
| S12 | In sample mode any well-formed slug shows the sample mint page, so "View mint page" works for every collection | reviewer | keep until Phase 6 |
| S13 | Burn confirmation requires typing "burn N" | Manage builder | keep |

Already open from earlier: the logo (Kingdomly crown stays for now), mint fee A/B/C, art fee from
token one or 4,000 free, 5 GB per project and 500 traits per layer.

## 8. Acceptance criteria

Checked on the branch on 3 October 2026 unless marked open.

- [x] Every route in section 3 renders for the owner and 404s for anyone else (ownership check in
      every page; verified by code review, and `verify:local` covers the access rules).
- [x] `pnpm typecheck`, `pnpm lint`, `pnpm --filter @cobweb/web lint` and `pnpm --filter @cobweb/web build` pass.
- [x] No hex colours in components; no em or en dashes, "Kingdomly" or "realm" in visible copy.
- [x] Every screen in section 4 was looked at in a browser at 1440 wide and matched its description.
- [x] The mint page was looked at in every state in section 4.7 at 1440 and 390 wide.
- [x] Rule 1 holds: with `?start=10` the countdown reaches zero and the button stays disabled,
      reading "Starting, waiting for the chain".
- [x] Rule 2 holds: the wallet step begins only after the simulation step finishes.
- [x] No hydration errors in the console on any screen (one was found on Rules and fixed).
- [ ] `pnpm --filter @cobweb/web verify:local` re-run after the Details action was added.
- [ ] Creator screens checked between 640 and 1023 px.
- [ ] Upload assets screen (1/1s, metadata, single asset) checked in a browser.
- [ ] Owner has answered S1 to S13.
