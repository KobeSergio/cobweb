-- Hardening owed by earlier phases (docs/specs/2026-10-17-production-hardening.md, section 14, point 8, ruled into
-- this plan's last code task): record_upload runs for the service role alone, so the size and type a row records
-- are the ones the upload action read from the stored object (HEAD) after it checked the session and the
-- ownership, never a caller's word. A creator's session could call it directly before, and record a small size for
-- a large object, past the project's 5 GB cap and the batch size the lock plans from. The owner the server checked
-- is passed in; the function locks the collection as that owner's, as it locked the caller's before.
drop function public.record_upload(
  uuid, public.upload_kind, text, text, text, public.media_type, bigint, integer, integer, text
);

create function public.record_upload(
  p_owner_id uuid,
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
  v_owner uuid;
  v_locked timestamptz;
  v_cw integer;
  v_ch integer;
  v_used bigint;
  v_id uuid;
begin
  if p_owner_id is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select c.owner_id, c.art_locked_at, c.canvas_width, c.canvas_height
  into v_owner, v_locked, v_cw, v_ch
  from public.collections c where c.id = p_collection_id and c.owner_id = p_owner_id for update;
  -- Only the owner's own row is ever locked; the owner test is in the select above.
  if v_owner is null then
    raise exception 'collection not found' using errcode = '42501';
  end if;
  if v_locked is not null then
    raise exception 'The art is locked and cannot change.' using errcode = '42501';
  end if;
  -- The column's check gives the key its shape; this pins the prefix to the owner's collection.
  if p_storage_key is null or split_part(p_storage_key, '/', 1) <> p_collection_id::text then
    raise exception 'The storage key must be under the collection''s own prefix.' using errcode = '23514';
  end if;

  -- A duplicate is reported before the cap, so a second tab at the cap reuses the file.
  if exists (
    select 1 from public.uploads u
    where u.collection_id = p_collection_id and u.content_hash = p_content_hash and u.kind = p_kind
  ) then
    raise unique_violation using message = 'This file is already in the project.';
  end if;

  select coalesce(sum(u.bytes), 0) into v_used from public.uploads u where u.collection_id = p_collection_id;
  if v_used + p_bytes > 5368709120 then
    raise exception 'This project has reached its 5 GB of files. Delete some files to upload more.'
      using errcode = '23514';
  end if;

  -- With no layer images left the canvas is unset, so deleting the last one frees it.
  if v_cw is not null and not exists (
    select 1 from public.uploads u where u.collection_id = p_collection_id and u.kind = 'layer_image'
  ) then
    v_cw := null;
    v_ch := null;
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

comment on function public.record_upload(
  uuid, uuid, public.upload_kind, text, text, text, public.media_type, bigint, integer, integer, text
) is
  'Records an upload for its owner''s collection, for the service role only: the upload action calls it after it checked the session, the ownership and the stored object''s size and type. Enforces the prefix, the 5 GB cap and the shared canvas under the collection''s lock.';

revoke all on function public.record_upload(
  uuid, uuid, public.upload_kind, text, text, text, public.media_type, bigint, integer, integer, text
) from public, anon, authenticated;
grant execute on function public.record_upload(
  uuid, uuid, public.upload_kind, text, text, text, public.media_type, bigint, integer, integer, text
) to service_role;
