-- Review round 1 (docs/specs/2026-10-03-creator-flow-ui.md, section 9):
--   1. The Metadata project type is removed. Postgres cannot drop an enum value, so the type is
--      rebuilt without it and the column is cast across.
--   2. A collection is created without a supply. `max_supply` is set later: at Generate for a
--      generative project (the sum of its collection sizes), from the uploads for 1/1s (files
--      times editions), and on the asset screen for a single asset (its quantity). A creator can
--      change it only while the collection is a draft, and it must be set before the art locks.
--   3. A deployed collection may change its mint page link, through `reserve_slug` only (the
--      Manage screen warns that shared links break). Direct writes from a client stay refused, and
--      a deployed collection's link is still never taken over by another collection.

-- ---------------------------------------------------------------------------------------------
-- 1. project_type without 'metadata'
-- ---------------------------------------------------------------------------------------------
-- No collection can be left on the removed value. There are none before launch; stop loudly
-- rather than guess what such a row should become.
do $$
begin
  if exists (select 1 from public.collections where project_type = 'metadata') then
    raise exception 'Collections with project_type metadata exist. Move them to another type first.';
  end if;
end;
$$;

alter type public.project_type rename to project_type_old;
create type public.project_type as enum ('generative', 'one_of_one', 'single_asset');

-- The cap names the type in its expression, so it is dropped across the cast and added back.
alter table public.collections drop constraint single_asset_supply_cap;
alter table public.collections
  alter column project_type type public.project_type using project_type::text::public.project_type;
drop type public.project_type_old;

-- ---------------------------------------------------------------------------------------------
-- 2. max_supply: empty at creation, set while a draft
-- ---------------------------------------------------------------------------------------------
-- The range check (1 to 100,000) and the single-asset cap (4,000) still apply whenever it is set;
-- a null passes both.
alter table public.collections alter column max_supply drop not null;
alter table public.collections
  add constraint single_asset_supply_cap check (project_type <> 'single_asset' or max_supply <= 4000);

-- Locking the art fixes the token count, so a collection past draft always has one.
alter table public.collections
  add constraint supply_set_after_draft check (status = 'draft' or max_supply is not null);

-- The frozen-field guard compares with `is distinct from`, so setting the supply from null counts as
-- a change: allowed while the status is draft, refused after (for every role). Name and symbol stay
-- fixed after deploy. The link is no longer fixed after deploy (section 3): it can change through
-- `reserve_slug`, which runs as its owner, while a client role writing it directly is refused.
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
  return new;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 3. Changing the mint page link of a deployed collection
-- ---------------------------------------------------------------------------------------------
-- As in 20261003062736_mint_page_address_reservation, except:
--   - a deployed collection that already has a link may change it (no more P0001). Its old link is
--     free at once; the creator was warned that shared links break.
--   - a deployed collection's link does not lapse: `slug_reserved_at` is null, and the release of
--     lapsed links still skips deployed collections, so another collection can never take it over
--     (the unique index raises 23505).
create or replace function private.reserve_slug(p_collection_id uuid, p_slug text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_owner uuid;
  v_status public.collection_status;
begin
  if v_uid is null or not exists (select 1 from public.profiles p where p.id = v_uid) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  select c.owner_id, c.status into v_owner, v_status
  from public.collections c
  where c.id = p_collection_id
  for update;
  if not found or v_owner <> v_uid then
    raise exception 'collection not found' using errcode = '42501';
  end if;

  if p_slug is null
    or p_slug !~ '^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$'
    or p_slug in ('collections', 'api', 'admin', 'create', 'assets', 'auth', 'help', 'docs', 'terms', 'privacy')
  then
    raise exception 'invalid mint page link' using errcode = '23514';
  end if;

  update public.collections c
  set slug = null, slug_reserved_at = null
  where c.slug = p_slug
    and c.id <> p_collection_id
    and c.status <> 'deployed'
    and c.slug_reserved_at < now() - interval '3 days';

  update public.collections c
  set slug = p_slug,
      slug_reserved_at = case when v_status = 'deployed' then null else now() end
  where c.id = p_collection_id;
end;
$$;
