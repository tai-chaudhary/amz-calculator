-- 058: Inventory loads fast again. inv_overview was taking ~8s — the statement limit — so it failed on
-- phones: every call worked out every open order's units (4.5s), and every half hour the first person in
-- also rebuilt the sales rates (5s) while they waited. Both now run in the background on a timer:
--  · open order units: kept in inv_open_units_cache, rebuilt every minute (and on demand if over 3 minutes old)
--  · sales rates: rebuilt every 30 minutes by cron, never inside a page load (unless over 3 hours old)
-- Safe to re-run.

create table if not exists inv_open_units_cache (
  id int primary key default 1,
  at timestamptz not null default now(),
  rows jsonb not null default '[]'::jsonb
);
alter table inv_open_units_cache enable row level security;   -- read only through the functions below

create or replace function public.inv_open_units_refresh() returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into inv_open_units_cache (id, at, rows)
  select 1, now(), coalesce(jsonb_agg(to_jsonb(u)), '[]'::jsonb) from public.inv_open_order_units() u
  on conflict (id) do update set at = excluded.at, rows = excluded.rows;
end $$;
revoke all on function public.inv_open_units_refresh() from public, anon, authenticated;

-- Same columns as inv_open_order_units(), from the cache (rebuilt first if it's over 3 minutes old)
create or replace function public.inv_open_units_cached()
returns table(product_id uuid, code text, name text, units numeric, order_key text, ref text, created_at timestamptz, status text)
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from inv_open_units_cache where id = 1 and at > now() - interval '3 minutes') then
    perform public.inv_open_units_refresh();
  end if;
  return query
    select (x->>'product_id')::uuid, x->>'code', x->>'name', (x->>'units')::numeric, x->>'order_key', x->>'ref',
           (x->>'created_at')::timestamptz, x->>'status'
    from inv_open_units_cache c, jsonb_array_elements(c.rows) x where c.id = 1;
end $$;
revoke all on function public.inv_open_units_cached() from public, anon;
grant execute on function public.inv_open_units_cached() to authenticated;

-- inv_overview reads the cache, and only rebuilds rates itself if the timer hasn't for 3 hours
do $$ declare d text;
begin
  d := pg_get_functiondef('public.inv_overview()'::regprocedure);
  d := replace(d, 'public.inv_open_order_units()', 'public.inv_open_units_cached()');
  d := replace(d, $q$m.rates_at < now() - interval '30 minutes'$q$, $q$m.rates_at < now() - interval '3 hours'$q$);
  execute d;
end $$;

do $$ begin
  if not exists (select 1 from cron.job where jobname = 'inv-open-units') then
    perform cron.schedule('inv-open-units', '* * * * *', 'select public.inv_open_units_refresh()');
  end if;
  if not exists (select 1 from cron.job where jobname = 'inv-rates') then
    perform cron.schedule('inv-rates', '*/30 * * * *', 'select public.inv_refresh_rates()');
  end if;
end $$;

select public.inv_open_units_refresh();
