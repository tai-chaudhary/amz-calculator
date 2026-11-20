-- v2.91.0: report_pl_ship — three more things for the P&L to cost shipping with. Its own function, so the P&L's main
-- request (report_pl_lines) stays as fast as it was; if this one fails the P&L simply works as before.
-- (A first attempt added these to report_pl_lines itself: it took 45 seconds for the whole period against 3 before,
-- so it was rolled back within minutes. As its own function with materialised steps it takes under 2 seconds.)
--   extra_labels   order -> the portal's own dispatched labels HELM does not know about (bought through Amazon Buy
--                  Shipping, Veeqo or the carrier's site, or a second parcel): as many as the portal has beyond HELM's
--                  real parcels, the ones whose tracking HELM does not hold first. Replacements are not included.
--   weights        order -> kg of the stock that went out, for orders whose lines have no listing (eBay, TikTok)
--   ship_patterns  "listing|quantity" -> how such an order has really shipped since 19 Oct 2026 (parcels, service),
--                  seen on at least two orders — to estimate orders that have no label (older ones, and today's open ones)
-- Applied 16 Nov 2026. Safe to re-run.
create or replace function public.report_pl_ship(p_from date, p_to date, p_channel text default null)
 returns jsonb language plpgsql stable security definer set search_path to 'public' as $f$
declare res jsonb;
begin
  if not public.is_active_user() then raise exception 'Not allowed'; end if;
  with x as materialized (
    select l.order_ref, l.listing_id from sales_ledger l
    where l.sale_date between p_from and p_to and l.kind = 'sale' and l.order_ref is not null and (p_channel is null or l.channel = p_channel)
  ), o as materialized (
    select distinct order_ref from x
  ), hp as materialized (
    select o.order_ref, count(*) n, array_agg(upper(replace(p.tracking, ' ', ''))) trk
    from o join helm_orders h on h.ref = o.order_ref join helm_parcels p on p.order_id = h.id
    where coalesce(p.tracking, '') <> '' and (p.shipment_status is distinct from 4 or p.collected_at is not null or p.delivered_at is not null)
    group by o.order_ref
  ), xl as materialized (
    select q.order_ref, jsonb_agg(jsonb_build_object('carrier', q.carrier, 'service', q.service) order by q.rn) labels
    from (
      select o.order_ref, l.carrier, l.service, coalesce(hp.n, 0) helm_n, count(*) over (partition by o.order_ref) portal_n,
        row_number() over (partition by o.order_ref order by (upper(replace(coalesce(l.tracking, ''), ' ', '')) = any (coalesce(hp.trk, '{}'))), l.created_at desc) rn
      from o join dispatch_labels l on l.channel_ref = o.order_ref left join hp on hp.order_ref = o.order_ref
      where l.status = 'dispatched' and coalesce(l.reason, '') in ('', 'order', 'manual') and l.carrier not in ('GForce', 'Farrall''s')
    ) q where q.rn <= q.portal_n - q.helm_n group by q.order_ref
  ), nl as materialized (
    select distinct order_ref from x where listing_id is null
  ), wts as materialized (
    select u.order_ref, round(sum(u.units * coalesce(nullif(s.data->>'weightKg', '')::numeric, 0)), 3) kg
    from nl join cost_uses u on u.order_ref = nl.order_ref and u.kind = 'sale' join stock_items s on s.id = u.stock_item_id
    group by u.order_ref
  ), ps as materialized (
    select sl.order_ref, min(sl.listing_id::text) listing_id, sum(sl.qty) qty from sales_ledger sl
    where sl.kind = 'sale' and sl.sale_date >= date '2026-10-19' and sl.listing_id is not null and sl.order_ref is not null
    group by sl.order_ref having count(*) = 1 and sum(sl.qty) > 1
  ), pq as materialized (
    select ps.order_ref, ps.listing_id, ps.qty, count(*) n, min(p.service) svc
    from ps join helm_orders h on h.ref = ps.order_ref join helm_parcels p on p.order_id = h.id
    where coalesce(p.tracking, '') <> '' and (p.shipment_status is distinct from 4 or p.collected_at is not null or p.delivered_at is not null)
    group by ps.order_ref, ps.listing_id, ps.qty
  ), pat as (
    select listing_id, qty, mode() within group (order by n) parcels, mode() within group (order by svc) service, count(*) seen
    from pq group by listing_id, qty having count(*) >= 2
  )
  select jsonb_build_object(
    'extra_labels', coalesce((select jsonb_object_agg(order_ref, labels) from xl), '{}'::jsonb),
    'weights', coalesce((select jsonb_object_agg(order_ref, kg) from wts where kg > 0), '{}'::jsonb),
    'ship_patterns', coalesce((select jsonb_object_agg(listing_id || '|' || qty::text, jsonb_build_object('parcels', parcels, 'service', service, 'seen', seen)) from pat), '{}'::jsonb))
  into res;
  return res;
end $f$;
revoke all on function public.report_pl_ship(date, date, text) from public, anon;
grant execute on function public.report_pl_ship(date, date, text) to authenticated;
