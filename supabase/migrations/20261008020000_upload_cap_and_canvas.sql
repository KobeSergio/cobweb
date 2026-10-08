-- record_upload enforces the project's 5 GB cap and the shared canvas size under the collection's
-- row lock, so parallel confirms cannot slip past either. Same signature, so grants and the
-- generated types stay as they are.
create or replace function public.record_upload(
  p_collection_id uuid,
  p_kind public.upload_kind,
  p_storage_key text,
  p_content_hash text,
  p_mime text,
  p_media_type public.media_type,
  p_bytes bigint,
  p_width integer,
  p_height integer,
  p_file_name text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_owner uuid;
  v_locked timestamptz;
  v_cw integer;
  v_ch integer;
  v_used bigint;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select c.owner_id, c.art_locked_at, c.canvas_width, c.canvas_height
  into v_owner, v_locked, v_cw, v_ch
  from public.collections c where c.id = p_collection_id for update;
  if v_owner is null or v_owner <> v_uid then
    raise exception 'collection not found' using errcode = '42501';
  end if;
  if v_locked is not null then
    raise exception 'The art is locked and cannot change.' using errcode = '42501';
  end if;
  -- The column's check gives the key its shape; this pins the prefix to the caller's collection.
  if p_storage_key is null or split_part(p_storage_key, '/', 1) <> p_collection_id::text then
    raise exception 'The storage key must be under the collection''s own prefix.' using errcode = '23514';
  end if;

  select coalesce(sum(u.bytes), 0) into v_used from public.uploads u where u.collection_id = p_collection_id;
  if v_used + p_bytes > 5368709120 then
    raise exception 'This project has reached its 5 GB of files. Delete some files to upload more.'
      using errcode = '23514';
  end if;

  if p_kind = 'layer_image' then
    if v_cw is null then
      update public.collections set canvas_width = p_width, canvas_height = p_height
      where id = p_collection_id;
    elsif p_width is distinct from v_cw or p_height is distinct from v_ch then
      raise exception 'Every layer image must be % x % in this project.', v_cw, v_ch
        using errcode = '23514';
    end if;
  end if;

  insert into public.uploads (collection_id, kind, storage_key, content_hash, mime, media_type, bytes, width, height, file_name)
  values (p_collection_id, p_kind, p_storage_key, p_content_hash, p_mime, p_media_type, p_bytes, p_width, p_height, p_file_name)
  returning id into v_id;
  return v_id;
end;
$$;
