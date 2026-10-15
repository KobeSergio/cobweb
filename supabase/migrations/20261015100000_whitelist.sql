-- Whitelist (docs/specs/2026-10-15-whitelist.md, section 4): whitelist_entries keeps the creator's list (the
-- address and its quota, 0 for a removal staged on a written address) and a copy of what the chain was last
-- proven to hold (written_quota, written_tx, written_at), set together and written only by
-- whitelist_chunk_record after a receipt and its calldata prove the chunk. The owner's client inserts the
-- list's four columns, updates quota alone and deletes; adds go through whitelist_entries_add, which locks the
-- group for the 10,000 cap.

-- ---------------------------------------------------------------------------------------------
-- whitelist_entries: a quota of 0, the copies and their checks, the narrowed grants
-- ---------------------------------------------------------------------------------------------
alter table public.whitelist_entries drop constraint whitelist_entries_quota_check;
alter table public.whitelist_entries
  add constraint whitelist_entries_quota_check check (quota >= 0),
  add column written_quota integer check (written_quota >= 0),
  add column written_tx text check (written_tx ~ '^0x[0-9a-f]{64}$'),
  add column written_at timestamptz,
  add constraint whitelist_entries_written_together check (
    (written_quota is null) = (written_tx is null) and (written_tx is null) = (written_at is null));

comment on table public.whitelist_entries is
  'One row per address on a whitelist phase. The list, changed by the owner: mint_group_id, collection_id, wallet_address and quota (1 to 10,000, or 0 for a removal staged on a written address). A copy of the chain, written only by whitelist_chunk_record after a receipt and its calldata prove the chunk: written_quota, written_tx and written_at, set together. An entry is written when written_quota equals quota.';

-- The owner reads and deletes as before, inserts the list's four columns and updates quota alone. The policy
-- "whitelist_entries: owner all" stays: it scopes what the grants allow to the owner's rows.
revoke insert, update on public.whitelist_entries from authenticated;
grant insert (mint_group_id, collection_id, wallet_address, quota) on public.whitelist_entries to authenticated;
grant update (quota) on public.whitelist_entries to authenticated;

-- ---------------------------------------------------------------------------------------------
-- whitelist_entries_add: the owner's adds and quota changes, at most 10,000 rows per group
-- ---------------------------------------------------------------------------------------------
-- Security invoker for authenticated only, as mint_group_move: the owner's policy and column grants apply, so
-- another creator's group is not found. p_rows is [{ address, quota }], addresses lowercase. A listed
-- address takes the new quota where it differs (a staged removal re-added gets its quota back); the copies
-- never change here. The group row is locked, so two adds to one group never pass the cap together; past
-- 10,000 rows nothing is kept. Answers the rows it inserted and the rows whose quota it changed.
create function public.whitelist_entries_add(p_collection_id uuid, p_onchain_id integer, p_rows jsonb)
returns table (added integer, updated integer)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_group public.mint_groups;
begin
  select g.* into v_group
  from public.mint_groups g
  where g.collection_id = p_collection_id and g.onchain_id = p_onchain_id
  for no key update;
  if not found then
    raise exception 'phase not found' using errcode = '42501';
  end if;
  if v_group.onchain_id = 0 then
    raise exception 'The public sale has no whitelist.' using errcode = '23514';
  end if;
  if not exists (select 1 from public.deployments d where d.collection_id = p_collection_id) then
    raise exception 'The contract is not deployed yet.' using errcode = '23514';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_rows) as r(address text, quota integer)
    where r.quota is null or r.quota < 1 or r.quota > 10000
  ) then
    raise exception 'The quota must be 1 to 10,000.' using errcode = '23514';
  end if;
  with upserted as (
    insert into public.whitelist_entries as e (mint_group_id, collection_id, wallet_address, quota)
    select v_group.id, p_collection_id, r.address, r.quota
    from jsonb_to_recordset(p_rows) as r(address text, quota integer)
    on conflict (mint_group_id, wallet_address) do update
      set quota = excluded.quota
      where e.quota is distinct from excluded.quota
    returning (xmax = 0) as inserted
  )
  select (count(*) filter (where u.inserted))::integer, (count(*) filter (where not u.inserted))::integer
  into added, updated
  from upserted u;
  if (select count(*) from public.whitelist_entries e where e.mint_group_id = v_group.id) > 10000 then
    raise exception 'A whitelist holds up to 10,000 addresses.' using errcode = '23514';
  end if;
  return next;
end;
$$;

revoke all on function public.whitelist_entries_add(uuid, integer, jsonb) from public, anon, service_role;
grant execute on function public.whitelist_entries_add(uuid, integer, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- whitelist_chunk_record: the copies of a chunk the server proved from its receipt and calldata
-- ---------------------------------------------------------------------------------------------
-- Service role only. p_rows is [{ address, quota }], the pairs decoded from a transaction whose receipt the
-- server proved, addresses lowercase; p_owner must equal collections.owner_id. A pair above 0 writes its
-- copies, creating the row with that quota when Cobweb lists none (a chunk sent outside Cobweb); a pair of 0
-- writes the copies of a listed row only; then a row of p_rows whose written and listed quotas are both 0 is
-- deleted (its removal is done). Copies are written only where they differ, so a second record of the same
-- transaction answers 0 and keeps written_at. Answers how many entries' copies it wrote.
create function public.whitelist_chunk_record(
  p_collection_id uuid,
  p_owner uuid,
  p_onchain_id integer,
  p_tx text,
  p_rows jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_collection public.collections;
  v_group_id uuid;
  v_set integer;
  v_zeroed integer;
begin
  v_collection := private.lock_owned_collection(p_collection_id, p_owner);
  if not exists (select 1 from public.deployments d where d.collection_id = v_collection.id) then
    raise exception 'The contract is not deployed yet.' using errcode = '23514';
  end if;
  if p_tx is null or p_tx !~ '^0x[0-9a-f]{64}$' then
    raise exception 'The transaction did not make this change.' using errcode = '23514';
  end if;
  select g.id into v_group_id
  from public.mint_groups g
  where g.collection_id = v_collection.id and g.onchain_id = p_onchain_id;
  if not found then
    raise exception 'phase not found' using errcode = '42501';
  end if;
  with written as (
    insert into public.whitelist_entries as e
      (mint_group_id, collection_id, wallet_address, quota, written_quota, written_tx, written_at)
    select v_group_id, v_collection.id, r.address, r.quota, r.quota, p_tx, now()
    from jsonb_to_recordset(p_rows) as r(address text, quota integer)
    where r.quota > 0
    on conflict (mint_group_id, wallet_address) do update
      set written_quota = excluded.written_quota,
          written_tx = excluded.written_tx,
          written_at = excluded.written_at
      where e.written_quota is distinct from excluded.written_quota
        or e.written_tx is distinct from excluded.written_tx
    returning 1
  )
  select count(*)::integer into v_set from written;
  update public.whitelist_entries e
  set written_quota = 0, written_tx = p_tx, written_at = now()
  from jsonb_to_recordset(p_rows) as r(address text, quota integer)
  where r.quota = 0
    and e.mint_group_id = v_group_id
    and e.wallet_address = r.address
    and (e.written_quota is distinct from 0 or e.written_tx is distinct from p_tx);
  get diagnostics v_zeroed = row_count;
  delete from public.whitelist_entries e
  using jsonb_to_recordset(p_rows) as r(address text, quota integer)
  where e.mint_group_id = v_group_id
    and e.wallet_address = r.address
    and e.written_quota = 0
    and e.quota = 0;
  return v_set + v_zeroed;
end;
$$;

revoke all on function public.whitelist_chunk_record(uuid, uuid, integer, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.whitelist_chunk_record(uuid, uuid, integer, text, jsonb) to service_role;
