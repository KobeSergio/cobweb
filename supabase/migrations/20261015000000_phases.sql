-- Phases (docs/specs/2026-10-15-phases.md, section 4): mint_groups gains what Cobweb keeps off chain
-- (a description, the mint page visibility and the creator's order), names of 1 to 40 characters without
-- outer spaces and unique in the collection ignoring case, and the public sale always shown. The owner's
-- client changes only those four columns; rows come only from collection_record_deploy and
-- mint_group_record, and the copies of price, allocation and start only from mint_groups_refresh, which
-- writes what a server read of collectionState() returned. deployments keeps the public limit as a copy
-- of the contract's, with the block and the time of the read the copies came from. mint_group_move swaps
-- two positions for the owner.

-- ---------------------------------------------------------------------------------------------
-- mint_groups: the off-chain columns and their checks
-- ---------------------------------------------------------------------------------------------
alter table public.mint_groups
  add column description text not null default '' check (char_length(description) <= 500),
  add column visible boolean not null default true,
  add column position integer check (position >= 0),
  add constraint mint_groups_public_shown check (onchain_id <> 0 or visible);

alter table public.mint_groups drop constraint mint_groups_name_check;
alter table public.mint_groups add constraint mint_groups_name_check
  check (char_length(name) between 1 and 40 and name = btrim(name));

-- Existing rows came through the deploy form, so their names already hold the new check and index; their
-- order is the order the constructor took them in.
update public.mint_groups set position = onchain_id;

create unique index mint_groups_name_key on public.mint_groups (collection_id, lower(name));
create unique index mint_groups_position_key on public.mint_groups (collection_id, position)
  where position is not null;

comment on table public.mint_groups is
  'One row per mint group Cobweb knows on a deployed collection. Off chain, changed by the owner: name, description, visible and position (null only inside mint_group_move). A copy of the chain, written only by mint_groups_refresh from a server read of collectionState(): price_wei, max_supply and start_at. Rows come only from collection_record_deploy and mint_group_record.';

-- A row inserted without a position takes the next one in its collection. Both writers lock the
-- collection first (private.lock_owned_collection), so two inserts never pick the same position.
create function public.mint_groups_set_position()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.position is null then
    select coalesce(max(g.position) + 1, 0) into new.position
    from public.mint_groups g
    where g.collection_id = new.collection_id;
  end if;
  return new;
end;
$$;

create trigger mint_groups_set_position
before insert on public.mint_groups
for each row execute function public.mint_groups_set_position();

-- The owner reads every column and changes only the four off-chain ones. The policy
-- "mint_groups: owner all" stays: it scopes what the grants allow to the owner's rows.
revoke insert, update, delete on public.mint_groups from authenticated;
grant update (name, description, visible, position) on public.mint_groups to authenticated;

-- ---------------------------------------------------------------------------------------------
-- deployments: the public limit becomes the copy of the contract's, with the read it came from
-- ---------------------------------------------------------------------------------------------
alter table public.deployments drop constraint deployments_public_max_per_wallet_check;
alter table public.deployments
  add constraint deployments_public_max_per_wallet_check check (public_max_per_wallet >= 0),
  add column state_block bigint check (state_block >= 0),
  add column state_read_at timestamptz;

comment on column public.deployments.public_max_per_wallet is
  'A copy of the contract''s publicMaxMintPerWallet(), refreshed by mint_groups_refresh. The value at deploy stays in args.publicMaxPerWallet.';
comment on column public.deployments.state_block is
  'The block of the server read the copies (mint_groups price_wei, max_supply, start_at and public_max_per_wallet) were last refreshed from.';
comment on column public.deployments.state_read_at is 'The time of that block.';

-- ---------------------------------------------------------------------------------------------
-- mint_group_record: the row of a group the chain proved, written after its receipt
-- ---------------------------------------------------------------------------------------------
-- Service role only: the id comes from a receipt's MintGroupRegistered log or from a server read of the
-- chain, never from the browser alone. p_owner must equal collections.owner_id.
create function public.mint_group_record(
  p_collection_id uuid,
  p_owner uuid,
  p_onchain_id integer,
  p_name text,
  p_description text,
  p_visible boolean
)
returns public.mint_groups
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_collection public.collections;
  v_row public.mint_groups;
begin
  v_collection := private.lock_owned_collection(p_collection_id, p_owner);
  if not exists (select 1 from public.deployments d where d.collection_id = v_collection.id) then
    raise exception 'The contract is not deployed yet.' using errcode = '23514';
  end if;
  -- A row already there (named before, or left behind by a reorg) is taken over and keeps its position.
  -- The name index and the checks raise as they are.
  insert into public.mint_groups (collection_id, onchain_id, name, description, visible)
  values (v_collection.id, p_onchain_id, p_name, p_description, p_visible)
  on conflict (collection_id, onchain_id) do update
    set name = excluded.name, description = excluded.description, visible = excluded.visible
  returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.mint_group_record(uuid, uuid, integer, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.mint_group_record(uuid, uuid, integer, text, text, boolean) to service_role;

-- ---------------------------------------------------------------------------------------------
-- mint_groups_refresh: the copies from a server read of collectionState()
-- ---------------------------------------------------------------------------------------------
-- Service role only. p_groups is [{ onchain_id, price_wei, max_supply, start }], start in Unix seconds and
-- 0 for none. A read older than the last one writes nothing and answers false; rows are never inserted or
-- deleted here.
create function public.mint_groups_refresh(
  p_collection_id uuid,
  p_owner uuid,
  p_block bigint,
  p_block_time timestamptz,
  p_public_max_per_wallet integer,
  p_groups jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_collection public.collections;
  v_deployment public.deployments;
  v_group jsonb;
  v_id integer;
  v_price numeric;
  v_supply integer;
  v_start timestamptz;
begin
  v_collection := private.lock_owned_collection(p_collection_id, p_owner);
  select d.* into v_deployment
  from public.deployments d
  where d.collection_id = v_collection.id
  for update;
  if not found then
    raise exception 'The contract is not deployed yet.' using errcode = '23514';
  end if;
  -- A slower read never overwrites a newer one.
  if v_deployment.state_block is not null and p_block < v_deployment.state_block then
    return false;
  end if;
  for v_group in select e.value from jsonb_array_elements(p_groups) as e(value)
  loop
    v_id := (v_group->>'onchain_id')::integer;
    v_price := (v_group->>'price_wei')::numeric;
    v_supply := (v_group->>'max_supply')::integer;
    v_start := case
      when coalesce((v_group->>'start')::bigint, 0) = 0 then null
      else to_timestamp((v_group->>'start')::bigint)
    end;
    update public.mint_groups g
    set price_wei = v_price, max_supply = v_supply, start_at = v_start
    where g.collection_id = v_collection.id
      and g.onchain_id = v_id
      and (g.price_wei is distinct from v_price
        or g.max_supply is distinct from v_supply
        or g.start_at is distinct from v_start);
  end loop;
  update public.deployments d
  set public_max_per_wallet = p_public_max_per_wallet,
      state_block = p_block,
      state_read_at = p_block_time
  where d.collection_id = v_collection.id;
  return true;
end;
$$;

revoke all on function public.mint_groups_refresh(uuid, uuid, bigint, timestamptz, integer, jsonb)
  from public, anon, authenticated;
grant execute on function public.mint_groups_refresh(uuid, uuid, bigint, timestamptz, integer, jsonb)
  to service_role;

-- ---------------------------------------------------------------------------------------------
-- mint_group_move: the owner's Move up and Move down
-- ---------------------------------------------------------------------------------------------
-- Security invoker: it runs under the owner's policy and column grant, so another creator's phase is
-- not found. The row parks at null, the neighbour takes its position, the row takes the neighbour's;
-- an end row stays where it is.
create function public.mint_group_move(p_collection_id uuid, p_onchain_id integer, p_up boolean)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row public.mint_groups;
  v_neighbour public.mint_groups;
begin
  select g.* into v_row
  from public.mint_groups g
  where g.collection_id = p_collection_id and g.onchain_id = p_onchain_id
  for update;
  if not found then
    raise exception 'phase not found' using errcode = '42501';
  end if;
  if p_up then
    select g.* into v_neighbour
    from public.mint_groups g
    where g.collection_id = p_collection_id and g.position < v_row.position
    order by g.position desc
    limit 1
    for update;
  else
    select g.* into v_neighbour
    from public.mint_groups g
    where g.collection_id = p_collection_id and g.position > v_row.position
    order by g.position asc
    limit 1
    for update;
  end if;
  if not found then
    return;
  end if;
  update public.mint_groups g set position = null where g.id = v_row.id;
  update public.mint_groups g set position = v_row.position where g.id = v_neighbour.id;
  update public.mint_groups g set position = v_neighbour.position where g.id = v_row.id;
end;
$$;

revoke all on function public.mint_group_move(uuid, integer, boolean) from public, anon, service_role;
grant execute on function public.mint_group_move(uuid, integer, boolean) to authenticated;
