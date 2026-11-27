begin;
-- The first migration used PostgreSQL-generated names for these table checks.
do $$
declare
  old_check text;
begin
  select conname into strict old_check from pg_constraint
  where conrelid='public.media'::regclass and contype='c'
    and pg_get_constraintdef(oid) like '%original%';
  execute format('alter table public.media drop constraint %I',old_check);

  select conname into strict old_check from pg_constraint
  where conrelid='public.media'::regclass and contype='c'
    and pg_get_constraintdef(oid) like '%audio/mpeg%';
  execute format('alter table public.media drop constraint %I',old_check);
end $$;

alter table public.media
  add constraint media_valid_storage_path check (
    storage_path ~ ('^' || created_by::text || '/' || id::text || '/original\.(mp3|wav|m4a|mp4|webm|png|jpg|jpeg|webp)$')
  ),
  add constraint media_valid_kind_mime check (
    (media_type in ('bgm','entrance','effect') and mime_type in ('audio/mpeg','audio/wav','audio/mp4'))
    or (media_type='video' and mime_type in ('video/mp4','video/webm'))
    or (media_type='image' and mime_type in ('image/png','image/jpeg','image/webp'))
  );

update storage.buckets
  set allowed_mime_types=array_append(allowed_mime_types,'audio/mp4')
  where id='av-media' and not ('audio/mp4'=any(allowed_mime_types));

alter policy av_objects_insert on storage.objects with check (
  bucket_id='av-media' and (select public.av_role()) in ('admin','editor') and
  name ~ ('^' || (select auth.uid())::text || '/[0-9a-f-]{36}/(original\.(mp3|wav|m4a|mp4|webm|png|jpg|jpeg|webp)|thumb\.jpg)$')
);
commit;
