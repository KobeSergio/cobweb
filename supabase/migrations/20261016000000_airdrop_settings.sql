-- Airdrop and Settings (docs/specs/2026-10-15-airdrop-settings.md, section 4): airdrops and withdrawals, Cobweb's
-- records of the transactions it proved, read by the owner and written only by airdrop_record and
-- withdrawal_record; the deployments columns payout_address, royalty_bps, royalty_receiver and base_uri become
-- copies of the contract's values, with the new transfer_validator and mint_on_behalf, written only by
-- settings_refresh from a server read (the deploy-time values stay in args); the royalty copy takes the
-- contract's 0 to 10,000.

-- ---------------------------------------------------------------------------------------------
-- airdrops and withdrawals: one row per transaction Cobweb proved
-- ---------------------------------------------------------------------------------------------
create table public.airdrops (
  tx_hash text primary key check (tx_hash ~ '^0x[0-9a-f]{64}$'),
  collection_id uuid not null references public.collections (id) on delete cascade,
  kind text not null check (kind in ('airdrop', 'burn')),
  recipients integer not null check (recipients >= 1),
  tokens integer not null check (tokens >= 1),
  fee_paid_wei numeric(78, 0) not null check (fee_paid_wei >= 0),
  first_token_id bigint not null check (first_token_id >= 1),
  last_token_id bigint not null,
  block bigint not null check (block >= 0),
  sent_by text not null check (sent_by ~ '^0x[0-9a-f]{40}$'),
  confirmed_at timestamptz not null default now(),
  constraint airdrops_token_range check (last_token_id - first_token_id + 1 = tokens),
  constraint airdrops_burn_one_recipient check (kind <> 'burn' or recipients = 1)
);
create index airdrops_collection_id_block_idx on public.airdrops (collection_id, block desc);

comment on table public.airdrops is
  'One row per airdropNFTs transaction Cobweb proved from its receipt and calldata, written only by airdrop_record. kind is burn when the only recipient is the dead address. Airdrops sent outside Cobweb are not here.';

create table public.withdrawals (
  tx_hash text primary key check (tx_hash ~ '^0x[0-9a-f]{64}$'),
  collection_id uuid not null references public.collections (id) on delete cascade,
  amount_wei numeric(78, 0) not null check (amount_wei > 0),
  payout_address text not null check (payout_address ~ '^0x[0-9a-f]{40}$'),
  block bigint not null check (block >= 0),
  confirmed_at timestamptz not null default now()
);
create index withdrawals_collection_id_idx on public.withdrawals (collection_id);

comment on table public.withdrawals is
  'One row per withdrawMintFunds transaction Cobweb proved from its receipt, with the amount and payout address of its MintFundsWithdrawn event, written only by withdrawal_record. Withdrawals made outside Cobweb are not here.';

-- The owner reads. No client role writes (the revokes undo Supabase's default grants on a new table): the
-- record functions below are the only writers.
alter table public.airdrops enable row level security;
create policy "airdrops: owner reads" on public.airdrops
for select to authenticated
using ((select private.collection_owned(collection_id)));
revoke all on public.airdrops from anon, authenticated;
grant select on public.airdrops to authenticated;

alter table public.withdrawals enable row level security;
create policy "withdrawals: owner reads" on public.withdrawals
for select to authenticated
using ((select private.collection_owned(collection_id)));
revoke all on public.withdrawals from anon, authenticated;
grant select on public.withdrawals to authenticated;

-- ---------------------------------------------------------------------------------------------
-- deployments: the settings become copies of the contract's, the royalty copy takes the contract's range
-- ---------------------------------------------------------------------------------------------
alter table public.deployments drop constraint deployments_royalty_bps_check;
alter table public.deployments
  add constraint deployments_royalty_bps_check check (royalty_bps between 0 and 10000),
  add column transfer_validator text check (transfer_validator ~ '^0x[0-9a-f]{40}$'),
  add column mint_on_behalf boolean not null default false;

comment on column public.deployments.payout_address is
  'A copy of the contract''s ownerPayoutAddress(), refreshed by settings_refresh alone. The value at deploy stays in args.payout.';
comment on column public.deployments.royalty_bps is
  'A copy of the contract''s default royalty in basis points (royaltyInfo(1, 10000)), refreshed by settings_refresh alone. The contract allows up to 10,000; Cobweb sets at most 1,000. The value at deploy stays in args.royaltyBps.';
comment on column public.deployments.royalty_receiver is
  'A copy of the default royalty''s receiver (royaltyInfo(1, 10000)), refreshed by settings_refresh alone. The value at deploy stays in args.royaltyReceiver.';
comment on column public.deployments.base_uri is
  'A copy of the contract''s baseURI(), refreshed by settings_refresh alone. The value at deploy stays in args.baseUri.';
comment on column public.deployments.transfer_validator is
  'A copy of the contract''s getTransferValidator(), refreshed by settings_refresh alone: null until the first read, the zero address for no validator.';
comment on column public.deployments.mint_on_behalf is
  'A copy of collectionState().mintOnBehalfActive, refreshed by settings_refresh alone. False at deploy.';
comment on column public.deployments.state_block is
  'The block of the server read the copies were last refreshed from: mint_groups price_wei, max_supply and start_at and public_max_per_wallet by mint_groups_refresh; payout_address, royalty_bps, royalty_receiver, base_uri, transfer_validator and mint_on_behalf by settings_refresh.';

-- ---------------------------------------------------------------------------------------------
-- settings_refresh: the settings copies from a server read, at that read's block
-- ---------------------------------------------------------------------------------------------
-- Service role only. p_settings is { payout_address, royalty_bps, royalty_receiver, base_uri,
-- transfer_validator, mint_on_behalf }, addresses lowercase, every key required. A read older than the last
-- one writes nothing and answers false; the same block is accepted, since the server refreshes the phase
-- copies first with that block. The column checks raise as they are.
create function public.settings_refresh(
  p_collection_id uuid,
  p_owner uuid,
  p_block bigint,
  p_block_time timestamptz,
  p_settings jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_collection public.collections;
  v_deployment public.deployments;
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
  -- transfer_validator takes null (not read yet), so a missing key is refused here rather than by a column.
  if p_settings is null or not (p_settings ?& array[
    'payout_address', 'royalty_bps', 'royalty_receiver', 'base_uri', 'transfer_validator', 'mint_on_behalf'
  ]) then
    raise exception 'Every setting is required.' using errcode = '23502';
  end if;
  update public.deployments d
  set payout_address = p_settings->>'payout_address',
      royalty_bps = (p_settings->>'royalty_bps')::integer,
      royalty_receiver = p_settings->>'royalty_receiver',
      base_uri = p_settings->>'base_uri',
      transfer_validator = p_settings->>'transfer_validator',
      mint_on_behalf = (p_settings->>'mint_on_behalf')::boolean,
      state_block = p_block,
      state_read_at = p_block_time
  where d.collection_id = v_collection.id;
  return true;
end;
$$;

revoke all on function public.settings_refresh(uuid, uuid, bigint, timestamptz, jsonb)
  from public, anon, authenticated;
grant execute on function public.settings_refresh(uuid, uuid, bigint, timestamptz, jsonb) to service_role;

-- ---------------------------------------------------------------------------------------------
-- airdrop_record: one airdropNFTs transaction the server proved from its receipt and calldata
-- ---------------------------------------------------------------------------------------------
-- Service role only; p_owner must equal collections.owner_id. A hash, sender or kind that is not well formed
-- is not this change. A hash already recorded is left as it is (the proofs tie a hash to one contract): the
-- function answers whether it inserted the row. The table's checks raise as they are.
create function public.airdrop_record(
  p_collection_id uuid,
  p_owner uuid,
  p_tx text,
  p_kind text,
  p_recipients integer,
  p_tokens integer,
  p_fee_paid_wei numeric,
  p_first_token_id bigint,
  p_last_token_id bigint,
  p_block bigint,
  p_sent_by text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_collection public.collections;
begin
  v_collection := private.lock_owned_collection(p_collection_id, p_owner);
  if not exists (select 1 from public.deployments d where d.collection_id = v_collection.id) then
    raise exception 'The contract is not deployed yet.' using errcode = '23514';
  end if;
  if p_tx is null or p_tx !~ '^0x[0-9a-f]{64}$'
    or p_sent_by is null or p_sent_by !~ '^0x[0-9a-f]{40}$'
    or p_kind is null or p_kind not in ('airdrop', 'burn') then
    raise exception 'The transaction did not make this change.' using errcode = '23514';
  end if;
  insert into public.airdrops (
    tx_hash, collection_id, kind, recipients, tokens, fee_paid_wei, first_token_id, last_token_id, block, sent_by
  )
  values (
    p_tx, v_collection.id, p_kind, p_recipients, p_tokens, p_fee_paid_wei, p_first_token_id, p_last_token_id,
    p_block, p_sent_by
  )
  on conflict (tx_hash) do nothing;
  return found;
end;
$$;

revoke all on function public.airdrop_record(uuid, uuid, text, text, integer, integer, numeric, bigint, bigint, bigint, text)
  from public, anon, authenticated;
grant execute on function public.airdrop_record(uuid, uuid, text, text, integer, integer, numeric, bigint, bigint, bigint, text)
  to service_role;

-- ---------------------------------------------------------------------------------------------
-- withdrawal_record: one withdrawMintFunds transaction the server proved from its receipt
-- ---------------------------------------------------------------------------------------------
-- Service role only, as airdrop_record: the amount and the payout address come from the receipt's
-- MintFundsWithdrawn event. Answers whether it inserted the row.
create function public.withdrawal_record(
  p_collection_id uuid,
  p_owner uuid,
  p_tx text,
  p_amount_wei numeric,
  p_payout_address text,
  p_block bigint
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_collection public.collections;
begin
  v_collection := private.lock_owned_collection(p_collection_id, p_owner);
  if not exists (select 1 from public.deployments d where d.collection_id = v_collection.id) then
    raise exception 'The contract is not deployed yet.' using errcode = '23514';
  end if;
  if p_tx is null or p_tx !~ '^0x[0-9a-f]{64}$'
    or p_payout_address is null or p_payout_address !~ '^0x[0-9a-f]{40}$' then
    raise exception 'The transaction did not make this change.' using errcode = '23514';
  end if;
  insert into public.withdrawals (tx_hash, collection_id, amount_wei, payout_address, block)
  values (p_tx, v_collection.id, p_amount_wei, p_payout_address, p_block)
  on conflict (tx_hash) do nothing;
  return found;
end;
$$;

revoke all on function public.withdrawal_record(uuid, uuid, text, numeric, text, bigint)
  from public, anon, authenticated;
grant execute on function public.withdrawal_record(uuid, uuid, text, numeric, text, bigint) to service_role;
