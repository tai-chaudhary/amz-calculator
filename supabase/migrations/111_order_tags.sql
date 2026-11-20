-- 111 — HELM's order tags (v2.86.0). Safe to re-run. One new column, two new functions, and report_pl_open gains "tags".
--
-- The owner (15 Nov 2026): every Prime order is now tagged "Prime" in HELM — show the tags, and split Amazon into
-- Prime and not Prime. HELM sends an order's tags when asked (includes=tags.tag); helm-sync v11 keeps their names.
--   helm_orders.tags   null = never read (the order left HELM's lists before tags were read);
--                      {}   = read, and it has none; otherwise the tag names.
alter table public.helm_orders add column if not exists tags text[];

-- helm-sync saves the tags on their own, and only where they changed (like the postcodes), so a refused include or
-- a quiet minute never blanks what is known. Service role only.
create or replace function public.helm_orders_set_tags(p jsonb)
returns integer language plpgsql security definer set search_path to 'public' as $$
declare n int;
begin
  update helm_orders h set tags = x.tags
    from (select (e->>'id')::bigint id, array(select jsonb_array_elements_text(coalesce(e->'tags', '[]'::jsonb))) tags
          from jsonb_array_elements(coalesce(p, '[]'::jsonb)) e) x
    where h.id = x.id and h.tags is distinct from x.tags;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.helm_orders_set_tags(jsonb) from public, anon, authenticated;
grant execute on function public.helm_orders_set_tags(jsonb) to service_role;

-- The tags of the orders despatched from..to, for the Profit & Loss and Sales: { tagged: { order ref: [tags] },
-- known_from: the first despatch day on which any order carried a tag }. Tagging began on 15 Nov 2026, so an order
-- despatched before known_from is "not known", never "not Prime" (it has no tag only because nobody was tagging yet).
-- Admins only.
create or replace function public.report_order_tags(p_from date, p_to date, p_channel text default null)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not public.is_admin() then raise exception 'Not allowed'; end if;
  return jsonb_build_object(
    'tagged', coalesce((select jsonb_object_agg(h.ref, to_jsonb(h.tags)) from helm_orders h
        where h.ref is not null and h.tags is not null and cardinality(h.tags) > 0 and h.labelled_at is not null
          and (h.labelled_at at time zone 'Europe/London')::date between p_from and p_to
          and (p_channel is null or h.channel = p_channel)), '{}'::jsonb),
    'known_from', (select min((h.labelled_at at time zone 'Europe/London')::date) from helm_orders h where cardinality(h.tags) > 0 and h.labelled_at is not null),
    'names', coalesce((select jsonb_agg(distinct t order by t) from helm_orders h, unnest(h.tags) t), '[]'::jsonb));
end $$;
revoke all on function public.report_order_tags(date, date, text) from public, anon;
grant execute on function public.report_order_tags(date, date, text) to authenticated;

-- report_pl_open (migration 110), now with each open order's tags
create or replace function public.report_pl_open(p_channel text default null)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare res jsonb; today date := public.uk_today();
begin
  if not public.is_admin() then raise exception 'Not allowed'; end if;
  with o as (
    select h.id, h.channel, h.ref order_ref, h.order_date, h.money, h.listing_lines, h.tags
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
        'fee_estimated', true, 'cogs_real', null, 'tags', to_jsonb(r.tags))) from r), '[]'::jsonb)
  ) into res;
  return res;
end $$;
revoke all on function public.report_pl_open(text) from public, anon;
grant execute on function public.report_pl_open(text) to authenticated;

-- helm-tags (supabase/functions/helm-tags) reads the tags every 5 minutes. A job of its own: helm-sync is untouched.
select cron.unschedule('helm-tags') where exists (select 1 from cron.job where jobname = 'helm-tags');
select cron.schedule('helm-tags', '*/5 * * * *', $cron$
  select net.http_post(
    url := 'https://amuqewxxvlggtsyzbyry.supabase.co/functions/v1/helm-tags',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-notify-key', public.notify_key()),
    body := '{}'::jsonb,
    timeout_milliseconds := 50000)
$cron$);
