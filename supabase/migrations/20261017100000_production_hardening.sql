-- Production hardening in code (docs/specs/2026-10-17-production-hardening.md, section 4): the per-wallet cap on
-- collections that are not deployed, read from profiles.draft_cap by a trigger that serializes one owner's inserts;
-- cobweb_indexer, the login role the freshness server's indexer connects as, which executes its four functions and
-- nothing else; and the layer sources' lifecycle: collections.art_sources_deleted_at, the two service-role functions
-- the daily source sweep calls, and the triggers that refuse a new upload or render job once a collection's
-- original files are gone.

-- ---------------------------------------------------------------------------------------------
-- The draft cap (section 4.1)
-- ---------------------------------------------------------------------------------------------
alter table public.profiles
  add column draft_cap integer not null default 20 check (draft_cap between 0 and 1000);

comment on column public.profiles.draft_cap is
  'How many collections that are not deployed the wallet may hold; the collections insert trigger refuses the next. The owner reads it through its select grant; only the service role changes it, so support can raise one wallet''s cap.';

-- Security invoker, as collections_guard_frozen_fields: a creator counts the rows row-level security shows it, its
-- own, and the service role sees all of one owner's.
create function public.collections_guard_draft_cap()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_cap integer;
  v_held integer;
begin
  -- One owner's inserts run one at a time, so two at once cannot both take the last place.
  perform pg_advisory_xact_lock(hashtextextended('collections_draft_cap:' || new.owner_id::text, 0));
  v_cap := coalesce((select p.draft_cap from public.profiles p where p.id = new.owner_id), 20);
  select count(*) into v_held
  from public.collections c
  where c.owner_id = new.owner_id and c.status <> 'deployed';
  if v_held >= v_cap then
    raise exception 'This wallet holds its limit of collections that are not deployed.'
      using errcode = '23514', detail = v_cap::text;
  end if;
  return new;
end;
$$;

create trigger collections_guard_draft_cap
before insert on public.collections
for each row execute function public.collections_guard_draft_cap();

-- ---------------------------------------------------------------------------------------------
-- The indexer's role (section 4.2)
-- ---------------------------------------------------------------------------------------------
-- No password: no migration holds a secret, and a role without one cannot log in until the owner sets it. A role
-- outlives `supabase db reset`, hence the existence check.
do $$
begin
  if not exists (select 1 from pg_catalog.pg_roles r where r.rolname = 'cobweb_indexer') then
    create role cobweb_indexer with login noinherit nocreatedb nocreaterole nobypassrls connection limit 8;
  end if;
end;
$$;
alter role cobweb_indexer set statement_timeout = '10s';
alter role cobweb_indexer set idle_in_transaction_session_timeout = '30s';

comment on role cobweb_indexer is
  'The freshness server''s indexer: executes indexer_targets, indexer_start, indexer_record and indexer_summaries and nothing else. It logs in with a password the owner sets outside git (alter role cobweb_indexer with password ...), through the session pooler as cobweb_indexer.<project ref>, from the server''s INDEXER_DATABASE_URL.';

-- The four functions are security definer, so the role needs no table grant; Supabase's default privileges name
-- anon, authenticated and service_role, never a new role. service_role keeps its execute grants.
grant usage on schema public to cobweb_indexer;
grant execute on function public.indexer_targets(integer) to cobweb_indexer;
grant execute on function public.indexer_start(uuid, bigint) to cobweb_indexer;
grant execute on function public.indexer_record(integer, bigint, bigint, timestamptz, uuid[], jsonb) to cobweb_indexer;
grant execute on function public.indexer_summaries(integer) to cobweb_indexer;

-- ---------------------------------------------------------------------------------------------
-- The layer sources (section 4.3)
-- ---------------------------------------------------------------------------------------------
-- The owner reads it through the table's select grant; no client role writes it, since the reservation
-- migration's column grants name the columns a creator may set.
alter table public.collections add column art_sources_deleted_at timestamptz;

comment on column public.collections.art_sources_deleted_at is
  'When the daily source sweep deleted the collection''s original files (the layers, assets and placeholders folders of the art bucket), 90 days after its deploy and its last real render; null before. Set only by collection_sources_deleted.';

-- The collections whose original files are due for deletion, oldest deploy first, at most p_limit: deployed, not
-- marked, deployed at least 90 days ago, with a real render job done whose latest finish is at least 90 days ago
-- and no real job outside done and failed. objects and bytes count the uploads rows of the three kinds the sweep
-- deletes. 90 days is SOURCE_RETENTION_DAYS in apps/web/src/lib/storage/source-sweep.ts.
create function public.collections_sources_due(p_limit integer)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with cutoff as (select now() - interval '90 days' as at),
  due as (
    select c.id, d.deployed_at
    from public.collections c
    join public.deployments d on d.collection_id = c.id
    cross join cutoff
    where c.status = 'deployed'
      and c.art_sources_deleted_at is null
      and d.deployed_at <= cutoff.at
      and (
        select max(j.finished_at) from public.render_jobs j
        where j.collection_id = c.id and j.kind = 'real' and j.state = 'done'
      ) <= cutoff.at
      and not exists (
        select 1 from public.render_jobs j
        where j.collection_id = c.id and j.kind = 'real' and j.state not in ('done', 'failed')
      )
    order by d.deployed_at, c.id
    limit greatest(p_limit, 0)
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'collectionId', due.id,
        'objects', (
          select count(*) from public.uploads u
          where u.collection_id = due.id and u.kind in ('layer_image', 'asset', 'placeholder')
        ),
        'bytes', (
          select coalesce(sum(u.bytes), 0) from public.uploads u
          where u.collection_id = due.id and u.kind in ('layer_image', 'asset', 'placeholder')
        )
      )
      order by due.deployed_at, due.id
    ),
    '[]'::jsonb
  )
  from due;
$$;

revoke all on function public.collections_sources_due(integer) from public, anon, authenticated;
grant execute on function public.collections_sources_due(integer) to service_role;

-- Marks a collection's original files deleted, under the collection's lock: false when the mark is set already,
-- true when it sets it, refused when the rule above does not hold. The sweep calls it once the three folders list
-- empty, so a failed run leaves no mark and the next resumes. 90 days is SOURCE_RETENTION_DAYS in
-- apps/web/src/lib/storage/source-sweep.ts.
create function public.collection_sources_deleted(p_collection_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cutoff timestamptz := now() - interval '90 days';
  v_status public.collection_status;
  v_marked timestamptz;
begin
  select c.status, c.art_sources_deleted_at into v_status, v_marked
  from public.collections c where c.id = p_collection_id for update;
  if found and v_marked is not null then
    return false;
  end if;
  if not found
    or v_status <> 'deployed'
    or not exists (
      select 1 from public.deployments d where d.collection_id = p_collection_id and d.deployed_at <= v_cutoff
    )
    or coalesce((
      select max(j.finished_at) from public.render_jobs j
      where j.collection_id = p_collection_id and j.kind = 'real' and j.state = 'done'
    ) > v_cutoff, true)
    or exists (
      select 1 from public.render_jobs j
      where j.collection_id = p_collection_id and j.kind = 'real' and j.state not in ('done', 'failed')
    )
  then
    raise exception 'This collection''s art files are not due for deletion.' using errcode = '23514';
  end if;
  update public.collections set art_sources_deleted_at = now() where id = p_collection_id;
  return true;
end;
$$;

revoke all on function public.collection_sources_deleted(uuid) from public, anon, authenticated;
grant execute on function public.collection_sources_deleted(uuid) to service_role;

-- Once a collection is marked, a new uploads row or render job for it is refused: the app reaches neither path
-- after a final render, since the art stays locked, and these stop a direct call from writing rows whose files are
-- gone.
create function public.refuse_after_sources_deleted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.collections c
    where c.id = new.collection_id and c.art_sources_deleted_at is not null
  ) then
    raise exception 'This collection''s art files were deleted 90 days after its deploy, so its art cannot change.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.refuse_after_sources_deleted() from public, anon, authenticated;

create trigger uploads_refuse_after_sources_deleted
before insert on public.uploads
for each row execute function public.refuse_after_sources_deleted();

create trigger render_jobs_refuse_after_sources_deleted
before insert on public.render_jobs
for each row execute function public.refuse_after_sources_deleted();
