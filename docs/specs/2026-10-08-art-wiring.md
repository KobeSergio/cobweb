# Wiring the Art screens to the art tables: specification

Companion plan: [../plans/2026-10-08-art-wiring.md](../plans/2026-10-08-art-wiring.md).
Product decisions: [../MASTER_PLAN.md](../MASTER_PLAN.md#decisions). Rows and their checks:
[2026-10-08-art-tables.md](2026-10-08-art-tables.md). Files and the `uploads` rows:
[2026-10-08-art-upload.md](2026-10-08-art-upload.md). Screens:
[2026-10-03-creator-flow-ui.md](2026-10-03-creator-flow-ui.md) section 4.3.

## 1. Goal

Make the Art screens real. Layers, traits, rules, art collections, tokens and the token settings
that today live only in the browser store are loaded from the art tables and written back as the
creator edits, so nothing is lost on reload and the lock step (the next sub-project) finds the
finished set in the database. The 1/1 and single-asset screen saves editions, attributes and
order the same way.

Fourth of Phase 3's five sub-projects. The lock action, the quote, payment and render writes stay
with the fifth.

## 2. Decisions taken in the design conversation

- **Save as you go.** Every edit calls a server action at once; the screen updates first and rolls
  back with a sentence if the write fails. No Save button, no autosave timer.
- **Tokens are written at Generate and kept current.** Generate saves the whole set and its seed;
  every curation edit writes too; lock later only validates and hashes.
- **Sample mode stays**, behind the same hooks: with `NEXT_PUBLIC_DEMO_DATA=1` the store is seeded
  from sample data and persists nothing; otherwise it is seeded from rows and every edit persists.
- **"At least one" gets plumbing only**: actions, loading and engine wiring, no new screen.
- **The Assets screen saves as it goes** into the `uploads` columns and the collection's token
  settings.
- **Approach A**: the store and the pure edit logic stay; a sync layer mirrors each edit to a named
  server action; edits that must be atomic are database functions.

## 3. Scope

### In scope

- Loading the art rows in the Art pages and seeding the store with them (section 4).
- The sync layer: `ArtSyncProvider`, `run(edit)`, ordering, rollback, sample mode (section 5).
- Server actions under `apps/web/src/app/actions/art/` for every edit the hooks perform
  (section 6), and the shared `ownedUnlocked` helper moved to `apps/web/src/lib/art/owned.ts`.
- One migration of database functions for the edits that span statements (section 7).
- Token operations against the `tokens` table (section 8).
- The Assets screen's editions, attributes, order and token details (section 9).
- `readOnly` from `art_locked_at`; the deferred flag from `art_deferred`, written by the "finish
  later" screen; the `?art=deferred` seam goes (section 10).
- The folder upload hands its result to the database through one import action, and the layer
  grids read `thumbnailUrl` (section 11).
- A "start over" action that empties a project's art (section 7).
- Tests: unit, a new `verify:local` section, and a browser walk (section 12).

### Out of scope

- The lock action, the fee quote, payment, render jobs and batches, the token list hash.
- A screen for "at least one" groups.
- Metadata-type projects (no art).
- Resumable uploads, image processing, or any change to the upload actions beyond what section 11
  names.
- Realtime sync between two open tabs (the second tab sees the first's edits on reload; a write
  that conflicts fails with the database's sentence and the screen rolls back).

## 4. Loading

Each Art page is a server component that already calls `requireOwnedCollection`. It now also
reads, under RLS with the request's session client:

| Rows                                                                                                                                      | Store slice                                                                           |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `art_collections` ordered by `position`                                                                                                   | `collections` (`id`, `name`, `size`)                                                  |
| `layers` ordered by `position`, with their `traits` ordered by `position`, joined to `uploads` for the image                              | `layers` (one `Layer` per row, `traits` inside)                                       |
| `rules`                                                                                                                                   | `rules`                                                                               |
| `at_least_one`                                                                                                                            | `atLeastOne` (new optional slice)                                                     |
| `tokens` ordered by `token_id`                                                                                                            | `tokens` (`null` when none, never undefined on a loaded page)                         |
| `collections.token_name, token_description, show_blank_traits, generation_seed, canvas_width, canvas_height, art_deferred, art_locked_at` | `tokenName`, `tokenDescription`, `showBlankTraits`, `seed`, `canvas`, plus page props |

Mapping rules, in one pure module `apps/web/src/lib/art/rows.ts` (`toProject(rows)` and the
inverse pieces the actions need):

- Ids are the database uuids. The sample data keeps its slug ids; nothing in the screens depends
  on the id shape.
- A trait's `imageUrl` is `/api/uploads/<upload_id>` and a new optional `thumbnailUrl` is
  `/api/uploads/<upload_id>?variant=thumb`; a blank trait has neither. `traits.in_metadata = false`
  maps to `metadata: false`; `upload_id` maps to `uploadId`.
- Rule kinds map `doesnt_mix_with`, `always_pairs_with`, `must_pair_with` to the three sentences
  the screens use, and back.
- A token's `name` is `<tokenName> #<id>` as today; `rank` is computed by the engine on load, never
  stored; `previewUrl` stays null until Phase 4.
- `activeCollectionId` and `staleNote` are browser-only: the first art collection is active on
  load; `staleNote` starts null.

Rules and Generate pages gain the `isDemoMode()` switch Layers already has: sample data only in
demo mode, otherwise the rows above (an empty project is empty, not sample).

## 5. The sync layer

`apps/web/src/components/art/state/art-sync.tsx` exports `ArtSyncProvider` (wrapping the Art
layout's client tree) and `useArtSync()`.

- `run(edit)` takes `{ apply: (project) => project, persist: () => Promise<Result>, undo?: (project) => project }`.
  It snapshots the project, applies `apply` to the store, then awaits `persist`. On
  `{ ok: false, error }` it restores the snapshot (or applies `undo` when given, for edits whose
  snapshot would be stale) and shows `error` in the existing notice region. On a thrown error it
  does the same with "That change could not be saved. Try again."
- Writes for one collection run through a single promise chain, in the order the creator made them.
  A later edit that depends on a server-made id (a new layer, trait, rule or art collection) waits
  for the create to return the id; creates therefore apply to the store only when the action
  returns, with the row's real id.
- `readOnly` edits never reach `run`; the screens already disable their controls.
- When an action answers with "The art is locked and cannot change.", the provider marks the
  project read only and shows the sentence; the next navigation reloads the page state.
- In sample mode (`persist` absent, decided by the provider's `demo` prop) `run` applies `apply`
  and returns at once. The existing hooks therefore keep one code path: each method builds the pure
  edit and the matching action call; the provider decides whether the action runs.

The result type every action returns is `type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string }`.

## 6. Server actions

All under `apps/web/src/app/actions/art/`. Every action: `getVerifiedUser`; `ownedUnlocked(collectionId)`
(ownership read under RLS, refusal with "The art is locked and cannot change." when
`art_locked_at` is set, also returning the collection's canvas and settings); zod input; a
database write; SQLSTATE mapping: 42501 whose message is "collection not found" to "This
collection could not be found.", other 42501 to the locked sentence, 23514 and 23505 to the
database's own sentence when it is one of the guard sentences (section 7 lists them) and otherwise
to "That change could not be saved. Reload the page and try again."

| File                 | Actions                                                                                                                                                                                                                                |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `art-collections.ts` | `addArtCollection(name)`, `renameArtCollection(id, name)`, `setArtCollectionSize(id, size)`, `deleteArtCollection(id)` (function)                                                                                                      |
| `layers.ts`          | `addLayer(artCollectionId, name)`, `renameLayer(id, name, displayName)`, `moveLayer(id, position)`, `deleteLayer(id, clearTokens)` (function), `importLayers(payload)` (function)                                                      |
| `traits.ts`          | `addTraits(layerId, [{ name, uploadId }])`, `renameTrait(id, name)`, `setLayerWeights(layerId, [{ traitId, weight, constant }])` (function), `setBlank(layerId, on)`, `setTraitMetadata(id, inMetadata)`, `deleteTrait(id)` (function) |
| `rules.ts`           | `addRule(kind, traitId, relatedTraitIds)`, `updateRule(id, kind, traitId, relatedTraitIds)`, `deleteRule(id)`                                                                                                                          |
| `at-least-one.ts`    | `addAtLeastOne(artCollectionId, traitIds)`, `updateAtLeastOne(id, traitIds)`, `deleteAtLeastOne(id)`                                                                                                                                   |
| `tokens.ts`          | `saveTokens(tokens, seed)` (function), `updateTokens([{ tokenId, dna?, description? }])`, `swapTokens(a, b)` (existing function), `deleteTokens(ids)` (function), `appendTokens(tokens)`, `clearTokens()`                              |
| `settings.ts`        | `updateArtSettings({ tokenName?, tokenDescription?, showBlankTraits?, artDeferred? })`                                                                                                                                                 |
| `assets.ts`          | `updateAsset(uploadId, { quantity?, attributes? })`, `setAssetOrder([{ uploadId, position }])`                                                                                                                                         |
| `project.ts`         | `startOver()` (function, then deletes the layer-image objects best effort)                                                                                                                                                             |

Rules the actions enforce before the database does, so the creator reads a sentence and not a
constraint name: a weight is 0 to 100 with two decimals; a constant is 1 to 10,000 and forces the
weight to 0; names are 1 to 48 characters (traits 1 to 64); a rule's related traits are at least
one; an "at least one" group has at least two traits; `tokenName` follows `tokenNameProblem`;
`tokenDescription` is at most 500 characters; an asset's quantity is 1 to 10,000 and its
attributes are `[{ traitType, value }]` with each string 1 to 64 characters.

Weights: the Layers screen debounces slider and input changes per layer (250 ms) and sends the
layer's full weight table in one `setLayerWeights` call, so the "adds up to 100" rule is checked
on the table the creator sees, not on one trait at a time.

## 7. Database functions

One migration, `supabase/migrations/20261009010000_art_edit_functions.sql`. Every function is
`security invoker`, `set search_path = ''`, granted to `authenticated` only, and runs under the
existing RLS and lock trigger (so the lock sentence and ownership still come from the tables). Each
takes the collection id first and locks that `collections` row `for share` where it filters on
`owner_id = auth.uid()`, so a row the caller does not own is never locked and reads as
"collection not found" (42501).

| Function                                                 | What it does in one transaction                                                                                                                                                                                                                                                                 |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `art_import_layers(collection, payload jsonb)`           | Inserts art collections, layers and traits from the folder upload's structure (names, positions, even weights, `upload_id` per trait); refuses when the project already has layers for the target art collection. Returns the new ids in the same shape.                                        |
| `art_delete_layer(collection, layer, clear_tokens bool)` | With `clear_tokens`, deletes the art collection's tokens first (the trigger refuses otherwise); deletes the layer (traits cascade); prunes `rules` and `at_least_one` arrays of its trait ids, dropping a rule or group left too small; closes the `position` gap.                              |
| `art_delete_trait(collection, trait)`                    | Deletes the trait; prunes `related_trait_ids` and `trait_ids` of it; drops a rule whose `trait_id` it was (cascade does this) or whose related list is now empty, and a group with fewer than two traits; closes the position gap. The trait's upload row stays (allowed, see the upload spec). |
| `art_delete_art_collection(collection, art_collection)`  | Deletes the art collection (layers, traits, rules via cascade, tokens via cascade), prunes groups and rules that referenced its traits, closes the position gap, and renumbers the remaining tokens from 1 in `token_id` order (deferrable PK, one statement).                                  |
| `art_set_layer_weights(collection, layer, rows jsonb)`   | Updates `weight` and `constant` for every trait in the layer from `[{ id, weight, constant }]`; enforces `constant implies weight 0`; refuses when the ids are not exactly the layer's non-blank traits.                                                                                        |
| `art_save_tokens(collection, tokens jsonb, seed bigint)` | Deletes the collection's tokens and inserts the new set from `[{ tokenId, artCollectionId, dna, description }]`; writes `generation_seed`. Up to 100,000 rows (MAX_SUPPLY); 10,000 rows take under five seconds per the 9e timing check.                                                        |
| `art_delete_tokens(collection, ids int[])`               | Deletes the ids and moves every later id up by the count of deleted ids below it, in one set-based update under the deferrable key.                                                                                                                                                             |
| `art_start_over(collection)`                             | Deletes tokens, rules, groups, layers (traits cascade), art collections and the `layer_image` and matching `thumbnail` upload rows; sets `canvas_width`, `canvas_height` and `generation_seed` to null. Returns the storage keys of the deleted uploads so the action can delete the objects.   |

Guard sentences that pass through to the creator unchanged: "The art is locked and cannot
change.", "A layer can have at most 500 traits.", "Clear the tokens first." (from
`layers_guard_tokens`; the action rewords it to "Clear the generated tokens first, then change the
layers." when the screen did not offer to), "Token DNA does not match the layers.", and the two
canvas and cap sentences from `record_upload`.

The functions are re-validated by `verify:local` section 9f (section 12).

## 8. Token operations

| Screen action                   | Store (unchanged pure logic)   | Persisted as                                                 |
| ------------------------------- | ------------------------------ | ------------------------------------------------------------ |
| Generate                        | `generateSet` with `newSeed()` | `saveTokens(all, seed)`; then `setCollectionSupply` as today |
| Re-roll selected                | `regenerate`                   | `updateTokens` with the changed rows' `dna`                  |
| Change one trait                | `changeTrait`                  | `updateTokens` (one row)                                     |
| Describe one or all             | `setDescription`               | `updateTokens` with `description`                            |
| Swap two ids                    | `swapIds`                      | `swapTokens(a, b)`                                           |
| Delete tokens                   | `deleteTokens`                 | `deleteTokens(ids)`                                          |
| Shuffle ids                     | `shuffleIds`                   | `saveTokens(all, seed)` (same seed)                          |
| Fill to size                    | `fillTo`                       | `appendTokens(new rows)`                                     |
| Rename tokens (token name)      | `renameTokens`                 | `updateArtSettings({ tokenName })`; names are not stored     |
| Clear the set (structural edit) | `tokens: null`                 | `clearTokens()`, or the `clearTokens` flag of `deleteLayer`  |
| Blank traits in metadata        | `showBlankTraits`              | `updateArtSettings({ showBlankTraits })`                     |

The seed is saved with the set; the Generate screen shows "Generated from seed <n>" from the
loaded value, which is new. A structural edit while tokens exist keeps today's confirmation dialog
and then persists the clear before the edit, in order through the sync chain (or inside
`art_delete_layer`).

Moving a layer while tokens exist: the database refuses a reorder with tokens present, so the
screen asks to clear the tokens first (the same dialog as adding or deleting a layer) instead of
remapping the DNA in the browser. This is the one creator-visible change from the current screens;
the order of layers rarely changes after generation, and a remap in the database would have to
rewrite every token.

## 9. The Assets screen

- `useAssetItems` already adopts the stored row (`uploadId`). Editions (`setQuantity`,
  `setQuantityMany`) call `updateAsset(uploadId, { quantity })`; attribute edits call
  `updateAsset(uploadId, { attributes })`; both debounced 250 ms per item. Items without an
  `uploadId` yet (still uploading) queue their edit until adoption.
- The list order is the `uploads.position` of the asset rows; `add` appends positions, a reorder
  or the "shuffled" order writes `setAssetOrder` for every item. The `order` radio therefore
  becomes an action, not a stored flag: "shuffled" assigns new positions from the screen's seed.
- The token name and description panel calls `updateArtSettings`.
- The page loads the asset rows (`kind = 'asset'`, ordered by `position`) into `UploadedAsset`
  with `uploadId`, `quantity`, `attributes`, `mediaType` and the served URL; sample data stays
  behind the demo switch.
- Lock (next sub-project) builds the 1/1 and single-asset token list from these rows.

## 10. Read only and deferred art

- `stageContext` derives `readOnly` for the Art steps from `art_locked_at` (set means read only),
  not from `status`.
- `artDeferred` comes from `collections.art_deferred`; the "finish later" screen writes it with
  `updateArtSettings({ artDeferred })`; the `?art=deferred` URL parameter and both `Seam:` comments
  in `finish-later.tsx` go. `_lib/stage.ts` and `layers/page.tsx` drop their "until Phase 3" notes.

## 11. Folder upload and images

- `useFolderUpload.finish()` still builds the structure with `mergeUpload` for the preview, then
  calls `importLayers` with `{ collections: [{ name, layers: [{ name, traits: [{ name, uploadId }] }] }], activeCollectionId? }`
  and seeds the store from the returned ids. Even weights are set by the function. A collection
  that already has layers in the target art collection is refused with "This collection already
  has layers. Start over to replace them."
- `addTraits` on the Layers screen (adding images to an existing layer) uploads through the same
  uploader, then calls `addTraits(layerId, [{ name, uploadId }])`; the 500-trait sentence passes
  through.
- Trait grids and the preview use `thumbnailUrl` where present and fall back to `imageUrl`; the
  composite preview keeps `imageUrl`.
- "Start over" (a button in the Layers screen's collection panel, confirmed by a dialog that names
  what goes) calls `startOver()`, which runs `art_start_over` and then deletes the returned
  objects best effort; the canvas is free again.
- `deleteUpload` is unchanged; a `layer_image` referenced by a trait is still refused with the
  trait sentence.

## 12. Testing

- Unit (vitest, web): `toProject(rows)` and the inverse mappers (ids, image URLs, rule kinds,
  `in_metadata`, tokens with names and ranks, empty project); the sync chain (edits apply in order,
  a failed persist restores the snapshot, a create waits for its id, sample mode persists
  nothing, the lock sentence flips read only); the weight debounce sends one call per layer; the
  action input schemas (one failing row per rule in section 6).
- `verify:local` section 9f, "art edits": every function in section 7 as the owner and as another
  creator (refused), including: delete a trait that two rules and one group reference (pruned,
  the empty rule gone, the group of one gone); delete a layer with tokens without the flag
  (refused with the trigger sentence) and with it (tokens gone, positions closed); delete an art
  collection with tokens in two collections (remaining tokens renumbered from 1); set weights with
  a constant (weight forced to 0) and with a missing trait (refused); save 10,000 tokens then
  delete 3 (gaps closed, under five seconds); import a two-layer folder payload and a second import
  into the same art collection (refused); start over leaves no art rows, no layer uploads and a
  null canvas; every function refused after the lock.
- Browser: sample data off; upload a folder, rename a layer, set weights, add a rule, generate,
  re-roll one token, delete two, reload and see the same project; delete a layer with the clear
  dialog; start over and see the empty Layers screen; on a 1/1 project add two files, set editions
  and an attribute, reload and see them.

## 13. Acceptance criteria

- [ ] Every edit the Art screens offer survives a reload in a project with real rows, and sample
      mode still renders every Art screen without a database write.
- [ ] `pnpm typecheck && pnpm lint && pnpm test` pass at the root; `verify:local` passes with
      section 9f added; `verify:storage` still passes.
- [ ] A failed write rolls the screen back and shows a sentence; a locked project is read only on
      every Art screen from `art_locked_at`.
- [ ] Deleting a trait prunes every rule and group that named it; deleting tokens closes the id
      gaps; deleting an art collection renumbers the rest.
- [ ] The folder upload writes art collections, layers and traits linked to their upload rows in
      one transaction; start over empties the project and frees the canvas.
- [ ] The Assets screen's editions, attributes and order survive a reload.
- [ ] `docs/MASTER_PLAN.md` Phase 3 names this sub-project as landed and the next one (lock and
      pay); the creator flow spec's seams list drops the Art entries that are now real.
