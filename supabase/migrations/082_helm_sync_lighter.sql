-- 082: HELM syncs only write what changed (04-11-2026). Already applied.
--   • helm_orders / helm_parcels: a re-save that changes nothing is skipped (the sync re-sent ~300 orders a minute
--     and every parcel each half hour). last_seen / synced_at still move, hourly / daily.
--   • dispatch_apply_helm_tracking: runs when new labels or new HELM tracking have arrived, otherwise every 15 min.
create or replace function public.helm_orders_skip_same() returns trigger language plpgsql set search_path = public as $$
begin
  if (to_jsonb(new) - 'last_seen' - 'closed_at') = (to_jsonb(old) - 'last_seen' - 'closed_at')
     and (new.closed_at is null) = (old.closed_at is null)
     and old.last_seen > now() - interval '1 hour' then
    return null;
  end if;
  if old.closed_at is not null and new.closed_at is not null then new.closed_at := old.closed_at; end if;
  return new;
end $$;
drop trigger if exists helm_orders_skip_same on helm_orders;
create trigger helm_orders_skip_same before update on helm_orders for each row execute function public.helm_orders_skip_same();

create or replace function public.helm_parcels_skip_same() returns trigger language plpgsql set search_path = public as $$
begin
  if (to_jsonb(new) - 'synced_at') = (to_jsonb(old) - 'synced_at') and old.synced_at > now() - interval '1 day' then
    return null;
  end if;
  return new;
end $$;
drop trigger if exists helm_parcels_skip_same on helm_parcels;
create trigger helm_parcels_skip_same before update on helm_parcels for each row execute function public.helm_parcels_skip_same();

do $m$ declare d text; begin
  if exists (select 1 from pg_proc where proname = 'dispatch_apply_helm_tracking_run') then return; end if;
  d := pg_get_functiondef('public.dispatch_apply_helm_tracking(integer)'::regprocedure);
  d := replace(d, 'FUNCTION public.dispatch_apply_helm_tracking(', 'FUNCTION public.dispatch_apply_helm_tracking_run(');
  execute d;
end $m$;
revoke all on function public.dispatch_apply_helm_tracking_run(integer) from public, anon, authenticated;
create table if not exists helm_tracking_check (id int primary key default 1, at timestamptz, labels_at timestamptz, tracked int, result jsonb);
alter table helm_tracking_check enable row level security;
create or replace function public.dispatch_apply_helm_tracking(p_days integer default 30) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s helm_tracking_check%rowtype; la timestamptz; tr int; r jsonb;
begin
  select * into s from helm_tracking_check where id = 1;
  select max(created_at) into la from dispatch_labels where created_at > now() - interval '2 days';
  select count(*) into tr from helm_orders where tracking is not null and cardinality(tracking) > 0;
  if s.id is not null and s.at > now() - interval '15 minutes'
     and la is not distinct from s.labels_at and tr = s.tracked then
    return s.result;
  end if;
  r := public.dispatch_apply_helm_tracking_run(p_days);
  insert into helm_tracking_check (id, at, labels_at, tracked, result) values (1, now(), la, tr, r)
  on conflict (id) do update set at = excluded.at, labels_at = excluded.labels_at, tracked = excluded.tracked, result = excluded.result;
  return r;
end $$;
revoke all on function public.dispatch_apply_helm_tracking(integer) from public, anon, authenticated;
grant execute on function public.dispatch_apply_helm_tracking(integer) to service_role;
