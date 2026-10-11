-- Render job state (docs/specs/2026-10-12-render-job-state.md, sections 4 to 8): the functions the
-- render worker calls as it claims a paid or waived job, seeds and runs its batches, flips the job
-- to finalizing when the last batch lands, stores the CIDs and records a failure, and the one the
-- creator calls to retry a failed render. The five service functions take the job id and nothing
-- else about the caller: only the service role runs them (the worker authenticates with it, as the
-- lock functions' server code does). art_render_retry runs as the signed-in creator and checks the
-- owner through private.lock_owned_collection, as art_unlock does. A function that writes the
-- collection row locks it first and the job row second, the order art_unlock uses, so no two
-- functions wait on each other in opposite orders; art_batch_start and art_batch_done lock the job
-- row alone, which serializes two deliveries of one job. The collection follows a real job:
-- rendering while it renders or finalizes, rendered once done, art_locked again after a final
-- failure. A placeholder job never moves the collection's status, and no write moves a deployed
-- collection: the reveal flow (Phase 5) owns its status.

-- ---------------------------------------------------------------------------------------------
-- render_jobs: the base URI, the placeholder image directory, the collage and the error code
-- ---------------------------------------------------------------------------------------------
alter table public.render_jobs
  -- Each batch directory has its own CID on its batch row (section 5).
  drop column images_cid,
  -- What the contract gets: ipfs://<cid>/ for generative and 1/1, ipfs://<cid>/metadata.json for
  -- a single asset and the placeholder.
  add column base_uri text check (base_uri is null or base_uri ~ '^ipfs://[a-z2-7]{59}/'),
  -- The placeholder's image directory; set on placeholder jobs only. Its metadata CID is metadata_cid.
  add column placeholder_image_cid text
    check (placeholder_image_cid is null or placeholder_image_cid ~ '^[a-z2-7]{59}$'),
  -- The storage key of the preview collage the worker wrote; null when there is none.
  add column collage_key text check (collage_key is null or char_length(collage_key) between 1 and 256),
  -- RenderProblem.code, or the worker's own (dead-letter, payment-mismatch, cid-mismatch). error
  -- keeps the sentence.
  add column error_code text check (error_code is null or char_length(error_code) between 1 and 40),
  -- How many times the creator retried the job; art_render_retry stops at five.
  add column retries integer not null default 0,
  add constraint render_jobs_retries_range check (retries between 0 and 5),
  add constraint render_jobs_metadata_cid_valid
    check (metadata_cid is null or metadata_cid ~ '^[a-z2-7]{59}$'),
  -- The base URI is the directory of the metadata CID, so the two cannot name different uploads.
  add constraint render_jobs_base_uri_matches_metadata
    check (base_uri is null or metadata_cid is null or starts_with(base_uri, 'ipfs://' || metadata_cid || '/')),
  drop constraint render_jobs_done_has_metadata,
  add constraint render_jobs_done_complete
    check (state <> 'done' or (metadata_cid is not null and base_uri is not null));

-- ---------------------------------------------------------------------------------------------
-- render_batches: the CAR size, the error code, the run's times, a CID that is one
-- ---------------------------------------------------------------------------------------------
alter table public.render_batches
  add column images_size bigint check (images_size is null or images_size >= 0),
  add column error_code text check (error_code is null or char_length(error_code) between 1 and 40),
  add column started_at timestamptz,
  add column finished_at timestamptz,
  add constraint render_batches_images_cid_valid check (images_cid is null or images_cid ~ '^[a-z2-7]{59}$'),
  -- A done batch has its directory: the job's list of batch CIDs never has a hole.
  add constraint render_batches_done_has_cid check (state <> 'done' or images_cid is not null);

-- ---------------------------------------------------------------------------------------------
-- The collection lock the writing service functions start with
-- ---------------------------------------------------------------------------------------------

-- Locks the job's collections row `for no key update`, before the caller locks the job row: the
-- order art_unlock, art_render_retry and the lock-and-pay functions take them (collection, then
-- job), so no two functions wait on each other in opposite orders. A job's collection_id never
-- changes, so reading it unlocked is safe. An unknown job locks nothing; the caller refuses it.
-- Security invoker: it runs with the rights of the definer function that calls it.
create function private.lock_job_collection(p_job_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform 1
  from public.collections c
  where c.id = (select j.collection_id from public.render_jobs j where j.id = p_job_id)
  for no key update;
end;
$$;

revoke all on function private.lock_job_collection(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- art_claim_render: a paid or waived job starts rendering and gets its batch rows, once
-- ---------------------------------------------------------------------------------------------
create function public.art_claim_render(p_job_id uuid)
returns public.render_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.render_jobs;
begin
  perform private.lock_job_collection(p_job_id);
  select j.* into v_job from public.render_jobs j where j.id = p_job_id for update;
  if not found or v_job.state not in ('paid', 'waived', 'rendering') then
    raise exception 'This job is not ready to render.' using errcode = '23514';
  end if;
  -- A redelivered claim: the batches are seeded already.
  if v_job.state = 'rendering' then
    return v_job;
  end if;
  -- Numeric division: integer division would turn 3 / 100 into 0 before ceil saw it.
  if v_job.batches_total <> ceil(v_job.token_count::numeric / v_job.batch_size)::integer then
    raise exception 'The batch count does not match the token count.' using errcode = '23514';
  end if;
  insert into public.render_batches (job_id, index, state, first_token_id, last_token_id)
  select v_job.id, g.i, 'queued', g.i * v_job.batch_size + 1, least((g.i + 1) * v_job.batch_size, v_job.token_count)
  from generate_series(0, v_job.batches_total - 1) as g(i);
  update public.render_jobs j
  set state = 'rendering', started_at = now(), batches_done = 0, error = null, error_code = null
  where j.id = v_job.id
  returning * into v_job;
  -- A deployed collection keeps its status: the reveal flow (Phase 5) owns it.
  if v_job.kind = 'real' then
    update public.collections c
    set status = 'rendering'
    where c.id = v_job.collection_id and c.status <> 'deployed';
  end if;
  return v_job;
end;
$$;

revoke all on function public.art_claim_render(uuid) from public, anon, authenticated;
grant execute on function public.art_claim_render(uuid) to service_role;

-- ---------------------------------------------------------------------------------------------
-- art_batch_start: a batch's run begins; a redelivered finished batch is skipped
-- ---------------------------------------------------------------------------------------------
create function public.art_batch_start(p_job_id uuid, p_index integer)
returns public.render_batches
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.render_jobs;
  v_batch public.render_batches;
begin
  select j.* into v_job from public.render_jobs j where j.id = p_job_id for update;
  if not found then
    raise exception 'This job is not rendering.' using errcode = '23514';
  end if;
  select b.* into v_batch
  from public.render_batches b
  where b.job_id = p_job_id and b.index = p_index
  for update;
  -- A finished batch is answered as it is, whatever the job's state: a start redelivered after the
  -- flip to finalizing (or after the finish) is a duplicate, not an error.
  if found and v_batch.state = 'done' then
    return v_batch;
  end if;
  if v_job.state <> 'rendering' then
    raise exception 'This job is not rendering.' using errcode = '23514';
  end if;
  if not found then
    raise exception 'There is no such batch.' using errcode = '23514';
  end if;
  if v_batch.state = 'running' then
    -- Another copy is running: counted, otherwise untouched. The worker's output is idempotent.
    update public.render_batches b
    set attempts = b.attempts + 1
    where b.job_id = p_job_id and b.index = p_index
    returning * into v_batch;
  else
    update public.render_batches b
    set state = 'running', attempts = b.attempts + 1, started_at = now(), finished_at = null,
        error = null, error_code = null
    where b.job_id = p_job_id and b.index = p_index
    returning * into v_batch;
  end if;
  return v_batch;
end;
$$;

revoke all on function public.art_batch_start(uuid, integer) from public, anon, authenticated;
grant execute on function public.art_batch_start(uuid, integer) to service_role;

-- ---------------------------------------------------------------------------------------------
-- art_batch_done: a batch's directory is recorded once; the last one flips the job to finalizing
-- ---------------------------------------------------------------------------------------------
-- The output columns are named as the spec names them, and batches_done is also a render_jobs
-- column: the directive and the table aliases keep every reference in the body on the column.
create function public.art_batch_done(p_job_id uuid, p_index integer, p_images_cid text, p_images_size bigint)
returns table (batches_done integer, last boolean)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_job public.render_jobs;
  v_batch public.render_batches;
  v_done integer;
  v_flipped uuid;
begin
  select j.* into v_job from public.render_jobs j where j.id = p_job_id for update;
  if not found or v_job.state not in ('rendering', 'finalizing') then
    raise exception 'This job is not rendering.' using errcode = '23514';
  end if;
  select b.* into v_batch
  from public.render_batches b
  where b.job_id = p_job_id and b.index = p_index
  for update;
  if not found then
    raise exception 'There is no such batch.' using errcode = '23514';
  end if;
  if v_batch.state = 'done' then
    if v_batch.images_cid is distinct from p_images_cid then
      raise exception 'This batch was already recorded with a different result.' using errcode = '23514';
    end if;
    -- A redelivered report of the same result: nothing changes, and it is never the last.
    return query select v_job.batches_done, false;
    return;
  end if;
  update public.render_batches b
  set state = 'done', images_cid = p_images_cid, images_size = p_images_size, finished_at = now(),
      error = null, error_code = null
  where b.job_id = p_job_id and b.index = p_index;
  -- Recounted from the rows, never incremented: a redelivery cannot count twice.
  select count(*)::integer into v_done
  from public.render_batches b
  where b.job_id = p_job_id and b.state = 'done';
  update public.render_jobs j set batches_done = v_done where j.id = p_job_id;
  -- The one conditional flip. Calls for the last two batches serialize on the job row lock taken
  -- above: the first sees one batch missing, the second sees the full count and flips.
  update public.render_jobs j
  set state = 'finalizing'
  where j.id = p_job_id and j.state = 'rendering' and j.batches_done = j.batches_total
  returning j.id into v_flipped;
  return query select v_done, v_flipped is not null;
end;
$$;

revoke all on function public.art_batch_done(uuid, integer, text, bigint) from public, anon, authenticated;
grant execute on function public.art_batch_done(uuid, integer, text, bigint) to service_role;

-- ---------------------------------------------------------------------------------------------
-- art_batch_failed: a batch's failure with its cause; a final one fails the job. A null index is
-- a job-level failure (the metadata step, or the worker's own checks), allowed only as final.
-- ---------------------------------------------------------------------------------------------
create function public.art_batch_failed(
  p_job_id uuid,
  p_index integer,
  p_code text,
  p_message text,
  p_final boolean
)
returns public.render_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.render_jobs;
  v_batch public.render_batches;
begin
  -- A job-level failure has no batch to retry: it ends the job or it is not reported.
  if p_index is null and p_final is not true then
    raise exception 'A job-level failure must be final.' using errcode = '23514';
  end if;
  -- A final failure writes the collection, so its row is locked before the job row.
  if p_final then
    perform private.lock_job_collection(p_job_id);
  end if;
  select j.* into v_job from public.render_jobs j where j.id = p_job_id for update;
  -- A final failure reported again for a job that already failed: the first code and message stay.
  if found and v_job.state = 'failed' and p_final then
    return v_job;
  end if;
  if not found or v_job.state not in ('rendering', 'finalizing') then
    raise exception 'This job is not rendering.' using errcode = '23514';
  end if;
  if p_index is not null then
    select b.* into v_batch
    from public.render_batches b
    where b.job_id = p_job_id and b.index = p_index
    for update;
    if not found then
      raise exception 'There is no such batch.' using errcode = '23514';
    end if;
    -- A failure reported after the batch's success is a worker bug, not a state to record.
    if v_batch.state = 'done' then
      raise exception 'This batch is already done.' using errcode = '23514';
    end if;
    update public.render_batches b
    set state = 'failed', error_code = coalesce(nullif(left(p_code, 40), ''), 'unknown'), error = p_message,
        finished_at = now()
    where b.job_id = p_job_id and b.index = p_index;
  end if;
  if p_final then
    update public.render_jobs j
    set state = 'failed', error_code = coalesce(nullif(left(p_code, 40), ''), 'unknown'), error = p_message,
        finished_at = now()
    where j.id = p_job_id
    returning * into v_job;
    -- A deployed collection keeps its status: the reveal flow (Phase 5) owns it.
    if v_job.kind = 'real' then
      update public.collections c
      set status = 'art_locked'
      where c.id = v_job.collection_id and c.status <> 'deployed';
    end if;
  end if;
  return v_job;
end;
$$;

revoke all on function public.art_batch_failed(uuid, integer, text, text, boolean) from public, anon, authenticated;
grant execute on function public.art_batch_failed(uuid, integer, text, text, boolean) to service_role;

-- ---------------------------------------------------------------------------------------------
-- art_render_finish: the metadata and base URI of a job whose batches are all done
-- ---------------------------------------------------------------------------------------------
create function public.art_render_finish(
  p_job_id uuid,
  p_metadata_cid text,
  p_base_uri text,
  p_placeholder_image_cid text default null,
  p_collage_key text default null
)
returns public.render_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.render_jobs;
begin
  perform private.lock_job_collection(p_job_id);
  select j.* into v_job from public.render_jobs j where j.id = p_job_id for update;
  if found and v_job.state = 'done' then
    if v_job.metadata_cid is not distinct from p_metadata_cid and v_job.base_uri is not distinct from p_base_uri then
      return v_job;
    end if;
    raise exception 'This job was already finished with a different result.' using errcode = '23514';
  end if;
  if not found or v_job.state <> 'finalizing' or exists (
    select 1 from public.render_batches b where b.job_id = p_job_id and b.state <> 'done'
  ) then
    raise exception 'This job has batches still rendering.' using errcode = '23514';
  end if;
  update public.render_jobs j
  set state = 'done',
      metadata_cid = p_metadata_cid,
      base_uri = p_base_uri,
      placeholder_image_cid = p_placeholder_image_cid,
      collage_key = p_collage_key,
      finished_at = now()
  where j.id = p_job_id
  returning * into v_job;
  -- A deployed collection keeps its status: the reveal flow (Phase 5) owns it.
  if v_job.kind = 'real' then
    update public.collections c
    set status = 'rendered'
    where c.id = v_job.collection_id and c.status <> 'deployed';
  end if;
  return v_job;
end;
$$;

revoke all on function public.art_render_finish(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.art_render_finish(uuid, text, text, text, text) to service_role;

-- ---------------------------------------------------------------------------------------------
-- art_render_retry: the creator retries a failed render; finished batches keep their CIDs
-- ---------------------------------------------------------------------------------------------
create function public.art_render_retry(p_collection_id uuid)
returns public.render_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_collection public.collections;
  v_job public.render_jobs;
begin
  -- The collection row first, then the job row: the order every writing function here uses.
  v_collection := private.lock_owned_collection(p_collection_id, (select auth.uid()));
  -- The collection's latest real job, or its placeholder job when the art is deferred and no real
  -- job exists. A job cancelled by an unlock counts here, so it is refused by name below.
  select j.* into v_job
  from public.render_jobs j
  where j.collection_id = v_collection.id and j.kind = 'real'
  order by j.created_at desc, j.id desc
  limit 1
  for update;
  if not found and v_collection.art_deferred then
    select j.* into v_job
    from public.render_jobs j
    where j.collection_id = v_collection.id and j.kind = 'placeholder'
    order by j.created_at desc, j.id desc
    limit 1
    for update;
  end if;
  -- A select into that finds nothing leaves every field null.
  if v_job.id is null or v_job.state <> 'failed' then
    raise exception 'This job has not failed.' using errcode = '23514';
  end if;
  if v_job.error = 'unlocked' then
    raise exception 'This job was unlocked. Lock the art again to render it.' using errcode = '23514';
  end if;
  if v_job.retries >= 5 then
    raise exception 'This job has been retried too many times. Tell support about it.' using errcode = '23514';
  end if;
  -- A failed job that never seeded a batch failed before the worker claimed it: nothing to retry.
  if not exists (select 1 from public.render_batches b where b.job_id = v_job.id) then
    raise exception 'This job is not ready to render.' using errcode = '23514';
  end if;
  -- Attempts are kept; each batch's error stays until its next start clears it. A batch left
  -- running belongs to a worker that died with the job, so it is queued again with the failed ones.
  update public.render_batches b set state = 'queued'
  where b.job_id = v_job.id and b.state in ('failed', 'running');
  -- With every batch done (a job-level failure in the metadata step) nothing is re-queued: the job
  -- goes back to finalizing and the metadata step reruns. Otherwise it renders the queued batches.
  update public.render_jobs j
  set state = case
        when exists (select 1 from public.render_batches b where b.job_id = j.id and b.state <> 'done')
          then 'rendering'::public.render_state
        else 'finalizing'::public.render_state
      end,
      error = null, error_code = null, finished_at = null, retries = j.retries + 1
  where j.id = v_job.id and j.collection_id = p_collection_id
  returning * into v_job;
  -- A deployed collection keeps its status: the reveal flow (Phase 5) owns it.
  if v_job.kind = 'real' then
    update public.collections c
    set status = 'rendering'
    where c.id = v_collection.id and c.status <> 'deployed';
  end if;
  return v_job;
end;
$$;

revoke all on function public.art_render_retry(uuid) from public, anon;
grant execute on function public.art_render_retry(uuid) to authenticated;
