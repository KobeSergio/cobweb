-- Asset batch sizes by bytes (docs/specs/2026-10-12-render-worker.md, section 9). A batch is built in
-- memory by the render worker and holds about 2.8 times its bytes while it is packed, so a fixed
-- batch of 100 files cannot be rendered when the files are large (100 files of 50 MB is 5 GB). A
-- before insert trigger on render_jobs sets the batch size of a real job that has a token list so
-- that a batch's bytes stay under 1 GB, given the largest file the list names, and sets the batch
-- count to match. A generative job (no token list) and a placeholder job keep the 100 art_lock and
-- art_lock_placeholder write, and art_lock is not redefined here.
--
-- The function is security invoker: every insert into render_jobs comes from art_lock or
-- art_lock_placeholder, both security definer functions, so it runs as their owner and reads
-- uploads without any extra grant. A role that could not read the rows would see no upload and
-- leave the sizes as they were; render_jobs has no insert grant for clients, so there is none.

create function private.render_jobs_size_asset_batches()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_max_bytes bigint;
begin
  if new.kind <> 'real' or new.token_list is null then
    return new;
  end if;
  select max(u.bytes) into v_max_bytes
  from public.uploads u
  where u.collection_id = new.collection_id
    and u.id in (
      select (entry ->> 'uploadId')::uuid from jsonb_array_elements(new.token_list) as entry
    );
  if v_max_bytes is null then
    return new;
  end if;
  new.batch_size := greatest(1, least(100, floor(1000000000::numeric / v_max_bytes)))::integer;
  new.batches_total := ceil(new.token_count::numeric / new.batch_size)::integer;
  return new;
end;
$$;

revoke all on function private.render_jobs_size_asset_batches() from public, anon, authenticated;

create trigger render_jobs_size_asset_batches
before insert on public.render_jobs
for each row execute function private.render_jobs_size_asset_batches();
