-- New Orders: everyone who uses Dispatch sees every order HELM hasn't shipped,
-- back orders and holds included (before, only admins saw those), and each
-- order says where it is in HELM (New order, Picked, Back order …).
-- Clearing orders stays with the office (the portal decides who gets the button).
-- Safe to re-run.

create or replace function public.helm_new_orders()
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with h as (
    select r.*, o.status as helm_status from public.helm_open_rows() r join helm_orders o on o.id = r.id
    where public.is_active_user()
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
        'service', h.service, 'phase', h.phase, 'status', h.helm_status, 'items', h.items, 'order_date', h.order_date,
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
$function$;
