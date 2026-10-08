# Art Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Load the Art screens from the art tables and write every edit back as the creator makes it, so a reload shows the same project and the lock step finds the finished set in the database, while sample mode keeps working without a write.

**Architecture:** A pure module, `apps/web/src/lib/art/rows.ts`, turns the art rows into the browser store's `ArtProject` and back. One migration adds the database functions for edits that span statements, checked by a new `verify:local` section 9f. Server actions under `apps/web/src/app/actions/art/` validate with zod, check ownership through the shared `ownedUnlocked` (moved to `apps/web/src/lib/art/owned.ts`) and map SQLSTATEs to sentences. In the browser a pure `ArtSyncQueue` applies each store edit at once, saves it through its action in one promise chain per collection, rolls back on failure and saves nothing in sample mode; a thin `ArtSyncProvider` in the Art layout hosts it, and the existing hooks keep their pure edit logic and call it. The pages load the rows on the server and seed the store.

**Tech Stack:** Next 16 app router (server components, server actions, `cache` from React), React 19 client components with `useSyncExternalStore`, Supabase Postgres 15 with row-level security and PL/pgSQL functions (`security invoker`), `supabase gen types typescript --local`, zod 4, sonner toasts, Vitest 5 in the Node environment (no jsdom; React is never rendered in a test), the existing `verify-local.ts` access-check script.

**Spec:** [../specs/2026-10-08-art-wiring.md](../specs/2026-10-08-art-wiring.md)

## Global Constraints

- The spec is the binding authority. Where this plan decides a detail the spec leaves open, the task says so in a line that starts with "Decision:".
- Every Art server action calls `ownedUnlocked(collectionId)` (which calls `getVerifiedUser`), validates its input with zod, returns `ActionResult<T>` (`{ ok: true; data: T } | { ok: false; error: string }`) and never calls `revalidatePath` (the browser store is the client view).
- Decision: every Art action takes the Cobweb collection id as its first argument (the spec's table leaves it out), because `ownedUnlocked` needs it and every database function takes it first.
- SQLSTATE mapping (spec section 6): `42501` with message `collection not found` becomes "This collection could not be found."; any other `42501` becomes "The art is locked and cannot change."; `23514` and `23505` pass through when the message is a guard sentence, a message ending "Clear the tokens first." becomes "Clear the generated tokens first, then change the layers.", and everything else becomes "That change could not be saved. Reload the page and try again."
- A write that throws in the browser rolls back with "That change could not be saved. Try again."
- Database functions: `language plpgsql`, `security invoker`, `set search_path = ''`, the collection id first in the signature, `revoke all ... from public, anon` then `grant execute ... to authenticated`; each locks the caller's own `collections` row with `owner_id = (select auth.uid())` in the predicate, raises `collection not found` with errcode `42501` when nothing matched, and refuses a locked project with "The art is locked and cannot change." (`42501`). Whole-set saves delete then insert; positions are closed up after deletes; token renumbering is one set-based statement under the deferrable primary key.
- Weight edits are debounced 250 ms per layer and sent as the layer's whole table; asset edits are debounced 250 ms per item; size and token text edits use the same 250 ms debounce per key.
- Sample mode (`NEXT_PUBLIC_DEMO_DATA=1`) seeds the store from `lib/demo` and persists nothing. Real mode seeds from rows; an empty project is empty, not sample.
- After adding or changing a migration: `supabase db reset`, then `supabase seed buckets`, then `pnpm --filter @cobweb/web verify:local`. Never run any of this against anything but localhost.
- Implementers never use `rm` and never use `git commit --amend`. To drop a tracked file use `git rm`; to fix a commit, make a new one.
- Code style: Prettier (no semicolons, single quotes, 110 columns), TypeScript strict with `noUncheckedIndexedAccess` and `verbatimModuleSyntax` (type-only imports use `import type`). SQL is hand-formatted, two-space indent.
- Copy: plain sentences, no em or en dashes, "Whitelist" never "Allowlist", the product is Cobweb. UI from `@cobweb/ui` components only; colours from tokens.
- `'use server'` files export async functions only; types and constants live in `apps/web/src/lib/art/`.
- Commit messages are one imperative sentence with no prefix, and end with exactly these two lines:

```
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011bcHX4HZG5YGWhxjGuiWos
```

- `legacy/` is reference only: never import from it.
- Tests: `pnpm --filter @cobweb/web exec vitest run <file>` for one file; `pnpm typecheck && pnpm lint && pnpm test` at the root before every commit.

## Review Focus

Inputs the spec implies but no task's tests would otherwise exercise, most likely to bite first. Each is pinned to the task that owns it, with its test written there.

1. A project with more than 1,000 traits or tokens: PostgREST returns at most 1,000 rows per request (`supabase/config.toml` `max_rows`), so a single read silently loads a truncated set and the next save would overwrite the database with it. Expected: every row loads. Pinned by the `readAll` paging test in Task 7, step 1.
2. A weight, size or name typed and the Art stage left within 250 ms: the debounced save must still be sent, not dropped with the timer. Expected: leaving flushes what is waiting. Pinned by the `KeyedDebounce.flush` test in Task 4, step 1 and the provider's unmount flush in Task 4, step 3.
3. A folder whose collection or layer folder name is longer than 48 characters, or an image file name longer than 64: the database would refuse the whole import. Expected: names are clipped to the column limits and the import goes through. Pinned by the `importPayload` test in Task 5, step 1.
4. Editions or attributes changed on a 1/1 file while it is still uploading: the item has no `uploads` row yet, so the edit has nowhere to go. Expected: the edit stays on screen and is written as soon as the row exists. Pinned by the `needsDetails` test in Task 8, step 1.
5. Collection sizes that add up to more than 100,000 tokens (`MAX_SUPPLY`; each art collection is capped at 10,000 by the engine, so several collections can pass 10,000 legitimately): `art_save_tokens` refuses more than 100,000 rows, so the set would generate on screen and then fail to save. Expected: Generate refuses before rolling, with a sentence that says what to change. Pinned by the `saveLimitProblem` test in Task 3, step 1 and its use in `generate` in Task 6, step 5.

---

### Task 1: Rows to the store and back, the shared owner check and the result type

**Files:**

- Create: `apps/web/src/lib/art/result.ts`, `apps/web/src/lib/art/owned.ts`, `apps/web/src/lib/art/rows.ts`
- Test: `apps/web/src/lib/art/rows.test.ts`
- Modify: `apps/web/src/app/actions/uploads.ts:1-43` (use the shared `ownedUnlocked` and sentences)
- Modify: `packages/dna/src/types.ts` (`Trait.thumbnailUrl`)
- Modify: `apps/web/src/components/art/state/art-store.ts` (`ArtProject.atLeastOne`, comments)

**Interfaces:**

- Consumes: `finalise(tokens: Draft[], ctx: SetContext): GeneratedToken[]` and `type Draft` from `apps/web/src/components/art/state/generation.ts`; `buildTraitIndex` from `apps/web/src/components/art/lib/trait-index.ts`; `servedUrl(id: string, variant?: 'thumb'): string` from `apps/web/src/lib/storage/uploads-service.ts`; `getVerifiedUser` from `apps/web/src/lib/auth.ts`; `createClient` from `apps/web/src/lib/supabase/server.ts`; `type Canvas` from `apps/web/src/lib/storage/admission.ts`.
- Produces:
  - `result.ts`: `type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string }`; `done: ActionResult`; `fail(error: string): { ok: false; error: string }`; sentences `SIGNED_OUT`, `NOT_FOUND`, `LOCKED`, `UNSAVED`, `THROWN`, `CLEAR_FIRST`, `IMPORT_REFUSED`, `TRAIT_CAP`, `DNA_MISMATCH`, `SAVE_CAP`, `UPLOAD_CAP`.
  - `owned.ts` (server only): `type ArtClient`; `type OwnedCollection`; `type Owned = { error: string } | { error?: undefined; supabase: ArtClient; canvas: Canvas; collection: OwnedCollection }`; `ownedUnlocked(collectionId: string): Promise<Owned>`.
  - `rows.ts` (pure): `type ArtRows`; `toProject(rows: ArtRows): ArtProject`; `toTrait(row: ArtRows['traits'][number]): Trait`; `ruleKindFromDb(kind: Enums<'rule_kind'>): RuleKind`; `ruleKindToDb(kind: RuleKind): Enums<'rule_kind'>`; `type WeightRow = { traitId: string; weight: number; constant: number | null }`; `weightRows(layer: Layer): WeightRow[]`.
  - `ArtProject.atLeastOne?: AtLeastOne[]`; `Trait.thumbnailUrl?: string`.

- [ ] **Step 1: Write the failing test**

`apps/web/src/lib/art/rows.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { Layer } from '@/lib/demo'
import { ruleKindFromDb, ruleKindToDb, toProject, weightRows, type ArtRows } from './rows'

const collection: ArtRows['collection'] = {
  name: 'Night Owls',
  token_name: null,
  token_description: '',
  show_blank_traits: false,
  generation_seed: null,
  canvas_width: null,
  canvas_height: null,
}

const empty: ArtRows = {
  collection,
  artCollections: [],
  layers: [],
  traits: [],
  rules: [],
  atLeastOne: [],
  tokens: [],
}

const rows: ArtRows = {
  collection: {
    ...collection,
    token_name: 'Owl',
    token_description: 'A night owl.',
    show_blank_traits: true,
    generation_seed: 42,
    canvas_width: 1000,
    canvas_height: 1000,
  },
  artCollections: [
    { id: 'art-2', name: 'Owlets', size: 1, position: 1 },
    { id: 'art-1', name: 'Owls', size: 2, position: 0 },
  ],
  layers: [
    {
      id: 'eyes',
      art_collection_id: 'art-1',
      name: 'Eyes',
      display_name: 'Gaze',
      position: 1,
      bypass_dna: false,
    },
    {
      id: 'bg',
      art_collection_id: 'art-1',
      name: 'Background',
      display_name: null,
      position: 0,
      bypass_dna: true,
    },
  ],
  traits: [
    {
      id: 'wide',
      layer_id: 'eyes',
      name: 'Wide',
      weight: 60,
      constant: null,
      blank: false,
      in_metadata: true,
      upload_id: 'up-wide',
      position: 0,
    },
    {
      id: 'none',
      layer_id: 'eyes',
      name: 'None',
      weight: 40,
      constant: null,
      blank: true,
      in_metadata: false,
      upload_id: null,
      position: 1,
    },
    {
      id: 'ink',
      layer_id: 'bg',
      name: 'Ink',
      weight: 0,
      constant: 3,
      blank: false,
      in_metadata: true,
      upload_id: 'up-ink',
      position: 0,
    },
  ],
  rules: [
    {
      id: 'rule-1',
      kind: 'doesnt_mix_with',
      trait_id: 'ink',
      related_trait_ids: ['wide'],
      bidirectional: true,
    },
  ],
  atLeastOne: [{ id: 'group-1', art_collection_id: 'art-1', trait_ids: ['wide', 'ink'] }],
  tokens: [
    { token_id: 2, art_collection_id: 'art-1', dna: ['ink', 'none'], description: null },
    { token_id: 1, art_collection_id: 'art-1', dna: ['ink', 'wide'], description: 'First.' },
  ],
}

describe('toProject', () => {
  it('orders art collections and layers by position and makes the first collection active', () => {
    const project = toProject(rows)
    expect(project.collections).toEqual([
      { id: 'art-1', name: 'Owls', size: 2 },
      { id: 'art-2', name: 'Owlets', size: 1 },
    ])
    expect(project.activeCollectionId).toBe('art-1')
    expect(project.layers!.map((layer) => [layer.id, layer.position])).toEqual([
      ['bg', 0],
      ['eyes', 1],
    ])
    expect(project.layers![0]!.bypassDna).toBe(true)
    expect(project.layers![1]!.displayName).toBe('Gaze')
  })

  it('serves images through the app, keeps the blank first and maps in_metadata and constants', () => {
    const eyes = toProject(rows).layers![1]!
    expect(eyes.traits.map((trait) => trait.id)).toEqual(['none', 'wide'])
    expect(eyes.traits[0]).toEqual({
      id: 'none',
      layerId: 'eyes',
      name: 'None',
      weight: 40,
      blank: true,
      imageUrl: null,
      metadata: false,
    })
    expect(eyes.traits[1]).toEqual({
      id: 'wide',
      layerId: 'eyes',
      name: 'Wide',
      weight: 60,
      blank: false,
      imageUrl: '/api/uploads/up-wide',
      thumbnailUrl: '/api/uploads/up-wide?variant=thumb',
      uploadId: 'up-wide',
    })
    expect(toProject(rows).layers![0]!.traits[0]!.constant).toBe(3)
  })

  it('maps rule kinds to the sentences the screens use, and groups to their collection', () => {
    const project = toProject(rows)
    expect(project.rules).toEqual([
      {
        id: 'rule-1',
        kind: "doesn't mix with",
        traitId: 'ink',
        relatedTraitIds: ['wide'],
        bidirectional: true,
      },
    ])
    expect(project.atLeastOne).toEqual([{ id: 'group-1', collectionId: 'art-1', traitIds: ['wide', 'ink'] }])
  })

  it('names tokens "<token name> #<id>", ranks them, and falls back to the project description', () => {
    const tokens = toProject(rows).tokens!
    expect(tokens.map((token) => token.id)).toEqual([1, 2])
    expect(tokens.map((token) => token.name)).toEqual(['Owl #1', 'Owl #2'])
    expect(tokens.map((token) => token.description)).toEqual(['First.', 'A night owl.'])
    expect(tokens.map((token) => token.rank).sort()).toEqual([1, 2])
    expect(tokens.every((token) => token.previewUrl === null)).toBe(true)
  })

  it('carries the settings: seed, canvas, token name and description, blank traits', () => {
    const project = toProject(rows)
    expect(project.seed).toBe(42)
    expect(project.canvas).toEqual({ width: 1000, height: 1000 })
    expect(project.tokenName).toBe('Owl')
    expect(project.tokenDescription).toBe('A night owl.')
    expect(project.showBlankTraits).toBe(true)
    expect(project.staleNote).toBeNull()
  })

  it('loads an empty project as empty: no tokens, no canvas, no token name yet', () => {
    const project = toProject(empty)
    expect(project.collections).toEqual([])
    expect(project.layers).toEqual([])
    expect(project.rules).toEqual([])
    expect(project.atLeastOne).toEqual([])
    expect(project.tokens).toBeNull()
    expect(project.canvas).toBeNull()
    expect(project.activeCollectionId).toBeUndefined()
    expect(project.tokenName).toBeUndefined()
    expect(project.tokenDescription).toBeUndefined()
    expect(project.seed).toBe(0x0a7115)
  })
})

describe('the inverse pieces', () => {
  it('round-trips every rule kind', () => {
    for (const kind of ['doesnt_mix_with', 'always_pairs_with', 'must_pair_with'] as const)
      expect(ruleKindToDb(ruleKindFromDb(kind))).toBe(kind)
  })

  it('sends the whole weight table, the blank included, with a constant forcing 0', () => {
    const layer: Layer = {
      id: 'eyes',
      collectionId: 'art-1',
      name: 'Eyes',
      position: 0,
      traits: [
        { id: 'none', layerId: 'eyes', name: 'None', weight: 10, blank: true, imageUrl: null },
        { id: 'wide', layerId: 'eyes', name: 'Wide', weight: 90, blank: false, imageUrl: '/w.png' },
        {
          id: 'rare',
          layerId: 'eyes',
          name: 'Rare',
          weight: 5,
          constant: 3,
          blank: false,
          imageUrl: '/r.png',
        },
      ],
    }
    expect(weightRows(layer)).toEqual([
      { traitId: 'none', weight: 10, constant: null },
      { traitId: 'wide', weight: 90, constant: null },
      { traitId: 'rare', weight: 0, constant: 3 },
    ])
  })
})
```

- [ ] **Step 2: Run, expect failure**

Run: `pnpm --filter @cobweb/web exec vitest run src/lib/art/rows.test.ts`
Expected: FAIL, `Failed to resolve import "./rows"`.

- [ ] **Step 3: Implement**

`packages/dna/src/types.ts`, in `Trait` after `uploadId`:

```ts
  /** A small preview of `imageUrl` for grids and chips, once the image is stored. The full image is the fallback. */
  thumbnailUrl?: string
```

`apps/web/src/components/art/state/art-store.ts`:

- Change the type import to `import type { ArtRule, AtLeastOne, Collection, GeneratedToken, Layer } from '@/lib/demo'`.
- In `ArtProject`, after `rules?: ArtRule[]` add:

```ts
  /** Every token of a collection carries one of these traits. Loaded and honoured by generation; no screen edits them yet. */
  atLeastOne?: AtLeastOne[]
```

- Replace the doc comment's paragraph "Seam: this whole module is replaced by the art tables and server actions (Phase 3). Each `update` call below becomes a server action; the screens already treat it as the only writer." with "The pages seed it from the art tables (`lib/art/rows.ts`); every edit goes through `useArtSync()` (`art-sync.tsx`), which saves it with a server action unless the page is in sample mode."
- In the `showBlankTraits` comment replace "Seam: stored on the project and read by the render job at lock (Phase 4)." with "Stored as `collections.show_blank_traits`; the render job reads it at lock (Phase 4)."

`apps/web/src/lib/art/result.ts`:

```ts
/**
 * What every Art server action returns, and the sentences the Art screens show when a write fails
 * (docs/specs/2026-10-08-art-wiring.md, sections 5 to 7). Pure, so the browser, the actions and the
 * tests share it.
 */
export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string }

export const done: ActionResult = { ok: true, data: undefined }

export function fail(error: string): { ok: false; error: string } {
  return { ok: false, error }
}

export const SIGNED_OUT = 'Your session has ended. Sign in again to continue.'
export const NOT_FOUND = 'This collection could not be found.'
export const LOCKED = 'The art is locked and cannot change.'
export const UNSAVED = 'That change could not be saved. Reload the page and try again.'
export const THROWN = 'That change could not be saved. Try again.'
export const CLEAR_FIRST = 'Clear the generated tokens first, then change the layers.'
export const IMPORT_REFUSED = 'This collection already has layers. Start over to replace them.'
export const TRAIT_CAP = 'A layer can have at most 500 traits.'
export const DNA_MISMATCH = 'Token DNA does not match the layers.'
export const SAVE_CAP = 'A project can have at most 100,000 tokens.'
export const UPLOAD_CAP = 'This project has reached its 5 GB of files. Delete some files to upload more.'
```

`apps/web/src/lib/art/owned.ts`:

```ts
import 'server-only'
import { getVerifiedUser } from '@/lib/auth'
import type { Tables } from '@/lib/database.types'
import type { Canvas } from '@/lib/storage/admission'
import { createClient } from '@/lib/supabase/server'
import { LOCKED, NOT_FOUND, SIGNED_OUT } from './result'

export type ArtClient = Awaited<ReturnType<typeof createClient>>

/** The collection columns an Art action may need besides ownership. */
export type OwnedCollection = Pick<
  Tables<'collections'>,
  | 'id'
  | 'project_type'
  | 'token_name'
  | 'token_description'
  | 'show_blank_traits'
  | 'generation_seed'
  | 'art_deferred'
>

export type Owned =
  { error: string } | { error?: undefined; supabase: ArtClient; canvas: Canvas; collection: OwnedCollection }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * The collection, only if the signed-in creator owns it and its art is not locked. The session is
 * confirmed with the auth server, the row is read under row-level security, and the explicit owner
 * test is a second line of defence. The database checks both again on every write.
 */
export async function ownedUnlocked(collectionId: string): Promise<Owned> {
  const user = await getVerifiedUser()
  if (!user) return { error: SIGNED_OUT }
  if (!UUID.test(collectionId)) return { error: NOT_FOUND }
  const supabase = await createClient()
  const { data } = await supabase
    .from('collections')
    .select(
      'id, owner_id, art_locked_at, canvas_width, canvas_height, project_type, token_name, token_description, show_blank_traits, generation_seed, art_deferred',
    )
    .eq('id', collectionId)
    .maybeSingle()
  if (!data || data.owner_id !== user.id) return { error: NOT_FOUND }
  if (data.art_locked_at) return { error: LOCKED }
  const canvas =
    data.canvas_width && data.canvas_height ? { width: data.canvas_width, height: data.canvas_height } : null
  const collection: OwnedCollection = {
    id: data.id,
    project_type: data.project_type,
    token_name: data.token_name,
    token_description: data.token_description,
    show_blank_traits: data.show_blank_traits,
    generation_seed: data.generation_seed,
    art_deferred: data.art_deferred,
  }
  return { supabase, canvas, collection }
}
```

`apps/web/src/app/actions/uploads.ts`: delete lines 18 to 43 (the sentence constants `SIGNED_OUT`, `NOT_FOUND`, `LOCKED` and the local `ownedUnlocked`, which moved), and make the imports at the top:

```ts
'use server'

import { getVerifiedUser } from '@/lib/auth'
import { ownedUnlocked } from '@/lib/art/owned'
import { LOCKED, NOT_FOUND, SIGNED_OUT } from '@/lib/art/result'
import { createClient } from '@/lib/supabase/server'
import { admissionProblem, capProblem } from '@/lib/storage/admission'
import { mediaTypeFor, storageKey } from '@/lib/storage/keys'
import { deleteObjects, headObject, presignPut } from '@/lib/storage/objects'
import {
  admissionInputProblem,
  toRecord,
  type AdmitInput,
  type AdmitResult,
  type ConfirmInput,
  type UploadRecord,
  type UploadRow,
} from '@/lib/storage/uploads-service'
```

Keep `ROW_COLUMNS` and everything below it as it is; `ctx.error !== undefined` and `const { supabase, canvas } = ctx` keep working because `Owned` only adds `collection`.

`apps/web/src/lib/art/rows.ts`:

```ts
import type { ArtProject } from '@/components/art/state/art-store'
import { finalise, type Draft } from '@/components/art/state/generation'
import { buildTraitIndex } from '@/components/art/lib/trait-index'
import type { Enums, Tables } from '@/lib/database.types'
import type { ArtRule, AtLeastOne, Layer, RuleKind, Trait } from '@/lib/demo'
import { servedUrl } from '@/lib/storage/uploads-service'

/**
 * The art rows and the browser store's project, both ways (docs/specs/2026-10-08-art-wiring.md,
 * section 4). Pure: the pages map rows on the server, the hooks build action inputs in the browser.
 * Ids are the database uuids; names and ranks are computed here, never stored.
 *
 * Only types come from art-store.ts (a client module); a value import from it into a server
 * component would arrive as a client reference.
 */
export type ArtRows = {
  collection: Pick<
    Tables<'collections'>,
    | 'name'
    | 'token_name'
    | 'token_description'
    | 'show_blank_traits'
    | 'generation_seed'
    | 'canvas_width'
    | 'canvas_height'
  >
  artCollections: Pick<Tables<'art_collections'>, 'id' | 'name' | 'size' | 'position'>[]
  layers: Pick<
    Tables<'layers'>,
    'id' | 'art_collection_id' | 'name' | 'display_name' | 'position' | 'bypass_dna'
  >[]
  traits: Pick<
    Tables<'traits'>,
    'id' | 'layer_id' | 'name' | 'weight' | 'constant' | 'blank' | 'in_metadata' | 'upload_id' | 'position'
  >[]
  rules: Pick<Tables<'rules'>, 'id' | 'kind' | 'trait_id' | 'related_trait_ids' | 'bidirectional'>[]
  atLeastOne: Pick<Tables<'at_least_one'>, 'id' | 'art_collection_id' | 'trait_ids'>[]
  tokens: Pick<Tables<'tokens'>, 'token_id' | 'art_collection_id' | 'dna' | 'description'>[]
}

/** The store's seed before the first generation (`fromSeed` in art-store.ts). */
const UNSET_SEED = 0x0a7115

const KIND_FROM_DB: Record<Enums<'rule_kind'>, RuleKind> = {
  doesnt_mix_with: "doesn't mix with",
  always_pairs_with: 'always pairs with',
  must_pair_with: 'must pair with',
}

const KIND_TO_DB: Record<RuleKind, Enums<'rule_kind'>> = {
  "doesn't mix with": 'doesnt_mix_with',
  'always pairs with': 'always_pairs_with',
  'must pair with': 'must_pair_with',
}

export function ruleKindFromDb(kind: Enums<'rule_kind'>): RuleKind {
  return KIND_FROM_DB[kind]
}

export function ruleKindToDb(kind: RuleKind): Enums<'rule_kind'> {
  return KIND_TO_DB[kind]
}

/** A trait row as the screens show it: images served through the app, the thumbnail for grids. */
export function toTrait(row: ArtRows['traits'][number]): Trait {
  return {
    id: row.id,
    layerId: row.layer_id,
    name: row.name,
    weight: Number(row.weight),
    ...(row.constant === null ? {} : { constant: row.constant }),
    blank: row.blank,
    imageUrl: row.upload_id ? servedUrl(row.upload_id) : null,
    ...(row.upload_id ? { thumbnailUrl: servedUrl(row.upload_id, 'thumb'), uploadId: row.upload_id } : {}),
    ...(row.in_metadata ? {} : { metadata: false as const }),
  }
}

export function toProject(rows: ArtRows): ArtProject {
  const { collection } = rows
  const artCollections = [...rows.artCollections].sort((a, b) => a.position - b.position)
  const order = new Map(artCollections.map((art, index) => [art.id, index]))

  const traitsByLayer = new Map<string, ArtRows['traits']>()
  for (const trait of rows.traits) {
    const list = traitsByLayer.get(trait.layer_id)
    if (list) list.push(trait)
    else traitsByLayer.set(trait.layer_id, [trait])
  }

  const next = new Map<string, number>()
  const layers: Layer[] = rows.layers
    .filter((row) => order.has(row.art_collection_id))
    .sort(
      (a, b) => order.get(a.art_collection_id)! - order.get(b.art_collection_id)! || a.position - b.position,
    )
    .map((row) => {
      const position = next.get(row.art_collection_id) ?? 0
      next.set(row.art_collection_id, position + 1)
      const traits = [...(traitsByLayer.get(row.id) ?? [])]
        // The blank goes first, where the Layers screen adds it.
        .sort((a, b) => Number(b.blank) - Number(a.blank) || a.position - b.position)
        .map(toTrait)
      return {
        id: row.id,
        collectionId: row.art_collection_id,
        name: row.name,
        position,
        traits,
        ...(row.display_name ? { displayName: row.display_name } : {}),
        ...(row.bypass_dna ? { bypassDna: true } : {}),
      }
    })

  const rules: ArtRule[] = rows.rules.map((row) => ({
    id: row.id,
    kind: ruleKindFromDb(row.kind),
    traitId: row.trait_id,
    relatedTraitIds: row.related_trait_ids,
    bidirectional: row.bidirectional,
  }))
  const atLeastOne: AtLeastOne[] = rows.atLeastOne.map((row) => ({
    id: row.id,
    collectionId: row.art_collection_id,
    traitIds: row.trait_ids,
  }))

  const drafts: Draft[] = [...rows.tokens]
    .sort((a, b) => a.token_id - b.token_id)
    .map((row) => ({
      id: row.token_id,
      collectionId: row.art_collection_id,
      dna: row.dna,
      name: '',
      description: row.description ?? collection.token_description,
    }))
  const tokens = drafts.length
    ? finalise(drafts, {
        tokenName: collection.token_name ?? collection.name,
        index: buildTraitIndex(layers),
      })
    : null

  // Nothing saved yet: Generate offers the project's own name and description.
  const untouched = collection.token_name === null && collection.token_description === ''
  return {
    collections: artCollections.map((art) => ({ id: art.id, name: art.name, size: art.size })),
    activeCollectionId: artCollections[0]?.id,
    layers,
    rules,
    atLeastOne,
    tokens,
    canvas:
      collection.canvas_width && collection.canvas_height
        ? { width: collection.canvas_width, height: collection.canvas_height }
        : null,
    seed: collection.generation_seed ?? UNSET_SEED,
    staleNote: null,
    ...(collection.token_name === null ? {} : { tokenName: collection.token_name }),
    ...(untouched ? {} : { tokenDescription: collection.token_description }),
    showBlankTraits: collection.show_blank_traits,
  }
}

/** One row of a layer's weight table, as `setLayerWeights` takes it. */
export type WeightRow = { traitId: string; weight: number; constant: number | null }

/** The layer's whole weight table, the blank included; a constant always carries weight 0. */
export function weightRows(layer: Layer): WeightRow[] {
  return layer.traits.map((trait) => ({
    traitId: trait.id,
    weight: trait.constant ? 0 : trait.weight,
    constant: trait.constant ?? null,
  }))
}
```

Decision: the weight table carries every trait of the layer, the blank included (the spec's section 7 says "non-blank"), because a blank carries a weight share and "Even out" gives it one; leaving it out would lose that share on reload.

Decision: a token's description is saved as the string the store holds, so a later change to the project's token description does not rewrite tokens already generated, which matches "Tokens already generated keep theirs" on the Generate screen. A null description (never written by the screens) loads as the project's description.

- [ ] **Step 4: Run, expect pass; typecheck**

Run: `pnpm --filter @cobweb/web exec vitest run src/lib/art/rows.test.ts && pnpm typecheck`
Expected: 8 tests pass; typecheck clean in every package.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/art packages/dna/src/types.ts apps/web/src/components/art/state/art-store.ts apps/web/src/app/actions/uploads.ts
git commit -F - <<'MSG'
Map art rows to the Art screens' store and share the owner check

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011bcHX4HZG5YGWhxjGuiWos
MSG
```

### Task 2: The art edit functions and `verify:local` section 9f

**Files:**

- Create: `supabase/migrations/20261009010000_art_edit_functions.sql`
- Modify: `apps/web/scripts/verify-local.ts` (new section 9f before "// 10. Cleanup"; one call at the end of `main()`)
- Modify: `apps/web/src/lib/database.types.ts` (regenerated)

**Interfaces:**

- Consumes: the art tables and triggers of `supabase/migrations/20261008010000_art_tables.sql` (`layers_guard_tokens`, `tokens_guard_dna`, `art_guard_lock`, `traits_guard`, `rules_guard`, the deferrable `tokens` primary key, `swap_token_ids_for_check`); `record_upload` from `20261008020000_upload_cap_and_canvas.sql`; verify-local helpers `check`, `info`, `describe`, `expectError`, `PERMISSION`, `CHECK`, `insertCollection`, `insertUploadRow`, `recordUpload`, `HEX64`, `nameCount`, `admin`, `type Creator`, `type DbError`.
- Produces (all `security invoker`, granted to `authenticated` only):
  - `private.art_lock_owned(p_collection_id uuid, p_will_update boolean default false) returns void`
  - `private.art_prune(p_collection_id uuid, p_trait_ids uuid[]) returns void`
  - `public.art_import_layers(p_collection_id uuid, p_payload jsonb) returns jsonb`; payload `{ collections: [{ name, layers: [{ name, traits: [{ name, uploadId }] }] }], activeCollectionId: uuid | null }`; result `{ collections: [{ id, layers: [{ id, traits: [{ id }] }] }] }` in input order
  - `public.art_move_layer(p_collection_id uuid, p_layer_id uuid, p_position integer) returns void`
  - `public.art_delete_layer(p_collection_id uuid, p_layer_id uuid, p_clear_tokens boolean) returns void`
  - `public.art_delete_trait(p_collection_id uuid, p_trait_id uuid) returns void`
  - `public.art_delete_art_collection(p_collection_id uuid, p_art_collection_id uuid) returns void`
  - `public.art_set_layer_weights(p_collection_id uuid, p_layer_id uuid, p_rows jsonb) returns void`; rows `[{ traitId, weight, constant }]`
  - `public.art_save_tokens(p_collection_id uuid, p_tokens jsonb, p_seed bigint) returns void`; tokens `[{ tokenId, artCollectionId, dna, description }]`
  - `public.art_update_tokens(p_collection_id uuid, p_rows jsonb) returns void`; rows `[{ tokenId, dna?, description? }]`
  - `public.art_delete_tokens(p_collection_id uuid, p_ids integer[]) returns void`
  - `public.art_set_asset_order(p_collection_id uuid, p_rows jsonb) returns void`; rows `[{ uploadId, position }]`
  - `public.art_start_over(p_collection_id uuid) returns text[]` (the storage keys of the deleted uploads)
  - `tokens_guard_dna` now fires on `insert or update of dna, art_collection_id, collection_id` only.
  - Regenerated `Database['public']['Functions']` entries for each, used by Task 3.

Decision: three functions beyond the spec's list. `art_move_layer`, because a reorder moves several rows under the non-deferrable `unique (art_collection_id, position)` and must be one transaction; `art_update_tokens`, because "describe all" and a bulk re-roll would otherwise be one round trip per token; `art_set_asset_order`, for the same reason on the Assets screen.

Decision: `art_delete_layer`'s `p_clear_tokens` deletes every token of the project, not only the layer's art collection, because the browser clears the whole set (token ids run on across collections, so clearing one collection would leave a gap in the ids).

Decision: `art_save_tokens` and `art_start_over` lock the collections row `for no key update` instead of `for share`, because they then write that row; a share lock followed by an update can deadlock against a second tab, and the lock trigger's note in the art tables migration asks server code to update `collections` before touching art rows. `record_upload` already locks the row `for update`.

Decision: `tokens_guard_dna` is re-created to fire only when the DNA or the art collection is written, so renumbering ids after a delete (which changes `token_id` only) does not re-read the layers for every row; the 10,000-row check in 9f bounds the timing.

- [ ] **Step 1: Write the failing checks**

In `apps/web/scripts/verify-local.ts`, at the end of `main()` after `await artInvariants(A)`, add:

```ts
await artEdits(A, B)
```

Add this section after the end of `artInvariants` and before the "// 10. Cleanup" banner:

```ts
// ---------------------------------------------------------------------------------------------
// 9f. Art edits: the database functions behind the Art screens (docs/specs/2026-10-08-art-wiring.md)
// ---------------------------------------------------------------------------------------------
type ImportedIds = { collections: { id: string; layers: { id: string; traits: { id: string }[] }[] }[] }
type ImportPayloadInput = {
  collections: { name: string; layers: { name: string; traits: { name: string; uploadId: string }[] }[] }[]
  activeCollectionId: string | null
}

async function callArt(client: SupabaseClient, fn: string, args: Record<string, unknown>) {
  const { data, error } = await client.rpc(fn, args)
  return { data: data as unknown, error: error as DbError }
}

function expectSentence(error: DbError, codes: string[], sentence: string): string | null {
  const problem = expectError(error, codes)
  if (problem) return problem
  return error?.message.includes(sentence) ? null : `wrong message: ${error?.message}`
}

async function countRows(table: string, column: string, value: string): Promise<number> {
  const { count, error } = await admin
    .from(table)
    .select('*', { count: 'exact', head: true })
    .eq(column, value)
  if (error) throw new Error(`count ${table}: ${describe(error as DbError)}`)
  return count ?? 0
}

/**
 * A project imported through art_import_layers. `shape` lists trait names per layer per art
 * collection; every trait gets its own layer image row.
 */
async function importedProject(client: SupabaseClient, shape: string[][][]) {
  const col = await insertCollection(client)
  if (!col.row) throw new Error(`setup: ${describe(col.error)}`)
  const cid = col.row.id
  const payload: ImportPayloadInput = { collections: [], activeCollectionId: null }
  for (const [c, layers] of shape.entries()) {
    const collection: ImportPayloadInput['collections'][number] = { name: `Collection ${c}`, layers: [] }
    for (const [l, traits] of layers.entries()) {
      const layer: ImportPayloadInput['collections'][number]['layers'][number] = {
        name: `Layer ${c}.${l}`,
        traits: [],
      }
      for (const name of traits) layer.traits.push({ name, uploadId: await insertUploadRow(client, cid) })
      collection.layers.push(layer)
    }
    payload.collections.push(collection)
  }
  const { data, error } = await callArt(client, 'art_import_layers', {
    p_collection_id: cid,
    p_payload: payload,
  })
  if (error) throw new Error(`import: ${describe(error)}`)
  const ids = data as ImportedIds
  return {
    cid,
    art: (c = 0) => ids.collections[c]!.id,
    layer: (c: number, l: number) => ids.collections[c]!.layers[l]!.id,
    trait: (c: number, l: number, t: number) => ids.collections[c]!.layers[l]!.traits[t]!.id,
  }
}

const tokenRow = (cid: string, art: string, tokenId: number, dna: string[]) => ({
  collection_id: cid,
  token_id: tokenId,
  art_collection_id: art,
  dna,
})

async function artEdits(A: Creator, B: Creator): Promise<void> {
  // A project with Background (Ink, Dusk) under Eyes (Wide, Sleepy, Wink).
  const p = await importedProject(A.client, [
    [
      ['Ink', 'Dusk'],
      ['Wide', 'Sleepy', 'Wink'],
    ],
  ])
  const [ink, dusk] = [p.trait(0, 0, 0), p.trait(0, 0, 1)]
  const [wide, sleepy, wink] = [p.trait(0, 1, 0), p.trait(0, 1, 1), p.trait(0, 1, 2)]

  await check(
    'art_import_layers: a two-layer folder becomes one art collection, two layers, even weights',
    async () => {
      if ((await countRows('art_collections', 'collection_id', p.cid)) !== 1) return 'not one art collection'
      const { data: layers } = await admin
        .from('layers')
        .select('id, position')
        .eq('collection_id', p.cid)
        .order('position')
      if (layers?.map((layer) => layer.position).join() !== '0,1') return `layers ${JSON.stringify(layers)}`
      const { data: traits } = await admin.from('traits').select('weight').eq('layer_id', p.layer(0, 1))
      const weights = (traits ?? []).map((trait) => Number(trait.weight)).sort((a, b) => b - a)
      return weights.join() === '33.34,33.33,33.33' ? null : `eyes weights ${weights.join()}`
    },
  )

  await check('art_import_layers: a second import into the same art collection is refused', async () => {
    const uploadId = await insertUploadRow(A.client, p.cid)
    const payload: ImportPayloadInput = {
      collections: [{ name: 'Again', layers: [{ name: 'Hat', traits: [{ name: 'Cap', uploadId }] }] }],
      activeCollectionId: p.art(),
    }
    const { error } = await callArt(A.client, 'art_import_layers', {
      p_collection_id: p.cid,
      p_payload: payload,
    })
    return expectSentence(error, CHECK, 'This collection already has layers. Start over to replace them.')
  })

  await check(
    'art_delete_trait: prunes two rules and a group, drops the empty ones, closes positions',
    async () => {
      const rules = await A.client
        .from('rules')
        .insert([
          {
            collection_id: p.cid,
            kind: 'doesnt_mix_with',
            trait_id: ink,
            related_trait_ids: [wide],
            bidirectional: true,
          },
          {
            collection_id: p.cid,
            kind: 'must_pair_with',
            trait_id: dusk,
            related_trait_ids: [wide, sleepy],
            bidirectional: false,
          },
        ])
        .select('id')
      if (rules.error) return `setup: ${describe(rules.error as DbError)}`
      const group = await A.client
        .from('at_least_one')
        .insert({ collection_id: p.cid, art_collection_id: p.art(), trait_ids: [wide, wink] })
      if (group.error) return `setup: ${describe(group.error as DbError)}`
      const { error } = await callArt(A.client, 'art_delete_trait', {
        p_collection_id: p.cid,
        p_trait_id: wide,
      })
      if (error) return describe(error)
      const { data: left } = await admin
        .from('rules')
        .select('trait_id, related_trait_ids')
        .eq('collection_id', p.cid)
      if (left?.length !== 1 || left[0].trait_id !== dusk || left[0].related_trait_ids.join() !== sleepy)
        return `rules ${JSON.stringify(left)}`
      if ((await countRows('at_least_one', 'collection_id', p.cid)) !== 0)
        return 'the group of one is still there'
      const { data: eyes } = await admin
        .from('traits')
        .select('id, position')
        .eq('layer_id', p.layer(0, 1))
        .order('position')
      return eyes?.map((trait) => trait.position).join() === '0,1' && eyes[0].id === sleepy
        ? null
        : `positions ${JSON.stringify(eyes)}`
    },
  )

  await check('art_set_layer_weights: a constant forces the weight to 0', async () => {
    const { error } = await callArt(A.client, 'art_set_layer_weights', {
      p_collection_id: p.cid,
      p_layer_id: p.layer(0, 1),
      p_rows: [
        { traitId: sleepy, weight: 30, constant: 5 },
        { traitId: wink, weight: 70, constant: null },
      ],
    })
    if (error) return describe(error)
    const { data } = await admin.from('traits').select('weight, constant').eq('id', sleepy).single()
    return Number(data?.weight) === 0 && data?.constant === 5 ? null : `stored ${JSON.stringify(data)}`
  })

  await check("art_set_layer_weights: a table missing one of the layer's traits is refused", async () => {
    const { error } = await callArt(A.client, 'art_set_layer_weights', {
      p_collection_id: p.cid,
      p_layer_id: p.layer(0, 1),
      p_rows: [{ traitId: sleepy, weight: 100, constant: null }],
    })
    return expectError(error, CHECK)
  })

  await check(
    'art_delete_layer: refused with the trigger sentence while tokens exist and the flag is off',
    async () => {
      const ins = await A.client
        .from('tokens')
        .insert([tokenRow(p.cid, p.art(), 1, [ink, sleepy]), tokenRow(p.cid, p.art(), 2, [dusk, wink])])
      if (ins.error) return `setup: ${describe(ins.error as DbError)}`
      const { error } = await callArt(A.client, 'art_delete_layer', {
        p_collection_id: p.cid,
        p_layer_id: p.layer(0, 0),
        p_clear_tokens: false,
      })
      return expectSentence(error, CHECK, 'Clear the tokens first.')
    },
  )

  await check(
    'art_delete_layer: with the flag the tokens go, then the layer, and positions close',
    async () => {
      const { error } = await callArt(A.client, 'art_delete_layer', {
        p_collection_id: p.cid,
        p_layer_id: p.layer(0, 0),
        p_clear_tokens: true,
      })
      if (error) return describe(error)
      if ((await countRows('tokens', 'collection_id', p.cid)) !== 0) return 'tokens left'
      const { data } = await admin.from('layers').select('id, position').eq('collection_id', p.cid)
      return data?.length === 1 && data[0].id === p.layer(0, 1) && data[0].position === 0
        ? null
        : `layers ${JSON.stringify(data)}`
    },
  )

  // Three layers, for moves.
  const m = await importedProject(A.client, [[['A1'], ['B1'], ['C1']]])
  await check('art_move_layer: moves the top layer to the bottom and renumbers the stack', async () => {
    const { error } = await callArt(A.client, 'art_move_layer', {
      p_collection_id: m.cid,
      p_layer_id: m.layer(0, 2),
      p_position: 0,
    })
    if (error) return describe(error)
    const { data } = await admin
      .from('layers')
      .select('id, position')
      .eq('collection_id', m.cid)
      .order('position')
    const order = (data ?? []).map((layer) => layer.id).join()
    return order === [m.layer(0, 2), m.layer(0, 0), m.layer(0, 1)].join()
      ? null
      : `order ${JSON.stringify(data)}`
  })
  await check('art_move_layer: refused with the trigger sentence while tokens exist', async () => {
    const ins = await A.client
      .from('tokens')
      .insert(tokenRow(m.cid, m.art(), 1, [m.trait(0, 2, 0), m.trait(0, 0, 0), m.trait(0, 1, 0)]))
    if (ins.error) return `setup: ${describe(ins.error as DbError)}`
    const { error } = await callArt(A.client, 'art_move_layer', {
      p_collection_id: m.cid,
      p_layer_id: m.layer(0, 1),
      p_position: 0,
    })
    return expectSentence(error, CHECK, 'Clear the tokens first.')
  })

  // Two art collections with one layer each, for the collection delete.
  const r = await importedProject(A.client, [[['X1', 'X2']], [['Y1', 'Y2']]])
  await check(
    'art_delete_art_collection: the rest of the tokens renumber from 1 and positions close',
    async () => {
      const ins = await A.client
        .from('tokens')
        .insert([
          tokenRow(r.cid, r.art(0), 1, [r.trait(0, 0, 0)]),
          tokenRow(r.cid, r.art(0), 2, [r.trait(0, 0, 1)]),
          tokenRow(r.cid, r.art(1), 3, [r.trait(1, 0, 0)]),
          tokenRow(r.cid, r.art(1), 4, [r.trait(1, 0, 1)]),
        ])
      if (ins.error) return `setup: ${describe(ins.error as DbError)}`
      const { error } = await callArt(A.client, 'art_delete_art_collection', {
        p_collection_id: r.cid,
        p_art_collection_id: r.art(0),
      })
      if (error) return describe(error)
      const { data: tokens } = await admin
        .from('tokens')
        .select('token_id, dna')
        .eq('collection_id', r.cid)
        .order('token_id')
      const ids = (tokens ?? []).map((token) => `${token.token_id}:${token.dna[0]}`).join()
      if (ids !== `1:${r.trait(1, 0, 0)},2:${r.trait(1, 0, 1)}`) return `tokens ${ids}`
      const { data: arts } = await admin
        .from('art_collections')
        .select('id, position')
        .eq('collection_id', r.cid)
      return arts?.length === 1 && arts[0].id === r.art(1) && arts[0].position === 0
        ? null
        : `art collections ${JSON.stringify(arts)}`
    },
  )

  // One layer of four traits, for the whole-set save.
  const s = await importedProject(A.client, [[['T0', 'T1', 'T2', 'T3']]])
  const t = [0, 1, 2, 3].map((i) => s.trait(0, 0, i))
  await check(
    'art_save_tokens then art_delete_tokens: 10,000 saved, 3 deleted, ids close up, under five seconds',
    async () => {
      const tokens = Array.from({ length: 10_000 }, (_, i) => ({
        tokenId: i + 1,
        artCollectionId: s.art(),
        dna: [t[i % 4]!],
        description: null,
      }))
      const started = Date.now()
      const saved = await callArt(A.client, 'art_save_tokens', {
        p_collection_id: s.cid,
        p_tokens: tokens,
        p_seed: 42,
      })
      if (saved.error) return describe(saved.error)
      const deleted = await callArt(A.client, 'art_delete_tokens', {
        p_collection_id: s.cid,
        p_ids: [2, 500, 9_999],
      })
      const ms = Date.now() - started
      if (deleted.error) return describe(deleted.error)
      info(`10,000 tokens saved and 3 deleted in ${ms} ms`)
      const total = await countRows('tokens', 'collection_id', s.cid)
      const { data: last } = await admin
        .from('tokens')
        .select('token_id, dna')
        .eq('collection_id', s.cid)
        .order('token_id', { ascending: false })
        .limit(1)
        .single()
      const { data: second } = await admin
        .from('tokens')
        .select('dna')
        .eq('collection_id', s.cid)
        .eq('token_id', 2)
        .single()
      const { data: seeded } = await admin
        .from('collections')
        .select('generation_seed')
        .eq('id', s.cid)
        .single()
      if (total !== 9_997 || last?.token_id !== 9_997) return `count ${total}, last id ${last?.token_id}`
      if (second?.dna[0] !== t[2]) return 'token 3 did not become token 2'
      if (last.dna[0] !== t[3]) return 'the last token did not move up by three'
      if (Number(seeded?.generation_seed) !== 42) return `seed ${seeded?.generation_seed}`
      return ms < 5000 ? null : `took ${ms} ms`
    },
  )

  await check('art_update_tokens: writes a description, and refuses a DNA that does not match', async () => {
    const good = await callArt(A.client, 'art_update_tokens', {
      p_collection_id: s.cid,
      p_rows: [{ tokenId: 1, description: 'First light' }],
    })
    if (good.error) return describe(good.error)
    const { data } = await admin
      .from('tokens')
      .select('description')
      .eq('collection_id', s.cid)
      .eq('token_id', 1)
      .single()
    if (data?.description !== 'First light') return `description ${data?.description}`
    const bad = await callArt(A.client, 'art_update_tokens', {
      p_collection_id: s.cid,
      p_rows: [{ tokenId: 1, dna: [t[0], t[1]] }],
    })
    return expectSentence(bad.error, CHECK, 'Token DNA does not match the layers.')
  })

  await check("art_set_asset_order: writes the positions of the project's assets", async () => {
    const col = await insertCollection(A.client, { project_type: 'one_of_one' })
    if (!col.row) return `setup: ${describe(col.error)}`
    const cid = col.row.id
    const asset = async () => {
      const hash = HEX64(++nameCount)
      const { id, error } = await recordUpload(A.client, cid, {
        kind: 'asset',
        storage_key: `${cid}/assets/${hash}.png`,
        content_hash: hash,
        width: 800,
        height: 600,
      })
      if (error || !id) throw new Error(`asset setup: ${describe(error)}`)
      return id
    }
    const [first, second] = [await asset(), await asset()]
    const { error } = await callArt(A.client, 'art_set_asset_order', {
      p_collection_id: cid,
      p_rows: [
        { uploadId: second, position: 0 },
        { uploadId: first, position: 1 },
      ],
    })
    if (error) return describe(error)
    const { data } = await admin.from('uploads').select('id').eq('collection_id', cid).order('position')
    return (data ?? []).map((row) => row.id).join() === [second, first].join()
      ? null
      : `order ${JSON.stringify(data)}`
  })

  await check(
    'art_start_over: no art rows, no layer uploads, canvas and seed cleared, keys returned',
    async () => {
      const z = await importedProject(A.client, [[['Z1', 'Z2']]])
      const saved = await callArt(A.client, 'art_save_tokens', {
        p_collection_id: z.cid,
        p_tokens: [{ tokenId: 1, artCollectionId: z.art(), dna: [z.trait(0, 0, 0)], description: null }],
        p_seed: 7,
      })
      if (saved.error) return `setup: ${describe(saved.error)}`
      const { data, error } = await callArt(A.client, 'art_start_over', { p_collection_id: z.cid })
      if (error) return describe(error)
      const keys = data as string[]
      for (const table of ['art_collections', 'layers', 'traits', 'rules', 'at_least_one', 'tokens'])
        if ((await countRows(table, 'collection_id', z.cid)) !== 0) return `${table} left`
      const { data: images } = await admin
        .from('uploads')
        .select('id')
        .eq('collection_id', z.cid)
        .eq('kind', 'layer_image')
      if (images?.length) return `${images.length} layer images left`
      const { data: row } = await admin
        .from('collections')
        .select('canvas_width, canvas_height, generation_seed')
        .eq('id', z.cid)
        .single()
      if (row?.canvas_width !== null || row?.canvas_height !== null || row?.generation_seed !== null)
        return `collection ${JSON.stringify(row)}`
      return keys.length === 2 && keys.every((key) => key.startsWith(`${z.cid}/layers/`))
        ? null
        : `keys ${JSON.stringify(keys)}`
    },
  )

  // Every function, refused for another creator and after the lock.
  const w = await importedProject(A.client, [[['W1', 'W2']]])
  const everyFunction: [string, Record<string, unknown>][] = [
    [
      'art_import_layers',
      { p_collection_id: w.cid, p_payload: { collections: [], activeCollectionId: null } },
    ],
    ['art_move_layer', { p_collection_id: w.cid, p_layer_id: w.layer(0, 0), p_position: 0 }],
    ['art_delete_layer', { p_collection_id: w.cid, p_layer_id: w.layer(0, 0), p_clear_tokens: true }],
    ['art_delete_trait', { p_collection_id: w.cid, p_trait_id: w.trait(0, 0, 0) }],
    ['art_delete_art_collection', { p_collection_id: w.cid, p_art_collection_id: w.art() }],
    ['art_set_layer_weights', { p_collection_id: w.cid, p_layer_id: w.layer(0, 0), p_rows: [] }],
    ['art_save_tokens', { p_collection_id: w.cid, p_tokens: [], p_seed: 1 }],
    ['art_update_tokens', { p_collection_id: w.cid, p_rows: [] }],
    ['art_delete_tokens', { p_collection_id: w.cid, p_ids: [1] }],
    ['art_set_asset_order', { p_collection_id: w.cid, p_rows: [] }],
    ['art_start_over', { p_collection_id: w.cid }],
  ]
  await check(
    "art functions: B calling any of them on A's collection is refused and nothing changes",
    async () => {
      const problems: string[] = []
      for (const [fn, args] of everyFunction) {
        const { error } = await callArt(B.client, fn, args)
        const problem = expectSentence(error, PERMISSION, 'collection not found')
        if (problem) problems.push(`${fn}: ${problem}`)
      }
      if ((await countRows('traits', 'collection_id', w.cid)) !== 2) problems.push('traits changed')
      if ((await countRows('layers', 'collection_id', w.cid)) !== 1) problems.push('layers changed')
      return problems.length ? problems.join('; ') : null
    },
  )
  await check('art functions: every one is refused after the lock', async () => {
    const lock = await admin
      .from('collections')
      .update({ art_locked_at: new Date().toISOString() })
      .eq('id', w.cid)
    if (lock.error) return `setup: ${describe(lock.error as DbError)}`
    const problems: string[] = []
    for (const [fn, args] of everyFunction) {
      const { error } = await callArt(A.client, fn, args)
      const problem = expectSentence(error, PERMISSION, 'The art is locked and cannot change.')
      if (problem) problems.push(`${fn}: ${problem}`)
    }
    return problems.length ? problems.join('; ') : null
  })
}
```

- [ ] **Step 2: Run, expect failure**

Run:

```bash
supabase db reset 2>&1 | tail -3
supabase seed buckets
pnpm --filter @cobweb/web verify:local 2>&1 | grep -E '^(FAIL|[0-9]+ passed)'
```

Expected: `FAIL run: import: PGRST202 Could not find the function public.art_import_layers(p_collection_id, p_payload) in the schema cache` (the first `importedProject` throws), then the summary line with at least 1 failed. Every earlier section still passes.

- [ ] **Step 3: Write the migration**

`supabase/migrations/20261009010000_art_edit_functions.sql`:

```sql
-- Art edit functions (docs/specs/2026-10-08-art-wiring.md, section 7): the Art screens' edits that
-- span more than one statement, each in one transaction. Every function runs as the caller
-- (security invoker), so row-level security, the lock trigger and the content guards apply as they
-- do to a single write. Each first locks the caller's own collections row, so another creator's id
-- reads as "collection not found" and is never locked.

-- ---------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------

-- Locks the caller's own collection row and refuses a locked project. `for share` by default;
-- `for no key update` when the function then writes the row, so two tabs cannot deadlock upgrading
-- a share lock.
create function private.art_lock_owned(p_collection_id uuid, p_will_update boolean default false)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_locked timestamptz;
begin
  if p_will_update then
    select c.art_locked_at into v_locked
    from public.collections c
    where c.id = p_collection_id and c.owner_id = (select auth.uid())
    for no key update;
  else
    select c.art_locked_at into v_locked
    from public.collections c
    where c.id = p_collection_id and c.owner_id = (select auth.uid())
    for share;
  end if;
  if not found then
    raise exception 'collection not found' using errcode = '42501';
  end if;
  if v_locked is not null then
    raise exception 'The art is locked and cannot change.' using errcode = '42501';
  end if;
end;
$$;

revoke all on function private.art_lock_owned(uuid, boolean) from public, anon;
grant execute on function private.art_lock_owned(uuid, boolean) to authenticated;

-- Drops deleted traits from the rules and "at least one" groups that named them: a rule left with no
-- related trait goes, and so does a group left with fewer than two. Rules whose own trait was deleted
-- are already gone (on delete cascade).
create function private.art_prune(p_collection_id uuid, p_trait_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_trait_ids is null or cardinality(p_trait_ids) = 0 then
    return;
  end if;
  delete from public.rules r
  where r.collection_id = p_collection_id and r.related_trait_ids <@ p_trait_ids;
  update public.rules r
  set related_trait_ids = array(
    select u.x from unnest(r.related_trait_ids) with ordinality as u(x, n)
    where u.x <> all (p_trait_ids)
    order by u.n
  )
  where r.collection_id = p_collection_id and r.related_trait_ids && p_trait_ids;
  delete from public.at_least_one g
  where g.collection_id = p_collection_id
    and cardinality(array(select u.x from unnest(g.trait_ids) as u(x) where u.x <> all (p_trait_ids))) < 2;
  update public.at_least_one g
  set trait_ids = array(
    select u.x from unnest(g.trait_ids) with ordinality as u(x, n)
    where u.x <> all (p_trait_ids)
    order by u.n
  )
  where g.collection_id = p_collection_id and g.trait_ids && p_trait_ids;
end;
$$;

revoke all on function private.art_prune(uuid, uuid[]) from public, anon;
grant execute on function private.art_prune(uuid, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Folder import
-- ---------------------------------------------------------------------------------------------

-- The folder upload's structure in one transaction: art collections, layers and traits linked to
-- their upload rows, every layer evenly split (as evenWeights in layer-edits.ts). With
-- activeCollectionId and one collection, the layers go into that art collection, which must have
-- none; otherwise new art collections follow the existing ones, and a project with no layers yet
-- replaces its empty art collections. Returns the new ids in the payload's shape.
create function public.art_import_layers(p_collection_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_collections jsonb := coalesce(p_payload -> 'collections', '[]'::jsonb);
  v_active uuid := nullif(p_payload ->> 'activeCollectionId', '')::uuid;
  v_fill boolean;
  v_next integer;
  v_art uuid;
  v_layer uuid;
  v_trait uuid;
  v_c jsonb;
  v_l jsonb;
  v_t jsonb;
  v_lpos integer;
  v_tpos integer;
  v_count integer;
  v_base integer;
  v_rest integer;
  v_out jsonb := '[]'::jsonb;
  v_layers_out jsonb;
  v_traits_out jsonb;
begin
  perform private.art_lock_owned(p_collection_id);
  if jsonb_typeof(v_collections) <> 'array' then
    raise exception 'The folder could not be read.' using errcode = '22023';
  end if;
  v_fill := v_active is not null and jsonb_array_length(v_collections) = 1;
  if v_fill then
    if not exists (
      select 1 from public.art_collections a where a.id = v_active and a.collection_id = p_collection_id
    ) then
      raise exception 'art collection not found' using errcode = 'P0002';
    end if;
    if exists (select 1 from public.layers l where l.art_collection_id = v_active) then
      raise exception 'This collection already has layers. Start over to replace them.' using errcode = '23514';
    end if;
  elsif not exists (select 1 from public.layers l where l.collection_id = p_collection_id) then
    delete from public.art_collections a where a.collection_id = p_collection_id;
  end if;
  select coalesce(max(a.position) + 1, 0) into v_next
  from public.art_collections a where a.collection_id = p_collection_id;

  for v_c in
    select e.value from jsonb_array_elements(v_collections) with ordinality as e(value, n) order by e.n
  loop
    if v_fill then
      v_art := v_active;
    else
      insert into public.art_collections (collection_id, name, size, position)
      values (p_collection_id, v_c ->> 'name', 0, v_next)
      returning id into v_art;
      v_next := v_next + 1;
    end if;
    v_layers_out := '[]'::jsonb;
    v_lpos := 0;
    for v_l in
      select e.value
      from jsonb_array_elements(coalesce(v_c -> 'layers', '[]'::jsonb)) with ordinality as e(value, n)
      order by e.n
    loop
      insert into public.layers (collection_id, art_collection_id, name, position)
      values (p_collection_id, v_art, v_l ->> 'name', v_lpos)
      returning id into v_layer;
      v_lpos := v_lpos + 1;
      v_count := jsonb_array_length(coalesce(v_l -> 'traits', '[]'::jsonb));
      v_base := case when v_count > 0 then 10000 / v_count else 0 end;
      v_rest := 10000 - v_base * v_count;
      v_traits_out := '[]'::jsonb;
      v_tpos := 0;
      for v_t in
        select e.value
        from jsonb_array_elements(coalesce(v_l -> 'traits', '[]'::jsonb)) with ordinality as e(value, n)
        order by e.n
      loop
        insert into public.traits (collection_id, layer_id, name, weight, upload_id, position)
        values (
          p_collection_id,
          v_layer,
          v_t ->> 'name',
          (v_base + case when v_tpos < v_rest then 1 else 0 end) / 100.0,
          (v_t ->> 'uploadId')::uuid,
          v_tpos
        )
        returning id into v_trait;
        v_traits_out := v_traits_out || jsonb_build_array(jsonb_build_object('id', v_trait));
        v_tpos := v_tpos + 1;
      end loop;
      v_layers_out := v_layers_out || jsonb_build_array(jsonb_build_object('id', v_layer, 'traits', v_traits_out));
    end loop;
    v_out := v_out || jsonb_build_array(jsonb_build_object('id', v_art, 'layers', v_layers_out));
  end loop;
  return jsonb_build_object('collections', v_out);
end;
$$;

revoke all on function public.art_import_layers(uuid, jsonb) from public, anon;
grant execute on function public.art_import_layers(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Layers and traits
-- ---------------------------------------------------------------------------------------------

-- Moves a layer to a new place in its stack. The stack is parked above every real position first,
-- so the unique (art_collection_id, position) key, checked row by row, never sees two layers at
-- one place. layers_guard_tokens refuses it while the art collection has tokens.
create function public.art_move_layer(p_collection_id uuid, p_layer_id uuid, p_position integer)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_art uuid;
  v_from integer;
  v_last integer;
  v_to integer;
begin
  perform private.art_lock_owned(p_collection_id);
  select l.art_collection_id into v_art
  from public.layers l where l.id = p_layer_id and l.collection_id = p_collection_id;
  if not found then
    raise exception 'layer not found' using errcode = 'P0002';
  end if;
  with ranked as (
    select l.id, (row_number() over (order by l.position) - 1)::integer as at
    from public.layers l where l.art_collection_id = v_art
  )
  select r.at, (select count(*) - 1 from ranked)::integer into v_from, v_last
  from ranked r where r.id = p_layer_id;
  v_to := greatest(0, least(p_position, v_last));
  if v_to = v_from then
    return;
  end if;
  update public.layers l set position = l.position + 100000 where l.art_collection_id = v_art;
  with ranked as (
    select l.id, (row_number() over (order by l.position) - 1)::integer as at
    from public.layers l where l.art_collection_id = v_art
  )
  update public.layers l
  set position = case
    when r.id = p_layer_id then v_to
    when v_from < v_to and r.at > v_from and r.at <= v_to then r.at - 1
    when v_from > v_to and r.at >= v_to and r.at < v_from then r.at + 1
    else r.at
  end
  from ranked r
  where r.id = l.id;
end;
$$;

revoke all on function public.art_move_layer(uuid, uuid, integer) from public, anon;
grant execute on function public.art_move_layer(uuid, uuid, integer) to authenticated;

-- Deletes a layer (its traits cascade), prunes rules and groups of its traits and closes the
-- position gap. With p_clear_tokens the project's tokens go first; without it layers_guard_tokens
-- refuses while the art collection has tokens.
create function public.art_delete_layer(p_collection_id uuid, p_layer_id uuid, p_clear_tokens boolean)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_art uuid;
  v_traits uuid[];
begin
  perform private.art_lock_owned(p_collection_id);
  select l.art_collection_id into v_art
  from public.layers l where l.id = p_layer_id and l.collection_id = p_collection_id;
  if not found then
    raise exception 'layer not found' using errcode = 'P0002';
  end if;
  select coalesce(array_agg(t.id), '{}') into v_traits from public.traits t where t.layer_id = p_layer_id;
  if p_clear_tokens then
    delete from public.tokens t where t.collection_id = p_collection_id;
  end if;
  delete from public.layers l where l.id = p_layer_id;
  perform private.art_prune(p_collection_id, v_traits);
  update public.layers l set position = l.position + 100000 where l.art_collection_id = v_art;
  with ranked as (
    select l.id, (row_number() over (order by l.position) - 1)::integer as at
    from public.layers l where l.art_collection_id = v_art
  )
  update public.layers l set position = r.at from ranked r where r.id = l.id;
end;
$$;

revoke all on function public.art_delete_layer(uuid, uuid, boolean) from public, anon;
grant execute on function public.art_delete_layer(uuid, uuid, boolean) to authenticated;

-- Deletes a trait, prunes the rules and groups that named it (a rule stored on it cascades) and
-- closes the position gap in its layer. Its upload row stays: an upload may have no trait.
create function public.art_delete_trait(p_collection_id uuid, p_trait_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_layer uuid;
begin
  perform private.art_lock_owned(p_collection_id);
  select t.layer_id into v_layer
  from public.traits t where t.id = p_trait_id and t.collection_id = p_collection_id;
  if not found then
    raise exception 'trait not found' using errcode = 'P0002';
  end if;
  delete from public.traits t where t.id = p_trait_id;
  perform private.art_prune(p_collection_id, array[p_trait_id]);
  update public.traits t set position = t.position + 100000 where t.layer_id = v_layer;
  with ranked as (
    select t.id, (row_number() over (order by t.position) - 1)::integer as at
    from public.traits t where t.layer_id = v_layer
  )
  update public.traits t set position = r.at from ranked r where r.id = t.id;
end;
$$;

revoke all on function public.art_delete_trait(uuid, uuid) from public, anon;
grant execute on function public.art_delete_trait(uuid, uuid) to authenticated;

-- Deletes an art collection (layers, traits, rules, groups and tokens cascade), prunes what named
-- its traits, closes the position gap and renumbers the remaining tokens from 1 in one statement,
-- which the deferrable primary key allows.
create function public.art_delete_art_collection(p_collection_id uuid, p_art_collection_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_traits uuid[];
begin
  perform private.art_lock_owned(p_collection_id);
  if not exists (
    select 1 from public.art_collections a where a.id = p_art_collection_id and a.collection_id = p_collection_id
  ) then
    raise exception 'art collection not found' using errcode = 'P0002';
  end if;
  select coalesce(array_agg(t.id), '{}') into v_traits
  from public.traits t join public.layers l on l.id = t.layer_id
  where l.art_collection_id = p_art_collection_id;
  delete from public.art_collections a where a.id = p_art_collection_id;
  perform private.art_prune(p_collection_id, v_traits);
  update public.art_collections a set position = a.position + 100000 where a.collection_id = p_collection_id;
  with ranked as (
    select a.id, (row_number() over (order by a.position) - 1)::integer as at
    from public.art_collections a where a.collection_id = p_collection_id
  )
  update public.art_collections a set position = r.at from ranked r where r.id = a.id;
  with ranked as (
    select t.token_id, row_number() over (order by t.token_id)::integer as id
    from public.tokens t where t.collection_id = p_collection_id
  )
  update public.tokens t set token_id = r.id
  from ranked r
  where t.collection_id = p_collection_id and t.token_id = r.token_id and t.token_id <> r.id;
end;
$$;

revoke all on function public.art_delete_art_collection(uuid, uuid) from public, anon;
grant execute on function public.art_delete_art_collection(uuid, uuid) to authenticated;

-- Writes a layer's whole weight table from [{ traitId, weight, constant }]. The rows must name
-- every trait of the layer exactly once (the blank included); a constant forces the weight to 0.
create function public.art_set_layer_weights(p_collection_id uuid, p_layer_id uuid, p_rows jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_given integer;
  v_matched integer;
  v_total integer;
begin
  perform private.art_lock_owned(p_collection_id);
  if not exists (
    select 1 from public.layers l where l.id = p_layer_id and l.collection_id = p_collection_id
  ) then
    raise exception 'layer not found' using errcode = 'P0002';
  end if;
  select count(*), count(distinct t.id) into v_given, v_matched
  from jsonb_array_elements(p_rows) as e(x)
  left join public.traits t on t.id = (e.x ->> 'traitId')::uuid and t.layer_id = p_layer_id;
  select count(*) into v_total from public.traits t where t.layer_id = p_layer_id;
  if v_given <> v_total or v_matched <> v_total then
    raise exception 'The weights do not match the layer''s traits.' using errcode = '23514';
  end if;
  update public.traits t
  set weight = case when w.constant is null then w.weight else 0 end,
    constant = w.constant
  from (
    select (e.x ->> 'traitId')::uuid as id, (e.x ->> 'weight')::numeric as weight, (e.x ->> 'constant')::integer as constant
    from jsonb_array_elements(p_rows) as e(x)
  ) w
  where t.id = w.id and t.layer_id = p_layer_id
    and (t.weight, t.constant) is distinct from (case when w.constant is null then w.weight else 0 end, w.constant);
end;
$$;

revoke all on function public.art_set_layer_weights(uuid, uuid, jsonb) from public, anon;
grant execute on function public.art_set_layer_weights(uuid, uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Tokens
-- ---------------------------------------------------------------------------------------------

-- The DNA guard reads the layers for every row it checks. Renumbering after a delete changes only
-- token_id, so the guard now runs when the DNA or the art collection is written.
drop trigger tokens_guard_dna on public.tokens;
create trigger tokens_guard_dna
before insert or update of dna, art_collection_id, collection_id on public.tokens
for each row execute function public.tokens_guard_dna();

-- Replaces the whole set from [{ tokenId, artCollectionId, dna, description }] and records its
-- seed. Delete then insert: the deferrable key rules out an upsert. The collections row is written
-- first, as the lock trigger's note asks.
create function public.art_save_tokens(p_collection_id uuid, p_tokens jsonb, p_seed bigint)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform private.art_lock_owned(p_collection_id, true);
  if jsonb_array_length(p_tokens) > 100000 then
    raise exception 'A project can have at most 100,000 tokens.' using errcode = '23514';
  end if;
  update public.collections c set generation_seed = p_seed where c.id = p_collection_id;
  delete from public.tokens t where t.collection_id = p_collection_id;
  insert into public.tokens (collection_id, token_id, art_collection_id, dna, description)
  select p_collection_id, x."tokenId", x."artCollectionId", x.dna, x.description
  from jsonb_to_recordset(p_tokens) as x("tokenId" integer, "artCollectionId" uuid, dna uuid[], description text);
end;
$$;

revoke all on function public.art_save_tokens(uuid, jsonb, bigint) from public, anon;
grant execute on function public.art_save_tokens(uuid, jsonb, bigint) to authenticated;

-- Writes the DNA and descriptions of some tokens from [{ tokenId, dna?, description? }] in one
-- statement. A key left out keeps its column; the DNA guard checks every new DNA.
create function public.art_update_tokens(p_collection_id uuid, p_rows jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform private.art_lock_owned(p_collection_id);
  update public.tokens t
  set dna = case
      when e.x ? 'dna' then array(
        select d.v from jsonb_array_elements_text(e.x -> 'dna') with ordinality as d(v, n) order by d.n
      )::uuid[]
      else t.dna
    end,
    description = case when e.x ? 'description' then e.x ->> 'description' else t.description end
  from jsonb_array_elements(p_rows) as e(x)
  where t.collection_id = p_collection_id and t.token_id = (e.x ->> 'tokenId')::integer;
end;
$$;

revoke all on function public.art_update_tokens(uuid, jsonb) from public, anon;
grant execute on function public.art_update_tokens(uuid, jsonb) to authenticated;

-- Deletes tokens and moves every later id up by the number of deleted ids below it, in one
-- set-based update under the deferrable primary key, so ids stay 1 to N.
create function public.art_delete_tokens(p_collection_id uuid, p_ids integer[])
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_gone integer[];
begin
  perform private.art_lock_owned(p_collection_id);
  with gone as (
    delete from public.tokens t
    where t.collection_id = p_collection_id and t.token_id = any (p_ids)
    returning t.token_id
  )
  select coalesce(array_agg(gone.token_id), '{}') into v_gone from gone;
  if cardinality(v_gone) = 0 then
    return;
  end if;
  update public.tokens t
  set token_id = t.token_id - (select count(*) from unnest(v_gone) as g(id) where g.id < t.token_id)::integer
  where t.collection_id = p_collection_id
    and t.token_id > (select min(g.id) from unnest(v_gone) as g(id));
end;
$$;

revoke all on function public.art_delete_tokens(uuid, integer[]) from public, anon;
grant execute on function public.art_delete_tokens(uuid, integer[]) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Assets and starting over
-- ---------------------------------------------------------------------------------------------

-- Writes the list order of a 1/1 or single asset project's files from [{ uploadId, position }].
create function public.art_set_asset_order(p_collection_id uuid, p_rows jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform private.art_lock_owned(p_collection_id);
  update public.uploads u
  set position = (e.x ->> 'position')::integer
  from jsonb_array_elements(p_rows) as e(x)
  where u.collection_id = p_collection_id and u.kind = 'asset' and u.id = (e.x ->> 'uploadId')::uuid;
end;
$$;

revoke all on function public.art_set_asset_order(uuid, jsonb) from public, anon;
grant execute on function public.art_set_asset_order(uuid, jsonb) to authenticated;

-- Empties a project's art: tokens, rules, groups, layers (traits cascade), art collections, the
-- layer images and the thumbnails only they used. The canvas and the seed are cleared, so any image
-- size can be uploaded again. Returns the deleted storage keys, for the action to delete the objects.
create function public.art_start_over(p_collection_id uuid)
returns text[]
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_keys text[];
begin
  perform private.art_lock_owned(p_collection_id, true);
  update public.collections c
  set canvas_width = null, canvas_height = null, generation_seed = null
  where c.id = p_collection_id;
  delete from public.tokens t where t.collection_id = p_collection_id;
  delete from public.rules r where r.collection_id = p_collection_id;
  delete from public.at_least_one g where g.collection_id = p_collection_id;
  delete from public.layers l where l.collection_id = p_collection_id;
  delete from public.art_collections a where a.collection_id = p_collection_id;
  with gone as (
    delete from public.uploads u
    where u.collection_id = p_collection_id
      and (
        u.kind = 'layer_image'
        or (
          u.kind = 'thumbnail'
          and exists (
            select 1 from public.uploads l
            where l.collection_id = p_collection_id and l.kind = 'layer_image' and l.content_hash = u.content_hash
          )
          and not exists (
            select 1 from public.uploads o
            where o.collection_id = p_collection_id and o.kind in ('asset', 'placeholder')
              and o.content_hash = u.content_hash
          )
        )
      )
    returning u.storage_key
  )
  select coalesce(array_agg(gone.storage_key), '{}') into v_keys from gone;
  return v_keys;
end;
$$;

revoke all on function public.art_start_over(uuid) from public, anon;
grant execute on function public.art_start_over(uuid) to authenticated;
```

- [ ] **Step 4: Reset, run, expect pass**

Run:

```bash
supabase db reset 2>&1 | tail -3
supabase seed buckets
pnpm --filter @cobweb/web verify:local 2>&1 | grep -E '^(FAIL|INFO|[0-9]+ passed)'
```

Expected: no `FAIL` lines; an `INFO 10,000 tokens saved and 3 deleted in <n> ms` line under 5,000; the summary ends `0 failed`. If the reset prints an error, fix the SQL and run the three commands again.

- [ ] **Step 5: Regenerate the types; root checks**

Run:

```bash
supabase gen types typescript --local > apps/web/src/lib/database.types.ts
pnpm exec prettier --write apps/web/src/lib/database.types.ts
pnpm typecheck && pnpm lint && pnpm test
```

Expected: `Database['public']['Functions']` now lists `art_import_layers` (Returns `Json`), `art_move_layer`, `art_delete_layer`, `art_delete_trait`, `art_delete_art_collection`, `art_set_layer_weights`, `art_save_tokens`, `art_update_tokens`, `art_delete_tokens`, `art_set_asset_order` (Returns `undefined`) and `art_start_over` (Returns `string[]`); root checks pass.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261009010000_art_edit_functions.sql apps/web/scripts/verify-local.ts apps/web/src/lib/database.types.ts
git commit -F - <<'MSG'
Add the art edit functions and check them in verify:local section 9f

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011bcHX4HZG5YGWhxjGuiWos
MSG
```

### Task 3: The Art server actions, their input rules and the error mapping

**Files:**

- Create: `apps/web/src/lib/art/db-error.ts`, `apps/web/src/lib/art/schemas.ts`, `apps/web/src/lib/art/write.ts`, `apps/web/src/lib/art/token-ops.ts`
- Create: `apps/web/src/app/actions/art/art-collections.ts`, `layers.ts`, `traits.ts`, `rules.ts`, `at-least-one.ts`, `tokens.ts`, `settings.ts`, `project.ts`
- Test: `apps/web/src/lib/art/db-error.test.ts`, `apps/web/src/lib/art/schemas.test.ts`, `apps/web/src/lib/art/token-ops.test.ts`
- Modify: `apps/web/next.config.ts` (server action body limit)

**Interfaces:**

- Consumes: Task 1's `ActionResult`, `done`, `fail` and sentences from `@/lib/art/result`; `ownedUnlocked`, `ArtClient`, `OwnedCollection` from `@/lib/art/owned`; `ruleKindToDb` and `WeightRow` from `@/lib/art/rows`; Task 2's functions through `supabase.rpc`; `tokenNameProblem(name: string): string | null` from `@/components/art/state/generation`; `NEW_COLLECTION_SIZE` from `@/components/art/state/collection-edits`; `isBidirectional` from `@cobweb/dna`; `deleteObjects(keys: string[]): Promise<void>` from `@/lib/storage/objects`.
- Produces:
  - `db-error.ts`: `type DbError = { code?: string; message: string } | null`; `artWriteError(error: DbError): string`.
  - `schemas.ts`: `parse<S extends z.ZodType>(schema: S, input: unknown): { ok: true; data: z.output<S> } | { ok: false; error: string }`; schemas `uuid`, `artName`, `traitName`, `weightTable`, `ruleInput`, `groupTraits`, `newTraits`, `artSettings`, `importPayload`, `tokenSet`, `tokenPatches`, `seed`, `artCollectionSize`; types `RuleInput = { kind: RuleKind; traitId: string; relatedTraitIds: string[] }`, `NewTraitInput = { name: string; uploadId: string }`, `ArtSettingsPatch = { tokenName?: string; tokenDescription?: string; showBlankTraits?: boolean; artDeferred?: boolean }`, `ImportPayload`, `ImportResult = { collections: { id: string; layers: { id: string; traits: { id: string }[] }[] }[] }`.
  - `write.ts` (server only): `artWrite<T>(collectionId: string, write: (ctx: ArtContext) => Promise<Outcome<T>>): Promise<ActionResult<T>>`; `created<T>(query)`, `one(query)`, `ran(query)`; `type ArtContext = { supabase: ArtClient; collection: OwnedCollection; collectionId: string }`.
  - `token-ops.ts` (pure): `type TokenInput = { tokenId: number; artCollectionId: string; dna: string[]; description: string | null }`; `type TokenPatch = { tokenId: number; dna?: string[]; description?: string | null }`; `tokenInputs(tokens: GeneratedToken[]): TokenInput[]`; `changedTokens(before: GeneratedToken[], after: GeneratedToken[]): TokenPatch[]`; `appendedTokens(before: GeneratedToken[], after: GeneratedToken[]): TokenInput[]`; `saveLimitProblem(count: number): string | null` (compares against `MAX_SUPPLY` from `@/lib/collections`).
  - Actions (every one returns `Promise<ActionResult<...>>`):
    - `art-collections.ts`: `addArtCollection(collectionId, name): { id: string }`; `renameArtCollection(collectionId, id, name)`; `setArtCollectionSize(collectionId, id, size)`; `deleteArtCollection(collectionId, id)`.
    - `layers.ts`: `addLayer(collectionId, artCollectionId, name): { id: string }`; `renameLayer(collectionId, id, name, displayName: string | null)`; `moveLayer(collectionId, id, position)`; `deleteLayer(collectionId, id, clearTokens: boolean)`; `importLayers(collectionId, payload: ImportPayload): ImportResult`.
    - `traits.ts`: `addTraits(collectionId, layerId, items: NewTraitInput[]): { ids: string[] }`; `renameTrait(collectionId, id, name)`; `setLayerWeights(collectionId, layerId, rows: WeightRow[])`; `setBlank(collectionId, layerId, on): { id: string | null }`; `setTraitMetadata(collectionId, id, inMetadata)`; `deleteTrait(collectionId, id)`.
    - `rules.ts`: `addRule(collectionId, rule: RuleInput): { id: string }`; `updateRule(collectionId, id, rule: RuleInput)`; `deleteRule(collectionId, id)`.
    - `at-least-one.ts`: `addAtLeastOne(collectionId, artCollectionId, traitIds): { id: string }`; `updateAtLeastOne(collectionId, id, traitIds)`; `deleteAtLeastOne(collectionId, id)`.
    - `tokens.ts`: `saveTokens(collectionId, tokens: TokenInput[], seed: number)`; `updateTokens(collectionId, rows: TokenPatch[])`; `swapTokens(collectionId, a, b)`; `deleteTokens(collectionId, ids: number[])`; `appendTokens(collectionId, tokens: TokenInput[])`; `clearTokens(collectionId)`.
    - `settings.ts`: `updateArtSettings(collectionId, patch: ArtSettingsPatch)`.
    - `project.ts`: `startOver(collectionId)`.

Decision: `setBlank(collectionId, layerId, false)` deletes the blank through `art_delete_trait`, so rules and groups that named it are pruned and positions close, like any trait delete.

Decision: a new art collection is created with size 100 (`NEW_COLLECTION_SIZE`, what the browser shows); a folder import creates them at 0 (what `mergeUpload` shows).

Decision: the server action body limit rises to 64 MB, because a save is about 400 bytes of JSON per token (one uuid per layer), so a 100,000-token save (`MAX_SUPPLY`) is about 40 MB.

- [ ] **Step 1: Write the failing tests**

`apps/web/src/lib/art/db-error.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { artWriteError } from './db-error'
import { CLEAR_FIRST, LOCKED, NOT_FOUND, UNSAVED } from './result'

describe('artWriteError', () => {
  it('maps 42501 to not found or locked', () => {
    expect(artWriteError({ code: '42501', message: 'collection not found' })).toBe(NOT_FOUND)
    expect(artWriteError({ code: '42501', message: LOCKED })).toBe(LOCKED)
    expect(artWriteError({ code: '42501', message: 'new row violates row-level security policy' })).toBe(
      LOCKED,
    )
  })

  it('passes the guard sentences through', () => {
    for (const sentence of [
      'A layer can have at most 500 traits.',
      'Token DNA does not match the layers.',
      'This collection already has layers. Start over to replace them.',
      'A project can have at most 100,000 tokens.',
      'This project has reached its 5 GB of files. Delete some files to upload more.',
      'Every layer image must be 1000 x 1000 in this project.',
    ])
      expect(artWriteError({ code: '23514', message: sentence })).toBe(sentence)
  })

  it('rewords the layer guard for a screen that did not offer to clear the tokens', () => {
    const message =
      'The layers cannot be added, reordered or removed while the collection has tokens. Clear the tokens first.'
    expect(artWriteError({ code: '23514', message })).toBe(CLEAR_FIRST)
  })

  it('says "reload" for anything else, constraint names included', () => {
    expect(
      artWriteError({ code: '23514', message: 'new row violates check constraint "traits_weight_check"' }),
    ).toBe(UNSAVED)
    expect(artWriteError({ code: '23505', message: 'duplicate key value violates unique constraint' })).toBe(
      UNSAVED,
    )
    expect(artWriteError({ code: 'P0002', message: 'layer not found' })).toBe(UNSAVED)
    expect(artWriteError(null)).toBe(UNSAVED)
  })
})
```

`apps/web/src/lib/art/schemas.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  artName,
  artSettings,
  groupTraits,
  importPayload,
  parse,
  ruleInput,
  tokenSet,
  traitName,
  weightTable,
} from './schemas'

const id = '0f4a0f3e-2f5e-4e3a-9d1c-1b2c3d4e5f60'
const other = '1f4a0f3e-2f5e-4e3a-9d1c-1b2c3d4e5f61'
const error = (result: { ok: boolean; error?: string }) => (result.ok ? null : result.error)

describe('the input rules of spec section 6, one failing row each', () => {
  it('a weight is 0 to 100 with two decimals', () => {
    expect(error(parse(weightTable, [{ traitId: id, weight: 33.33, constant: null }]))).toBeNull()
    expect(error(parse(weightTable, [{ traitId: id, weight: 100.5, constant: null }]))).toBe(
      'A weight is a percent from 0 to 100.',
    )
    expect(error(parse(weightTable, [{ traitId: id, weight: -1, constant: null }]))).toBe(
      'A weight is a percent from 0 to 100.',
    )
    expect(error(parse(weightTable, [{ traitId: id, weight: 12.345, constant: null }]))).toBe(
      'A weight has at most two decimals.',
    )
  })

  it('a constant is 1 to 10,000 and forces the weight to 0', () => {
    expect(error(parse(weightTable, [{ traitId: id, weight: 0, constant: 0 }]))).toBe(
      'A fixed quantity is a whole number from 1 to 10,000.',
    )
    expect(error(parse(weightTable, [{ traitId: id, weight: 0, constant: 10_001 }]))).toBe(
      'A fixed quantity is a whole number from 1 to 10,000.',
    )
    const parsed = parse(weightTable, [{ traitId: id, weight: 20, constant: 5 }])
    expect(parsed.ok && parsed.data[0]).toEqual({ traitId: id, weight: 0, constant: 5 })
  })

  it('names are 1 to 48 characters, trait names 1 to 64', () => {
    expect(error(parse(artName, 'Eyes'))).toBeNull()
    expect(error(parse(artName, '   '))).toBe('A name needs 1 to 48 characters.')
    expect(error(parse(artName, 'x'.repeat(49)))).toBe('A name needs 1 to 48 characters.')
    expect(error(parse(traitName, 'x'.repeat(64)))).toBeNull()
    expect(error(parse(traitName, 'x'.repeat(65)))).toBe('A trait name needs 1 to 64 characters.')
  })

  it("a rule's related traits are at least one", () => {
    expect(
      error(parse(ruleInput, { kind: 'must pair with', traitId: id, relatedTraitIds: [other] })),
    ).toBeNull()
    expect(error(parse(ruleInput, { kind: 'must pair with', traitId: id, relatedTraitIds: [] }))).toBe(
      'A rule needs at least one related trait.',
    )
  })

  it('an "at least one" group has at least two traits', () => {
    expect(error(parse(groupTraits, [id, other]))).toBeNull()
    expect(error(parse(groupTraits, [id]))).toBe('An "at least one" group needs at least two traits.')
  })

  it('the token name follows tokenNameProblem, the description is at most 500 characters', () => {
    expect(error(parse(artSettings, { tokenName: 'Night Owl' }))).toBeNull()
    expect(error(parse(artSettings, { tokenName: 'Owl #1' }))).toBe(
      'A token name cannot contain #, quotes or backticks.',
    )
    expect(error(parse(artSettings, { tokenName: '  ' }))).toBe('Enter a token name.')
    expect(error(parse(artSettings, { tokenName: 'x'.repeat(65) }))).toBe(
      'A token name has at most 64 characters.',
    )
    expect(error(parse(artSettings, { tokenDescription: 'x'.repeat(501) }))).toBe(
      'A description has at most 500 characters.',
    )
  })

  it('a save carries at most 100,000 tokens', () => {
    const token = (tokenId: number) => ({ tokenId, artCollectionId: id, dna: [other], description: null })
    expect(error(parse(tokenSet, [token(1)]))).toBeNull()
    expect(
      error(
        parse(
          tokenSet,
          Array.from({ length: 100_001 }, (_, i) => token(i + 1)),
        ),
      ),
    ).toBe('A project can have at most 100,000 tokens.')
  })

  it('an import needs at least one collection and a stored image per trait', () => {
    expect(error(parse(importPayload, { collections: [], activeCollectionId: null }))).toBe(
      'The folder has no layers to import.',
    )
    const payload = {
      collections: [
        { name: 'Owls', layers: [{ name: 'Eyes', traits: [{ name: 'Wide', uploadId: 'blob:x' }] }] },
      ],
      activeCollectionId: null,
    }
    expect(error(parse(importPayload, payload))).toBe(
      'That change could not be saved. Reload the page and try again.',
    )
  })
})
```

`apps/web/src/lib/art/token-ops.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { GeneratedToken } from '@/lib/demo'
import { appendedTokens, changedTokens, saveLimitProblem, tokenInputs } from './token-ops'

const token = (id: number, dna: string[], description?: string): GeneratedToken => ({
  id,
  collectionId: 'art-1',
  dna,
  name: `Owl #${id}`,
  rank: id,
  previewUrl: null,
  ...(description === undefined ? {} : { description }),
})

describe('token operations', () => {
  it('turns the store tokens into saved rows; names and ranks are not sent', () => {
    expect(tokenInputs([token(1, ['a', 'b'], 'Hi'), token(2, ['a', 'c'])])).toEqual([
      { tokenId: 1, artCollectionId: 'art-1', dna: ['a', 'b'], description: 'Hi' },
      { tokenId: 2, artCollectionId: 'art-1', dna: ['a', 'c'], description: null },
    ])
  })

  it('sends only the rows whose DNA or description changed (re-roll, change one trait, describe)', () => {
    const before = [token(1, ['a', 'b'], 'x'), token(2, ['a', 'c'], 'x'), token(3, ['b', 'c'], 'x')]
    const after = [token(1, ['a', 'b'], 'x'), token(2, ['b', 'b'], 'x'), token(3, ['b', 'c'], 'y')]
    expect(changedTokens(before, after)).toEqual([
      { tokenId: 2, dna: ['b', 'b'] },
      { tokenId: 3, description: 'y' },
    ])
  })

  it('appends only the tokens past the last id (fill to size)', () => {
    const before = [token(1, ['a']), token(2, ['b'])]
    const after = [...before, token(3, ['c'])]
    expect(appendedTokens(before, after)).toEqual([
      { tokenId: 3, artCollectionId: 'art-1', dna: ['c'], description: null },
    ])
  })

  it('refuses more than 100,000 tokens before anything is generated', () => {
    expect(saveLimitProblem(100_000)).toBeNull()
    expect(saveLimitProblem(100_001)).toBe('A project can have at most 100,000 tokens.')
  })
})
```

- [ ] **Step 2: Run, expect failure**

Run: `pnpm --filter @cobweb/web exec vitest run src/lib/art/db-error.test.ts src/lib/art/schemas.test.ts src/lib/art/token-ops.test.ts`
Expected: FAIL, `Failed to resolve import "./db-error"`, `"./schemas"` and `"./token-ops"`.

- [ ] **Step 3: Implement the pure modules**

`apps/web/src/lib/art/db-error.ts`:

```ts
import {
  CLEAR_FIRST,
  DNA_MISMATCH,
  IMPORT_REFUSED,
  LOCKED,
  NOT_FOUND,
  SAVE_CAP,
  TRAIT_CAP,
  UNSAVED,
  UPLOAD_CAP,
} from './result'

export type DbError = { code?: string; message: string } | null

/** Sentences the database raises that the creator reads as they are (spec section 7). */
const PASS_THROUGH = new Set([LOCKED, TRAIT_CAP, DNA_MISMATCH, IMPORT_REFUSED, SAVE_CAP, UPLOAD_CAP])
const CANVAS = /^Every layer image must be \d+ x \d+ in this project\.$/

/** A failed art write, by SQLSTATE, in the creator's words (spec section 6). */
export function artWriteError(error: DbError): string {
  if (!error) return UNSAVED
  if (error.code === '42501') return error.message === 'collection not found' ? NOT_FOUND : LOCKED
  if (error.code === '23514' || error.code === '23505') {
    // layers_guard_tokens ends "Clear the tokens first."; the screens that offer to clear never hit it.
    if (error.message.endsWith('Clear the tokens first.')) return CLEAR_FIRST
    if (PASS_THROUGH.has(error.message) || CANVAS.test(error.message)) return error.message
  }
  return UNSAVED
}
```

`apps/web/src/lib/art/token-ops.ts`:

```ts
import { MAX_SUPPLY } from '@/lib/collections'
import type { GeneratedToken } from '@/lib/demo'
import { SAVE_CAP } from './result'

/**
 * How the Generate screen's edits on the set become token rows (spec section 8). Names and ranks
 * are computed, never stored, so only ids, art collections, DNA and descriptions travel.
 */
export type TokenInput = {
  tokenId: number
  artCollectionId: string
  dna: string[]
  description: string | null
}
export type TokenPatch = { tokenId: number; dna?: string[]; description?: string | null }

export function tokenInputs(tokens: GeneratedToken[]): TokenInput[] {
  return tokens.map((token) => ({
    tokenId: token.id,
    artCollectionId: token.collectionId,
    dna: token.dna,
    description: token.description ?? null,
  }))
}

const sameDna = (a: string[], b: string[]) => a.length === b.length && a.every((id, i) => id === b[i])

/** The rows whose DNA or description changed between two versions of the set with the same ids. */
export function changedTokens(before: GeneratedToken[], after: GeneratedToken[]): TokenPatch[] {
  const old = new Map(before.map((token) => [token.id, token]))
  const patches: TokenPatch[] = []
  for (const token of after) {
    const was = old.get(token.id)
    if (!was) continue
    const patch: TokenPatch = { tokenId: token.id }
    if (!sameDna(was.dna, token.dna)) patch.dna = token.dna
    if ((was.description ?? null) !== (token.description ?? null))
      patch.description = token.description ?? null
    if (patch.dna !== undefined || patch.description !== undefined) patches.push(patch)
  }
  return patches
}

/** The tokens added after the last id of the set before (Fill to size). */
export function appendedTokens(before: GeneratedToken[], after: GeneratedToken[]): TokenInput[] {
  const last = before.reduce((max, token) => Math.max(max, token.id), 0)
  return tokenInputs(after.filter((token) => token.id > last))
}

/** Why a set of this many tokens cannot be saved, worded for the creator, or null. */
export function saveLimitProblem(count: number): string | null {
  if (count <= MAX_SUPPLY) return null
  return SAVE_CAP
}
```

`apps/web/src/lib/art/schemas.ts`:

```ts
import { z } from 'zod'
import { tokenNameProblem } from '@/components/art/state/generation'
import { SAVE_CAP, TRAIT_CAP, UNSAVED } from './result'
import { MAX_SUPPLY } from '@/lib/collections'

/**
 * The input rules the Art actions check before the database does, so the creator reads a sentence
 * and not a constraint name (spec section 6). Pure, so the tests run them directly.
 */
export function parse<S extends z.ZodType>(
  schema: S,
  input: unknown,
): { ok: true; data: z.output<S> } | { ok: false; error: string } {
  const result = schema.safeParse(input)
  return result.success
    ? { ok: true, data: result.data }
    : { ok: false, error: result.error.issues[0]?.message ?? UNSAVED }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const NAME = 'A name needs 1 to 48 characters.'
const TRAIT_NAME = 'A trait name needs 1 to 64 characters.'
const WEIGHT = 'A weight is a percent from 0 to 100.'
const CONSTANT = 'A fixed quantity is a whole number from 1 to 10,000.'
const DESCRIPTION = 'A description has at most 500 characters.'
const SIZE = 'A size is a whole number from 0 to 10,000.'

/** A row id from the browser. A malformed one means the page is out of date. */
export const uuid = z.string().regex(UUID, UNSAVED)
export const artName = z.string().trim().min(1, NAME).max(48, NAME)
export const traitName = z.string().trim().min(1, TRAIT_NAME).max(64, TRAIT_NAME)
export const artCollectionSize = z.number().int(SIZE).min(0, SIZE).max(10_000, SIZE)

const twoDecimals = (value: number) => Math.abs(Math.round(value * 100) - value * 100) < 1e-6

export const weightTable = z
  .array(
    z
      .object({
        traitId: uuid,
        weight: z
          .number()
          .min(0, WEIGHT)
          .max(100, WEIGHT)
          .refine(twoDecimals, 'A weight has at most two decimals.'),
        constant: z.number().int(CONSTANT).min(1, CONSTANT).max(10_000, CONSTANT).nullable(),
      })
      // A constant is a cap on a number of tokens, not a share.
      .transform((row) => (row.constant === null ? row : { ...row, weight: 0 })),
  )
  .max(500, TRAIT_CAP)

export const ruleInput = z.object({
  kind: z.enum(["doesn't mix with", 'always pairs with', 'must pair with'], { error: UNSAVED }),
  traitId: uuid,
  relatedTraitIds: z.array(uuid).min(1, 'A rule needs at least one related trait.'),
})
export type RuleInput = z.infer<typeof ruleInput>

export const groupTraits = z.array(uuid).min(2, 'An "at least one" group needs at least two traits.')

export const newTraits = z
  .array(z.object({ name: traitName, uploadId: uuid }))
  .min(1, UNSAVED)
  .max(500, TRAIT_CAP)
export type NewTraitInput = z.infer<typeof newTraits>[number]

export const tokenName = z
  .string()
  .max(64, 'A token name has at most 64 characters.')
  .superRefine((value, ctx) => {
    const problem = tokenNameProblem(value)
    if (problem) ctx.addIssue({ code: 'custom', message: problem })
  })
  .transform((value) => value.trim())

export const artSettings = z
  .object({
    tokenName: tokenName.optional(),
    tokenDescription: z.string().max(500, DESCRIPTION).optional(),
    showBlankTraits: z.boolean().optional(),
    artDeferred: z.boolean().optional(),
  })
  .strict()
export type ArtSettingsPatch = z.input<typeof artSettings>

export const importPayload = z.object({
  collections: z
    .array(
      z.object({
        name: artName,
        layers: z.array(
          z.object({
            name: artName,
            traits: z
              .array(z.object({ name: traitName, uploadId: uuid }))
              .min(1, UNSAVED)
              .max(500, TRAIT_CAP),
          }),
        ),
      }),
    )
    .min(1, 'The folder has no layers to import.'),
  activeCollectionId: uuid.nullable(),
})
export type ImportPayload = z.infer<typeof importPayload>
export type ImportResult = {
  collections: { id: string; layers: { id: string; traits: { id: string }[] }[] }[]
}

const tokenId = z.number().int(UNSAVED).min(1, UNSAVED).max(100_000, UNSAVED)
const dna = z.array(uuid).max(200, UNSAVED)
const tokenDescription = z.string().max(500, DESCRIPTION).nullable()

export const tokenSet = z
  .array(z.object({ tokenId, artCollectionId: uuid, dna, description: tokenDescription }))
  .max(MAX_SUPPLY, SAVE_CAP)
export const tokenPatches = z
  .array(z.object({ tokenId, dna: dna.optional(), description: tokenDescription.optional() }))
  .max(MAX_SUPPLY, SAVE_CAP)
export const tokenIds = z.array(tokenId).max(MAX_SUPPLY, SAVE_CAP)
export const seed = z.number().int(UNSAVED).min(0, UNSAVED).max(4_294_967_295, UNSAVED)
```

- [ ] **Step 4: Run, expect pass**

Run: `pnpm --filter @cobweb/web exec vitest run src/lib/art/db-error.test.ts src/lib/art/schemas.test.ts src/lib/art/token-ops.test.ts`
Expected: 16 tests pass.

- [ ] **Step 5: Implement the write helper and the actions**

`apps/web/src/lib/art/write.ts`:

```ts
import 'server-only'
import { artWriteError } from './db-error'
import { ownedUnlocked, type ArtClient, type OwnedCollection } from './owned'
import { fail, type ActionResult } from './result'

type WriteError = { code?: string; message: string }
export type Outcome<T> = { data: T } | { error: WriteError }
export type ArtContext = { supabase: ArtClient; collection: OwnedCollection; collectionId: string }

const MISSING: WriteError = { code: 'P0002', message: 'no row' }

/**
 * Runs an art write for the signed-in owner of an unlocked collection. A refusal before the write is
 * returned as it is; a database error becomes the creator's sentence (`artWriteError`).
 */
export async function artWrite<T>(
  collectionId: string,
  write: (ctx: ArtContext) => Promise<Outcome<T>>,
): Promise<ActionResult<T>> {
  const owned = await ownedUnlocked(collectionId)
  if (owned.error !== undefined) return fail(owned.error)
  const outcome = await write({ supabase: owned.supabase, collection: owned.collection, collectionId })
  return 'error' in outcome ? fail(artWriteError(outcome.error)) : { ok: true, data: outcome.data }
}

/** An insert that returns its new row (`.select(...).single()`). */
export async function created<T>(
  query: PromiseLike<{ data: T | null; error: WriteError | null }>,
): Promise<Outcome<T>> {
  const { data, error } = await query
  if (error) return { error }
  return data === null ? { error: MISSING } : { data }
}

/** An update or delete of one row, asked to return it (`.select('id')`): no row means it was not there. */
export async function one(
  query: PromiseLike<{ data: unknown[] | null; error: WriteError | null }>,
): Promise<Outcome<undefined>> {
  const { data, error } = await query
  if (error) return { error }
  return data && data.length > 0 ? { data: undefined } : { error: MISSING }
}

/** A write whose only result is its error: a function call, or a delete of any number of rows. */
export async function ran(query: PromiseLike<{ error: WriteError | null }>): Promise<Outcome<undefined>> {
  const { error } = await query
  return error ? { error } : { data: undefined }
}
```

`apps/web/src/app/actions/art/art-collections.ts`:

```ts
'use server'

import { z } from 'zod'
import { NEW_COLLECTION_SIZE } from '@/components/art/state/collection-edits'
import type { ActionResult } from '@/lib/art/result'
import { artCollectionSize, artName, parse, uuid } from '@/lib/art/schemas'
import { artWrite, created, one, ran } from '@/lib/art/write'

/** Adds an art collection after the last one. */
export async function addArtCollection(
  collectionId: string,
  name: string,
): Promise<ActionResult<{ id: string }>> {
  const input = parse(artName, name)
  if (!input.ok) return input
  return artWrite(collectionId, async ({ supabase }) => {
    const { data: last } = await supabase
      .from('art_collections')
      .select('position')
      .eq('collection_id', collectionId)
      .order('position', { ascending: false })
      .limit(1)
      .maybeSingle()
    return created(
      supabase
        .from('art_collections')
        .insert({
          collection_id: collectionId,
          name: input.data,
          size: NEW_COLLECTION_SIZE,
          position: (last?.position ?? -1) + 1,
        })
        .select('id')
        .single(),
    )
  })
}

export async function renameArtCollection(
  collectionId: string,
  id: string,
  name: string,
): Promise<ActionResult> {
  const input = parse(z.object({ id: uuid, name: artName }), { id, name })
  if (!input.ok) return input
  return artWrite(collectionId, ({ supabase }) =>
    one(
      supabase
        .from('art_collections')
        .update({ name: input.data.name })
        .eq('id', input.data.id)
        .eq('collection_id', collectionId)
        .select('id'),
    ),
  )
}

export async function setArtCollectionSize(
  collectionId: string,
  id: string,
  size: number,
): Promise<ActionResult> {
  const input = parse(z.object({ id: uuid, size: artCollectionSize }), { id, size })
  if (!input.ok) return input
  return artWrite(collectionId, ({ supabase }) =>
    one(
      supabase
        .from('art_collections')
        .update({ size: input.data.size })
        .eq('id', input.data.id)
        .eq('collection_id', collectionId)
        .select('id'),
    ),
  )
}

/** Deletes an art collection with everything in it; the later token ids close up (`art_delete_art_collection`). */
export async function deleteArtCollection(collectionId: string, id: string): Promise<ActionResult> {
  const input = parse(uuid, id)
  if (!input.ok) return input
  return artWrite(collectionId, ({ supabase }) =>
    ran(
      supabase.rpc('art_delete_art_collection', {
        p_collection_id: collectionId,
        p_art_collection_id: input.data,
      }),
    ),
  )
}
```

`apps/web/src/app/actions/art/layers.ts`:

```ts
'use server'

import { z } from 'zod'
import type { ActionResult } from '@/lib/art/result'
import { artName, importPayload, parse, uuid, type ImportPayload, type ImportResult } from '@/lib/art/schemas'
import { artWrite, created, one, ran } from '@/lib/art/write'

/** Adds a layer on top of an art collection's stack. The database refuses while that collection has tokens. */
export async function addLayer(
  collectionId: string,
  artCollectionId: string,
  name: string,
): Promise<ActionResult<{ id: string }>> {
  const input = parse(z.object({ artCollectionId: uuid, name: artName }), { artCollectionId, name })
  if (!input.ok) return input
  return artWrite(collectionId, async ({ supabase }) => {
    const { data: top } = await supabase
      .from('layers')
      .select('position')
      .eq('art_collection_id', input.data.artCollectionId)
      .order('position', { ascending: false })
      .limit(1)
      .maybeSingle()
    return created(
      supabase
        .from('layers')
        .insert({
          collection_id: collectionId,
          art_collection_id: input.data.artCollectionId,
          name: input.data.name,
          position: (top?.position ?? -1) + 1,
        })
        .select('id')
        .single(),
    )
  })
}

export async function renameLayer(
  collectionId: string,
  id: string,
  name: string,
  displayName: string | null,
): Promise<ActionResult> {
  const input = parse(z.object({ id: uuid, name: artName, displayName: artName.nullable() }), {
    id,
    name,
    displayName,
  })
  if (!input.ok) return input
  return artWrite(collectionId, ({ supabase }) =>
    one(
      supabase
        .from('layers')
        .update({ name: input.data.name, display_name: input.data.displayName })
        .eq('id', input.data.id)
        .eq('collection_id', collectionId)
        .select('id'),
    ),
  )
}

/** Moves a layer to `position` in its stack (`art_move_layer`); refused while the collection has tokens. */
export async function moveLayer(collectionId: string, id: string, position: number): Promise<ActionResult> {
  const input = parse(z.object({ id: uuid, position: z.number().int().min(0) }), { id, position })
  if (!input.ok) return input
  return artWrite(collectionId, ({ supabase }) =>
    ran(
      supabase.rpc('art_move_layer', {
        p_collection_id: collectionId,
        p_layer_id: input.data.id,
        p_position: input.data.position,
      }),
    ),
  )
}

/** Deletes a layer and prunes its rules and groups; `clearTokens` clears the project's tokens first. */
export async function deleteLayer(
  collectionId: string,
  id: string,
  clearTokens: boolean,
): Promise<ActionResult> {
  const input = parse(z.object({ id: uuid, clearTokens: z.boolean() }), { id, clearTokens })
  if (!input.ok) return input
  return artWrite(collectionId, ({ supabase }) =>
    ran(
      supabase.rpc('art_delete_layer', {
        p_collection_id: collectionId,
        p_layer_id: input.data.id,
        p_clear_tokens: input.data.clearTokens,
      }),
    ),
  )
}

/** The folder upload's collections, layers and traits in one transaction (`art_import_layers`). */
export async function importLayers(
  collectionId: string,
  payload: ImportPayload,
): Promise<ActionResult<ImportResult>> {
  const input = parse(importPayload, payload)
  if (!input.ok) return input
  return artWrite(collectionId, async ({ supabase }) => {
    const { data, error } = await supabase.rpc('art_import_layers', {
      p_collection_id: collectionId,
      p_payload: input.data,
    })
    if (error) return { error }
    return { data: data as unknown as ImportResult }
  })
}
```

`apps/web/src/app/actions/art/traits.ts`:

```ts
'use server'

import { z } from 'zod'
import type { ActionResult } from '@/lib/art/result'
import type { WeightRow } from '@/lib/art/rows'
import { newTraits, parse, traitName, uuid, weightTable, type NewTraitInput } from '@/lib/art/schemas'
import { artWrite, created, one, ran } from '@/lib/art/write'

/** Adds stored images to a layer as traits at 0%, after its last trait. Returns their ids in order. */
export async function addTraits(
  collectionId: string,
  layerId: string,
  items: NewTraitInput[],
): Promise<ActionResult<{ ids: string[] }>> {
  const input = parse(z.object({ layerId: uuid, items: newTraits }), { layerId, items })
  if (!input.ok) return input
  return artWrite(collectionId, async ({ supabase }) => {
    const { data: top } = await supabase
      .from('traits')
      .select('position')
      .eq('layer_id', input.data.layerId)
      .order('position', { ascending: false })
      .limit(1)
      .maybeSingle()
    const first = (top?.position ?? -1) + 1
    const { data, error } = await supabase
      .from('traits')
      .insert(
        input.data.items.map((item, i) => ({
          collection_id: collectionId,
          layer_id: input.data.layerId,
          name: item.name,
          weight: 0,
          upload_id: item.uploadId,
          position: first + i,
        })),
      )
      .select('id, position')
    if (error) return { error }
    return { data: { ids: [...data].sort((a, b) => a.position - b.position).map((row) => row.id) } }
  })
}

export async function renameTrait(collectionId: string, id: string, name: string): Promise<ActionResult> {
  const input = parse(z.object({ id: uuid, name: traitName }), { id, name })
  if (!input.ok) return input
  return artWrite(collectionId, ({ supabase }) =>
    one(
      supabase
        .from('traits')
        .update({ name: input.data.name })
        .eq('id', input.data.id)
        .eq('collection_id', collectionId)
        .select('id'),
    ),
  )
}

/** The layer's whole weight table, checked as one (`art_set_layer_weights`). */
export async function setLayerWeights(
  collectionId: string,
  layerId: string,
  rows: WeightRow[],
): Promise<ActionResult> {
  const input = parse(z.object({ layerId: uuid, rows: weightTable }), { layerId, rows })
  if (!input.ok) return input
  return artWrite(collectionId, ({ supabase }) =>
    ran(
      supabase.rpc('art_set_layer_weights', {
        p_collection_id: collectionId,
        p_layer_id: input.data.layerId,
        p_rows: input.data.rows,
      }),
    ),
  )
}

/** Adds the layer's blank trait at 0% (returning its id), or deletes it like any trait. */
export async function setBlank(
  collectionId: string,
  layerId: string,
  on: boolean,
): Promise<ActionResult<{ id: string | null }>> {
  const input = parse(z.object({ layerId: uuid, on: z.boolean() }), { layerId, on })
  if (!input.ok) return input
  return artWrite(collectionId, async ({ supabase }) => {
    const { data: blank } = await supabase
      .from('traits')
      .select('id')
      .eq('layer_id', input.data.layerId)
      .eq('blank', true)
      .maybeSingle()
    if (!input.data.on) {
      if (!blank) return { data: { id: null } }
      const { error } = await supabase.rpc('art_delete_trait', {
        p_collection_id: collectionId,
        p_trait_id: blank.id,
      })
      return error ? { error } : { data: { id: null } }
    }
    if (blank) return { data: { id: blank.id } }
    const { data: top } = await supabase
      .from('traits')
      .select('position')
      .eq('layer_id', input.data.layerId)
      .order('position', { ascending: false })
      .limit(1)
      .maybeSingle()
    return created(
      supabase
        .from('traits')
        .insert({
          collection_id: collectionId,
          layer_id: input.data.layerId,
          name: 'None',
          weight: 0,
          blank: true,
          position: (top?.position ?? -1) + 1,
        })
        .select('id')
        .single(),
    )
  })
}

export async function setTraitMetadata(
  collectionId: string,
  id: string,
  inMetadata: boolean,
): Promise<ActionResult> {
  const input = parse(z.object({ id: uuid, inMetadata: z.boolean() }), { id, inMetadata })
  if (!input.ok) return input
  return artWrite(collectionId, ({ supabase }) =>
    one(
      supabase
        .from('traits')
        .update({ in_metadata: input.data.inMetadata })
        .eq('id', input.data.id)
        .eq('collection_id', collectionId)
        .select('id'),
    ),
  )
}

/** Deletes a trait, prunes the rules and groups that named it and closes its layer's positions. */
export async function deleteTrait(collectionId: string, id: string): Promise<ActionResult> {
  const input = parse(uuid, id)
  if (!input.ok) return input
  return artWrite(collectionId, ({ supabase }) =>
    ran(supabase.rpc('art_delete_trait', { p_collection_id: collectionId, p_trait_id: input.data })),
  )
}
```

`apps/web/src/app/actions/art/rules.ts`:

```ts
'use server'

import { isBidirectional } from '@cobweb/dna'
import type { ActionResult } from '@/lib/art/result'
import { ruleKindToDb } from '@/lib/art/rows'
import { parse, ruleInput, uuid, type RuleInput } from '@/lib/art/schemas'
import { artWrite, created, one } from '@/lib/art/write'

const row = (rule: RuleInput) => ({
  kind: ruleKindToDb(rule.kind),
  trait_id: rule.traitId,
  related_trait_ids: rule.relatedTraitIds,
  bidirectional: isBidirectional(rule.kind),
})

export async function addRule(collectionId: string, rule: RuleInput): Promise<ActionResult<{ id: string }>> {
  const input = parse(ruleInput, rule)
  if (!input.ok) return input
  return artWrite(collectionId, ({ supabase }) =>
    created(
      supabase
        .from('rules')
        .insert({ collection_id: collectionId, ...row(input.data) })
        .select('id')
        .single(),
    ),
  )
}

export async function updateRule(collectionId: string, id: string, rule: RuleInput): Promise<ActionResult> {
  const ruleId = parse(uuid, id)
  if (!ruleId.ok) return ruleId
  const input = parse(ruleInput, rule)
  if (!input.ok) return input
  return artWrite(collectionId, ({ supabase }) =>
    one(
      supabase
        .from('rules')
        .update(row(input.data))
        .eq('id', ruleId.data)
        .eq('collection_id', collectionId)
        .select('id'),
    ),
  )
}

export async function deleteRule(collectionId: string, id: string): Promise<ActionResult> {
  const input = parse(uuid, id)
  if (!input.ok) return input
  return artWrite(collectionId, ({ supabase }) =>
    one(supabase.from('rules').delete().eq('id', input.data).eq('collection_id', collectionId).select('id')),
  )
}
```

`apps/web/src/app/actions/art/at-least-one.ts`:

```ts
'use server'

import { z } from 'zod'
import type { ActionResult } from '@/lib/art/result'
import { groupTraits, parse, uuid } from '@/lib/art/schemas'
import { artWrite, created, one } from '@/lib/art/write'

/** "At least one" groups: plumbing only (spec section 2); no screen calls these yet. */
export async function addAtLeastOne(
  collectionId: string,
  artCollectionId: string,
  traitIds: string[],
): Promise<ActionResult<{ id: string }>> {
  const input = parse(z.object({ artCollectionId: uuid, traitIds: groupTraits }), {
    artCollectionId,
    traitIds,
  })
  if (!input.ok) return input
  return artWrite(collectionId, ({ supabase }) =>
    created(
      supabase
        .from('at_least_one')
        .insert({
          collection_id: collectionId,
          art_collection_id: input.data.artCollectionId,
          trait_ids: input.data.traitIds,
        })
        .select('id')
        .single(),
    ),
  )
}

export async function updateAtLeastOne(
  collectionId: string,
  id: string,
  traitIds: string[],
): Promise<ActionResult> {
  const input = parse(z.object({ id: uuid, traitIds: groupTraits }), { id, traitIds })
  if (!input.ok) return input
  return artWrite(collectionId, ({ supabase }) =>
    one(
      supabase
        .from('at_least_one')
        .update({ trait_ids: input.data.traitIds })
        .eq('id', input.data.id)
        .eq('collection_id', collectionId)
        .select('id'),
    ),
  )
}

export async function deleteAtLeastOne(collectionId: string, id: string): Promise<ActionResult> {
  const input = parse(uuid, id)
  if (!input.ok) return input
  return artWrite(collectionId, ({ supabase }) =>
    one(
      supabase
        .from('at_least_one')
        .delete()
        .eq('id', input.data)
        .eq('collection_id', collectionId)
        .select('id'),
    ),
  )
}
```

`apps/web/src/app/actions/art/tokens.ts`:

```ts
'use server'

import { z } from 'zod'
import { done, type ActionResult } from '@/lib/art/result'
import { parse, seed as seedSchema, tokenIds, tokenPatches, tokenSet } from '@/lib/art/schemas'
import type { TokenInput, TokenPatch } from '@/lib/art/token-ops'
import { artWrite, ran } from '@/lib/art/write'

/** Replaces the whole set and records its seed (Generate, Shuffle). */
export async function saveTokens(
  collectionId: string,
  tokens: TokenInput[],
  seed: number,
): Promise<ActionResult> {
  const input = parse(z.object({ tokens: tokenSet, seed: seedSchema }), { tokens, seed })
  if (!input.ok) return input
  return artWrite(collectionId, ({ supabase }) =>
    ran(
      supabase.rpc('art_save_tokens', {
        p_collection_id: collectionId,
        p_tokens: input.data.tokens,
        p_seed: input.data.seed,
      }),
    ),
  )
}

/** Writes changed DNA and descriptions (re-roll, change one trait, describe). */
export async function updateTokens(collectionId: string, rows: TokenPatch[]): Promise<ActionResult> {
  const input = parse(tokenPatches, rows)
  if (!input.ok) return input
  if (input.data.length === 0) return done
  return artWrite(collectionId, ({ supabase }) =>
    ran(supabase.rpc('art_update_tokens', { p_collection_id: collectionId, p_rows: input.data })),
  )
}

/** Swaps two token ids in one statement under the deferrable key. */
export async function swapTokens(collectionId: string, a: number, b: number): Promise<ActionResult> {
  const input = parse(tokenIds, [a, b])
  if (!input.ok) return input
  return artWrite(collectionId, ({ supabase }) =>
    ran(supabase.rpc('swap_token_ids_for_check', { p_collection_id: collectionId, p_a: a, p_b: b })),
  )
}

/** Deletes tokens; later ids move up so ids stay 1 to N. */
export async function deleteTokens(collectionId: string, ids: number[]): Promise<ActionResult> {
  const input = parse(tokenIds, ids)
  if (!input.ok) return input
  return artWrite(collectionId, ({ supabase }) =>
    ran(supabase.rpc('art_delete_tokens', { p_collection_id: collectionId, p_ids: input.data })),
  )
}

/** Adds tokens after the last id (Fill to size). */
export async function appendTokens(collectionId: string, tokens: TokenInput[]): Promise<ActionResult> {
  const input = parse(tokenSet, tokens)
  if (!input.ok) return input
  if (input.data.length === 0) return done
  return artWrite(collectionId, ({ supabase }) =>
    ran(
      supabase.from('tokens').insert(
        input.data.map((token) => ({
          collection_id: collectionId,
          token_id: token.tokenId,
          art_collection_id: token.artCollectionId,
          dna: token.dna,
          description: token.description,
        })),
      ),
    ),
  )
}

/** Clears the generated set before a structural edit. */
export async function clearTokens(collectionId: string): Promise<ActionResult> {
  return artWrite(collectionId, ({ supabase }) =>
    ran(supabase.from('tokens').delete().eq('collection_id', collectionId)),
  )
}
```

`apps/web/src/app/actions/art/settings.ts`:

```ts
'use server'

import type { TablesUpdate } from '@/lib/database.types'
import { done, type ActionResult } from '@/lib/art/result'
import { artSettings, parse, type ArtSettingsPatch } from '@/lib/art/schemas'
import { artWrite, one } from '@/lib/art/write'

/** The project's art settings: token name and description, blank traits, finishing the art later. */
export async function updateArtSettings(
  collectionId: string,
  patch: ArtSettingsPatch,
): Promise<ActionResult> {
  const input = parse(artSettings, patch)
  if (!input.ok) return input
  const change: TablesUpdate<'collections'> = {}
  if (input.data.tokenName !== undefined) change.token_name = input.data.tokenName
  if (input.data.tokenDescription !== undefined) change.token_description = input.data.tokenDescription
  if (input.data.showBlankTraits !== undefined) change.show_blank_traits = input.data.showBlankTraits
  if (input.data.artDeferred !== undefined) change.art_deferred = input.data.artDeferred
  if (Object.keys(change).length === 0) return done
  return artWrite(collectionId, ({ supabase }) =>
    one(supabase.from('collections').update(change).eq('id', collectionId).select('id')),
  )
}
```

`apps/web/src/app/actions/art/project.ts`:

```ts
'use server'

import type { ActionResult } from '@/lib/art/result'
import { artWrite } from '@/lib/art/write'
import { deleteObjects } from '@/lib/storage/objects'

/**
 * Empties the project's art and frees the canvas (`art_start_over`), then deletes the layer images'
 * objects. The rows are gone either way; an object left behind is collected by the orphan sweep.
 */
export async function startOver(collectionId: string): Promise<ActionResult> {
  return artWrite(collectionId, async ({ supabase }) => {
    const { data, error } = await supabase.rpc('art_start_over', { p_collection_id: collectionId })
    if (error) return { error }
    try {
      await deleteObjects(data ?? [])
    } catch {
      // Best effort: the rows are deleted, and the sweep owed to the lock sub-project removes strays.
    }
    return { data: undefined }
  })
}
```

`apps/web/next.config.ts`, inside `nextConfig` after `poweredByHeader: false,`:

```ts
  experimental: {
    // A save is about 400 bytes per token, so 100,000 tokens (MAX_SUPPLY) is about 40 MB; the default is 1 MB.
    serverActions: { bodySizeLimit: '64mb' },
  },
```

- [ ] **Step 6: Typecheck, lint, all tests**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: clean. If `supabase.rpc` complains about a missing function name, Task 2's type regeneration did not run: run its step 5.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/art apps/web/src/app/actions/art apps/web/next.config.ts
git commit -F - <<'MSG'
Add the Art server actions with their input rules and error sentences

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011bcHX4HZG5YGWhxjGuiWos
MSG
```

### Task 4: The sync layer

**Files:**

- Create: `apps/web/src/components/art/state/art-sync-queue.ts`, `apps/web/src/components/art/state/keyed-debounce.ts`, `apps/web/src/components/art/state/art-sync.tsx`, `apps/web/src/components/art/uploads/upload-once.ts`
- Test: `apps/web/src/components/art/state/art-sync-queue.test.ts`, `apps/web/src/components/art/state/keyed-debounce.test.ts`, `apps/web/src/components/art/uploads/upload-once.test.ts`
- Modify: `apps/web/src/components/art/state/art-store.ts` (`readProject`, `writeProject`, `seedProject`)
- Modify: `apps/web/src/app/collections/[id]/art/layout.tsx` (wrap the screens in `ArtSyncProvider`)

**Interfaces:**

- Consumes: `ActionResult`, `LOCKED`, `THROWN` from `@/lib/art/result` (Task 1); `ArtProject` from `art-store.ts`; `StartUpload`, `UploadRecord`, `UploadProgress`, `STOPPED` from `apps/web/src/components/art/uploads/uploader.ts`.
- Produces:
  - `art-store.ts`: `readProject(key: string): ArtProject`; `writeProject(key: string, project: ArtProject): void`; `seedProject(key: string, project: ArtProject): void`.
  - `art-sync-queue.ts`: `type Persist<T = unknown> = () => Promise<ActionResult<T>>`; `type SyncEdit = { apply: (project: ArtProject) => ArtProject; persist?: Persist; undo?: (project: ArtProject) => ArtProject }`; `type SyncCreate<T> = { persist: Persist<T>; apply: (project: ArtProject, data: T | null) => ArtProject }`; `type QueueOptions = { demo: boolean; read: () => ArtProject; write: (project: ArtProject) => void; notify: (message: string) => void; onLocked: () => void }`; `class ArtSyncQueue { constructor(options: QueueOptions); run(edit: SyncEdit): Promise<boolean>; create<T>(edit: SyncCreate<T>): Promise<boolean>; idle(): Promise<void> }`.
  - `keyed-debounce.ts`: `EDIT_DEBOUNCE_MS = 250`; `class KeyedDebounce { constructor(ms: number); schedule(key: string, job: () => void): void; flush(): void }`.
  - `art-sync.tsx`: `type ArtSync = { demo: boolean; locked: boolean; run: (edit: SyncEdit) => Promise<boolean>; create: <T>(edit: SyncCreate<T>) => Promise<boolean>; read: () => ArtProject; debounce: KeyedDebounce }`; `ArtSyncProvider({ collectionId: string; demo: boolean; initial?: ArtProject; children: ReactNode })`; `useArtSync(): ArtSync`.
  - `upload-once.ts`: `type Uploaded = { record: UploadRecord } | { error: string }`; `uploadOnce(start: StartUpload, file: File): Promise<Uploaded>`; `uploadAll(start: StartUpload, files: File[], concurrency?: number): Promise<Uploaded[]>`.

How the queue keeps the screen and the database in step (spec section 5):

- `run` applies the edit to the store at once, then saves it after every edit queued before it (one promise chain per collection, the order the creator made them).
- A failed save shows the sentence, puts back what the screen showed before that edit (or applies `undo` when given) and drops the edits queued behind it, which never reach the database.
- `create` waits for the server's id and only then applies; an edit queued behind a create waits for it, and a later rollback keeps the created row.
- In sample mode `run` and `create` apply and return at once; nothing is saved.
- The lock sentence makes every later edit a no-op and tells the provider, which turns the screens read only.

Decision: the store's "notice region" is the sonner toaster already mounted in `components/providers.tsx`, which the Generate screen already uses for save errors.

- [ ] **Step 1: Write the failing tests**

`apps/web/src/components/art/state/art-sync-queue.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { LOCKED, THROWN, type ActionResult } from '@/lib/art/result'
import type { ArtProject } from './art-store'
import { ArtSyncQueue } from './art-sync-queue'

function setup(demo = false) {
  let project: ArtProject = {
    collections: [],
    canvas: null,
    seed: 1,
    staleNote: null,
    showBlankTraits: false,
  }
  const notify = vi.fn()
  const onLocked = vi.fn()
  const queue = new ArtSyncQueue({
    demo,
    read: () => project,
    write: (next) => {
      project = next
    },
    notify,
    onLocked,
  })
  return {
    queue,
    notify,
    onLocked,
    names: () => (project.collections ?? []).map((collection) => collection.name),
  }
}

const named =
  (name: string) =>
  (project: ArtProject): ArtProject => ({
    ...project,
    collections: [...(project.collections ?? []), { id: name, name, size: 1 }],
  })

function later<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

const saved: ActionResult = { ok: true, data: undefined }
const refused: ActionResult = { ok: false, error: 'No.' }
const tick = () => new Promise((settle) => setTimeout(settle, 0))

describe('ArtSyncQueue', () => {
  it('applies at once and saves in the order the edits were made', async () => {
    const s = setup()
    const first = later<ActionResult>()
    const calls: string[] = []
    const a = s.queue.run({
      apply: named('a'),
      persist: () => {
        calls.push('a')
        return first.promise
      },
    })
    const b = s.queue.run({
      apply: named('b'),
      persist: async () => {
        calls.push('b')
        return saved
      },
    })
    expect(s.names()).toEqual(['a', 'b'])
    await tick()
    expect(calls).toEqual(['a'])
    first.resolve(saved)
    expect(await a).toBe(true)
    expect(await b).toBe(true)
    expect(calls).toEqual(['a', 'b'])
  })

  it('restores the snapshot on a failed save, says why, and drops the edits queued behind it', async () => {
    const s = setup()
    const calls: string[] = []
    const a = s.queue.run({
      apply: named('a'),
      persist: async () => {
        calls.push('a')
        return refused
      },
    })
    const b = s.queue.run({
      apply: named('b'),
      persist: async () => {
        calls.push('b')
        return saved
      },
    })
    expect(await a).toBe(false)
    expect(await b).toBe(false)
    expect(calls).toEqual(['a'])
    expect(s.names()).toEqual([])
    expect(s.notify).toHaveBeenCalledWith('No.')
    expect(s.notify).toHaveBeenCalledTimes(1)
  })

  it('applies undo instead of the snapshot when the edit gives one', async () => {
    const s = setup()
    await s.queue.run({ apply: named('kept') })
    await s.queue.run({ apply: (project) => project, persist: async () => refused, undo: named('undone') })
    expect(s.names()).toEqual(['kept', 'undone'])
  })

  it('rolls back a thrown save with the retry sentence', async () => {
    const s = setup()
    const ok = await s.queue.run({ apply: named('a'), persist: () => Promise.reject(new Error('offline')) })
    expect(ok).toBe(false)
    expect(s.names()).toEqual([])
    expect(s.notify).toHaveBeenCalledWith(THROWN)
  })

  it('applies a create only when the action returns the id; the edit behind it waits', async () => {
    const s = setup()
    const made = later<ActionResult<{ id: string }>>()
    let seenBehind = ''
    const created = s.queue.create<{ id: string }>({
      persist: () => made.promise,
      apply: (project, data) => named(data?.id ?? 'sample')(project),
    })
    const behind = s.queue.run({
      apply: (project) => project,
      persist: async () => {
        seenBehind = s.names().join()
        return saved
      },
    })
    expect(s.names()).toEqual([])
    made.resolve({ ok: true, data: { id: 'uuid-1' } })
    expect(await created).toBe(true)
    expect(await behind).toBe(true)
    expect(s.names()).toEqual(['uuid-1'])
    expect(seenBehind).toBe('uuid-1')
  })

  it('keeps a created row when an edit made while it was out fails', async () => {
    const s = setup()
    const made = later<ActionResult<{ id: string }>>()
    const created = s.queue.create<{ id: string }>({
      persist: () => made.promise,
      apply: (project, data) => named(data?.id ?? 'sample')(project),
    })
    const failing = s.queue.run({ apply: named('x'), persist: async () => refused })
    expect(s.names()).toEqual(['x'])
    made.resolve({ ok: true, data: { id: 'uuid-1' } })
    await created
    expect(await failing).toBe(false)
    expect(s.names()).toEqual(['uuid-1'])
  })

  it('saves nothing in sample mode and applies creates without an id', async () => {
    const s = setup(true)
    const persist = vi.fn(async () => saved)
    const create = vi.fn(async () => ({ ok: true as const, data: { id: 'x' } }))
    expect(await s.queue.run({ apply: named('a'), persist })).toBe(true)
    expect(
      await s.queue.create<{ id: string }>({
        persist: create,
        apply: (project, data) => named(data === null ? 'sample' : data.id)(project),
      }),
    ).toBe(true)
    expect(persist).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
    expect(s.names()).toEqual(['a', 'sample'])
  })

  it('turns read only on the lock sentence: later edits neither apply nor save', async () => {
    const s = setup()
    await s.queue.run({ apply: named('a'), persist: async () => ({ ok: false, error: LOCKED }) })
    expect(s.onLocked).toHaveBeenCalledTimes(1)
    const persist = vi.fn(async () => saved)
    expect(await s.queue.run({ apply: named('b'), persist })).toBe(false)
    expect(persist).not.toHaveBeenCalled()
    expect(s.names()).toEqual([])
  })
})
```

`apps/web/src/components/art/state/keyed-debounce.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EDIT_DEBOUNCE_MS, KeyedDebounce } from './keyed-debounce'

describe('KeyedDebounce', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('sends one call per layer, with the last values, 250 ms after the last edit', () => {
    const debounce = new KeyedDebounce(EDIT_DEBOUNCE_MS)
    const sent: string[] = []
    for (const weight of [10, 20, 30]) debounce.schedule('weights:eyes', () => sent.push(`eyes ${weight}`))
    debounce.schedule('weights:hats', () => sent.push('hats 50'))
    vi.advanceTimersByTime(249)
    expect(sent).toEqual([])
    vi.advanceTimersByTime(1)
    expect(sent).toEqual(['eyes 30', 'hats 50'])
    vi.advanceTimersByTime(1000)
    expect(sent).toHaveLength(2)
  })

  it('flush sends what is waiting at once, and only once (leaving the screen keeps the last edit)', () => {
    const debounce = new KeyedDebounce(EDIT_DEBOUNCE_MS)
    const sent: string[] = []
    debounce.schedule('size:owls', () => sent.push('owls 500'))
    debounce.flush()
    expect(sent).toEqual(['owls 500'])
    vi.advanceTimersByTime(1000)
    expect(sent).toEqual(['owls 500'])
  })
})
```

`apps/web/src/components/art/uploads/upload-once.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { uploadAll } from './upload-once'
import type { StartUpload, UploadProgress, UploadRecord } from './uploader'

const record = (id: string): UploadRecord => ({
  id,
  kind: 'layer_image',
  fileName: `${id}.png`,
  mime: 'image/png',
  mediaType: 'image',
  bytes: 10,
  width: 100,
  height: 100,
  url: `/api/uploads/${id}`,
  thumbnailUrl: `/api/uploads/${id}?variant=thumb`,
})

/** Emits "uploading", then the outcome named after the file, asynchronously like the real uploader. */
const fakeStart =
  (outcomes: Record<string, UploadProgress>): StartUpload =>
  (file) => ({
    progress$: {
      subscribe(listener) {
        listener({ state: 'uploading', sentBytes: 0, totalBytes: 10 })
        queueMicrotask(() => listener(outcomes[file.name]!))
        return () => {}
      },
    },
    pause() {},
    resume() {},
    retry() {},
    cancel() {},
  })

describe('uploadAll', () => {
  it('settles each file with its record or its sentence, in the order given', async () => {
    const start = fakeStart({
      'a.png': { state: 'done', sentBytes: 10, totalBytes: 10, record: record('a') },
      'b.png': {
        state: 'failed',
        sentBytes: 0,
        totalBytes: 10,
        error: 'The upload stopped. Retry to upload it again.',
      },
      'c.png': { state: 'done', sentBytes: 10, totalBytes: 10, record: record('c') },
    })
    const files = ['a.png', 'b.png', 'c.png'].map((name) => new File([new Uint8Array(10)], name))
    expect(await uploadAll(start, files, 2)).toEqual([
      { record: record('a') },
      { error: 'The upload stopped. Retry to upload it again.' },
      { record: record('c') },
    ])
  })
})
```

- [ ] **Step 2: Run, expect failure**

Run: `pnpm --filter @cobweb/web exec vitest run src/components/art/state/art-sync-queue.test.ts src/components/art/state/keyed-debounce.test.ts src/components/art/uploads/upload-once.test.ts`
Expected: FAIL, `Failed to resolve import "./art-sync-queue"`, `"./keyed-debounce"` and `"./upload-once"`.

- [ ] **Step 3: Implement**

`apps/web/src/components/art/state/art-sync-queue.ts`:

```ts
import { LOCKED, THROWN, type ActionResult } from '@/lib/art/result'
import type { ArtProject } from './art-store'

export type Persist<T = unknown> = () => Promise<ActionResult<T>>

/** An edit shown at once and then saved. `undo` replaces the snapshot when the snapshot would be stale. */
export type SyncEdit = {
  apply: (project: ArtProject) => ArtProject
  persist?: Persist
  undo?: (project: ArtProject) => ArtProject
}

/** An edit that needs the id the server makes: applied once the action returns it (`data` is null in sample mode). */
export type SyncCreate<T> = {
  persist: Persist<T>
  apply: (project: ArtProject, data: T | null) => ArtProject
}

export type QueueOptions = {
  demo: boolean
  read: () => ArtProject
  write: (project: ArtProject) => void
  notify: (message: string) => void
  onLocked: () => void
}

type Entry = {
  /** The project when the edit joined the queue. */
  snapshot: ArtProject
  undo?: (project: ArtProject) => ArtProject
  cancelled: boolean
}

/**
 * Mirrors the Art screens' edits to their server actions (docs/specs/2026-10-08-art-wiring.md,
 * section 5): one promise chain per collection, so saves happen in the order the creator made the
 * edits; optimistic on screen; a failed save rolls back and drops what was queued behind it. Pure
 * (no React), so it is tested under Node with fake actions.
 */
export class ArtSyncQueue {
  private readonly options: QueueOptions
  private tail: Promise<unknown> = Promise.resolve()
  /** Edits not yet saved or rolled back, oldest first. */
  private waiting: Entry[] = []
  private locked = false

  constructor(options: QueueOptions) {
    this.options = options
  }

  run(edit: SyncEdit): Promise<boolean> {
    if (this.locked) return Promise.resolve(false)
    const snapshot = this.options.read()
    this.options.write(edit.apply(snapshot))
    const persist = edit.persist
    if (this.options.demo || !persist) return Promise.resolve(true)
    const entry: Entry = { snapshot, undo: edit.undo, cancelled: false }
    this.waiting.push(entry)
    return this.enqueue(async () => {
      if (entry.cancelled) return false
      const result = await this.call(persist)
      if (!result.ok) {
        this.rollBack(entry)
        return false
      }
      this.settle(entry)
      return true
    })
  }

  create<T>(edit: SyncCreate<T>): Promise<boolean> {
    if (this.locked) return Promise.resolve(false)
    if (this.options.demo) {
      this.options.write(edit.apply(this.options.read(), null))
      return Promise.resolve(true)
    }
    const entry: Entry = { snapshot: this.options.read(), cancelled: false }
    this.waiting.push(entry)
    return this.enqueue(async () => {
      if (entry.cancelled) return false
      const result = await this.call(edit.persist)
      if (!result.ok) {
        this.rollBack(entry)
        return false
      }
      this.settle(entry)
      // Edits made while the create was out keep the new row if one of them fails later.
      for (const later of this.waiting) later.snapshot = edit.apply(later.snapshot, result.data)
      this.options.write(edit.apply(this.options.read(), result.data))
      return true
    })
  }

  /** Resolves once every queued edit has been saved or rolled back. */
  idle(): Promise<void> {
    return this.tail.then(() => undefined)
  }

  private enqueue(task: () => Promise<boolean>): Promise<boolean> {
    const next = this.tail.then(task)
    this.tail = next.catch(() => undefined)
    return next
  }

  private settle(entry: Entry) {
    this.waiting = this.waiting.filter((other) => other !== entry)
  }

  /** Puts back what the screen showed before the failed edit and drops the edits queued behind it. */
  private rollBack(entry: Entry) {
    const at = this.waiting.indexOf(entry)
    const behind = at === -1 ? [] : this.waiting.slice(at + 1)
    for (const later of behind) later.cancelled = true
    if (at !== -1) this.waiting = this.waiting.slice(0, at)
    const base = behind[0]?.snapshot ?? this.options.read()
    this.options.write(entry.undo ? entry.undo(base) : entry.snapshot)
  }

  private async call<T>(persist: Persist<T>): Promise<ActionResult<T>> {
    let result: ActionResult<T>
    try {
      result = await persist()
    } catch {
      result = { ok: false, error: THROWN }
    }
    if (!result.ok) {
      if (result.error === LOCKED && !this.locked) {
        this.locked = true
        this.options.onLocked()
      }
      this.options.notify(result.error)
    }
    return result
  }
}
```

`apps/web/src/components/art/state/keyed-debounce.ts`:

```ts
/** How long weight, size, text and asset edits wait for the next keystroke before they are saved. */
export const EDIT_DEBOUNCE_MS = 250

/** Runs the last job given for a key once that key has been quiet for `ms`. One timer per key. */
export class KeyedDebounce {
  private readonly ms: number
  private readonly jobs = new Map<string, { timer: ReturnType<typeof setTimeout>; job: () => void }>()

  constructor(ms: number) {
    this.ms = ms
  }

  schedule(key: string, job: () => void): void {
    const current = this.jobs.get(key)
    if (current) clearTimeout(current.timer)
    const timer = setTimeout(() => {
      this.jobs.delete(key)
      job()
    }, this.ms)
    this.jobs.set(key, { timer, job })
  }

  /** Runs every waiting job now: leaving the screen must not lose the last edit. */
  flush(): void {
    const waiting = [...this.jobs.values()]
    this.jobs.clear()
    for (const { timer, job } of waiting) {
      clearTimeout(timer)
      job()
    }
  }
}
```

`apps/web/src/components/art/uploads/upload-once.ts`:

```ts
import { STOPPED, type StartUpload, type UploadRecord } from './uploader'

export type Uploaded = { record: UploadRecord } | { error: string }

/** Uploads one file and settles when it is stored or has failed (no pause or retry here). */
export function uploadOnce(start: StartUpload, file: File): Promise<Uploaded> {
  return new Promise((resolve) => {
    let settled = false
    let unsubscribe: (() => void) | null = null
    const finish = (result: Uploaded) => {
      if (settled) return
      settled = true
      unsubscribe?.()
      resolve(result)
    }
    const handle = start(file)
    unsubscribe = handle.progress$.subscribe((progress) => {
      if (progress.state === 'done' && progress.record) finish({ record: progress.record })
      else if (progress.state === 'failed') finish({ error: progress.error ?? STOPPED })
    })
    // The listener may have settled during subscribe, before `unsubscribe` existed.
    if (settled) unsubscribe()
  })
}

/** Uploads files `concurrency` at a time; the results keep the files' order. */
export async function uploadAll(start: StartUpload, files: File[], concurrency = 4): Promise<Uploaded[]> {
  const results: Uploaded[] = []
  let next = 0
  const worker = async () => {
    while (next < files.length) {
      const at = next++
      results[at] = await uploadOnce(start, files[at]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, worker))
  return results
}
```

`apps/web/src/components/art/state/art-store.ts`, after `fromSeed`, add:

```ts
/** The project as the store holds it now, for the sync queue, which works outside React. */
export function readProject(key: string): ArtProject {
  return projects.get(key) ?? fromSeed({})
}

/** Replaces the project and tells every screen showing it. */
export function writeProject(key: string, project: ArtProject): void {
  projects.set(key, project)
  listeners.get(key)?.forEach((listener) => listener())
}

/**
 * Seeds the project from the loaded rows, once per browser session: a later visit keeps the
 * session's state, which every edit has already saved.
 */
export function seedProject(key: string, project: ArtProject): void {
  if (!projects.has(key)) projects.set(key, project)
}
```

In `useArtProject`, make `update` use `writeProject`:

```ts
const update = useCallback(
  (change: (project: ArtProject) => ArtProject) => writeProject(key, change(projects.get(key) ?? fallback)),
  [key, fallback],
)
```

`apps/web/src/components/art/state/art-sync.tsx`:

```tsx
'use client'

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { readProject, seedProject, writeProject, type ArtProject } from './art-store'
import { ArtSyncQueue, type SyncCreate, type SyncEdit } from './art-sync-queue'
import { EDIT_DEBOUNCE_MS, KeyedDebounce } from './keyed-debounce'

export type ArtSync = {
  /** Sample mode: edits apply on screen and nothing is saved. */
  demo: boolean
  /** A save came back with the lock sentence: every Art control turns read only until the next load. */
  locked: boolean
  run: (edit: SyncEdit) => Promise<boolean>
  create: <T>(edit: SyncCreate<T>) => Promise<boolean>
  /** The project as it is now, outside the render (for debounced saves). */
  read: () => ArtProject
  /** Weight, size, text and asset edits wait 250 ms per key before they are saved. */
  debounce: KeyedDebounce
}

const ArtSyncContext = createContext<ArtSync | null>(null)

/**
 * Wraps the Art screens of one collection: seeds the browser store from the loaded rows and saves
 * every edit through `ArtSyncQueue` (spec section 5). Errors show as toasts.
 */
export function ArtSyncProvider({
  collectionId,
  demo,
  initial,
  children,
}: {
  collectionId: string
  demo: boolean
  /** The loaded project; absent in sample mode and for projects without layers. */
  initial?: ArtProject
  children: ReactNode
}) {
  const [locked, setLocked] = useState(false)
  const [queue] = useState(() => {
    // The store is module state; seed it in the browser only, never on the server.
    if (initial && typeof window !== 'undefined') seedProject(collectionId, initial)
    return new ArtSyncQueue({
      demo,
      read: () => readProject(collectionId),
      write: (project) => writeProject(collectionId, project),
      notify: (message) => toast.error(message),
      onLocked: () => setLocked(true),
    })
  })
  const [debounce] = useState(() => new KeyedDebounce(EDIT_DEBOUNCE_MS))
  // Leaving the Art stage saves what is still waiting.
  useEffect(() => () => debounce.flush(), [debounce])

  const value = useMemo<ArtSync>(
    () => ({
      demo,
      locked,
      run: (edit) => queue.run(edit),
      create: <T,>(edit: SyncCreate<T>) => queue.create(edit),
      read: () => readProject(collectionId),
      debounce,
    }),
    [demo, locked, queue, debounce, collectionId],
  )
  return <ArtSyncContext value={value}>{children}</ArtSyncContext>
}

export function useArtSync(): ArtSync {
  const sync = useContext(ArtSyncContext)
  if (!sync) throw new Error('useArtSync is used outside ArtSyncProvider (the Art layout provides it).')
  return sync
}
```

`apps/web/src/app/collections/[id]/art/layout.tsx`: add the import `import { ArtSyncProvider } from '@/components/art/state/art-sync'`, and after `const notice = (...)` add:

```tsx
const content = (
  <ArtSyncProvider collectionId={collection.id} demo={demo}>
    {children}
  </ArtSyncProvider>
)
```

Then render `{content}` in place of `{children}` in both returns (the single-screen branch and inside `<div className="flex min-w-0 flex-1 flex-col">`). Task 7 adds `initial`.

- [ ] **Step 4: Run, expect pass; root checks**

Run: `pnpm --filter @cobweb/web exec vitest run src/components/art/state src/components/art/uploads && pnpm typecheck && pnpm lint && pnpm test`
Expected: the 8 queue tests, 2 debounce tests and 1 upload test pass with the existing state and upload tests; root checks clean.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/art/state apps/web/src/components/art/uploads/upload-once.ts apps/web/src/components/art/uploads/upload-once.test.ts "apps/web/src/app/collections/[id]/art/layout.tsx"
git commit -F - <<'MSG'
Add the sync queue that saves each Art edit in order and rolls back a failed one

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011bcHX4HZG5YGWhxjGuiWos
MSG
```

### Task 5: Layers, Rules and Collections on the sync layer, the folder import and starting over

**Files:**

- Modify: `apps/web/src/components/art/state/layer-edits.ts`, `apps/web/src/components/art/state/collection-edits.ts`
- Test: `apps/web/src/components/art/state/layer-edits.test.ts` (new describe block)
- Modify: `apps/web/src/components/art/layers/folder-upload/to-layers.ts`
- Test: `apps/web/src/components/art/layers/folder-upload/to-layers.test.ts` (new describe block)
- Modify (whole file given): `apps/web/src/components/art/layers/use-layers-editor.ts`, `apps/web/src/components/art/rules/use-rules-editor.ts`, `apps/web/src/components/art/collections/use-collections.ts`
- Modify: `apps/web/src/components/art/layers/folder-upload/use-folder-upload.ts`, `apps/web/src/components/art/layers/folder-upload/folder-upload.tsx:195`, `apps/web/src/components/art/layers/add-traits-dialog.tsx`, `apps/web/src/components/art/layers-screen.tsx`, `apps/web/src/components/art/rules-screen.tsx`, `apps/web/src/components/art/collections/collection-switcher.tsx`
- Modify (thumbnails, spec section 11): `apps/web/src/components/art/lib/trait-index.ts`, `apps/web/src/components/art/layers/trait-card.tsx:18,108`, `apps/web/src/components/art/generate/stats-view.tsx:12,177`, `apps/web/src/components/art/rules/trait-chip.tsx:2,24`, `apps/web/src/components/art/rules/rule-dialog.tsx:19,58`

**Interfaces:**

- Consumes: `useArtSync(): ArtSync` (Task 4); `uploadAll` (Task 4); every action of Task 3 named below; `weightRows` (Task 1); `ImportPayload`, `ImportResult` (Task 3); `servedUrl` from `@/lib/storage/uploads-service`.
- Produces:
  - `layer-edits.ts`: `addLayer(layers, collectionId, name, id?: string)`; `type TraitImage = { name: string; imageUrl: string; thumbnailUrl?: string; uploadId?: string }`; `addTraits(layers, layerId, items: TraitImage[], ids?: string[])`; `setBlank(layers, layerId, on, id?: string)`; `layerOfTrait(layers: Layer[], traitId: string): Layer | undefined`; `restoreWeights(layers: Layer[], layerId: string, traits: Trait[]): Layer[]`; `pruneGroups(groups: AtLeastOne[], traitIds: ReadonlySet<string>): AtLeastOne[]`.
  - `collection-edits.ts`: `addCollection(collections, name, id?: string)`.
  - `to-layers.ts`: `importPayload(detected: DetectedProject, images: ReadonlyMap<string, UploadedImage>, activeCollectionId?: string): ImportPayload`; `applyImport(project: ArtProject, payload: ImportPayload, result: ImportResult): Pick<ArtProject, 'collections' | 'activeCollectionId' | 'layers'>`.
  - `add-traits-dialog.tsx`: `type NewTrait = { name: string; imageUrl: string; file: File }`; `onAdd: (items: NewTrait[], canvas: Canvas) => void`.
  - `useLayersEditor`: same return shape, with `askAddLayer(onAdded: (id: string) => void, into?: () => Promise<string | null>)` and `addTraits(layerId: string, items: NewTrait[], canvas: ArtProject['canvas']): Promise<void>`.
  - `useRulesEditor`: `add(draft: RuleDraft): Promise<{ id: string; broken: number } | null>`; `edit` and `remove` unchanged (return the broken count).
  - `useCollections`: `ensureOne(name: string): Promise<string | null>`; new `askStartOver(): void`.
  - `useFolderUpload`: `finish(): Promise<void>`; new `saving: boolean`.
  - `traitThumbUrls(trait: Pick<Trait, 'imageUrl' | 'thumbnailUrl'>): string[]` in `lib/trait-index.ts`.
  - `CollectionSwitcher` prop `onStartOver?: () => void`.

**Creator-visible change (spec section 8):** moving a layer while tokens exist now asks to clear the generated tokens first ("Move <layer>?", "Clear tokens and move"), the same dialog as adding or deleting a layer, instead of remapping every token's DNA in the browser.

Decision: creates (a layer, traits, a blank, a rule, an art collection, the folder import) show once the server returns the id, as the spec says; renames, deletes, moves and weights show at once.

Decision: when a structural edit needs the tokens cleared, the hook queues `clearTokens` first and the edit second, in the same chain; deleting a layer clears through `deleteLayer`'s flag instead (one transaction).

Decision: the folder upload's previews are released only after the import is saved, so a refused import leaves the review on screen and "Set up layers" can be pressed again.

- [ ] **Step 1: Write the failing tests**

In `apps/web/src/components/art/state/layer-edits.test.ts`, change the import from `./layer-edits` to:

```ts
import {
  addLayer,
  addTraits,
  deleteTrait,
  evenOut,
  evenWeights,
  pruneGroups,
  pruneRules,
  restoreWeights,
  setBlank,
  setConstant,
} from './layer-edits'
```

and append:

```ts
describe('server ids and rollbacks (art wiring)', () => {
  it('takes the ids the database made for a new layer, its traits and its blank', () => {
    const added = addLayer([layer([100])], 'c', 'Hats', 'uuid-hats')
    expect(added.id).toBe('uuid-hats')
    expect(added.layers.map((l) => l.id)).toEqual(['eyes', 'uuid-hats'])
    const traits = addTraits(
      added.layers,
      'uuid-hats',
      [
        {
          name: 'Cap',
          imageUrl: '/api/uploads/u1',
          thumbnailUrl: '/api/uploads/u1?variant=thumb',
          uploadId: 'u1',
        },
      ],
      ['uuid-cap'],
    )
    expect(traits.ids).toEqual(['uuid-cap'])
    expect(traits.layers[1]!.traits[0]).toEqual({
      id: 'uuid-cap',
      layerId: 'uuid-hats',
      name: 'Cap',
      weight: 0,
      blank: false,
      imageUrl: '/api/uploads/u1',
      thumbnailUrl: '/api/uploads/u1?variant=thumb',
      uploadId: 'u1',
    })
    expect(setBlank(traits.layers, 'uuid-hats', true, 'uuid-none')[1]!.traits[0]!.id).toBe('uuid-none')
  })

  it('drops deleted traits from "at least one" groups, and a group left with one trait', () => {
    const groups = [
      { id: 'g1', collectionId: 'c', traitIds: ['a', 'b', 'c'] },
      { id: 'g2', collectionId: 'c', traitIds: ['a', 'd'] },
    ]
    expect(pruneGroups(groups, new Set(['a', 'b']))).toEqual([
      { id: 'g1', collectionId: 'c', traitIds: ['a', 'b'] },
    ])
  })

  it('puts weights and constants back after a failed save', () => {
    const base = layer([70, 30])
    base.traits[1] = { ...base.traits[1]!, weight: 0, constant: 4 }
    const changed = setConstant(evenOut([base], 'eyes'), 'eyes-1', null)
    const restored = restoreWeights(changed, 'eyes', base.traits)
    expect(restored[0]!.traits.map((t) => [t.weight, t.constant])).toEqual([
      [70, undefined],
      [0, 4],
    ])
  })
})
```

In `apps/web/src/components/art/layers/folder-upload/to-layers.test.ts`, change the imports to:

```ts
import { describe, expect, it } from 'vitest'
import type { ArtProject } from '../../state/art-store'
import type { Layer } from '@/lib/demo'
import type { DetectedProject } from './folder-tree'
import { applyImport, importPayload, mergeUpload } from './to-layers'
```

and append:

```ts
describe('importing through the database (art wiring)', () => {
  const png = new File([new Uint8Array(4)], 'x.png', { type: 'image/png' })
  const longName = 'A'.repeat(60)
  const folder: DetectedProject = {
    projectName: null,
    structureErrors: [],
    skipped: 0,
    collections: [
      {
        name: longName,
        folder: longName,
        layers: [
          {
            name: 'Eyes',
            folder: `${longName}/Eyes`,
            traits: [
              { key: 'k1', name: 'Wide', file: png, path: '/x/Eyes/wide.png' },
              { key: 'k2', name: 'Broken', file: png, path: '/x/Eyes/broken.png' },
            ],
          },
          {
            name: 'Hats',
            folder: `${longName}/Hats`,
            traits: [{ key: 'k3', name: 'Cap', file: png, path: '/x/Hats/cap.png' }],
          },
        ],
      },
    ],
  }
  const empty: ArtProject = { canvas: null, seed: 1, staleNote: null, showBlankTraits: false }

  it('clips names to the column limits and leaves out traits without a stored image, and empty layers', () => {
    const stored = new Map([['k1', { url: '/api/uploads/u1', name: 'W'.repeat(70), uploadId: 'u1' }]])
    expect(importPayload(folder, stored)).toEqual({
      collections: [
        {
          name: 'A'.repeat(48),
          layers: [{ name: 'Eyes', traits: [{ name: 'W'.repeat(64), uploadId: 'u1' }] }],
        },
      ],
      activeCollectionId: null,
    })
  })

  it('shows the imported layers with the database ids, served images and even weights', () => {
    const payload = {
      collections: [
        {
          name: 'Owls',
          layers: [
            {
              name: 'Eyes',
              traits: [
                { name: 'Wide', uploadId: 'u1' },
                { name: 'Sleepy', uploadId: 'u2' },
              ],
            },
          ],
        },
      ],
      activeCollectionId: null,
    }
    const result = {
      collections: [{ id: 'art-1', layers: [{ id: 'layer-1', traits: [{ id: 't1' }, { id: 't2' }] }] }],
    }
    const project: ArtProject = {
      ...empty,
      collections: [{ id: 'old', name: 'Empty', size: 100 }],
      layers: [],
    }
    const merged = applyImport(project, payload, result)
    expect(merged.collections).toEqual([{ id: 'art-1', name: 'Owls', size: 0 }])
    expect(merged.activeCollectionId).toBe('art-1')
    expect(merged.layers).toEqual([
      {
        id: 'layer-1',
        collectionId: 'art-1',
        name: 'Eyes',
        position: 0,
        traits: [
          {
            id: 't1',
            layerId: 'layer-1',
            name: 'Wide',
            weight: 50,
            blank: false,
            imageUrl: '/api/uploads/u1',
            thumbnailUrl: '/api/uploads/u1?variant=thumb',
            uploadId: 'u1',
          },
          {
            id: 't2',
            layerId: 'layer-1',
            name: 'Sleepy',
            weight: 50,
            blank: false,
            imageUrl: '/api/uploads/u2',
            thumbnailUrl: '/api/uploads/u2?variant=thumb',
            uploadId: 'u2',
          },
        ],
      },
    ])
  })

  it('fills the active collection when one collection is imported into a project that has layers', () => {
    const body: Layer = { id: 'l0', collectionId: 'art-0', name: 'Body', position: 0, traits: [] }
    const project: ArtProject = {
      ...empty,
      collections: [
        { id: 'art-0', name: 'Owls', size: 10 },
        { id: 'art-9', name: 'Owlets', size: 5 },
      ],
      layers: [body],
    }
    const payload = {
      collections: [
        { name: 'Owlets', layers: [{ name: 'Eyes', traits: [{ name: 'Wide', uploadId: 'u1' }] }] },
      ],
      activeCollectionId: 'art-9',
    }
    const result = { collections: [{ id: 'art-9', layers: [{ id: 'layer-9', traits: [{ id: 't9' }] }] }] }
    const merged = applyImport(project, payload, result)
    expect(merged.collections).toEqual(project.collections)
    expect(merged.activeCollectionId).toBe('art-9')
    expect(merged.layers!.map((layer) => [layer.id, layer.collectionId])).toEqual([
      ['l0', 'art-0'],
      ['layer-9', 'art-9'],
    ])
  })
})
```

- [ ] **Step 2: Run, expect failure**

Run: `pnpm --filter @cobweb/web exec vitest run src/components/art/state/layer-edits.test.ts src/components/art/layers/folder-upload/to-layers.test.ts`
Expected: FAIL; TypeScript-level errors surface as runtime failures such as `pruneGroups is not a function`, `restoreWeights is not a function` and `importPayload is not a function`, and the id test fails with `expected 'hats' to be 'uuid-hats'`.

- [ ] **Step 3: The pure edits**

`apps/web/src/components/art/state/layer-edits.ts`:

- Change the type import to `import type { AtLeastOne, GeneratedToken, Layer, Trait } from '@/lib/demo'`.
- Replace the doc comment's "Seam: in Phase 3 each of these becomes a server action on the layer and trait rows; the screens keep calling them through `useArtProject().update`." with "The hooks apply them through `useArtSync()`, which saves each edit with its server action; ids made here are for sample mode, saved rows take the database's ids."
- Replace `addLayer`, `addTraits` and `setBlank` with:

```ts
/** Adds a layer on top of one collection's stack. `id` is the database's; sample mode makes one from the name. */
export function addLayer(
  layers: Layer[],
  collectionId: string,
  name: string,
  id?: string,
): { layers: Layer[]; id: string } {
  const layerId = id ?? uniqueId(slug(name), new Set(layers.map((layer) => layer.id)))
  const layer: Layer = { id: layerId, collectionId, name, position: 0, traits: [] }
  // Keep the collection's layers together: insert after its last layer.
  let last = -1
  layers.forEach((other, i) => {
    if (other.collectionId === collectionId) last = i
  })
  const next = [...layers]
  next.splice(last === -1 ? layers.length : last + 1, 0, layer)
  return { layers: positioned(next), id: layerId }
}

/** A trait image to add: the stored image and its thumbnail, or a preview URL in sample mode. */
export type TraitImage = { name: string; imageUrl: string; thumbnailUrl?: string; uploadId?: string }

/** Adds traits to a layer at 0%, so the other weights stay as the creator set them. `ids` are the database's. */
export function addTraits(
  layers: Layer[],
  layerId: string,
  items: TraitImage[],
  ids?: string[],
): { layers: Layer[]; ids: string[] } {
  const taken = new Set(layers.flatMap((layer) => layer.traits.map((trait) => trait.id)))
  const made: string[] = []
  const next = mapLayer(layers, layerId, (layer) => ({
    ...layer,
    traits: [
      ...layer.traits,
      ...items.map((item, i): Trait => {
        const id = ids?.[i] ?? uniqueId(`${layer.id}-${slug(item.name)}`, taken)
        taken.add(id)
        made.push(id)
        return {
          id,
          layerId: layer.id,
          name: item.name,
          weight: 0,
          blank: false,
          imageUrl: item.imageUrl,
          ...(item.thumbnailUrl ? { thumbnailUrl: item.thumbnailUrl } : {}),
          ...(item.uploadId ? { uploadId: item.uploadId } : {}),
        }
      }),
    ],
  }))
  return { layers: next, ids: made }
}
```

```ts
/** Adds the blank trait (at 0%, so nothing changes until it gets a share) or removes it. `id` is the database's. */
export function setBlank(layers: Layer[], layerId: string, on: boolean, id?: string): Layer[] {
  const taken = new Set(layers.flatMap((layer) => layer.traits.map((trait) => trait.id)))
  return mapLayer(layers, layerId, (layer) => {
    if (!on) return { ...layer, traits: layer.traits.filter((trait) => !trait.blank) }
    if (layer.traits.some((trait) => trait.blank)) return layer
    const blank: Trait = {
      id: id ?? uniqueId(`${layer.id}-none`, taken),
      layerId: layer.id,
      name: 'None',
      weight: 0,
      blank: true,
      imageUrl: null,
    }
    return { ...layer, traits: [blank, ...layer.traits] }
  })
}
```

- Add before the final `export { pruneRules, rulesTouching } from '@cobweb/dna'`:

```ts
/** The layer a trait belongs to. */
export function layerOfTrait(layers: Layer[], traitId: string): Layer | undefined {
  return layers.find((layer) => layer.traits.some((trait) => trait.id === traitId))
}

/** Puts a layer's weights and constants back as they were before a weight save that failed. */
export function restoreWeights(layers: Layer[], layerId: string, traits: Trait[]): Layer[] {
  const saved = new Map(traits.map((trait) => [trait.id, trait]))
  return mapLayer(layers, layerId, (layer) => ({
    ...layer,
    traits: layer.traits.map((trait) => {
      const was = saved.get(trait.id)
      if (!was) return trait
      const { constant: _dropped, ...rest } = trait
      void _dropped
      return was.constant === undefined
        ? { ...rest, weight: was.weight }
        : { ...rest, weight: was.weight, constant: was.constant }
    }),
  }))
}

/** Drops deleted traits from "at least one" groups, and groups left with fewer than two (as `art_prune` does). */
export function pruneGroups(groups: AtLeastOne[], traitIds: ReadonlySet<string>): AtLeastOne[] {
  return groups.flatMap((group) => {
    const kept = group.traitIds.filter((id) => traitIds.has(id))
    if (kept.length < 2) return []
    return [kept.length === group.traitIds.length ? group : { ...group, traitIds: kept }]
  })
}
```

`apps/web/src/components/art/state/collection-edits.ts`:

- Replace "Seam: in Phase 3 each becomes a server action on the project's collection rows." with "The hooks apply them through `useArtSync()`; saved collections take the database's ids."
- Replace `addCollection` with:

```ts
export function addCollection(
  collections: Collection[],
  name: string,
  id?: string,
): { collections: Collection[]; id: string } {
  const collectionId = id ?? uniqueId(slug(name), new Set(collections.map((collection) => collection.id)))
  return {
    collections: [...collections, { id: collectionId, name, size: NEW_COLLECTION_SIZE }],
    id: collectionId,
  }
}
```

`apps/web/src/components/art/layers/folder-upload/to-layers.ts`: keep the existing imports, add

```ts
import type { ImportPayload, ImportResult } from '@/lib/art/schemas'
import { servedUrl } from '@/lib/storage/uploads-service'
```

and append:

```ts
/** Names longer than the columns allow are clipped, so a long folder name never blocks an import. */
const clip = (name: string, max: number) => name.trim().slice(0, max).trim() || 'Untitled'

/**
 * The folder as `importLayers` takes it: only traits whose image is stored, no empty layers, names
 * within the column limits (48 for collections and layers, 64 for traits). `activeCollectionId` is
 * passed only when the project already has layers (see `mergeUpload`).
 */
export function importPayload(
  detected: DetectedProject,
  images: ReadonlyMap<string, UploadedImage>,
  activeCollectionId?: string,
): ImportPayload {
  return {
    collections: detected.collections.map((collection) => ({
      name: clip(collection.name, 48),
      layers: collection.layers
        .map((layer) => ({
          name: clip(layer.name, 48),
          traits: layer.traits.flatMap((trait) => {
            const image = images.get(trait.key)
            return image ? [{ name: clip(image.name, 64), uploadId: image.uploadId }] : []
          }),
        }))
        .filter((layer) => layer.traits.length > 0),
    })),
    activeCollectionId: activeCollectionId ?? null,
  }
}

/**
 * The imported folder in the store, with the ids `art_import_layers` returned, merged the way the
 * database merged it: one collection fills the active one; otherwise new collections follow the
 * existing ones, and a project without layers keeps only the imported collections.
 */
export function applyImport(
  project: ArtProject,
  payload: ImportPayload,
  result: ImportResult,
): Pick<ArtProject, 'collections' | 'activeCollectionId' | 'layers'> {
  const existingLayers = project.layers ?? []
  const fill = payload.activeCollectionId !== null && payload.collections.length === 1
  const existing = existingLayers.length === 0 && !fill ? [] : (project.collections ?? [])
  const added: Collection[] = []
  const layers: Layer[] = []
  payload.collections.forEach((source, c) => {
    const ids = result.collections[c]
    if (!ids) return
    if (!fill) added.push({ id: ids.id, name: source.name, size: 0 })
    source.layers.forEach((sourceLayer, l) => {
      const layerIds = ids.layers[l]
      if (!layerIds) return
      const weights = evenWeights(sourceLayer.traits.length)
      layers.push({
        id: layerIds.id,
        collectionId: ids.id,
        name: sourceLayer.name,
        position: l,
        traits: sourceLayer.traits.map((trait, t): Trait => ({
          id: layerIds.traits[t]!.id,
          layerId: layerIds.id,
          name: trait.name,
          weight: weights[t]!,
          blank: false,
          imageUrl: servedUrl(trait.uploadId),
          thumbnailUrl: servedUrl(trait.uploadId, 'thumb'),
          uploadId: trait.uploadId,
        })),
      })
    })
  })
  return {
    collections: [...existing, ...added],
    activeCollectionId: fill
      ? (payload.activeCollectionId ?? undefined)
      : (added[0]?.id ?? project.activeCollectionId),
    layers: [...existingLayers, ...layers],
  }
}
```

`apps/web/src/components/art/lib/trait-index.ts`: change the first line to `import type { Trait, TraitIndex } from '@cobweb/dna'` and append:

```ts
/** The image a trait grid or chip shows: the thumbnail when there is one, else the full image. */
export function traitThumbUrls(trait: Pick<Trait, 'imageUrl' | 'thumbnailUrl'>): string[] {
  const url = trait.thumbnailUrl ?? trait.imageUrl
  return url ? [url] : []
}
```

Thumbnails in the grids and chips (the composite preview keeps `imageUrl`):

- `apps/web/src/components/art/layers/trait-card.tsx`: line 18 becomes `import { formatCount, traitThumbUrls } from '../lib/trait-index'`; line 108 becomes `urls={traitThumbUrls(trait)}`.
- `apps/web/src/components/art/generate/stats-view.tsx`: line 12 becomes `import { expectedCount, formatCount, traitThumbUrls } from '../lib/trait-index'`; line 177 becomes `urls={traitThumbUrls(trait)}`.
- `apps/web/src/components/art/rules/trait-chip.tsx`: line 2 becomes `import { traitThumbUrls, type TraitEntry } from '../lib/trait-index'`; line 24 becomes `urls={entry ? traitThumbUrls(entry.trait) : []}`.
- `apps/web/src/components/art/rules/rule-dialog.tsx`: line 19 becomes `import { joinOr, traitName, traitThumbUrls, type TraitIndex } from '../lib/trait-index'`; line 58 becomes `urls={traitThumbUrls(trait)}`.

- [ ] **Step 4: Run, expect pass**

Run: `pnpm --filter @cobweb/web exec vitest run src/components/art/state/layer-edits.test.ts src/components/art/layers/folder-upload/to-layers.test.ts`
Expected: every test passes, the six new ones included.

- [ ] **Step 5: The hooks on the sync layer**

`apps/web/src/components/art/layers/add-traits-dialog.tsx`:

- After `type Canvas = { width: number; height: number } | null` add:

```ts
/** A trait image picked here: its name, its preview URL and the file, which the editor uploads. */
export type NewTrait = { name: string; imageUrl: string; file: File }
```

- The prop type `onAdd: (items: { name: string; imageUrl: string }[], canvas: Canvas) => void` becomes `onAdd: (items: NewTrait[], canvas: Canvas) => void`.
- Line 306 becomes `valid.map((entry) => ({ name: names[entry.key]!.trim(), imageUrl: entry.url, file: entry.file })),`.

`apps/web/src/components/art/layers/use-layers-editor.ts` (whole file):

```ts
'use client'

import { useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { countTraits } from '@cobweb/dna'
import {
  addLayer as saveNewLayer,
  deleteLayer as saveLayerDelete,
  moveLayer as saveLayerMove,
  renameLayer as saveLayerName,
} from '@/app/actions/art/layers'
import { updateArtSettings } from '@/app/actions/art/settings'
import { clearTokens } from '@/app/actions/art/tokens'
import {
  addTraits as saveNewTraits,
  deleteTrait as saveTraitDelete,
  renameTrait as saveTraitName,
  setBlank as saveBlank,
  setLayerWeights,
} from '@/app/actions/art/traits'
import type { ActionResult } from '@/lib/art/result'
import { weightRows } from '@/lib/art/rows'
import type { Layer, Trait, TraitCounts } from '@/lib/demo'
import type { ConfirmRequest } from '../confirm-dialog'
import { formatPercent, roundWeight } from '../lib/trait-index'
import type { NameRequest } from '../name-dialog'
import { useArtProject, type ArtProject } from '../state/art-store'
import { useArtSync } from '../state/art-sync'
import {
  addLayer,
  addTraits,
  deleteLayer,
  deleteTrait,
  evenOut,
  layerOfTrait,
  layersOf,
  moveLayer,
  pruneGroups,
  pruneRules,
  renameLayer,
  restoreWeights,
  rulesTouching,
  setBlank,
  setConstant,
  updateTrait,
} from '../state/layer-edits'
import { createUploader } from '../uploads/create-uploader'
import { uploadAll } from '../uploads/upload-once'
import type { NewTrait } from './add-traits-dialog'

const STALE_NOTE = 'Rarity changed after this set was generated. Regenerate to apply the new weights.'

function plural(count: number, one: string, many = `${one}s`) {
  return `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`
}

type Save = () => Promise<ActionResult<unknown>>

/**
 * Everything the Layers screen does to the project, on the layers of the collection being shown
 * (`activeCollectionId`). Each edit shows at once and is saved through `useArtSync()`; creates show
 * once the database has given the row its id. Edits that would invalidate the generated set (adding,
 * moving or deleting a layer, deleting a trait that tokens use) ask first and then clear the set.
 */
export function useLayersEditor(
  collectionId: string,
  seedLayers: Layer[],
  seedCounts: TraitCounts,
  activeCollectionId: string,
) {
  const sync = useArtSync()
  const [project] = useArtProject(collectionId, { layers: seedLayers })
  const allLayers = project.layers ?? seedLayers
  const layers = useMemo(() => layersOf(allLayers, activeCollectionId), [allLayers, activeCollectionId])
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)
  const [naming, setNaming] = useState<NameRequest | null>(null)
  const uploader = useMemo(() => createUploader({ collectionId, kind: 'layer_image' }), [collectionId])
  /** Each layer's traits before the weight edits that are waiting to be saved, for a rollback. */
  const weightsBefore = useRef(new Map<string, Trait[]>())

  // Generated counts: the shared set once it is loaded, else the counts this page was given.
  const counts = useMemo(
    () => (project.tokens === undefined ? seedCounts : project.tokens ? countTraits(project.tokens) : {}),
    [project.tokens, seedCounts],
  )
  // Tokens in the whole project: every token has one trait in each layer of its collection, so the
  // fullest layer of each collection counts that collection's tokens.
  const generated = useMemo(() => {
    if (project.tokens !== undefined) return project.tokens?.length ?? 0
    const perCollection = new Map<string, number>()
    for (const layer of seedLayers) {
      const used = layer.traits.reduce((n, t) => n + (counts[t.id] ?? 0), 0)
      perCollection.set(layer.collectionId, Math.max(perCollection.get(layer.collectionId) ?? 0, used))
    }
    return [...perCollection.values()].reduce((sum, n) => sum + n, 0)
  }, [project.tokens, seedLayers, counts])

  const clearsSet =
    generated > 0
      ? `The ${plural(generated, 'generated token')} will be cleared, and you generate again on the Generate step.`
      : null

  const edit = (apply: (p: ArtProject) => ArtProject, persist?: Save) => void sync.run({ apply, persist })
  const withLayers = (next: (layers: Layer[]) => Layer[], persist?: Save) =>
    edit((p) => ({ ...p, layers: next(p.layers ?? seedLayers) }), persist)
  /** Clears the generated set; queued before the structural edit that needs it. */
  const clearSet = () =>
    edit(
      (p) => ({ ...p, tokens: null, staleNote: null }),
      () => clearTokens(collectionId),
    )
  /** A structural edit: new layers, pruned rules and groups, and the generated set cleared when `clear`. */
  const structural = (next: (layers: Layer[]) => Layer[], clear: boolean, persist: Save) =>
    edit((p) => {
      const layersAfter = next(p.layers ?? seedLayers)
      const ids = new Set(layersAfter.flatMap((layer) => layer.traits.map((trait) => trait.id)))
      return {
        ...p,
        layers: layersAfter,
        rules: p.rules ? pruneRules(p.rules, ids) : p.rules,
        atLeastOne: p.atLeastOne ? pruneGroups(p.atLeastOne, ids) : p.atLeastOne,
        tokens: clear ? null : p.tokens,
        staleNote: clear ? null : p.staleNote,
      }
    }, persist)

  /** Weight edits show at once and are saved as the layer's whole table, 250 ms after the last one. */
  const editWeights = (layerId: string, change: (layers: Layer[]) => Layer[]) => {
    const before = sync.read().layers?.find((layer) => layer.id === layerId)
    if (before && !weightsBefore.current.has(layerId)) weightsBefore.current.set(layerId, before.traits)
    edit((p) => ({
      ...p,
      layers: change(p.layers ?? seedLayers),
      staleNote: generated > 0 ? STALE_NOTE : p.staleNote,
    }))
    sync.debounce.schedule(`weights:${layerId}`, () => {
      const saved = weightsBefore.current.get(layerId)
      weightsBefore.current.delete(layerId)
      const layer = sync.read().layers?.find((candidate) => candidate.id === layerId)
      if (!layer) return
      void sync.run({
        apply: (p) => p,
        persist: () => setLayerWeights(collectionId, layerId, weightRows(layer)),
        undo: (p) => (saved ? { ...p, layers: restoreWeights(p.layers ?? [], layerId, saved) } : p),
      })
    })
  }
  const traitLayer = (traitId: string) => layerOfTrait(sync.read().layers ?? seedLayers, traitId)

  const rulesFor = (traitIds: string[]) =>
    project.rules ? rulesTouching(project.rules, new Set(traitIds)) : 0

  return {
    /** The shown collection's layers, bottom first. */
    layers,
    /** Known once the Rules or Generate screen has loaded them this session. */
    rules: project.rules ?? [],
    counts,
    generated,
    canvas: project.canvas,
    staleNote: project.staleNote,
    confirm,
    closeConfirm: () => setConfirm(null),
    naming,
    closeNaming: () => setNaming(null),

    /**
     * Creator-visible change (spec section 8): a token's traits follow the layer order, so while
     * tokens exist a move asks to clear them first instead of remapping every token's DNA.
     */
    moveLayer: (from: number, to: number) => {
      const layer = layers[from]
      if (!layer || from === to) return
      const move = () =>
        edit(
          (p) => ({ ...p, layers: moveLayer(p.layers ?? seedLayers, activeCollectionId, from, to) }),
          () => saveLayerMove(collectionId, layer.id, to),
        )
      if (!clearsSet) return move()
      setConfirm({
        title: `Move ${layer.name}?`,
        body: [
          `Each token's traits follow the order of the layers, so the order can change only while there are no tokens. ${clearsSet}`,
        ],
        confirmLabel: 'Clear tokens and move',
        destructive: true,
        onConfirm: () => {
          clearSet()
          move()
        },
      })
    },

    /** `into` makes the collection first when the project has none (the first layer of a project). */
    askAddLayer: (onAdded: (id: string) => void, into?: () => Promise<string | null>) =>
      setNaming({
        title: 'Add a layer',
        description: 'New layers go on top of the stack. Drag them to change the order.',
        label: 'Layer name',
        initial: '',
        confirmLabel: 'Add layer',
        taken: layers.map((layer) => layer.name),
        warning: clearsSet ? `Every token needs a trait from each layer. ${clearsSet}` : undefined,
        onSubmit: (name) =>
          void (async () => {
            if (generated > 0) clearSet()
            const target = into ? await into() : activeCollectionId
            if (!target) return
            let id = ''
            const added = await sync.create<{ id: string }>({
              persist: () => saveNewLayer(collectionId, target, name),
              apply: (p, data) => {
                const result = addLayer(p.layers ?? seedLayers, target, name, data?.id)
                id = result.id
                return { ...p, layers: result.layers }
              },
            })
            if (added) onAdded(id)
          })(),
      }),

    askRenameLayer: (layer: Layer) =>
      setNaming({
        title: 'Rename layer',
        label: 'Layer name',
        initial: layer.name,
        confirmLabel: 'Save name',
        taken: layers.filter((other) => other.id !== layer.id).map((other) => other.name),
        onSubmit: (name) =>
          withLayers(
            (current) => renameLayer(current, layer.id, name),
            () => saveLayerName(collectionId, layer.id, name, layer.displayName ?? null),
          ),
      }),

    askDeleteLayer: (layer: Layer, onDeleted: () => void) => {
      const rules = rulesFor(layer.traits.map((trait) => trait.id))
      setConfirm({
        title: `Delete ${layer.name}?`,
        body: [
          `${layer.name} and its ${plural(layer.traits.length, 'trait')} are removed from the project.`,
          ...(rules ? [`${plural(rules, 'rule')} that use these traits will be removed or trimmed.`] : []),
          ...(clearsSet ? [clearsSet] : []),
        ],
        confirmLabel: 'Delete layer',
        destructive: true,
        onConfirm: () => {
          // The tokens go inside the same transaction (`art_delete_layer` with its flag).
          structural(
            (current) => deleteLayer(current, layer.id),
            generated > 0,
            () => saveLayerDelete(collectionId, layer.id, generated > 0),
          )
          onDeleted()
        },
      })
    },

    askRenameTrait: (layer: Layer, trait: Trait) =>
      setNaming({
        title: 'Rename trait',
        description: 'Collectors see this name in the token metadata.',
        label: 'Trait name',
        initial: trait.name,
        confirmLabel: 'Save name',
        taken: layer.traits.filter((other) => other.id !== trait.id).map((other) => other.name),
        onSubmit: (name) =>
          withLayers(
            (current) => updateTrait(current, trait.id, { name }),
            () => saveTraitName(collectionId, trait.id, name),
          ),
      }),

    askDeleteTrait: (layer: Layer, trait: Trait) => {
      const used = counts[trait.id] ?? 0
      const rules = rulesFor([trait.id])
      setConfirm({
        title: `Delete ${trait.name}?`,
        body: [
          trait.constant
            ? `${trait.name} is removed from ${layer.name}.`
            : `${trait.name} is removed from ${layer.name}. Its ${formatPercent(trait.weight)} share is left unassigned, so you decide where it goes. The other weights stay as they are.`,
          ...(rules ? [`${plural(rules, 'rule')} that use it will be removed or trimmed.`] : []),
          ...(used > 0 && clearsSet ? [`${plural(used, 'generated token')} use it. ${clearsSet}`] : []),
        ],
        confirmLabel: trait.blank ? 'Turn off blank' : 'Delete trait',
        destructive: true,
        onConfirm: () => {
          if (used > 0) clearSet()
          structural(
            (current) => deleteTrait(current, trait.id),
            used > 0,
            () => saveTraitDelete(collectionId, trait.id),
          )
        },
      })
    },

    /** Project-wide: blank traits written into the metadata (legacy `show_blank_traits`). */
    showBlankTraits: project.showBlankTraits,
    setShowBlankTraits: (on: boolean) =>
      edit(
        (p) => ({ ...p, showBlankTraits: on }),
        () => updateArtSettings(collectionId, { showBlankTraits: on }),
      ),

    /** Percent, 0 to 100, kept to two decimals as the legacy tool did. */
    setWeight: (traitId: string, weight: number) => {
      const layer = traitLayer(traitId)
      if (layer)
        editWeights(layer.id, (current) => updateTrait(current, traitId, { weight: roundWeight(weight) }))
    },
    setConstant: (traitId: string, count: number | null) => {
      const layer = traitLayer(traitId)
      if (layer) editWeights(layer.id, (current) => setConstant(current, traitId, count))
    },
    evenOut: (layerId: string) => editWeights(layerId, (current) => evenOut(current, layerId)),

    setBlank: (layer: Layer, on: boolean) => {
      const blank = layer.traits.find((trait) => trait.blank)
      if (on) {
        if (blank) return
        void sync.create<{ id: string | null }>({
          persist: () => saveBlank(collectionId, layer.id, true),
          apply: (p, data) => ({
            ...p,
            layers: setBlank(p.layers ?? seedLayers, layer.id, true, data?.id ?? undefined),
          }),
        })
        return
      }
      if (!blank) return
      const used = counts[blank.id] ?? 0
      setConfirm({
        title: `Turn off the blank trait in ${layer.name}?`,
        body: [
          `Every token will then have a ${layer.name} trait. The blank's ${formatPercent(blank.weight)} share is left unassigned.`,
          ...(used > 0 && clearsSet
            ? [`${plural(used, 'generated token')} leave this layer out. ${clearsSet}`]
            : []),
        ],
        confirmLabel: 'Turn off blank',
        destructive: used > 0,
        onConfirm: () => {
          if (used > 0) clearSet()
          structural(
            (current) => setBlank(current, layer.id, false),
            used > 0,
            () => saveBlank(collectionId, layer.id, false),
          )
        },
      })
    },

    /** Uploads the picked images, then adds them at 0% with the ids the database gave them. */
    addTraits: async (layerId: string, items: NewTrait[], canvas: ArtProject['canvas']) => {
      const withCanvas = (p: ArtProject, layersAfter: Layer[]): ArtProject => ({
        ...p,
        layers: layersAfter,
        canvas: p.canvas ?? canvas,
      })
      // Sample mode keeps the picked files' previews and saves nothing.
      if (sync.demo) {
        edit((p) => withCanvas(p, addTraits(p.layers ?? seedLayers, layerId, items).layers))
        return
      }
      const uploading = toast.loading(
        items.length === 1 ? 'Uploading 1 image.' : `Uploading ${items.length} images.`,
      )
      const results = await uploadAll(
        uploader,
        items.map((item) => item.file),
      )
      toast.dismiss(uploading)
      for (const item of items) URL.revokeObjectURL(item.imageUrl)
      const stored = items.flatMap((item, i) => {
        const result = results[i]
        return result && 'record' in result ? [{ name: item.name, record: result.record }] : []
      })
      const failed = items.length - stored.length
      if (failed > 0)
        toast.error(
          failed === 1
            ? '1 image could not be uploaded. Add it again to retry.'
            : `${failed} images could not be uploaded. Add them again to retry.`,
        )
      if (stored.length === 0) return
      await sync.create<{ ids: string[] }>({
        persist: () =>
          saveNewTraits(
            collectionId,
            layerId,
            stored.map(({ name, record }) => ({ name, uploadId: record.id })),
          ),
        apply: (p, data) =>
          withCanvas(
            p,
            addTraits(
              p.layers ?? seedLayers,
              layerId,
              stored.map(({ name, record }) => ({
                name,
                imageUrl: record.url,
                uploadId: record.id,
                ...(record.thumbnailUrl ? { thumbnailUrl: record.thumbnailUrl } : {}),
              })),
              data?.ids,
            ).layers,
          ),
      })
    },
  }
}

export type LayersEditor = ReturnType<typeof useLayersEditor>
```

`apps/web/src/components/art/rules/use-rules-editor.ts` (whole file):

```ts
'use client'

import { useMemo } from 'react'
import { addRule, deleteRule, updateRule } from '@/app/actions/art/rules'
import type { ActionResult } from '@/lib/art/result'
import type { ArtRule, Layer, RuleConflict } from '@/lib/demo'
import { buildTraitIndex } from '../lib/trait-index'
import { useArtProject } from '../state/art-store'
import { useArtSync } from '../state/art-sync'
import { pruneRules } from '../state/layer-edits'
import { activeRules, analyseRules, isBidirectional } from '../state/rule-logic'
import { tokensBreakingRules } from '../state/token-logic'

export type RuleDraft = Omit<ArtRule, 'id' | 'bidirectional'>

/** Sample mode names new rules itself; saved rules take the database's id. */
let sampleRules = 0

/**
 * The rules of the project and what the analyser says about them. Until anything changes, the
 * conflicts are the ones the page was given; after an edit they are recomputed in the browser.
 * Every edit is saved through `useArtSync()`; a new rule shows once the database has given it its id.
 */
export function useRulesEditor(
  collectionId: string,
  seedLayers: Layer[],
  seedRules: ArtRule[],
  seedConflicts: RuleConflict[],
) {
  const sync = useArtSync()
  const [project] = useArtProject(collectionId, { layers: seedLayers, rules: seedRules })
  const layers = project.layers ?? seedLayers
  const index = useMemo(() => buildTraitIndex(layers), [layers])
  // Rules pointing at traits deleted on the Layers step are dropped here.
  const rules = useMemo(
    () => pruneRules(project.rules ?? seedRules, new Set(index.keys())),
    [project.rules, seedRules, index],
  )
  const untouched = rules === seedRules && layers === seedLayers
  const conflicts = useMemo(
    () => (untouched ? seedConflicts : analyseRules(layers, rules, index)),
    [untouched, seedConflicts, layers, rules, index],
  )
  const tokens = project.tokens ?? null

  /**
   * Generated tokens that break a set of rules (the rules generation applies, conflicts aside).
   * The legacy tool never re-checked tokens after a rule change; here every edit says how many
   * tokens it leaves breaking, and Generate marks them.
   */
  const breakingWith = (next: ArtRule[]) =>
    tokens ? tokensBreakingRules(tokens, activeRules(next, analyseRules(layers, next, index))) : []
  const breaking = useMemo(
    () => (tokens ? tokensBreakingRules(tokens, activeRules(rules, conflicts)) : []),
    [tokens, rules, conflicts],
  )

  /** Shows the rules at once, saves the change, and returns how many generated tokens break them. */
  const write = (next: (current: ArtRule[]) => ArtRule[], persist: () => Promise<ActionResult<unknown>>) => {
    void sync.run({ apply: (p) => ({ ...p, rules: next(p.rules ?? seedRules) }), persist })
    return breakingWith(next(rules)).length
  }

  return {
    layers,
    index,
    rules,
    conflicts,
    hasTokens: !!tokens,
    /** Ids of generated tokens that break the current rules. */
    breaking,
    /** Adds a rule once it is saved; its id and how many generated tokens then break the rules, or null. */
    add: async (draft: RuleDraft): Promise<{ id: string; broken: number } | null> => {
      let id = ''
      const added = await sync.create<{ id: string }>({
        persist: () => addRule(collectionId, draft),
        apply: (p, data) => {
          id = data?.id ?? `rule-new-${Date.now().toString(36)}-${++sampleRules}`
          const rule: ArtRule = { ...draft, id, bidirectional: isBidirectional(draft.kind) }
          return { ...p, rules: [...(p.rules ?? seedRules), rule] }
        },
      })
      return added ? { id, broken: breakingWith(sync.read().rules ?? []).length } : null
    },
    /** Saves a rule; returns how many generated tokens now break the rules. */
    edit: (id: string, draft: RuleDraft) =>
      write(
        (current) =>
          current.map((rule) =>
            rule.id === id ? { ...rule, ...draft, bidirectional: isBidirectional(draft.kind) } : rule,
          ),
        () => updateRule(collectionId, id, draft),
      ),
    remove: (id: string) =>
      write(
        (current) => current.filter((rule) => rule.id !== id),
        () => deleteRule(collectionId, id),
      ),
  }
}

export type RulesEditor = ReturnType<typeof useRulesEditor>
```

`apps/web/src/components/art/rules-screen.tsx`, in the `RuleDialog`'s `onSave`, the `else` branch becomes:

```tsx
          } else {
            void editor.add(draft).then((added) => {
              if (!added) return
              highlight([added.id])
              saved('Rule added', added.broken)
            })
          }
```

`apps/web/src/components/art/collections/use-collections.ts` (whole file):

```ts
'use client'

import { useState } from 'react'
import { addArtCollection, deleteArtCollection, renameArtCollection } from '@/app/actions/art/art-collections'
import { startOver } from '@/app/actions/art/project'
import type { Collection } from '@/lib/demo'
import type { ConfirmRequest } from '../confirm-dialog'
import { buildTraitIndex } from '../lib/trait-index'
import type { NameRequest } from '../name-dialog'
import { useArtProject, type ArtSeed } from '../state/art-store'
import { useArtSync } from '../state/art-sync'
import { addCollection, renameCollection, rulesOf } from '../state/collection-edits'
import { layersOf, pruneRules } from '../state/layer-edits'
import { deleteTokens } from '../state/token-logic'

function plural(count: number, one: string, many = `${one}s`) {
  return `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`
}

/**
 * The project's collections and the one Layers and Rules are showing. Adding, renaming and
 * deleting a collection ask first; deleting removes its layers, its rules and its generated tokens
 * (the later ids move up, so ids stay 1 to N). "Start over" empties the project's art. Every change
 * is saved through `useArtSync()`; a new collection shows once the database has given it its id.
 *
 * `projectKey` is the Cobweb collection id the art belongs to; `tokenName` names the tokens.
 */
export function useCollections(projectKey: string, tokenName: string, seed: ArtSeed) {
  const sync = useArtSync()
  const [project] = useArtProject(projectKey, seed)
  const collections: Collection[] = project.collections ?? seed.collections ?? []
  const activeId = collections.some((c) => c.id === project.activeCollectionId)
    ? project.activeCollectionId!
    : (collections[0]?.id ?? '')
  const active = collections.find((c) => c.id === activeId) ?? null
  // Until the project has layers, the folder upload decides its collections; no switcher yet.
  const hasLayers = (project.layers ?? seed.layers ?? []).length > 0
  const [naming, setNaming] = useState<NameRequest | null>(null)
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)

  const select = (id: string) => void sync.run({ apply: (p) => ({ ...p, activeCollectionId: id }) })

  /** Adds a collection once it is saved and shows it; its id, or null when it could not be saved. */
  const add = async (name: string): Promise<string | null> => {
    let id = ''
    const added = await sync.create<{ id: string }>({
      persist: () => addArtCollection(projectKey, name),
      apply: (p, data) => {
        const result = addCollection(p.collections ?? collections, name, data?.id)
        id = result.id
        return { ...p, collections: result.collections, activeCollectionId: result.id }
      },
    })
    return added ? id : null
  }

  /** The shown collection's id, creating one named after the project when there is none yet. */
  const ensureOne = (name: string): Promise<string | null> =>
    activeId ? Promise.resolve(activeId) : add(name)

  return {
    collections,
    activeId,
    active,
    hasLayers,
    select,
    ensureOne,
    naming,
    closeNaming: () => setNaming(null),
    confirm,
    closeConfirm: () => setConfirm(null),

    askAdd: () =>
      setNaming({
        title: 'Add a collection',
        description:
          'A collection has its own layers, rules and size, for example male and female. Token ids run on from one collection to the next.',
        label: 'Collection name',
        initial: '',
        confirmLabel: 'Add collection',
        taken: collections.map((c) => c.name),
        onSubmit: (name) => void add(name),
      }),

    askRename: (collection: Collection) =>
      setNaming({
        title: 'Rename collection',
        label: 'Collection name',
        initial: collection.name,
        confirmLabel: 'Save name',
        taken: collections.filter((c) => c.id !== collection.id).map((c) => c.name),
        onSubmit: (name) =>
          void sync.run({
            apply: (p) => ({
              ...p,
              collections: renameCollection(p.collections ?? collections, collection.id, name),
            }),
            persist: () => renameArtCollection(projectKey, collection.id, name),
          }),
      }),

    askDelete: (collection: Collection) => {
      const layers = layersOf(project.layers ?? seed.layers ?? [], collection.id)
      const rules = rulesOf(
        project.rules ?? seed.rules ?? [],
        project.layers ?? seed.layers ?? [],
        collection.id,
      )
      const tokens = (project.tokens === undefined ? seed.tokens : project.tokens) ?? []
      const own = tokens.filter((t) => t.collectionId === collection.id).length
      setConfirm({
        title: `Delete ${collection.name}?`,
        body: [
          `${collection.name} and its ${plural(layers.length, 'layer')} are removed from the project. This cannot be undone.`,
          ...(rules.length ? [`Its ${plural(rules.length, 'rule')} will be removed.`] : []),
          ...(own
            ? [
                `Its ${plural(own, 'generated token')} will be removed, and later token ids move up to close the gap.`,
              ]
            : []),
        ],
        confirmLabel: 'Delete collection',
        destructive: true,
        onConfirm: () =>
          void sync.run({
            apply: (p) => {
              const allLayers = p.layers ?? seed.layers ?? []
              const keptLayers = allLayers.filter((layer) => layer.collectionId !== collection.id)
              const keptIds = new Set(keptLayers.flatMap((layer) => layer.traits.map((trait) => trait.id)))
              const current = p.tokens === undefined ? seed.tokens : p.tokens
              const drop = new Set(
                (current ?? []).filter((t) => t.collectionId === collection.id).map((t) => t.id),
              )
              const nextCollections = (p.collections ?? collections).filter((c) => c.id !== collection.id)
              return {
                ...p,
                collections: nextCollections,
                activeCollectionId: nextCollections[0]?.id,
                layers: keptLayers,
                rules: pruneRules(p.rules ?? seed.rules ?? [], keptIds),
                atLeastOne: (p.atLeastOne ?? []).filter((group) => group.collectionId !== collection.id),
                tokens: current
                  ? deleteTokens(current, drop, {
                      tokenName: p.tokenName ?? tokenName,
                      index: buildTraitIndex(keptLayers),
                    })
                  : current,
              }
            },
            persist: () => deleteArtCollection(projectKey, collection.id),
          }),
      })
    },

    /** Deletes every collection, layer, trait image, rule and token of the project, and frees the canvas. */
    askStartOver: () => {
      const allLayers = project.layers ?? seed.layers ?? []
      const images = allLayers.reduce(
        (n, layer) => n + layer.traits.filter((trait) => !trait.blank).length,
        0,
      )
      const tokens = (project.tokens === undefined ? seed.tokens : project.tokens)?.length ?? 0
      setConfirm({
        title: 'Start over?',
        body: [
          `Every collection, its ${plural(allLayers.length, 'layer')} and ${plural(images, 'trait image')} are deleted, with the rules${tokens ? ` and the ${plural(tokens, 'generated token')}` : ''}. This cannot be undone.`,
          'Layers then opens on the folder upload, and the images can be any size again.',
        ],
        confirmLabel: 'Delete everything',
        destructive: true,
        onConfirm: () =>
          void sync.run({
            apply: (p) => ({
              ...p,
              collections: [],
              activeCollectionId: undefined,
              layers: [],
              rules: [],
              atLeastOne: [],
              tokens: null,
              canvas: null,
              staleNote: null,
            }),
            persist: () => startOver(projectKey),
          }),
      })
    },
  }
}

export type CollectionsControl = ReturnType<typeof useCollections>
```

`apps/web/src/components/art/collections/collection-switcher.tsx`:

- The lucide import becomes `import { EllipsisIcon, PencilIcon, PlusIcon, RotateCcwIcon, Trash2Icon } from 'lucide-react'`; the dropdown import adds `DropdownMenuSeparator`.
- The props become `{ control, readOnly, onStartOver }: { control: CollectionsControl; readOnly: boolean; onStartOver?: () => void }`, and the doc comment gains the sentence "On Layers the menu also offers "Start over", which empties the project's art after a confirmation."
- After the delete `DropdownMenuItem` (inside `DropdownMenuContent`) add:

```tsx
{
  onStartOver && (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuItem variant="destructive" onSelect={onStartOver}>
        <RotateCcwIcon />
        Start over
      </DropdownMenuItem>
    </>
  )
}
```

`apps/web/src/components/art/layers/folder-upload/use-folder-upload.ts`:

- Imports: remove `import { useArtProject } from '../../state/art-store'`; add

```ts
import { importLayers } from '@/app/actions/art/layers'
import type { ImportResult } from '@/lib/art/schemas'
import { useArtSync } from '../../state/art-sync'
```

and change `import { mergeUpload, type UploadedImage } from './to-layers'` to `import { applyImport, importPayload, mergeUpload, type UploadedImage } from './to-layers'`.

- Replace `const [, update] = useArtProject(collectionId, {})` with `const sync = useArtSync()` and add `const [saving, setSaving] = useState(false)` after the `canvas` state.
- Replace the whole `finish` callback with:

```ts
/**
 * Saves the uploaded layers in one transaction, then shows them with the ids the database gave
 * them; the Layers screen then replaces this upload. A refused save keeps the review on screen.
 */
const finish = useCallback(async () => {
  if (!detected) return
  const names = new Map(
    detected.collections.flatMap((c) =>
      c.layers.flatMap((layer) => layer.traits.map((t) => [t.key, t.name])),
    ),
  )
  const images = new Map<string, UploadedImage>()
  for (const item of items) {
    if (item.state !== 'done' || !item.record) continue
    images.set(item.id, {
      url: item.record.url,
      name: names.get(item.id) ?? traitNameFromFile(item.file.name),
      uploadId: item.record.id,
    })
  }
  const payload = importPayload(detected, images, activeCollectionId)
  setSaving(true)
  const saved = await sync.create<ImportResult>({
    persist: () => importLayers(collectionId, payload),
    apply: (project, data) => ({
      ...project,
      ...(data
        ? applyImport(project, payload, data)
        : mergeUpload(project, detected, images, activeCollectionId)),
      canvas: project.canvas ?? canvas,
    }),
  })
  setSaving(false)
  // The traits now point at the stored files, so the previews can go.
  if (saved) release()
}, [detected, items, release, sync, collectionId, activeCollectionId, canvas])
```

- Add `saving,` to the returned object after `canvas,`.

`apps/web/src/components/art/layers/folder-upload/folder-upload.tsx:195`: `<Button onClick={upload.finish}>` becomes `<Button onClick={() => void upload.finish()} disabled={upload.saving}>`.

`apps/web/src/components/art/layers-screen.tsx`:

- Add `import { useArtSync } from './state/art-sync'`.
- In the props destructuring, `readOnly,` becomes `readOnly: readOnlyProp,`; as the first lines of the function body add:

```tsx
const sync = useArtSync()
// A save that came back locked turns every control read only at once.
const readOnly = readOnlyProp || sync.locked
```

- The `FolderUpload`'s `onAddLayer` becomes `onAddLayer={() => editor.askAddLayer(setSelectedId, () => collections.ensureOne(collection.name))}`.
- `<CollectionSwitcher control={collections} readOnly={readOnly} />` becomes `<CollectionSwitcher control={collections} readOnly={readOnly} onStartOver={collections.askStartOver} />`.
- The `AddTraitsDialog`'s `onAdd` becomes `onAdd={(items, canvas) => upload && void editor.addTraits(upload.layerId, items, canvas)}`.

`apps/web/src/components/art/rules-screen.tsx`: add `import { useArtSync } from './state/art-sync'`; in the props destructuring `readOnly,` becomes `readOnly: readOnlyProp,`; as the first lines of the body add:

```tsx
const sync = useArtSync()
const readOnly = readOnlyProp || sync.locked
```

- [ ] **Step 6: Root checks**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: clean. A type error in `layers-screen.tsx` or `rules-screen.tsx` about `editor.add` or `askAddLayer` means a call site above was missed.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/art
git commit -F - <<'MSG'
Save Layers, Rules and Collections edits as they happen, import folders in one transaction and add Start over

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011bcHX4HZG5YGWhxjGuiWos
MSG
```

### Task 6: Generate on the sync layer, "at least one" in the engine calls, and the seed

**Files:**

- Modify: `apps/web/src/components/art/state/generation.ts`, `apps/web/src/components/art/state/token-logic.ts`
- Test: `apps/web/src/components/art/state/generation.test.ts` (one new test)
- Modify (whole file given): `apps/web/src/components/art/generate/use-generator.ts`
- Modify: `apps/web/src/components/art/generate-screen.tsx`

**Interfaces:**

- Consumes: `useArtSync()` (Task 4); `saveTokens`, `updateTokens`, `swapTokens`, `deleteTokens`, `appendTokens`, `setArtCollectionSize`, `updateArtSettings` (Task 3); `tokenInputs`, `changedTokens`, `appendedTokens`, `saveLimitProblem` (Task 3); `AtLeastOne` from `@/lib/demo`.
- Produces:
  - `SetContext` gains `atLeastOne?: AtLeastOne[]`; `generateSet`, `regenerate`, `fillTo` and `changeTrait` pass it to the engine.
  - `useGenerator(collectionId, project0, start: { collections: Collection[]; layers: Layer[]; rules: ArtRule[]; tokens: GeneratedToken[] | null })`; same return shape plus `generatedFrom: number | null` (the seed of the set on screen).
  - `GenerateScreenProps.tokens: GeneratedToken[] | null`.

Token operations, as spec section 8 maps them:

| Screen action     | Store                          | Saved as                                                               |
| ----------------- | ------------------------------ | ---------------------------------------------------------------------- |
| Generate          | `generateSet` with `newSeed()` | `saveTokens(all, seed)`, then `setCollectionSupply` as today           |
| Re-roll selected  | `regenerate`                   | `updateTokens(changedTokens(before, after))`                           |
| Change one trait  | `changeTrait`                  | `updateTokens` (one row)                                               |
| Describe one      | `setDescription`               | `updateTokens([{ tokenId, description }])`, debounced 250 ms per token |
| Describe all      | descriptions set               | `updateTokens(changedTokens(before, after))`                           |
| Swap two ids      | `swapIds`                      | `swapTokens(a, b)`                                                     |
| Delete tokens     | `deleteTokens`                 | `deleteTokens(ids)`                                                    |
| Shuffle ids       | `shuffleIds`                   | `saveTokens(all, project.seed)` (same seed)                            |
| Fill to size      | `fillTo`                       | `appendTokens(appendedTokens(before, after))`                          |
| Token name        | `renameTokens`                 | `updateArtSettings({ tokenName })`, debounced; names are not stored    |
| Token description | `tokenDescription`             | `updateArtSettings({ tokenDescription })`, debounced                   |
| Collection size   | `setCollectionSize`            | `setArtCollectionSize(id, size)`, debounced per collection             |

Decision: Generate flushes the waiting debounced saves first, so the sizes and the token name the set was made with are saved before the set.

Decision: Generate refuses before rolling when the sizes add up to more than 100,000 tokens (`MAX_SUPPLY`, through `saveLimitProblem`), because `art_save_tokens` refuses more rows (Review Focus 5). The engine's own 10,000 limit per art collection stays as it is.

Decision: in sample mode Generate no longer saves the supply either (`setCollectionSupply` is skipped), because sample mode persists nothing.

Decision: the seed shows as a hint under the Tokens figure, "Generated from seed <n>", whenever tokens are on screen; the number is shown without separators because it is an identifier.

- [ ] **Step 1: Write the failing test**

In `apps/web/src/components/art/state/generation.test.ts` append:

```ts
describe('"at least one" groups (art wiring)', () => {
  it('generates only tokens that carry one of the group traits', () => {
    const eyes: Layer = {
      id: 'eyes',
      collectionId: 'c',
      name: 'Eyes',
      position: 0,
      traits: 'abcdefghij'.split('').map((id) => ({
        id,
        layerId: 'eyes',
        name: id.toUpperCase(),
        weight: 10,
        blank: false,
        imageUrl: `/${id}.png`,
      })),
    }
    const outcome = generateSet(
      [eyes],
      [],
      [{ id: 'c', name: 'C', size: 2 }],
      7,
      {
        tokenName: 'Owl',
        index: buildTraitIndex([eyes]),
        atLeastOne: [{ id: 'g', collectionId: 'c', traitIds: ['a', 'b'] }],
      },
      '',
    )
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.tokens.map((token) => token.dna[0]).sort()).toEqual(['a', 'b'])
  })
})
```

- [ ] **Step 2: Run, expect failure**

Run: `pnpm --filter @cobweb/web exec vitest run src/components/art/state/generation.test.ts`
Expected: FAIL; `generateSet` ignores the group today, so two of ten equally weighted traits are picked freely and the sorted DNA is not `['a', 'b']` (the assertion prints the actual picks).

- [ ] **Step 3: Implement the engine wiring**

`apps/web/src/components/art/state/generation.ts`:

- The type import becomes `import type { ArtRule, AtLeastOne, Collection, GeneratedToken, Layer } from '@/lib/demo'`.
- `SetContext` becomes:

```ts
/** What names and ranks depend on: the token name chosen at Generate and the current layers; generation also honours `atLeastOne`. */
export type SetContext = { tokenName: string; index: TraitIndex; layers?: Layer[]; atLeastOne?: AtLeastOne[] }
```

- In `generateSet`, `const project: Project = { layers, rules, collections }` becomes `const project: Project = { layers, rules, collections, atLeastOne: ctx.atLeastOne }`.
- In `regenerate`, `regenerateWith(tokens, ids, { layers, rules }, newSeed())` becomes `regenerateWith(tokens, ids, { layers, rules, atLeastOne: ctx.atLeastOne }, newSeed())`.
- In `fillTo`, `{ layers, rules, collections }` becomes `{ layers, rules, collections, atLeastOne: ctx.atLeastOne }`.

`apps/web/src/components/art/state/token-logic.ts`, in `changeTrait`: `changeTraitWith(tokens, tokenId, layerIndex, traitId, { layers, rules }, ctx.index)` becomes `changeTraitWith(tokens, tokenId, layerIndex, traitId, { layers, rules, atLeastOne: ctx.atLeastOne }, ctx.index)`.

- [ ] **Step 4: Run, expect pass**

Run: `pnpm --filter @cobweb/web exec vitest run src/components/art/state/generation.test.ts`
Expected: every test passes.

- [ ] **Step 5: The Generate hook and screen on the sync layer**

`apps/web/src/components/art/generate/use-generator.ts` (whole file):

```ts
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { setArtCollectionSize } from '@/app/actions/art/art-collections'
import { updateArtSettings } from '@/app/actions/art/settings'
import {
  appendTokens,
  deleteTokens as saveDeleted,
  saveTokens,
  swapTokens,
  updateTokens,
} from '@/app/actions/art/tokens'
import { setCollectionSupply } from '@/app/actions/collection-supply'
import type { ActionResult } from '@/lib/art/result'
import { appendedTokens, changedTokens, saveLimitProblem, tokenInputs } from '@/lib/art/token-ops'
import type { ArtRule, Collection, GeneratedToken, Layer } from '@/lib/demo'
import { attributeCounts, attributeKeyOf, buildTraitIndex } from '../lib/trait-index'
import { useArtProject, type ArtProject } from '../state/art-store'
import { useArtSync } from '../state/art-sync'
import { setCollectionSize, supplyOf } from '../state/collection-edits'
import { fillTo, generateSet, newSeed, regenerate, tokenNameProblem } from '../state/generation'
import { layersOf, pruneRules } from '../state/layer-edits'
import { activeRules, analyseRules } from '../state/rule-logic'
import {
  changeTrait,
  countByCollection,
  countTraits,
  deleteTokens,
  renameTokens,
  setDescription,
  shuffleIds,
  swapIds,
  tokensBreakingRules,
  type SetContext,
} from '../state/token-logic'

/** Long enough to read as work being done, short enough not to be in the way. */
const MIN_GENERATE_MS = 900

type Save = () => Promise<ActionResult<unknown>>

/**
 * The generated set and every curation action on it. Actions apply at once and are saved through
 * `useArtSync()` as spec section 8 maps them; a refused trait change comes back as
 * `{ ok: false, reason }`, and a bulk re-roll that cannot finish returns false. The supply is the
 * sum of the collections' sizes; a successful generation saves the set with its seed, then the
 * supply.
 */
export function useGenerator(
  collectionId: string,
  /** The project's name and description: what the token name and description start as. */
  project0: { name: string; description: string },
  start: { collections: Collection[]; layers: Layer[]; rules: ArtRule[]; tokens: GeneratedToken[] | null },
) {
  const sync = useArtSync()
  const [project] = useArtProject(collectionId, start)
  const collections = project.collections ?? start.collections
  const supply = supplyOf(collections)
  const layers = project.layers ?? start.layers
  const index = useMemo(() => buildTraitIndex(layers), [layers])
  const tokenName = project.tokenName ?? project0.name
  const tokenDescription = project.tokenDescription ?? project0.description
  // Both are required, as in the legacy auto-populate.
  const nameProblem = tokenNameProblem(tokenName)
  const ctx: SetContext = { tokenName, index, layers, atLeastOne: project.atLeastOne }
  const rules = useMemo(
    () => pruneRules(project.rules ?? start.rules, new Set(index.keys())),
    [project.rules, start.rules, index],
  )
  const conflicts = useMemo(() => analyseRules(layers, rules, index), [layers, rules, index])
  const active = useMemo(() => activeRules(rules, conflicts), [rules, conflicts])
  const tokens = project.tokens === undefined ? start.tokens : project.tokens
  const counts = useMemo(() => (tokens ? countTraits(tokens) : {}), [tokens])
  // By layer and trait name, every collection together: what a marketplace counts (legacy token details).
  const attributes = useMemo(() => attributeCounts(tokens ?? [], index), [tokens, index])
  const keyOf = useMemo(() => attributeKeyOf(index), [index])
  const perCollection = useMemo(() => countByCollection(tokens ?? []), [tokens])
  const breaking = useMemo(() => (tokens ? tokensBreakingRules(tokens, active) : []), [tokens, active])

  const [generating, setGenerating] = useState(false)
  const [progress, setProgress] = useState(0)
  const [problems, setProblems] = useState<string[]>([])
  const timers = useRef<number[]>([])
  useEffect(() => () => timers.current.forEach((id) => window.clearTimeout(id)), [])
  /** The sizes, token name and description last saved, for a rollback when a debounced save fails. */
  const sizesBefore = useRef(new Map<string, number>())
  const savedName = useRef(tokenName)
  const savedDescription = useRef(tokenDescription)

  /** Shows a new set at once and saves it with `persist`, in order with every other edit. */
  const setTokens = (next: GeneratedToken[] | null, persist?: Save, extra: Partial<ArtProject> = {}) =>
    void sync.run({ apply: (p) => ({ ...p, tokens: next, ...extra }), persist })

  /** The supply is set at Generate: the sum of the collections' sizes. */
  const saveSupply = async (total: number) => {
    if (sync.demo) return
    try {
      const result = await setCollectionSupply(collectionId, total)
      if (!result.ok) toast.error(result.error)
    } catch {
      toast.error('The supply could not be saved. Generate again to retry.')
    }
  }

  const generate = () => {
    const problem = nameProblem ?? saveLimitProblem(supply)
    if (problem) {
      setProblems([problem])
      return
    }
    // Sizes and names still waiting go first, so the set is saved after what it was made from.
    sync.debounce.flush()
    setGenerating(true)
    setProblems([])
    setProgress(8)
    const started = performance.now()
    // Let the progress state paint before the synchronous generator runs.
    timers.current.push(
      window.setTimeout(() => {
        setProgress(35)
        const seed = newSeed()
        const outcome = generateSet(layers, active, collections, seed, ctx, tokenDescription.trim())
        const wait = Math.max(0, MIN_GENERATE_MS - (performance.now() - started))
        timers.current.push(window.setTimeout(() => setProgress(80), wait / 2))
        timers.current.push(
          window.setTimeout(() => {
            setProgress(100)
            if (outcome.ok) {
              setTokens(outcome.tokens, () => saveTokens(collectionId, tokenInputs(outcome.tokens), seed), {
                seed,
                staleNote: null,
              })
              void saveSupply(outcome.tokens.length)
            } else setProblems(outcome.problems)
            setGenerating(false)
          }, wait),
        )
      }, 60),
    )
  }

  return {
    collections,
    supply,
    /** Tokens generated per collection, by collection id. */
    perCollection,
    /** One collection's layers; a token's DNA follows its collection's. */
    layersOf: (id: string) => layersOf(layers, id),
    /** Shows at once; saved 250 ms after the last change to that collection's size. */
    setSize: (id: string, size: number) => {
      const before = sync.read().collections?.find((c) => c.id === id)?.size
      if (before !== undefined && !sizesBefore.current.has(id)) sizesBefore.current.set(id, before)
      void sync.run({
        apply: (p) => ({ ...p, collections: setCollectionSize(p.collections ?? collections, id, size) }),
      })
      sync.debounce.schedule(`size:${id}`, () => {
        const saved = sizesBefore.current.get(id)
        sizesBefore.current.delete(id)
        const now = sync.read().collections?.find((c) => c.id === id)
        if (!now) return
        void sync.run({
          apply: (p) => p,
          persist: () => setArtCollectionSize(collectionId, id, now.size),
          undo: (p) =>
            saved === undefined
              ? p
              : { ...p, collections: setCollectionSize(p.collections ?? [], id, saved) },
        })
      })
    },
    layers,
    index,
    rules,
    active,
    conflicts,
    tokens,
    counts,
    /** Tokens with the same attribute (layer and trait name) as this trait, every collection together. */
    attributeCount: (traitId: string) => attributes.get(keyOf(traitId)) ?? 0,
    breaking,
    staleNote: project.staleNote,
    /** The seed the set on screen was generated from, or null before the first generation. */
    generatedFrom: tokens && tokens.length > 0 ? project.seed : null,
    generating,
    progress,
    problems,
    dismissProblems: () => setProblems([]),
    generate,

    /** The token name ("<name> #<id>") and description; a valid new name renames the set at once. */
    tokenName,
    tokenDescription,
    nameProblem,
    setTokenName: (name: string) => {
      void sync.run({
        apply: (p) => {
          const next = { ...p, tokenName: name }
          if (tokenNameProblem(name) || !p.tokens) return next
          return { ...next, tokens: renameTokens(p.tokens, { tokenName: name, index }) }
        },
      })
      if (tokenNameProblem(name)) return
      sync.debounce.schedule('tokenName', () => {
        const previous = savedName.current
        void sync.run({
          apply: (p) => p,
          persist: async () => {
            const result = await updateArtSettings(collectionId, { tokenName: name })
            if (result.ok) savedName.current = name
            return result
          },
          undo: (p) => ({
            ...p,
            tokenName: previous,
            tokens: p.tokens ? renameTokens(p.tokens, { tokenName: previous, index }) : p.tokens,
          }),
        })
      })
    },
    /** The description new tokens get. Tokens already generated keep theirs; regenerate to apply it. */
    setTokenDescription: (description: string) => {
      void sync.run({ apply: (p) => ({ ...p, tokenDescription: description }) })
      sync.debounce.schedule('tokenDescription', () => {
        const previous = savedDescription.current
        void sync.run({
          apply: (p) => p,
          persist: async () => {
            const result = await updateArtSettings(collectionId, { tokenDescription: description })
            if (result.ok) savedDescription.current = description
            return result
          },
          undo: (p) => ({ ...p, tokenDescription: previous }),
        })
      })
    },
    /** Blank traits written into the metadata (legacy `show_blank_traits`). */
    showBlankTraits: project.showBlankTraits,
    describe: (tokenId: number, description: string) => {
      if (!tokens) return
      void sync.run({
        apply: (p) => ({ ...p, tokens: p.tokens && setDescription(p.tokens, tokenId, description) }),
      })
      sync.debounce.schedule(
        `describe:${tokenId}`,
        () =>
          void sync.run({
            apply: (p) => p,
            persist: () => updateTokens(collectionId, [{ tokenId, description }]),
          }),
      )
    },
    describeAll: () => {
      if (!tokens) return
      const next = tokens.map((token) => ({ ...token, description: tokenDescription.trim() }))
      setTokens(next, () => updateTokens(collectionId, changedTokens(tokens, next)))
    },

    regenerate: (ids: ReadonlySet<number>) => {
      if (!tokens) return false
      const next = regenerate(tokens, ids, layers, active, ctx)
      if (next) setTokens(next, () => updateTokens(collectionId, changedTokens(tokens, next)))
      return !!next
    },
    fill: () => {
      if (!tokens) return false
      const next = fillTo(tokens, collections, layers, active, ctx, tokenDescription.trim())
      if (next) setTokens(next, () => appendTokens(collectionId, appendedTokens(tokens, next)))
      return !!next
    },
    remove: (ids: ReadonlySet<number>) => {
      if (!tokens) return
      setTokens(deleteTokens(tokens, ids, ctx), () => saveDeleted(collectionId, [...ids]))
    },
    shuffle: (ids: ReadonlySet<number>) => {
      if (!tokens) return
      const next = shuffleIds(tokens, ids, ctx)
      setTokens(next, () => saveTokens(collectionId, tokenInputs(next), project.seed))
    },
    swap: (a: number, b: number) => {
      if (!tokens) return
      setTokens(swapIds(tokens, a, b, ctx), () => swapTokens(collectionId, a, b))
    },
    change: (tokenId: number, layerIndex: number, traitId: string) => {
      if (!tokens) return { ok: false as const, reason: 'Nothing is generated yet.' }
      const outcome = changeTrait(tokens, tokenId, layerIndex, traitId, active, ctx)
      if (outcome.ok)
        setTokens(outcome.tokens, () => updateTokens(collectionId, changedTokens(tokens, outcome.tokens)))
      return outcome
    },
  }
}

export type Generator = ReturnType<typeof useGenerator>
```

`apps/web/src/components/art/generate-screen.tsx`:

- Add `import { useArtSync } from './state/art-sync'`.
- In `GenerateScreenProps`, `tokens: GeneratedToken[]` becomes `tokens: GeneratedToken[] | null` (keep its comment, adding "null before the first generation").
- In the props destructuring, `readOnly,` becomes `readOnly: readOnlyProp,`; as the first lines of the body add:

```tsx
const sync = useArtSync()
// A save that came back locked turns every control read only at once.
const readOnly = readOnlyProp || sync.locked
```

- The Tokens figure becomes:

```tsx
<Stat
  label="Tokens"
  value={n(count)}
  suffix={`/ ${n(supply)}`}
  hint={generator.generatedFrom === null ? undefined : `Generated from seed ${generator.generatedFrom}`}
/>
```

- [ ] **Step 6: Root checks**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: clean. `generate/page.tsx` still passes `DEMO_TOKENS`, which fits `GeneratedToken[] | null`.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/art
git commit -F - <<'MSG'
Save the generated set and every curation edit, and show the seed it came from

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011bcHX4HZG5YGWhxjGuiWos
MSG
```

### Task 7: The Art pages load real rows; read only and deferred art come from the columns

**Files:**

- Create: `apps/web/src/lib/art/read-all.ts`, `apps/web/src/lib/art/load.ts`
- Test: `apps/web/src/lib/art/read-all.test.ts`
- Modify: `apps/web/src/app/collections/[id]/_lib/stage.tsx`, `apps/web/src/app/collections/[id]/layout.tsx:54`, `apps/web/src/app/collections/[id]/art/layout.tsx`
- Modify: `apps/web/src/app/collections/[id]/art/layers/page.tsx`, `rules/page.tsx`, `generate/page.tsx`
- Modify: `apps/web/src/components/art/finish-later.tsx`, `apps/web/src/components/shell/step-nav.tsx`
- Modify: `apps/web/src/components/art/layers-screen.tsx:138,240`, `apps/web/src/components/art/rules-screen.tsx:80,134,267`, `apps/web/src/components/art/generate-screen.tsx:103,304`

**Interfaces:**

- Consumes: `toProject`, `ArtRows` (Task 1); `ArtSyncProvider` and `useArtSync` (Task 4); `updateArtSettings` (Task 3); `THROWN` from `@/lib/art/result`; `countTraits`, `analyseRules`, `buildTraitIndex` from `@cobweb/dna`.
- Produces:
  - `read-all.ts` (pure): `PAGE_SIZE = 1000`; `readAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>, size?: number): Promise<T[]>`.
  - `load.ts` (server only): `loadArtProject(collection: Tables<'collections'>): Promise<ArtProject>` (one database read per request, shared by the layout and the page).
  - `stageContext`: `artDeferred` from `collections.art_deferred` and, for the Art stage, `readOnly` from `collections.art_locked_at` outside sample mode.
  - `FinishLaterAction({ collectionId, demo })`; `DeferredArtNotice({ collectionId, demo, deployed })`.

Decision: the `?art=deferred` parameter stays only as sample mode's scenario switch (the sample data, the rail and the stepper read it there); a real project neither writes nor reads it. "Finish the art later" saves `art_deferred` and shows in real mode too, and the `Seam:` comments and the "until Phase 3" notes go.

Decision: the Art layout loads the project once and seeds the browser store through `ArtSyncProvider`'s `initial` (for the settings slices no page passes as props); each page passes the same cached rows to its screen, so the server render and the first browser render agree.

- [ ] **Step 1: Write the failing test**

`apps/web/src/lib/art/read-all.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { readAll } from './read-all'

describe('readAll', () => {
  it('reads past the 1,000-row page limit, one range at a time', async () => {
    const rows = Array.from({ length: 2_500 }, (_, i) => i)
    const ranges: [number, number][] = []
    const all = await readAll(async (from, to) => {
      ranges.push([from, to])
      return { data: rows.slice(from, to + 1), error: null }
    })
    expect(all).toEqual(rows)
    expect(ranges).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ])
  })

  it('stops after an exact multiple with one empty page, and throws on an error', async () => {
    const rows = Array.from({ length: 1_000 }, (_, i) => i)
    let calls = 0
    const all = await readAll(async (from, to) => {
      calls++
      return { data: rows.slice(from, to + 1), error: null }
    })
    expect(all).toHaveLength(1_000)
    expect(calls).toBe(2)
    await expect(readAll(async () => ({ data: null, error: { message: 'boom' } }))).rejects.toThrow(
      'The art could not be loaded',
    )
  })
})
```

- [ ] **Step 2: Run, expect failure**

Run: `pnpm --filter @cobweb/web exec vitest run src/lib/art/read-all.test.ts`
Expected: FAIL, `Failed to resolve import "./read-all"`.

- [ ] **Step 3: Implement the readers**

`apps/web/src/lib/art/read-all.ts`:

```ts
/** The most rows PostgREST returns for one request (`max_rows` in supabase/config.toml). */
export const PAGE_SIZE = 1000

type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>

/**
 * Reads every row of a query a page at a time, so a project with more than 1,000 traits or tokens
 * loads whole. A truncated read would be worse than an error: the next save would write it back.
 */
export async function readAll<T>(
  page: (from: number, to: number) => Page<T>,
  size = PAGE_SIZE,
): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += size) {
    const { data, error } = await page(from, from + size - 1)
    if (error) throw new Error(`The art could not be loaded: ${error.message}`)
    rows.push(...(data ?? []))
    if (!data || data.length < size) return rows
  }
}
```

`apps/web/src/lib/art/load.ts`:

```ts
import 'server-only'
import { cache } from 'react'
import type { ArtProject } from '@/components/art/state/art-store'
import type { Tables } from '@/lib/database.types'
import { createClient } from '@/lib/supabase/server'
import { readAll } from './read-all'
import { toProject, type ArtRows } from './rows'

/** Every art row of a project, read under row-level security as the signed-in creator; once per request. */
const artRows = cache(async (collectionId: string): Promise<Omit<ArtRows, 'collection'>> => {
  const supabase = await createClient()
  const [artCollections, layers, traits, rules, atLeastOne, tokens] = await Promise.all([
    readAll((from, to) =>
      supabase
        .from('art_collections')
        .select('id, name, size, position')
        .eq('collection_id', collectionId)
        .order('position')
        .range(from, to),
    ),
    readAll((from, to) =>
      supabase
        .from('layers')
        .select('id, art_collection_id, name, display_name, position, bypass_dna')
        .eq('collection_id', collectionId)
        .order('id')
        .range(from, to),
    ),
    readAll((from, to) =>
      supabase
        .from('traits')
        .select('id, layer_id, name, weight, constant, blank, in_metadata, upload_id, position')
        .eq('collection_id', collectionId)
        .order('id')
        .range(from, to),
    ),
    readAll((from, to) =>
      supabase
        .from('rules')
        .select('id, kind, trait_id, related_trait_ids, bidirectional')
        .eq('collection_id', collectionId)
        .order('id')
        .range(from, to),
    ),
    readAll((from, to) =>
      supabase
        .from('at_least_one')
        .select('id, art_collection_id, trait_ids')
        .eq('collection_id', collectionId)
        .order('id')
        .range(from, to),
    ),
    readAll((from, to) =>
      supabase
        .from('tokens')
        .select('token_id, art_collection_id, dna, description')
        .eq('collection_id', collectionId)
        .order('token_id')
        .range(from, to),
    ),
  ])
  return { artCollections, layers, traits, rules, atLeastOne, tokens }
})

/** A generative project's art as the Art screens' store holds it. */
export async function loadArtProject(collection: Tables<'collections'>): Promise<ArtProject> {
  return toProject({ collection, ...(await artRows(collection.id)) })
}
```

- [ ] **Step 4: Run, expect pass**

Run: `pnpm --filter @cobweb/web exec vitest run src/lib/art/read-all.test.ts`
Expected: 2 tests pass.

- [ ] **Step 5: Stage context, layouts and pages**

`apps/web/src/app/collections/[id]/_lib/stage.tsx`: replace the doc comment paragraph about `artDeferred` and the body of `stageContext` with:

```tsx
/**
 * What a stage page needs to know about where it is, for an owned collection (the page has
 * already called `requireOwnedCollection`). `path` is the screen's path under the collection,
 * e.g. `art/rules`.
 *
 * `artDeferred` ("Finish the art later", MASTER_PLAN, Flow: pre-reveal) is the collection's
 * `art_deferred`; in sample mode it comes from the sample data, where `sample.art` (the page's
 * `?art=` param) picks the deferred scenario. The Art screens are read only once the art is locked
 * (`art_locked_at`), whatever the status says.
 */
export function stageContext(
  collection: Tables<'collections'>,
  stage: StageSlug,
  path: string,
  sample: { art?: string } = {},
) {
  const demo = isDemoMode()
  const artDeferred = demo ? sampleArtDeferred(sample.art) : collection.art_deferred
  const readOnly =
    !demo && stage === 'art'
      ? collection.art_locked_at !== null
      : isStageReadOnly(collection.status, stage, { demo, artDeferred })
  return {
    demo,
    artDeferred,
    access: stageAccess(collection.status, stage, { demo, artDeferred }),
    readOnly,
    /** "Stage 2 of 4" for a build stage; none for Manage drop, which is not a stage. */
    eyebrow: stageIndex(stage) === -1 ? undefined : `Stage ${stageIndex(stage) + 1} of ${STAGES.length}`,
    ...flowNeighbours(collection.id, collection.project_type, path),
  }
}
```

`apps/web/src/app/collections/[id]/layout.tsx:54`: `artDeferred={demo ? sampleArtDeferred(undefined) : false}` becomes `artDeferred={demo ? sampleArtDeferred(undefined) : collection.art_deferred}`.

`apps/web/src/app/collections/[id]/art/layout.tsx`: add `import { loadArtProject } from '@/lib/art/load'`; `const artDeferred = demo ? sampleArtDeferred(undefined) : false` becomes `const artDeferred = demo ? sampleArtDeferred(undefined) : collection.art_deferred`; and the `content` block from Task 4 becomes:

```tsx
// A real generative project seeds the browser store from its rows; sample mode seeds each screen
// from the sample data, and 1/1 and single asset projects keep their files on the Assets screen.
const initial =
  !demo && collection.project_type === 'generative' ? await loadArtProject(collection) : undefined
const content = (
  <ArtSyncProvider collectionId={collection.id} demo={demo} initial={initial}>
    {children}
  </ArtSyncProvider>
)
```

`apps/web/src/app/collections/[id]/art/layers/page.tsx`:

- Imports: add `import { countTraits } from '@cobweb/dna'` and `import { loadArtProject } from '@/lib/art/load'`.
- The doc comment becomes: "Art, step 1 (generative): layers and rarity. A new generative collection lands here, and with no layers it opens as the folder upload. A real collection shows its rows; sample-data mode shows the sample layers (`?layers=empty` shows the folder upload there; `?art=deferred` the deferred-art scenario)."
- After `const sample = ...` add `const project = ctx.demo ? null : await loadArtProject(collection)`, and the screen's three data props become:

```tsx
        collections={project ? (project.collections ?? []) : sample ? DEMO_COLLECTIONS : []}
        layers={project ? (project.layers ?? []) : sample ? DEMO_LAYERS : []}
        traitCounts={project ? countTraits(project.tokens ?? []) : sample ? DEMO_TRAIT_COUNTS : {}}
```

`apps/web/src/app/collections/[id]/art/rules/page.tsx`:

- Imports: add `import { analyseRules, buildTraitIndex } from '@cobweb/dna'` and `import { loadArtProject } from '@/lib/art/load'`.
- The doc comment becomes: "Art, step 2 (generative): trait-pairing rules. A real collection shows its rows; sample-data mode shows the sample rules, and `?art=deferred` the deferred-art scenario."
- After `const index = ...` add:

```tsx
const project = ctx.demo ? null : await loadArtProject(collection)
const layers = project ? (project.layers ?? []) : DEMO_LAYERS
const rules = project ? (project.rules ?? []) : DEMO_RULES
```

- The screen's data props become:

```tsx
        collections={project ? (project.collections ?? []) : DEMO_COLLECTIONS}
        layers={layers}
        rules={rules}
        conflicts={project ? analyseRules(layers, rules, buildTraitIndex(layers)) : DEMO_RULE_CONFLICTS}
```

`apps/web/src/app/collections/[id]/art/generate/page.tsx`:

- Imports: add `import { countTraits } from '@cobweb/dna'` and `import { loadArtProject } from '@/lib/art/load'`.
- The doc comment becomes: "Art, step 3 (generative): generate and curate the tokens. A real collection shows its rows and its saved set; sample-data mode shows the sample set, and `?art=deferred` the deferred-art scenario."
- After `const index = ...` add `const project = ctx.demo ? null : await loadArtProject(collection)`, and the screen's data props become:

```tsx
        collections={project ? (project.collections ?? []) : DEMO_COLLECTIONS}
        layers={project ? (project.layers ?? []) : DEMO_LAYERS}
        rules={project ? (project.rules ?? []) : DEMO_RULES}
        tokens={project ? (project.tokens ?? null) : DEMO_TOKENS}
        traitCounts={project ? countTraits(project.tokens ?? []) : DEMO_TRAIT_COUNTS}
```

- [ ] **Step 6: Finish later and the deferred notices**

`apps/web/src/components/art/finish-later.tsx`:

- Imports: add `import { updateArtSettings } from '@/app/actions/art/settings'` and `import { THROWN } from '@/lib/art/result'`.
- Replace the `FinishLaterAction` doc comment's "Seam: the deferred flag is ... a server action that sets it." paragraph with "Confirming saves `art_deferred` on the collection; sample mode keeps the scenario in the URL (`?art=deferred`)."
- Replace `FinishLaterAction` with:

```tsx
export function FinishLaterAction({ collectionId, demo }: { collectionId: string; demo: boolean }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const confirm = async () => {
    const upload = collectionHref(collectionId, 'upload')
    if (demo) {
      setOpen(false)
      router.push(`${upload}?art=deferred`)
      return
    }
    setSaving(true)
    setError(null)
    try {
      const result = await updateArtSettings(collectionId, { artDeferred: true })
      if (!result.ok) {
        setError(result.error)
        return
      }
      setOpen(false)
      router.push(upload)
      router.refresh()
    } catch {
      setError(THROWN)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <ClockIcon />
        Finish the art later
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Finish the art later?</DialogTitle>
            <DialogDescription>
              You can deploy before the art is finished. Collectors see a placeholder until you reveal.
            </DialogDescription>
          </DialogHeader>
          <ol className="space-y-4">
            {STEPS.map((step, index) => (
              <li key={step.title} className="flex gap-3">
                <span
                  aria-hidden="true"
                  className="border-border-strong numeric flex size-6 shrink-0 items-center justify-center rounded-full border text-xs"
                >
                  {index + 1}
                </span>
                <span className="min-w-0 space-y-0.5">
                  <span className="block text-sm font-medium">{step.title}</span>
                  <span className="text-muted-foreground block text-[0.8125rem] leading-snug">
                    {step.text}
                  </span>
                </span>
              </li>
            ))}
          </ol>
          {error && (
            <p role="alert" className="text-destructive-foreground text-sm">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Keep working
            </Button>
            <Button onClick={() => void confirm()} disabled={saving}>
              Finish later
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
```

- Replace `DeferredArtNotice` and its doc comment with:

```tsx
/**
 * At the top of an Art screen while the art is deferred and the contract is not deployed yet: what
 * is left to do, and where. Once deployed the Art layout's one-line `ArtLiveNotice` says it instead,
 * so this stays away (sample mode: `?state=deployed`).
 */
export function DeferredArtNotice({
  collectionId,
  demo,
  deployed,
}: {
  collectionId: string
  demo: boolean
  deployed: boolean
}) {
  const searchParams = useSearchParams()
  if (deployed || (demo && searchParams.get('state') === 'deployed')) return null
  const upload = collectionHref(collectionId, 'upload')
  return (
    <Alert>
      <ClockIcon aria-hidden="true" />
      <AlertTitle>You are finishing the art later</AlertTitle>
      <AlertDescription>
        <p>
          The contract starts on the placeholder, and the art stays open until you lock the real set. When the
          set is complete, continue from Generate to lock and upload it, then reveal it from Manage drop,
          Settings.
        </p>
        <Link
          href={demo ? `${upload}?art=deferred` : upload}
          className="text-foreground underline underline-offset-4"
        >
          View the placeholder upload
        </Link>
      </AlertDescription>
    </Alert>
  )
}
```

`apps/web/src/components/shell/step-nav.tsx`: replace the `// Seam: confirming only sets the sample scenario ...` comment and the `finishLater` constant with:

```tsx
// Shown while the Art stage is open for editing and the art is not deferred yet.
const finishLater =
  selectedStage === 'art' && !deferred && !isStageReadOnly(status, 'art', { demo, artDeferred: deferred })
```

and `<FinishLaterAction collectionId={collectionId} />` becomes `<FinishLaterAction collectionId={collectionId} demo={demo} />`.

The screens (each already has `const sync = useArtSync()` from Tasks 5 and 6). In each, the deferred-art notice becomes:

```tsx
{
  artDeferred && (
    <DeferredArtNotice
      collectionId={collection.id}
      demo={sync.demo}
      deployed={isDeployed(collection.status)}
    />
  )
}
```

and the `?art=deferred` link decorations apply in sample mode only:

- `apps/web/src/components/art/layers-screen.tsx`: line 18 becomes `import { flowNeighbours, isDeployed } from '@/lib/steps'`; line 138 becomes the notice above; line 240 becomes

```tsx
        next={artDeferred && sync.demo && next ? { ...next, href: `${next.href}?art=deferred` } : next}
```

- `apps/web/src/components/art/rules-screen.tsx`: line 20 becomes `import { artSubStepHref, flowNeighbours, isDeployed } from '@/lib/steps'`; line 134 becomes the notice above; line 80 becomes

```tsx
const deferredNext = artDeferred && sync.demo && next ? { ...next, href: `${next.href}?art=deferred` } : next
```

and line 267 becomes

```tsx
        previous={artDeferred && sync.demo && previous ? { ...previous, href: `${previous.href}?art=deferred` } : previous}
```

- `apps/web/src/components/art/generate-screen.tsx`: line 14 becomes `import { artSubStepHref, flowNeighbours, isDeployed } from '@/lib/steps'`; line 103 becomes the notice above; line 304 becomes the same `previous=` line as in the Rules screen.

- [ ] **Step 7: Root checks and a smoke run**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: clean.

Then, with `supabase start` running and `NEXT_PUBLIC_DEMO_DATA` unset in `apps/web/.env.local`, run `pnpm --filter @cobweb/web dev`, sign in, create a generative collection and open `/collections/<id>/art/rules` and `/art/generate`: both render empty (no sample rules or tokens). With `NEXT_PUBLIC_DEMO_DATA=1` the same pages show the sample data. Stop the dev server.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/lib/art "apps/web/src/app/collections/[id]" apps/web/src/components/art apps/web/src/components/shell/step-nav.tsx
git commit -F - <<'MSG'
Load the Art pages from the art tables and take read only and deferred art from the collection

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011bcHX4HZG5YGWhxjGuiWos
MSG
```

### Task 8: The Assets screen saves editions, attributes, order and token details

**Files:**

- Create: `apps/web/src/app/actions/art/assets.ts`, `apps/web/src/components/art/assets/saves.ts`
- Test: `apps/web/src/components/art/assets/saves.test.ts`; additions to `apps/web/src/lib/art/rows.test.ts` and `apps/web/src/lib/art/schemas.test.ts`
- Modify: `apps/web/src/lib/art/schemas.ts`, `apps/web/src/lib/art/rows.ts`, `apps/web/src/lib/art/load.ts`
- Modify: `apps/web/src/lib/demo/types.ts` (`UploadedAsset.addedAt`), `apps/web/src/components/art/assets/types.ts` (`AssetItem.addedAt`), `apps/web/src/components/art/assets/stored.test.ts:7-17`
- Modify: `apps/web/src/components/art/assets/use-assets.ts`, `apps/web/src/components/art/assets-screen.tsx`, `apps/web/src/components/art/assets/token-details.tsx`
- Modify: `apps/web/src/app/collections/[id]/art/upload-assets/page.tsx`

**Interfaces:**

- Consumes: `useArtSync()` (Task 4); `artWrite`, `one`, `ran` (Task 3); `updateArtSettings` (Task 3); `servedUrl`; `readAll` (Task 7); `seededRandom` from `apps/web/src/components/art/assets/token-list.ts`.
- Produces:
  - `schemas.ts`: `assetPatch`, `type AssetPatch = { quantity?: number; attributes?: { traitType: string; value: string }[] }`, `assetOrder`, `type AssetOrderRow = { uploadId: string; position: number }`.
  - `assets.ts` actions: `updateAsset(collectionId: string, uploadId: string, patch: AssetPatch): Promise<ActionResult>`; `setAssetOrder(collectionId: string, rows: AssetOrderRow[]): Promise<ActionResult>`.
  - `rows.ts`: `type AssetRow`; `toAssets(rows: AssetRow[]): UploadedAsset[]`.
  - `load.ts`: `loadAssets(collectionId: string): Promise<UploadedAsset[]>`.
  - `saves.ts` (pure): `orderRows(items: AssetItem[]): AssetOrderRow[]`; `needsDetails(item: Pick<AssetItem, 'quantity' | 'attributes'>): boolean`; `shuffledOrder<T>(items: T[], seed: number): T[]`; `addedOrder<T extends { addedAt: number }>(items: T[]): T[]`; `inAddedOrder(items: { addedAt: number }[]): boolean`.
  - `useAssetItems(collectionId, initial, announce, uploads, queueItems)`; `replace(file, keepQuantity?: number)`; new `reorder(order: (items: AssetItem[]) => AssetItem[]): void`.
  - `UploadedAsset.addedAt?: number`; `AssetItem.addedAt: number`.

Decision (spec section 9, creator-visible): "Shuffled" no longer shuffles ids across every edition; it reorders the files from the screen's seed and saves the order, so ids follow the saved list and a file's editions stay in a row. "In file order" puts the files back in the order they were added. The toggle shows "Shuffled" on load when the saved order is not the order the files were added in.

Decision: an asset save sends both the editions and the attributes of the item (the spec allows either), 250 ms after its last edit; a failed save puts back the values last saved.

Decision: the token name and description on this screen save to `collections.token_name` and `token_description`, 250 ms after the last keystroke, when the screen's own checks pass; a name the database refuses (quotes, for example) shows the sentence and goes back to the last saved name.

- [ ] **Step 1: Write the failing tests**

`apps/web/src/components/art/assets/saves.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { addedOrder, inAddedOrder, needsDetails, orderRows, shuffledOrder } from './saves'
import type { AssetItem } from './types'

const item = (key: string, addedAt: number, uploadId: string | null = `u-${key}`): AssetItem => ({
  key,
  fileName: `${key}.png`,
  url: `/api/uploads/u-${key}`,
  mediaType: 'image',
  quantity: 1,
  attributes: [],
  bytes: 10,
  owned: false,
  uploadId,
  addedAt,
})

describe('asset saves', () => {
  it('writes an edit made while the file was uploading once its row exists', () => {
    expect(needsDetails({ quantity: 1, attributes: [] })).toBe(false)
    expect(needsDetails({ quantity: 3, attributes: [] })).toBe(true)
    expect(needsDetails({ quantity: 1, attributes: [{ traitType: 'Name', value: 'Moon' }] })).toBe(true)
  })

  it('numbers stored items in list order and skips the ones still uploading', () => {
    expect(orderRows([item('a', 1), item('b', 2, null), item('c', 3)])).toEqual([
      { uploadId: 'u-a', position: 0 },
      { uploadId: 'u-c', position: 2 },
    ])
  })

  it('shuffles the same way for the same seed, and sorts back by when files were added', () => {
    const items = Array.from({ length: 8 }, (_, i) => item(`f${i}`, i))
    const once = shuffledOrder(items, 42)
    expect(shuffledOrder(items, 42)).toEqual(once)
    expect(once.map((x) => x.key).sort()).toEqual(items.map((x) => x.key).sort())
    expect(once.map((x) => x.key)).not.toEqual(items.map((x) => x.key))
    expect(inAddedOrder(once)).toBe(false)
    expect(addedOrder(once)).toEqual(items)
    expect(inAddedOrder(items)).toBe(true)
  })
})
```

Append to `apps/web/src/lib/art/rows.test.ts` (and add `toAssets` to its import from `./rows`):

```ts
describe('toAssets', () => {
  it('orders by saved position, then by when the file was added, and keeps only well formed attributes', () => {
    const assets = toAssets([
      {
        id: 'u-late',
        file_name: 'late.png',
        media_type: 'image',
        quantity: 1,
        attributes: [],
        position: null,
        created_at: '2026-10-08T10:00:03Z',
      },
      {
        id: 'u-second',
        file_name: 'second.png',
        media_type: 'image',
        quantity: 4,
        attributes: [{ traitType: 'Name', value: 'Second' }, { broken: true }],
        position: 1,
        created_at: '2026-10-08T10:00:01Z',
      },
      {
        id: 'u-first',
        file_name: 'first.gif',
        media_type: 'gif',
        quantity: 1,
        attributes: 'not a list',
        position: 0,
        created_at: '2026-10-08T10:00:02Z',
      },
    ])
    expect(assets.map((asset) => asset.uploadId)).toEqual(['u-first', 'u-second', 'u-late'])
    expect(assets[1]).toEqual({
      id: 2,
      fileName: 'second.png',
      imageUrl: '/api/uploads/u-second',
      uploadId: 'u-second',
      mediaType: 'image',
      quantity: 4,
      attributes: [{ traitType: 'Name', value: 'Second' }],
      addedAt: Date.parse('2026-10-08T10:00:01Z'),
    })
    expect(assets[0]!.attributes).toEqual([])
  })
})
```

Append to `apps/web/src/lib/art/schemas.test.ts` (and add `assetPatch` to its import from `./schemas`):

```ts
describe('the asset rules of spec section 6', () => {
  it('editions are 1 to 10,000; attributes need a trait type and a value of 1 to 64 characters', () => {
    expect(
      error(parse(assetPatch, { quantity: 1, attributes: [{ traitType: 'Name', value: 'Moon' }] })),
    ).toBeNull()
    expect(error(parse(assetPatch, { quantity: 0 }))).toBe('Editions are a whole number from 1 to 10,000.')
    expect(error(parse(assetPatch, { quantity: 10_001 }))).toBe(
      'Editions are a whole number from 1 to 10,000.',
    )
    const sentence = 'An attribute needs a trait type and a value of 1 to 64 characters each.'
    expect(error(parse(assetPatch, { attributes: [{ traitType: ' ', value: 'Moon' }] }))).toBe(sentence)
    expect(error(parse(assetPatch, { attributes: [{ traitType: 'Name', value: 'x'.repeat(65) }] }))).toBe(
      sentence,
    )
  })
})
```

- [ ] **Step 2: Run, expect failure**

Run: `pnpm --filter @cobweb/web exec vitest run src/components/art/assets/saves.test.ts src/lib/art/rows.test.ts src/lib/art/schemas.test.ts`
Expected: FAIL, `Failed to resolve import "./saves"`, `toAssets is not a function` and `Cannot read properties of undefined (reading 'safeParse')` for `assetPatch`.

- [ ] **Step 3: Implement the pure pieces and the actions**

`apps/web/src/lib/demo/types.ts`, in `UploadedAsset` after `attributes`:

```ts
  /** When the file was added (ms since 1970), which "In file order" sorts by. Sample data counts by id. */
  addedAt?: number
```

`apps/web/src/components/art/assets/types.ts`, in `AssetItem` after `uploadId`:

```ts
/** When the file was added (ms since 1970), which "In file order" sorts by. */
addedAt: number
```

`apps/web/src/components/art/assets/stored.test.ts`: in the `item` helper, after `uploadId,` add `addedAt: 0,`.

`apps/web/src/lib/art/schemas.ts`, append:

```ts
const EDITIONS = 'Editions are a whole number from 1 to 10,000.'
const ATTRIBUTE = 'An attribute needs a trait type and a value of 1 to 64 characters each.'
const attributeText = z.string().trim().min(1, ATTRIBUTE).max(64, ATTRIBUTE)

export const assetPatch = z
  .object({
    quantity: z.number().int(EDITIONS).min(1, EDITIONS).max(10_000, EDITIONS).optional(),
    attributes: z
      .array(z.object({ traitType: attributeText, value: attributeText }))
      .max(40, 'At most 40 attributes.')
      .optional(),
  })
  .strict()
export type AssetPatch = z.input<typeof assetPatch>

export const assetOrder = z
  .array(z.object({ uploadId: uuid, position: z.number().int(UNSAVED).min(0, UNSAVED) }))
  .max(100_000, UNSAVED)
export type AssetOrderRow = z.infer<typeof assetOrder>[number]
```

`apps/web/src/lib/art/rows.ts`: change `import type { Enums, Tables } from '@/lib/database.types'` to `import type { Enums, Json, Tables } from '@/lib/database.types'`, change `import type { ArtRule, AtLeastOne, Layer, RuleKind, Trait } from '@/lib/demo'` to `import type { ArtRule, AtLeastOne, Layer, RuleKind, Trait, UploadedAsset } from '@/lib/demo'`, and append:

```ts
export type AssetRow = Pick<
  Tables<'uploads'>,
  'id' | 'file_name' | 'media_type' | 'quantity' | 'attributes' | 'position' | 'created_at'
>

/** The `[{ traitType, value }]` the Assets screen saved; anything else in the column is left out. */
function attributesOf(value: Json): { traitType: string; value: string }[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) =>
    entry !== null &&
    typeof entry === 'object' &&
    !Array.isArray(entry) &&
    typeof entry.traitType === 'string' &&
    typeof entry.value === 'string'
      ? [{ traitType: entry.traitType, value: entry.value }]
      : [],
  )
}

/** A 1/1 or single asset project's files, in their saved order (spec section 9). */
export function toAssets(rows: AssetRow[]): UploadedAsset[] {
  const unplaced = Number.MAX_SAFE_INTEGER
  return [...rows]
    .sort(
      (a, b) =>
        (a.position ?? unplaced) - (b.position ?? unplaced) ||
        Date.parse(a.created_at) - Date.parse(b.created_at),
    )
    .map((row, index) => ({
      id: index + 1,
      fileName: row.file_name,
      imageUrl: servedUrl(row.id),
      uploadId: row.id,
      mediaType: row.media_type,
      quantity: row.quantity,
      attributes: attributesOf(row.attributes),
      addedAt: Date.parse(row.created_at),
    }))
}
```

`apps/web/src/lib/art/load.ts`: change `import type { ArtProject } ...` block to add `import type { UploadedAsset } from '@/lib/demo'`, change `import { toProject, type ArtRows } from './rows'` to `import { toAssets, toProject, type ArtRows } from './rows'`, and append:

```ts
/** A 1/1 or single asset project's files, in their saved order. */
export async function loadAssets(collectionId: string): Promise<UploadedAsset[]> {
  const supabase = await createClient()
  const rows = await readAll((from, to) =>
    supabase
      .from('uploads')
      .select('id, file_name, media_type, quantity, attributes, position, created_at')
      .eq('collection_id', collectionId)
      .eq('kind', 'asset')
      .order('created_at')
      .range(from, to),
  )
  return toAssets(rows)
}
```

`apps/web/src/components/art/assets/saves.ts`:

```ts
import { seededRandom } from './token-list'
import type { AssetItem } from './types'

/**
 * How the Assets screen's list becomes saved rows (spec section 9): positions in list order, and
 * the edits a new `uploads` row is still missing. Pure, so the tests run without a screen.
 */
export function orderRows(items: AssetItem[]): { uploadId: string; position: number }[] {
  return items.flatMap((item, position) => (item.uploadId ? [{ uploadId: item.uploadId, position }] : []))
}

/** Whether an item carries edits its new row lacks: a new row has 1 edition and no attributes. */
export function needsDetails(item: Pick<AssetItem, 'quantity' | 'attributes'>): boolean {
  return item.quantity !== 1 || item.attributes.length > 0
}

/** The list in a shuffled order, the same for the same seed (Fisher-Yates, as legacy's shuffle). */
export function shuffledOrder<T>(items: T[], seed: number): T[] {
  const next = [...items]
  const random = seededRandom(seed)
  for (let at = next.length - 1; at > 0; at--) {
    const swap = Math.floor(random() * (at + 1))
    ;[next[at], next[swap]] = [next[swap]!, next[at]!]
  }
  return next
}

/** The list in the order the files were added ("In file order"). */
export function addedOrder<T extends { addedAt: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.addedAt - b.addedAt)
}

export function inAddedOrder(items: { addedAt: number }[]): boolean {
  return items.every((item, i) => i === 0 || items[i - 1]!.addedAt <= item.addedAt)
}
```

`apps/web/src/app/actions/art/assets.ts`:

```ts
'use server'

import { z } from 'zod'
import type { TablesUpdate } from '@/lib/database.types'
import { done, type ActionResult } from '@/lib/art/result'
import { assetOrder, assetPatch, parse, uuid, type AssetOrderRow, type AssetPatch } from '@/lib/art/schemas'
import { artWrite, one, ran } from '@/lib/art/write'

/** One file's editions and attributes. */
export async function updateAsset(
  collectionId: string,
  uploadId: string,
  patch: AssetPatch,
): Promise<ActionResult> {
  const input = parse(z.object({ uploadId: uuid, patch: assetPatch }), { uploadId, patch })
  if (!input.ok) return input
  const change: TablesUpdate<'uploads'> = {}
  if (input.data.patch.quantity !== undefined) change.quantity = input.data.patch.quantity
  if (input.data.patch.attributes !== undefined) change.attributes = input.data.patch.attributes
  if (Object.keys(change).length === 0) return done
  return artWrite(collectionId, ({ supabase }) =>
    one(
      supabase
        .from('uploads')
        .update(change)
        .eq('id', input.data.uploadId)
        .eq('collection_id', collectionId)
        .eq('kind', 'asset')
        .select('id'),
    ),
  )
}

/** The files' list order, which the token ids follow (`art_set_asset_order`). */
export async function setAssetOrder(collectionId: string, rows: AssetOrderRow[]): Promise<ActionResult> {
  const input = parse(assetOrder, rows)
  if (!input.ok) return input
  if (input.data.length === 0) return done
  return artWrite(collectionId, ({ supabase }) =>
    ran(supabase.rpc('art_set_asset_order', { p_collection_id: collectionId, p_rows: input.data })),
  )
}
```

- [ ] **Step 4: Run, expect pass**

Run: `pnpm --filter @cobweb/web exec vitest run src/components/art/assets src/lib/art`
Expected: every test passes, the new ones included.

- [ ] **Step 5: The hook, the screen and the page**

`apps/web/src/components/art/assets/use-assets.ts`:

- Imports: add

```ts
import { setAssetOrder, updateAsset } from '@/app/actions/art/assets'
import { useArtSync } from '../state/art-sync'
import { needsDetails, orderRows } from './saves'
```

- `fromSample` gains `addedAt: asset.addedAt ?? asset.id,`; `fromChecked` and `fromMedia` gain `addedAt: Date.now(),` (each after `uploadId`).
- The doc comment's last paragraph becomes: "Finished uploads are adopted from `queueItems`: the item switches to its served URL and upload id, and removing it deletes the row and the object. Editions, attributes and the list order are saved as they change, 250 ms after the last edit of an item; an edit made while a file uploads is saved once its row exists."
- The signature becomes:

```ts
export function useAssetItems(
  collectionId: string,
  initial: UploadedAsset[],
  announce: (text: string) => void,
  uploads: AssetUploads,
  queueItems: readonly QueueItem[],
) {
```

- After `const latest = useRef(items)` add:

```ts
const sync = useArtSync()
/** The values each stored row holds, for a rollback when a save fails. */
const saved = useRef(
  new Map<string, { quantity: number; attributes: Attribute[] }>(
    initial.flatMap((asset) =>
      asset.uploadId
        ? [[asset.uploadId, { quantity: asset.quantity, attributes: asset.attributes }] as const]
        : [],
    ),
  ),
)
/** Upload ids already in the list, so a newly stored file can be told apart. */
const known = useRef(new Set(initial.flatMap((asset) => (asset.uploadId ? [asset.uploadId] : []))))

/** Saves one item's editions and attributes 250 ms after its last edit; a file still uploading waits. */
const saveDetails = useCallback(
  (key: string) =>
    sync.debounce.schedule(`asset:${key}`, () => {
      const item = latest.current.find((candidate) => candidate.key === key)
      if (!item?.uploadId) return
      const uploadId = item.uploadId
      const patch = { quantity: item.quantity, attributes: item.attributes }
      void sync
        .run({ apply: (p) => p, persist: () => updateAsset(collectionId, uploadId, patch) })
        .then((ok) => {
          if (ok) {
            saved.current.set(uploadId, patch)
            return
          }
          const back = saved.current.get(uploadId)
          if (back)
            setItems((current) =>
              current.map((other) => (other.uploadId === uploadId ? { ...other, ...back } : other)),
            )
        })
    }),
  [collectionId, sync],
)

/** Saves the list order 250 ms after the last change to it. */
const saveOrder = useCallback(
  () =>
    sync.debounce.schedule('asset-order', () => {
      const rows = orderRows(latest.current)
      if (rows.length) void sync.run({ apply: (p) => p, persist: () => setAssetOrder(collectionId, rows) })
    }),
  [collectionId, sync],
)

// A file that has just been stored: its place in the list, and any edit made while it uploaded.
useEffect(() => {
  const fresh = items.filter((item) => item.uploadId && !known.current.has(item.uploadId))
  if (fresh.length === 0) return
  for (const item of fresh) {
    known.current.add(item.uploadId!)
    saved.current.set(item.uploadId!, { quantity: 1, attributes: [] })
    if (needsDetails(item)) saveDetails(item.key)
  }
  saveOrder()
}, [items, saveDetails, saveOrder])
```

- `replace` becomes `async (file: File | undefined, keepQuantity?: number) => {`, and its `setItems` call becomes:

```ts
setItems((current) => {
  revoke(current)
  // The single asset keeps its quantity when the file is replaced.
  return [{ ...fromMedia(checked, attributes), quantity: keepQuantity ?? 1 }]
})
```

- `update` becomes:

```ts
const update = useCallback(
  (keys: string[], change: (item: AssetItem) => AssetItem) => {
    const target = new Set(keys)
    setItems((current) => current.map((item) => (target.has(item.key) ? change(item) : item)))
    for (const key of keys) saveDetails(key)
  },
  [saveDetails],
)
```

- After `update` add:

```ts
/** Puts the list in a new order and saves it (the token ids follow the saved order). */
const reorder = useCallback(
  (order: (items: AssetItem[]) => AssetItem[]) => {
    setItems((current) => order(current))
    saveOrder()
  },
  [saveOrder],
)
```

- Add `reorder,` to the returned object after `removeMany,`.

`apps/web/src/components/art/assets/token-details.tsx`:

- The doc comment's "Seam: saved with the token list at lock (Phase 3); until then it lives in the screen." becomes "The name and description are saved on the collection as they change. "Shuffled" reorders the files from the seed and saves that order, so the ids always follow the saved list."
- The shuffled description becomes `'Ids follow a shuffled file order, so collectors cannot tell which file is which id. Editions of a file stay in a row.'`.

`apps/web/src/components/art/assets-screen.tsx`:

- Imports: change `import { useMemo, useState } from 'react'` to `import { useMemo, useRef, useState } from 'react'`; add

```ts
import { updateArtSettings } from '@/app/actions/art/settings'
import { addedOrder, inAddedOrder, shuffledOrder } from './assets/saves'
import { useArtSync } from './state/art-sync'
```

and change the `token-list` import to `import { TOKEN_DESCRIPTION_MAX, TOKEN_NAME_MAX, tokenDescriptionError, tokenNameError, type TokenDetails } from './assets/token-list'`; change the `use-assets` import to `import { fromSample, useAnnouncer, useAssetItems, type AssetUploads } from './assets/use-assets'`.

- The doc comment's "Seam: `details` and the items are submitted as the token list at lock (Phase 3)." becomes "Editions, attributes, the list order and the token name and description are saved as they change; lock (the next sub-project) builds the token list from the stored rows."
- The props destructuring becomes `{ collection, assets, readOnly: readOnlyProp }`, and the body up to `if (type === 'generative')` becomes:

```tsx
const type = collection.project_type
const sync = useArtSync()
const readOnly = readOnlyProp || sync.locked
const { message, announce } = useAnnouncer()
const uploader = useMemo(
  () => createUploader({ collectionId: collection.id, kind: 'asset' }),
  [collection.id],
)
const { queue, items: uploads } = useUploadQueue(3, uploader)
const sink = useMemo<AssetUploads>(
  () => ({
    add: (entries) => queue.add(entries),
    remove: (id) => queue.remove(id),
    deleteStored: deleteUpload,
  }),
  [queue],
)
const files = useAssetItems(collection.id, assets, announce, sink, uploads)
const [singleQuantity, setSingleQuantity] = useState(() =>
  assets[0]?.uploadId ? assets[0].quantity : (collection.max_supply ?? assets[0]?.quantity ?? 1),
)
// Nothing saved yet: the collection's own name and description.
const untouched = collection.token_name === null && collection.token_description === ''
const [details, setDetails] = useState<TokenDetails>(() => ({
  name: (collection.token_name ?? collection.name).slice(0, TOKEN_NAME_MAX),
  description: (untouched ? collection.description : collection.token_description).slice(
    0,
    TOKEN_DESCRIPTION_MAX,
  ),
  order: inAddedOrder(assets.map(fromSample)) ? 'upload' : 'shuffled',
  seed: 0,
}))
const savedText = useRef({ tokenName: details.name, tokenDescription: details.description })
// Ids follow the saved list, which "Shuffled" has already reordered.
const idDetails = useMemo<TokenDetails>(() => ({ ...details, order: 'upload' }), [details])

/** Saves the token name or description 250 ms after the last keystroke; a refusal puts back the saved text. */
const saveText = (field: 'tokenName' | 'tokenDescription', value: string) =>
  sync.debounce.schedule(`asset-${field}`, () => {
    const patch = field === 'tokenName' ? { tokenName: value } : { tokenDescription: value }
    void sync.run({ apply: (p) => p, persist: () => updateArtSettings(collection.id, patch) }).then((ok) => {
      if (ok) {
        savedText.current[field] = value
        return
      }
      const back = savedText.current[field]
      setDetails((current) =>
        field === 'tokenName' ? { ...current, name: back } : { ...current, description: back },
      )
    })
  })

const changeDetails = (next: TokenDetails) => {
  if (next.order === 'shuffled' && (details.order !== 'shuffled' || next.seed !== details.seed))
    files.reorder((items) => shuffledOrder(items, next.seed))
  else if (next.order === 'upload' && details.order !== 'upload') files.reorder(addedOrder)
  setDetails(next)
  if (next.name !== details.name && !tokenNameError(next.name)) saveText('tokenName', next.name.trim())
  if (next.description !== details.description && !tokenDescriptionError(next.description))
    saveText('tokenDescription', next.description)
}
```

- `<TokenDetailsPanel details={details} onChange={setDetails} ... />` becomes `onChange={changeDetails}`.
- `<OneOfOneView ... details={details} ...>` becomes `details={idDetails}`.
- In `SingleAssetView`, `onReplace={files.replace}` becomes `onReplace={(file) => void files.replace(file, singleQuantity)}`, and `onQuantity={setSingleQuantity}` becomes:

```tsx
          onQuantity={(quantity) => {
            setSingleQuantity(quantity)
            if (single) files.setQuantity(single.key, quantity)
          }}
```

`apps/web/src/app/collections/[id]/art/upload-assets/page.tsx`: add `import { loadAssets } from '@/lib/art/load'`; the doc comment's "Sample assets in sample-data mode; a real collection starts empty." becomes "A real collection shows its stored files; sample-data mode shows the sample assets."; and `assets={ctx.demo ? DEMO_ASSETS : []}` becomes `assets={ctx.demo ? DEMO_ASSETS : await loadAssets(collection.id)}`.

- [ ] **Step 6: Root checks**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app/actions/art/assets.ts apps/web/src/lib apps/web/src/components/art "apps/web/src/app/collections/[id]/art/upload-assets/page.tsx"
git commit -F - <<'MSG'
Save the Assets screen's editions, attributes, order and token details as they change

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011bcHX4HZG5YGWhxjGuiWos
MSG
```

### Task 9: Browser walk and documentation

**Files:**

- Modify: `docs/MASTER_PLAN.md:178`, `docs/specs/2026-10-03-creator-flow-ui.md:297-299`, `docs/specs/2026-10-08-art-wiring.md` (section 13 ticks)

**Interfaces:**

- Consumes: everything above, running against local Supabase.
- Produces: the recorded outcome of the walk and the documents that name this sub-project as landed.

- [ ] **Step 1: Full checks**

Run:

```bash
supabase db reset 2>&1 | tail -3
supabase seed buckets
pnpm typecheck && pnpm lint && pnpm test
pnpm --filter @cobweb/web verify:local 2>&1 | grep -E '^(FAIL|INFO|[0-9]+ passed)'
pnpm --filter @cobweb/web verify:storage 2>&1 | tail -3
```

Expected: root checks clean; `verify:local` ends `0 failed` with the 9f timing line under 5,000 ms; `verify:storage` ends `0 failed`.

- [ ] **Step 2: Browser walk (run by the controller with the browser, not by the implementer)**

With `supabase start`, `NEXT_PUBLIC_DEMO_DATA` unset in `apps/web/.env.local`, the local `ART_S3_*` values filled in and `pnpm --filter @cobweb/web dev` running, sign in and create a generative collection. On its Layers screen:

1. Drop a folder of two layers (for example `Background/` with two square PNGs and `Eyes/` with three), upload, press "Set up layers". The layers appear with even weights; the trait grids load `/api/uploads/<id>?variant=thumb`.
2. Rename a layer; set two weights in one layer (watch the network tab: one `setLayerWeights` call about 250 ms after the last change).
3. On Rules, add a rule. On Generate, set the size to 20 and generate: the Tokens figure shows "Generated from seed <n>". Re-roll one token, delete two.
4. Reload the page: the layers, the renamed layer, the weights, the rule, the 18 tokens (ids 1 to 18) and the seed are the same as before the reload.
5. Back on Layers, drag a layer to a new place: the dialog asks to clear the tokens ("Clear tokens and move"); confirm, and the move stays after a reload with no tokens.
6. Delete a layer (with tokens generated again first): the dialog says the tokens will be cleared; after confirming and reloading, the layer and the tokens are gone and the rule that used its traits is trimmed or gone.
7. Open the collection menu and choose "Start over": the dialog names what goes; after confirming, Layers shows the folder upload, and `select count(*) from uploads where collection_id = '<id>' and kind = 'layer_image'` is 0.
8. Turn on `NEXT_PUBLIC_DEMO_DATA=1`, restart, and open every Art screen of the same collection: sample data shows, and no request to an Art action is made while editing.
9. On a 1/1 collection (sample mode off again), add two files, set one file's editions to 3 and add an attribute to the other, choose "Shuffled", wait a second and reload: editions, attributes and order are as they were, and the toggle shows "Shuffled".
10. As the service role, set `art_locked_at` on the generative collection (`update collections set art_locked_at = now() where id = '<id>'` in Studio), then try an edit in a tab that was already open: the toast says "The art is locked and cannot change." and every control turns read only; a reload shows the read-only notice.

Record the outcome of each numbered check in the plan ledger. Anything that fails is a finding for a fix dispatch, not a reason to edit these steps.

- [ ] **Step 3: Documentation**

`docs/MASTER_PLAN.md` line 178 becomes:

```
**Status:** in progress. The DNA engine (first sub-project) landed on 7 October 2026; see its spec. The art tables (second sub-project) landed on 8 October 2026; see [specs/2026-10-08-art-tables.md](specs/2026-10-08-art-tables.md). Layer and asset upload (third sub-project) landed on 8 October 2026; see [specs/2026-10-08-art-upload.md](specs/2026-10-08-art-upload.md). Wiring the Art screens to the art tables (fourth sub-project) landed on <today's date in words>; see [specs/2026-10-08-art-wiring.md](specs/2026-10-08-art-wiring.md). Owed to the lock and pay sub-project: a sweep of objects that were uploaded but never recorded (older than a day), since the project cap counts recorded rows only. Next: lock and pay.
```

`docs/specs/2026-10-03-creator-flow-ui.md` lines 297 to 299 become:

```
Seams: every place a real backend plugs in is marked with a `Seam:` or `SEAM:` comment
(`components/upload/upload-sim.ts`, `components/deploy/deploy-sim.ts`, `components/manage/simulate.ts`,
`components/mint/mint-transaction.ts`, `app/[slug]/sample-data.ts`). The Art screens read and write the
art tables since the wiring sub-project (specs/2026-10-08-art-wiring.md); sample-data mode still runs
them on `lib/demo`.
```

`docs/specs/2026-10-08-art-wiring.md`, section 13: tick each criterion the checks and the walk proved, adding the 9f timing in words on the `verify:local` line, for example "(9f: 10,000 saved and 3 deleted in 1,900 ms locally, <date>)". Leave a box unticked if its check failed and say why in the ledger.

Run `pnpm exec prettier --write docs/MASTER_PLAN.md docs/specs/2026-10-03-creator-flow-ui.md docs/specs/2026-10-08-art-wiring.md`.

- [ ] **Step 4: Commit**

```bash
git add docs
git commit -F - <<'MSG'
Record the Art wiring sub-project as landed and point to lock and pay

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011bcHX4HZG5YGWhxjGuiWos
MSG
```
