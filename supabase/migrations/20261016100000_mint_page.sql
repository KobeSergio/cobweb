-- The mint page on live data (docs/specs/2026-10-16-mint-page-live-data.md, section 4): mint_pages, one row per
-- collection that its owner writes under row-level security with grants on the editable columns, checked by three
-- helpers and stamped by a trigger; token_ranks, the rarity ranks of a done real job, written only by
-- token_ranks_record; and the public reads, mint_page, mint_page_preview and mint_page_tiers, the only way anon reads
-- either table. The document they answer comes from private.mint_page_document and never carries the owner's id or
-- wallet, the payout, the deploy transaction, the fee snapshot, the token list, a CID or base URI of the real art,
-- an upload of the private buckets or a whitelist entry.

-- ---------------------------------------------------------------------------------------------
-- The check helpers: immutable, run as the writer, so granted to the roles that write
-- ---------------------------------------------------------------------------------------------
-- The service role had no usage on the private schema; a check it runs as the writer needs it.
grant usage on schema private to service_role;

-- At most p_max ids, none null, each at least 1, no repeat.
create function private.token_ids_ok(p_ids integer[], p_max integer)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select p_ids is not null
    and cardinality(p_ids) <= p_max
    and array_position(p_ids, null) is null
    and not exists (select 1 from unnest(p_ids) as id where id < 1)
    and cardinality(p_ids) = (select count(distinct id) from unnest(p_ids) as id);
$$;

-- Null, or a key of the mint-page bucket under the collection's id: `<collection id>/<sha256>.<ext>`, the
-- extension PNG, JPG, WebP or GIF for `image`, those or MP4 for `slide`, and MP3 alone for `music`.
create function private.mint_page_key_ok(p_collection_id uuid, p_key text, p_kind text)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select p_key is null or coalesce(
    p_key ~ (
      '^' || p_collection_id::text || '/[0-9a-f]{64}\.'
      || case p_kind
           when 'image' then '(png|jpg|webp|gif)'
           when 'slide' then '(png|jpg|webp|gif|mp4)'
           when 'music' then 'mp3'
         end
      || '$'
    ),
    false
  );
$$;

-- An object of at most 64 KB as text whose media keys are the collection's: the team photos as images, the
-- carousel's uploads as slides and the music's file. The rest of its shape is the save's zod schema.
create function private.mint_page_sections_ok(p_collection_id uuid, p_sections jsonb)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select jsonb_typeof(p_sections) = 'object'
    and octet_length(p_sections::text) <= 65536
    and not exists (
      select 1 from jsonb_path_query(p_sections, '$.team.members[*].imageKey') as k(value)
      where not private.mint_page_key_ok(p_collection_id, k.value #>> '{}', 'image')
    )
    and not exists (
      select 1 from jsonb_path_query(p_sections, '$.carousel.items[*].key') as k(value)
      where not private.mint_page_key_ok(p_collection_id, k.value #>> '{}', 'slide')
    )
    and not exists (
      select 1 from jsonb_path_query(p_sections, '$.music.key') as k(value)
      where not private.mint_page_key_ok(p_collection_id, k.value #>> '{}', 'music')
    );
$$;

revoke all on function private.token_ids_ok(integer[], integer) from public, anon;
revoke all on function private.mint_page_key_ok(uuid, text, text) from public, anon;
revoke all on function private.mint_page_sections_ok(uuid, jsonb) from public, anon;
grant execute on function private.token_ids_ok(integer[], integer) to authenticated, service_role;
grant execute on function private.mint_page_key_ok(uuid, text, text) to authenticated, service_role;
grant execute on function private.mint_page_sections_ok(uuid, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- mint_pages: the public page's settings, one row per collection, written by its owner
-- ---------------------------------------------------------------------------------------------
create table public.mint_pages (
  collection_id uuid primary key references public.collections (id) on delete cascade,
  published boolean not null default false,
  published_at timestamptz,
  description text not null default '' check (char_length(description) <= 2000),
  banner_key text,
  avatar_key text,
  about_banner_key text,
  website_url text check (website_url ~ '^https://\S+$'),
  x_url text check (x_url ~ '^https://(www\.)?(x|twitter)\.com/\S+$'),
  discord_url text check (discord_url ~ '^https://(www\.)?discord\.(gg|com)/\S+$'),
  telegram_url text check (telegram_url ~ '^https://(www\.)?(t|telegram)\.me/\S+$'),
  featured_token_ids integer[] not null default '{}' check (private.token_ids_ok(featured_token_ids, 6)),
  sections jsonb not null default '{}'::jsonb check (private.mint_page_sections_ok(collection_id, sections)),
  updated_at timestamptz not null default now(),
  constraint mint_pages_links_length check (
    greatest(char_length(website_url), char_length(x_url), char_length(discord_url), char_length(telegram_url))
      <= 200
  ),
  constraint mint_pages_media_keys check (
    private.mint_page_key_ok(collection_id, banner_key, 'image')
    and private.mint_page_key_ok(collection_id, avatar_key, 'image')
    and private.mint_page_key_ok(collection_id, about_banner_key, 'image')
  )
);

comment on table public.mint_pages is
  'The public mint page''s settings, one row per collection, written by its owner. Read publicly only through mint_page, for a deployed collection whose row is published. Media keys name objects of the mint-page bucket under the collection''s id; sections is the JSON lib/mint/page-doc.ts validates.';

-- The owner reads, inserts and updates under row-level security, through the editable columns only; no client
-- role deletes a row (the collection's delete cascades). The trigger below stamps published_at and updated_at.
alter table public.mint_pages enable row level security;
create policy "mint_pages: owner reads" on public.mint_pages
for select to authenticated
using ((select private.collection_owned(collection_id)));
create policy "mint_pages: owner inserts" on public.mint_pages
for insert to authenticated
with check ((select private.collection_owned(collection_id)));
create policy "mint_pages: owner updates" on public.mint_pages
for update to authenticated
using ((select private.collection_owned(collection_id)))
with check ((select private.collection_owned(collection_id)));
revoke all on public.mint_pages from anon, authenticated;
grant select on public.mint_pages to authenticated;
grant insert (
  collection_id, published, description, banner_key, avatar_key, about_banner_key, website_url, x_url,
  discord_url, telegram_url, featured_token_ids, sections
) on public.mint_pages to authenticated;
grant update (
  published, description, banner_key, avatar_key, about_banner_key, website_url, x_url, discord_url,
  telegram_url, featured_token_ids, sections
) on public.mint_pages to authenticated;

-- A row turning published (inserted published, or updated from false to true) needs a deployed collection with a
-- link, and stamps published_at; any other write keeps the old published_at. Every write stamps updated_at.
create function public.mint_pages_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.published and (tg_op = 'INSERT' or not old.published) then
    if not exists (
      select 1 from public.collections c
      where c.id = new.collection_id and c.status = 'deployed' and c.slug is not null
    ) then
      raise exception 'A mint page goes public once its contract is deployed and it has a link.'
        using errcode = '23514';
    end if;
    new.published_at := now();
  elsif tg_op = 'INSERT' then
    new.published_at := null;
  else
    new.published_at := old.published_at;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger mint_pages_guard
before insert or update on public.mint_pages
for each row execute function public.mint_pages_guard();

-- ---------------------------------------------------------------------------------------------
-- token_ranks: a done real job's rarity ranks, written only by token_ranks_record
-- ---------------------------------------------------------------------------------------------
create table public.token_ranks (
  job_id uuid primary key references public.render_jobs (id) on delete cascade,
  ranks integer[] not null check (cardinality(ranks) between 1 and 100000 and array_position(ranks, null) is null),
  created_at timestamptz not null default now()
);

comment on table public.token_ranks is
  'ranks[i] is token i''s rarity rank (1 the rarest) in a done real job''s stored token list, by rankTokens with Generate''s attribute key. Written only by token_ranks_record; read publicly only through mint_page_tiers, for the revealed base URI.';

alter table public.token_ranks enable row level security;
create policy "token_ranks: owner reads" on public.token_ranks
for select to authenticated
using (
  exists (
    select 1 from public.render_jobs j
    where j.id = job_id and (select private.collection_owned(j.collection_id))
  )
);
revoke all on public.token_ranks from anon, authenticated;
grant select on public.token_ranks to authenticated;

-- ---------------------------------------------------------------------------------------------
-- The document: what the public page shows, and nothing it must not
-- ---------------------------------------------------------------------------------------------
-- The collection's link, name, symbol, type, chain and contract (lowercase, as stored); the page's description, else
-- the collection's; its media keys, links, featured ids and sections ({} without a row); the phases' names,
-- descriptions, visibility and order; and the placeholder base URIs, which are the latest done placeholder job's
-- and the deploy-time one, distinct, each left out when it is the latest done real job's. Revoked from every
-- client role: the definer functions below call it.
create function private.mint_page_document(p_collection_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with real_job as (
    select j.base_uri from public.render_jobs j
    where j.collection_id = p_collection_id and j.kind = 'real' and j.state = 'done'
    order by j.created_at desc
    limit 1
  ), placeholder_job as (
    select j.base_uri from public.render_jobs j
    where j.collection_id = p_collection_id and j.kind = 'placeholder' and j.state = 'done'
    order by j.created_at desc
    limit 1
  ), starts as (
    select base_uri as uri from placeholder_job
    union all
    select d.args->>'baseUri' from public.deployments d where d.collection_id = p_collection_id
  )
  select jsonb_build_object(
    'slug', c.slug,
    'name', c.name,
    'symbol', c.symbol,
    'projectType', c.project_type,
    'chainId', c.chain_id,
    'contract', c.contract_address,
    'description', case when coalesce(p.description, '') = '' then c.description else p.description end,
    'media', jsonb_build_object(
      'banner', p.banner_key, 'avatar', p.avatar_key, 'aboutBanner', p.about_banner_key
    ),
    'socials', jsonb_build_object(
      'website', p.website_url, 'x', p.x_url, 'discord', p.discord_url, 'telegram', p.telegram_url
    ),
    'featuredTokenIds', to_jsonb(coalesce(p.featured_token_ids, '{}'::integer[])),
    'sections', coalesce(p.sections, '{}'::jsonb),
    'phases', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', g.onchain_id, 'name', g.name, 'description', g.description, 'visible', g.visible,
            'position', g.position
          )
          order by g.position nulls last, g.onchain_id
        ),
        '[]'::jsonb
      )
      from public.mint_groups g
      where g.collection_id = c.id
    ),
    'placeholders', (
      select coalesce(jsonb_agg(distinct s.uri), '[]'::jsonb)
      from starts s
      where s.uri is not null and s.uri is distinct from (select r.base_uri from real_job r)
    ),
    'published', coalesce(p.published, false)
  )
  from public.collections c
  left join public.mint_pages p on p.collection_id = c.id
  where c.id = p_collection_id;
$$;

revoke all on function private.mint_page_document(uuid) from public, anon, authenticated;

-- The document of the deployed collection with this link, for anyone, once its page is published; null otherwise.
create function public.mint_page(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select private.mint_page_document(c.id)
  from public.collections c
  join public.mint_pages p on p.collection_id = c.id and p.published
  where c.slug = lower(btrim(p_slug))
    and c.status = 'deployed'
    and exists (select 1 from public.deployments d where d.collection_id = c.id);
$$;

revoke all on function public.mint_page(text) from public;
grant execute on function public.mint_page(text) to anon, authenticated;

-- The same document for the signed-in owner, published or not (the owner's preview); null for anyone else.
create function public.mint_page_preview(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select private.mint_page_document(c.id)
  from public.collections c
  where c.slug = lower(btrim(p_slug))
    and c.status = 'deployed'
    and c.owner_id = (select auth.uid())
    and exists (select 1 from public.deployments d where d.collection_id = c.id);
$$;

revoke all on function public.mint_page_preview(text) from public, anon;
grant execute on function public.mint_page_preview(text) to authenticated;

-- The rarity ranks of 1 to 20 ids, only at the real base URI: for a published, deployed, generative collection
-- whose latest done real job's base URI is p_base_uri and has ranks, { "total": n, "ranks": { "<id>": rank } } for
-- the ids from 1 to n; null otherwise, so nothing reads before the reveal.
create function public.mint_page_tiers(p_slug text, p_base_uri text, p_ids integer[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with collection as (
    select c.id from public.collections c
    join public.mint_pages p on p.collection_id = c.id and p.published
    where c.slug = lower(btrim(p_slug))
      and c.status = 'deployed'
      and c.project_type = 'generative'
      and exists (select 1 from public.deployments d where d.collection_id = c.id)
  ), real_job as (
    select j.id, j.base_uri from public.render_jobs j
    join collection on j.collection_id = collection.id
    where j.kind = 'real' and j.state = 'done'
    order by j.created_at desc
    limit 1
  ), ranked as (
    select t.ranks from public.token_ranks t
    join real_job on t.job_id = real_job.id
    where real_job.base_uri = p_base_uri
  )
  select jsonb_build_object(
    'total', cardinality(ranked.ranks),
    'ranks', coalesce(
      (
        select jsonb_object_agg(id::text, ranked.ranks[id])
        from unnest(p_ids) as id
        where id between 1 and cardinality(ranked.ranks)
      ),
      '{}'::jsonb
    )
  )
  from ranked
  where p_ids is not null and cardinality(p_ids) between 1 and 20;
$$;

revoke all on function public.mint_page_tiers(text, text, integer[]) from public;
grant execute on function public.mint_page_tiers(text, text, integer[]) to anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- token_ranks_record: the ranks of a done real job, computed by the server
-- ---------------------------------------------------------------------------------------------
-- Service role only; p_owner must equal collections.owner_id. The collection must be generative, the job its done
-- real job, and the ranks a permutation of 1 to the job's token count. A job already ranked is left as it is: the
-- function answers whether it inserted the row.
create function public.token_ranks_record(
  p_collection_id uuid,
  p_owner uuid,
  p_job_id uuid,
  p_ranks integer[]
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_collection public.collections;
  v_count integer;
begin
  v_collection := private.lock_owned_collection(p_collection_id, p_owner);
  select j.token_count into v_count
  from public.render_jobs j
  where j.id = p_job_id and j.collection_id = v_collection.id and j.kind = 'real' and j.state = 'done';
  if v_collection.project_type <> 'generative'
    or v_count is null
    or p_ranks is null
    or cardinality(p_ranks) <> v_count
    or (select count(distinct r) from unnest(p_ranks) as r where r between 1 and v_count) <> v_count then
    raise exception 'The rendered set could not be ranked.' using errcode = '23514';
  end if;
  insert into public.token_ranks (job_id, ranks)
  values (p_job_id, p_ranks)
  on conflict (job_id) do nothing;
  return found;
end;
$$;

revoke all on function public.token_ranks_record(uuid, uuid, uuid, integer[]) from public, anon, authenticated;
grant execute on function public.token_ranks_record(uuid, uuid, uuid, integer[]) to service_role;
