# Art Tables Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Postgres schema, access rules, generated types and access checks that hold a project's art: art collections, layers, traits, rules, constraints, tokens, uploads and render jobs.

**Architecture:** One migration, `supabase/migrations/20261008010000_art_tables.sql`, grown over four tasks in dependency order (uploads and art collections, then layers, traits, rules and constraints, then tokens, then render jobs and the lock gate), each task guarded by new checks in `apps/web/scripts/verify-local.ts` that are written first and fail against the previous schema. The last task regenerates `database.types.ts`, proves the policy and grant invariants with a query, times a 10,000-row insert, and records the sub-project in the docs. No screen or server action changes.

**Tech Stack:** Postgres 15 on local Supabase (ports 5532x; `supabase db reset` applies migrations from scratch), PL/pgSQL triggers, row-level security, `supabase gen types typescript --local`, the existing Node access-check script (`@supabase/supabase-js`, viem SIWE).

**Spec:** [../specs/2026-10-08-art-tables.md](../specs/2026-10-08-art-tables.md)

## Global Constraints

- Every new table: `alter table ... enable row level security`, then `revoke all on <table> from anon, authenticated`, then grants. Policies use `(select auth.uid())`. Every column a policy or trigger looks up is indexed.
- Ownership is always checked through `public.collections.owner_id` via the row's `collection_id`, as `mint_groups` does.
- Server-only columns and tables: `collections.art_locked_at`, `render_jobs`, `render_batches`. No client grant beyond `select`.
- Trigger functions are `language plpgsql`, `security invoker` unless noted, `set search_path = ''`, and raise with the exact messages and error codes the spec names: cap "A layer can have at most 500 traits." (`check_violation`), DNA "Token DNA does not match the layers." (`check_violation`), lock "The art is locked and cannot change." (`insufficient_privilege`).
- Enum values are `snake_case` without apostrophes: `rule_kind` is `doesnt_mix_with | always_pairs_with | must_pair_with`.
- Column limits are the spec's: names 1 to 48 (layers, art collections) or 1 to 64 (traits, token_name), weight `numeric(5,2)` 0 to 100, constant 1 to 10,000, 500 traits per layer, layer images square and at most 2048, bytes at most 52,428,800.
- `verify-local.ts` keeps its style: `check(name, async () => string | null)`, `expectError(error, codes, data)`, `expectNothing(error, data)`, `PERMISSION`, `CHECK`, `UNIQUE`, creators `A` and `B`, `admin` for the service role. New sections go before "// 10. Cleanup", and new cleanup steps go inside `cleanup()` before the collections delete.
- Prettier: no semicolons, single quotes, 110 columns (TypeScript); SQL files are hand-formatted, two-space indent, one statement per line where short. No em or en dashes.
- `supabase db reset` must finish without an error; run it after every migration edit. Never run against anything but localhost.

## Review Focus

Inputs the spec implies but no task's tests exercise. Each is pinned to the task that owns it.

1. A layer moved to a new `position` after tokens exist: the DNA trigger validates by layer order, so the stored DNA of every token is now wrong, yet nothing re-checks existing rows on a layer update. The server action that reorders layers must remap DNA (as the browser store does today); the database should at least refuse an update of `layers.position` while tokens exist for the art collection (Task 3, step 1).
2. A `uploads` row deleted while a trait points at it: `on delete restrict` must refuse, with a message the server action can show (Task 1, step 1).
3. Deleting an `art_collection` that has tokens: tokens cascade away, but tokens of later art collections keep their ids and the project's ids no longer run 1 to N. The engine's `deleteTokens` renumbers; the database cannot. Pin that the cascade happens and document that renumbering is the action's job (Task 3, step 1).
4. `tokens.dna` containing a trait that is blank: allowed (a blank is a trait of its layer), and `tokens.dna` with the same trait twice: refused, because the second entry is not a trait of its layer (Task 3, step 1).
5. A `render_jobs` row for a `placeholder` kind without `placeholder_upload_id`: refused by a check, so the pipeline can never render a placeholder that does not exist (Task 4, step 1).

---

### Task 1: Foundation: enums, uploads, art collections, layers, new collection columns

**Files:**

- Create: `supabase/migrations/20261008010000_art_tables.sql`
- Modify: `apps/web/scripts/verify-local.ts` (new section 9a before cleanup; new fixture helpers after `insertCollection`)

**Interfaces:**

- Produces (update grants are column-level everywhere: ids and parent keys are never client-updatable): enums `public.upload_kind`, `public.media_type`; tables `public.uploads`, `public.art_collections`, `public.layers`; function `public.record_upload(...) returns uuid` (the only way a client records an upload); columns on `public.collections`: `art_deferred`, `art_locked_at`, `token_name`, `token_description`, `show_blank_traits`, `generation_seed`, `canvas_width`, `canvas_height`; function `private.collection_owned(uuid) returns boolean` (used by every later policy); verify-local helpers `uploadInput(collectionId, overrides)`, `recordUpload(client, collectionId, overrides)`, `insertArtCollection(client, collectionId, overrides)`, `insertLayer(client, collectionId, artCollectionId, overrides)`.

- [ ] **Step 1: Write the failing checks**

Add these helpers after `expectRejectedInsert` in `apps/web/scripts/verify-local.ts`:

```ts
const HEX64 = (n: number) => n.toString(16).padStart(64, '0')

function uploadInput(collectionId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    collection_id: collectionId,
    kind: 'layer_image',
    storage_key: `${collectionId}/layers/${HEX64(++nameCount)}.png`,
    content_hash: HEX64(nameCount),
    mime: 'image/png',
    media_type: 'image',
    bytes: 1234,
    width: 1000,
    height: 1000,
    file_name: 'trait.png',
    ...overrides,
  }
}

/** Records an upload through the RPC, as the upload server action will; returns the new row id. */
async function recordUpload(client: SupabaseClient, collectionId: string, overrides: Record<string, unknown> = {}) {
  const input = uploadInput(collectionId, overrides)
  const { data, error } = await client.rpc('record_upload', {
    p_collection_id: collectionId,
    p_kind: input.kind,
    p_storage_key: input.storage_key,
    p_content_hash: input.content_hash,
    p_mime: input.mime,
    p_media_type: input.media_type,
    p_bytes: input.bytes,
    p_width: input.width,
    p_height: input.height,
    p_file_name: input.file_name,
  })
  return { id: (data as string | null) ?? null, error: error as DbError }
}

async function insertArtCollection(client: SupabaseClient, collectionId: string, overrides: Record<string, unknown> = {}) {
  const { data, error } = await client
    .from('art_collections')
    .insert({ collection_id: collectionId, name: 'Owls', size: 0, position: 0, ...overrides })
    .select()
    .single()
  return { row: data as { id: string } | null, error: error as DbError }
}

async function insertLayer(
  client: SupabaseClient,
  collectionId: string,
  artCollectionId: string,
  overrides: Record<string, unknown> = {},
) {
  const { data, error } = await client
    .from('layers')
    .insert({ collection_id: collectionId, art_collection_id: artCollectionId, name: 'Eyes', position: 0, ...overrides })
    .select()
    .single()
  return { row: data as { id: string } | null, error: error as DbError }
}
```

Add a new section before `// 10. Cleanup` as a function called from the end of `main()` (after the last existing check, add `await artFoundation(A, B)`):

```ts
// ---------------------------------------------------------------------------------------------
// 9a. Art foundation: uploads, art collections, layers, collection art columns
// ---------------------------------------------------------------------------------------------
async function artFoundation(A: Creator, B: Creator): Promise<void> {
  const col = await insertCollection(A.client)
  if (!col.row) throw new Error(`setup: ${describe(col.error)}`)
  const cid = col.row.id
  const other = await insertCollection(B.client)
  if (!other.row) throw new Error(`setup: ${describe(other.error)}`)

  let artId = ''
  await check('art_collections: A inserts one under their collection', async () => {
    const { row, error } = await insertArtCollection(A.client, cid)
    if (error || !row) return describe(error)
    artId = row.id
    return null
  })
  await check("art_collections: B cannot insert into A's collection", async () => {
    const { error, row } = await insertArtCollection(B.client, cid, { position: 1 })
    return expectError(error, PERMISSION, row ? [row] : null)
  })
  await check("art_collections: B cannot read A's", async () => {
    const { data, error } = await B.client.from('art_collections').select().eq('collection_id', cid)
    return expectNothing(error, data)
  })
  await check("art_collections: B cannot update or delete A's", async () => {
    const upd = await B.client.from('art_collections').update({ name: 'Hijacked' }).eq('id', artId).select()
    const del = await B.client.from('art_collections').delete().eq('id', artId).select()
    return expectNothing(upd.error, upd.data) ?? expectNothing(del.error, del.data)
  })
  await check('art_collections: A cannot move one to another of their own collections', async () => {
    const second = await insertCollection(A.client)
    if (!second.row) return `setup: ${describe(second.error)}`
    const { data, error } = await A.client.from('art_collections').update({ collection_id: second.row.id }).eq('id', artId).select()
    return expectError(error as DbError, PERMISSION, data)
  })
  await check('art_collections: a size above 10,000 is refused', async () => {
    const { error, row } = await insertArtCollection(A.client, cid, { position: 2, size: 10_001 })
    return expectError(error, CHECK, row ? [row] : null)
  })

  let layerId = ''
  await check('layers: A inserts one under their art collection', async () => {
    const { row, error } = await insertLayer(A.client, cid, artId)
    if (error || !row) return describe(error)
    layerId = row.id
    return null
  })
  await check("layers: a layer naming B's collection with A's art collection is refused", async () => {
    const { error, row } = await insertLayer(B.client, other.row!.id, artId, { position: 5 })
    return expectError(error, [...PERMISSION, ...CHECK], row ? [row] : null)
  })
  await check("layers: B cannot read A's layer", async () => {
    const { data, error } = await B.client.from('layers').select().eq('id', layerId)
    return expectNothing(error, data)
  })

  let uploadId = ''
  await check('uploads: A records a layer image through record_upload', async () => {
    const { id, error } = await recordUpload(A.client, cid)
    if (error || !id) return describe(error)
    uploadId = id
    return null
  })
  await check('uploads: a direct insert is refused, even by the owner', async () => {
    const { data, error } = await A.client.from('uploads').insert(uploadInput(cid)).select()
    return expectError(error as DbError, PERMISSION, data)
  })
  await check("uploads: a key outside the collection's prefix is refused", async () => {
    const { id, error } = await recordUpload(A.client, cid, { storage_key: `${other.row!.id}/layers/stolen.png` })
    return expectError(error, CHECK, id ? [id] : null)
  })
  await check('uploads: a key that climbs out of its folder is refused', async () => {
    const { id, error } = await recordUpload(A.client, cid, { storage_key: `${cid}/../${other.row!.id}/x.png` })
    return expectError(error, CHECK, id ? [id] : null)
  })
  await check('uploads: a non-square layer image is refused', async () => {
    const { id, error } = await recordUpload(A.client, cid, { width: 1000, height: 900 })
    return expectError(error, CHECK, id ? [id] : null)
  })
  await check('uploads: the same content hash twice for one kind is refused', async () => {
    const first = uploadInput(cid)
    const a = await recordUpload(A.client, cid, first)
    if (a.error) return `setup: ${describe(a.error)}`
    const { id, error } = await recordUpload(A.client, cid, { ...first, storage_key: `${(first.storage_key as string).replace(/\.png$/, '')}-again.png` })
    return expectError(error, UNIQUE, id ? [id] : null)
  })
  await check('uploads: A cannot change the stored object description', async () => {
    const { data, error } = await A.client.from('uploads').update({ storage_key: 'moved' }).eq('id', uploadId).select()
    return expectError(error as DbError, PERMISSION, data)
  })
  await check("uploads: B cannot read A's uploads or record into A's collection", async () => {
    const read = await B.client.from('uploads').select().eq('collection_id', cid)
    const rec = await recordUpload(B.client, cid)
    return expectNothing(read.error, read.data) ?? expectError(rec.error, PERMISSION, rec.id ? [rec.id] : null)
  })

  await check('collections: A sets the art columns while unlocked', async () => {
    const { data, error } = await A.client
      .from('collections')
      .update({ token_name: 'Night Owls', show_blank_traits: true, canvas_width: 1000, canvas_height: 1000, art_deferred: true })
      .eq('id', cid)
      .select()
    if (error) return describe(error)
    return data?.length === 1 ? null : 'no row updated'
  })
  await check('collections: a non-square canvas is refused', async () => {
    const { data, error } = await A.client.from('collections').update({ canvas_width: 1000, canvas_height: 800 }).eq('id', cid).select()
    return expectError(error, CHECK, data)
  })
  await check('collections: a token name with # is refused', async () => {
    const { data, error } = await A.client.from('collections').update({ token_name: 'Owl #' }).eq('id', cid).select()
    return expectError(error, CHECK, data)
  })
  await check('collections: A cannot set art_locked_at', async () => {
    const { data, error } = await A.client.from('collections').update({ art_locked_at: new Date().toISOString() }).eq('id', cid).select()
    return expectError(error, PERMISSION, data)
  })
}
```

- [ ] **Step 2: Run, expect failure**

Run from the repo root (Supabase running): `pnpm --filter @cobweb/web verify:local 2>&1 | grep -E '^(FAIL|INFO|[0-9]+ passed)'`
Expected: FAIL lines for every new check (`relation "public.art_collections" does not exist` or a column grant error), and the final line reports those failures. The existing 82 checks still pass.

- [ ] **Step 3: Write the migration foundation**

`supabase/migrations/20261008010000_art_tables.sql`:

```sql
-- Art tables (docs/specs/2026-10-08-art-tables.md): where a project's art lives once the Art
-- screens stop keeping it in the browser. Access follows the existing tables: every row carries
-- its collection, every policy checks ownership through it, and nothing is granted that the
-- creator does not need. Server-only state (locking, render jobs) is readable, never writable,
-- from a client role.

-- ---------------------------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------------------------
create type public.upload_kind as enum ('layer_image', 'asset', 'placeholder', 'thumbnail');
create type public.media_type as enum ('image', 'gif', 'video');
create type public.rule_kind as enum ('doesnt_mix_with', 'always_pairs_with', 'must_pair_with');
create type public.render_kind as enum ('real', 'placeholder');
create type public.render_state as enum ('locked', 'payment_due', 'paid', 'waived', 'rendering', 'done', 'failed');
create type public.batch_state as enum ('queued', 'running', 'done', 'failed');

-- ---------------------------------------------------------------------------------------------
-- Ownership helper: one indexed lookup every art policy shares
-- ---------------------------------------------------------------------------------------------
create function private.collection_owned(p_collection_id uuid)
returns boolean
language sql
security invoker
set search_path = ''
stable
as $$
  select exists (
    select 1 from public.collections c
    where c.id = p_collection_id and c.owner_id = (select auth.uid())
  );
$$;

revoke all on function private.collection_owned(uuid) from public, anon;
grant execute on function private.collection_owned(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Collections: the art columns
-- ---------------------------------------------------------------------------------------------
alter table public.collections
  add column art_deferred boolean not null default false,
  add column art_locked_at timestamptz,
  add column token_name text check (
    token_name is null or (char_length(token_name) between 1 and 64 and token_name !~ '[#''"`]')
  ),
  add column token_description text not null default '' check (char_length(token_description) <= 500),
  add column show_blank_traits boolean not null default false,
  add column generation_seed bigint check (generation_seed between 0 and 4294967295),
  add column canvas_width integer check (canvas_width between 1 and 2048),
  add column canvas_height integer check (canvas_height between 1 and 2048),
  add constraint canvas_is_square check (
    canvas_width is null or canvas_height is null or canvas_width = canvas_height
  );

grant update (
  name, symbol, description, max_supply,
  art_deferred, token_name, token_description, show_blank_traits, generation_seed, canvas_width, canvas_height
) on public.collections to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Uploads: files the project stores (layer images, 1/1 and single assets, placeholders, thumbnails)
-- ---------------------------------------------------------------------------------------------
create table public.uploads (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null references public.collections (id) on delete cascade,
  kind public.upload_kind not null,
  -- `<collection id>/<folder>/<name>[.<ext>]`, nothing else: no dots or slashes beyond that shape,
  -- so a key can never climb out of its collection's prefix however it is later resolved.
  storage_key text not null check (
    storage_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[a-z_]+/[A-Za-z0-9_-]+(\.[a-z0-9]+)?$'
  ),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  mime text not null check (mime in ('image/png', 'image/jpeg', 'image/webp', 'image/gif', 'video/mp4')),
  media_type public.media_type not null,
  bytes bigint not null check (bytes between 1 and 52428800),
  width integer check (width between 1 and 8192),
  height integer check (height between 1 and 8192),
  file_name text not null check (char_length(file_name) between 1 and 255),
  position integer check (position >= 0),
  quantity integer not null default 1 check (quantity between 1 and 10000),
  attributes jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  constraint layer_images_are_square check (
    kind <> 'layer_image' or (width is not null and width = height and width <= 2048)
  )
);

create index uploads_collection_id_idx on public.uploads (collection_id);
create index uploads_collection_kind_idx on public.uploads (collection_id, kind);
create unique index uploads_one_file_per_hash on public.uploads (collection_id, content_hash, kind);

alter table public.uploads enable row level security;

create policy "uploads: owner all" on public.uploads for all to authenticated
using ((select private.collection_owned(collection_id)))
with check ((select private.collection_owned(collection_id)));

revoke all on public.uploads from anon, authenticated;
-- No client insert: a row is recorded only through record_upload below, which pins the storage
-- key under the collection's own prefix. The creator edits only how a file is used.
grant select, delete on public.uploads to authenticated;
grant update (file_name, position, quantity, attributes) on public.uploads to authenticated;

-- Records an upload for the caller's own collection. Security definer, so it checks everything a
-- policy would: the caller owns the collection, the art is not locked, and the key lives under
-- `<collection id>/`, so a row can never point at another project's object.
create function public.record_upload(
  p_collection_id uuid,
  p_kind public.upload_kind,
  p_storage_key text,
  p_content_hash text,
  p_mime text,
  p_media_type public.media_type,
  p_bytes bigint,
  p_width integer,
  p_height integer,
  p_file_name text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_owner uuid;
  v_locked timestamptz;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select c.owner_id, c.art_locked_at into v_owner, v_locked
  from public.collections c where c.id = p_collection_id;
  if v_owner is null or v_owner <> v_uid then
    raise exception 'collection not found' using errcode = '42501';
  end if;
  if v_locked is not null then
    raise exception 'The art is locked and cannot change.' using errcode = '42501';
  end if;
  -- The column's check gives the key its shape; this pins the prefix to the caller's collection.
  if p_storage_key is null or split_part(p_storage_key, '/', 1) <> p_collection_id::text then
    raise exception 'The storage key must be under the collection''s own prefix.' using errcode = '23514';
  end if;
  insert into public.uploads (collection_id, kind, storage_key, content_hash, mime, media_type, bytes, width, height, file_name)
  values (p_collection_id, p_kind, p_storage_key, p_content_hash, p_mime, p_media_type, p_bytes, p_width, p_height, p_file_name)
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.record_upload(uuid, public.upload_kind, text, text, text, public.media_type, bigint, integer, integer, text)
  from public, anon;
grant execute on function public.record_upload(uuid, public.upload_kind, text, text, text, public.media_type, bigint, integer, integer, text)
  to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Art collections: a generative project's inner groups (the sample's Owls and Owlets)
-- ---------------------------------------------------------------------------------------------
create table public.art_collections (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null references public.collections (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 48),
  size integer not null default 0 check (size between 0 and 10000),
  position integer not null check (position >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (collection_id, position)
);

create index art_collections_collection_id_idx on public.art_collections (collection_id);

alter table public.art_collections enable row level security;

create policy "art_collections: owner all" on public.art_collections for all to authenticated
using ((select private.collection_owned(collection_id)))
with check ((select private.collection_owned(collection_id)));

revoke all on public.art_collections from anon, authenticated;
grant select, insert, delete on public.art_collections to authenticated;
-- Column-level update: a row never moves to another project, even one the creator also owns.
grant update (name, size, position) on public.art_collections to authenticated;

create trigger art_collections_set_updated_at
before update on public.art_collections
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- Layers
-- ---------------------------------------------------------------------------------------------
create table public.layers (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null references public.collections (id) on delete cascade,
  art_collection_id uuid not null references public.art_collections (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 48),
  display_name text check (display_name is null or char_length(display_name) between 1 and 48),
  position integer not null check (position >= 0),
  bypass_dna boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (art_collection_id, position)
);

create index layers_collection_id_idx on public.layers (collection_id);
create index layers_art_collection_id_idx on public.layers (art_collection_id);

-- The art collection must belong to the same project. Runs as the caller: a creator can read
-- their own art collections, so the lookup works, and a row naming someone else's collection is
-- already refused by the policy.
create function public.layers_guard_collection()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.art_collections a
    where a.id = new.art_collection_id and a.collection_id = new.collection_id
  ) then
    raise exception 'The art collection belongs to another project.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger layers_guard_collection
before insert or update on public.layers
for each row execute function public.layers_guard_collection();

alter table public.layers enable row level security;

create policy "layers: owner all" on public.layers for all to authenticated
using ((select private.collection_owned(collection_id)))
with check ((select private.collection_owned(collection_id)));

revoke all on public.layers from anon, authenticated;
grant select, insert, delete on public.layers to authenticated;
grant update (name, display_name, position, bypass_dna) on public.layers to authenticated;

create trigger layers_set_updated_at
before update on public.layers
for each row execute function public.set_updated_at();
```

`private.collection_owned` is `security invoker`, so it reads `collections` under the caller's own policy; the owner sees their row, anyone else sees nothing and the function returns false.

- [ ] **Step 4: Reset and run, expect pass**

Run: `supabase db reset 2>&1 | tail -3 && pnpm --filter @cobweb/web verify:local 2>&1 | grep -E '^(FAIL|[0-9]+ passed)'`
Expected: the reset ends with "Finished supabase db reset"; every check passes (82 plus the new ones). If the `layers` cross-collection check fails with a permission code instead of a check code, that is fine: the test accepts both, since the policy refuses before the trigger runs.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261008010000_art_tables.sql apps/web/scripts/verify-local.ts
git commit -m "Add the art foundation tables: uploads, art collections, layers and the collection art columns"
```

### Task 2: Traits, rules and at-least-one constraints

**Files:**

- Modify: `supabase/migrations/20261008010000_art_tables.sql` (append)
- Modify: `apps/web/scripts/verify-local.ts` (section 9b; helpers `insertTrait`, `insertUploadRow`)

**Interfaces:**

- Consumes: `uploads`, `art_collections`, `layers`, `private.collection_owned` from Task 1; `insertArtCollection`, `insertLayer`, `uploadInput`.
- Produces: tables `public.traits`, `public.rules`, `public.at_least_one`; verify-local helpers `insertUploadRow(client, collectionId): Promise<string>` (returns the id or throws) and `insertTrait(client, collectionId, layerId, overrides)`.

- [ ] **Step 1: Write the failing checks**

Helpers, after `insertLayer`:

```ts
async function insertUploadRow(client: SupabaseClient, collectionId: string): Promise<string> {
  const { id, error } = await recordUpload(client, collectionId)
  if (error || !id) throw new Error(`upload setup: ${describe(error)}`)
  return id
}

async function insertTrait(
  client: SupabaseClient,
  collectionId: string,
  layerId: string,
  overrides: Record<string, unknown> = {},
) {
  const { data, error } = await client
    .from('traits')
    .insert({ collection_id: collectionId, layer_id: layerId, name: 'Wide', weight: 50, position: ++nameCount, ...overrides })
    .select()
    .single()
  return { row: data as { id: string } | null, error: error as DbError }
}
```

Section 9b, called after `artFoundation`:

```ts
// ---------------------------------------------------------------------------------------------
// 9b. Traits, rules and constraints
// ---------------------------------------------------------------------------------------------
async function artTraitsAndRules(A: Creator, B: Creator): Promise<void> {
  const col = await insertCollection(A.client)
  if (!col.row) throw new Error(`setup: ${describe(col.error)}`)
  const cid = col.row.id
  const art = await insertArtCollection(A.client, cid)
  const eyes = await insertLayer(A.client, cid, art.row!.id, { name: 'Eyes', position: 0 })
  const hats = await insertLayer(A.client, cid, art.row!.id, { name: 'Hats', position: 1 })
  const uploadId = await insertUploadRow(A.client, cid)
  const other = await insertCollection(B.client)
  const otherArt = await insertArtCollection(B.client, other.row!.id)
  const otherLayer = await insertLayer(B.client, other.row!.id, otherArt.row!.id)
  const otherUpload = await insertUploadRow(B.client, other.row!.id)
  const otherTrait = await insertTrait(B.client, other.row!.id, otherLayer.row!.id, { upload_id: otherUpload })

  let wide = ''
  let blank = ''
  let cap = ''
  await check('traits: A inserts a trait with an image and a blank without one', async () => {
    const a = await insertTrait(A.client, cid, eyes.row!.id, { name: 'Wide', upload_id: uploadId })
    const b = await insertTrait(A.client, cid, eyes.row!.id, { name: 'None', blank: true, weight: 50 })
    if (a.error || b.error) return describe(a.error ?? b.error)
    wide = a.row!.id
    blank = b.row!.id
    return null
  })
  await check('traits: a trait that is not blank needs an image', async () => {
    const { error, row } = await insertTrait(A.client, cid, eyes.row!.id, { name: 'Bare' })
    return expectError(error, CHECK, row ? [row] : null)
  })
  await check('traits: a second blank in one layer is refused', async () => {
    const { error, row } = await insertTrait(A.client, cid, eyes.row!.id, { name: 'None 2', blank: true })
    return expectError(error, UNIQUE, row ? [row] : null)
  })
  await check('traits: a capped trait has weight 0 and a cap from 1 to 10,000', async () => {
    const bad = await insertTrait(A.client, cid, hats.row!.id, { name: 'Gold', upload_id: uploadId, constant: 3, weight: 10 })
    const good = await insertTrait(A.client, cid, hats.row!.id, { name: 'Gold', upload_id: uploadId, constant: 3, weight: 0 })
    if (good.error || !good.row) return `good refused: ${describe(good.error)}`
    cap = good.row.id
    return expectError(bad.error, CHECK, bad.row ? [bad.row] : null)
  })
  await check("traits: a trait whose layer is in another collection is refused", async () => {
    const { error, row } = await insertTrait(A.client, cid, otherLayer.row!.id, { upload_id: uploadId })
    return expectError(error, [...PERMISSION, ...CHECK], row ? [row] : null)
  })
  await check("traits: an image from another collection is refused", async () => {
    const { error, row } = await insertTrait(A.client, cid, hats.row!.id, { name: 'Stolen', upload_id: otherUpload })
    return expectError(error, CHECK, row ? [row] : null)
  })
  await check('traits: the 501st trait of a layer is refused with the cap message', async () => {
    const layer = await insertLayer(A.client, cid, art.row!.id, { name: 'Many', position: 2 })
    const rows = Array.from({ length: 500 }, (_, i) => ({
      collection_id: cid,
      layer_id: layer.row!.id,
      name: `T${i}`,
      weight: 0.2,
      position: i,
      upload_id: uploadId,
    }))
    const bulk = await A.client.from('traits').insert(rows)
    if (bulk.error) return `setup: ${describe(bulk.error as DbError)}`
    const { error, row } = await insertTrait(A.client, cid, layer.row!.id, { name: 'T500', upload_id: uploadId, position: 500 })
    const problem = expectError(error, CHECK, row ? [row] : null)
    if (problem) return problem
    return error?.message.includes('at most 500 traits') ? null : `wrong message: ${error?.message}`
  })
  await check("traits: B cannot read A's", async () => {
    const { data, error } = await B.client.from('traits').select().eq('id', wide)
    return expectNothing(error, data)
  })
  await check('uploads: an image a trait uses cannot be deleted', async () => {
    const { data, error } = await A.client.from('uploads').delete().eq('id', uploadId).select()
    return expectError(error as DbError, ['23503'], data)
  })

  await check('rules: A inserts a doesnt_mix_with rule between two layers', async () => {
    const { error } = await A.client.from('rules').insert({
      collection_id: cid,
      kind: 'doesnt_mix_with',
      trait_id: wide,
      related_trait_ids: [cap],
      bidirectional: true,
    })
    return error ? describe(error as DbError) : null
  })
  await check('rules: bidirectional must match the kind', async () => {
    const { data, error } = await A.client
      .from('rules')
      .insert({ collection_id: cid, kind: 'must_pair_with', trait_id: wide, related_trait_ids: [cap], bidirectional: true })
      .select()
    return expectError(error as DbError, CHECK, data)
  })
  await check('rules: a related trait in another collection is refused', async () => {
    const { data, error } = await A.client
      .from('rules')
      .insert({ collection_id: cid, kind: 'doesnt_mix_with', trait_id: wide, related_trait_ids: [otherTrait.row!.id], bidirectional: true })
      .select()
    return expectError(error as DbError, CHECK, data)
  })
  await check('rules: related traits must share one layer', async () => {
    const { data, error } = await A.client
      .from('rules')
      .insert({ collection_id: cid, kind: 'doesnt_mix_with', trait_id: cap, related_trait_ids: [wide, blank, cap], bidirectional: true })
      .select()
    return expectError(error as DbError, CHECK, data)
  })

  await check('at_least_one: A inserts one over two traits; one trait is refused', async () => {
    const ok = await A.client
      .from('at_least_one')
      .insert({ collection_id: cid, art_collection_id: art.row!.id, trait_ids: [wide, blank] })
    if (ok.error) return describe(ok.error as DbError)
    const { data, error } = await A.client
      .from('at_least_one')
      .insert({ collection_id: cid, art_collection_id: art.row!.id, trait_ids: [wide] })
      .select()
    return expectError(error as DbError, CHECK, data)
  })
  await check("at_least_one: a trait of another collection is refused", async () => {
    const { data, error } = await A.client
      .from('at_least_one')
      .insert({ collection_id: cid, art_collection_id: art.row!.id, trait_ids: [wide, otherTrait.row!.id] })
      .select()
    return expectError(error as DbError, CHECK, data)
  })
}
```

- [ ] **Step 2: Run, expect failure**

Run: `pnpm --filter @cobweb/web verify:local 2>&1 | grep -E '^(FAIL|[0-9]+ passed)'`
Expected: FAIL on every 9b check (`relation "public.traits" does not exist`); 9a and the older checks still pass.

- [ ] **Step 3: Append the migration**

```sql
-- ---------------------------------------------------------------------------------------------
-- Traits
-- ---------------------------------------------------------------------------------------------
create table public.traits (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null references public.collections (id) on delete cascade,
  layer_id uuid not null references public.layers (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 64),
  weight numeric(5, 2) not null check (weight between 0 and 100),
  constant integer check (constant is null or constant between 1 and 10000),
  blank boolean not null default false,
  in_metadata boolean not null default true,
  -- A trait's image stays while the trait uses it (restrict); deleting the trait frees it.
  upload_id uuid references public.uploads (id) on delete restrict,
  position integer not null check (position >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (layer_id, position),
  constraint traits_blank_or_image check (blank or upload_id is not null),
  constraint traits_capped_have_no_weight check (constant is null or weight = 0)
);

create index traits_collection_id_idx on public.traits (collection_id);
create index traits_layer_id_idx on public.traits (layer_id);
create index traits_upload_id_idx on public.traits (upload_id);
create unique index traits_one_blank_per_layer on public.traits (layer_id) where blank;

-- The layer and the image must belong to this project, and a layer holds at most 500 traits
-- (MASTER_PLAN, Art: storage limits).
create function public.traits_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.layers l where l.id = new.layer_id and l.collection_id = new.collection_id
  ) then
    raise exception 'The layer belongs to another project.' using errcode = 'check_violation';
  end if;
  if new.upload_id is not null and not exists (
    select 1 from public.uploads u
    where u.id = new.upload_id and u.collection_id = new.collection_id and u.kind = 'layer_image'
  ) then
    raise exception 'The image is not a layer image of this project.' using errcode = 'check_violation';
  end if;
  -- Only server code can change layer_id (it is not in the client grant); the branch still guards it.
  if tg_op = 'INSERT' or new.layer_id <> old.layer_id then
    -- Serialise inserts into one layer for this transaction, so two concurrent inserts at 499
    -- cannot both pass the count.
    perform pg_advisory_xact_lock(hashtextextended(new.layer_id::text, 0));
    if (select count(*) from public.traits t where t.layer_id = new.layer_id) >= 500 then
      raise exception 'A layer can have at most 500 traits.' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

create trigger traits_guard
before insert or update on public.traits
for each row execute function public.traits_guard();

alter table public.traits enable row level security;

create policy "traits: owner all" on public.traits for all to authenticated
using ((select private.collection_owned(collection_id)))
with check ((select private.collection_owned(collection_id)));

revoke all on public.traits from anon, authenticated;
grant select, insert, delete on public.traits to authenticated;
grant update (name, weight, constant, blank, in_metadata, upload_id, position) on public.traits to authenticated;

create trigger traits_set_updated_at
before update on public.traits
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- Rules
-- ---------------------------------------------------------------------------------------------
create table public.rules (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null references public.collections (id) on delete cascade,
  kind public.rule_kind not null,
  trait_id uuid not null references public.traits (id) on delete cascade,
  related_trait_ids uuid[] not null check (cardinality(related_trait_ids) >= 1),
  bidirectional boolean not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rules_direction_matches_kind check (bidirectional = (kind <> 'must_pair_with'))
);

create index rules_collection_id_idx on public.rules (collection_id);
create index rules_trait_id_idx on public.rules (trait_id);

-- The source trait is in this project; every related trait is in this project, all in one layer,
-- and that layer is in the source trait's art collection.
create function public.rules_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_source_art uuid;
  v_related_layers integer;
  v_related_found integer;
  v_related_art uuid;
begin
  select l.art_collection_id into v_source_art
  from public.traits t join public.layers l on l.id = t.layer_id
  where t.id = new.trait_id and t.collection_id = new.collection_id;
  if v_source_art is null then
    raise exception 'The rule''s trait belongs to another project.' using errcode = 'check_violation';
  end if;
  select count(*), count(distinct l.id), min(l.art_collection_id::text)::uuid
    into v_related_found, v_related_layers, v_related_art
  from public.traits t join public.layers l on l.id = t.layer_id
  where t.id = any(new.related_trait_ids) and t.collection_id = new.collection_id;
  if v_related_found <> cardinality(new.related_trait_ids) then
    raise exception 'A related trait belongs to another project.' using errcode = 'check_violation';
  end if;
  if v_related_layers <> 1 or v_related_art <> v_source_art then
    raise exception 'Related traits must all be in one layer of the same collection.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger rules_guard
before insert or update on public.rules
for each row execute function public.rules_guard();

alter table public.rules enable row level security;

create policy "rules: owner all" on public.rules for all to authenticated
using ((select private.collection_owned(collection_id)))
with check ((select private.collection_owned(collection_id)));

revoke all on public.rules from anon, authenticated;
grant select, insert, delete on public.rules to authenticated;
grant update (kind, trait_id, related_trait_ids, bidirectional) on public.rules to authenticated;

create trigger rules_set_updated_at
before update on public.rules
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- At-least-one constraints: every token of the art collection carries one of these traits
-- ---------------------------------------------------------------------------------------------
create table public.at_least_one (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null references public.collections (id) on delete cascade,
  art_collection_id uuid not null references public.art_collections (id) on delete cascade,
  trait_ids uuid[] not null check (cardinality(trait_ids) >= 2),
  created_at timestamptz not null default now()
);

create index at_least_one_collection_id_idx on public.at_least_one (collection_id);
create index at_least_one_art_collection_id_idx on public.at_least_one (art_collection_id);

create function public.at_least_one_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_found integer;
begin
  select count(*) into v_found
  from public.traits t join public.layers l on l.id = t.layer_id
  where t.id = any(new.trait_ids)
    and t.collection_id = new.collection_id
    and l.art_collection_id = new.art_collection_id;
  if v_found <> cardinality(new.trait_ids) then
    raise exception 'Every trait of the constraint must be in this collection.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger at_least_one_guard
before insert or update on public.at_least_one
for each row execute function public.at_least_one_guard();

alter table public.at_least_one enable row level security;

create policy "at_least_one: owner all" on public.at_least_one for all to authenticated
using ((select private.collection_owned(collection_id)))
with check ((select private.collection_owned(collection_id)));

revoke all on public.at_least_one from anon, authenticated;
grant select, insert, delete on public.at_least_one to authenticated;
grant update (trait_ids) on public.at_least_one to authenticated;
```

- [ ] **Step 4: Reset and run, expect pass**

Run: `supabase db reset 2>&1 | tail -3 && pnpm --filter @cobweb/web verify:local 2>&1 | grep -E '^(FAIL|[0-9]+ passed)'`
Expected: all pass. The 500-trait setup inserts 500 rows in one statement; if it takes more than a few seconds, the trigger's count is the cost and that is acceptable here.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261008010000_art_tables.sql apps/web/scripts/verify-local.ts
git commit -m "Add traits, rules and at-least-one constraints with their guards"
```

### Task 3: Tokens

**Files:**

- Modify: `supabase/migrations/20261008010000_art_tables.sql` (append)
- Modify: `apps/web/scripts/verify-local.ts` (section 9c)

**Interfaces:**

- Consumes: `art_collections`, `layers`, `traits`, `insertArtCollection`, `insertLayer`, `insertTrait`, `insertUploadRow`.
- Produces: table `public.tokens` (primary key deferrable, `dna` one-dimensional); trigger `public.tokens_guard_dna`; trigger `public.layers_guard_tokens` (refuses a layer insert, position change or delete while the art collection has tokens); `public.swap_token_ids_for_check(uuid, integer, integer)`, a security invoker function that swaps two ids in one statement (RLS applies).

- [ ] **Step 1: Write the failing checks**

Section 9c, called after `artTraitsAndRules`:

```ts
// ---------------------------------------------------------------------------------------------
// 9c. Tokens
// ---------------------------------------------------------------------------------------------
async function artTokens(A: Creator, B: Creator): Promise<void> {
  const col = await insertCollection(A.client)
  if (!col.row) throw new Error(`setup: ${describe(col.error)}`)
  const cid = col.row.id
  const art = await insertArtCollection(A.client, cid, { size: 4 })
  const uploadId = await insertUploadRow(A.client, cid)
  const bg = await insertLayer(A.client, cid, art.row!.id, { name: 'Background', position: 0 })
  const eyes = await insertLayer(A.client, cid, art.row!.id, { name: 'Eyes', position: 1 })
  const ink = (await insertTrait(A.client, cid, bg.row!.id, { name: 'Ink', upload_id: uploadId, position: 0 })).row!.id
  const wide = (await insertTrait(A.client, cid, eyes.row!.id, { name: 'Wide', upload_id: uploadId, position: 0 })).row!.id
  const none = (await insertTrait(A.client, cid, eyes.row!.id, { name: 'None', blank: true, position: 1 })).row!.id
  const token = (id: number, dna: string[]) => ({ collection_id: cid, token_id: id, art_collection_id: art.row!.id, dna })
  const DNA_MSG = 'Token DNA does not match the layers.'

  await check('tokens: A inserts tokens whose DNA matches the layers, a blank included', async () => {
    const { error } = await A.client.from('tokens').insert([token(1, [ink, wide]), token(2, [ink, none])])
    return error ? describe(error as DbError) : null
  })
  await check('tokens: a DNA of the wrong length is refused with the DNA message', async () => {
    const { data, error } = await A.client.from('tokens').insert(token(3, [ink])).select()
    const problem = expectError(error as DbError, CHECK, data)
    return problem ?? (error?.message.includes(DNA_MSG) ? null : `wrong message: ${error?.message}`)
  })
  await check('tokens: a trait in the wrong layer position is refused', async () => {
    const { data, error } = await A.client.from('tokens').insert(token(3, [wide, ink])).select()
    return expectError(error as DbError, CHECK, data)
  })
  await check('tokens: the same trait twice is refused', async () => {
    const { data, error } = await A.client.from('tokens').insert(token(3, [ink, ink])).select()
    return expectError(error as DbError, CHECK, data)
  })
  await check('tokens: a token id above 100,000 or below 1 is refused', async () => {
    const hi = await A.client.from('tokens').insert(token(100_001, [ink, wide])).select()
    const lo = await A.client.from('tokens').insert(token(0, [ink, wide])).select()
    return expectError(hi.error as DbError, CHECK, hi.data) ?? expectError(lo.error as DbError, CHECK, lo.data)
  })
  await check('tokens: A updates a DNA and the guard re-checks it', async () => {
    const ok = await A.client.from('tokens').update({ dna: [ink, none] }).eq('collection_id', cid).eq('token_id', 1).select()
    if (ok.error) return describe(ok.error as DbError)
    const { data, error } = await A.client.from('tokens').update({ dna: [none, ink] }).eq('collection_id', cid).eq('token_id', 1).select()
    return expectError(error as DbError, CHECK, data)
  })
  await check("tokens: B cannot read A's tokens", async () => {
    const { data, error } = await B.client.from('tokens').select().eq('collection_id', cid)
    return expectNothing(error, data)
  })
  await check('layers: a position change is refused while the art collection has tokens', async () => {
    const { data, error } = await A.client.from('layers').update({ position: 5 }).eq('id', eyes.row!.id).select()
    return expectError(error as DbError, CHECK, data)
  })
  await check('layers: adding a layer is refused while the art collection has tokens', async () => {
    const { error, row } = await insertLayer(A.client, cid, art.row!.id, { name: 'Late', position: 7 })
    return expectError(error, CHECK, row ? [row] : null)
  })
  await check('tokens: two ids swap in one statement under the deferrable key', async () => {
    // Give token 2 a DNA that differs from token 1 ([ink, none] after the update check above).
    const setup = await A.client.from('tokens').update({ dna: [ink, wide] }).eq('collection_id', cid).eq('token_id', 2)
    if (setup.error) return `setup: ${describe(setup.error as DbError)}`
    const { error } = await A.client.rpc('swap_token_ids_for_check', { p_collection_id: cid, p_a: 1, p_b: 2 })
    if (error) return describe(error as DbError)
    const { data } = await admin.from('tokens').select('token_id, dna').eq('collection_id', cid).in('token_id', [1, 2]).order('token_id')
    const rows = (data ?? []) as { token_id: number; dna: string[] }[]
    return rows[0]?.dna[1] === wide && rows[1]?.dna[1] === none ? null : `ids did not swap: ${JSON.stringify(rows)}`
  })
  await check('layers: a rename is still allowed while tokens exist', async () => {
    const { error } = await A.client.from('layers').update({ name: 'Eyes 2' }).eq('id', eyes.row!.id)
    return error ? describe(error as DbError) : null
  })
  await check('layers: deleting a layer is refused while the art collection has tokens', async () => {
    const { data, error } = await A.client.from('layers').delete().eq('id', eyes.row!.id).select()
    return expectError(error as DbError, CHECK, data)
  })
  await check('art_collections: deleting one removes its tokens by cascade', async () => {
    const second = await insertArtCollection(A.client, cid, { name: 'Owlets', position: 1, size: 1 })
    const layer = await insertLayer(A.client, cid, second.row!.id, { name: 'Body', position: 0 })
    const barn = (await insertTrait(A.client, cid, layer.row!.id, { name: 'Barn', upload_id: uploadId, position: 0 })).row!.id
    const ins = await A.client.from('tokens').insert({ collection_id: cid, token_id: 3, art_collection_id: second.row!.id, dna: [barn] })
    if (ins.error) return `setup: ${describe(ins.error as DbError)}`
    const del = await A.client.from('art_collections').delete().eq('id', second.row!.id)
    if (del.error) return describe(del.error as DbError)
    const { data } = await admin.from('tokens').select('token_id').eq('collection_id', cid).eq('token_id', 3)
    // Ids are not renumbered here: that is the server action's job, with the engine's deleteTokens.
    return data && data.length === 0 ? null : 'token 3 survived its art collection'
  })
}
```

- [ ] **Step 2: Run, expect failure**

Run: `pnpm --filter @cobweb/web verify:local 2>&1 | grep -E '^(FAIL|[0-9]+ passed)'`
Expected: FAIL on every 9c check (`relation "public.tokens" does not exist`; the two `layers` checks fail because the update and delete are accepted).

- [ ] **Step 3: Append the migration**

```sql
-- ---------------------------------------------------------------------------------------------
-- Tokens: the generated and curated set, one row per token. Names and ranks are computed, never stored.
-- ---------------------------------------------------------------------------------------------
create table public.tokens (
  collection_id uuid not null references public.collections (id) on delete cascade,
  token_id integer not null check (token_id between 1 and 100000),
  art_collection_id uuid not null references public.art_collections (id) on delete cascade,
  -- One trait per layer of the art collection, bottom layer first. One dimension only: a nested
  -- array would flatten through unnest and store wrong.
  dna uuid[] not null check (array_ndims(dna) = 1),
  -- A token's own description after an edit; null means the project's token_description applies.
  description text check (description is null or char_length(description) <= 500),
  updated_at timestamptz not null default now(),
  -- Deferrable, so a swap or a renumbering after a delete can run as one statement or one
  -- transaction without tripping over itself row by row.
  primary key (collection_id, token_id) deferrable initially immediate
);

create index tokens_art_collection_id_idx on public.tokens (art_collection_id);

-- The DNA must name exactly one trait of each layer of the art collection, in layer order
-- (layers ordered by position; the position values need not be contiguous).
create function public.tokens_guard_dna()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_layers integer;
  v_bad integer;
begin
  if not exists (
    select 1 from public.art_collections a
    where a.id = new.art_collection_id and a.collection_id = new.collection_id
  ) then
    raise exception 'The art collection belongs to another project.' using errcode = 'check_violation';
  end if;
  select count(*) into v_layers from public.layers l where l.art_collection_id = new.art_collection_id;
  if cardinality(new.dna) <> v_layers then
    raise exception 'Token DNA does not match the layers.' using errcode = 'check_violation';
  end if;
  with ordered as (
    select l.id, row_number() over (order by l.position) as pos
    from public.layers l where l.art_collection_id = new.art_collection_id
  ),
  entries as (
    select d.trait_id, d.pos from unnest(new.dna) with ordinality as d (trait_id, pos)
  )
  select count(*) into v_bad
  from entries e
  left join ordered o on o.pos = e.pos
  left join public.traits t on t.id = e.trait_id and t.layer_id = o.id
  where t.id is null;
  if v_bad > 0 then
    raise exception 'Token DNA does not match the layers.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger tokens_guard_dna
before insert or update on public.tokens
for each row execute function public.tokens_guard_dna();

alter table public.tokens enable row level security;

create policy "tokens: owner all" on public.tokens for all to authenticated
using ((select private.collection_owned(collection_id)))
with check ((select private.collection_owned(collection_id)));

revoke all on public.tokens from anon, authenticated;
grant select, insert, delete on public.tokens to authenticated;
-- token_id stays updatable: swaps and renumbering after a delete change it.
grant update (token_id, dna, description) on public.tokens to authenticated;

create trigger tokens_set_updated_at
before update on public.tokens
for each row execute function public.set_updated_at();

-- Stored DNA is positional, so the layer stack cannot change shape under it: while an art
-- collection has tokens, its layers are not added, reordered or deleted. The server action that
-- changes the stack remaps or clears the tokens first, as the browser store does.
create function public.layers_guard_tokens()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_art uuid := case when tg_op = 'INSERT' then new.art_collection_id else old.art_collection_id end;
begin
  -- A cascaded delete (the art collection or the project going away) takes the tokens with it;
  -- only a direct layer delete, an insert or a reorder is refused while tokens exist.
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  if tg_op = 'UPDATE' and new.position = old.position and new.art_collection_id = old.art_collection_id then
    return new;
  end if;
  if exists (select 1 from public.tokens t where t.art_collection_id = v_art) then
    raise exception 'The layers cannot be added, reordered or removed while the collection has tokens. Clear the tokens first.'
      using errcode = 'check_violation';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger layers_guard_tokens
before insert or update or delete on public.layers
for each row execute function public.layers_guard_tokens();

-- Swaps two token ids of the caller's collection in one statement. The deferrable key makes this
-- possible; the Generate screen's swap will call a function of this shape (screen wiring sub-project).
create function public.swap_token_ids_for_check(p_collection_id uuid, p_a integer, p_b integer)
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.tokens t
  set token_id = case when t.token_id = p_a then p_b else p_a end
  where t.collection_id = p_collection_id and t.token_id in (p_a, p_b);
$$;

revoke all on function public.swap_token_ids_for_check(uuid, integer, integer) from public, anon;
grant execute on function public.swap_token_ids_for_check(uuid, integer, integer) to authenticated;
```

`layers_guard_tokens` runs as the caller and reads `tokens` under the owner's policy, so it sees the owner's own tokens. Postgres fires row triggers on cascaded deletes too, which is why the function steps aside when `pg_trigger_depth()` is above one: deleting an art collection cascades to its layers and tokens without being refused.

- [ ] **Step 4: Reset and run, expect pass**

Run: `supabase db reset 2>&1 | tail -3 && pnpm --filter @cobweb/web verify:local 2>&1 | grep -E '^(FAIL|[0-9]+ passed)'`
Expected: all pass, including "art_collections: deleting one removes its tokens by cascade". If that one fails with the layers message, the `pg_trigger_depth()` skip is missing or in the wrong place.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261008010000_art_tables.sql apps/web/scripts/verify-local.ts
git commit -m "Add tokens with the DNA guard and freeze layer positions while tokens exist"
```

### Task 4: Render jobs, batches, and the lock gate

**Files:**

- Modify: `supabase/migrations/20261008010000_art_tables.sql` (append)
- Modify: `apps/web/scripts/verify-local.ts` (section 9d; cleanup step)

**Interfaces:**

- Consumes: everything above.
- Produces: tables `public.render_jobs`, `public.render_batches`; function `public.art_guard_lock()` on the seven art tables; `public.collections_guard_frozen_fields` extended for `art_locked_at`, `token_name`, `show_blank_traits`, `generation_seed`.

- [ ] **Step 1: Write the failing checks**

Section 9d, called after `artTokens`:

```ts
// ---------------------------------------------------------------------------------------------
// 9d. Render jobs and the lock gate
// ---------------------------------------------------------------------------------------------
const createdJobIds = new Set<string>()

async function artLockAndJobs(A: Creator, B: Creator): Promise<void> {
  const col = await insertCollection(A.client)
  if (!col.row) throw new Error(`setup: ${describe(col.error)}`)
  const cid = col.row.id
  const art = await insertArtCollection(A.client, cid, { size: 1 })
  const uploadId = await insertUploadRow(A.client, cid)
  const layer = await insertLayer(A.client, cid, art.row!.id)
  const trait = (await insertTrait(A.client, cid, layer.row!.id, { upload_id: uploadId })).row!.id
  const tok = await A.client.from('tokens').insert({ collection_id: cid, token_id: 1, art_collection_id: art.row!.id, dna: [trait] })
  if (tok.error) throw new Error(`setup: ${describe(tok.error as DbError)}`)
  const jobInput = {
    collection_id: cid,
    kind: 'real',
    state: 'locked',
    token_count: 1,
    token_list_hash: `0x${HEX64(7)}`,
    fee_per_token_wei: '0',
    quote_total_wei: '0',
  }

  await check('render_jobs: A cannot insert a job', async () => {
    const { data, error } = await A.client.from('render_jobs').insert(jobInput).select()
    return expectError(error as DbError, PERMISSION, data)
  })
  let jobId = ''
  await check('render_jobs: the service role inserts a job and A reads it', async () => {
    const { data, error } = await admin.from('render_jobs').insert(jobInput).select().single()
    if (error || !data) return describe(error as DbError)
    jobId = (data as { id: string }).id
    createdJobIds.add(jobId)
    const mine = await A.client.from('render_jobs').select('id').eq('id', jobId)
    return mine.data?.length === 1 ? null : `A sees ${mine.data?.length ?? 0} rows`
  })
  await check("render_jobs: B cannot read A's job; A cannot update or delete it", async () => {
    const read = await B.client.from('render_jobs').select().eq('id', jobId)
    const upd = await A.client.from('render_jobs').update({ state: 'paid' }).eq('id', jobId).select()
    const del = await A.client.from('render_jobs').delete().eq('id', jobId).select()
    return expectNothing(read.error, read.data) ?? expectError(upd.error as DbError, PERMISSION, upd.data) ?? expectError(del.error as DbError, PERMISSION, del.data)
  })
  await check('render_jobs: a second open job of the same kind is refused', async () => {
    const { data, error } = await admin.from('render_jobs').insert(jobInput).select()
    return expectError(error as DbError, UNIQUE, data)
  })
  await check('render_jobs: a placeholder job needs its upload; a paid state needs a payment or a zero quote', async () => {
    const noUpload = await admin.from('render_jobs').insert({ ...jobInput, kind: 'placeholder' }).select()
    const unpaid = await admin
      .from('render_jobs')
      .insert({ ...jobInput, kind: 'placeholder', placeholder_upload_id: uploadId, state: 'rendering', quote_total_wei: '5' })
      .select()
    return expectError(noUpload.error as DbError, CHECK, noUpload.data) ?? expectError(unpaid.error as DbError, CHECK, unpaid.data)
  })
  await check('render_batches: the service role inserts one, A reads it, B cannot', async () => {
    const ins = await admin.from('render_batches').insert({ job_id: jobId, index: 0, state: 'queued', first_token_id: 1, last_token_id: 1 })
    if (ins.error) return describe(ins.error as DbError)
    const mine = await A.client.from('render_batches').select('index').eq('job_id', jobId)
    const theirs = await B.client.from('render_batches').select('index').eq('job_id', jobId)
    return (mine.data?.length === 1 ? null : `A sees ${mine.data?.length ?? 0}`) ?? expectNothing(theirs.error, theirs.data)
  })

  await check('lock: the service role sets art_locked_at', async () => {
    const { error } = await admin.from('collections').update({ art_locked_at: new Date().toISOString() }).eq('id', cid)
    return error ? describe(error) : null
  })
  const LOCKED = ['42501']
  const tables: [string, Record<string, unknown>, Record<string, unknown>][] = [
    ['art_collections', { collection_id: cid, name: 'Late', size: 0, position: 9 }, { name: 'Renamed' }],
    ['layers', { collection_id: cid, art_collection_id: art.row!.id, name: 'Late', position: 9 }, { name: 'Renamed' }],
    ['traits', { collection_id: cid, layer_id: layer.row!.id, name: 'Late', weight: 0, blank: true, position: 9 }, { name: 'Renamed' }],
    ['rules', { collection_id: cid, kind: 'doesnt_mix_with', trait_id: trait, related_trait_ids: [trait], bidirectional: true }, { bidirectional: true }],
    ['at_least_one', { collection_id: cid, art_collection_id: art.row!.id, trait_ids: [trait, trait] }, { trait_ids: [trait, trait] }],
    ['tokens', { collection_id: cid, token_id: 2, art_collection_id: art.row!.id, dna: [trait] }, { description: 'late' }],
    ['uploads', uploadInput(cid), { file_name: 'late.png' }],
  ]
  for (const [table, insert, update] of tables) {
    await check(`lock: ${table} refuses insert, update and delete once the art is locked`, async () => {
      const ins = await A.client.from(table).insert(insert).select()
      const upd = await A.client.from(table).update(update).eq('collection_id', cid).select()
      const del = await A.client.from(table).delete().eq('collection_id', cid).select()
      return expectError(ins.error as DbError, LOCKED, ins.data) ?? expectError(upd.error as DbError, LOCKED, upd.data) ?? expectError(del.error as DbError, LOCKED, del.data)
    })
  }
  await check('lock: record_upload refuses once the art is locked', async () => {
    const { id, error } = await recordUpload(A.client, cid)
    return expectError(error, LOCKED, id ? [id] : null)
  })
  await check('lock: A still reads every art row', async () => {
    for (const table of ['art_collections', 'layers', 'traits', 'tokens', 'uploads']) {
      const { data, error } = await A.client.from(table).select('collection_id').eq('collection_id', cid)
      if (error) return `${table}: ${describe(error)}`
      if (!data?.length) return `${table}: no rows`
    }
    return null
  })
  await check('lock: token_name cannot change after the lock; token_description still can', async () => {
    const name = await A.client.from('collections').update({ token_name: 'Late Owls' }).eq('id', cid).select()
    const desc = await A.client.from('collections').update({ token_description: 'A late note.' }).eq('id', cid).select()
    return expectError(name.error, CHECK, name.data) ?? (desc.error ? describe(desc.error) : null)
  })
  await check('lock: A cannot clear art_locked_at', async () => {
    const { data, error } = await A.client.from('collections').update({ art_locked_at: null }).eq('id', cid).select()
    return expectError(error, PERMISSION, data)
  })
}
```

In `cleanup()`, before the collections delete, add:

```ts
  await check('cleanup: delete render jobs created by this run', async () => {
    if (createdJobIds.size === 0) return null
    const { error } = await admin.from('render_jobs').delete().in('id', [...createdJobIds])
    return error ? describe(error) : null
  })
```

Note the `rules` and `at_least_one` insert payloads above are deliberately invalid in content (a trait paired with itself; a two-entry constraint of one trait) so the lock refusal, not content validity, is what the check sees. The lock trigger must run before the content triggers: name it so it sorts first (`a_art_guard_lock`), since Postgres fires same-event triggers in name order.

- [ ] **Step 2: Run, expect failure**

Run: `pnpm --filter @cobweb/web verify:local 2>&1 | grep -E '^(FAIL|[0-9]+ passed)'`
Expected: FAIL on the render checks (`relation "public.render_jobs" does not exist`) and on every lock check (writes accepted, `token_name` change accepted, `art_locked_at` update refused by the existing grant only).

- [ ] **Step 3: Append the migration**

```sql
-- ---------------------------------------------------------------------------------------------
-- Render jobs: created at lock, paid or waived, rendered. Clients read; server code writes.
-- ---------------------------------------------------------------------------------------------
create table public.render_jobs (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null references public.collections (id) on delete restrict,
  kind public.render_kind not null,
  state public.render_state not null default 'locked',
  token_count integer not null check (token_count >= 0),
  token_list_hash text check (token_list_hash is null or token_list_hash ~ '^0x[0-9a-f]{64}$'),
  allow_duplicates boolean not null default false,
  fee_per_token_wei numeric(78, 0) not null check (fee_per_token_wei >= 0),
  quote_total_wei numeric(78, 0) not null check (quote_total_wei >= 0),
  quote_chain_id integer,
  quote_payer text check (quote_payer is null or quote_payer ~ '^0x[0-9a-f]{40}$'),
  quote_expires_at timestamptz,
  payment_tx_hash text check (payment_tx_hash is null or payment_tx_hash ~ '^0x[0-9a-f]{64}$'),
  paid_at timestamptz,
  paid_amount_wei numeric(78, 0) check (paid_amount_wei is null or paid_amount_wei >= 0),
  waived_by uuid references auth.users (id) on delete set null,
  waived_reason text,
  batch_size integer not null default 100 check (batch_size between 1 and 1000),
  batches_total integer not null default 0 check (batches_total >= 0),
  batches_done integer not null default 0 check (batches_done >= 0),
  images_cid text,
  metadata_cid text,
  placeholder_upload_id uuid references public.uploads (id) on delete restrict,
  error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint render_jobs_batches_done_within_total check (batches_done <= batches_total),
  constraint render_jobs_placeholder_has_upload check (kind <> 'placeholder' or placeholder_upload_id is not null),
  constraint render_jobs_waiver_complete check ((waived_by is null) = (waived_reason is null)),
  -- Never render unpaid: a job past payment_due was paid, waived, or quoted at zero (the placeholder fee).
  constraint render_jobs_render_only_when_paid check (
    state in ('locked', 'payment_due', 'failed')
    or payment_tx_hash is not null or waived_by is not null or quote_total_wei = 0
  ),
  constraint render_jobs_done_has_metadata check (state <> 'done' or metadata_cid is not null)
);

create index render_jobs_collection_id_idx on public.render_jobs (collection_id);
create unique index render_jobs_one_open_per_kind on public.render_jobs (collection_id, kind)
  where state not in ('done', 'failed');

alter table public.render_jobs enable row level security;

create policy "render_jobs: owner reads" on public.render_jobs for select to authenticated
using ((select private.collection_owned(collection_id)));

revoke all on public.render_jobs from anon, authenticated;
grant select on public.render_jobs to authenticated;

create trigger render_jobs_set_updated_at
before update on public.render_jobs
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- Render batches
-- ---------------------------------------------------------------------------------------------
create table public.render_batches (
  job_id uuid not null references public.render_jobs (id) on delete cascade,
  index integer not null check (index >= 0),
  state public.batch_state not null default 'queued',
  attempts integer not null default 0 check (attempts >= 0),
  first_token_id integer not null check (first_token_id >= 1),
  last_token_id integer not null check (last_token_id >= first_token_id),
  images_cid text,
  error text,
  updated_at timestamptz not null default now(),
  primary key (job_id, index)
);

alter table public.render_batches enable row level security;

-- Ownership through the job's collection. The subquery is one indexed lookup per statement.
create policy "render_batches: owner reads" on public.render_batches for select to authenticated
using (
  exists (
    select 1 from public.render_jobs j
    where j.id = job_id and (select private.collection_owned(j.collection_id))
  )
);

revoke all on public.render_batches from anon, authenticated;
grant select on public.render_batches to authenticated;

create trigger render_batches_set_updated_at
before update on public.render_batches
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- The lock gate: once the real set is locked, a client role changes no art row
-- ---------------------------------------------------------------------------------------------
create function public.art_guard_lock()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_collection uuid;
begin
  if current_user not in ('anon', 'authenticated') then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  -- Both the row's current project and (on an update) the one it came from: neither may be locked.
  v_collection := case when tg_op = 'DELETE' then old.collection_id else new.collection_id end;
  if exists (select 1 from public.collections c where c.id = v_collection and c.art_locked_at is not null)
    or (tg_op = 'UPDATE' and exists (
      select 1 from public.collections c where c.id = old.collection_id and c.art_locked_at is not null
    ))
  then
    raise exception 'The art is locked and cannot change.' using errcode = 'insufficient_privilege';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

-- Named to sort first, so the lock is checked before any content guard.
create trigger a_art_guard_lock before insert or update or delete on public.art_collections
for each row execute function public.art_guard_lock();
create trigger a_art_guard_lock before insert or update or delete on public.layers
for each row execute function public.art_guard_lock();
create trigger a_art_guard_lock before insert or update or delete on public.traits
for each row execute function public.art_guard_lock();
create trigger a_art_guard_lock before insert or update or delete on public.rules
for each row execute function public.art_guard_lock();
create trigger a_art_guard_lock before insert or update or delete on public.at_least_one
for each row execute function public.art_guard_lock();
create trigger a_art_guard_lock before insert or update or delete on public.tokens
for each row execute function public.art_guard_lock();
create trigger a_art_guard_lock before insert or update or delete on public.uploads
for each row execute function public.art_guard_lock();

-- ---------------------------------------------------------------------------------------------
-- Collections: the frozen-field guard learns about the art lock
-- ---------------------------------------------------------------------------------------------
create or replace function public.collections_guard_frozen_fields()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.status <> 'draft' and (
    new.max_supply is distinct from old.max_supply
    or new.project_type is distinct from old.project_type
  ) then
    raise exception 'The token count and type cannot change after the art is locked.'
      using errcode = 'check_violation';
  end if;
  if old.status = 'deployed' and (new.name <> old.name or new.symbol <> old.symbol) then
    raise exception 'The name and symbol cannot change after deployment.'
      using errcode = 'check_violation';
  end if;
  if new.slug is distinct from old.slug and current_user in ('anon', 'authenticated') then
    raise exception 'The mint page link can only be set by reserving it.'
      using errcode = 'insufficient_privilege';
  end if;
  if old.status <> 'deployed' and new.status = 'deployed'
    and new.slug is not null and new.slug_reserved_at < now() - interval '3 days' then
    new.slug = null;
    new.slug_reserved_at = null;
  end if;
  -- The art lock (docs/specs/2026-10-08-art-tables.md): set only by server code; once set, what
  -- was locked and paid for does not change.
  if new.art_locked_at is distinct from old.art_locked_at and current_user in ('anon', 'authenticated') then
    raise exception 'The art lock is set when the art is locked.' using errcode = 'insufficient_privilege';
  end if;
  if old.art_locked_at is not null and (
    new.token_name is distinct from old.token_name
    or new.show_blank_traits <> old.show_blank_traits
    or new.generation_seed is distinct from old.generation_seed
  ) then
    raise exception 'The token name, blank traits option and seed cannot change after the art is locked.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
```

`art_locked_at` is not in the creator's update grant (Task 1 listed the granted columns without it), so a client write fails on the grant with 42501 before the trigger; the trigger is the second line of defence, as for `slug`.

- [ ] **Step 4: Reset and run, expect pass**

Run: `supabase db reset 2>&1 | tail -3 && pnpm --filter @cobweb/web verify:local 2>&1 | grep -E '^(FAIL|[0-9]+ passed)'`
Expected: all pass, including every `lock:` line and the new cleanup step; the final line reads `N passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261008010000_art_tables.sql apps/web/scripts/verify-local.ts
git commit -m "Add render jobs and batches, and lock the art tables once the real set is locked"
```

### Task 5: Types, invariants, timing and documents

**Files:**

- Modify: `apps/web/src/lib/database.types.ts` (regenerated)
- Modify: `apps/web/scripts/verify-local.ts` (section 9e: policy and grant invariants, 10,000-row timing)
- Modify: `docs/MASTER_PLAN.md`, `docs/specs/2026-10-03-creator-flow-ui.md`, `docs/specs/2026-10-08-art-tables.md`

- [ ] **Step 1: Write the failing invariant checks**

Section 9e, called after `artLockAndJobs`. It needs a service-role SQL helper: add an RPC-free query through `admin` using PostgREST on `pg_catalog` is not possible, so add a tiny `security definer` function in the migration that returns the facts (Step 3) and call it here:

```ts
// ---------------------------------------------------------------------------------------------
// 9e. Schema invariants and a timing check
// ---------------------------------------------------------------------------------------------
const ART_TABLES = ['art_collections', 'layers', 'traits', 'rules', 'at_least_one', 'tokens', 'uploads', 'render_jobs', 'render_batches']

async function artInvariants(A: Creator): Promise<void> {
  await check('schema: every art table has RLS, an owner policy, and no grant to anon', async () => {
    const { data, error } = await admin.rpc('art_table_facts')
    if (error) return describe(error as DbError)
    const facts = data as { table_name: string; rls: boolean; policies: number; anon_grants: number }[]
    const problems: string[] = []
    for (const table of ART_TABLES) {
      const f = facts.find((row) => row.table_name === table)
      if (!f) problems.push(`${table}: missing`)
      else if (!f.rls || f.policies < 1 || f.anon_grants > 0) problems.push(`${table}: rls ${f.rls}, policies ${f.policies}, anon grants ${f.anon_grants}`)
    }
    return problems.length ? problems.join('; ') : null
  })

  await check('tokens: 10,000 rows insert in one statement in under five seconds', async () => {
    const col = await insertCollection(A.client)
    if (!col.row) return `setup: ${describe(col.error)}`
    const cid = col.row.id
    const art = await insertArtCollection(A.client, cid, { size: 10_000 })
    const uploadId = await insertUploadRow(A.client, cid)
    const layer = await insertLayer(A.client, cid, art.row!.id)
    const traits: string[] = []
    for (let i = 0; i < 4; i++)
      traits.push((await insertTrait(A.client, cid, layer.row!.id, { name: `T${i}`, upload_id: uploadId, position: i, weight: 25 })).row!.id)
    const rows = Array.from({ length: 10_000 }, (_, i) => ({
      collection_id: cid,
      token_id: i + 1,
      art_collection_id: art.row!.id,
      dna: [traits[i % 4]!],
    }))
    const started = Date.now()
    const { error } = await A.client.from('tokens').insert(rows)
    const ms = Date.now() - started
    if (error) return describe(error as DbError)
    info(`10,000 tokens inserted in ${ms} ms`)
    return ms < 5000 ? null : `took ${ms} ms`
  })
}
```

- [ ] **Step 2: Run, expect failure**

Run: `pnpm --filter @cobweb/web verify:local 2>&1 | grep -E '^(FAIL|INFO|[0-9]+ passed)'`
Expected: the schema check FAILs (`function public.art_table_facts() does not exist`); the timing check runs and passes or fails on time (note the INFO line either way).

- [ ] **Step 3: Append the facts function to the migration**

```sql
-- ---------------------------------------------------------------------------------------------
-- Schema facts for the access checks: RLS on, policy count, grants to anon, per art table.
-- Service role only.
-- ---------------------------------------------------------------------------------------------
create function public.art_table_facts()
returns table (table_name text, rls boolean, policies integer, anon_grants integer)
language sql
security definer
set search_path = ''
stable
as $$
  select c.relname::text,
    c.relrowsecurity,
    (select count(*)::integer from pg_catalog.pg_policy p where p.polrelid = c.oid),
    (select count(*)::integer from information_schema.role_table_grants g
      where g.table_schema = 'public' and g.table_name = c.relname and g.grantee = 'anon')
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
    and c.relname in ('art_collections', 'layers', 'traits', 'rules', 'at_least_one', 'tokens', 'uploads', 'render_jobs', 'render_batches');
$$;

revoke all on function public.art_table_facts() from public, anon, authenticated;
```

- [ ] **Step 4: Reset, run, regenerate types, root checks**

Run:

```bash
supabase db reset 2>&1 | tail -3
pnpm --filter @cobweb/web verify:local 2>&1 | grep -E '^(FAIL|INFO|[0-9]+ passed)'
supabase gen types typescript --local > apps/web/src/lib/database.types.ts
pnpm exec prettier --write apps/web/src/lib/database.types.ts
pnpm typecheck && pnpm lint && pnpm test
```

Expected: every check passes with `0 failed`; the types file now contains `art_collections`, `layers`, `traits`, `rules`, `at_least_one`, `tokens`, `uploads`, `render_jobs`, `render_batches`, the new enums and the new `collections` columns; root typecheck, lint and tests pass (6 tasks each). If `gen types` warns about the `private` schema, that is expected: it generates `public` only.

- [ ] **Step 5: Documents**

- `docs/MASTER_PLAN.md`, Phase 3 status: append to the existing sentence, keeping it: "The art tables (second sub-project) landed on <today's date in words>; see [specs/2026-10-08-art-tables.md](specs/2026-10-08-art-tables.md). Next: layer and asset upload."
- `docs/specs/2026-10-03-creator-flow-ui.md`, section 5, Phase 3 row: after "`@cobweb/dna` types and analyser (done);" add "the art tables `art_collections`, `layers`, `traits`, `rules`, `at_least_one`, `tokens`, `uploads` (done);" before the token list clause.
- `docs/specs/2026-10-08-art-tables.md`, section 8: tick each line you verified, adding the INFO timing in words on the timing line, for example "(1,240 ms locally, <date>)".
- Prettier on all three.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/database.types.ts apps/web/scripts/verify-local.ts supabase/migrations/20261008010000_art_tables.sql docs
git commit -m "Regenerate the database types, prove the art tables' access invariants, and record the sub-project"
```
