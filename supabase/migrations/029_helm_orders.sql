-- ── HELM orders, live ──────────────────────────────────────────────────────
-- The helm-sync function reads HELM's orders every minute (HELM's Public API,
-- the key lives in the function's secrets). Kept here: what's in each order,
-- its courier and where it's got to. Never kept: the customer — no names,
-- addresses, phones or emails.
--
-- An order is followed from New Order until its label has been uploaded to
-- Dispatch (matched by order ref), then Dispatch takes over. In between:
--   new       — New Order, Processing, Picking, Picked… : no label yet
--   labelled  — HELM says Despatched, which here means the label's made,
--               but it hasn't been uploaded to the portal yet
--   backorder — HELM's Back Order: something's wrong with it (office)
--   hold      — on hold in HELM (office)
-- All four hold stock as open orders in Inventory, so nothing's counted twice
-- or missed in the gap between HELM and an upload.

create table if not exists helm_orders (
  id bigint primary key,                    -- HELM's order id
  order_number text,                        -- OR-…
  ref text,                                 -- the channel's order number, for people
  keys text[] not null default '{}',        -- every ref it could be uploaded under, normalised
  channel text,                             -- Amazon, eBay, TikTok…
  carrier text,                             -- Evri, DHL… as the warehouse says it
  service text,
  status int not null,
  is_hold boolean not null default false,
  items jsonb not null default '[]',        -- the order's lines, as on the packing slip: [{code, qty, name}]
  units jsonb not null default '[]',        -- what's in it, bundles opened: [{code, qty, name}]
  order_date timestamptz,
  labelled_at timestamptz,                  -- when HELM marked it despatched (label made)
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  closed_at timestamptz,                    -- cancelled, gone from HELM, or cleared by the office
  closed_reason text,
  closed_by text
);
create index if not exists helm_orders_open_idx on helm_orders (status) where closed_at is null;
create index if not exists dispatch_labels_helm_norm_idx on dispatch_labels (public.inv_norm(helm_order));

create table if not exists helm_sync (
  id int primary key default 1 check (id = 1),
  last_run timestamptz,
  last_ok timestamptz,
  last_error text,
  fetched int,
  ms int
);
insert into helm_sync (id) values (1) on conflict do nothing;

alter table helm_orders enable row level security;
alter table helm_sync enable row level security;
drop policy if exists "Read helm orders" on helm_orders;
create policy "Read helm orders" on helm_orders for select to authenticated using (public.is_active_user());
drop policy if exists "Read helm sync" on helm_sync;
create policy "Read helm sync" on helm_sync for select to authenticated using (public.is_active_user());

-- Where each HELM order is, for the portal
create or replace function public.helm_phase(h helm_orders) returns text
language sql immutable as $$
  select case
    when h.closed_at is not null or h.status in (1, 9) then 'closed'
    when h.status = 8 then 'labelled'
    when h.status = 12 then 'backorder'
    when h.is_hold then 'hold'
    else 'new'
  end
$$;

-- HELM orders still to come through Dispatch: not closed, and no label for them
-- uploaded yet. A labelled order that's never uploaded drops off after 14 days.
create or replace function public.helm_open_rows()
returns table (id bigint, order_number text, ref text, channel text, carrier text, service text, phase text,
               items jsonb, units jsonb, order_date timestamptz, labelled_at timestamptz, first_seen timestamptz)
language sql stable security definer set search_path = public as $$
  select h.id, h.order_number, h.ref, h.channel, h.carrier, h.service, public.helm_phase(h),
         h.items, h.units, h.order_date, h.labelled_at, h.first_seen
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

-- Open orders: uploaded labels not yet gone, plus HELM orders not uploaded yet.
-- Each order counts once, however many labels it has.
create or replace function public.inv_open_order_units()
returns table (product_id uuid, code text, name text, units numeric, order_key text, ref text, created_at timestamptz, status text)
language sql stable security definer set search_path = public as $$
  with o as (
    select l.upload_id::text || '|' || coalesce(l.order_key, l.id::text) as k,
           (array_agg(l.items order by jsonb_array_length(l.items) desc))[1] as items,
           min(coalesce(nullif(l.channel_ref, ''), nullif(l.helm_order, ''), l.customer)) as ref,
           min(l.created_at) as created_at,
           case when bool_or(l.status = 'held') then 'held' else 'waiting' end as status
    from dispatch_labels l
    where l.status in ('ready', 'held')
    group by 1
  )
  select e.product_id, e.code, e.name, sum(e.units), o.k, o.ref, o.created_at, o.status
  from o cross join lateral public.inv_expand(o.items) e
  where not exists (select 1 from inv_despatched d where d.order_key = o.k)
  group by e.product_id, e.code, e.name, o.k, o.ref, o.created_at, o.status
  union all
  select p.id, u ->> 'code', coalesce(p.name, u ->> 'name'),
         sum(coalesce(nullif(u ->> 'qty', '')::numeric, 0)),
         'helm|' || h.id, coalesce(h.ref, h.order_number), coalesce(h.order_date, h.first_seen), h.phase
  from public.helm_open_rows() h
  cross join lateral jsonb_array_elements(h.units) u
  left join inv_products p on p.code_key = public.inv_norm(u ->> 'code')
  group by p.id, u ->> 'code', coalesce(p.name, u ->> 'name'), h.id, h.ref, h.order_number, h.order_date, h.first_seen, h.phase
$$;

-- What Dispatch's New Orders card shows: the orders (the office also sees back
-- orders and holds), each product's stock, and when HELM was last read
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
    'orders', coalesce((select jsonb_agg(jsonb_build_object(
        'id', h.id, 'order_number', h.order_number, 'ref', h.ref, 'channel', h.channel, 'carrier', h.carrier,
        'service', h.service, 'phase', h.phase, 'items', h.items, 'order_date', h.order_date,
        'labelled_at', h.labelled_at, 'first_seen', h.first_seen,
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
    'sync', (select to_jsonb(s) from helm_sync s)
  )
$$;
revoke all on function public.helm_new_orders() from public, anon;
grant execute on function public.helm_new_orders() to authenticated;

-- The office clears a HELM order that will never come through Dispatch
create or replace function public.helm_clear_order(p_id bigint, p_by text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only the office can clear an order'; end if;
  update helm_orders set closed_at = now(), closed_reason = 'cleared', closed_by = p_by where id = p_id and closed_at is null;
end $$;
revoke all on function public.helm_clear_order(bigint, text) from public, anon;
grant execute on function public.helm_clear_order(bigint, text) to authenticated;

-- For ⌘K: open HELM orders by ref
create or replace function public.helm_search_index() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'ref', ref, 'order_number', order_number, 'phase', phase,
                                               'channel', channel, 'carrier', carrier)), '[]'::jsonb)
  from public.helm_open_rows()
  where public.is_active_user() and (phase in ('new', 'labelled') or public.is_admin())
$$;
revoke all on function public.helm_search_index() from public, anon;
grant execute on function public.helm_search_index() to authenticated;

-- Read HELM every minute
select cron.unschedule('helm-sync') where exists (select 1 from cron.job where jobname = 'helm-sync');
select cron.schedule('helm-sync', '* * * * *', $cron$
  select net.http_post(
    url := 'https://amuqewxxvlggtsyzbyry.supabase.co/functions/v1/helm-sync',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-notify-key', public.notify_key()),
    body := '{}'::jsonb,
    timeout_milliseconds := 50000)
$cron$);
