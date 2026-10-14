-- The render credit (docs/specs/2026-10-14-render-screen-wiring.md, section 4): a paid render that
-- fails and is unlocked leaves a credit, and the next lock of the collection with the same or fewer
-- tokens is recorded waived on the strength of that payment, so the creator pays once. The rule lives
-- in one function, private.render_credit, which art_lock and the review's art_render_credit both ask,
-- so the web app never mirrors it. art_unlock is redefined to take the collection's latest real job
-- whatever its state, so a failed paid job can be unlocked (it keeps the worker's sentence and takes
-- the code unlocked, which every existing check for an unlocked job reads); a job failed with
-- payment-mismatch stays with support and leaves no credit. On a collection that finishes its art
-- later, art_unlock also releases a failed placeholder job with the code unlocked and nothing else (a
-- placeholder lock is free, sets no art_locked_at and leaves no credit), so the placeholder can be
-- locked again. art_lock is redefined to insert a lock covered by a credit as waived, with the quote
-- columns filled as for a paid lock and credit_job_id naming the job whose payment it rests on. Both
-- keep their signatures and grants, and the rest of their bodies is as in
-- 20261009020000_lock_and_pay.sql and 20261012010000_render_job_state.sql.

-- ---------------------------------------------------------------------------------------------
-- render_jobs.credit_job_id: the job whose payment a waived lock rests on
-- ---------------------------------------------------------------------------------------------
alter table public.render_jobs
  add column credit_job_id uuid references public.render_jobs (id) on delete restrict,
  -- Only a waived job rests on a credit.
  add constraint render_jobs_credit_has_waiver check (credit_job_id is null or waived_by is not null);

-- The "named by no other job" lookup in private.render_credit.
create index render_jobs_credit_job_id_idx on public.render_jobs (credit_job_id)
  where credit_job_id is not null;

-- ---------------------------------------------------------------------------------------------
-- private.render_credit: the rule
-- ---------------------------------------------------------------------------------------------

-- The newest real job of the collection that failed and was unlocked, carries a payment or a waiver,
-- covers p_token_count, and is named by no other job's credit_job_id; null when there is none. A job
-- cancelled while unpaid has neither a payment nor a waiver, so it is never a credit. A credited job
-- that fails and is unlocked carries a waiver, so it is the next credit: the creator's one payment
-- follows the collection until a render finishes. A larger lock finds no credit and pays in full; the
-- older credit stays for a later, smaller lock.
create function private.render_credit(p_collection_id uuid, p_token_count integer)
returns public.render_jobs
language sql
stable
security definer
set search_path = ''
as $$
  select j.*
  from public.render_jobs j
  where j.collection_id = p_collection_id
    and j.kind = 'real'
    and j.state = 'failed'
    and j.error_code = 'unlocked'
    and (j.payment_tx_hash is not null or j.waived_by is not null)
    and j.token_count >= p_token_count
    and not exists (select 1 from public.render_jobs u where u.credit_job_id = j.id)
  order by j.created_at desc, j.id desc
  limit 1;
$$;

revoke all on function private.render_credit(uuid, integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- art_render_credit: the review asks whether a credit covers the lock it is about to make
-- ---------------------------------------------------------------------------------------------
create function public.art_render_credit(p_collection_id uuid, p_token_count integer)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_credit public.render_jobs;
begin
  -- The owner check the read policies use: a stranger's or unknown collection reads as not found.
  if not (select private.collection_owned(p_collection_id)) then
    raise exception 'collection not found' using errcode = '42501';
  end if;
  v_credit := private.render_credit(p_collection_id, p_token_count);
  return v_credit.id;
end;
$$;

-- Granted to authenticated only: it acts for the signed-in owner, as art_render_retry does.
revoke all on function public.art_render_credit(uuid, integer) from public, anon, service_role;
grant execute on function public.art_render_credit(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- art_unlock, redefined: the latest real job whatever its state, so a failed paid job can be
-- unlocked and leave its credit; on a collection that finishes its art later, a failed placeholder
-- job is released the same way. Otherwise as in 20261012010000_render_job_state.sql.
-- ---------------------------------------------------------------------------------------------
create or replace function public.art_unlock(p_collection_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_collection public.collections;
  v_job public.render_jobs;
  v_placeholder public.render_jobs;
begin
  v_collection := private.lock_owned_collection(p_collection_id, (select auth.uid()));
  -- The collection's latest real job, in any state. A job cancelled by an unlock counts here, so it
  -- is refused by name below.
  select j.* into v_job
  from public.render_jobs j
  where j.collection_id = p_collection_id and j.kind = 'real'
  order by j.created_at desc, j.id desc
  limit 1
  for update;
  -- A collection that finishes its art later, with no real job or with its latest real job cancelled
  -- by an unlock, may hold a failed placeholder job (art_render_retry picks it the same way). It is
  -- released with the code unlocked and nothing else: a placeholder lock is free, sets no
  -- art_locked_at and leaves no credit, and art_lock_placeholder accepts a new lock after a failure.
  -- A deferred collection with no such job falls through to the checks below on the real job.
  if v_collection.art_deferred
    and (v_job.id is null
      or (v_job.state = 'failed' and (v_job.error_code = 'unlocked' or v_job.error = 'unlocked')))
  then
    select j.* into v_placeholder
    from public.render_jobs j
    where j.collection_id = p_collection_id and j.kind = 'placeholder'
    order by j.created_at desc, j.id desc
    limit 1
    for update;
    if v_placeholder.id is not null
      and v_placeholder.state = 'failed'
      and v_placeholder.error_code is distinct from 'unlocked'
      and v_placeholder.error is distinct from 'unlocked'
    then
      update public.render_jobs j
      set error_code = 'unlocked'
      where j.id = v_placeholder.id and j.collection_id = p_collection_id;
      return;
    end if;
  end if;
  -- (1) Nothing to unlock: no job, no lock on the collection, a finished job, or a job already unlocked.
  if v_job.id is null
    or v_collection.art_locked_at is null
    or v_job.state = 'done'
    or v_job.error_code = 'unlocked'
    or v_job.error = 'unlocked'
  then
    raise exception 'The art is not locked.' using errcode = '23514';
  end if;
  -- (2) The payment itself is in doubt: only support may look at it, and no credit is left.
  if v_job.state = 'failed' and v_job.error_code = 'payment-mismatch' then
    raise exception 'The payment for this job could not be verified. Tell support about it.' using errcode = '23514';
  end if;
  -- (3) Paid and waiting for a worker, rendering or finalizing: the lock holds.
  if v_job.state not in ('payment_due', 'failed') then
    raise exception 'The art is paid for and stays locked.' using errcode = '23514';
  end if;
  -- (4) A payment recorded on an open lock (a short one) keeps it, so the payment is never stranded.
  if v_job.state = 'payment_due' and v_job.payment_tx_hash is not null then
    raise exception 'A payment is recorded on this lock, so it stays.' using errcode = '23514';
  end if;
  update public.collections c
  set art_locked_at = null,
      status = case when c.status = 'art_locked' then 'draft'::public.collection_status else c.status end
  where c.id = v_collection.id;
  if v_job.state = 'payment_due' then
    -- Cancelled while unpaid, as before: no payment, no waiver, never a credit.
    update public.render_jobs j
    set state = 'failed', error = 'unlocked', error_code = 'unlocked', finished_at = now()
    where j.id = v_job.id and j.collection_id = p_collection_id;
  else
    -- A failed render: the worker's sentence, the finish time, the retries, the payment and the batch
    -- rows stay as the worker left them. The code marks the unlock and makes the job a credit.
    update public.render_jobs j
    set error_code = 'unlocked'
    where j.id = v_job.id and j.collection_id = p_collection_id;
  end if;
  -- A generative supply is saved again by the next generate; 1/1 and single asset keep theirs. A
  -- second statement, because the frozen-field guard allows a supply change only once the row is draft.
  if v_collection.project_type = 'generative' and v_collection.status = 'art_locked' then
    update public.collections c set max_supply = null where c.id = v_collection.id;
  end if;
end;
$$;

revoke all on function public.art_unlock(uuid) from public, anon;
grant execute on function public.art_unlock(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- art_lock, redefined: a lock covered by a credit is inserted waived, the quote filled as for a
-- paid lock and credit_job_id set. Otherwise as in 20261009020000_lock_and_pay.sql.
-- ---------------------------------------------------------------------------------------------
create or replace function public.art_lock(
  p_collection_id uuid,
  p_owner uuid,
  p_kind text,
  p_token_list jsonb,
  p_token_list_hash text,
  p_allow_duplicates boolean,
  p_fee_per_token_wei numeric,
  p_chain_id integer,
  p_payer text,
  p_factory text default null
)
returns public.render_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_collection public.collections;
  v_wallet text;
  v_count integer;
  v_mismatch boolean;
  v_fee numeric(78, 0);
  v_total numeric(78, 0);
  v_credit public.render_jobs;
  v_job public.render_jobs;
begin
  v_collection := private.lock_owned_collection(p_collection_id, p_owner);
  if v_collection.art_locked_at is not null or exists (
    select 1 from public.render_jobs j
    where j.collection_id = p_collection_id and j.kind = 'real' and j.state not in ('done', 'failed')
  ) then
    raise exception 'The art is already locked.' using errcode = '23514';
  end if;
  select p.wallet_address into v_wallet from public.profiles p where p.id = p_owner;
  if v_wallet is null or p_payer is distinct from v_wallet then
    raise exception 'The quote must be issued to your sign-in wallet.' using errcode = '23514';
  end if;
  if p_chain_id is null or p_chain_id <= 0 then
    raise exception 'Choose the network the fee is paid on.' using errcode = '23514';
  end if;
  -- A single asset pays nothing, so a chain without a factory may still lock it: null is allowed.
  if p_factory is not null and p_factory !~ '^0x[0-9a-f]{40}$' then
    raise exception 'Choose the network the fee is paid on.' using errcode = '23514';
  end if;
  if p_fee_per_token_wei is null or p_fee_per_token_wei < 0 or p_fee_per_token_wei <> trunc(p_fee_per_token_wei) then
    raise exception 'The fee must be a whole number of wei.' using errcode = '23514';
  end if;
  if p_token_list_hash is null or p_token_list_hash !~ '^0x[0-9a-f]{64}$' then
    raise exception 'The token list hash is not valid.' using errcode = '23514';
  end if;
  if p_token_list is null or jsonb_typeof(p_token_list) <> 'array' or jsonb_array_length(p_token_list) = 0 then
    raise exception 'There is nothing to lock yet.' using errcode = '23514';
  end if;
  if p_kind is distinct from v_collection.project_type::text then
    raise exception 'The art changed while locking. Review it again.' using errcode = '23514';
  end if;

  v_count := jsonb_array_length(p_token_list);
  if v_collection.project_type = 'generative' then
    -- Same ids, art collections and DNA as the stored tokens, no more, no less.
    with given as (
      select x.id, x."collectionId" as art_collection_id, x.dna
      from jsonb_to_recordset(p_token_list) as x(id integer, "collectionId" uuid, dna uuid[])
    ),
    stored as (
      select t.token_id as id, t.art_collection_id, t.dna
      from public.tokens t
      where t.collection_id = p_collection_id
    )
    select (select count(*) from stored) <> v_count
      or exists (select * from given except select * from stored)
      or exists (select * from stored except select * from given)
    into v_mismatch;
  else
    -- Every edition of every asset file, ids 1 to N in file order (position, upload time, id), as
    -- buildAssetTokenList in apps/web/src/lib/art/asset-tokens.ts makes them.
    with ordered as (
      select u.id, u.quantity, u.attributes,
        coalesce(sum(u.quantity) over (
          order by u.position nulls last, u.created_at, u.id
          rows between unbounded preceding and 1 preceding
        ), 0)::integer as before
      from public.uploads u
      where u.collection_id = p_collection_id and u.kind = 'asset'
    ),
    expected as (
      select o.before + g.n as id, o.id as upload_id, o.attributes
      from ordered o
      cross join lateral generate_series(1, o.quantity) as g(n)
    ),
    given as (
      select x.id, x."uploadId" as upload_id, x.attributes
      from jsonb_to_recordset(p_token_list) as x(id integer, "uploadId" uuid, attributes jsonb)
    )
    select (select count(*) from expected) <> v_count
      or exists (select * from given except select * from expected)
      or exists (select * from expected except select * from given)
    into v_mismatch;
  end if;
  if v_mismatch then
    raise exception 'The art changed while locking. Review it again.' using errcode = '23514';
  end if;

  -- A zero or missing fee means the chain's fee is not set: only a single asset may cost nothing.
  if v_collection.project_type <> 'single_asset' and (p_fee_per_token_wei is null or p_fee_per_token_wei = 0) then
    raise exception 'This chain is not ready for payments yet.' using errcode = '23514';
  end if;
  if v_collection.max_supply is not null and v_collection.max_supply <> v_count then
    raise exception 'The supply does not match the tokens. Generate again.' using errcode = '23514';
  end if;

  -- A single asset pays nothing (MASTER_PLAN, Decisions: art fee).
  v_fee := case when v_collection.project_type = 'single_asset' then 0 else p_fee_per_token_wei end;
  v_total := v_fee * v_count;

  -- The collections row first, as the lock trigger's note in the art tables migration asks. Locking
  -- fixes the token count (supply_set_after_draft), so a supply not yet set takes the locked count.
  update public.collections c
  set art_locked_at = now(),
      max_supply = coalesce(c.max_supply, v_count),
      status = case when c.status = 'draft' then 'art_locked'::public.collection_status else c.status end
  where c.id = p_collection_id;

  -- The credit: a paid render of this collection that failed and was unlocked, covering this count.
  -- The collection row lock above serialises two locks, so a credit is used once. A lock that owes
  -- nothing needs none.
  if v_total > 0 then
    v_credit := private.render_credit(p_collection_id, v_count);
  end if;

  insert into public.render_jobs (
    collection_id, kind, state, token_count, token_list_hash, allow_duplicates,
    fee_per_token_wei, quote_total_wei, quote_chain_id, quote_payer, quote_factory, quote_expires_at,
    paid_at, waived_by, waived_reason, credit_job_id, batch_size, batches_total, token_list
  )
  values (
    p_collection_id,
    'real',
    case
      when v_credit.id is not null then 'waived'::public.render_state
      when v_total = 0 then 'paid'::public.render_state
      else 'payment_due'::public.render_state
    end,
    v_count,
    p_token_list_hash,
    coalesce(p_allow_duplicates, false),
    v_fee,
    v_total,
    p_chain_id,
    v_wallet,
    p_factory,
    now() + interval '24 hours',
    case when v_credit.id is not null or v_total = 0 then now() end,
    case when v_credit.id is not null then p_owner end,
    case when v_credit.id is not null then 'credit' end,
    v_credit.id,
    100,
    ceil(v_count / 100.0)::integer,
    case when v_collection.project_type = 'generative' then null else p_token_list end
  )
  returning * into v_job;
  return v_job;
end;
$$;

revoke all on function public.art_lock(uuid, uuid, text, jsonb, text, boolean, numeric, integer, text, text)
  from public, anon, authenticated;
grant execute on function public.art_lock(uuid, uuid, text, jsonb, text, boolean, numeric, integer, text, text)
  to service_role;
