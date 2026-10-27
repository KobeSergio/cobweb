-- Holder snapshots, rate limited per owner (docs/specs/2026-10-15-whitelist.md, section 6.4, note of 27 October
-- 2026). A snapshot makes the server read up to 20,000 token owners over the private RPC endpoints for up to 300
-- seconds, and the server actions have no rate limit of their own, so the limit lives here, where every instance
-- sees the same count. snapshot_take records one run for the signed-in owner of a collection and says whether it
-- fits: at most 5 in any hour. A run counts when it is taken, whether or not the chain read then succeeds, so
-- a contract that makes the read fail cannot be retried for free. The owner's rows older than an hour are
-- deleted by the same call, which keeps the table at 5 rows an owner at most.

create table public.snapshot_runs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  collection_id uuid not null references public.collections (id) on delete cascade,
  taken_at timestamptz not null default now()
);

create index snapshot_runs_owner_taken_idx on public.snapshot_runs (owner_id, taken_at);

comment on table public.snapshot_runs is
  'One row per holder snapshot an owner took in the last hour, written only by snapshot_take, which allows 5 an hour. No client reads or writes it.';

-- No policy and no grant: only snapshot_take touches it.
alter table public.snapshot_runs enable row level security;
revoke all on public.snapshot_runs from anon, authenticated;

create function public.snapshot_take(p_collection_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := (select auth.uid());
  v_recent integer;
begin
  if v_owner is null or not (select private.collection_owned(p_collection_id)) then
    raise exception 'This collection could not be found.' using errcode = '42501';
  end if;
  -- One call at a time for an owner, so two at once cannot both see room for the last run.
  perform pg_advisory_xact_lock(hashtextextended('snapshot_take:' || v_owner::text, 0));
  delete from public.snapshot_runs r
  where r.owner_id = v_owner and r.taken_at <= now() - interval '1 hour';
  select count(*)::integer into v_recent from public.snapshot_runs r where r.owner_id = v_owner;
  if v_recent >= 5 then
    return false;
  end if;
  insert into public.snapshot_runs (owner_id, collection_id) values (v_owner, p_collection_id);
  return true;
end;
$$;

comment on function public.snapshot_take(uuid) is
  'Records a holder snapshot for the signed-in owner of the collection and returns true, or returns false without recording when the owner already took 5 in the last hour. Refuses a collection the caller does not own.';

revoke all on function public.snapshot_take(uuid) from public, anon, service_role;
grant execute on function public.snapshot_take(uuid) to authenticated;
