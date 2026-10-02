-- Cobweb core schema: creator profiles, collections, mint groups and allowlists.
--
-- Access model: a creator owns their collections and everything under them. Every table has
-- row-level security, and every policy checks ownership, not just that the caller is signed in.
--
-- Privileges: depending on the project's settings, `anon` and `authenticated` may be granted
-- everything on a new table automatically. Each table therefore starts by revoking all of it and
-- then grants exactly what is needed. Without the revoke, the column-level grants below would
-- restrict nothing.

create schema if not exists private;

-- ---------------------------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------------------------
create type public.project_type as enum ('generative', 'one_of_one', 'metadata', 'single_asset');

-- Where a collection is in the linear launch flow. Only moves forward, and only server-side.
create type public.collection_status as enum ('draft', 'art_locked', 'rendering', 'rendered', 'deployed');

-- ---------------------------------------------------------------------------------------------
-- Profiles: one row per signed-in wallet
-- ---------------------------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  -- Lowercase hex. Taken from the verified sign-in identity, never from user-editable metadata.
  wallet_address text not null unique check (wallet_address ~ '^0x[0-9a-f]{40}$'),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles: read own" on public.profiles for select to authenticated
using ((select auth.uid()) = id);

revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;

-- Creates the profile when a wallet signs in for the first time. The address comes from the
-- identity's provider id ("web3:ethereum:0x..."), which the auth server writes after verifying
-- the signature. It is deliberately not read from user metadata, which a user can edit.
create function private.handle_new_web3_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.provider = 'web3' and new.provider_id like 'web3:ethereum:0x%' then
    insert into public.profiles (id, wallet_address)
    values (new.user_id, lower(split_part(new.provider_id, ':', 3)))
    on conflict (id) do nothing;
  end if;
  return new;
end;
$$;

revoke all on function private.handle_new_web3_identity() from public, anon, authenticated;

create trigger on_web3_identity_created
after insert on auth.identities
for each row execute function private.handle_new_web3_identity();

-- ---------------------------------------------------------------------------------------------
-- Collections
-- ---------------------------------------------------------------------------------------------
create table public.collections (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete restrict,
  name text not null check (char_length(name) between 1 and 64),
  symbol text not null check (symbol ~ '^[A-Z0-9]{1,12}$'),
  -- The mint page lives at /<slug>, so a slug can never be one of the app's own routes.
  slug text not null unique check (
    slug ~ '^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$'
    and slug not in ('collections', 'api', 'admin', 'create', 'assets', 'auth', 'help', 'docs', 'terms', 'privacy')
  ),
  description text not null default '' check (char_length(description) <= 2000),
  project_type public.project_type not null,
  max_supply integer not null check (max_supply between 1 and 100000),
  status public.collection_status not null default 'draft',
  -- Set at deploy.
  chain_id integer,
  contract_address text check (contract_address ~ '^0x[0-9a-f]{40}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint single_asset_supply_cap check (project_type <> 'single_asset' or max_supply <= 4000),
  constraint deployed_has_contract check (
    status <> 'deployed' or (chain_id is not null and contract_address is not null)
  )
);

create index collections_owner_id_idx on public.collections (owner_id);

alter table public.collections enable row level security;

create policy "collections: read own" on public.collections for select to authenticated
using ((select auth.uid()) = owner_id);

-- Creating and changing collections also requires a profile, which only a wallet sign-in creates.
-- A session obtained any other way (for example an email account, should that provider ever be
-- left on) can therefore write nothing.
create policy "collections: create own" on public.collections for insert to authenticated
with check (
  (select auth.uid()) = owner_id
  and exists (select 1 from public.profiles p where p.id = (select auth.uid()))
);

create policy "collections: update own" on public.collections for update to authenticated
using ((select auth.uid()) = owner_id)
with check (
  (select auth.uid()) = owner_id
  and exists (select 1 from public.profiles p where p.id = (select auth.uid()))
);

-- A collection can be deleted only before anything has been paid for or deployed.
create policy "collections: delete own drafts" on public.collections for delete to authenticated
using ((select auth.uid()) = owner_id and status = 'draft');

-- Column-level grants: a creator can set the descriptive fields. Owner, status, chain and contract
-- address are written only by trusted server code, so a client cannot mark its own collection
-- as paid or deployed, or move it back to draft to delete it.
revoke all on public.collections from anon, authenticated;
grant select, delete on public.collections to authenticated;
grant insert (name, symbol, slug, description, project_type, max_supply) on public.collections to authenticated;
grant update (name, symbol, slug, description, max_supply) on public.collections to authenticated;

create function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger collections_set_updated_at
before update on public.collections
for each row execute function public.set_updated_at();

-- What can no longer change as a collection moves through the flow, whoever is asking:
--   once the art is locked, the token count and type are what was paid for and rendered;
--   once deployed, the name and symbol are fixed in the contract and the mint page address is live.
create function public.collections_guard_frozen_fields()
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
  if old.status = 'deployed' and (new.name <> old.name or new.symbol <> old.symbol or new.slug <> old.slug) then
    raise exception 'The name, symbol and mint page address cannot change after deployment.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger collections_guard_frozen_fields
before update on public.collections
for each row execute function public.collections_guard_frozen_fields();

-- ---------------------------------------------------------------------------------------------
-- Mint groups: the dashboard's copy of a collection's phases. The contract is the source of truth
-- once deployed; this holds what the creator has planned and the display name of each group.
-- ---------------------------------------------------------------------------------------------
create table public.mint_groups (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null references public.collections (id) on delete cascade,
  -- The group id used on-chain. 0 is the public sale.
  onchain_id integer not null check (onchain_id >= 0),
  name text not null check (char_length(name) between 1 and 48),
  -- Price in the chain's smallest unit. numeric(78,0) holds any uint256.
  price_wei numeric(78, 0) not null default 0 check (price_wei >= 0),
  max_supply integer not null default 0 check (max_supply >= 0),
  -- Scheduled start, or null for none.
  start_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (collection_id, onchain_id)
);

alter table public.mint_groups enable row level security;

create policy "mint_groups: owner all" on public.mint_groups for all to authenticated
using (
  exists (select 1 from public.collections c where c.id = collection_id and c.owner_id = (select auth.uid()))
)
with check (
  exists (select 1 from public.collections c where c.id = collection_id and c.owner_id = (select auth.uid()))
);

revoke all on public.mint_groups from anon, authenticated;
grant select, insert, update, delete on public.mint_groups to authenticated;

create trigger mint_groups_set_updated_at
before update on public.mint_groups
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- Allowlist entries: what the creator uploaded, before and after it is written on-chain
-- ---------------------------------------------------------------------------------------------
create table public.whitelist_entries (
  mint_group_id uuid not null references public.mint_groups (id) on delete cascade,
  -- Repeated here so the ownership policy needs one lookup, not two.
  collection_id uuid not null references public.collections (id) on delete cascade,
  wallet_address text not null check (wallet_address ~ '^0x[0-9a-f]{40}$'),
  quota integer not null check (quota > 0),
  created_at timestamptz not null default now(),
  primary key (mint_group_id, wallet_address)
);

create index whitelist_entries_collection_id_idx on public.whitelist_entries (collection_id);

alter table public.whitelist_entries enable row level security;

create policy "whitelist_entries: owner all" on public.whitelist_entries for all to authenticated
using (
  exists (select 1 from public.collections c where c.id = collection_id and c.owner_id = (select auth.uid()))
)
with check (
  exists (select 1 from public.collections c where c.id = collection_id and c.owner_id = (select auth.uid()))
  -- The group must belong to the same collection. The outer column is qualified on purpose: a bare
  -- `collection_id` inside the subquery would resolve to the group's own column and always match.
  and exists (
    select 1 from public.mint_groups g
    where g.id = whitelist_entries.mint_group_id and g.collection_id = whitelist_entries.collection_id
  )
);

revoke all on public.whitelist_entries from anon, authenticated;
grant select, insert, update, delete on public.whitelist_entries to authenticated;
