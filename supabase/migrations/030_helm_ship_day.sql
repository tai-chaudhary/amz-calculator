-- ── Which day a HELM order ships ───────────────────────────────────────────
-- Amazon, eBay and TikTok give an order placed after the cut-off a ship-by
-- date of the next working day (Monday to Saturday). Those orders still hold
-- stock straight away, but they belong on the next day's dispatch, not today's.
-- HELM's own despatch target is used when it has one; otherwise the cut-off
-- per channel (set by the office in Dispatch).

alter table helm_orders add column if not exists ship_by timestamptz;   -- HELM's despatch target date

create table if not exists helm_settings (
  id int primary key default 1 check (id = 1),
  cutoffs jsonb not null default '{"default": "14:00"}'::jsonb,   -- {"Amazon": "14:00", "eBay": "13:00", "default": "14:00"}
  updated_by text,
  updated_at timestamptz default now()
);
insert into helm_settings (id) values (1) on conflict do nothing;
alter table helm_settings enable row level security;
drop policy if exists "Read helm settings" on helm_settings;
create policy "Read helm settings" on helm_settings for select to authenticated using (public.is_active_user());

-- The next day carriers collect: Monday to Saturday
create or replace function public.next_working_day(d date) returns date
language sql immutable as $$
  select case when extract(isodow from d + 1) = 7 then d + 2 else d + 1 end
$$;

create or replace function public.helm_ship_day(p_order timestamptz, p_channel text, p_ship_by timestamptz)
returns date language plpgsql stable security definer set search_path = public as $$
declare t timestamp; c jsonb; cut time;
begin
  if p_ship_by is not null then return (p_ship_by at time zone 'Europe/London')::date; end if;
  if p_order is null then return (now() at time zone 'Europe/London')::date; end if;
  t := p_order at time zone 'Europe/London';
  select cutoffs into c from helm_settings where id = 1;
  cut := coalesce(nullif(c ->> coalesce(p_channel, ''), ''), nullif(c ->> 'default', ''), '14:00')::time;
  if extract(isodow from t) = 7 then return public.next_working_day(t::date); end if;   -- Sunday: Monday
  if t::time >= cut then return public.next_working_day(t::date); end if;
  return t::date;
end $$;

-- Rebuilt with ship_day (helm_open_rows' columns change, so it's dropped first)
drop function if exists public.helm_open_rows();
create function public.helm_open_rows()
returns table (id bigint, order_number text, ref text, channel text, carrier text, service text, phase text,
               items jsonb, units jsonb, order_date timestamptz, labelled_at timestamptz, first_seen timestamptz, ship_day date)
language sql stable security definer set search_path = public as $$
  select h.id, h.order_number, h.ref, h.channel, h.carrier, h.service, public.helm_phase(h),
         h.items, h.units, h.order_date, h.labelled_at, h.first_seen,
         public.helm_ship_day(h.order_date, h.channel, h.ship_by)
  from helm_orders h
  where public.helm_phase(h) <> 'closed'
    and (h.status <> 8 or coalesce(h.labelled_at, h.last_seen) > now() - interval '14 days')
    and not exists (
      select 1 from dispatch_labels l
      where l.status <> 'cancelled'
        and (public.inv_norm(l.channel_ref) = any (h.keys) or public.inv_norm(l.helm_order) = any (h.keys))
    )
$$;
revoke all on function public.helm_open_rows() from public, anon, authenticated;

create or replace function public.helm_new_orders() returns jsonb
language sql stable security definer set search_path = public as $$
  with h as (
    select * from public.helm_open_rows()
    where public.is_active_user() and (phase in ('new', 'labelled') or public.is_admin())
  ), unit_rows as (
    select h.id, p.id as product_id, u ->> 'code' as code, coalesce(nullif(u ->> 'qty', '')::numeric, 0) as qty
    from h cross join lateral jsonb_array_elements(h.units) u
    left join inv_products p on p.code_key = public.inv_norm(u ->> 'code')
  ), prods as (select distinct product_id from unit_rows where product_id is not null),
  uploaded as (
    select o.product_id, sum(o.units) as units from public.inv_open_order_units() o
    where o.order_key not like 'helm|%' and o.product_id in (select product_id from prods)
    group by o.product_id
  )
  select jsonb_build_object(
    'today', (now() at time zone 'Europe/London')::date,
    'orders', coalesce((select jsonb_agg(jsonb_build_object(
        'id', h.id, 'order_number', h.order_number, 'ref', h.ref, 'channel', h.channel, 'carrier', h.carrier,
        'service', h.service, 'phase', h.phase, 'items', h.items, 'order_date', h.order_date,
        'labelled_at', h.labelled_at, 'first_seen', h.first_seen, 'ship_day', h.ship_day,
        'units', (select coalesce(jsonb_agg(jsonb_build_object('product_id', r.product_id, 'code', r.code, 'qty', r.qty)), '[]'::jsonb)
                  from unit_rows r where r.id = h.id))
        order by h.order_date) from h), '[]'::jsonb),
    'stock', coalesce((select jsonb_object_agg(p.id, jsonb_build_object(
        'name', p.name, 'code', p.code,
        'on_hand', coalesce((select sum(b.qty) from inv_balances b where b.product_id = p.id and b.location <> ''), 0),
        'pick', coalesce((select sum(b.qty) from inv_balances b join inv_locations l on l.code = b.location
                          where b.product_id = p.id and l.pickable), 0),
        'uploaded', coalesce((select u.units from uploaded u where u.product_id = p.id), 0)))
      from inv_products p where p.id in (select product_id from prods)), '{}'::jsonb),
    'sync', (select to_jsonb(s) from helm_sync s),
    'cutoffs', (select cutoffs from helm_settings where id = 1)
  )
$$;
revoke all on function public.helm_new_orders() from public, anon;
grant execute on function public.helm_new_orders() to authenticated;

-- The office sets the cut-off per channel
create or replace function public.helm_set_cutoffs(p_cutoffs jsonb, p_by text) returns void
language plpgsql security definer set search_path = public as $$
declare k text; v text;
begin
  if not public.is_admin() then raise exception 'Only the office can change the cut-off'; end if;
  for k, v in select * from jsonb_each_text(p_cutoffs) loop
    if v !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'Cut-off for % should be a time like 14:00', k; end if;
  end loop;
  update helm_settings set cutoffs = p_cutoffs, updated_by = p_by, updated_at = now() where id = 1;
end $$;
revoke all on function public.helm_set_cutoffs(jsonb, text) from public, anon;
grant execute on function public.helm_set_cutoffs(jsonb, text) to authenticated;

-- Cut-off: 3pm Monday to Friday, 1pm Saturday (a channel can have its own weekday time)
create or replace function public.helm_ship_day(p_order timestamptz, p_channel text, p_ship_by timestamptz)
returns date language plpgsql stable security definer set search_path = public as $$
declare t timestamp; c jsonb; cut time;
begin
  if p_ship_by is not null then return (p_ship_by at time zone 'Europe/London')::date; end if;
  if p_order is null then return (now() at time zone 'Europe/London')::date; end if;
  t := p_order at time zone 'Europe/London';
  select cutoffs into c from helm_settings where id = 1;
  if extract(isodow from t) = 7 then return public.next_working_day(t::date); end if;   -- Sunday: Monday
  cut := case when extract(isodow from t) = 6
              then coalesce(nullif(c ->> 'saturday', ''), '13:00')
              else coalesce(nullif(c ->> coalesce(p_channel, ''), ''), nullif(c ->> 'default', ''), '15:00') end::time;
  if t::time >= cut then return public.next_working_day(t::date); end if;
  return t::date;
end $$;
update helm_settings set cutoffs = '{"default":"15:00","saturday":"13:00"}'::jsonb where id = 1;
