-- The Product page (v2.43.0) — office only. Read-only views over what we already record.
-- Safe to re-run; only adds.

-- Units despatched per day (last p_days), the item codes it sold as, and how many went as a substitute
create or replace function public.product_sales(p_item uuid, p_days int default 90)
 returns jsonb language sql stable security definer set search_path to 'public'
as $$
  with p as (select id from inv_products where stock_item_id = p_item),
  m as (select mv.at, -mv.qty as units, mv.order_key, mv.note from inv_movements mv
        where mv.product_id in (select id from p) and mv.kind = 'despatch' and mv.at > now() - make_interval(days => greatest(p_days, 1))),
  codes as (
    select upper(i ->> 'code') as code, count(distinct m.order_key) as orders, sum(m.units) as units
    from m join dispatch_labels l on (l.upload_id::text || '|' || coalesce(l.order_key, l.id::text)) = m.order_key
    cross join lateral jsonb_array_elements(coalesce(l.items, '[]'::jsonb)) i
    group by 1)
  select jsonb_build_object(
    'daily', coalesce((select jsonb_agg(jsonb_build_object('d', d, 'units', u, 'orders', o) order by d)
                       from (select (at at time zone 'Europe/London')::date d, sum(units) u, count(distinct order_key) o from m group by 1) x), '[]'::jsonb),
    'codes', coalesce((select jsonb_agg(jsonb_build_object('code', code, 'orders', orders, 'units', units) order by units desc) from codes), '[]'::jsonb),
    'substitutes', (select coalesce(sum(units), 0) from m where note ilike 'substitute for%'),
    'units', (select coalesce(sum(units), 0) from m),
    'orders', (select count(distinct order_key) from m))
  where public.sees_costs()
$$;
revoke all on function public.product_sales(uuid, int) from public, anon;
grant execute on function public.product_sales(uuid, int) to authenticated;

-- Every PO line for it, newest first
create or replace function public.product_purchases(p_item uuid)
 returns jsonb language sql stable security definer set search_path to 'public'
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'po_id', po.id, 'po_number', po.po_number, 'supplier', po.supplier_name, 'status', po.status, 'kind', po.kind,
      'created_at', po.created_at, 'delivery_date', po.delivery_date, 'received_at', po.received_at,
      'qty', i.qty, 'qty_received', coalesce(i.qty_received, 0), 'unit_cost', i.unit_cost, 'line_status', i.line_status)
    order by po.created_at desc), '[]'::jsonb)
  from purchase_order_items i join purchase_orders po on po.id = i.po_id
  where i.stock_item_id = p_item and public.sees_costs()
$$;
revoke all on function public.product_purchases(uuid) from public, anon;
grant execute on function public.product_purchases(uuid) to authenticated;

-- One timeline: the product itself, its inventory side, its listings, its POs and their deliveries,
-- plus despatches rolled up into one line a day
create or replace function public.product_timeline(p_item uuid, p_limit int default 300)
 returns jsonb language sql stable security definer set search_path to 'public'
as $$
  with inv as (select id from inv_products where stock_item_id = p_item),
  listings as (select id from saved_products where data -> 'components' @> jsonb_build_array(jsonb_build_object('stockItemId', p_item::text))),
  pos as (select distinct po_id as id from purchase_order_items where stock_item_id = p_item),
  dels as (select id from goods_in_deliveries where po_id in (select id from pos)),
  ids as (select p_item::text as id union all select id::text from inv union all select id::text from listings
          union all select id::text from pos union all select id::text from dels),
  log as (
    select a.at, a.entity_type as type, a.entity_name as name, a.action, a.detail, a.user_name as who
    from activity_log a where a.entity_id::text in (select id from ids)),
  sold as (
    select max(mv.at) as at, 'despatch'::text as type, null::text as name, 'Despatched' as action,
           sum(-mv.qty)::int || ' units · ' || count(distinct mv.order_key) || ' orders' as detail, null::text as who
    from inv_movements mv where mv.product_id in (select id from inv) and mv.kind = 'despatch'
    group by (mv.at at time zone 'Europe/London')::date),
  moves as (
    select mv.at, 'stock'::text, null::text, case mv.kind when 'goods_in' then 'Put away' when 'opening' then 'Opening count' else initcap(replace(mv.kind, '_', ' ')) end,
           (case when mv.qty > 0 then '+' else '' end) || mv.qty::int || ' on ' || coalesce(nullif(mv.location, ''), 'no shelf') || coalesce(' · ' || mv.note, ''), mv.by_name
    from inv_movements mv where mv.product_id in (select id from inv) and mv.kind <> 'despatch')
  select coalesce(jsonb_agg(to_jsonb(t) order by t.at desc), '[]'::jsonb)
  from (select * from (select * from log union all select * from sold union all select * from moves) u order by at desc limit greatest(p_limit, 1)) t
  where public.sees_costs()
$$;
revoke all on function public.product_timeline(uuid, int) from public, anon;
grant execute on function public.product_timeline(uuid, int) to authenticated;
