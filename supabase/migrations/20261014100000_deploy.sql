-- Deploy (docs/specs/2026-10-14-deploy.md, section 4): the deployments table (one row per collection:
-- what was sent and what landed), the service-role function collection_record_deploy that writes the
-- row, marks the collection deployed with its chain and contract, makes the mint page link permanent
-- and replaces the mint_groups rows with the launch phases the constructor took; the frozen-field
-- guard's new branch (the name, symbol and description freeze at lock, since the metadata the worker
-- writes and the contract's name must agree); and private.placeholder_ready, exposed to the owner as
-- collection_placeholder_ready, which the stage rules ask for a deferred collection.

-- ---------------------------------------------------------------------------------------------
-- deployments: what was sent and what landed
-- ---------------------------------------------------------------------------------------------
create table public.deployments (
  collection_id uuid primary key references public.collections (id) on delete cascade,
  chain_id integer not null check (chain_id > 0),
  factory text not null check (factory ~ '^0x[0-9a-f]{40}$'),
  deployer text not null check (deployer ~ '^0x[0-9a-f]{40}$'),
  salt text not null check (salt ~ '^0x[0-9a-f]{64}$'),
  code_hash text not null check (code_hash ~ '^0x[0-9a-f]{64}$'),
  -- The constructor as prepared (section 6.1), every uint a decimal string, so the arguments can be
  -- encoded again and the address derived again later.
  args jsonb not null,
  contract_address text not null check (contract_address ~ '^0x[0-9a-f]{40}$'),
  tx_hash text not null unique check (tx_hash ~ '^0x[0-9a-f]{64}$'),
  base_uri text not null,
  payout_address text not null check (payout_address ~ '^0x[0-9a-f]{40}$'),
  royalty_bps integer not null check (royalty_bps between 0 and 1000),
  royalty_receiver text not null check (royalty_receiver ~ '^0x[0-9a-f]{40}$'),
  public_max_per_wallet integer not null check (public_max_per_wallet >= 1),
  -- The factory's collectionFees() as read at confirm. Informational: the contract's fees() is the truth.
  mint_fee_flat_wei numeric(78, 0) not null check (mint_fee_flat_wei >= 0),
  mint_fee_bps integer not null check (mint_fee_bps between 0 and 10000),
  airdrop_fee_per_token_wei numeric(78, 0) not null check (airdrop_fee_per_token_wei >= 0),
  deployed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

comment on table public.deployments is
  'One row per deployed collection: the constructor as prepared, the fee snapshot, the salt, the deployer, the transaction and the address the factory event proved.';

alter table public.deployments enable row level security;

-- The owner reads. No client role writes: collection_record_deploy, below, is the only writer.
create policy "deployments: owner reads" on public.deployments
for select to authenticated
using ((select private.collection_owned(collection_id)));

revoke all on public.deployments from anon, authenticated;
grant select on public.deployments to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Collections: the frozen-field guard learns that the name, symbol and description freeze at lock
-- ---------------------------------------------------------------------------------------------
-- As in 20261008010000_art_tables.sql, plus the branch after the supply branch. The deployed branch
-- stays: a deployed collection is also locked, so the new branch fires first with its own sentence;
-- the old sentence remains for a deployed collection whose placeholder alone was locked (no art lock).
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
  -- Deploy (docs/specs/2026-10-14-deploy.md, section 4.3): the metadata the worker writes and the
  -- contract's name must agree, so the three freeze once the art is locked.
  if old.art_locked_at is not null and (
    new.name <> old.name or new.symbol <> old.symbol or new.description <> old.description
  ) then
    raise exception 'The name, symbol and description cannot change while the art is locked.'
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
-- The stage rule's input: does the collection have a finished placeholder job?
-- ---------------------------------------------------------------------------------------------
create function private.placeholder_ready(p_collection_id uuid)
returns boolean
language sql
security invoker
set search_path = ''
stable
as $$
  select exists (
    select 1 from public.render_jobs j
    where j.collection_id = p_collection_id and j.kind = 'placeholder' and j.state = 'done'
  );
$$;

revoke all on function private.placeholder_ready(uuid) from public, anon, authenticated;

-- The owner's view of it (the deploy page and the stage rules ask it for a deferred collection).
create function public.collection_placeholder_ready(p_collection_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  -- The owner check the read policies use: a stranger's or unknown collection reads as not found.
  if not (select private.collection_owned(p_collection_id)) then
    raise exception 'collection not found' using errcode = '42501';
  end if;
  return private.placeholder_ready(p_collection_id);
end;
$$;

-- Granted to authenticated only: it acts for the signed-in owner, as art_render_credit does.
revoke all on function public.collection_placeholder_ready(uuid) from public, anon, service_role;
grant execute on function public.collection_placeholder_ready(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- collection_record_deploy: the row, the collection's status, chain and contract, the link made
-- permanent and the launch phases, in one transaction (section 4.2)
-- ---------------------------------------------------------------------------------------------
-- Service role only, as art_lock: the address comes from the factory's event in a verified receipt,
-- never from the browser. p_owner must equal collections.owner_id (private.lock_owned_collection).
create function public.collection_record_deploy(
  p_collection_id uuid,
  p_owner uuid,
  p_chain_id integer,
  p_factory text,
  p_deployer text,
  p_salt text,
  p_code_hash text,
  p_args jsonb,
  p_contract_address text,
  p_tx_hash text,
  p_base_uri text,
  p_payout_address text,
  p_royalty_bps integer,
  p_royalty_receiver text,
  p_public_max_per_wallet integer,
  p_mint_fee_flat_wei numeric,
  p_mint_fee_bps integer,
  p_airdrop_fee_per_token_wei numeric,
  p_groups jsonb
)
returns public.deployments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_collection public.collections;
  v_row public.deployments;
  v_group jsonb;
  v_index integer := 0;
begin
  v_collection := private.lock_owned_collection(p_collection_id, p_owner);
  -- (1) One deployment per collection.
  if v_collection.status = 'deployed'
    or exists (select 1 from public.deployments d where d.collection_id = v_collection.id) then
    raise exception 'The contract is already deployed.' using errcode = '23514';
  end if;
  -- (2) The mint page link must be live: reserved, and reserved less than 3 days ago. A slug with no
  -- reservation time counts as lapsed, as the screen reads it.
  if v_collection.slug is null
    or v_collection.slug_reserved_at is null
    or v_collection.slug_reserved_at < now() - interval '3 days' then
    raise exception 'Reserve your mint page link first.' using errcode = '23514';
  end if;
  -- (3) The supply is a constructor argument.
  if v_collection.max_supply is null then
    raise exception 'Set the supply in Art first.' using errcode = '23514';
  end if;
  -- (4) Something finished to start the contract on: a done real job, or, for a collection that
  -- finishes its art later, a done placeholder job.
  if not exists (
      select 1 from public.render_jobs j
      where j.collection_id = v_collection.id and j.kind = 'real' and j.state = 'done'
    )
    and not (v_collection.art_deferred and private.placeholder_ready(v_collection.id)) then
    raise exception 'Render the art before deploying.' using errcode = '23514';
  end if;
  -- (5) One deployment per transaction; the unique index says the same (23505, mapped in the app).
  if exists (select 1 from public.deployments d where d.tx_hash = lower(p_tx_hash)) then
    raise exception 'This transaction was recorded for another collection.' using errcode = '23514';
  end if;

  insert into public.deployments (
    collection_id, chain_id, factory, deployer, salt, code_hash, args, contract_address, tx_hash,
    base_uri, payout_address, royalty_bps, royalty_receiver, public_max_per_wallet,
    mint_fee_flat_wei, mint_fee_bps, airdrop_fee_per_token_wei
  )
  values (
    v_collection.id, p_chain_id, lower(p_factory), lower(p_deployer), lower(p_salt), lower(p_code_hash),
    p_args, lower(p_contract_address), lower(p_tx_hash),
    p_base_uri, lower(p_payout_address), p_royalty_bps, lower(p_royalty_receiver), p_public_max_per_wallet,
    p_mint_fee_flat_wei, p_mint_fee_bps, p_airdrop_fee_per_token_wei
  )
  returning * into v_row;

  -- The collection is deployed on this chain at this address, and its link is permanent
  -- (private.reserve_slug already treats a deployed collection so). The frozen-field guard's lapsed
  -- link branch cannot fire: refusal (2) ran first, and slug_reserved_at is null here.
  update public.collections c
  set status = 'deployed',
      chain_id = p_chain_id,
      contract_address = lower(p_contract_address),
      slug_reserved_at = null
  where c.id = v_collection.id;

  -- The launch phases as the constructor took them replace any draft set from an earlier visit.
  delete from public.mint_groups g where g.collection_id = v_collection.id;
  for v_group in
    select e.value from jsonb_array_elements(p_groups) with ordinality as e(value, ord) order by e.ord
  loop
    insert into public.mint_groups (collection_id, onchain_id, name, price_wei, max_supply, start_at)
    values (
      v_collection.id, v_index, v_group->>'name', (v_group->>'price_wei')::numeric,
      (v_group->>'max_supply')::integer, null
    );
    v_index := v_index + 1;
  end loop;

  return v_row;
end;
$$;

revoke all on function public.collection_record_deploy(
  uuid, uuid, integer, text, text, text, text, jsonb, text, text, text, text, integer, text, integer,
  numeric, integer, numeric, jsonb
) from public, anon, authenticated;
grant execute on function public.collection_record_deploy(
  uuid, uuid, integer, text, text, text, text, jsonb, text, text, text, text, integer, text, integer,
  numeric, integer, numeric, jsonb
) to service_role;
