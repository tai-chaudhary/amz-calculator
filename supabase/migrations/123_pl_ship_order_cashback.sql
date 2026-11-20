-- 123 — report_pl_ship also returns the cashback paid on each order, and the charges by kind (v2.93.0)
--
-- APPLIED to the live database on 16 Nov 2026 (in two steps; this file is the function as it now stands). The texts
-- before each step are in public.fn_backups ("report_pl_ship before 123", "… before 123b (cashback only)").
--
-- Why: the P&L's "Losing money" card judged each order on its own, without the Ship+ cashback Amazon paid on it,
-- so orders that were covered by their cashback were shown as losses. And "Other charges and credits" was one
-- figure with nothing to open.
--
-- Two new keys (everything else is exactly migration 119):
--   order_cashback { order ref → amount }        the FBM Ship+ cashback ("Incentive disbursement") paid on each order
--                                                of the period, on whatever date it was paid. Ex VAT, as paid.
--                                                ONLY the cashback: return postage belongs with the refund, and a
--                                                label bought through Amazon is already in the order's shipping.
--                                                Checked 1 Aug – 16 Nov: 8,458 orders, £3,146.10, 10p to £2.00 each —
--                                                the same total as the cashback in the ledger.
--   charge_days    [{ d, channel, what, amount }] the period's charges by day, channel and kind. They add up, day by
--                                                day and channel by channel, to report_pl_days' charges (checked:
--                                                1 Aug – 16 Nov, £2,519.07 both ways, no day out).
--
-- Read-only. Timed as a signed-in admin for 1 Aug – 16 Nov: 0.9s.

create or replace function public.report_pl_ship(p_from date, p_to date, p_channel text default null)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
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
    'order_cashback', coalesce((select jsonb_object_agg(q.order_ref, q.amt) from (
        select s.order_ref, round(sum(public.ledger_charge_net(s.channel, s.description, s.total)), 4) amt
        from sales_ledger s where s.kind = 'charge' and s.description ilike '%Incentive disbursement%' and s.order_ref in (select o.order_ref from o) group by 1) q where q.amt <> 0), '{}'::jsonb),
    'charge_days', coalesce((select jsonb_agg(to_jsonb(q)) from (
        select s.sale_date d, s.channel,
          case when s.description ilike '%Incentive disbursement%' then 'FBM Ship+ cashback'
               when s.description ilike 'SAFE-T%' then 'SAFE-T reimbursements'
               when s.description ilike '%Subscription%' then 'Subscription'
               when s.description ilike '%Promoted Listings%' then 'Promoted listings'
               when s.description ilike '%ReturnPostageBilling%' then 'Return postage'
               when s.description ilike '%Label Purchased%' then 'Delivery labels bought through Amazon'
               when s.description ilike '%Label Refunded%' then 'Delivery labels refunded'
               else coalesce(nullif(trim(split_part(s.description, ':', 1)), ''), 'Other') end what,
          round(sum(public.ledger_charge_net(s.channel, s.description, s.total)), 4) amount
        from sales_ledger s where s.kind = 'charge' and s.sale_date between p_from and p_to and (p_channel is null or s.channel = p_channel)
        group by 1, 2, 3) q where q.amount <> 0), '[]'::jsonb),
    'ship_patterns', coalesce((select jsonb_object_agg(listing_id || '|' || qty::text, jsonb_build_object('parcels', parcels, 'service', service, 'seen', seen)) from pat), '{}'::jsonb))
  into res;
  return res;
end $function$;
