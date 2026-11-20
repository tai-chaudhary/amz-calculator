-- 144 · Returns posted at an Evri shop (H… parcel number) — v2.111.3, 20-11-2026
--
-- The team: most returns arrive with an H… number (H01FFA…, H04FUA…), not the T00W… on Amazon's label. That is
-- Evri's own parcel barcode, printed when the parcel is handed in at an Evri shop; Amazon's returns report never holds it
-- (0 of 161 requests). 87 of 161 requests are "customer posts it" with no tracking at all. So these boxes can only be
-- matched by what's inside and when they came:
--   1. returns_suggest takes the day the box was logged and ranks first the requests for that product Amazon says were
--      delivered back that day or the day before, then within a week, then within 30 days (the warehouse logs in batches:
--      on 20-11 the gap between Amazon's delivered date and logging ran 0–27 days); self-posts requested in the fortnight
--      before come next. It never offers a request made after the box was logged.
--   2. returns_automatch links a box to a request with no person needed when it is certain: exactly one request for the
--      box's products that Amazon says was delivered back up to 3 days before the box was logged, and that request
--      fits no other unmatched box. Anything less certain stays on To do → "Find the order" with the ranked suggestions.
--      It runs after every report upload (inside returns_link_amazon) and once now.

-- ── 1. Suggestions know the day the box arrived ────────────────────────────────────────────────────────────────────
drop function if exists public.returns_suggest(uuid[], text, numeric, uuid);
create or replace function public.returns_suggest(p_products uuid[], p_carrier text default null, p_qty numeric default null, p_exclude uuid default null, p_arrived timestamptz default null)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare logging_start constant timestamptz := '2026-10-28 00:00+00'; car text := lower(coalesce(p_carrier, ''));
        arr timestamptz := coalesce(p_arrived, now()); arr_d date := (coalesce(p_arrived, now()) at time zone 'Europe/London')::date;
begin
  if not (public.can_open('returns') or public.can_open('customer-care')) then raise exception 'Not allowed'; end if;
  if p_products is null or cardinality(p_products) = 0 then return '[]'::jsonb; end if;
  return coalesce((
    with cand as (
      -- 1. Amazon requests for these products with no box logged yet, made before the box arrived
      select a.order_ref, 'Amazon' channel, a.rma, a.request_date at_date, a.items,
             40 + case when dd.gap between 0 and 1 then 40 when dd.gap between 2 and 7 then 25 when dd.gap between 8 and 30 then 10 when dd.gap = -1 then 10 when dd.gap is not null then -25 else 0 end
                + case when a.self_post and arr - a.request_date between interval '0' and interval '14 days' then 15 when a.self_post then 5 else 0 end
                + case when p_qty is not null and a.qty = p_qty then 10 else 0 end
                + case when car <> '' and ((car like '%evri%' and a.carrier = 'HERMES_UK') or (car like '%royal%' and a.carrier = 'ROYAL_MAIL')) then 5 else 0 end score,
             array_remove(array[
               'Return requested ' || to_char(a.request_date at time zone 'Europe/London', 'DD-MM-YYYY') || coalesce(' · ' || replace(lower(regexp_replace(a.reason_code, '^(CR|AMZ-PG)-', '')), '_', ' '), ''),
               case when dd.gap between 0 and 1 then 'Amazon says it was delivered back ' || to_char(a.delivered_at at time zone 'Europe/London', 'DD-MM-YYYY') || ' — when this box was logged'
                    when dd.gap between 2 and 30 then 'Amazon says it was delivered back ' || to_char(a.delivered_at at time zone 'Europe/London', 'DD-MM-YYYY') || ', ' || dd.gap || ' days before this box was logged'
                    when dd.gap < -1 then 'Amazon says it was delivered back ' || to_char(a.delivered_at at time zone 'Europe/London', 'DD-MM-YYYY') || ', after this box was logged — probably another box'
                    when a.delivered_at is not null then 'Amazon says it was delivered back ' || to_char(a.delivered_at at time zone 'Europe/London', 'DD-MM-YYYY') end,
               case when a.self_post then 'Customer posts it themselves (an Evri shop label is likely)' end,
               case when p_qty is not null and a.qty = p_qty then 'Same quantity' end,
               case when coalesce(a.refund_amount, 0) > 0 then 'Already refunded £' || a.refund_amount::text end], null) reasons
        from amazon_returns a
        cross join lateral (select arr_d - (a.delivered_at at time zone 'Europe/London')::date gap) dd
       where a.return_id is null and a.request_date > arr - interval '120 days' and a.request_date <= arr + interval '1 day'
         and (a.delivered_at is null or a.delivered_at >= logging_start)
         and exists (select 1 from jsonb_array_elements(a.items) i where nullif(i->>'product_id', '')::uuid = any(p_products))
      union all
      -- 2. Orders of these products the carrier is bringing back (our own label's parcel)
      select coalesce(nullif(l.channel_ref, ''), l.helm_order), coalesce(hp.channel, 'Amazon'), null, coalesce(hp.returned_at, hp.problem_at, l.dispatched_at), public.order_contents(l.items),
             45 + case when car <> '' and lower(coalesce(b.carrier, '')) like '%' || split_part(car, ' ', 1) || '%' then 15 else 0 end,
             array_remove(array[
               case when hp.returned_at is not null or coalesce(hp.last_event, '') ilike 'RETURN%' then 'Carrier is returning it to us' when hp.status = 9 then 'Carrier had an address problem' else 'Delivery attempted, not delivered' end,
               'Sent ' || to_char(l.dispatched_at at time zone 'Europe/London', 'DD-MM-YYYY') || coalesce(' by ' || split_part(b.carrier, ' ', 1), '')], null)
        from dispatch_labels l join dispatch_batches b on b.id = l.batch_id join helm_parcels hp on hp.tracking = l.tracking
       where l.status = 'dispatched' and l.dispatched_at > arr - interval '90 days' and l.dispatched_at <= arr
         and (hp.returned_at is not null or coalesce(hp.last_event, '') ilike 'RETURN%' or hp.status in (6, 9))
         and exists (select 1 from jsonb_array_elements(public.order_contents(l.items)) i where nullif(i->>'product_id', '')::uuid = any(p_products))
      union all
      -- 3. Refunds in the sales ledger for these products, with no request in the report (another channel, or a goodwill refund)
      select s.order_ref, s.channel, null, max(s.sale_date)::timestamptz, jsonb_agg(distinct jsonb_build_object('product_id', ip.id, 'name', ip.name)),
             25, array['Refunded ' || to_char(max(s.sale_date), 'DD-MM-YYYY') || ' on ' || s.channel]
        from sales_ledger s join saved_products sp on sp.id = s.listing_id, jsonb_array_elements(coalesce(sp.data->'components', '[]'::jsonb)) c
        join inv_products ip on ip.stock_item_id = nullif(c->>'stockItemId', '')::uuid
       where s.kind = 'refund' and s.sale_date > arr_d - 60 and s.order_ref is not null and ip.id = any(p_products)
         and not exists (select 1 from amazon_returns a where a.order_ref = s.order_ref)
       group by s.order_ref, s.channel
      union all
      -- 4. Open cases for these products
      select c.order_ref, coalesce(c.channel, 'Amazon'), null, c.created_at, coalesce(c.items, '[]'::jsonb), 20,
             array['Open case ' || c.ref || ' (' || replace(c.kind, '_', ' ') || ')']
        from complaints c
       where c.status <> 'resolved' and c.order_ref is not null and c.created_at > arr - interval '90 days'
         and exists (select 1 from jsonb_array_elements(coalesce(c.items, '[]'::jsonb)) i where nullif(i->>'product_id', '')::uuid = any(p_products))
    ),
    open_cand as (
      select * from cand c where c.order_ref is not null
        and not exists (select 1 from returns r where r.order_ref = c.order_ref and r.status <> 'expected' and r.id is distinct from p_exclude)
    ),
    by_order as (
      select o.order_ref, min(o.channel) channel, max(o.rma) rma, max(o.at_date) at_date, (array_agg(o.items order by o.score desc))[1] items,
             greatest(1, least(99, max(o.score) + 10 * (count(*) - 1))) score,
             (select array_agg(distinct x) from open_cand o2, unnest(o2.reasons) x where o2.order_ref = o.order_ref) reasons
        from open_cand o group by o.order_ref
    )
    select jsonb_agg(jsonb_build_object('order_ref', order_ref, 'channel', channel, 'rma', rma, 'at', at_date, 'items', items, 'score', score, 'reasons', to_jsonb(reasons)) order by score desc, at_date desc)
      from (select * from by_order order by score desc, at_date desc limit 8) t
  ), '[]'::jsonb);
end $$;
revoke all on function public.returns_suggest(uuid[], text, numeric, uuid, timestamptz) from public, anon;
grant execute on function public.returns_suggest(uuid[], text, numeric, uuid, timestamptz) to authenticated;

-- ── 2. Certain matches made by themselves ──────────────────────────────────────────────────────────────────────────
create or replace function public.returns_automatch(p_by text default null) returns integer language plpgsql security definer set search_path to 'public' as $$
declare n int := 0; x record;
begin
  for x in
    with boxes as (
      select r.id, (r.received_at at time zone 'Europe/London')::date arrived,
             array(select distinct nullif(i->>'product_id', '')::uuid from jsonb_array_elements(coalesce(r.items, '[]'::jsonb)) i where nullif(i->>'product_id', '') is not null) pids
        from returns r
       where r.needs_match and r.status <> 'expected' and r.received_at is not null and r.order_ref is null
    ),
    pairs as (
      select b.id rid, a.rma, a.order_ref, a.reason_code, a.reason, a.items, a.delivered_at
        from boxes b join amazon_returns a
          on a.return_id is null and a.delivered_at is not null
         and b.arrived - (a.delivered_at at time zone 'Europe/London')::date between 0 and 3
         and exists (select 1 from jsonb_array_elements(a.items) i where nullif(i->>'product_id', '')::uuid = any(b.pids))
       where cardinality(b.pids) > 0
         and not exists (select 1 from returns o where o.order_ref = a.order_ref and o.status <> 'expected')
    )
    select p.* from pairs p
     where (select count(*) from pairs q where q.rid = p.rid) = 1
       and (select count(*) from pairs q where q.rma = p.rma) = 1
  loop
    update returns set rma = x.rma, amazon_reason = x.reason_code, channel = coalesce(channel, 'Amazon'),
        order_ref = x.order_ref, expected_items = coalesce(expected_items, x.items),
        reason = case when reason in ('to_check', 'other') or reason is null then x.reason else reason end,
        source = case when source = 'unknown' then 'customer' else source end,
        needs_match = false, matched_at = now(), matched_by = 'Amazon returns report',
        match_how = 'delivered_date', match_score = 90, updated_at = now(),
        history = history || jsonb_build_array(jsonb_build_object('at', now(), 'by', coalesce(p_by, 'Portal'), 'what',
          'Matched to Amazon return ' || x.rma || ' · order ' || x.order_ref || ' — the only request for these products Amazon says was delivered back ('
          || to_char(x.delivered_at at time zone 'Europe/London', 'DD-MM-YYYY') || ') just before this box was logged'))
     where id = x.rid and needs_match;
    if found then
      update amazon_returns set return_id = x.rid where rma = x.rma and return_id is null;
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
revoke all on function public.returns_automatch(text) from public, anon, authenticated;

-- ── 3. After every upload: links by label or RMA, then the certain ones by delivered date ────────────────────────────
create or replace function public.returns_link_amazon(p_by text default null) returns integer language plpgsql security definer set search_path to 'public' as $$
declare n int := 0; x record;
begin
  for x in
    select distinct on (r.id) r.id rid, a.rma, a.order_ref, a.reason_code, a.reason, a.items,
           case when returns_key(r.return_tracking) = returns_key(a.rma) or returns_key(r.rma) = returns_key(a.rma) then 'rma' else 'tracking' end how
      from returns r join amazon_returns a
        on (r.return_tracking is not null and length(returns_key(r.return_tracking)) >= 8
            and (returns_key(r.return_tracking) = returns_key(a.tracking) or returns_key(r.return_tracking) = returns_key(a.rma)))
        or (r.rma is not null and returns_key(r.rma) = returns_key(a.rma))
     where (a.return_id is null or a.return_id = r.id) and r.status <> 'expected'
       and not exists (select 1 from amazon_returns o where o.return_id = r.id and o.rma <> a.rma)
     order by r.id, a.request_date desc
  loop
    update amazon_returns set return_id = x.rid where rma = x.rma;
    update returns set rma = x.rma, amazon_reason = x.reason_code, channel = coalesce(channel, 'Amazon'),
        order_ref = coalesce(order_ref, x.order_ref), expected_items = coalesce(expected_items, x.items),
        reason = case when reason in ('to_check', 'other') or reason is null then x.reason else reason end,
        source = case when source = 'unknown' then 'customer' else source end,
        needs_match = false, matched_at = coalesce(matched_at, now()), matched_by = coalesce(matched_by, 'Amazon returns report'),
        match_how = coalesce(match_how, x.how), match_score = coalesce(match_score, 100), updated_at = now(),
        history = history || jsonb_build_array(jsonb_build_object('at', now(), 'by', coalesce(p_by, 'Portal'), 'what',
          'Matched to Amazon return ' || x.rma || ' · order ' || x.order_ref || ' (by ' || case x.how when 'rma' then 'the RMA' else 'the return label''s tracking' end || ')'))
     where id = x.rid and (rma is distinct from x.rma or needs_match);
    n := n + 1;
  end loop;
  return n + public.returns_automatch(p_by);
end $$;
revoke all on function public.returns_link_amazon(text) from public, anon, authenticated;

-- Once now, for the boxes already waiting
select public.returns_automatch('Portal') as matched_now;
