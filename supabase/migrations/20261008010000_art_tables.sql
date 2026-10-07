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
  -- The waiver columns are checked as a pair, so a set null would trip the check when an admin
  -- account is deleted. Restrict instead: a waiving admin cannot be deleted.
  waived_by uuid references auth.users (id) on delete restrict,
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
  v_locked timestamptz;
begin
  if current_user not in ('anon', 'authenticated') then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  -- Both the row's current project and (on an update) the one it came from: neither may be locked.
  -- The collection row is read FOR SHARE, so a client write in flight holds the row until it
  -- commits and the server's lock update (which needs a stronger lock on that row) waits for it;
  -- once the lock is set, every later write sees it. No write can slip past the lock in a race.
  foreach v_collection in array (
    case
      when tg_op = 'DELETE' then array[old.collection_id]
      when tg_op = 'UPDATE' and old.collection_id <> new.collection_id then array[new.collection_id, old.collection_id]
      else array[new.collection_id]
    end
  ) loop
    select c.art_locked_at into v_locked from public.collections c where c.id = v_collection for share;
    if v_locked is not null then
      raise exception 'The art is locked and cannot change.' using errcode = 'insufficient_privilege';
    end if;
  end loop;
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
