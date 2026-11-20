-- 142 (v2.111.0, 19-11-2026): Returns rebuilt, part 2 — returns in the costing and the P&L, the dashboards' figures.
--
-- The owner agreed (19 Nov 2026, the returns plan, decision 6): a unit that comes back and goes on the shelf is credited
-- back to cost of goods sold AT THE COST IT LEFT AT, on the day it arrives (decision 5: stock on the arrival date).
-- Until now a return put on the shelf came in as "found stock" at the last cost paid, so its cost was charged twice:
-- once with the original order, again when it sold the second time.
--
--   cost_rebuild   a stock movement "Customer return" is now its own layer, at the cost that order's units left at
--                  (from the order's own draws; else the last cost), and a cost_uses row of kind 'customer return' with
--                  a NEGATIVE cost — the credit. Orders' cost of goods sold (kind 'sale') is untouched.
--   report_pl_days gains 'returns': that credit by day (whole business only, like replacements).
--   returns_stats  units sold per product for return rates (everyone with Returns), and for admins the money:
--                  refunds, return postage, SAFE-T paid (all from the channels' reports, already in the P&L), the
--                  back-in-stock credit, and the value of what was not resaleable.
--   returns_uploads  the returns report uploads for the Returns page (Uploads itself is admins only).
--
-- Patches cost_rebuild in place (guarded, safe to re-run). After applying, run select public.cost_rebuild() once.

set lock_timeout = '10s';

do $$
declare src text := pg_get_functiondef('public.cost_rebuild()'::regprocedure);
begin
  if position('customer return' in src) = 0 then
    -- 1. a variable for the cost a return comes back at
    src := replace(src, 'remaining numeric; off numeric;', 'remaining numeric; rc numeric; off numeric;');
    -- 2. "Customer return" movements are their own source, naming the order (from the return, RT-…)
    src := replace(src,
      $a$case m.kind when 'add' then 'found stock' when 'despatch_undo'$a$,
      $b$case m.kind when 'add' then case when coalesce(m.reason, '') ilike 'customer return%' then 'customer return' else 'found stock' end when 'despatch_undo'$b$);
    src := replace(src,
      $a$      case when m.kind = 'despatch_undo' then m.ref end
    from inv_movements m join inv_products ip on ip.id = m.product_id
    where ip.kind = 'product' and m.qty <> 0 and m.kind in ('add','count','remove','damage')$a$,
      $b$      case when m.kind = 'despatch_undo' then m.ref
           when m.kind = 'add' and coalesce(m.reason, '') ilike 'customer return%' then
             coalesce((select r.order_ref from returns r where r.ref = substring(m.note from 'RT-[0-9]+') limit 1), nullif(trim(split_part(coalesce(m.note, ''), ' · ', 2)), '')) end
    from inv_movements m join inv_products ip on ip.id = m.product_id
    where ip.kind = 'product' and m.qty <> 0 and m.kind in ('add','count','remove','damage')$b$);
    -- 3. the layer at the cost it left at, and the credit
    src := replace(src,
      $a$      if e.typ = 'in' then
        nseq := nseq + 1;$a$,
      $b$      if e.typ = 'in' and e.src = 'customer return' then
        -- what this order's units of this product cost when they left (its own draws); else the last cost
        rc := (select sum(d.units * l.unit_cost) / nullif(sum(d.units), 0) from _draw d join _ly l on l.seq = d.seq
                where d.sid = p.sid and d.order_ref is not null and d.order_ref = e.order_ref);
        nseq := nseq + 1;
        insert into _ly values (nseq, e.d, 'customer return', e.order_ref, e.units, coalesce(rc, lastc, gap, p.portal, 0), e.units);
        insert into cost_uses (stock_item_id, used_at, kind, order_ref, units, cost, flag)
          values (p.sid, e.d, 'customer return', e.order_ref, e.units, round(-e.units * coalesce(rc, lastc, gap, p.portal, 0), 4),
                  case when rc is null then 'came back at the last cost: the order it left on is not known or not costed' end);
        continue;
      end if;
      if e.typ = 'in' then
        nseq := nseq + 1;$b$);
    if position('rc numeric' in src) = 0 or position($x$'customer return' else 'found stock'$x$ in src) = 0
       or position($x$substring(m.note from 'RT-[0-9]+')$x$ in src) = 0 or position('rc := (select' in src) = 0 then
      raise exception 'cost_rebuild did not patch cleanly — nothing changed';
    end if;
    execute src;
  end if;
end $$;

-- The P&L's by-day extras, plus the back-in-stock credit (a positive amount = cost taken back off)
create or replace function public.report_pl_days(p_from date, p_to date, p_channel text default null::text)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare res jsonb;
begin
  if not public.is_admin() then raise exception 'Not allowed'; end if;
  if p_from is null or p_to is null or p_to < p_from then raise exception 'Choose the dates'; end if;
  select jsonb_build_object(
    'charges', coalesce((select jsonb_agg(jsonb_build_object('d', d, 'channel', channel, 'amount', amount)) from (
        select sale_date d, channel, round(sum(public.ledger_charge_net(channel, description, total)), 4) amount from sales_ledger
        where sale_date between p_from and p_to and kind = 'charge' and (p_channel is null or channel = p_channel)
        group by 1, 2 having sum(coalesce(total, 0)) <> 0) c), '[]'::jsonb),
    'replacements', case when p_channel is null then coalesce((select jsonb_agg(jsonb_build_object('d', d, 'cost', cost, 'units', units, 'orders', orders)) from (
        select (used_at at time zone 'Europe/London')::date d, round(sum(cost), 4) cost, sum(units) units, count(distinct order_ref) orders
        from cost_uses where kind = 'replacement' and (used_at at time zone 'Europe/London')::date between p_from and p_to group by 1) r), '[]'::jsonb) else '[]'::jsonb end,
    'losses', case when p_channel is null then coalesce((select jsonb_agg(jsonb_build_object('d', d, 'cost', cost)) from (
        select (used_at at time zone 'Europe/London')::date d, round(sum(cost), 4) cost
        from cost_uses where kind in ('damage', 'removed', 'stock loss')
          and (used_at at time zone 'Europe/London')::date between greatest(p_from, date '2026-12-01') and p_to group by 1) l), '[]'::jsonb) else '[]'::jsonb end,
    'returns', case when p_channel is null then coalesce((select jsonb_agg(jsonb_build_object('d', d, 'credit', credit, 'units', units)) from (
        select (used_at at time zone 'Europe/London')::date d, round(-sum(cost), 4) credit, sum(units) units
        from cost_uses where kind = 'customer return' and (used_at at time zone 'Europe/London')::date between p_from and p_to group by 1) x), '[]'::jsonb) else '[]'::jsonb end,
    'outside', case when p_channel is null then coalesce((select jsonb_agg(jsonb_build_object('d', d, 'returned', returned, 'startup', startup, 'losses_before', losses_before)) from (
        select (used_at at time zone 'Europe/London')::date d,
          round(coalesce(sum(cost) filter (where kind = 'returned to supplier'), 0), 4) returned,
          round(coalesce(sum(cost) filter (where kind = 'start-up difference'), 0), 4) startup,
          round(coalesce(sum(cost) filter (where kind in ('damage', 'removed', 'stock loss') and (used_at at time zone 'Europe/London')::date < date '2026-12-01'), 0), 4) losses_before
        from cost_uses where kind in ('returned to supplier', 'start-up difference', 'damage', 'removed', 'stock loss')
          and (used_at at time zone 'Europe/London')::date between p_from and p_to group by 1) o
        where returned <> 0 or startup <> 0 or losses_before <> 0), '[]'::jsonb) else '[]'::jsonb end
  ) into res;
  return res;
end $function$;

create or replace function public.returns_uploads() returns jsonb language sql stable security definer set search_path to 'public' as $$
  select case when not (public.can_open('returns') or public.can_open('customer-care')) then '[]'::jsonb else coalesce((
    select jsonb_agg(to_jsonb(u) - 'uploaded_by_id' order by u.uploaded_at desc) from (
      select * from report_uploads where source = 'amazon_returns' order by uploaded_at desc limit 60) u), '[]'::jsonb) end
$$;
revoke all on function public.returns_uploads() from public, anon;
grant execute on function public.returns_uploads() to authenticated;

-- The dashboards' figures for from..to. Everyone with Returns: units sold per product (for return rates). Admins also
-- get the money, every figure dated as the P&L dates it: refunds and the channels' charges on their ledger day, the
-- back-in-stock credit and what was not resaleable on the day the box arrived.
create or replace function public.returns_stats(p_from date, p_to date) returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare money boolean := public.is_admin();
begin
  if not (public.can_open('returns') or public.can_open('customer-care')) then raise exception 'Not allowed'; end if;
  return jsonb_build_object(
    'sold', coalesce((select jsonb_object_agg(pid, units) from (
        select ip.id pid, sum(s.qty * coalesce(nullif(c->>'qty', '')::numeric, 1)) units
          from sales_ledger s join saved_products sp on sp.id = s.listing_id, jsonb_array_elements(coalesce(sp.data->'components', '[]'::jsonb)) c
          join inv_products ip on ip.stock_item_id = nullif(c->>'stockItemId', '')::uuid
         where s.kind = 'sale' and s.qty > 0 and s.sale_date between p_from and p_to group by 1) x), '{}'::jsonb),
    'orders', (select count(distinct order_ref) from sales_ledger where kind = 'sale' and sale_date between p_from and p_to),
    'money', case when money then jsonb_build_object(
      'refunds', coalesce((select jsonb_agg(jsonb_build_object('d', d, 'channel', channel, 'amount', amount, 'fees', fees, 'orders', orders)) from (
          select sale_date d, channel, round(sum(coalesce(gross, 0) - coalesce(vat, 0)), 4) amount, round(sum(coalesce(fees, 0)), 4) fees, count(distinct order_ref) orders from sales_ledger
           where kind = 'refund' and sale_date between p_from and p_to group by 1, 2) r), '[]'::jsonb),
      'charges', coalesce((select jsonb_agg(jsonb_build_object('d', d, 'what', what, 'amount', amount)) from (
          select sale_date d, case when description ilike 'SAFE-T%' then 'safet' else 'postage' end what, round(sum(public.ledger_charge_net(channel, description, total)), 4) amount
            from sales_ledger where kind = 'charge' and sale_date between p_from and p_to
             and (description ilike 'SAFE-T%' or description ilike '%ReturnPostageBilling%') group by 1, 2) c), '[]'::jsonb),
      'credit', coalesce((select jsonb_agg(jsonb_build_object('d', d, 'credit', credit, 'units', units)) from (
          select (used_at at time zone 'Europe/London')::date d, round(-sum(cost), 4) credit, sum(units) units from cost_uses
           where kind = 'customer return' and (used_at at time zone 'Europe/London')::date between p_from and p_to group by 1) x), '[]'::jsonb),
      'written_off', coalesce((select jsonb_agg(jsonb_build_object('return_id', id, 'd', d, 'value', value)) from (
          select r.id, (r.received_at at time zone 'Europe/London')::date d,
                 round(sum((i->>'qty')::numeric * coalesce(
                   (select sum(u.cost) / nullif(sum(u.units), 0) from cost_uses u join inv_products ip on ip.stock_item_id = u.stock_item_id
                     where u.kind = 'sale' and u.order_ref = r.order_ref and ip.id = nullif(i->>'product_id', '')::uuid),
                   (select l.unit_cost from cost_layers l join inv_products ip on ip.stock_item_id = l.stock_item_id
                     where ip.id = nullif(i->>'product_id', '')::uuid order by l.received_at desc limit 1), 0)), 4) value
            from returns r, jsonb_array_elements(r.items) i
           where r.status <> 'expected' and (r.received_at at time zone 'Europe/London')::date between p_from and p_to
             and coalesce(i->>'outcome', case when r.condition = 'damaged' then 'disposed' end) in ('disposed', 'faulty', 'wrong_item', 'empty')
           group by r.id, r.received_at) w where value > 0), '[]'::jsonb),
      'claims_won', coalesce((select round(sum(outcome_amount), 2) from claims where kind = 'carrier' and return_id is not null and status = 'accepted'
          and (outcome_at at time zone 'Europe/London')::date between p_from and p_to), 0)
    ) end);
end $$;
revoke all on function public.returns_stats(date, date) from public, anon;
grant execute on function public.returns_stats(date, date) to authenticated;
