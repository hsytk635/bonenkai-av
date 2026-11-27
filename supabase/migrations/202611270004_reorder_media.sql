create or replace function public.reorder_media(original_ids uuid[], ordered_ids uuid[])
returns void language plpgsql security invoker set search_path='' as $$
declare current_ids uuid[];
begin
  if coalesce(public.av_role(),'') not in ('admin','editor') then
    raise exception '並べ替えの権限がありません' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(483218311);
  select array_agg(id order by sort_order,title,id) into current_ids from public.media;
  if current_ids is distinct from original_ids then
    raise exception '別の端末で一覧が変更されました。並べ替えを開き直してください。' using errcode='40001';
  end if;
  if cardinality(ordered_ids) is distinct from cardinality(original_ids)
    or (select array_agg(id order by id) from unnest(ordered_ids) as entries(id))
       is distinct from (select array_agg(id order by id) from unnest(original_ids) as entries(id)) then
    raise exception 'Invalid media order' using errcode='22023';
  end if;
  update public.media as m
  set sort_order=entries.position::integer
  from unnest(ordered_ids) with ordinality as entries(id,position)
  where m.id=entries.id and m.sort_order is distinct from entries.position::integer;
end $$;
revoke all on function public.reorder_media(uuid[],uuid[]) from public,anon,authenticated;
grant execute on function public.reorder_media(uuid[],uuid[]) to authenticated;
