-- 081: Lighter load on the database (04-11-2026, after Supabase's "Disk IO budget" warning). Already applied.
--   • inv-open-units: rebuilt every 10 minutes instead of every minute (inv_open_units_cached() still rebuilds it
--     itself when it's over 3 minutes old, so Inventory stays current).
--   • helm_search_index (⌘K): built at most once every 2 minutes and shared, instead of on every screen.
--   • helm_new_orders (Dashboard card): built at most once a minute and shared.
select cron.alter_job((select jobid from cron.job where jobname = 'inv-open-units'), schedule := '*/10 * * * *');

create table if not exists helm_search_cache (id int primary key default 1, at timestamptz not null, rows jsonb not null);
alter table helm_search_cache enable row level security;
create or replace function public.helm_search_index() returns jsonb
language plpgsql security definer set search_path = public as $$
declare c helm_search_cache%rowtype; admin boolean;
begin
  if not public.is_active_user() then return '[]'::jsonb; end if;
  select * into c from helm_search_cache where id = 1;
  if (c.id is null or c.at < now() - interval '2 minutes') and pg_try_advisory_xact_lock(81081) then
    insert into helm_search_cache (id, at, rows)
    select 1, now(), coalesce(jsonb_agg(jsonb_build_object('id', id, 'ref', ref, 'order_number', order_number, 'phase', phase,
                                                           'channel', channel, 'carrier', carrier)), '[]'::jsonb)
    from public.helm_open_rows()
    on conflict (id) do update set at = excluded.at, rows = excluded.rows
    returning * into c;
  end if;
  admin := public.is_admin();
  return coalesce((select jsonb_agg(x) from jsonb_array_elements(coalesce(c.rows, '[]'::jsonb)) x
                   where admin or x ->> 'phase' in ('new', 'labelled')), '[]'::jsonb);
end $$;
revoke all on function public.helm_search_index() from public, anon;
grant execute on function public.helm_search_index() to authenticated;

do $m$ declare d text; begin
  if exists (select 1 from pg_proc where proname = 'helm_new_orders_build') then return; end if;
  d := pg_get_functiondef('public.helm_new_orders()'::regprocedure);
  d := replace(d, 'FUNCTION public.helm_new_orders()', 'FUNCTION public.helm_new_orders_build()');
  execute d;
end $m$;
revoke all on function public.helm_new_orders_build() from public, anon, authenticated;
create table if not exists helm_new_orders_cache (id int primary key default 1, at timestamptz not null, result jsonb);
alter table helm_new_orders_cache enable row level security;
create or replace function public.helm_new_orders() returns jsonb
language plpgsql security definer set search_path = public as $$
declare c helm_new_orders_cache%rowtype;
begin
  if not public.is_active_user() then return null; end if;
  select * into c from helm_new_orders_cache where id = 1;
  if (c.id is null or c.at < now() - interval '1 minute') and pg_try_advisory_xact_lock(81082) then
    insert into helm_new_orders_cache (id, at, result) values (1, now(), public.helm_new_orders_build())
    on conflict (id) do update set at = excluded.at, result = excluded.result
    returning * into c;
  end if;
  return c.result;
end $$;
revoke all on function public.helm_new_orders() from public, anon;
grant execute on function public.helm_new_orders() to authenticated;
