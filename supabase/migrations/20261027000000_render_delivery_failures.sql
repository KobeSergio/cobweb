-- Failed deliveries of render queue messages, counted in the database
-- (docs/specs/2026-10-13-render-worker-vercel.md, section 6, note of 27 October 2026). The consumer used
-- to read the delivery count from a request header to decide when a message is dead-lettered; a request
-- that is not the queue's could set it, so a made-up delivery could fail a paid job that was rendering.
-- The count now lives here: one row per job and message key (messageKey in packages/shared), raised by
-- art_render_delivery_failed when a run of that message throws, read by art_render_delivery_failures.
-- Only the service role calls either function; no client reads or writes the table. A creator's retry
-- raises the job's retries, which is part of the key, so a retried job starts with no failures.

create table public.render_delivery_failures (
  job_id uuid not null references public.render_jobs (id) on delete cascade,
  -- messageKey(message): the job id, the step, the batch index, the retries and the sweep slot.
  message_key text not null check (char_length(message_key) between 1 and 80),
  failures integer not null default 1 check (failures >= 1),
  updated_at timestamptz not null default now(),
  primary key (job_id, message_key)
);

comment on table public.render_delivery_failures is
  'How many times a run of one render queue message threw, per job and message key. Raised by art_render_delivery_failed, read by art_render_delivery_failures; the consumer dead-letters a message on its third failure. No client reads or writes it.';

-- No policy and no grant: only the definer functions below touch it.
alter table public.render_delivery_failures enable row level security;
revoke all on public.render_delivery_failures from anon, authenticated;

create function public.art_render_delivery_failed(p_job_id uuid, p_message_key text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_failures integer;
begin
  -- A job that is gone has nothing to retry: null, which the consumer treats as exhausted.
  perform 1 from public.render_jobs j where j.id = p_job_id;
  if not found then
    return null;
  end if;
  insert into public.render_delivery_failures as f (job_id, message_key)
  values (p_job_id, p_message_key)
  on conflict (job_id, message_key)
  do update set failures = f.failures + 1, updated_at = now()
  returning f.failures into v_failures;
  return v_failures;
end;
$$;

revoke all on function public.art_render_delivery_failed(uuid, text) from public, anon, authenticated;
grant execute on function public.art_render_delivery_failed(uuid, text) to service_role;

create function public.art_render_delivery_failures(p_job_id uuid, p_message_key text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select f.failures from public.render_delivery_failures f
     where f.job_id = p_job_id and f.message_key = p_message_key),
    0
  );
$$;

revoke all on function public.art_render_delivery_failures(uuid, text) from public, anon, authenticated;
grant execute on function public.art_render_delivery_failures(uuid, text) to service_role;
