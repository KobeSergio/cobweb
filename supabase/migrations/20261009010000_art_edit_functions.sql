-- Art edit functions (docs/specs/2026-10-08-art-wiring.md, section 7): the Art screens' edits that
-- span more than one statement, each in one transaction. Every function runs as the caller
-- (security invoker), so row-level security, the lock trigger and the content guards apply as they
-- do to a single write. Each first locks the caller's own collections row, so another creator's id
-- reads as "collection not found" and is never locked.

-- ---------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------

-- Locks the caller's own collection row and refuses a locked project. `for share` by default;
-- `for no key update` when the function then writes the row, so two tabs cannot deadlock upgrading
-- a share lock.
create function private.art_lock_owned(p_collection_id uuid, p_will_update boolean default false)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_locked timestamptz;
begin
  if p_will_update then
    select c.art_locked_at into v_locked
    from public.collections c
    where c.id = p_collection_id and c.owner_id = (select auth.uid())
    for no key update;
  else
    select c.art_locked_at into v_locked
    from public.collections c
    where c.id = p_collection_id and c.owner_id = (select auth.uid())
    for share;
  end if;
  if not found then
    raise exception 'collection not found' using errcode = '42501';
  end if;
  if v_locked is not null then
    raise exception 'The art is locked and cannot change.' using errcode = '42501';
  end if;
end;
$$;

revoke all on function private.art_lock_owned(uuid, boolean) from public, anon;
grant execute on function private.art_lock_owned(uuid, boolean) to authenticated;

-- Drops deleted traits from the rules and "at least one" groups that named them: a rule left with no
-- related trait goes, and so does a group left with fewer than two. Rules whose own trait was deleted
-- are already gone (on delete cascade).
create function private.art_prune(p_collection_id uuid, p_trait_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_trait_ids is null or cardinality(p_trait_ids) = 0 then
    return;
  end if;
  delete from public.rules r
  where r.collection_id = p_collection_id and r.related_trait_ids <@ p_trait_ids;
  update public.rules r
  set related_trait_ids = array(
    select u.x from unnest(r.related_trait_ids) with ordinality as u(x, n)
    where u.x <> all (p_trait_ids)
    order by u.n
  )
  where r.collection_id = p_collection_id and r.related_trait_ids && p_trait_ids;
  delete from public.at_least_one g
  where g.collection_id = p_collection_id
    and cardinality(array(select u.x from unnest(g.trait_ids) as u(x) where u.x <> all (p_trait_ids))) < 2;
  update public.at_least_one g
  set trait_ids = array(
    select u.x from unnest(g.trait_ids) with ordinality as u(x, n)
    where u.x <> all (p_trait_ids)
    order by u.n
  )
  where g.collection_id = p_collection_id and g.trait_ids && p_trait_ids;
end;
$$;

revoke all on function private.art_prune(uuid, uuid[]) from public, anon;
grant execute on function private.art_prune(uuid, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Folder import
-- ---------------------------------------------------------------------------------------------

-- The folder upload's structure in one transaction: art collections, layers and traits linked to
-- their upload rows, every layer evenly split (as evenWeights in layer-edits.ts). With
-- activeCollectionId and one collection, the layers go into that art collection, which must have
-- none; otherwise new art collections follow the existing ones, and a project with no layers yet
-- replaces its empty art collections. Returns the new ids in the payload's shape.
create function public.art_import_layers(p_collection_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_collections jsonb := coalesce(p_payload -> 'collections', '[]'::jsonb);
  v_active uuid := nullif(p_payload ->> 'activeCollectionId', '')::uuid;
  v_fill boolean;
  v_next integer;
  v_art uuid;
  v_layer uuid;
  v_trait uuid;
  v_c jsonb;
  v_l jsonb;
  v_t jsonb;
  v_lpos integer;
  v_tpos integer;
  v_count integer;
  v_base integer;
  v_rest integer;
  v_out jsonb := '[]'::jsonb;
  v_layers_out jsonb;
  v_traits_out jsonb;
begin
  perform private.art_lock_owned(p_collection_id);
  if jsonb_typeof(v_collections) <> 'array' then
    raise exception 'The folder could not be read.' using errcode = '22023';
  end if;
  v_fill := v_active is not null and jsonb_array_length(v_collections) = 1;
  if v_fill then
    if not exists (
      select 1 from public.art_collections a where a.id = v_active and a.collection_id = p_collection_id
    ) then
      raise exception 'art collection not found' using errcode = 'P0002';
    end if;
    if exists (select 1 from public.layers l where l.art_collection_id = v_active) then
      raise exception 'This collection already has layers. Start over to replace them.' using errcode = '23514';
    end if;
  elsif not exists (select 1 from public.layers l where l.collection_id = p_collection_id) then
    delete from public.art_collections a where a.collection_id = p_collection_id;
  end if;
  select coalesce(max(a.position) + 1, 0) into v_next
  from public.art_collections a where a.collection_id = p_collection_id;

  for v_c in
    select e.value from jsonb_array_elements(v_collections) with ordinality as e(value, n) order by e.n
  loop
    if v_fill then
      v_art := v_active;
    else
      insert into public.art_collections (collection_id, name, size, position)
      values (p_collection_id, v_c ->> 'name', 0, v_next)
      returning id into v_art;
      v_next := v_next + 1;
    end if;
    v_layers_out := '[]'::jsonb;
    v_lpos := 0;
    for v_l in
      select e.value
      from jsonb_array_elements(coalesce(v_c -> 'layers', '[]'::jsonb)) with ordinality as e(value, n)
      order by e.n
    loop
      insert into public.layers (collection_id, art_collection_id, name, position)
      values (p_collection_id, v_art, v_l ->> 'name', v_lpos)
      returning id into v_layer;
      v_lpos := v_lpos + 1;
      v_count := jsonb_array_length(coalesce(v_l -> 'traits', '[]'::jsonb));
      v_base := case when v_count > 0 then 10000 / v_count else 0 end;
      v_rest := 10000 - v_base * v_count;
      v_traits_out := '[]'::jsonb;
      v_tpos := 0;
      for v_t in
        select e.value
        from jsonb_array_elements(coalesce(v_l -> 'traits', '[]'::jsonb)) with ordinality as e(value, n)
        order by e.n
      loop
        insert into public.traits (collection_id, layer_id, name, weight, upload_id, position)
        values (
          p_collection_id,
          v_layer,
          v_t ->> 'name',
          (v_base + case when v_tpos < v_rest then 1 else 0 end) / 100.0,
          (v_t ->> 'uploadId')::uuid,
          v_tpos
        )
        returning id into v_trait;
        v_traits_out := v_traits_out || jsonb_build_array(jsonb_build_object('id', v_trait));
        v_tpos := v_tpos + 1;
      end loop;
      v_layers_out := v_layers_out || jsonb_build_array(jsonb_build_object('id', v_layer, 'traits', v_traits_out));
    end loop;
    v_out := v_out || jsonb_build_array(jsonb_build_object('id', v_art, 'layers', v_layers_out));
  end loop;
  return jsonb_build_object('collections', v_out);
end;
$$;

revoke all on function public.art_import_layers(uuid, jsonb) from public, anon;
grant execute on function public.art_import_layers(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Layers and traits
-- ---------------------------------------------------------------------------------------------

-- Moves a layer to a new place in its stack. The stack is parked above every real position first,
-- so the unique (art_collection_id, position) key, checked row by row, never sees two layers at
-- one place. layers_guard_tokens refuses it while the art collection has tokens.
create function public.art_move_layer(p_collection_id uuid, p_layer_id uuid, p_position integer)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_art uuid;
  v_from integer;
  v_last integer;
  v_to integer;
begin
  perform private.art_lock_owned(p_collection_id);
  select l.art_collection_id into v_art
  from public.layers l where l.id = p_layer_id and l.collection_id = p_collection_id;
  if not found then
    raise exception 'layer not found' using errcode = 'P0002';
  end if;
  with ranked as (
    select l.id, (row_number() over (order by l.position) - 1)::integer as at
    from public.layers l where l.art_collection_id = v_art
  )
  select r.at, (select count(*) - 1 from ranked)::integer into v_from, v_last
  from ranked r where r.id = p_layer_id;
  v_to := greatest(0, least(p_position, v_last));
  if v_to = v_from then
    return;
  end if;
  update public.layers l set position = l.position + 100000 where l.art_collection_id = v_art;
  with ranked as (
    select l.id, (row_number() over (order by l.position) - 1)::integer as at
    from public.layers l where l.art_collection_id = v_art
  )
  update public.layers l
  set position = case
    when r.id = p_layer_id then v_to
    when v_from < v_to and r.at > v_from and r.at <= v_to then r.at - 1
    when v_from > v_to and r.at >= v_to and r.at < v_from then r.at + 1
    else r.at
  end
  from ranked r
  where r.id = l.id;
end;
$$;

revoke all on function public.art_move_layer(uuid, uuid, integer) from public, anon;
grant execute on function public.art_move_layer(uuid, uuid, integer) to authenticated;

-- Deletes a layer (its traits cascade), prunes rules and groups of its traits and closes the
-- position gap. With p_clear_tokens the project's tokens go first; without it layers_guard_tokens
-- refuses while the art collection has tokens.
create function public.art_delete_layer(p_collection_id uuid, p_layer_id uuid, p_clear_tokens boolean)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_art uuid;
  v_traits uuid[];
begin
  perform private.art_lock_owned(p_collection_id);
  select l.art_collection_id into v_art
  from public.layers l where l.id = p_layer_id and l.collection_id = p_collection_id;
  if not found then
    raise exception 'layer not found' using errcode = 'P0002';
  end if;
  select coalesce(array_agg(t.id), '{}') into v_traits from public.traits t where t.layer_id = p_layer_id;
  if p_clear_tokens then
    delete from public.tokens t where t.collection_id = p_collection_id;
  end if;
  delete from public.layers l where l.id = p_layer_id;
  perform private.art_prune(p_collection_id, v_traits);
  update public.layers l set position = l.position + 100000 where l.art_collection_id = v_art;
  with ranked as (
    select l.id, (row_number() over (order by l.position) - 1)::integer as at
    from public.layers l where l.art_collection_id = v_art
  )
  update public.layers l set position = r.at from ranked r where r.id = l.id;
end;
$$;

revoke all on function public.art_delete_layer(uuid, uuid, boolean) from public, anon;
grant execute on function public.art_delete_layer(uuid, uuid, boolean) to authenticated;

-- Deletes a trait, prunes the rules and groups that named it (a rule stored on it cascades) and
-- closes the position gap in its layer. Its upload row stays: an upload may have no trait.
create function public.art_delete_trait(p_collection_id uuid, p_trait_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_layer uuid;
begin
  perform private.art_lock_owned(p_collection_id);
  select t.layer_id into v_layer
  from public.traits t where t.id = p_trait_id and t.collection_id = p_collection_id;
  if not found then
    raise exception 'trait not found' using errcode = 'P0002';
  end if;
  delete from public.traits t where t.id = p_trait_id;
  perform private.art_prune(p_collection_id, array[p_trait_id]);
  update public.traits t set position = t.position + 100000 where t.layer_id = v_layer;
  with ranked as (
    select t.id, (row_number() over (order by t.position) - 1)::integer as at
    from public.traits t where t.layer_id = v_layer
  )
  update public.traits t set position = r.at from ranked r where r.id = t.id;
end;
$$;

revoke all on function public.art_delete_trait(uuid, uuid) from public, anon;
grant execute on function public.art_delete_trait(uuid, uuid) to authenticated;

-- Deletes an art collection (layers, traits, rules, groups and tokens cascade), prunes what named
-- its traits, closes the position gap and renumbers the remaining tokens from 1 in one statement,
-- which the deferrable primary key allows.
create function public.art_delete_art_collection(p_collection_id uuid, p_art_collection_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_traits uuid[];
begin
  perform private.art_lock_owned(p_collection_id);
  if not exists (
    select 1 from public.art_collections a where a.id = p_art_collection_id and a.collection_id = p_collection_id
  ) then
    raise exception 'art collection not found' using errcode = 'P0002';
  end if;
  select coalesce(array_agg(t.id), '{}') into v_traits
  from public.traits t join public.layers l on l.id = t.layer_id
  where l.art_collection_id = p_art_collection_id;
  delete from public.art_collections a where a.id = p_art_collection_id;
  perform private.art_prune(p_collection_id, v_traits);
  update public.art_collections a set position = a.position + 100000 where a.collection_id = p_collection_id;
  with ranked as (
    select a.id, (row_number() over (order by a.position) - 1)::integer as at
    from public.art_collections a where a.collection_id = p_collection_id
  )
  update public.art_collections a set position = r.at from ranked r where r.id = a.id;
  with ranked as (
    select t.token_id, row_number() over (order by t.token_id)::integer as id
    from public.tokens t where t.collection_id = p_collection_id
  )
  update public.tokens t set token_id = r.id
  from ranked r
  where t.collection_id = p_collection_id and t.token_id = r.token_id and t.token_id <> r.id;
end;
$$;

revoke all on function public.art_delete_art_collection(uuid, uuid) from public, anon;
grant execute on function public.art_delete_art_collection(uuid, uuid) to authenticated;

-- Writes weights from [{ traitId, weight, constant }] to the traits of one layer. Tolerant: only the
-- rows given are updated, ids that are not traits of this layer are ignored, and traits missing
-- from the table keep their values (a queued save can meet a trait removed or added meanwhile).
-- A constant forces the weight to 0.
create function public.art_set_layer_weights(p_collection_id uuid, p_layer_id uuid, p_rows jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform private.art_lock_owned(p_collection_id);
  if not exists (
    select 1 from public.layers l where l.id = p_layer_id and l.collection_id = p_collection_id
  ) then
    raise exception 'layer not found' using errcode = 'P0002';
  end if;
  update public.traits t
  set weight = case when w.constant is null then w.weight else 0 end,
    constant = w.constant
  from (
    select (e.x ->> 'traitId')::uuid as id, (e.x ->> 'weight')::numeric as weight, (e.x ->> 'constant')::integer as constant
    from jsonb_array_elements(p_rows) as e(x)
  ) w
  where t.id = w.id and t.layer_id = p_layer_id
    and (t.weight, t.constant) is distinct from (case when w.constant is null then w.weight else 0 end, w.constant);
end;
$$;

revoke all on function public.art_set_layer_weights(uuid, uuid, jsonb) from public, anon;
grant execute on function public.art_set_layer_weights(uuid, uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Tokens
-- ---------------------------------------------------------------------------------------------

-- The DNA guard reads the layers for every row it checks. Renumbering after a delete changes only
-- token_id, so the guard now runs when the DNA or the art collection is written.
drop trigger tokens_guard_dna on public.tokens;
create trigger tokens_guard_dna
before insert or update of dna, art_collection_id, collection_id on public.tokens
for each row execute function public.tokens_guard_dna();

-- Replaces the whole set from [{ tokenId, artCollectionId, dna, description }] and records its
-- seed. Delete then insert: the deferrable key rules out an upsert. The collections row is written
-- first, as the lock trigger's note asks.
create function public.art_save_tokens(p_collection_id uuid, p_tokens jsonb, p_seed bigint)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform private.art_lock_owned(p_collection_id, true);
  if jsonb_array_length(p_tokens) > 100000 then
    raise exception 'A project can have at most 100,000 tokens.' using errcode = '23514';
  end if;
  update public.collections c set generation_seed = p_seed where c.id = p_collection_id;
  delete from public.tokens t where t.collection_id = p_collection_id;
  insert into public.tokens (collection_id, token_id, art_collection_id, dna, description)
  select p_collection_id, x."tokenId", x."artCollectionId", x.dna, x.description
  from jsonb_to_recordset(p_tokens) as x("tokenId" integer, "artCollectionId" uuid, dna uuid[], description text);
end;
$$;

revoke all on function public.art_save_tokens(uuid, jsonb, bigint) from public, anon;
grant execute on function public.art_save_tokens(uuid, jsonb, bigint) to authenticated;

-- Writes the DNA and descriptions of some tokens from [{ tokenId, dna?, description? }] in one
-- statement. A key left out keeps its column; the DNA guard checks every new DNA.
create function public.art_update_tokens(p_collection_id uuid, p_rows jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform private.art_lock_owned(p_collection_id);
  update public.tokens t
  set dna = case
      when e.x ? 'dna' then array(
        select d.v from jsonb_array_elements_text(e.x -> 'dna') with ordinality as d(v, n) order by d.n
      )::uuid[]
      else t.dna
    end,
    description = case when e.x ? 'description' then e.x ->> 'description' else t.description end
  from jsonb_array_elements(p_rows) as e(x)
  where t.collection_id = p_collection_id and t.token_id = (e.x ->> 'tokenId')::integer;
end;
$$;

revoke all on function public.art_update_tokens(uuid, jsonb) from public, anon;
grant execute on function public.art_update_tokens(uuid, jsonb) to authenticated;

-- Deletes tokens and moves every later id up by the number of deleted ids below it, in one
-- set-based update under the deferrable primary key, so ids stay 1 to N.
create function public.art_delete_tokens(p_collection_id uuid, p_ids integer[])
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_gone integer[];
begin
  perform private.art_lock_owned(p_collection_id);
  with gone as (
    delete from public.tokens t
    where t.collection_id = p_collection_id and t.token_id = any (p_ids)
    returning t.token_id
  )
  select coalesce(array_agg(gone.token_id), '{}') into v_gone from gone;
  if cardinality(v_gone) = 0 then
    return;
  end if;
  update public.tokens t
  set token_id = t.token_id - (select count(*) from unnest(v_gone) as g(id) where g.id < t.token_id)::integer
  where t.collection_id = p_collection_id
    and t.token_id > (select min(g.id) from unnest(v_gone) as g(id));
end;
$$;

revoke all on function public.art_delete_tokens(uuid, integer[]) from public, anon;
grant execute on function public.art_delete_tokens(uuid, integer[]) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Assets and starting over
-- ---------------------------------------------------------------------------------------------

-- Writes the list order of a 1/1 or single asset project's files from [{ uploadId, position }].
create function public.art_set_asset_order(p_collection_id uuid, p_rows jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform private.art_lock_owned(p_collection_id);
  update public.uploads u
  set position = (e.x ->> 'position')::integer
  from jsonb_array_elements(p_rows) as e(x)
  where u.collection_id = p_collection_id and u.kind = 'asset' and u.id = (e.x ->> 'uploadId')::uuid;
end;
$$;

revoke all on function public.art_set_asset_order(uuid, jsonb) from public, anon;
grant execute on function public.art_set_asset_order(uuid, jsonb) to authenticated;

-- Empties a project's art: tokens, rules, groups, layers (traits cascade), art collections, the
-- layer images and the thumbnails only they used. The canvas and the seed are cleared, so any image
-- size can be uploaded again. Returns the deleted storage keys, for the action to delete the objects.
create function public.art_start_over(p_collection_id uuid)
returns text[]
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_keys text[];
begin
  perform private.art_lock_owned(p_collection_id, true);
  update public.collections c
  set canvas_width = null, canvas_height = null, generation_seed = null
  where c.id = p_collection_id;
  delete from public.tokens t where t.collection_id = p_collection_id;
  delete from public.rules r where r.collection_id = p_collection_id;
  delete from public.at_least_one g where g.collection_id = p_collection_id;
  delete from public.layers l where l.collection_id = p_collection_id;
  delete from public.art_collections a where a.collection_id = p_collection_id;
  with gone as (
    delete from public.uploads u
    where u.collection_id = p_collection_id
      and (
        u.kind = 'layer_image'
        or (
          u.kind = 'thumbnail'
          and exists (
            select 1 from public.uploads l
            where l.collection_id = p_collection_id and l.kind = 'layer_image' and l.content_hash = u.content_hash
          )
          and not exists (
            select 1 from public.uploads o
            where o.collection_id = p_collection_id and o.kind in ('asset', 'placeholder')
              and o.content_hash = u.content_hash
          )
        )
      )
    returning u.storage_key
  )
  select coalesce(array_agg(gone.storage_key), '{}') into v_keys from gone;
  return v_keys;
end;
$$;

revoke all on function public.art_start_over(uuid) from public, anon;
grant execute on function public.art_start_over(uuid) to authenticated;
