-- 110 — Open orders on the Profit & Loss (v2.85.0). Safe to re-run; one new function for reading, nothing existing changed.
--
-- The owner (15 Nov 2026): Today must show estimates from the orders open in HELM, costed from the portal — and so
-- must every period that includes today. Until now the P&L only knew an order once it was despatched (the sales
-- ledger takes HELM's orders at status 8, labelled), so Today was empty until the first label of the day and a Sunday
-- showed nothing at all.
--
-- report_pl_open gives the orders that are open in HELM right now — not labelled, not closed — as lines in exactly the
-- shape report_pl_lines gives, dated TODAY, so the screen can add them to the day they are waiting in. Once an order
-- is despatched it leaves this list and arrives in the sales ledger on its despatch day, so nothing is counted twice.
-- The money is worked out the way sales_refresh_helm does for a despatched HELM order: the order's total shared
-- across its lines by listing price, VAT as HELM has it (or 1/6 when it has none), the fee from the listing's own
-- referral fee. Every line is an estimate (fee_estimated = true, no cost from the costing yet).
create or replace function public.report_pl_open(p_channel text default null)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare res jsonb; today date := public.uk_today();
begin
  if not public.is_admin() then raise exception 'Not allowed'; end if;
  with o as (
    select h.id, h.channel, h.ref order_ref, h.order_date, h.money, h.listing_lines
    from helm_orders h
    where h.closed_at is null and h.labelled_at is null and h.status <> 8 and h.money is not null
      and jsonb_typeof(h.listing_lines) = 'array' and (p_channel is null or h.channel = p_channel)
  ), l as (
    select o.*, ll.ord, ll.v, s.id listing_id, s.name listing_name, s.data->>'asin' asin,
      nullif(s.data->>'sellPrice','')::numeric price, nullif(s.data->>'refFee','')::numeric fee_pct
    from o cross join lateral jsonb_array_elements(o.listing_lines) with ordinality ll(v, ord)
    left join lateral (
      select sp.id, sp.name, sp.data from saved_products sp
      where coalesce(sp.data->>'channel','Amazon') = o.channel
        and (ll.v->>'listing_sku') is not null and upper(trim(sp.data->>'listingSku')) = upper(trim(ll.v->>'listing_sku'))
      order by (coalesce(sp.data->>'archived','') = 'true') limit 1) s on true
  ), w as (
    select l.*, greatest(coalesce(l.price, 1), 0.01) * greatest(coalesce((l.v->>'qty')::numeric, 1), 1) wt,
      sum(greatest(coalesce(l.price, 1), 0.01) * greatest(coalesce((l.v->>'qty')::numeric, 1), 1)) over (partition by l.id) wt_all
    from l
  ), r as (
    select w.*, w.wt / w.wt_all share, coalesce((w.money->>'total')::numeric, 0) tot, coalesce((w.money->>'tax')::numeric, 0) tax
    from w
  )
  select jsonb_build_object(
    'today', today,
    'orders', (select count(*) from o),
    'lines', coalesce((select jsonb_agg(jsonb_build_object(
        'kind', 'sale', 'sale_date', today, 'channel', r.channel, 'order_ref', r.order_ref, 'source', 'helm_open', 'open', true,
        'ordered_at', r.order_date, 'listing_id', r.listing_id, 'listing_sku', r.v->>'listing_sku', 'asin', r.asin,
        'qty', coalesce((r.v->>'qty')::numeric, 0),
        'gross', round(r.tot * r.share, 4),
        'vat', round(case when r.tax = 0 then r.tot * r.share / 6 else r.tax * r.share end, 4),
        'fees', round(- r.tot * r.share * coalesce(r.fee_pct, 0) / 100, 4),
        'fee_estimated', true, 'cogs_real', null)) from r), '[]'::jsonb)
  ) into res;
  return res;
end $$;
revoke all on function public.report_pl_open(text) from public, anon;
grant execute on function public.report_pl_open(text) to authenticated;
