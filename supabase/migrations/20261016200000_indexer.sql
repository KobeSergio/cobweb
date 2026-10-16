-- The indexer and the Overview (docs/specs/2026-10-16-indexer-overview.md, section 4): indexer_cursors, one row per
-- deployed collection the freshness server's indexer reads, with how far every log is recorded and the holders;
-- mints, token_owners and airdrop_recipients, what the indexer read from each collection's logs; airdrops and
-- withdrawals take the indexer's rows beside the ones Cobweb proves (airdrops.sent_by nullable, a new block_time);
-- and the four service-role functions indexer_targets, indexer_start, indexer_record and indexer_summaries, which
-- answer jsonb since PostgREST caps a set of rows at max_rows. The owner reads indexer_cursors, mints and
-- airdrop_recipients; token_owners is read by no client; no client writes any of them.

-- ---------------------------------------------------------------------------------------------
-- The new tables
-- ---------------------------------------------------------------------------------------------
create table public.indexer_cursors (
  collection_id uuid primary key references public.collections (id) on delete cascade,
  chain_id integer not null check (chain_id > 0),
  contract text not null check (contract ~ '^0x[0-9a-f]{40}$'),
  from_block bigint not null check (from_block >= 0),
  indexed_block bigint not null,
  synced_at timestamptz,
  holders integer not null default 0 check (holders >= 0),
  updated_at timestamptz not null default now(),
  constraint indexer_cursors_block check (indexed_block >= from_block - 1),
  unique (chain_id, contract)
);

comment on table public.indexer_cursors is
  'One row per deployed collection the indexer reads: every log at or below indexed_block is recorded. synced_at is the chain''s time at the last pass that read the collection to the chain''s confirmation depth, null before the first. holders counts the distinct owners in token_owners other than the dead address. Written only by indexer_start and indexer_record.';

create table public.mints (
  tx_hash text not null check (tx_hash ~ '^0x[0-9a-f]{64}$'),
  log_index integer not null check (log_index >= 0),
  collection_id uuid not null references public.collections (id) on delete cascade,
  block bigint not null check (block >= 0),
  block_time timestamptz not null,
  recipient text not null check (recipient ~ '^0x[0-9a-f]{40}$'),
  vault text check (vault ~ '^0x[0-9a-f]{40}$'),
  group_id bigint not null check (group_id between 0 and 9007199254740991),
  amount integer not null check (amount >= 1),
  first_token_id bigint not null check (first_token_id >= 1),
  primary key (tx_hash, log_index)
);
create index mints_collection_recent_idx on public.mints (collection_id, block desc, log_index desc);

comment on table public.mints is
  'One row per TokensMinted or TokensDelegateMinted log, at the chain''s confirmation depth: the receiver of the tokens, the vault whose allowance a delegated mint used, the group, the amount and the first of its consecutive token ids. Written only by indexer_record.';

create table public.token_owners (
  collection_id uuid not null references public.collections (id) on delete cascade,
  token_id bigint not null check (token_id >= 1),
  owner text not null check (owner ~ '^0x[0-9a-f]{40}$'),
  block bigint not null check (block >= 0),
  log_index integer not null check (log_index >= 0),
  primary key (collection_id, token_id)
);
create index token_owners_owner_idx on public.token_owners (collection_id, owner);

comment on table public.token_owners is
  'Each minted token''s owner after the latest Transfer log at the chain''s confirmation depth. Read by no client; written only by indexer_record.';

create table public.airdrop_recipients (
  tx_hash text not null references public.airdrops (tx_hash) on delete cascade,
  first_token_id bigint not null check (first_token_id >= 1),
  collection_id uuid not null references public.collections (id) on delete cascade,
  recipient text not null check (recipient ~ '^0x[0-9a-f]{40}$'),
  tokens integer not null check (tokens >= 1),
  block bigint not null check (block >= 0),
  block_time timestamptz not null,
  primary key (tx_hash, first_token_id)
);
create index airdrop_recipients_collection_idx on public.airdrop_recipients (collection_id, block desc, first_token_id);

comment on table public.airdrop_recipients is
  'One row per run of consecutive token ids an airdropNFTs transaction minted to one address, from its Transfer logs. Written only by indexer_record.';

-- indexer_cursors, mints and airdrop_recipients: the owner reads; no client role writes (the revokes undo
-- Supabase's default grants on a new table).
alter table public.indexer_cursors enable row level security;
create policy "indexer_cursors: owner reads" on public.indexer_cursors
for select to authenticated
using ((select private.collection_owned(collection_id)));
revoke all on public.indexer_cursors from anon, authenticated;
grant select on public.indexer_cursors to authenticated;

alter table public.mints enable row level security;
create policy "mints: owner reads" on public.mints
for select to authenticated
using ((select private.collection_owned(collection_id)));
revoke all on public.mints from anon, authenticated;
grant select on public.mints to authenticated;

alter table public.airdrop_recipients enable row level security;
create policy "airdrop_recipients: owner reads" on public.airdrop_recipients
for select to authenticated
using ((select private.collection_owned(collection_id)));
revoke all on public.airdrop_recipients from anon, authenticated;
grant select on public.airdrop_recipients to authenticated;

-- token_owners: no policy and no grant; only the definer functions below read it.
alter table public.token_owners enable row level security;
revoke all on public.token_owners from anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- airdrops and withdrawals: the indexer's rows beside Cobweb's
-- ---------------------------------------------------------------------------------------------
alter table public.airdrops alter column sent_by drop not null;
alter table public.airdrops add column block_time timestamptz;

comment on table public.airdrops is
  'One row per airdropNFTs transaction: proven by Cobweb from its receipt and calldata (airdrop_record) or read from its logs by the indexer (indexer_record), whichever lands first. kind is burn when the only recipient is the dead address. sent_by is null for a row the indexer wrote, since logs do not name the sender; block_time is the block''s time, set by the indexer.';
comment on table public.withdrawals is
  'One row per withdrawMintFunds transaction, with the amount and payout address of its MintFundsWithdrawn log: proven by Cobweb from its receipt (withdrawal_record) or read from the log by the indexer (indexer_record), whichever lands first.';

-- ---------------------------------------------------------------------------------------------
-- What the functions answer, built once: a target and a summary
-- ---------------------------------------------------------------------------------------------
-- A deployed collection as the indexer reads it: { collectionId, contract, deployTx, fromBlock, indexedBlock,
-- syncedAt }, the last three null without a cursor, syncedAt in Unix seconds. Revoked from every client role: the
-- definer functions below call it.
create function private.indexer_target(p_collection_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'collectionId', c.id,
    'contract', d.contract_address,
    'deployTx', d.tx_hash,
    'fromBlock', k.from_block,
    'indexedBlock', k.indexed_block,
    'syncedAt', floor(extract(epoch from k.synced_at))::bigint
  )
  from public.collections c
  join public.deployments d on d.collection_id = c.id
  left join public.indexer_cursors k on k.collection_id = c.id
  where c.id = p_collection_id;
$$;

-- A cursor's summary: { collectionId, contract, holders, syncedAt, recentMints }, its 10 latest mints by block then
-- log index, newest first, each { tx, recipient, groupId, amount, firstTokenId, blockTime }, times in Unix seconds.
create function private.indexer_summary(p_collection_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'collectionId', k.collection_id,
    'contract', k.contract,
    'holders', k.holders,
    'syncedAt', floor(extract(epoch from k.synced_at))::bigint,
    'recentMints', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'tx', m.tx_hash, 'recipient', m.recipient, 'groupId', m.group_id, 'amount', m.amount,
            'firstTokenId', m.first_token_id, 'blockTime', floor(extract(epoch from m.block_time))::bigint
          )
          order by m.block desc, m.log_index desc
        )
        from (
          select * from public.mints latest
          where latest.collection_id = k.collection_id
          order by latest.block desc, latest.log_index desc
          limit 10
        ) m
      ),
      '[]'::jsonb
    )
  )
  from public.indexer_cursors k
  where k.collection_id = p_collection_id;
$$;

revoke all on function private.indexer_target(uuid) from public, anon, authenticated;
revoke all on function private.indexer_summary(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- indexer_targets: what the indexer reads on a chain
-- ---------------------------------------------------------------------------------------------
-- Service role only. Every collection deployed with a deployments row on the chain, oldest deploy first, with its
-- cursor when it has one.
create function public.indexer_targets(p_chain_id integer)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(private.indexer_target(c.id) order by d.deployed_at, c.id), '[]'::jsonb)
  from public.collections c
  join public.deployments d on d.collection_id = c.id
  where c.status = 'deployed' and d.chain_id = p_chain_id;
$$;

revoke all on function public.indexer_targets(integer) from public, anon, authenticated;
grant execute on function public.indexer_targets(integer) to service_role;

-- ---------------------------------------------------------------------------------------------
-- indexer_start: a collection's cursor, at its deploy block
-- ---------------------------------------------------------------------------------------------
-- Service role only. The cursor takes the deployment's chain and contract, starts at p_from_block (the deploy
-- transaction's block, which the indexer reads from its receipt) and is indexed one below it. A cursor already
-- there is kept as it is. Answers the cursor as indexer_targets lists it.
create function public.indexer_start(p_collection_id uuid, p_from_block bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deployment public.deployments;
begin
  select d.* into v_deployment
  from public.deployments d
  where d.collection_id = p_collection_id;
  if not found then
    raise exception 'The contract is not deployed yet.' using errcode = '23514';
  end if;
  insert into public.indexer_cursors (collection_id, chain_id, contract, from_block, indexed_block)
  values (p_collection_id, v_deployment.chain_id, v_deployment.contract_address, p_from_block, p_from_block - 1)
  on conflict (collection_id) do nothing;
  return private.indexer_target(p_collection_id);
end;
$$;

revoke all on function public.indexer_start(uuid, bigint) from public, anon, authenticated;
grant execute on function public.indexer_start(uuid, bigint) to service_role;

-- ---------------------------------------------------------------------------------------------
-- indexer_record: one segment of one scan, in one transaction
-- ---------------------------------------------------------------------------------------------
-- Service role only. p_records is { mints, owners, airdrops, withdrawals } (docs/specs/2026-10-16-indexer-overview.md,
-- section 4.3), addresses lowercase, times in Unix seconds. The cursors are locked in id order, so two writers never
-- deadlock; a write that would leave a gap below p_from_block, or names a collection outside p_collections, is
-- refused. Every row is keyed so that a log read twice, a range read again and two writers at once leave one row
-- each: a mint by its transaction and log index, an airdrop and a withdrawal by their transaction (the first row
-- wins, Cobweb's or the indexer's; a transaction's first airdrop when it holds two), a recipient row by its
-- transaction and first token id, and a token's owner changes only for a later block and log index. Answers
-- { "<collection id>": <summary> } for each collection a record names.
create function public.indexer_record(
  p_chain_id integer,
  p_from_block bigint,
  p_to_block bigint,
  p_synced_at timestamptz,
  p_collections uuid[],
  p_records jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_records jsonb := coalesce(p_records, '{}'::jsonb);
  v_wanted integer;
  v_found integer;
begin
  perform 1
  from public.indexer_cursors k
  where k.collection_id = any(p_collections)
  order by k.collection_id
  for update;
  select count(distinct c.id) into v_wanted from unnest(p_collections) as c(id);
  select count(*) into v_found
  from public.indexer_cursors k
  where k.collection_id = any(p_collections) and k.chain_id = p_chain_id;
  if p_collections is null or v_found <> v_wanted then
    raise exception 'A collection is not indexed on this chain.' using errcode = '23514';
  end if;
  if p_from_block is null or p_to_block is null or p_to_block < p_from_block or exists (
    select 1 from public.indexer_cursors k
    where k.collection_id = any(p_collections) and k.indexed_block < p_from_block - 1
  ) then
    raise exception 'The indexer would skip blocks.' using errcode = '23514';
  end if;
  if exists (
    select 1 from jsonb_path_query(v_records, '$.*[*].collectionId') as r(id)
    where (r.id #>> '{}')::uuid <> all(p_collections)
  ) then
    raise exception 'A record names a collection outside this write.' using errcode = '23514';
  end if;

  insert into public.mints (
    tx_hash, log_index, collection_id, block, block_time, recipient, vault, group_id, amount, first_token_id
  )
  select m.tx, m."logIndex", m."collectionId", m.block, to_timestamp(m."blockTime"), m.recipient, m.vault,
    m."groupId", m.amount, m."firstTokenId"
  from jsonb_to_recordset(coalesce(v_records->'mints', '[]'::jsonb)) as m(
    tx text, "logIndex" integer, "collectionId" uuid, block bigint, "blockTime" bigint, recipient text, vault text,
    "groupId" bigint, amount integer, "firstTokenId" bigint
  )
  on conflict do nothing;

  insert into public.token_owners as t (collection_id, token_id, owner, block, log_index)
  select distinct on (o."collectionId", o."tokenId") o."collectionId", o."tokenId", o.owner, o.block, o."logIndex"
  from jsonb_to_recordset(coalesce(v_records->'owners', '[]'::jsonb)) as o(
    "collectionId" uuid, "tokenId" bigint, owner text, block bigint, "logIndex" integer
  )
  order by o."collectionId", o."tokenId", o.block desc, o."logIndex" desc
  on conflict (collection_id, token_id) do update
  set owner = excluded.owner, block = excluded.block, log_index = excluded.log_index
  where (t.block, t.log_index) < (excluded.block, excluded.log_index);

  insert into public.airdrops as a (
    tx_hash, collection_id, kind, recipients, tokens, fee_paid_wei, first_token_id, last_token_id, block, sent_by,
    block_time
  )
  select distinct on (r.tx) r.tx, r."collectionId", r.kind, r.recipients, r.tokens, r."feePaidWei",
    r."firstTokenId", r."lastTokenId", r.block, null, to_timestamp(r."blockTime")
  from jsonb_to_recordset(coalesce(v_records->'airdrops', '[]'::jsonb)) as r(
    tx text, "collectionId" uuid, block bigint, "blockTime" bigint, kind text, recipients integer, tokens integer,
    "feePaidWei" numeric, "firstTokenId" bigint, "lastTokenId" bigint
  )
  order by r.tx, r."firstTokenId"
  on conflict (tx_hash) do update
  set block_time = excluded.block_time
  where a.block_time is null;

  insert into public.airdrop_recipients (tx_hash, first_token_id, collection_id, recipient, tokens, block, block_time)
  select r.tx, run."firstTokenId", r."collectionId", run.recipient, run.tokens, r.block, to_timestamp(r."blockTime")
  from jsonb_to_recordset(coalesce(v_records->'airdrops', '[]'::jsonb)) as r(
    tx text, "collectionId" uuid, block bigint, "blockTime" bigint, runs jsonb
  )
  cross join lateral jsonb_to_recordset(coalesce(r.runs, '[]'::jsonb)) as run(
    recipient text, tokens integer, "firstTokenId" bigint
  )
  on conflict do nothing;

  insert into public.withdrawals (tx_hash, collection_id, amount_wei, payout_address, block)
  select w.tx, w."collectionId", w."amountWei", w."payoutAddress", w.block
  from jsonb_to_recordset(coalesce(v_records->'withdrawals', '[]'::jsonb)) as w(
    tx text, "collectionId" uuid, block bigint, "payoutAddress" text, "amountWei" numeric
  )
  on conflict do nothing;

  update public.indexer_cursors k
  set holders = (
    select count(distinct o.owner)
    from public.token_owners o
    where o.collection_id = k.collection_id and o.owner <> '0x000000000000000000000000000000000000dead'
  )
  where k.collection_id in (
    select o."collectionId"
    from jsonb_to_recordset(coalesce(v_records->'owners', '[]'::jsonb)) as o("collectionId" uuid)
  );

  update public.indexer_cursors k
  set indexed_block = greatest(k.indexed_block, p_to_block),
      synced_at = greatest(k.synced_at, p_synced_at),
      updated_at = now()
  where k.collection_id = any(p_collections);

  return (
    select coalesce(jsonb_object_agg(named.id::text, private.indexer_summary(named.id)), '{}'::jsonb)
    from (
      select distinct (r.id #>> '{}')::uuid as id
      from jsonb_path_query(v_records, '$.*[*].collectionId') as r(id)
    ) as named
  );
end;
$$;

revoke all on function public.indexer_record(integer, bigint, bigint, timestamptz, uuid[], jsonb)
  from public, anon, authenticated;
grant execute on function public.indexer_record(integer, bigint, bigint, timestamptz, uuid[], jsonb) to service_role;

-- ---------------------------------------------------------------------------------------------
-- indexer_summaries: every cursor of a chain as indexer_record answers it
-- ---------------------------------------------------------------------------------------------
-- Service role only: what the freshness server loads at start, so the state body carries the holders and the
-- latest mints from its memory.
create function public.indexer_summaries(p_chain_id integer)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(private.indexer_summary(k.collection_id) order by k.collection_id), '[]'::jsonb)
  from public.indexer_cursors k
  where k.chain_id = p_chain_id;
$$;

revoke all on function public.indexer_summaries(integer) from public, anon, authenticated;
grant execute on function public.indexer_summaries(integer) to service_role;
