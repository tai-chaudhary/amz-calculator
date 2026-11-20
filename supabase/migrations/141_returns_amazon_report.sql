-- 141 (v2.111.0, 19-11-2026): Returns rebuilt, part 1 — the Amazon returns report, matching, suggestions, SAFE-T claims.
--
-- The owner's plan (project doc "Returns rebuild — full plan and scope", agreed 19 Nov 18:29):
--   * Jignesh uploads Amazon's returns report (XML or TSV) every day on the Returns page. Each request is kept here,
--     keyed by Amazon's return reference (RMA), and updated on every upload — never added twice.
--   * Those requests ARE the Expected list for Amazon (no copy is made in `returns`). When the warehouse scans a box
--     (the return label's tracking or the RMA) it is matched at once; a return logged before the report arrives is
--     matched when the report comes in.
--   * A box that matches nothing gets suggested orders: open requests for the products in it (self-post ones too),
--     orders of those products the carrier returned, refunds with nothing back, open cases.
--   * SAFE-T claims live in Claims (kind = 'safet'), with the return they come from.
--   * The carrier-return signal is fixed: HELM never sends status 10; a parcel coming back has `returned_at` (or a
--     RETURNED_TO_SENDER event) with status 7. returns_scan and claims_scan now see those.
--
-- ADDITIVE: one new table, new columns that default to nothing, new functions. returns_scan and claims_scan are
-- replaced with versions that ALSO pick up returned parcels (nothing they did before stops). No customer details are
-- kept — the report has none. Safe to re-run.

set lock_timeout = '10s';

-- ── Keys ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.returns_key(p text) returns text language sql immutable as $$
  select upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g'))
$$;

-- Amazon's reason code → the portal's reason (CareParts RETURN_REASONS). The code itself is kept as well.
create or replace function public.returns_reason_of(p_code text) returns text language sql immutable as $$
  select case upper(coalesce(p_code, ''))
    when 'CR-DAMAGED_BY_FC' then 'damaged_packing'
    when 'CR-DAMAGED_BY_CARRIER' then 'damaged'
    when 'CR-SWITCHEROO' then 'switcheroo'
    when 'CR-UNWANTED_ITEM' then 'changed_mind'
    when 'CR-NOT_COMPATIBLE' then 'not_compatible'
    when 'CR-ORDERED_WRONG_ITEM' then 'ordered_wrong'
    when 'CR-MISSED_ESTIMATED_DELIVERY' then 'late'
    when 'CR-QUALITY_UNACCEPTABLE' then 'not_happy'
    when 'AMZ-PG-BAD-DESC' then 'bad_description'
    when 'CR-FOUND_BETTER_PRICE' then 'better_price'
    when 'CR-NO_REASON_GIVEN' then 'no_reason'
    when 'CR-DEFECTIVE' then 'faulty'
    when 'CR-MISSING_PARTS' then 'missing_parts'
    when 'CR-UNAUTHORIZED_PURCHASE' then 'unauthorised'
    when 'CR-WRONG_ITEM' then 'wrong_item'
    else 'other' end
$$;

-- What was in a returned Amazon line, as our products: the order's own listing (from the sales ledger), else the
-- listing with that Listing SKU; its components × the quantity. Unknown → the SKU and Amazon's name, no product.
create or replace function public.returns_sku_items(p_order text, p_sku text, p_qty numeric, p_name text)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare lid uuid; res jsonb;
begin
  select listing_id into lid from sales_ledger where order_ref = p_order and listing_sku = p_sku and listing_id is not null limit 1;
  if lid is null then
    select id into lid from saved_products where upper(trim(data->>'listingSku')) = upper(trim(p_sku))
      order by (coalesce(data->>'channel', 'Amazon') = 'Amazon') desc limit 1;
  end if;
  if lid is not null then
    select jsonb_agg(jsonb_build_object('product_id', ip.id, 'code', ip.code, 'name', ip.name,
             'qty', coalesce(p_qty, 1) * coalesce(nullif(c->>'qty', '')::numeric, 1)))
      into res
      from saved_products sp, jsonb_array_elements(coalesce(sp.data->'components', '[]'::jsonb)) c
      join inv_products ip on ip.stock_item_id = nullif(c->>'stockItemId', '')::uuid
     where sp.id = lid;
  end if;
  return coalesce(res, jsonb_build_array(jsonb_build_object('product_id', null, 'code', p_sku, 'name', coalesce(p_name, p_sku), 'qty', coalesce(p_qty, 1))));
end $$;
revoke all on function public.returns_sku_items(text, text, numeric, text) from public, anon;
grant execute on function public.returns_sku_items(text, text, numeric, text) to authenticated;

-- ── Amazon's return requests ─────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.amazon_returns (
  rma text primary key,                         -- Amazon RMA ID (D…RRMA)
  order_ref text not null,
  order_date timestamptz, request_date timestamptz, status text,
  label_type text, label_cost numeric, label_paid_by text, carrier text, tracking text,
  self_post boolean not null default false,    -- AmazonUnPaidLabel: the customer posts it, no tracking
  a_to_z boolean not null default false, prime boolean not null default false,
  asin text, sku text, item_name text, qty integer, items jsonb not null default '[]'::jsonb,
  reason_code text, reason text, in_policy boolean, return_type text, resolution text,
  delivered_at timestamptz,                     -- Amazon: delivered back to us
  order_amount numeric, order_qty integer, refund_amount numeric,
  safet_reason text, safet_claim_id text, safet_state text, safet_created_at timestamptz, safet_amount numeric,
  category text, order_item_id text,
  return_id uuid,                               -- the box the warehouse logged for it
  first_seen timestamptz not null default now(), last_seen timestamptz not null default now(), seen integer not null default 1,
  upload_id bigint
);
create index if not exists amazon_returns_order_idx on public.amazon_returns (order_ref);
create index if not exists amazon_returns_tracking_idx on public.amazon_returns (public.returns_key(tracking));
create index if not exists amazon_returns_rmakey_idx on public.amazon_returns (public.returns_key(rma));
create index if not exists amazon_returns_open_idx on public.amazon_returns (request_date) where return_id is null;
alter table public.amazon_returns enable row level security;
drop policy if exists "Amazon returns read" on public.amazon_returns;
create policy "Amazon returns read" on public.amazon_returns for select to authenticated using ((select public.can_open('returns') or public.can_open('customer-care')));

-- ── Returns: what the scan and the report add ────────────────────────────────────────────────────────────────────────
alter table public.returns add column if not exists rma text;
alter table public.returns add column if not exists amazon_reason text;           -- Amazon's code, e.g. CR-SWITCHEROO
alter table public.returns add column if not exists match_how text;               -- rma | tracking | order | suggestion | office
alter table public.returns add column if not exists match_score numeric;
alter table public.returns add column if not exists expected_items jsonb;          -- what was expected back (qty check)
create index if not exists returns_rma_idx on public.returns (public.returns_key(rma)) where rma is not null;
create index if not exists returns_trk_idx on public.returns (public.returns_key(return_tracking)) where return_tracking is not null;
create index if not exists returns_order_idx on public.returns (order_ref) where order_ref is not null;

-- A return that names an RMA is that request's box.
create or replace function public.returns_link_rma() returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.rma is not null and (tg_op = 'INSERT' or new.rma is distinct from old.rma) then
    update amazon_returns set return_id = new.id where returns_key(rma) = returns_key(new.rma) and (return_id is null or return_id = new.id);
  end if;
  return new;
end $$;
drop trigger if exists returns_link_rma on public.returns;
create trigger returns_link_rma after insert or update of rma on public.returns for each row execute function public.returns_link_rma();

-- ── Claims: SAFE-T beside carrier claims ─────────────────────────────────────────────────────────────────────────────
alter table public.claims add column if not exists kind text not null default 'carrier';   -- carrier | safet
alter table public.claims add column if not exists return_id uuid;
alter table public.claims add column if not exists rma text;
alter table public.claims add column if not exists safet_claim_id text;                     -- Amazon's SAFE-T claim number
alter table public.claims add column if not exists deadline date;
create index if not exists claims_return_idx on public.claims (return_id) where return_id is not null;
create unique index if not exists claims_safet_rma_uq on public.claims (rma) where kind = 'safet' and rma is not null;

-- ── Upload ───────────────────────────────────────────────────────────────────────────────────────────────────────────
-- p_rows: the report read in the browser (lib/returnsReport.js), one object per request with the field names of this
-- table. Upserted by RMA: Amazon's later state (delivered back, refunded, SAFE-T) replaces the earlier one.
create or replace function public.amazon_returns_upsert(p_rows jsonb, p_file text default null, p_by text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare up_id bigint; n_new int := 0; n_upd int := 0; n_linked int := 0; r jsonb; was boolean; d_from date; d_to date;
begin
  if not (public.can_open('returns') or public.can_open('customer-care')) then raise exception 'Not allowed'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then raise exception 'Nothing in the file'; end if;
  select min((x->>'request_date')::timestamptz)::date, max((x->>'request_date')::timestamptz)::date into d_from, d_to from jsonb_array_elements(p_rows) x;
  insert into report_uploads (source, file_name, date_from, date_to, lines, new_lines, uploaded_by, uploaded_by_id)
    values ('amazon_returns', p_file, d_from, d_to, jsonb_array_length(p_rows), 0, p_by, auth.uid()) returning id into up_id;

  for r in select * from jsonb_array_elements(p_rows) loop
    continue when coalesce(r->>'rma', '') = '' or coalesce(r->>'order_ref', '') = '';
    select exists (select 1 from amazon_returns where rma = r->>'rma') into was;
    insert into amazon_returns as a (rma, order_ref, order_date, request_date, status, label_type, label_cost, label_paid_by, carrier, tracking, self_post,
        a_to_z, prime, asin, sku, item_name, qty, items, reason_code, reason, in_policy, return_type, resolution, delivered_at, order_amount, order_qty,
        refund_amount, safet_reason, safet_claim_id, safet_state, safet_created_at, safet_amount, category, order_item_id, upload_id)
    values (r->>'rma', r->>'order_ref', nullif(r->>'order_date', '')::timestamptz, nullif(r->>'request_date', '')::timestamptz, nullif(r->>'status', ''),
        nullif(r->>'label_type', ''), nullif(r->>'label_cost', '')::numeric, nullif(r->>'label_paid_by', ''), nullif(r->>'carrier', ''), nullif(r->>'tracking', ''),
        coalesce(r->>'label_type', '') ilike '%unpaid%',
        coalesce((r->>'a_to_z')::boolean, false), coalesce((r->>'prime')::boolean, false), nullif(r->>'asin', ''), nullif(r->>'sku', ''), nullif(r->>'item_name', ''),
        nullif(r->>'qty', '')::integer,
        public.returns_sku_items(r->>'order_ref', r->>'sku', coalesce(nullif(r->>'qty', '')::numeric, 1), r->>'item_name'),
        nullif(r->>'reason_code', ''), public.returns_reason_of(r->>'reason_code'), (r->>'in_policy')::boolean, nullif(r->>'return_type', ''), nullif(r->>'resolution', ''),
        nullif(r->>'delivered_at', '')::timestamptz, nullif(r->>'order_amount', '')::numeric, nullif(r->>'order_qty', '')::integer, nullif(r->>'refund_amount', '')::numeric,
        nullif(r->>'safet_reason', ''), nullif(r->>'safet_claim_id', ''), nullif(r->>'safet_state', ''), nullif(r->>'safet_created_at', '')::timestamptz,
        nullif(r->>'safet_amount', '')::numeric, nullif(r->>'category', ''), nullif(r->>'order_item_id', ''), up_id)
    on conflict (rma) do update set
      status = excluded.status, label_type = excluded.label_type, label_cost = excluded.label_cost, label_paid_by = excluded.label_paid_by,
      carrier = coalesce(excluded.carrier, a.carrier), tracking = coalesce(excluded.tracking, a.tracking), self_post = excluded.self_post,
      a_to_z = excluded.a_to_z, prime = excluded.prime, qty = coalesce(excluded.qty, a.qty),
      items = case when exists (select 1 from jsonb_array_elements(a.items) i where i->>'product_id' is not null) then a.items else excluded.items end,
      reason_code = excluded.reason_code, reason = excluded.reason, in_policy = excluded.in_policy, return_type = excluded.return_type, resolution = excluded.resolution,
      delivered_at = coalesce(excluded.delivered_at, a.delivered_at), order_amount = coalesce(excluded.order_amount, a.order_amount),
      order_qty = coalesce(excluded.order_qty, a.order_qty), refund_amount = coalesce(excluded.refund_amount, a.refund_amount),
      safet_reason = coalesce(excluded.safet_reason, a.safet_reason), safet_claim_id = coalesce(excluded.safet_claim_id, a.safet_claim_id),
      safet_state = coalesce(excluded.safet_state, a.safet_state), safet_created_at = coalesce(excluded.safet_created_at, a.safet_created_at),
      safet_amount = coalesce(excluded.safet_amount, a.safet_amount), category = excluded.category,
      last_seen = now(), seen = a.seen + 1, upload_id = up_id;
    if was then n_upd := n_upd + 1; else n_new := n_new + 1; end if;
  end loop;

  n_linked := public.returns_link_amazon(p_by);
  -- A SAFE-T claim Amazon already shows is written onto the claim the office raised (state, number, amount)
  update claims c set safet_claim_id = coalesce(c.safet_claim_id, a.safet_claim_id),
      status = case when a.safet_state = 'GRANT' then 'accepted' when a.safet_state = 'NOGRANT' then 'rejected' else c.status end,
      outcome_amount = coalesce(a.safet_amount, c.outcome_amount),
      outcome_at = case when a.safet_state in ('GRANT', 'NOGRANT') and c.outcome_at is null then now() else c.outcome_at end,
      updated_at = now(),
      history = c.history || jsonb_build_array(jsonb_build_object('at', now(), 'by', 'Amazon returns report', 'what', 'SAFE-T ' || lower(coalesce(a.safet_state, 'filed'))
        || coalesce(' · ' || a.safet_claim_id, '') || coalesce(' · £' || a.safet_amount::text, '')))
    from amazon_returns a
   where c.kind = 'safet' and returns_key(c.rma) = returns_key(a.rma) and a.safet_claim_id is not null
     and (c.safet_claim_id is distinct from a.safet_claim_id or (a.safet_state = 'GRANT' and c.status <> 'accepted') or (a.safet_state = 'NOGRANT' and c.status <> 'rejected'));
  update report_uploads set new_lines = n_new where id = up_id;
  return jsonb_build_object('upload_id', up_id, 'rows', jsonb_array_length(p_rows), 'added', n_new, 'updated', n_upd, 'linked', n_linked, 'from', d_from, 'to', d_to);
end $$;
revoke all on function public.amazon_returns_upsert(jsonb, text, text) from public, anon;
grant execute on function public.amazon_returns_upsert(jsonb, text, text) to authenticated;

-- Boxes already logged that a request now explains: by the return label's tracking, or the RMA typed or scanned.
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
  return n;
end $$;
revoke all on function public.returns_link_amazon(text) from public, anon, authenticated;

-- ── Scan lookup ──────────────────────────────────────────────────────────────────────────────────────────────────────
-- Whatever was scanned or typed: a box already logged (never twice), Amazon requests it belongs to (tracking, RMA or
-- order number), and orders it could be (a parcel the carrier brought back carries OUR tracking).
create or replace function public.returns_lookup(p_code text) returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare k text := public.returns_key(p_code);
begin
  if not (public.can_open('returns') or public.can_open('customer-care')) then raise exception 'Not allowed'; end if;
  if length(k) < 6 then return jsonb_build_object('key', k, 'existing', '[]'::jsonb, 'amazon', '[]'::jsonb, 'orders', '[]'::jsonb); end if;
  return jsonb_build_object('key', k,
    'existing', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'ref', r.ref, 'status', r.status, 'received_at', r.received_at, 'order_ref', r.order_ref, 'items', r.items))
        from returns r where (returns_key(r.return_tracking) = k or returns_key(r.rma) = k) and r.status <> 'expected'), '[]'::jsonb),
    'amazon', coalesce((select jsonb_agg(to_jsonb(a) order by a.request_date desc) from amazon_returns a
        where returns_key(a.tracking) = k or returns_key(a.rma) = k or returns_key(a.order_ref) = k), '[]'::jsonb),
    'expected', coalesce((select jsonb_agg(to_jsonb(r)) from returns r
        where r.status = 'expected' and (returns_key(r.return_tracking) = k or returns_key(r.tracking) = k or returns_key(r.order_ref) = k)), '[]'::jsonb),
    'orders', case when exists (select 1 from amazon_returns a where returns_key(a.tracking) = k or returns_key(a.rma) = k) then '[]'::jsonb
                   else coalesce(public.care_find_order(p_code), '[]'::jsonb) end);
end $$;
revoke all on function public.returns_lookup(text) from public, anon;
grant execute on function public.returns_lookup(text) to authenticated;

-- ── Suggestions for a box that matched nothing ───────────────────────────────────────────────────────────────────────
-- The owner (19 Nov): suggest who it could be from the returns report, the orders of those products and their delivery
-- status. Each candidate order gets a score out of 100 and the reasons, so a person can see why.
create or replace function public.returns_suggest(p_products uuid[], p_carrier text default null, p_qty numeric default null, p_exclude uuid default null)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare logging_start constant timestamptz := '2026-10-28 00:00+00'; car text := lower(coalesce(p_carrier, ''));
begin
  if not (public.can_open('returns') or public.can_open('customer-care')) then raise exception 'Not allowed'; end if;
  if p_products is null or cardinality(p_products) = 0 then return '[]'::jsonb; end if;
  return coalesce((
    with cand as (
      -- 1. Amazon requests for these products with no box logged yet
      select a.order_ref, 'Amazon' channel, a.rma, a.request_date at_date, a.items,
             40 + case when a.self_post then 15 else 0 end + case when a.delivered_at is not null then 15 else 0 end
                + case when p_qty is not null and a.qty = p_qty then 10 else 0 end
                + case when a.request_date > now() - interval '21 days' then 5 else 0 end
                + case when car <> '' and ((car like '%evri%' and a.carrier = 'HERMES_UK') or (car like '%royal%' and a.carrier = 'ROYAL_MAIL')) then 10 else 0 end score,
             array_remove(array[
               'Return requested ' || to_char(a.request_date at time zone 'Europe/London', 'DD-MM-YYYY') || coalesce(' · ' || replace(lower(regexp_replace(a.reason_code, '^(CR|AMZ-PG)-', '')), '_', ' '), ''),
               case when a.self_post then 'Customer posts it themselves (no tracking to scan)' end,
               case when a.delivered_at is not null then 'Amazon says it was delivered back ' || to_char(a.delivered_at at time zone 'Europe/London', 'DD-MM-YYYY') end,
               case when p_qty is not null and a.qty = p_qty then 'Same quantity' end,
               case when coalesce(a.refund_amount, 0) > 0 then 'Already refunded £' || a.refund_amount::text end], null) reasons
        from amazon_returns a
       where a.return_id is null and a.request_date > now() - interval '120 days'
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
       where l.status = 'dispatched' and l.dispatched_at > now() - interval '90 days'
         and (hp.returned_at is not null or coalesce(hp.last_event, '') ilike 'RETURN%' or hp.status in (6, 9))
         and exists (select 1 from jsonb_array_elements(public.order_contents(l.items)) i where nullif(i->>'product_id', '')::uuid = any(p_products))
      union all
      -- 3. Refunds in the sales ledger for these products, with no request in the report (another channel, or a goodwill refund)
      select s.order_ref, s.channel, null, max(s.sale_date)::timestamptz, jsonb_agg(distinct jsonb_build_object('product_id', ip.id, 'name', ip.name)),
             25, array['Refunded ' || to_char(max(s.sale_date), 'DD-MM-YYYY') || ' on ' || s.channel]
        from sales_ledger s join saved_products sp on sp.id = s.listing_id, jsonb_array_elements(coalesce(sp.data->'components', '[]'::jsonb)) c
        join inv_products ip on ip.stock_item_id = nullif(c->>'stockItemId', '')::uuid
       where s.kind = 'refund' and s.sale_date > current_date - 60 and s.order_ref is not null and ip.id = any(p_products)
         and not exists (select 1 from amazon_returns a where a.order_ref = s.order_ref)
       group by s.order_ref, s.channel
      union all
      -- 4. Open cases for these products
      select c.order_ref, coalesce(c.channel, 'Amazon'), null, c.created_at, coalesce(c.items, '[]'::jsonb), 20,
             array['Open case ' || c.ref || ' (' || replace(c.kind, '_', ' ') || ')']
        from complaints c
       where c.status <> 'resolved' and c.order_ref is not null and c.created_at > now() - interval '90 days'
         and exists (select 1 from jsonb_array_elements(coalesce(c.items, '[]'::jsonb)) i where nullif(i->>'product_id', '')::uuid = any(p_products))
    ),
    open_cand as (
      select * from cand c where c.order_ref is not null
        and not exists (select 1 from returns r where r.order_ref = c.order_ref and r.status <> 'expected' and r.id is distinct from p_exclude)
    ),
    by_order as (
      -- one row per order; each further source that points at it adds 10
      select o.order_ref, min(o.channel) channel, max(o.rma) rma, max(o.at_date) at_date, (array_agg(o.items order by o.score desc))[1] items,
             least(99, max(o.score) + 10 * (count(*) - 1)) score,
             (select array_agg(distinct x) from open_cand o2, unnest(o2.reasons) x where o2.order_ref = o.order_ref) reasons
        from open_cand o group by o.order_ref
    )
    select jsonb_agg(jsonb_build_object('order_ref', order_ref, 'channel', channel, 'rma', rma, 'at', at_date, 'items', items, 'score', score, 'reasons', to_jsonb(reasons)) order by score desc, at_date desc)
      from (select * from by_order order by score desc, at_date desc limit 8) t
  ), '[]'::jsonb);
end $$;
revoke all on function public.returns_suggest(uuid[], text, numeric, uuid) from public, anon;
grant execute on function public.returns_suggest(uuid[], text, numeric, uuid) to authenticated;

-- ── Carrier returns: the signal HELM really sends ────────────────────────────────────────────────────────────────────
create or replace function public.returns_scan() returns int language plpgsql security definer set search_path = public as $$
declare added int;
begin
  insert into returns (parcel_id, order_ref, tracking, channel, carrier, items, expected_items, reason, source, auto, history)
  select p.id, p.order_ref, p.tracking, p.channel, p.carrier, coalesce(p.items, '[]'::jsonb), public.order_contents(coalesce(p.items, '[]'::jsonb)), 'returned_to_sender', 'carrier', true,
         jsonb_build_array(jsonb_build_object('at', now(), 'by', 'Portal', 'what', 'Expected back — the carrier is returning it to us'))
  from helm_parcels p
  where (p.status = 10 or p.returned_at is not null or coalesce(p.last_event, '') ilike 'RETURNED_TO_SENDER%')
    and p.shipped_at > now() - interval '90 days'
    and not exists (select 1 from returns r where r.order_ref = p.order_ref and r.status <> 'expected')
  on conflict (parcel_id) do nothing;
  get diagnostics added = row_count;
  return added;
end $$;
revoke all on function public.returns_scan() from public, anon;
grant execute on function public.returns_scan() to authenticated;

create or replace function public.claims_scan() returns integer language plpgsql security definer set search_path to 'public' as $$
declare added int;
begin
  insert into claims (parcel_id, order_id, order_ref, tracking, carrier, service, channel, items, reason, auto, shipped_at, due_day, value, value_source, history)
  select p.id, p.order_id, p.order_ref, p.tracking, p.carrier, p.service, p.channel, coalesce(p.items, '[]'::jsonb),
         case when p.status = 10 or p.returned_at is not null or coalesce(p.last_event, '') ilike 'RETURNED_TO_SENDER%' then 'returned'
              when p.status = 9 then 'undeliverable' when p.status = 11 then 'expired' else 'not_delivered' end,
         true, p.shipped_at, wd_add((p.shipped_at at time zone 'Europe/London')::date, 2),
         o.order_total, case when o.order_total is not null then 'order' end,
         jsonb_build_array(jsonb_build_object('at', now(), 'by', 'Portal', 'what', 'Added automatically — ' ||
           case when p.status = 10 or p.returned_at is not null or coalesce(p.last_event, '') ilike 'RETURNED_TO_SENDER%' then 'returned to sender'
                when p.status = 9 then 'undeliverable' when p.status = 11 then 'tracking expired' else 'not delivered 4+ working days after it was due' end))
  from helm_parcels p left join helm_orders o on o.id = p.order_id
  where p.tracking is not null and (p.shipment_status is null or p.shipment_status = 1)
    and p.shipped_at > now() - interval '90 days'
    and (p.status in (9, 10, 11) or p.returned_at is not null or coalesce(p.last_event, '') ilike 'RETURNED_TO_SENDER%'
         or (coalesce(p.status, 0) not in (7, 12, 14)
             and wd_between(wd_add((p.shipped_at at time zone 'Europe/London')::date, 2), (now() at time zone 'Europe/London')::date) >= 4))
  on conflict (parcel_id) do nothing;
  get diagnostics added = row_count;

  update claims c set status = 'not_needed', updated_at = now(),
    history = c.history || jsonb_build_array(jsonb_build_object('at', now(), 'by', 'Portal', 'what', 'Delivered after all — taken off the list'))
  from helm_parcels p
  where c.parcel_id = p.id and c.auto and c.status = 'to_raise' and c.reason = 'not_delivered' and p.status = 7 and p.returned_at is null;
  return added;
end $$;

-- ── Daily ClickUp: the returns digest and the upload reminder (notify messages in v2.111.0) ─────────────────────────
create or replace function public.returns_daily_summary() returns void language plpgsql security definer set search_path to 'public' as $$
declare logging_start constant timestamptz := '2026-10-28 00:00+00'; today date := (now() at time zone 'Europe/London')::date; p jsonb;
begin
  p := jsonb_build_object(
    'arrived_today', (select count(*) from returns where status <> 'expected' and (received_at at time zone 'Europe/London')::date = today),
    'to_match', (select count(*) from returns where needs_match),
    'not_logged', (select count(*) from amazon_returns where return_id is null and delivered_at >= logging_start),
    'overdue', (select count(*) from amazon_returns where return_id is null and not self_post and delivered_at is null and request_date < now() - interval '14 days' and request_date >= logging_start - interval '14 days'),
    'safet', (select count(*) from returns r where r.status <> 'expected' and r.rma is not null and r.received_at > now() - interval '30 days'
                and exists (select 1 from jsonb_array_elements(r.items) i where i->>'outcome' in ('disposed', 'wrong_item', 'empty', 'faulty'))
                and not exists (select 1 from claims c where c.kind = 'safet' and c.return_id = r.id)),
    'uploaded_today', exists (select 1 from report_uploads where source = 'amazon_returns' and (uploaded_at at time zone 'Europe/London')::date = today));
  if (p->>'arrived_today')::int + (p->>'to_match')::int + (p->>'not_logged')::int + (p->>'overdue')::int + (p->>'safet')::int > 0 then
    perform public.queue_event('returns_digest', p);
  end if;
end $$;
revoke all on function public.returns_daily_summary() from public, anon, authenticated;

create or replace function public.returns_upload_reminder() returns void language plpgsql security definer set search_path to 'public' as $$
declare today date := (now() at time zone 'Europe/London')::date;
begin
  if extract(isodow from today) = 7 then return; end if;
  if not exists (select 1 from report_uploads where source = 'amazon_returns' and (uploaded_at at time zone 'Europe/London')::date = today) then
    perform public.queue_event('returns_upload_reminder', jsonb_build_object('last', (select max(uploaded_at) from report_uploads where source = 'amazon_returns')));
  end if;
end $$;
revoke all on function public.returns_upload_reminder() from public, anon, authenticated;

-- Off until the notify function with their messages is deployed (v2.111.0); switch on in Notifications
insert into notification_rules (event, channel_name, enabled) values ('returns_digest', 'Warehouse Team', false) on conflict (event) do nothing;
insert into notification_rules (event, channel_name, enabled) values ('returns_upload_reminder', 'Warehouse Team', false) on conflict (event) do nothing;
select cron.unschedule('returns-upload-reminder') where exists (select 1 from cron.job where jobname = 'returns-upload-reminder');
-- 11:30 and 15:30 London (10:30/11:30 and 14:30/15:30 UTC, only the London hour posts)
select cron.schedule('returns-upload-reminder', '30 10,11,14,15 * * 1-6',
  $c$select public.returns_upload_reminder() where extract(hour from now() at time zone 'Europe/London') in (11, 15)$c$);
