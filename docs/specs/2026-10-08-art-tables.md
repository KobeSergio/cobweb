# Art tables: specification

Companion plan: [../plans/2026-10-08-art-tables.md](../plans/2026-10-08-art-tables.md).
Product decisions: [../MASTER_PLAN.md](../MASTER_PLAN.md#decisions). Parent phase:
[MASTER_PLAN, Phase 3](../MASTER_PLAN.md#phase-3-art-generator). Engine the rows feed:
[2026-10-07-dna-engine.md](2026-10-07-dna-engine.md). Screens that will read the rows:
[2026-10-03-creator-flow-ui.md](2026-10-03-creator-flow-ui.md) sections 4.3, 4.4 and 7.

## 1. Goal

Give the art a home in Postgres: every piece of state the Art screens keep in the browser today
becomes rows with row-level security, so the next sub-projects can replace the browser store with
server actions, upload files against real rows, and lock a token list the server can validate and
hash.

This is the second of Phase 3's five sub-projects. It is schema, policies, generated types and
access checks. It writes no server action and changes no screen.

## 2. Scope

### In scope

- One migration adding the art tables: `art_collections`, `layers`, `traits`, `rules`,
  `at_least_one`, `tokens`, `uploads`, `render_jobs`, `render_batches`, and new columns on
  `collections`.
- Row-level security and grants for every new table, in the pattern the existing tables use:
  revoke everything, then grant exactly what the creator may do, with ownership checked through
  the owning collection.
- Database-side guards the engine relies on: a trait belongs to a layer of its own collection, a
  rule names traits of one project, a token's DNA has one entry per layer, the 500-trait cap, and
  no art writes once the art is locked.
- Regenerated `apps/web/src/lib/database.types.ts`.
- New checks in `apps/web/scripts/verify-local.ts` for every new table.

### Out of scope (later sub-projects)

- The server actions that replace `components/art/state/art-store.ts` (screen wiring).
- Presigned uploads, thumbnails and content-hash deduplication at upload time (upload
  sub-project). This spec defines the `uploads` row they will write.
- The lock action, the quote, payment verification and the render pipeline's writes (lock and pay,
  Phase 4). This spec defines the `render_jobs` and `render_batches` rows they will write.
- Any data migration: there is no production data yet.

### Decisions carried in

- Storage limits: 5 GB of layer files per project and 500 traits per layer (MASTER_PLAN, Art).
  The trait cap is enforced in the database. The byte limit is enforced when a file is admitted
  (upload sub-project), since the database only sees files that were accepted.
- A fixed quantity is a cap (`constant`), never an exact count.
- The browser submits the final token list and the server validates and hashes it with
  `validateTokenList` and `hashTokenList` from `@cobweb/dna`. The rows in `tokens` are what the
  server validates and what the render pipeline reads.
- Deferred art (creator flow spec, section 7): a collection may be deployed on a placeholder while
  its real set is still editable. The gate for editing art is therefore not `status = 'draft'` but
  a new `collections.art_locked_at`, set when the real set is locked.
- Placeholder fee: a placeholder-only lock costs nothing (decided 7 October 2026). The job row
  carries a zero quote.

## 3. Naming

The project the creator launches is already `public.collections`. A generative project's inner
groups (the sample's Owls and Owlets) are `public.art_collections`. The screens keep saying
"Collection" for those; only the database and the generated types say `art_collection`.

Column names follow the existing tables: `snake_case`, `created_at` and `updated_at` with the
shared `set_updated_at` trigger where rows are edited, `collection_id` on every row.

## 4. Schema

All ids are `uuid` with `gen_random_uuid()`. Every art row carries `collection_id` (the project)
so the ownership policy is one lookup, as `whitelist_entries` does. Foreign keys cascade from the
collection, so deleting a draft removes its art.

### 4.1 New columns on `collections`

| Column              | Type        | Meaning                                                                                                   |
| ------------------- | ----------- | --------------------------------------------------------------------------------------------------------- |
| `art_deferred`      | boolean     | "Finish the art later" taken. Not null, default false.                                                    |
| `art_locked_at`     | timestamptz | When the real set was locked. Null while the art is editable. Set only by server code.                    |
| `token_name`        | text        | The token name chosen at Generate ("Night Owls" in "Night Owls #1"). Nullable; 1 to 64 characters, no `#`, quotes or backticks. |
| `token_description` | text        | Written to every token's metadata. Not null, default empty, up to 500 characters.                         |
| `show_blank_traits` | boolean     | Write blanks into metadata with the blank's name. Not null, default false.                                |
| `generation_seed`   | bigint      | Seed of the last full generation (0 to 4,294,967,295). Null before the first generation.                  |
| `canvas_width`      | integer     | Pixel size every layer image must match, set by the first upload. 1 to 2048. Null until then.             |
| `canvas_height`     | integer     | Same range. A check requires `canvas_width = canvas_height` when both are set, since layers are square.   |

The creator may write all of these except `art_locked_at`, which joins `status`, `chain_id` and
`contract_address` as server-only. The frozen-field guard gains: once `art_locked_at` is set,
`token_name`, `show_blank_traits` and `generation_seed` cannot change (they are what was paid for
and rendered). `token_description` stays editable, since it is written at render time from the
row and a creator fixing a typo before render is fine; after render it is in the metadata and the
guard does not need to know.

### 4.2 `art_collections`

| Column          | Type    | Constraints                                        |
| --------------- | ------- | -------------------------------------------------- |
| `id`            | uuid    | primary key                                        |
| `collection_id` | uuid    | not null, references collections on delete cascade |
| `name`          | text    | 1 to 48 characters                                 |
| `size`          | integer | not null, 0 to 10,000 (0 means not sized yet)      |
| `position`      | integer | not null, >= 0; unique with `collection_id`        |

Index on `collection_id`. Every generative project has at least one; a 1/1s or single asset
project has none (its art is `uploads`).

### 4.3 `layers`

| Column              | Type    | Constraints                                                         |
| ------------------- | ------- | ------------------------------------------------------------------- |
| `id`                | uuid    | primary key                                                         |
| `collection_id`     | uuid    | not null, references collections on delete cascade                  |
| `art_collection_id` | uuid    | not null, references art_collections on delete cascade              |
| `name`              | text    | 1 to 48 characters                                                  |
| `display_name`      | text    | nullable, 1 to 48 characters; the metadata `trait_type` when set    |
| `position`          | integer | not null, >= 0; unique with `art_collection_id`; 0 is the bottom    |
| `bypass_dna`        | boolean | not null, default false                                             |

Index on `collection_id` and on `art_collection_id`. A trigger refuses a layer whose
`art_collection_id` belongs to a different `collection_id` (`check_violation`).

### 4.4 `traits`

| Column          | Type          | Constraints                                                              |
| --------------- | ------------- | ------------------------------------------------------------------------ |
| `id`            | uuid          | primary key                                                              |
| `collection_id` | uuid          | not null, references collections on delete cascade                       |
| `layer_id`      | uuid          | not null, references layers on delete cascade                            |
| `name`          | text          | 1 to 64 characters                                                       |
| `weight`        | numeric(5, 2) | not null, 0 to 100; the share among the layer's weighted traits          |
| `constant`      | integer       | nullable; when set, 1 to 10,000 and the trait is a cap                   |
| `blank`         | boolean       | not null, default false; a blank has no image                            |
| `in_metadata`   | boolean       | not null, default true; false leaves the trait out of the attributes     |
| `upload_id`     | uuid          | nullable, references uploads on delete restrict; required unless `blank` |
| `position`      | integer       | not null, >= 0; unique with `layer_id`                                   |

Index on `collection_id` and on `layer_id`. Checks: `blank or upload_id is not null`;
`constant is null or weight = 0`. A partial unique index on `layer_id where blank` allows one
blank per layer. A trigger refuses the 501st trait of a layer with the message "A layer can have
at most 500 traits.", refuses a trait whose `layer_id` belongs to another collection, and refuses
an `upload_id` that is not a `layer_image` of the same collection.

The trait id the engine uses is this row's uuid as text. The web app's sample data uses slugs like
`eyes-starry`; both are strings to the engine.

### 4.5 `rules`

| Column              | Type        | Constraints                                                      |
| ------------------- | ----------- | ---------------------------------------------------------------- |
| `id`                | uuid        | primary key                                                      |
| `collection_id`     | uuid        | not null, references collections on delete cascade               |
| `kind`              | `rule_kind` | enum: `doesnt_mix_with`, `always_pairs_with`, `must_pair_with`   |
| `trait_id`          | uuid        | not null, references traits on delete cascade                    |
| `related_trait_ids` | uuid[]      | not null, at least one entry                                     |
| `bidirectional`     | boolean     | not null; a check requires `bidirectional = (kind <> 'must_pair_with')` |

Index on `collection_id` and on `trait_id`. A trigger refuses a rule whose source or any related
trait is outside the collection, or whose related traits are not all in one layer of the source
trait's art collection. The engine's `pruneRules` behaviour (drop a deleted trait from a rule,
remove a rule left with nothing to pair) is done by the server action that deletes a trait, not
by a cascade, so the creator sees what changed; the array has no foreign key for that reason.

The enum values map to the engine's wordings in the server layer: `doesnt_mix_with` is
"doesn't mix with", and so on. The database never stores the apostrophe.

### 4.6 `at_least_one`

| Column              | Type   | Constraints                                                        |
| ------------------- | ------ | ------------------------------------------------------------------ |
| `id`                | uuid   | primary key                                                        |
| `collection_id`     | uuid   | not null, references collections on delete cascade                 |
| `art_collection_id` | uuid   | not null, references art_collections on delete cascade             |
| `trait_ids`         | uuid[] | not null, at least two entries, all traits of this art collection (trigger) |

Index on `collection_id`.

### 4.7 `tokens`

| Column              | Type        | Constraints                                                            |
| ------------------- | ----------- | ---------------------------------------------------------------------- |
| `collection_id`     | uuid        | not null, references collections on delete cascade                     |
| `token_id`          | integer     | 1 to 100,000; primary key with `collection_id`                         |
| `art_collection_id` | uuid        | not null, references art_collections on delete cascade                 |
| `dna`               | uuid[]      | not null; one trait id per layer of the art collection, bottom first   |
| `description`       | text        | nullable; a token's own description after an edit, else the project's  |
| `updated_at`        | timestamptz | shared trigger                                                         |

Index on `art_collection_id`. A trigger checks on insert and update that `dna` has exactly as
many entries as the art collection has layers and that each entry is a trait of the layer at that
position, with the message "Token DNA does not match the layers." Rank is never stored; the
engine computes it. Names are never stored; a token is called `token_name || ' #' || token_id`.

Expected size: a 10,000-token project is 10,000 rows of about 7 uuids each. The DNA trigger does
one query per row; a 10,000-row insert must still finish in seconds (acceptance criterion).

### 4.8 `uploads`

| Column          | Type          | Constraints                                                                        |
| --------------- | ------------- | ---------------------------------------------------------------------------------- |
| `id`            | uuid          | primary key                                                                        |
| `collection_id` | uuid          | not null, references collections on delete cascade                                 |
| `kind`          | `upload_kind` | enum: `layer_image`, `asset`, `placeholder`, `thumbnail`                           |
| `storage_key`   | text          | not null; the object key, content-hash based so duplicates share one object        |
| `content_hash`  | text          | not null; `^[0-9a-f]{64}$` (SHA-256 of the bytes)                                   |
| `mime`          | text          | not null; one of image/png, image/jpeg, image/webp, image/gif, video/mp4           |
| `media_type`    | `media_type`  | enum: `image`, `gif`, `video`                                                      |
| `bytes`         | bigint        | not null, 1 to 52,428,800 (50 MB, the MP4 ceiling); per-kind limits apply at admission |
| `width`         | integer       | nullable (video); 1 to 8192                                                        |
| `height`        | integer       | nullable; same                                                                     |
| `file_name`     | text          | not null, 1 to 255 characters, the original name                                   |
| `position`      | integer       | nullable; order among a project's assets (1/1s)                                    |
| `quantity`      | integer       | not null, default 1; editions of a 1/1 asset, 1 to 10,000                          |
| `attributes`    | jsonb         | not null, default `[]`; `{ trait_type, value }[]` for 1/1 and single assets        |
| `created_at`    | timestamptz   |                                                                                    |

Index on `collection_id` and on `(collection_id, kind)`. A unique index on
`(collection_id, content_hash, kind)` so one project never stores the same file twice. A check
enforces `kind <> 'layer_image' or (width = height and width <= 2048)`: layer images are square
and at most 2048 on a side.

### 4.9 `render_jobs`

| Column                  | Type           | Constraints                                                                    |
| ----------------------- | -------------- | ------------------------------------------------------------------------------ |
| `id`                    | uuid           | primary key                                                                    |
| `collection_id`         | uuid           | not null, references collections on delete restrict                            |
| `kind`                  | `render_kind`  | enum: `real`, `placeholder`                                                    |
| `state`                 | `render_state` | enum: `locked`, `payment_due`, `paid`, `waived`, `rendering`, `done`, `failed` |
| `token_count`           | integer        | not null, >= 0 (a placeholder job renders one file)                            |
| `token_list_hash`       | text           | nullable; `^0x[0-9a-f]{64}$`; the `hashTokenList` value of the locked rows     |
| `allow_duplicates`      | boolean        | not null, default false; the creator's choice at lock                          |
| `fee_per_token_wei`     | numeric(78, 0) | not null, >= 0                                                                 |
| `quote_total_wei`       | numeric(78, 0) | not null, >= 0                                                                 |
| `quote_chain_id`        | integer        | nullable                                                                       |
| `quote_payer`           | text           | nullable; `^0x[0-9a-f]{40}$`; only a payment from this wallet counts           |
| `quote_expires_at`      | timestamptz    | nullable; the quote's TTL                                                      |
| `payment_tx_hash`       | text           | nullable; `^0x[0-9a-f]{64}$`                                                   |
| `paid_at`               | timestamptz    | nullable                                                                       |
| `paid_amount_wei`       | numeric(78, 0) | nullable                                                                       |
| `waived_by`             | uuid           | nullable, references auth.users; set together with `waived_reason`             |
| `waived_reason`         | text           | nullable                                                                       |
| `batch_size`            | integer        | not null, default 100                                                          |
| `batches_total`         | integer        | not null, default 0                                                            |
| `batches_done`          | integer        | not null, default 0; <= `batches_total`                                        |
| `images_cid`            | text           | nullable                                                                       |
| `metadata_cid`          | text           | nullable                                                                       |
| `placeholder_upload_id` | uuid           | nullable, references uploads; required when `kind = 'placeholder'`             |
| `error`                 | text           | nullable; why a job failed, for the creator                                    |
| `created_at`, `started_at`, `finished_at`, `updated_at` | timestamptz | `started_at` set when rendering begins, `finished_at` on done or failed |

Index on `collection_id` and a partial unique index on `(collection_id, kind) where state not in
('done', 'failed')`, so a project has at most one open job of each kind. Checks: a job in
`paid`, `waived`, `rendering` or `done` has `payment_tx_hash` or `waived_by` set, or a
`quote_total_wei` of zero, so a job never renders unpaid unless the quote was zero (the
placeholder fee decision); `state = 'done'` requires `metadata_cid`.

Clients may only read their jobs. Every write is server code (the lock action and the pipeline).

### 4.10 `render_batches`

| Column                             | Type          | Constraints                                   |
| ---------------------------------- | ------------- | --------------------------------------------- |
| `job_id`                           | uuid          | references render_jobs on delete cascade      |
| `index`                            | integer       | >= 0; primary key with `job_id`               |
| `state`                            | `batch_state` | enum: `queued`, `running`, `done`, `failed`   |
| `attempts`                         | integer       | not null, default 0                           |
| `first_token_id`, `last_token_id`  | integer       | the token id range this batch renders         |
| `images_cid`                       | text          | nullable; the batch's CAR root                |
| `error`                            | text          | nullable                                      |
| `updated_at`                       | timestamptz   | shared trigger                                |

Read-only for clients.

## 5. Access rules

Every new table has row-level security enabled and starts with `revoke all ... from anon,
authenticated`.

- **Art tables** (`art_collections`, `layers`, `traits`, `rules`, `at_least_one`, `tokens`,
  `uploads`): one policy `for all to authenticated` using and checking ownership through the
  collection, exactly as `mint_groups` does. The lock gate is a trigger shared by the seven
  tables: before insert, update or delete, when the caller is `anon` or `authenticated` and the
  owning collection's `art_locked_at` is not null, raise "The art is locked and cannot change."
  with `insufficient_privilege`. Reads stay allowed after the lock. On `uploads`, the creator's
  update grant excludes `storage_key`, `content_hash`, `bytes`, `width`, `height`, `mime` and
  `media_type`, which describe the stored object and are written by the upload action.
- **Render tables**: `select` only for `authenticated`, through ownership. No insert, update or
  delete grant to any client role.
- **`collections`**: the creator's update grant gains `art_deferred`, `token_name`,
  `token_description`, `show_blank_traits`, `generation_seed`, `canvas_width`, `canvas_height`.
  `art_locked_at` is server-only, enforced the way `slug` is: not granted, and the frozen-field
  guard refuses a change from `anon` or `authenticated`.
- Every policy uses `(select auth.uid())`, and every column a policy or trigger looks up is
  indexed (`collection_id` everywhere, `layer_id`, `art_collection_id`).

## 6. Generated types

`apps/web/src/lib/database.types.ts` is regenerated with
`supabase gen types typescript --local > apps/web/src/lib/database.types.ts` after
`supabase db reset`, then formatted with Prettier. `pnpm typecheck` must pass without changes to
any screen: nothing in the web app reads the new tables yet.

## 7. Access checks

`apps/web/scripts/verify-local.ts` gains a section per table, in its existing style (a creator A,
a creator B, `expectError` with the permission codes, `expectNothing` for cross-tenant reads),
each run against a fresh draft collection of A:

- `art_collections`: A inserts one; B cannot read, insert into A's collection, update or delete it.
- `layers`: A inserts one under their art collection; a layer naming B's collection with A's art
  collection is refused; B cannot read it.
- `traits`: A inserts a blank trait and a trait with an upload; a trait that is not blank and has
  no upload is refused (23514); the 501st trait of a layer is refused with the cap message; a trait
  whose layer is in another collection is refused; a second blank in one layer is refused (23505);
  B cannot read.
- `rules`: A inserts a `doesnt_mix_with` rule between traits of two layers; a rule whose related
  trait is in another collection is refused; `bidirectional` false on a two-way kind is refused.
- `at_least_one`: A inserts one over two traits of one layer; one trait is refused.
- `tokens`: A inserts a token whose DNA matches the layers; a DNA of the wrong length is refused
  with "Token DNA does not match the layers."; a DNA naming a trait of the wrong layer is refused;
  B cannot read.
- `uploads`: A inserts a layer image row; a non-square layer image is refused; the same content
  hash twice for the same kind is refused (23505); A cannot update `storage_key`; B cannot read or
  insert.
- `render_jobs` and `render_batches`: A cannot insert, update or delete (permission); the service
  role inserts a job and a batch, A can read both; B cannot.
- Lock gate: the service role sets `art_locked_at` on A's collection; A can still read every art
  row but an insert, an update and a delete on each art table are refused; A cannot set or clear
  `art_locked_at`.
- `collections`: A can set `token_name`, `show_blank_traits`, `canvas_width` and `canvas_height`
  while unlocked; a non-square canvas is refused; a `token_name` with `#` is refused; after the
  lock, `token_name` cannot change.
- Cleanup: deleting the run's collections removes every art row by cascade. A render job blocks
  the delete (restrict), so the cleanup deletes jobs first with the service role.

The script's final line must still read "N passed, 0 failed".

## 8. Acceptance criteria

- [ ] `supabase db reset` applies the migration from a clean database with no errors.
- [ ] `pnpm --filter @cobweb/web verify:local` passes with every check in section 7 present.
- [ ] `pnpm typecheck && pnpm lint && pnpm test` pass at the root with the regenerated types.
- [ ] Every new table has row-level security enabled, a policy that checks ownership through the
      collection, and no grant to `anon` (checked by a query over `pg_policies` and
      `information_schema.role_table_grants` in the plan's last task).
- [ ] No art table accepts a write from the creator once `art_locked_at` is set, and reads still
      work.
- [ ] A 10,000-row token insert for one collection, in one statement, completes in under five
      seconds locally (checked once by hand in the plan's last task).
- [ ] `docs/MASTER_PLAN.md` Phase 3 names this sub-project as landed and the next one (layer and
      asset upload); the creator flow spec's section 5 Phase 3 row names the tables.
