-- 138 — Off Shore orders (v2.109.0)
--
-- Safe to re-run. Read-only for everything that exists; adds one small table.
--
-- Why: carriers charge more to the Highlands & Islands, Northern Ireland, the islands and some other postcodes.
-- The Off Shore page (Warehouse) shows the open orders going there, the cheapest carrier for each, and what it costs
-- over the mainland price; the P&L costs those parcels at the remote rates instead of the mainland ones.
--
-- Only the postcode DISTRICT is ever kept or sent (the first half, e.g. "AB51"): that is all the carriers' lists
-- need. Never a full postcode, never a name or an address.
--
--   postcode_district(text)        "AB51 4XY" / "AB514XY" / Amazon's "AB51 4" → "AB51"
--   order_districts                order ref → district, saved from the Amazon transaction report (back to 1 Aug)
--   order_districts_save(jsonb)    the Uploads page saves a report's districts (people who see costs)
--   report_order_districts(from,to) { ref → district } for the P&L: the report's, else HELM's, else the label's
--   offshore_open_orders()         the open HELM orders with their district, Prime, HELM carrier and what is in them
--                                  (each item's weight), for the Off Shore page (anyone given that page)

create or replace function public.postcode_district(p text) returns text
language sql immutable as $$
  select case
    when p is null or btrim(p) = '' then null
    when position(' ' in btrim(p)) > 0 then upper(split_part(btrim(p), ' ', 1))
    when length(regexp_replace(p, '\s', '', 'g')) >= 5 then upper(left(regexp_replace(p, '\s', '', 'g'), length(regexp_replace(p, '\s', '', 'g')) - 3))
    else upper(regexp_replace(p, '\s', '', 'g'))
  end
$$;

create table if not exists public.order_districts (
  order_ref text primary key,
  district text not null,
  source text not null default 'amazon_report',
  updated_at timestamptz not null default now()
);
alter table public.order_districts enable row level security;
revoke all on public.order_districts from anon, authenticated;

create or replace function public.order_districts_save(p jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not public.is_active_user() or not public.sees_costs() then raise exception 'Not allowed'; end if;
  insert into order_districts(order_ref, district, source)
  select btrim(e.key), upper(btrim(e.value #>> '{}')), 'amazon_report'
  from jsonb_each(coalesce(p, '{}'::jsonb)) e
  where btrim(e.key) <> '' and btrim(coalesce(e.value #>> '{}', '')) ~ '^[A-Za-z]{1,2}[0-9][0-9A-Za-z]?$'
  on conflict (order_ref) do update set district = excluded.district, updated_at = now()
    where order_districts.district is distinct from excluded.district;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.order_districts_save(jsonb) from public, anon;
grant execute on function public.order_districts_save(jsonb) to authenticated;

create or replace function public.report_order_districts(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare out jsonb;
begin
  if not public.is_active_user() or not public.sees_costs() then raise exception 'Not allowed'; end if;
  with refs as (
    select distinct order_ref from sales_lines where kind = 'sale' and sale_date between p_from and p_to and coalesce(order_ref, '') <> ''
    union
    select ref from helm_orders where closed_at is null and status <> 8 and coalesce(ref, '') <> ''
  ), lab as (
    select channel_ref, public.postcode_district(max(postcode)) d from dispatch_labels
    where coalesce(postcode, '') <> '' and channel_ref in (select order_ref from refs) group by channel_ref
  ), helm as (
    select ref, public.postcode_district(max(postcode)) d from helm_orders
    where coalesce(postcode, '') <> '' and ref in (select order_ref from refs) group by ref
  )
  select coalesce(jsonb_object_agg(r.order_ref, coalesce(od.district, h.d, l.d)) filter (where coalesce(od.district, h.d, l.d) is not null), '{}'::jsonb)
  into out
  from refs r left join order_districts od on od.order_ref = r.order_ref
    left join helm h on h.ref = r.order_ref left join lab l on l.channel_ref = r.order_ref;
  return out;
end $$;
revoke all on function public.report_order_districts(date, date) from public, anon;
grant execute on function public.report_order_districts(date, date) to authenticated;

create or replace function public.offshore_open_orders() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare out jsonb;
begin
  if not public.is_active_user() or not public.can_open('offshore') then raise exception 'Not allowed'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', o.id, 'ref', o.ref, 'order_number', o.order_number, 'channel', o.channel, 'status', o.status, 'is_hold', o.is_hold,
      'carrier', o.carrier, 'service', o.service, 'district', public.postcode_district(o.postcode),
      'prime', coalesce('Prime' = any(o.tags), false), 'order_date', o.order_date, 'ship_by', o.ship_by,
      'delivery_paid', coalesce(nullif(o.money ->> 'shipping', '')::numeric, 0),
      'lines', coalesce((select jsonb_agg(jsonb_build_object(
          'code', it ->> 'code', 'name', it ->> 'name', 'qty', coalesce(nullif(it ->> 'qty', '')::numeric, 1),
          'kg', nullif(s.data ->> 'weightKg', '')::numeric, 'product', s.name))
        from jsonb_array_elements(case when jsonb_typeof(o.items) = 'array' then o.items else '[]'::jsonb end) it
        left join inv_products p on p.code_key = public.inv_norm(it ->> 'code')
        left join stock_items s on s.id = p.stock_item_id), '[]'::jsonb),
      'listings', coalesce((select jsonb_agg(jsonb_build_object(
          'listing_sku', ll ->> 'listing_sku', 'qty', coalesce(nullif(ll ->> 'qty', '')::numeric, 1)))
        from jsonb_array_elements(case when jsonb_typeof(o.listing_lines) = 'array' then o.listing_lines else '[]'::jsonb end) ll), '[]'::jsonb)
    ) order by o.order_date), '[]'::jsonb)
  into out
  from helm_orders o
  where o.closed_at is null and o.status <> 8 and coalesce(o.postcode, '') <> '';
  return out;
end $$;
revoke all on function public.offshore_open_orders() from public, anon;
grant execute on function public.offshore_open_orders() to authenticated;
