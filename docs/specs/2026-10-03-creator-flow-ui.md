# Creator flow and mint page UI: specification

Companion plan: [../plans/2026-10-03-creator-flow-ui.md](../plans/2026-10-03-creator-flow-ui.md).
Design language: [../DESIGN.md](../DESIGN.md). Product decisions: [../MASTER_PLAN.md](../MASTER_PLAN.md#decisions).

## 1. Goal

A finished creator UI in five stages and a public mint page, so the whole product can be walked and
judged before the backends exist.

- The design keeps the warm gray palette, the yellow accent, Poppins, the legacy layout and the
  Kingdomly logo, and is refined until no screen looks like default shadcn.
- The flow is `Details -> Art (Layers -> Rules -> Generate) -> Lock and upload -> Deploy -> Manage drop`.
  Phases, whitelist, mint page details, airdrop and settings are tabs inside Manage drop, not steps.
- Every screen exists as real UI, including the art project setup for all four project types and
  the public mint page, which is the most polished and friendliest screen in the product.

## 2. Scope

### In scope

- Design foundation: tokens, type scale, radius rule, every shadcn component restyled, shell,
  sign-in, dashboard, new-collection dialog, help, 404.
- Five-stage flow with routes, stage navigation, access rules and a Details form wired to the
  database.
- The mint page address reservation, wired to the database.
- Complete, interactive UI for Art, Lock and upload, Deploy, the six Manage drop tabs and the public
  mint page, running on typed sample data with simulated transactions.
- Pre-reveal ("Reveal later" and "Finish the art later") in the sample data and the stage rules.
- A sample collection ("Night Owls", 777 tokens, seven layers) with generated SVG art, so every
  screen is judged with real-looking content.

### Out of scope (later phases)

- Storage, art tables and the real trait engine (`packages/dna`): Phase 3.
- Render pipeline and IPFS: Phase 4.
- Factory and collection transactions, whitelist writes, phase management on chain, holder
  snapshot import, the transfer validator setting: Phase 5.
- Freshness server, live mint page data, and the mint page sections listed in 4.7: Phase 6.
- Any persistence for Art, Lock and upload, Deploy, Manage drop or mint page settings.

### Not built

Gate submissions, partner codes, iframe customisation, email reminders and per-token royalty
(royalty is per collection).

## 3. Flow

| #   | Stage           | Route                        | Sub-navigation                                                    | Done when (status)           |
| --- | --------------- | ---------------------------- | ----------------------------------------------------------------- | ---------------------------- |
| 1   | Details         | `/collections/[id]/details`  | none                                                              | always (a collection exists) |
| 2   | Art             | `/collections/[id]/art/*`    | Layers, Rules, Generate (generative); Upload assets (other types) | `art_locked` or later        |
| 3   | Lock and upload | `/collections/[id]/upload`   | none; four states on one screen                                   | `rendered` or later          |
| 4   | Deploy          | `/collections/[id]/deploy`   | none                                                              | `deployed`                   |
| 5   | Manage drop     | `/collections/[id]/manage/*` | Overview, Phases, Whitelist, Mint page, Airdrop, Settings         | never (ongoing)              |

Rules:

- A stage is locked until the stage before it is done. Done stages stay viewable; where editing
  no longer applies (Art after lock, Details fields after deploy) the screen is read-only with a
  notice. The one exception is deferred art (section 7): Art stays open after deploy until the real
  set is locked.
- `collection_status` maps to stages: `draft` points to Art, `art_locked` and `rendering` to Lock
  and upload, `rendered` to Deploy, `deployed` to Manage drop.
- `/collections/[id]` redirects to the stage the collection needs next.
- No mint page without a contract. The address is reserved in Deploy and becomes permanent at
  deploy (4.5).
- Every page calls `requireOwnedCollection(id)`. Every server action checks the session with
  `getVerifiedUser` and ownership.
- Sample mode (`NEXT_PUBLIC_DEMO_DATA=1`): every stage is open and renders the sample data; the top
  bar shows a "Sample data" chip, and any well-formed slug resolves to the sample mint page until
  Phase 6. Off: locked stages show what must happen first.

## 4. Screens

### 4.1 Shell, sign-in, dashboard

- Sidebar and top bar keep the legacy dimensions. Dark only. Surface scale: sidebar, page,
  card, two raised levels, and a recessed "well" for fields.
- Sign-in: split screen, headline and one button on the left, sample art and the five stages on
  the right. Signing in is a free signature.
- Dashboard: artwork-led cards with status badge, mono meta line, five stage-progress segments and
  the next stage, read from `nextStep()`. Empty state explains what to do first.
- New collection dialog: name, symbol, type (four choice cards), supply (limit depends on type;
  4,000 for single asset). The mint page address is not chosen here; it is reserved in Deploy.

### 4.2 Details

Name, symbol, description, supply, type (read-only), and a read-only line showing the mint page
address reservation state. Fields freeze when the database says so
(`collections_guard_frozen_fields`): name, symbol and slug until deploy, supply until the art is
locked. The action reports a taken address and a frozen-field rejection in plain words.

### 4.3 Art

**Layers.** Layer list in stacking order (top first), drag or keyboard to reorder, rename, delete,
add; per-layer visibility in the live composite preview; "Randomise" respecting rules. Selected
layer shows its traits with weight (slider plus number), expected count for the supply, generated
count, running total that must equal 100, "Even out", maximum counts, blank trait on or off, add
traits by file picker or drop zone with browser validation (PNG, square, at most 2048 x 2048, same
size across the project, 10 MB per file), rename, delete.

A maximum count is a cap: the trait appears at most N times, since rules and other traits can
prevent reaching it. The copy says "up to N", and Generate's statistics say so when a capped trait
comes out below its count.

Unlike the legacy app: adding or deleting a trait does not touch other weights (only "Even out"
redistributes); a structural change that would clear generated tokens asks first and says how
many; weight changes mark the set "out of date" instead of wiping it. Deleting a trait also drops
it from every rule, and removes a rule left with nothing to pair.

**Rules.** Three kinds, worded as the creator sees them: "doesn't mix with", "always pairs with"
(both directions), "must pair with" (one direction). Rules read as sentences with trait thumbnails;
filter by kind; add or edit in a dialog with duplicate detection; delete with confirmation. The
conflict analyser lists each conflict in plain words with a jump to the rules involved; conflicting
rules are marked in the list.

**Generate.** Generate or regenerate the set (seeded); supply shown; unreachable supply explained
with links back. Gallery paginated at 48 with search by id, filter by trait with counts, sort by id
or rarity, rarity tier badge (top 5%, 15%, 30%, 50%, rest). Token detail: large preview, change a
trait (refused with a reason when it breaks a rule, duplicates a token or would exceed a trait's
maximum count), swap ids, regenerate, delete. Selection mode for bulk regenerate, shuffle and delete.
Statistics tab with expected against actual per trait. Continue is disabled, with the reason, until
the set is full and follows the rules; the footer says the art cannot be edited after locking, and
offers "Finish the art later" (section 7).

Rarity tiers use five dedicated tier colour tokens in `packages/ui` (Phase 3), shared with the mint
page.

**Upload assets** (1/1s, metadata, single asset). One screen that adapts to the type: single asset
is one file plus a quantity capped at 4,000; 1/1s are many images each with an edition count and
editable attributes; metadata is images plus JSON with the legacy validation rules shown as a live
checklist. A summary compares total tokens to the supply.

Media: 1/1s and metadata take images only, with no placement options. A single asset may be an
image, an MP4 or a GIF; the render pipeline passes video and GIF through without compositing.

### 4.4 Lock and upload

Four states on one screen as a vertical progression; the current state is expanded and finished
ones collapse to a one-line receipt.

1. Review and lock: supply, layer, trait and rule counts, a strip of sample tokens, the four server
   checks (supply matches, no duplicates, rules satisfied, maximum counts respected), the "Reveal
   later" option (section 7), a statement that the art cannot be edited after locking, confirmation
   dialog.
2. Pay: tokens x per-token fee = total in the chain's native token, the payer wallet; simulate,
   then wallet, then confirming, then "waiting for confirmation" (the job becomes paid only from the
   verified on-chain event); failure states for rejected, simulation failed with reason,
   insufficient balance.
3. Rendering: batch progress, latest thumbnails, metadata upload after images, time estimate, a
   note that the creator can leave, retry for a failed batch.
4. Done: image and metadata CIDs with copy and gateway links (and the placeholder CID when "Reveal
   later" is on), a gallery sample, continue to Deploy.

### 4.5 Deploy

Two columns on wide viewports. Left: chain picker (Ethereum, Arbitrum, Base, Berachain, Monad,
Robinhood Chain; the connected chain marked; switching is part of the deploy action), name and
symbol read-only with a note that they are fixed after deploy, max supply, mint page address,
payout address (default the creator's wallet, `isAddress` validated), royalty 0 to 10% shown as
bps, royalty recipient, public mint limit per wallet (a constructor argument, editable later in
Phases). Right: summary with the predicted contract address (same on every chain), the fee settings
read from the factory (flat mint fee, bps, airdrop fee), estimated deploy cost, "Starts on" URI and
"Reveals to" URI. Deploy: final-check dialog, then switch chain if needed, simulate, wallet,
confirming. Deployed: contract address and tx with copy and explorer links, deploy time, payout,
royalty, mint fee, and three links into Manage drop.

Mint page address: the creator reserves it here before deploying. A reservation lasts 3 days and
lapses if the contract is not deployed by then, freeing the address for anyone. Deploying makes it
permanent; after that it is immutable, so shared links never break. Schema: `collections.slug` is
nullable, `slug_reserved_at timestamptz` records the reservation, and every write goes through
`private.reserve_slug(collection_id, slug)`, which checks ownership, takes over a lapsed
reservation, and refuses when the collection is deployed and already has an address.

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
  all. Close all is the emergency stop: it calls `stopOrStartAllMintGroups(false)`, which turns
  every group's flag off. Overlap is explained: phases do not end by themselves.
- **Whitelist:** per whitelist phase: addresses, total quota, quota used, phase supply; on-chain
  write panel with chunks of 500 addresses per `setMintQuota` transaction (written with tx link,
  next, waiting, failed with error), "Write chunk N" or "Retry chunk N", resume after failure; table
  with search, All / Not written filter, 25 per page, quota edit, remove (staged as quota 0 when
  already on chain), set quota for all, add addresses (CSV upload or drop, paste, one at a time;
  `isAddress`, checksum normalisation, dedupe, header detection, rejected lines with numbers), CSV
  template and export. Holder snapshot import (Phase 5) adds the holders of another collection: a
  serverless function reads `totalSupply` and loops `ownerOf` in batches over a private RPC
  endpoint, with no indexer.
- **Mint page:** public link with copy and open, "Page is public" switch, description with counter,
  banner (3:1, 5 MB) and avatar (square, 400 px, 2 MB) with type, size and shape checks, website, X
  and Discord links validated per host, up to six featured tokens numbered in pick order, a
  miniature preview with unsaved values laid over it, Save and Discard. A deployed collection with no
  address (the reservation lapsed or was never made) sets it here, where the page is also
  published. Phase 6 adds fields for the Team, Roadmap, FAQ, music player and image carousel
  sections.
- **Airdrop:** recipients by the shared input with quantity per address, or by holder snapshot
  import (Phase 5); quote (recipients, tokens, fee per token, transactions at 500 recipients per
  batch, total fee, left to mint before and after, over-supply error); batches sent in order with
  per-batch retry; history with burns marked. Burn is a separate red section: mints to the dead
  address, costs the airdrop fee per token, requires typing "burn N".
- **Settings:** grouped as Money (withdraw, payout address, royalties), Metadata (reveal to the
  rendered CID or a custom CID, with token 1's URI before and after; no trailing slash for single
  asset), Minting (mint on behalf switch with the risk explained), Transfers (lock or unlock, red,
  confirmed, marketplaces blocked while locked, disabled where the chain has no validator; and,
  in Phase 5, the transfer validator address, read and changeable, since the validator governs
  tradability).

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
  public live; wallet limit reached; sold out (no button, only links onward); closed between phases;
  wrong network; data degraded banner; loading skeleton; not found.
- Phone: one column, sticky mint bar whenever the panel's button is off screen, flow as a bottom
  sheet. Root font size 14 px on this page under 640 px (the app's 12 px would make small text
  10 px).

Phase 6 adds:

- Team, Roadmap, FAQ, a music player and an image carousel as page sections, edited in the Mint
  page tab.
- "Remind me" on a scheduled phase, opening the visitor's calendar with the phase start, as on
  TheSuits. No email.
- The rarity tier of each minted token on generative collections, using the five tier tokens.
  Single asset and other same-metadata collections show something else in that spot, designed in
  Phase 6.

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

| Type                                                                                          | Replaced by                                                                                            | Phase   |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------- |
| `Layer`, `Trait`, `ArtRule`, `RuleConflict`, `GeneratedToken`, `TraitCounts`, `UploadedAsset` | art tables, the rule analyser in `packages/dna`, the token list submitted and validated at lock        | 3       |
| `RenderJob` (`locked`, `payment_due`, `rendering`, `done`), `ArtFeeQuote`                     | `render_jobs` rows, the quote written at lock from `artFeePerToken()`, render progress                 | 4       |
| `SupportedChain`, `FeeSnapshot`, `DeployDraft`, `Deployment`                                  | `packages/shared` chain config, factory `collectionFees()`, collection `fees()`, `collections` columns | 5       |
| `MintGroup`, `WhitelistEntry`, `WhitelistChunk`, `GroupWhitelist`                             | `collectionState()` joined with `mint_groups.name`, `whitelist_entries`, a chunk table                 | 5       |
| `MintPageSettings`, `WalletState`, `MintPageData`                                             | a mint page settings table, `walletState(wallet)` and the collection endpoint of the freshness server  | 6       |
| `DropActivity`, `AirdropRecord`                                                               | indexed `TokensMinted` and `NFTsAirdropped` events, `creatorBalance()`, `platformBalance()`            | 5 and 6 |

Fields that must exist in the real sources because the screens already depend on them:

- `MintGroup.active` and `MintGroup.flag` as separate fields; `scheduledStart` as unix seconds or 0.
- `MintPageData.blockTimestamp` and `readAt`.
- `WalletState.groups[].eligible` and `delegatedVaults`.
- `RenderJob.quote.payer`: only a payment from that wallet counts.
- `RenderJob.placeholder` (`{ cid, mediaType } | null`) and the collection's deferred-art flag
  (section 7).

Fields the Phase 6 source adds: the creator address, royalty and `degraded` flag on `MintPageData`.
The public phase's per-wallet usage is `WalletState.publicMinted`, not `groups[0].used`.

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

## 7. Pre-reveal

The placeholder is part of the one collection, not a second project: one collection, one deploy,
no copying of CIDs between projects.

- **Lock and upload** has a "Reveal later" option: the creator uploads one placeholder file (image,
  MP4 or GIF, the same rules as a single asset) and its description. The pipeline renders the real
  set to its CID and the placeholder to its own small CID. Both CIDs are shown on the Done step;
  creators always see their CIDs.
- **Deploy** starts the contract on the placeholder CID when "Reveal later" is on, else on the real
  CID. These are the summary's "Starts on" and "Reveals to" lines.
- **Settings, Reveal** switches the base URI to the real CID with one transaction. A custom CID
  stays possible for creators who rendered elsewhere. The placeholder stays available as "revert to
  placeholder" until the reveal is confirmed.

A creator may deploy before the real art is finished:

- **Art** has a "Finish the art later" path. Taking it marks the art as deferred: Lock and upload
  accepts the placeholder alone, Deploy proceeds on the placeholder CID, and the Art stage stays
  open after deploy until the real set is locked.
- **Lock and upload** for a deferred collection runs twice: once for the placeholder (lock, pay the
  placeholder fee, render), and later for the real set (lock, pay the generation fee, render). The
  second run ends with the real CID and a prompt to reveal. The placeholder fee is an open decision
  in [MASTER_PLAN.md](../MASTER_PLAN.md#open-decisions).
- **Data:** the render job carries `placeholder: { cid, mediaType } | null` and the collection a
  deferred-art flag. Phase 3 adds the column; the sample data and `steps.ts` model it until then.

## 8. Acceptance criteria

- [x] Every route in section 3 renders for the owner and 404s for anyone else (ownership check in
      every page; `verify:local` covers the access rules).
- [x] `pnpm typecheck`, `pnpm lint`, `pnpm --filter @cobweb/web lint` and `pnpm --filter @cobweb/web build` pass.
- [x] No hex colours in components; no em or en dashes, "Kingdomly" or "realm" in visible copy.
- [x] Every screen in section 4 matches its description in a browser at 1440 wide.
- [x] The mint page matches every state in section 4.7 at 1440 and 390 wide.
- [x] Rule 1 holds: with `?start=10` the countdown reaches zero and the button stays disabled,
      reading "Starting, waiting for the chain".
- [x] Rule 2 holds: the wallet step begins only after the simulation step finishes.
- [x] No hydration errors in the console on any screen.
- [ ] `pnpm --filter @cobweb/web verify:local` passes with the Details action in place.
- [ ] Creator screens hold up between 640 and 1023 px.
- [ ] Upload assets screen (1/1s, metadata, single asset) checked in a browser.

## 9. Review round 1 (4 October 2026)

The owner reviewed the published preview and left 24 comments. The rules below amend the sections
above; where they conflict, this section wins.

### Navigation and shell

- One stepper only. The Art sub-steps (Layers, Rules, Generate) are not a second header row; they
  live in a left rail inside the Art stage.
- After deploy the stepper is gone. A deployed collection opens on Manage drop with its tabs, and
  the four build stages (Details, Art, Lock and upload, Deploy) are reachable from a "Setup" link as
  read-only history. Manage drop is no longer a step.
- Details has the same Back / Save and continue footer as the other stages.
- The dashboard has search and a filter by project type.
- Sign-in poster: "Generate art", never "pay the generation fee".

### Creating a collection and the art flow (as in the legacy app)

- New collection asks for type, then name and symbol. No supply, no mint page link.
- Project types are Generative, 1/1s and Single asset. The Metadata type is removed (schema enum,
  dialog, assets screen, sample data).
- Generative goes straight to Layers, which starts as a resumable folder upload
  (`collection/layer/trait.png` or `project/collection/layer/trait.png`). 1/1s goes straight to a
  resumable file upload. Single asset goes to a screen with the one file and the quantity, which is
  where supply is set for that type.
- Supply for Generative is the sum of the per-collection sizes chosen at Generate; for 1/1s it is
  the number of files (times editions). `collections.max_supply` is set then, not at creation.
- A project can hold several collections (for example male and female), as in the legacy app: a
  collection switcher on Layers and Rules, one size per collection at Generate, token numbering
  continuous across collections, uniqueness checked per collection.
- "Finish the art later" is a visible secondary button on every Art screen, not only the footer.
- The rules conflict warning is a red indicator beside "Continue to Generate" that opens a small
  dialog; clicking Continue while a conflict exists opens that dialog first. No large panel.
- Token detail opens in a side panel next to the gallery, not a centred modal.

### Deploy

- The mint page link is reserved in the Deploy form and is required before deploying. The word is
  "mint page link", not "address", everywhere.
- Chain cards and chain labels show the chain's icon.
- The deployed view has "Open mint page" as its primary action.
- The deployed view and Settings state that royalties are enforced on secondary sales through the
  transfer validator.

### Manage drop

- Overview: no mints-over-time chart, no platform fees line, no Setup checklist. Recent mints stays.
  Added: a Reveal action, a public/private switch for the mint page, and the tradability control
  (transfer validator and lock) moved up from Settings.
- Settings keeps the custom base URI with an explicit red warning that a wrong IPFS link breaks the
  art and metadata of tokens already minted.
- Mint page tab: once deployed there is no reservation wording; the tab shows "Set link" or "Change
  link" with a warning that changing it breaks shared links.
- Airdrop: no separate burn section. A "Burn instead of sending" switch turns the airdrop into a
  burn to the dead address with a quantity.

## 10. Review round 2 (4 October 2026)

Nineteen further comments on the round 1 preview. These amend sections 4 and 9.

### Navigation

- The workspace nav is dynamic per stage. Before deploy: the four-stage stepper and nothing about
  Manage drop (no link, no tabs). After deploy: no stepper for Details, Lock and upload or Deploy;
  the Manage tabs sit under the top bar, and Art stays reachable as a single quiet "Art" entry
  beside the tabs only while the art is deferred (unfinished art launched early). Setup history is
  not shown as a stepper.
- "Finish the art later" sits in the stepper row, right-aligned, only while the Art stage is shown.
- The "Sample data" chip is removed from the top bar; sample mode stays an environment flag only.

### Art

- Layers, first visit: no collection switcher on an empty project. Collections come from the
  uploaded folder structure (`project/collection/layer/trait.png`), as in the legacy app, and can
  be added later from Layers.
- The collection switcher is a dropdown (select), not a segmented control, so ten collections fit.
- The weights bar is one colour with hairline dividers between traits; hovering a segment names the
  trait and its share. No unexplained shades.
- Shuffle is a visible action on Generate ("Shuffle order", all or selected), and token ids can
  be randomised across collections after generation, as legacy allowed; numbering is continuous by
  default.
- Generate's conflict notice is one line, no stray punctuation.
- The Add rule dialog and the Statistics tab are shown in the preview.

### Lock and upload

- Review step: a prominent choice at the top, "Reveal at mint" or "Reveal later (placeholder)",
  instead of a switch below the fold.
- The fixed "checks the server runs" list is replaced by a summary of what will be locked plus
  options that vary per project: "Allow identical tokens" (off by default) and the maximum-count
  rule. Supply and rule checks stay implicit. No "one per id" wording.
- Rendering: no "latest rendered" thumbnails and no per-image status. Progress is coarse: batches
  done of total, then metadata upload, then done.

### Manage drop

- Overview header is compact: artwork, minted of supply, chain and contract, what the contract
  currently points at (placeholder or revealed CID), and the mint page link as a plain input with
  a check/save button, no "Set link" button.
- Tradability (transfer validator, lock) lives in Settings under an "Advanced" section, not on
  Overview.
- Phases: the per-phase supply allocation is editable in place (an "Edit supply" control on each
  row, with the minted floor), not hidden in a menu.

### Mint page

- Overlapping phases are easy to choose between. When more than one phase is open, the mint panel
  leads with a "Choose your phase" selector: one card per open phase with its name, price and this
  wallet's standing ("You are on this list, 2 left", "Not on this list", "Anyone, up to 3"). It
  opens on the cheapest phase the wallet can use, phases the wallet cannot use are shown disabled
  with the reason, and the mint button follows the selected phase.
