# Creator Flow and Mint Page UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Cobweb a finished, reviewable creator UI in five stages and a public mint page, running on typed sample data until the backends exist.

**Architecture:** A design foundation in `packages/ui` (tokens, restyled shadcn components, a few custom pieces) and a route skeleton under `apps/web/src/app/collections/[id]` are built first, in parallel, because every screen depends on both. Four screen groups are then built in parallel on top, each in its own component folder, rendering the typed sample data in `apps/web/src/lib/demo` with simulated transactions behind marked seams. A browser review closes the loop.

**Tech Stack:** Next.js 16 (App Router, server pages, client leaf components), React 19, Tailwind v4 with CSS tokens, shadcn (new-york) in `packages/ui`, `motion/react`, `@dnd-kit`, wagmi + RainbowKit for the wallet button, viem for address checks, Playwright MCP for review.

**Spec:** [../specs/2026-10-03-creator-flow-ui.md](../specs/2026-10-03-creator-flow-ui.md)

## Global Constraints

- Dark only; every colour from a token in `packages/ui/src/styles/globals.css`; no hex values in components.
- Palette family stays warm gray; accent `#fadc69` for primary action, live state and progress only; Poppins stays; Kingdomly crown logo stays.
- Copy: no "Kingdomly" or "realm", "Whitelist" is the term, no em or en dashes, no emoji.
- Every page under `/collections/[id]` calls `requireOwnedCollection(id)`; every server action uses `getVerifiedUser` and checks ownership.
- Liveness only from the data's `active` field; simulate before the wallet opens; no shared-state RPC from the mint page (`CLAUDE.md` rules 1 to 3).
- Sample data is deterministic: no `Math.random()` without a seed, no `Date.now()` at module load.
- Layer images: PNG, square, at most 2048 x 2048, same size across a project, 10 MB per file.
- Prettier: no semicolons, single quotes, 110 columns. Files under roughly 400 lines.
- Only the design foundation task installs dependencies; `legacy/` is never read for assets or copied.

## Review Focus

Inputs the spec implies but no task's tests exercise. Each is pinned to the task that owns it.

1. A whitelist CSV with Windows line endings, a BOM, or quoted fields: the parser must still find addresses and report bad lines by number (Task 5, step 4).
2. A collection whose real `max_supply` differs from the sample's 777: Deploy, Phases and Overview must not show minted counts above supply (Task 2, step 6).
3. A trait deleted while a rule references it: the rule must drop the trait or be removed, never dangle (Task 3, step 5).
4. A scheduled start entered in the past: Phases must warn and the chain-time comparison must use `blockTimestamp`, not the browser clock (Task 5, step 5).
5. The countdown reaching zero without the data saying `active`: the mint button stays disabled with "Starting, waiting for the chain" (Task 6, step 5).

---

### Task 1: Design foundation and shell restyle

**Files:**

- Modify: `packages/ui/src/styles/globals.css`, every file in `packages/ui/src/components/`
- Create: `packages/ui/src/components/{page-header,panel,stat,status-badge,artwork,motion}.tsx`, `packages/ui/src/lib/motion.ts`
- Modify: `apps/web/src/app/{layout,page,not-found}.tsx`, `apps/web/src/app/(dashboard)/**`, `apps/web/src/components/shell/{app-sidebar,dashboard-topbar,logo,small-screen}.tsx`, `apps/web/src/components/collections/**`
- Create: `apps/web/scripts/dev-wallet/{signer.mjs,inject.js,README.md}`, `docs/DESIGN.md`

**Interfaces:**

- Produces: `@cobweb/ui/components/<name>` for page-header, panel, stat, status-badge, artwork, motion and every shadcn component; `cn` from `@cobweb/ui/lib/utils`; tokens `background`, `card`, `surface-1..3`, `well`, `muted-foreground`, `faint`, `primary*`, `success*`, `warning*`, `destructive*`, `border`, `border-strong`; utilities `numeric`, `text-display`, `text-title`, `text-heading`, `text-caption`; `StatusBadge` variants draft, scheduled, live, closed, soldout, done, pending, error.

- [x] **Step 1: Install dependencies** (shadcn tabs, table, switch, slider, checkbox, popover, scroll-area, toggle, toggle-group, accordion, avatar, collapsible, radio-group, command, calendar, hover-card, alert, input-group, pagination, drawer; `motion`, `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`). Fix the CLI's `import { cn } from "cn"` to `@cobweb/ui/lib/utils` and remove the stray `cn` package.
- [x] **Step 2: Rework tokens** into a surface scale (`#161614`, `#1a1a18`, `#222220`, `#2a2a28`, `#343431`, well `#141413`), tinted lines and shadows, radius rule (10 / 12 / 16 px, chips round), type scale, Geist Mono through `next/font`.
- [x] **Step 3: Restyle every component** so none looks like default shadcn; keep the `Step`, `StepSeparator` and `ChoiceCard` APIs.
- [x] **Step 4: Add PageHeader, Panel, Stat, StatusBadge, Artwork (with cobweb fallback), Stagger and RiseIn.**
- [x] **Step 5: Restyle sign-in, dashboard, new-collection dialog, help and 404**; cards read the next stage from `nextStep()`.
- [x] **Step 6: Write the dev wallet** (signer on 127.0.0.1:8787, EIP-1193 provider announcing over EIP-6963) and `docs/DESIGN.md`.
- [x] **Step 7: Verify.** `pnpm --filter @cobweb/ui typecheck && pnpm --filter @cobweb/web typecheck && pnpm --filter @cobweb/web lint && pnpm --filter @cobweb/web build` pass; screenshots in `.playwright-mcp/design/`.

### Task 2: Flow restructure and sample data

**Files:**

- Modify: `apps/web/src/lib/steps.ts`, `apps/web/src/app/actions/collections.ts`, `apps/web/src/components/shell/{step-nav,collection-topbar}.tsx`
- Create: `apps/web/src/app/collections/[id]/{page,layout}.tsx`, `details/page.tsx`, `art/{page.tsx,layers,rules,generate,upload-assets}/page.tsx`, `upload/page.tsx`, `deploy/page.tsx`, `manage/{page.tsx,phases,whitelist,mint-page,airdrop,settings}/page.tsx`, `_lib/stage.tsx`
- Create: `apps/web/src/components/shell/{stage-footer,stage-locked,stage-page,manage-nav,screen-placeholder}.tsx`, `apps/web/src/components/details/details-form.tsx`, `apps/web/src/app/actions/collection-details.ts`, `apps/web/src/lib/collection-details.ts`
- Create: `apps/web/src/lib/demo/{index,types,art,data,helpers}.ts`, `apps/web/scripts/make-demo-art.mjs`, `apps/web/public/demo/**`
- Delete: `apps/web/src/app/collections/[id]/[step]/page.tsx`

**Interfaces:**

- Consumes: `Step`, `StepSeparator` from Task 1.
- Produces: `STAGES`, `ART_SUBSTEPS`, `MANAGE_TABS`, `stageHref(id, stage, projectType)`, `artSubStepHref`, `manageTabHref`, `isStageDone`, `nextStage` (alias `nextStep`), `stageAccess(status, stage, {demo})`, `isStageReadOnly`, `isDemoMode`, `frozenDetailFields(status)`, `flowNeighbours(id, projectType, path)`; `StagePage {eyebrow?, title, description?, actions?, sampleNotice?, width?, footer?, bodyHasFooter?}`, `StageFooter {previous?, next?, nextDisabled?, nextHint?, nextLabel?, children?}`, `StageLocked {collectionId, projectType, stage}`; every type in `lib/demo/types.ts` and the `DEMO_*` constants, `getRenderJob(state)`, `getMintPageData(slug, variant, {connected})`, `generateTokens`, `tokenLayerUrls(dna)`.

- [x] **Step 1: Rewrite `steps.ts`** with the five stages, art sub-steps by project type, manage tabs, hrefs, access rules and the status mapping (`draft` to art, `art_locked`/`rendering` to upload, `rendered` to deploy, `deployed` to manage).
- [x] **Step 2: Build the stage navigation** (five stages with done, current, next, locked; sub-step row inside Art; tabs inside Manage) and `StagePage`, `StageFooter`, `StageLocked`.
- [x] **Step 3: Create every route page** calling `requireOwnedCollection`, resolving access through `stageContext`, rendering a `ScreenPlaceholder` in a per-screen component file with typed props.
- [x] **Step 4: Build the Details form and action** with zod, `getVerifiedUser`, ownership, frozen fields mirroring `collections_guard_frozen_fields`, and handling of 23505 (taken slug) and 23514 (frozen field).
- [x] **Step 5: Write the sample data**: 7 layers, 6 rules with one conflict, 777 seeded tokens, render jobs in four states, six chains, a Base deployment, three mint groups, two whitelists with chunks, airdrops, activity, mint page settings and variants. Fixed `DEMO_NOW`.
- [x] **Step 6: Pin review focus 2.** Add `apps/web/src/lib/demo/data.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { DEMO_MINT_GROUPS, DEMO_TOTAL_MINTED, DEMO_COLLECTION, DEMO_AIRDROPS } from '@/lib/demo'

describe('sample supply accounting', () => {
  it('never shows more minted than the supply', () => {
    const minted = DEMO_MINT_GROUPS.reduce((sum, g) => sum + g.minted, 0)
    const airdropped = DEMO_AIRDROPS.reduce((sum, a) => sum + a.tokens, 0)
    expect(minted + airdropped).toBe(DEMO_TOTAL_MINTED)
    expect(DEMO_TOTAL_MINTED).toBeLessThanOrEqual(DEMO_COLLECTION.maxSupply)
  })
  it('allocates no more than the supply across groups', () => {
    const allocated = DEMO_MINT_GROUPS.reduce((sum, g) => sum + g.maxSupply, 0)
    expect(allocated).toBeLessThanOrEqual(DEMO_COLLECTION.maxSupply)
  })
})
```

Run: `pnpm --filter @cobweb/web test`. Expected: PASS. If `vitest` cannot resolve `@/`, add `resolve.alias` for `@` to `./src` in a `vitest.config.ts` beside `package.json`. Then make the screens clamp: in `components/manage/overview-parts.tsx`, `components/manage/supply-map.tsx` and `components/deploy/deploy-summary.tsx`, use `Math.min(minted, collection.max_supply)` wherever a sample count is drawn against the real row's supply, so a real collection with `max_supply` 100 never shows 238 of 100.

- [x] **Step 7: Generate the Night Owls art** with `node apps/web/scripts/make-demo-art.mjs` (44 layer SVGs, 24 token previews, banner, avatar) and check PNG renders by eye.
- [x] **Step 8: Verify.** `pnpm --filter @cobweb/web typecheck && pnpm lint` pass; `npx next typegen` after deleting the `[step]` route.

### Task 3: Art screens

**Files:**

- Modify: `apps/web/src/components/art/{layers,rules,generate,assets}-screen.tsx`
- Create: `apps/web/src/components/art/{composite,confirm-dialog,name-dialog,read-only-notice}.tsx`, `apps/web/src/components/art/{lib,state,layers,rules,generate,assets}/**`

**Interfaces:**

- Consumes: `Layer`, `Trait`, `ArtRule`, `RuleConflict`, `GeneratedToken`, `TraitCounts`, `UploadedAsset`, `generateTokens`, `tokenLayerUrls` from Task 2; `@dnd-kit` and `motion` from Task 1.
- Produces: an in-memory art store (`state/art-store.ts`) shared by the three generative screens within a session; `Seam:` comments where the Phase 3 backend plugs in.

- [x] **Step 1: Layers**: sortable layer list (pointer and keyboard), live composite with visibility toggles and Randomise, trait grid with weights, running total, Even out, fixed quantities, blank toggle, add traits with browser validation of PNG, squareness, 2048 cap, same size, 10 MB.
- [x] **Step 2: Rules**: sentence rows with trait chips, kind filter, add/edit dialog with duplicate detection, delete confirmation, conflicts panel with jump-to and in-list marking.
- [x] **Step 3: Generate**: seeded generation with progress, 48-per-page gallery, search, trait filter with counts, sort, rarity tiers, token detail with rule-checked trait change, swap, regenerate, delete, selection mode, statistics tab, footer disabled with reason until the set is full and valid.
- [x] **Step 4: Assets**: one screen adapting to single asset (one file, quantity up to 4,000), 1/1s (editions, attributes) and metadata (images plus JSON with the validation checklist).
- [x] **Step 5: Pin review focus 3.** Add `apps/web/src/components/art/state/layer-edits.test.ts` (both functions already exist in `layer-edits.ts`: `deleteTrait(layers, traitId): Layer[]` and `pruneRules(rules, traitIds: ReadonlySet<string>): ArtRule[]`):

```ts
import { describe, expect, it } from 'vitest'
import { DEMO_LAYERS, DEMO_RULES } from '@/lib/demo'
import { deleteTrait, pruneRules } from './layer-edits'

describe('deleting a trait that rules refer to', () => {
  const traitId = 'headwear-wizard-hat' // source of rule-wizard-starry, related in rule-starry-wizard
  it('removes the trait from its layer', () => {
    const layers = deleteTrait(DEMO_LAYERS, traitId)
    expect(layers.flatMap((l) => l.traits).some((t) => t.id === traitId)).toBe(false)
  })
  it('drops the trait from every rule and removes rules left with nothing to pair', () => {
    const rules = pruneRules(DEMO_RULES, new Set([traitId]))
    expect(rules.length).toBeLessThan(DEMO_RULES.length)
    for (const rule of rules) {
      expect(rule.traitId).not.toBe(traitId)
      expect(rule.relatedTraitIds).not.toContain(traitId)
      expect(rule.relatedTraitIds.length).toBeGreaterThan(0)
    }
  })
})
```

Run `pnpm --filter @cobweb/web test`. Expected: PASS. If `pruneRules` keeps a rule whose `relatedTraitIds` became empty, make it drop that rule.

- [x] **Step 6: Verify.** `pnpm --filter @cobweb/web typecheck && pnpm --filter @cobweb/web lint` pass; Prettier run.

### Task 4: Lock and upload, and Deploy

**Files:**

- Modify: `apps/web/src/components/upload/upload-screen.tsx`, `apps/web/src/components/deploy/deploy-screen.tsx`, `apps/web/src/app/collections/[id]/{upload,deploy}/page.tsx` (layout props only)
- Create: `apps/web/src/components/upload/{upload-flow,progression,review-step,pay-step,render-step,done-step}.tsx`, `upload-sim.ts`, `upload-shared.ts`; `apps/web/src/components/deploy/{deploy-flow,deploy-form,deploy-summary,deploy-dialog,deployed-view,tx-progress,copy-value}.tsx`, `deploy-sim.ts`

**Interfaces:**

- Consumes: `RenderJob`, `ArtFeeQuote`, `SupportedChain`, `FeeSnapshot`, `DeployDraft`, `Deployment`, `formatNative`, `shortAddress`, `explorerTxUrl` from Task 2.
- Produces: `TxProgress` and `CopyValue` (shared by both screens); query switches `?job=locked|payment_due|rendering|done`, `?state=deployed`, `?outcome=rejected|reverted|balance|check-failed|batch-failed|switch-rejected|fees-error`.

- [x] **Step 1: Upload** as a vertical progression with collapsing receipts: review and lock (confirmation, four checks), pay (quote, simulate, wallet, confirming, waiting for the verified event), rendering (batches, thumbnails, metadata phase, estimate, retry), done (CIDs with copy and gateway links).
- [x] **Step 2: Deploy** in two columns: chain cards, fixed name/symbol/supply, payout with `isAddress`, royalty slider plus bps, recipient switch, public limit; summary with predicted address, factory fees (skeleton while reading), cost, URIs; final-check dialog; chain switch, simulate, wallet, confirming; deployed view with next steps.
- [x] **Step 3: Verify.** typecheck and lint pass for both folders.

### Task 5: Manage drop

**Files:**

- Modify: `apps/web/src/components/manage/{overview,phases,whitelist,mint-page,airdrop,settings}-screen.tsx`, `apps/web/src/app/collections/[id]/manage/phases/page.tsx` (width only)
- Create: `apps/web/src/components/manage/{simulate.ts,use-transaction.ts,transaction-dialog.tsx,recipients.ts,recipients-input.tsx,bits.tsx,format.ts,overview-parts.tsx,mint-chart.tsx,supply-map.tsx,phase-row.tsx,phase-dialogs.tsx,phase-schedule.tsx,whitelist-model.ts,whitelist-table.tsx,whitelist-chunks.tsx,whitelist-dialogs.tsx,mint-page-fields.tsx,mint-page-preview.tsx,airdrop-parts.tsx,settings-dialogs.tsx}`

**Interfaces:**

- Consumes: `MintGroup`, `GroupWhitelist`, `WhitelistChunk`, `MintPageSettings`, `MintPageData`, `DropActivity`, `AirdropRecord`, `Deployment` from Task 2.
- Produces: `useTransaction` + `TransactionDialog` (checking, wallet, confirming, done, failure at any step, simulated wallet box with Approve / Reject / Approve then revert); `parseRecipients(text, { defaultAmount, maxAmount, onDuplicate: 'last' | 'sum', amountName })` in `recipients.ts` returning `{ rows: { address, amount, line }[], invalid: { line, text, reason }[], duplicates, header }`.

- [x] **Step 1: Overview** (supply meter by source, live phases, next scheduled with local time, CSS mints chart, proceeds, recent mints, setup checklist).
- [x] **Step 2: Phases** (supply strip with labelled, ordered segments; rows; Open, Close, Schedule, Clear, Edit price, Edit max supply with floor, Edit per-wallet limit, Add phase, Close all).
- [x] **Step 3: Whitelist, Mint page, Airdrop, Settings** as in the spec.
- [x] **Step 4: Pin review focus 1.** Add `apps/web/src/components/manage/recipients.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseRecipients } from './recipients'

const A = '0x3b9d2c1a0f8e7d6c5b4a39281706f5e4d3c2b1a0'
const B = '0x8ca1289c1e357588500cfea75b4c35039ed5bc8f'
const options = { defaultAmount: 1, maxAmount: 100, onDuplicate: 'last' as const, amountName: 'quota' }

describe('parseRecipients', () => {
  it('reads Windows line endings, a BOM, quoted fields and a header row', () => {
    const text = `\uFEFFaddress,quota\r\n"${A}",2\r\n${B},1\r\n`
    const result = parseRecipients(text, options)
    expect(result.header).toBe(true)
    expect(result.rows.map((r) => r.amount)).toEqual([2, 1])
    expect(result.invalid).toEqual([])
  })
  it('reports a bad address by its line number', () => {
    const text = `${A},1\nnot-an-address,1\n`
    const result = parseRecipients(text, options)
    expect(result.rows).toHaveLength(1)
    expect(result.invalid[0]?.line).toBe(2)
  })
})
```

`ParseResult` is `{ rows: { address, amount, line }[], invalid: { line, text, reason }[], duplicates, header }`. Run: `pnpm --filter @cobweb/web test`. If the BOM or `\r` case fails, strip a leading `\uFEFF` and split on `/\r?\n/` in `parseRecipients`, and unquote fields with `.replace(/^"(.*)"$/, '$1')` before the address check. Expected: PASS.

- [x] **Step 5: Pin review focus 4.** The past-start check lives inline in `phase-schedule.tsx` (`unix !== null && unix <= blockTimestamp`, around line 130). Extract it into a pure function in a new `apps/web/src/components/manage/schedule-logic.ts` and call it from the component:

```ts
/** Why a start time cannot be used, judged against the chain's clock, never the browser's. Null when fine. */
export function scheduleWarning(startUnix: number | null, blockTimestamp: number): string | null {
  if (startUnix === null) return null
  if (startUnix <= blockTimestamp)
    return 'That time has already passed on chain. Pick a later time or use Open now.'
  return null
}
```

Then add `apps/web/src/components/manage/schedule-logic.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { scheduleWarning } from './schedule-logic'

describe('scheduleWarning', () => {
  it('warns from chain time, not the browser clock', () => {
    const blockTimestamp = 1_790_000_000
    expect(scheduleWarning(blockTimestamp - 60, blockTimestamp)).toMatch(/already passed/i)
    expect(scheduleWarning(blockTimestamp + 60, blockTimestamp)).toBeNull()
    expect(scheduleWarning(null, blockTimestamp)).toBeNull()
  })
})
```

Run `pnpm --filter @cobweb/web test`. Expected: PASS. Then `pnpm --filter @cobweb/web typecheck`.

- [x] **Step 6: Verify.** typecheck and lint pass; supply strip segments are labelled, the mint page preview does not clip, and the chart emphasises the busiest hour.

### Task 6: Public mint page

**Files:**

- Create: `apps/web/src/app/[slug]/{page,loading,not-found}.tsx`, `apps/web/src/app/[slug]/sample-data.ts`
- Create: `apps/web/src/components/mint/{model.ts,format.ts,use-chain-clock.ts,types.ts,mint-transaction.ts,use-mint-flow.ts,mint-context.tsx,mint-page.tsx,mint-top-bar.tsx,wallet-button.tsx,art-stage.tsx,mint-panel.tsx,panel-controls.tsx,mint-action.tsx,countdown.tsx,phase-list.tsx,mint-flow-dialog.tsx,mint-success.tsx,sticky-mint-bar.tsx,collection-sections.tsx,token-image.tsx,copy-button.tsx,mint-page-skeleton.tsx}`

**Interfaces:**

- Consumes: `MintPageData`, `WalletState`, `MintGroup`, `getMintPageData`, `MINT_PAGE_VARIANTS`, `tokenLayerUrls` from Task 2; `isDemoMode` from `@/lib/steps`; `RESERVED_SLUGS` from `@/lib/collections`.
- Produces: query switches `?state=`, `?wallet=connected|not-listed|limit|wrong-chain`, `?fail=`, `?degraded=1`, `?start=<seconds>`; `mint-transaction.ts` as the Phase 6 seam (`simulateContract` with `batchMint` or `delegateMint`, then `writeContract`, then the receipt).

- [x] **Step 1: Page and data source**: server page with metadata and Open Graph, `sample-data.ts` resolving the sample collection in sample mode and `notFound()` otherwise.
- [x] **Step 2: Hero, panel, phases, below-the-fold** as in spec 4.7, with the button label rules and yellow only when pressing does something.
- [x] **Step 3: Mint flow** dialog (bottom sheet on phones) with success reveal and every failure state.
- [x] **Step 4: Phone layout** with sticky mint bar; 14 px root font under 640 px on this page.
- [x] **Step 5: Pin review focus 5.** Add `apps/web/src/components/mint/model.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { getMintPageData } from '@/lib/demo'
import { deriveAction, derivePhases } from './model'

describe('deriveAction', () => {
  it('stays blocked when the countdown has passed but the chain has not reported the phase live', () => {
    const data = getMintPageData('night-owls', 'upcoming', { connected: true })
    const group = data.groups.find((g) => g.scheduledStart > 0)!
    const chainNow = group.scheduledStart + 5 // past the start, but every group.active is still false
    const phase = derivePhases(data, data.wallet, chainNow).find((p) => p.group.id === group.id)!
    expect(phase.status).toBe('starting')
    const action = deriveAction({
      data,
      phase,
      connected: true,
      wrongChain: false,
      quantity: 1,
      vault: null,
      soldOut: false,
    })
    expect(action.kind).toBe('blocked')
    expect(action.label).toBe('Starting, waiting for the chain')
  })
})
```

`derivePhases(data, wallet, chainNow)` and `deriveAction(input)` already exist in `model.ts`; `MintAction.kind` is `connect | switch | mint | blocked`, and only `mint` and `switch` enable the button. Run `pnpm --filter @cobweb/web test`. Expected: PASS.

- [x] **Step 6: Verify** in a browser at 1440 and 390 for every state; typecheck and lint pass.

### Task 7: Browser review

- [x] **Step 1: Capture every screen** with the dev wallet signed in (screenshots in `.playwright-mcp/review/` and `.playwright-mcp/preview2/`).
- [x] **Step 2: Check and fix** in the owning component: no hydration errors in the console (no block element inside `<p>`, as in `rule-row.tsx`); "Whitelist", never "Allowlist", in visible copy (`phase-list.tsx`, `mint-panel.tsx`, `deployed-view.tsx`); any well-formed slug resolves to the sample mint page in sample mode (`sample-data.ts`); supply strip labels; mint page preview clipping; chart emphasis.
- [x] **Step 3: Verify.** `pnpm typecheck && pnpm lint && pnpm --filter @cobweb/web lint && pnpm --filter @cobweb/web build` pass; publish a preview.

### Task 8: Re-run the local access checks

**Files:**

- Run only: `apps/web/scripts/verify-local.ts`

- [ ] **Step 1: Start Supabase.** `supabase start` from the repo root (ports 5532x; never touch the 5432x project).
- [ ] **Step 2: Run the checks.** `pnpm --filter @cobweb/web verify:local`. Expected: all checks pass.
- [ ] **Step 3: If a check fails because of the `updateCollectionDetails` action**, read the failing check's message, fix the action in `apps/web/src/app/actions/collection-details.ts` (not the policy), and re-run.
- [ ] **Step 4: Stop Supabase.** `supabase stop`. Tick the matching line in the spec's acceptance criteria.

### Task 9: Tablet-width check of the creator screens

**Files:**

- Read: `apps/web/src/components/{art,upload,deploy,manage}/**`

- [ ] **Step 1: Start services**: `supabase start`, `node apps/web/scripts/dev-wallet/signer.mjs` (background), `pnpm --filter @cobweb/web dev`.
- [ ] **Step 2: Sign in and capture** at 768 x 1024 and 1024 x 768 with Playwright (`page.addInitScript({ path: '<repo>/apps/web/scripts/dev-wallet/inject.js' })`, Connect wallet, Dev Wallet, Sign in as), every route in spec section 3, to `.playwright-mcp/tablet/`.
- [ ] **Step 3: Look at each screenshot** for clipped text, overlapping sticky footers, tables without horizontal scroll, and the Layers side-by-side layout between 640 and 1023 px.
- [ ] **Step 4: Fix** each finding in the owning component; re-capture; `pnpm --filter @cobweb/web typecheck && pnpm --filter @cobweb/web lint`.
- [ ] **Step 5: Stop services** and tick the acceptance line.

### Task 10: Upload assets screen in a browser

- [ ] **Step 1: With services running (Task 9 step 1)**, create three collections through the dialog: type 1/1s, type Metadata, type Single asset.
- [ ] **Step 2: Open `/collections/[id]/art/upload-assets`** for each and capture at 1440 x 900 to `.playwright-mcp/assets/`.
- [ ] **Step 3: Try the validation**: drop a non-PNG, a non-square PNG, and for Metadata a JSON whose `name` number does not match its file; each must show a per-file error and the checklist must mark the failed rule.
- [ ] **Step 4: Fix findings** in `apps/web/src/components/art/assets/**`; typecheck and lint; tick the acceptance line.

### Task 11: Land the work

- [ ] **Step 1: Commit** in logical commits (foundation, flow and sample data, art, upload and deploy, manage, mint page, browser review), each ending with the attribution lines in use for this repo.
- [ ] **Step 2: Open pull requests** into `main` in dependency order: contracts, then the web shell, then the creator flow UI. `gh` is not installed on this machine; open them on GitHub.
- [ ] **Step 3: Watch CI** (`.github/workflows/ci.yml`: node job and contracts job) and fix any failure before merging.
- [ ] **Step 4: After merge**, point the Phase 3 plan at `docs/specs/2026-10-03-creator-flow-ui.md` section 5 as the data contract to implement.
