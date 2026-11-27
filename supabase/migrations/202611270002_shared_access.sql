begin;
create schema if not exists av_private;
revoke all on schema av_private from public, anon, authenticated;

create table av_private.shared_access (
  singleton boolean primary key default true check (singleton),
  code_hash text not null check (code_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  user_id uuid unique references auth.users(id)
);

create function public.av_link_allowed(code text) returns boolean
language sql stable security definer set search_path='' as $$
  select exists (
    select 1 from av_private.shared_access
    where length(code)=43 and code_hash=encode(sha256(convert_to(code,'UTF8')),'hex') and expires_at>now()
  )
$$;

create function public.av_bind_link(code text, actor uuid) returns boolean
language plpgsql security definer set search_path='' as $$
begin
  update av_private.shared_access set user_id=actor
  where public.av_link_allowed(code) and (user_id is null or user_id=actor);
  if not found then return false; end if;
  insert into public.profiles(user_id,display_name,role)
  values (actor,'映像・音響担当','editor')
  on conflict (user_id) do nothing;
  return true;
end $$;

revoke all on function public.av_link_allowed(text),public.av_bind_link(text,uuid) from public,anon,authenticated;
grant execute on function public.av_link_allowed(text),public.av_bind_link(text,uuid) to service_role;

create or replace function public.av_role() returns text
language sql stable security definer set search_path='' as $$
  select role from public.profiles p
  where p.user_id=(select auth.uid())
    and coalesce((auth.jwt()->>'is_anonymous')::boolean,false)=false
    and not exists (
      select 1 from av_private.shared_access a
      where a.user_id=p.user_id and a.expires_at<=now()
    )
$$;
commit;
