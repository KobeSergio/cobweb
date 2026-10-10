-- Lock and pay (docs/specs/2026-10-09-lock-and-pay.md, section 6): the art lock, the quote, the
-- payment record, the requote and the placeholder lock, each in one transaction. These functions
-- are security definer: they write render_jobs and collections.art_locked_at, which no client role
-- may write, so each one checks what a policy would. It first locks the owner's collections row
-- (any other owner reads as "collection not found") and filters every later statement on that id.
-- Running as the definer, the art lock trigger does not apply to them. art_lock, art_requote and
-- art_record_payment take arguments read from the chain or a verified receipt (fee, chain, payer,
-- tx hash, amount), so only the service role runs them, for the owner the server action names in
-- p_owner after its own session check. art_unlock and art_lock_placeholder take nothing from the
-- chain and run as the signed-in creator.

-- ---------------------------------------------------------------------------------------------
-- render_jobs: the factory's job id, the stored asset token list, one use per payment
-- ---------------------------------------------------------------------------------------------
alter table public.render_jobs
  add column onchain_job_id text,
  add column token_list jsonb check (token_list is null or jsonb_typeof(token_list) = 'array');

-- The bytes32 the factory's payForArt takes: the row's 16 uuid bytes left-aligned in 32 bytes, as
-- onchainJobId in packages/shared/src/job-id.ts. Derived from the id on every insert; nobody writes it.
create function public.render_jobs_set_onchain_job_id()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.onchain_job_id := '0x' || replace(new.id::text, '-', '') || repeat('0', 32);
  return new;
end;
$$;

revoke all on function public.render_jobs_set_onchain_job_id() from public, anon, authenticated;

create trigger render_jobs_set_onchain_job_id
before insert or update of id, onchain_job_id on public.render_jobs
for each row execute function public.render_jobs_set_onchain_job_id();

update public.render_jobs set onchain_job_id = '0x' || replace(id::text, '-', '') || repeat('0', 32);

-- Declared nullable so an insert need not name it; the before insert trigger always fills it, and the
-- checks (which run after before triggers) refuse a null or any value that is not derived from the id.
alter table public.render_jobs
  add constraint render_jobs_onchain_job_id_set
    check (onchain_job_id is not null and onchain_job_id ~ '^0x[0-9a-f]{64}$'),
  add constraint render_jobs_onchain_job_id_from_id
    check (onchain_job_id = '0x' || replace(id::text, '-', '') || repeat('0', 32)),
  add constraint render_jobs_onchain_job_id_unique unique (onchain_job_id);

-- A payment pays for one job only.
create unique index render_jobs_payment_tx_hash_once on public.render_jobs (payment_tx_hash)
  where payment_tx_hash is not null;

-- ---------------------------------------------------------------------------------------------
-- The owner lock every function below starts with
-- ---------------------------------------------------------------------------------------------

-- Locks the owner's collections row `for no key update` (the functions then write it or rows that
-- point at it) and returns it. The session functions pass (select auth.uid()); the service functions
-- pass their p_owner. A null owner matches nothing. Called only from the definer functions below.
create function private.lock_owned_collection(p_collection_id uuid, p_owner uuid)
returns public.collections
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.collections;
begin
  select c.* into v_row
  from public.collections c
  where c.id = p_collection_id and c.owner_id = p_owner
  for no key update;
  if not found then
    raise exception 'collection not found' using errcode = '42501';
  end if;
  return v_row;
end;
$$;

revoke all on function private.lock_owned_collection(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- art_lock: the token list the server validated, checked against the stored rows, then the lock
-- and the job with its quote
-- ---------------------------------------------------------------------------------------------
create function public.art_lock(
  p_collection_id uuid,
  p_owner uuid,
  p_kind text,
  p_token_list jsonb,
  p_token_list_hash text,
  p_allow_duplicates boolean,
  p_fee_per_token_wei numeric,
  p_chain_id integer,
  p_payer text
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

  insert into public.render_jobs (
    collection_id, kind, state, token_count, token_list_hash, allow_duplicates,
    fee_per_token_wei, quote_total_wei, quote_chain_id, quote_payer, quote_expires_at,
    paid_at, batch_size, batches_total, token_list
  )
  values (
    p_collection_id,
    'real',
    case when v_total = 0 then 'paid'::public.render_state else 'payment_due'::public.render_state end,
    v_count,
    p_token_list_hash,
    coalesce(p_allow_duplicates, false),
    v_fee,
    v_total,
    p_chain_id,
    v_wallet,
    now() + interval '24 hours',
    case when v_total = 0 then now() end,
    100,
    ceil(v_count / 100.0)::integer,
    case when v_collection.project_type = 'generative' then null else p_token_list end
  )
  returning * into v_job;
  return v_job;
end;
$$;

revoke all on function public.art_lock(uuid, uuid, text, jsonb, text, boolean, numeric, integer, text)
  from public, anon, authenticated;
grant execute on function public.art_lock(uuid, uuid, text, jsonb, text, boolean, numeric, integer, text)
  to service_role;

-- ---------------------------------------------------------------------------------------------
-- art_unlock: free while the payment is due, never after
-- ---------------------------------------------------------------------------------------------
create function public.art_unlock(p_collection_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_collection public.collections;
  v_job public.render_jobs;
begin
  v_collection := private.lock_owned_collection(p_collection_id, (select auth.uid()));
  select j.* into v_job
  from public.render_jobs j
  where j.collection_id = p_collection_id and j.kind = 'real' and j.state not in ('done', 'failed')
  for update;
  if not found then
    raise exception 'The art is not locked.' using errcode = '23514';
  end if;
  if v_job.state <> 'payment_due' then
    raise exception 'The art is paid for and stays locked.' using errcode = '23514';
  end if;
  update public.collections c
  set art_locked_at = null,
      status = case when c.status = 'art_locked' then 'draft'::public.collection_status else c.status end
  where c.id = v_collection.id;
  delete from public.render_jobs j where j.id = v_job.id and j.collection_id = p_collection_id;
end;
$$;

revoke all on function public.art_unlock(uuid) from public, anon;
grant execute on function public.art_unlock(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- art_lock_placeholder: deferred art renders its placeholder alone, at no cost, art left open
-- ---------------------------------------------------------------------------------------------
create function public.art_lock_placeholder(p_collection_id uuid, p_placeholder_upload_id uuid)
returns public.render_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_collection public.collections;
  v_wallet text;
  v_job public.render_jobs;
begin
  v_collection := private.lock_owned_collection(p_collection_id, (select auth.uid()));
  if not v_collection.art_deferred then
    raise exception 'Only a collection that finishes its art later locks a placeholder alone.'
      using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.uploads u
    where u.id = p_placeholder_upload_id and u.collection_id = p_collection_id and u.kind = 'placeholder'
  ) then
    raise exception 'Choose a placeholder file first.' using errcode = '23514';
  end if;
  if exists (
    select 1 from public.render_jobs j
    where j.collection_id = p_collection_id and j.kind = 'placeholder' and j.state not in ('done', 'failed')
  ) then
    raise exception 'The placeholder is already locked.' using errcode = '23514';
  end if;
  select p.wallet_address into v_wallet from public.profiles p where p.id = (select auth.uid());
  insert into public.render_jobs (
    collection_id, kind, state, token_count, fee_per_token_wei, quote_total_wei, quote_chain_id,
    quote_payer, placeholder_upload_id, paid_at, batch_size, batches_total
  )
  values (
    p_collection_id, 'placeholder', 'paid', 1, 0, 0, v_collection.chain_id,
    v_wallet, p_placeholder_upload_id, now(), 1, 1
  )
  returning * into v_job;
  return v_job;
end;
$$;

revoke all on function public.art_lock_placeholder(uuid, uuid) from public, anon;
grant execute on function public.art_lock_placeholder(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- art_requote: an expired quote takes the factory's current rate, without unlocking
-- ---------------------------------------------------------------------------------------------
create function public.art_requote(p_collection_id uuid, p_owner uuid, p_fee_per_token_wei numeric)
returns public.render_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_collection public.collections;
  v_job public.render_jobs;
begin
  v_collection := private.lock_owned_collection(p_collection_id, p_owner);
  if p_fee_per_token_wei is null or p_fee_per_token_wei < 0 or p_fee_per_token_wei <> trunc(p_fee_per_token_wei) then
    raise exception 'The fee must be a whole number of wei.' using errcode = '23514';
  end if;
  select j.* into v_job
  from public.render_jobs j
  where j.collection_id = v_collection.id and j.kind = 'real' and j.state not in ('done', 'failed')
  for update;
  if not found or v_job.state <> 'payment_due' then
    raise exception 'There is no payment waiting for this collection.' using errcode = '23514';
  end if;
  if v_job.quote_expires_at >= now() then
    raise exception 'The quote has not expired yet.' using errcode = '23514';
  end if;
  update public.render_jobs j
  set fee_per_token_wei = p_fee_per_token_wei,
      quote_total_wei = p_fee_per_token_wei * j.token_count,
      quote_expires_at = now() + interval '24 hours'
  where j.id = v_job.id and j.collection_id = p_collection_id
  returning * into v_job;
  return v_job;
end;
$$;

revoke all on function public.art_requote(uuid, uuid, numeric) from public, anon, authenticated;
grant execute on function public.art_requote(uuid, uuid, numeric) to service_role;

-- ---------------------------------------------------------------------------------------------
-- art_record_payment: the payment the server read from the receipt's ArtPaid log
-- ---------------------------------------------------------------------------------------------
create function public.art_record_payment(
  p_collection_id uuid,
  p_owner uuid,
  p_job_id uuid,
  p_tx_hash text,
  p_payer text,
  p_amount_wei numeric
)
returns public.render_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_collection public.collections;
  v_job public.render_jobs;
begin
  v_collection := private.lock_owned_collection(p_collection_id, p_owner);
  select j.* into v_job
  from public.render_jobs j
  where j.id = p_job_id and j.collection_id = v_collection.id
  for update;
  if not found or v_job.state <> 'payment_due' then
    raise exception 'There is no payment waiting for this job.' using errcode = '23514';
  end if;
  -- The quote's expiry is not checked: a payment that mined is recorded whenever it arrives.
  if p_tx_hash is null or p_tx_hash !~ '^0x[0-9a-f]{64}$' then
    raise exception 'The transaction did not pay for this job.' using errcode = '23514';
  end if;
  if exists (select 1 from public.render_jobs j where j.payment_tx_hash = p_tx_hash) then
    raise exception 'This payment was already used.' using errcode = '23505';
  end if;
  -- The action checked both against the receipt already; these are the database's own guards.
  if p_payer is distinct from v_job.quote_payer then
    raise exception 'The payment came from a different wallet than the quote.' using errcode = '23514';
  end if;
  if p_amount_wei is null or p_amount_wei < 0 then
    raise exception 'The payment was less than the quote.' using errcode = '23514';
  end if;
  -- A short payment is recorded and the job stays payment_due, so the screen can tell the creator
  -- the amount was short and name the job for support. The factory takes one payment per job and payer.
  update public.render_jobs j
  set state = case when p_amount_wei >= j.quote_total_wei then 'paid'::public.render_state else j.state end,
      payment_tx_hash = p_tx_hash,
      paid_at = case when p_amount_wei >= j.quote_total_wei then now() else null end,
      paid_amount_wei = p_amount_wei
  where j.id = v_job.id and j.collection_id = p_collection_id
  returning * into v_job;
  return v_job;
end;
$$;

revoke all on function public.art_record_payment(uuid, uuid, uuid, text, text, numeric)
  from public, anon, authenticated;
grant execute on function public.art_record_payment(uuid, uuid, uuid, text, text, numeric) to service_role;
