-- Mint page address reservation (decision D24, spec S12).
--
-- No mint page without a contract. The address (`collections.slug`) is no longer chosen when a
-- collection is created. The creator reserves it in the Deploy form; a reservation lasts 3 days
-- and lapses if the contract is not deployed by then, after which anyone may take the address.
-- Deploying makes it permanent and it never changes again. A deployed collection without an
-- address sets one later, in Manage drop, and it is permanent at once.
--
-- Every write of `slug` goes through `private.reserve_slug`, reached by clients through the thin
-- `public.reserve_slug` wrapper. The `authenticated` role can no longer write the column directly.

-- ---------------------------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------------------------
-- The format and reserved-word check and the unique index stay. Null passes the check, and the
-- unique index allows any number of nulls.
alter table public.collections alter column slug drop not null;

-- When the current reservation was made. Meaningful only while the collection is not deployed.
alter table public.collections add column slug_reserved_at timestamptz;

-- ---------------------------------------------------------------------------------------------
-- Grants: slug leaves the creator-writable columns
-- ---------------------------------------------------------------------------------------------
revoke insert, update on public.collections from authenticated;
grant insert (name, symbol, description, project_type, max_supply) on public.collections to authenticated;
grant update (name, symbol, description, max_supply) on public.collections to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Frozen fields
-- ---------------------------------------------------------------------------------------------
-- Once deployed, the name and symbol are fixed, and so is the address once there is one. A
-- deployed collection without an address may get one (through `reserve_slug`), never change it.
-- The address is written only by `reserve_slug` (or trusted server code): a direct change from a
-- client role is refused even if a grant were ever widened by mistake.
-- A reservation that lapsed before the collection is deployed is released at deploy, so a lapsed
-- address never becomes permanent by accident.
create or replace function public.collections_guard_frozen_fields()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.status <> 'draft' and (new.max_supply <> old.max_supply or new.project_type <> old.project_type) then
    raise exception 'The token count and type cannot change after the art is locked.'
      using errcode = 'check_violation';
  end if;
  if old.status = 'deployed' and (
    new.name <> old.name
    or new.symbol <> old.symbol
    or (old.slug is not null and new.slug is distinct from old.slug)
  ) then
    raise exception 'The name, symbol and mint page address cannot change after deployment.'
      using errcode = 'check_violation';
  end if;
  if new.slug is distinct from old.slug and current_user in ('anon', 'authenticated') then
    raise exception 'The mint page address can only be set by reserving it.'
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
-- Reserving an address
-- ---------------------------------------------------------------------------------------------
-- Reserves `p_slug` for a collection the caller owns.
--   - The caller must own the collection and have a wallet profile (the same rule as the
--     collections policies). Anyone else gets 42501 and nothing is written.
--   - The address must match the table's format and not be one of the app's own routes (23514).
--   - A deployed collection that already has an address is refused (P0001).
--   - A reservation of the same address on another collection that is not deployed and was made
--     more than 3 days ago has lapsed: it is released first.
--   - Then the address is written with `slug_reserved_at = now()`. If another collection holds a
--     live reservation, or a deployed collection holds the address, the unique index raises 23505.
-- Calling it again on the same collection (same or another address) renews the reservation.
create function private.reserve_slug(p_collection_id uuid, p_slug text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_owner uuid;
  v_status public.collection_status;
  v_slug text;
begin
  if v_uid is null or not exists (select 1 from public.profiles p where p.id = v_uid) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  select c.owner_id, c.status, c.slug into v_owner, v_status, v_slug
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
    raise exception 'invalid address' using errcode = '23514';
  end if;

  if v_status = 'deployed' and v_slug is not null then
    raise exception 'address is fixed after deploy' using errcode = 'P0001';
  end if;

  update public.collections c
  set slug = null, slug_reserved_at = null
  where c.slug = p_slug
    and c.id <> p_collection_id
    and c.status <> 'deployed'
    and c.slug_reserved_at < now() - interval '3 days';

  update public.collections c
  set slug = p_slug, slug_reserved_at = now()
  where c.id = p_collection_id;
end;
$$;

revoke all on function private.reserve_slug(uuid, text) from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.reserve_slug(uuid, text) to authenticated;

-- The PostgREST entry point. Runs as the caller and does nothing but call the private function,
-- which performs every check.
create function public.reserve_slug(p_collection_id uuid, p_slug text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform private.reserve_slug(p_collection_id, p_slug);
end;
$$;

revoke all on function public.reserve_slug(uuid, text) from public, anon, authenticated;
grant execute on function public.reserve_slug(uuid, text) to authenticated;
