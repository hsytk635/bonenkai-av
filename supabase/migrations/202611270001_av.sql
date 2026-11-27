begin;
create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (length(btrim(display_name)) between 1 and 120),
  role text not null check (role in ('admin','editor','viewer')),
  created_at timestamptz not null default now()
);
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(btrim(name)) between 1 and 120),
  color text not null default '#65c5b1' check (color ~ '^#[0-9a-fA-F]{6}$'),
  sort_order integer not null default 0
);
create table public.media (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(btrim(title)) between 1 and 120),
  media_type text not null check (media_type in ('bgm','entrance','effect','video','image')),
  category_id uuid references public.categories(id) on delete set null,
  storage_path text not null unique,
  file_name text not null,
  mime_type text not null,
  file_size bigint not null check (file_size between 1 and 50000000),
  checksum text not null unique check (checksum ~ '^[0-9a-f]{64}$'),
  duration double precision check (duration is null or (duration >= 0 and duration < 'Infinity'::float8)),
  volume integer not null default 100 check (volume between 0 and 100),
  loop_enabled boolean not null default false,
  ducking_enabled boolean not null default true,
  fade_in_ms integer not null default 0 check (fade_in_ms between 0 and 30000),
  fade_out_ms integer not null default 500 check (fade_out_ms between 0 and 30000),
  sort_order integer not null default 0,
  thumbnail_path text,
  color text not null default '#65c5b1' check (color ~ '^#[0-9a-fA-F]{6}$'),
  end_action text not null default 'standby' check (end_action in ('standby','hold','black')),
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (storage_path ~ ('^' || created_by::text || '/' || id::text || '/original\.(mp3|wav|mp4|webm|png|jpg|jpeg|webp)$')),
  check (thumbnail_path is null or thumbnail_path = created_by::text || '/' || id::text || '/thumb.jpg'),
  check ((media_type in ('bgm','entrance','effect') and mime_type in ('audio/mpeg','audio/wav'))
      or (media_type='video' and mime_type in ('video/mp4','video/webm'))
      or (media_type='image' and mime_type in ('image/png','image/jpeg','image/webp')))
);
create index media_category_idx on public.media(category_id);
create table public.settings (
  id uuid primary key default gen_random_uuid(),
  setting_key text not null unique check (setting_key='show'),
  setting_value jsonb not null,
  updated_at timestamptz not null default now(),
  check ((
    jsonb_typeof(setting_value->'duck')='boolean' and
    jsonb_typeof(setting_value->'reduction')='number' and (setting_value->>'reduction')::numeric between 0 and 100 and
    jsonb_typeof(setting_value->'attack')='number' and (setting_value->>'attack')::numeric between 0 and 10000 and
    jsonb_typeof(setting_value->'release')='number' and (setting_value->>'release')::numeric between 0 and 10000 and
    jsonb_typeof(setting_value->'standby')='string' and (setting_value->>'standby') ~ '^([0-9a-f-]{36})?$'
  ) is true)
);
create function public.av_touch() returns trigger language plpgsql set search_path='' as $$
begin
  new.updated_at := now();
  return new;
end $$;
create trigger media_touch before update on public.media for each row execute function public.av_touch();
create trigger settings_touch before update on public.settings for each row execute function public.av_touch();
create function public.av_role() returns text language sql stable security definer set search_path='' as $$
  select role from public.profiles where user_id=(select auth.uid()) and
  coalesce((auth.jwt()->>'is_anonymous')::boolean,false)=false
$$;
revoke all on function public.av_role() from public,anon,authenticated;
grant execute on function public.av_role() to authenticated;
create function public.manage_member(target uuid,next_role text) returns void language plpgsql security definer set search_path='' as $$
begin
  if public.av_role() is distinct from 'admin' or (next_role is not null and next_role not in ('editor','viewer')) then
    raise exception 'Access denied' using errcode='42501';
  end if;
  if next_role is null then
    delete from public.profiles where user_id=target and role<>'admin';
  else
    update public.profiles set role=next_role where user_id=target and role<>'admin';
  end if;
  if not found then raise exception 'Client cannot change this member'; end if;
end $$;
revoke all on function public.manage_member(uuid,text) from public,anon,authenticated;
grant execute on function public.manage_member(uuid,text) to authenticated;

alter table public.profiles enable row level security;
alter table public.media enable row level security;
alter table public.categories enable row level security;
alter table public.settings enable row level security;
revoke all on public.profiles,public.media,public.categories,public.settings from public,anon,authenticated;
grant select on public.profiles to authenticated;
grant select,insert,delete on public.media to authenticated;
grant update (title,media_type,category_id,volume,loop_enabled,ducking_enabled,fade_in_ms,fade_out_ms,sort_order,color,end_action) on public.media to authenticated;
grant select,insert,update,delete on public.categories,public.settings to authenticated;
grant select,insert,update,delete on public.profiles to service_role;
create policy profile_read on public.profiles for select to authenticated using ((select public.av_role()) is not null and (user_id=(select auth.uid()) or (select public.av_role())='admin'));
create policy media_read on public.media for select to authenticated using ((select public.av_role()) is not null);
create policy media_insert on public.media for insert to authenticated with check ((select public.av_role()) in ('admin','editor') and created_by=(select auth.uid()));
create policy media_update on public.media for update to authenticated using ((select public.av_role()) in ('admin','editor')) with check ((select public.av_role()) in ('admin','editor'));
create policy media_delete on public.media for delete to authenticated using ((select public.av_role()) in ('admin','editor'));
create policy categories_read on public.categories for select to authenticated using ((select public.av_role()) is not null);
create policy categories_write on public.categories for all to authenticated using ((select public.av_role()) in ('admin','editor')) with check ((select public.av_role()) in ('admin','editor'));
create policy settings_read on public.settings for select to authenticated using ((select public.av_role()) is not null);
create policy settings_write on public.settings for all to authenticated using ((select public.av_role())='admin') with check ((select public.av_role())='admin');

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('av-media','av-media',false,50000000,array['audio/mpeg','audio/wav','video/mp4','video/webm','image/png','image/jpeg','image/webp']);
create policy av_objects_read on storage.objects for select to authenticated using (
  bucket_id='av-media' and (select public.av_role()) is not null and
  ((select public.av_role()) in ('admin','editor') or exists (
    select 1 from public.media m where m.storage_path=storage.objects.name or m.thumbnail_path=storage.objects.name)));
create policy av_objects_insert on storage.objects for insert to authenticated with check (
  bucket_id='av-media' and (select public.av_role()) in ('admin','editor') and
  name ~ ('^' || (select auth.uid())::text || '/[0-9a-f-]{36}/(original\.(mp3|wav|mp4|webm|png|jpg|jpeg|webp)|thumb\.jpg)$'));
create policy av_objects_delete on storage.objects for delete to authenticated using (
  bucket_id='av-media' and (select public.av_role()) in ('admin','editor') and not exists (
    select 1 from public.media m where m.storage_path=storage.objects.name or m.thumbnail_path=storage.objects.name));
alter publication supabase_realtime add table public.media,public.categories,public.settings;
commit;
