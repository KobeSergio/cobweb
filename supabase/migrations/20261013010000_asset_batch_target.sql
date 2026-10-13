-- Asset batches target 500 MB (docs/specs/2026-10-13-render-worker-vercel.md, section 9). Was 1 GB in
-- 20261012020000_asset_batch_size.sql. Marketplaces cache and cap video assets at around 5 to 10 MB,
-- so 1 GB batches were far above need, and the render worker now runs on a 4 GB Vercel Function whose
-- ceiling for one pass-through batch is 600 MB of files. The trigger is unchanged; only the function's
-- target moves.
--
-- The size at lock is still a planning number: uploads.bytes is what record_upload was told. The
-- worker's batch step adds up the bytes it really loads and fails the job with batch-too-large past
-- its own ceiling.
--
-- The function stays security invoker: every insert into render_jobs comes from art_lock or
-- art_lock_placeholder, both security definer functions, so it runs as their owner and reads uploads
-- without any extra grant. A role that could not read the rows would see no upload and leave the
-- sizes as they were; render_jobs has no insert grant for clients, so there is none.

create or replace function private.render_jobs_size_asset_batches()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_max_bytes bigint;
  v_files bigint;
begin
  if new.kind <> 'real' or new.token_list is null then
    return new;
  end if;
  select max(u.bytes), count(*) into v_max_bytes, v_files
  from public.uploads u
  where u.collection_id = new.collection_id
    and u.id in (
      select (entry ->> 'uploadId')::uuid from jsonb_array_elements(new.token_list) as entry
    );
  if v_max_bytes is null then
    return new;
  end if;
  -- A batch holds each distinct file once, however many tokens share it (a single asset, or
  -- editions of a few files). When every distinct file together stays under the target, the
  -- default of 100 tokens a batch is already safe.
  if v_files * v_max_bytes <= 500000000 then
    return new;
  end if;
  new.batch_size := greatest(1, least(100, floor(500000000::numeric / v_max_bytes)))::integer;
  new.batches_total := ceil(new.token_count::numeric / new.batch_size)::integer;
  return new;
end;
$$;

revoke all on function private.render_jobs_size_asset_batches() from public, anon, authenticated;
