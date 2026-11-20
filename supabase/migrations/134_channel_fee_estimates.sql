-- 134: orders not yet in a channel's report carry that channel's fee, and the rules can be read and changed.
--
-- Until now an eBay or TikTok order that HELM reported ahead of the channel's report carried NO fee (32 eBay and 46
-- TikTok orders on 18 Nov 2026). Now: fee = the percentage in force that day x what the customer paid, plus the
-- channel's fixed amount for the order (shared across its lines). The channel's own report still replaces it.
-- Amazon has no row in channel_fees, so its estimate is the listing's own fee exactly as before.
--
--   channel_fee_reapply(channel, from)   re-estimates the HELM lines of a channel from a date (after a rule changes)
--   channel_fees_list()                  the rules, for the Cost Settings page (people who see costs)
--   channel_fee_set(...), channel_fee_remove(id)   admins; dated; logged; re-estimate from the date
create or replace function public.channel_fee_reapply(p_channel text, p_from date default '2026-08-01') returns integer
language plpgsql security definer set search_path to 'public' as $fn$
declare n int;
begin
  update sales_lines sl
  set selling_fees = round(- sl.total * coalesce(public.channel_fee_pct(sl.channel, x.listing_id, sl.sale_date), public.listing_fee_pct(x.data), 0) / 100
                           - public.channel_fee_fixed(sl.channel, sl.sale_date, x.order_total) * sl.total / nullif(x.order_total, 0), 4)
  from (
    select s.id, sum(s.total) over (partition by split_part(s.source_key, ':', 2)) order_total, lp.id listing_id, lp.data
    from sales_lines s
    left join listing_codes lc on lc.channel = s.channel and lc.code_key = upper(trim(coalesce(s.listing_sku, s.item_code)))
    left join saved_products lp on lp.id = lc.listing_id
    where s.source = 'helm' and s.kind = 'sale' and s.channel = p_channel and s.channel <> 'Amazon'
  ) x
  where x.id = sl.id and sl.sale_date >= p_from and coalesce(x.order_total, 0) <> 0;
  get diagnostics n = row_count;
  return n;
end $fn$;
revoke all on function public.channel_fee_reapply(text, date) from public, anon, authenticated;

create or replace function public.channel_fees_list() returns jsonb
language plpgsql stable security definer set search_path to 'public' as $fn$
begin
  if not public.sees_costs() then raise exception 'Not allowed'; end if;
  return jsonb_build_object('today', public.uk_today(), 'rules', coalesce((
    select jsonb_agg(jsonb_build_object('id', f.id, 'channel', f.channel, 'listing_id', f.listing_id, 'listing_name', sp.name,
        'listing_sku', sp.data->>'listingSku', 'from_date', f.from_date, 'pct', f.pct, 'per_order', f.per_order,
        'per_order_small', f.per_order_small, 'small_order_max', f.small_order_max, 'note', f.note, 'by', f.created_by, 'at', f.created_at)
      order by f.channel, (f.listing_id is not null), sp.name, f.from_date desc, f.id desc)
    from channel_fees f left join saved_products sp on sp.id = f.listing_id where f.removed_at is null), '[]'::jsonb));
end $fn$;

create or replace function public.channel_fee_set(p_channel text, p_listing uuid, p_from date, p_pct numeric,
  p_per_order numeric default null, p_per_order_small numeric default null, p_small_max numeric default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $fn$
declare v_from date := coalesce(p_from, public.uk_today()); v_id bigint; v_name text; n int;
begin
  if not public.is_admin() then raise exception 'Only an admin can change channel fees'; end if;
  if coalesce(trim(p_channel), '') = '' then raise exception 'Choose the channel'; end if;
  if p_pct is null or p_pct < 0 or p_pct > 100 then raise exception 'The percentage must be between 0 and 100'; end if;
  if p_listing is not null then
    select name into v_name from saved_products where id = p_listing and coalesce(data->>'channel', 'Amazon') = p_channel;
    if v_name is null then raise exception 'That listing is not on %', p_channel; end if;
    p_per_order := null; p_per_order_small := null; p_small_max := null;
  end if;
  insert into channel_fees (channel, listing_id, from_date, pct, per_order, per_order_small, small_order_max, note, created_by)
  values (p_channel, p_listing, v_from, p_pct, p_per_order, p_per_order_small, p_small_max, nullif(trim(coalesce(p_note, '')), ''), public.my_name())
  returning id into v_id;
  insert into activity_log (user_name, entity_type, entity_id, entity_name, action, detail, source)
  values (public.my_name(), case when p_listing is null then 'cost' else 'listing' end, coalesce(p_listing::text, p_channel), coalesce(v_name, p_channel || ' fees'),
    'Channel fee set', p_channel || ': ' || p_pct || '%' || case when p_listing is null then coalesce(' + £' || to_char(p_per_order, 'FM990.00') || ' an order', '')
      || coalesce(' (£' || to_char(p_per_order_small, 'FM990.00') || ' on orders up to £' || to_char(p_small_max, 'FM9990.00') || ')', '') else '' end
      || ' from ' || to_char(v_from, 'DD Mon YYYY') || coalesce(' — ' || nullif(trim(coalesce(p_note, '')), ''), ''), 'costs');
  n := public.channel_fee_reapply(p_channel, v_from);
  return jsonb_build_object('id', v_id, 'from_date', v_from, 'reestimated', n);
end $fn$;

create or replace function public.channel_fee_remove(p_id bigint) returns jsonb
language plpgsql security definer set search_path to 'public' as $fn$
declare f channel_fees; n int;
begin
  if not public.is_admin() then raise exception 'Only an admin can change channel fees'; end if;
  select * into f from channel_fees where id = p_id and removed_at is null;
  if f.id is null then raise exception 'That fee is not there any more'; end if;
  update channel_fees set removed_at = now(), removed_by = public.my_name() where id = p_id;
  insert into activity_log (user_name, entity_type, entity_id, entity_name, action, detail, source)
  values (public.my_name(), case when f.listing_id is null then 'cost' else 'listing' end, coalesce(f.listing_id::text, f.channel), f.channel || ' fees',
    'Channel fee removed', f.channel || ': ' || f.pct || '% from ' || to_char(f.from_date, 'DD Mon YYYY') || ' — entered by mistake', 'costs');
  n := public.channel_fee_reapply(f.channel, f.from_date);
  return jsonb_build_object('removed', p_id, 'reestimated', n);
end $fn$;

-- The two places that estimate a fee before the report arrives.
do $$
declare d text; n text;
begin
  select pg_get_functiondef('public.sales_refresh_helm(date)'::regprocedure) into d;
  insert into public.fn_backups(name, def) values ('sales_refresh_helm before 134', d);
  n := replace(d, 'select sp.data from saved_products sp', 'select sp.id, sp.data from saved_products sp');
  n := replace(n, 'public.listing_fee_pct(s.data) fee_pct', 'coalesce(public.channel_fee_pct(o.channel, s.id, o.d), public.listing_fee_pct(s.data)) fee_pct');
  n := replace(n, 'round(- r.tot * r.share * coalesce(r.fee_pct, 0) / 100, 4), true,',
                  'round(- r.tot * r.share * coalesce(r.fee_pct, 0) / 100 - public.channel_fee_fixed(r.channel, r.d, r.tot) * r.share, 4), true,');
  if position('channel_fee_pct' in n) = 0 or position('channel_fee_fixed' in n) = 0 or position('select sp.id, sp.data' in n) = 0 then
    raise exception 'sales_refresh_helm: a fee part was not found'; end if;
  execute n;

  select pg_get_functiondef('public.report_pl_open(text)'::regprocedure) into d;
  insert into public.fn_backups(name, def) values ('report_pl_open before 134', d);
  n := replace(d, 'public.listing_fee_pct(s.data) fee_pct', 'coalesce(public.channel_fee_pct(o.channel, s.id, today), public.listing_fee_pct(s.data)) fee_pct');
  n := replace(n, $a$'fees', round(- r.tot * r.share * coalesce(r.fee_pct, 0) / 100, 4),$a$,
                  $b$'fees', round(- r.tot * r.share * coalesce(r.fee_pct, 0) / 100 - public.channel_fee_fixed(r.channel, today, r.tot) * r.share, 4),$b$);
  if position('channel_fee_pct' in n) = 0 or position('channel_fee_fixed' in n) = 0 then raise exception 'report_pl_open: a fee part was not found'; end if;
  execute n;
end $$;

-- The rules as they stand on 18 Nov 2026, from the channels' own reports.
insert into public.channel_fees (channel, listing_id, from_date, pct, per_order, per_order_small, small_order_max, note, created_by)
select * from (values
  ('TikTok', null::uuid, date '2026-08-01', 9::numeric, 0.50::numeric, null::numeric, null::numeric,
   'TikTok Shop UK: 9% of the sale plus the delivery the customer paid, and 50p an order sent by us. Every one of the 20 settled orders in the Income report of 18 Nov 2026 paid exactly this.', 'Claude'),
  ('eBay', null, date '2026-08-01', 12.55, 0.40, 0.30, 10.00,
   'eBay UK business seller: a percentage by category plus the 0.35% regulatory fee, and 40p an order (30p on orders up to £10), all before VAT. 12.55% is the average over 428 orders in eBay''s reports; a listing with its own percentage uses that.', 'Claude')
) v(channel, listing_id, from_date, pct, per_order, per_order_small, small_order_max, note, created_by)
where not exists (select 1 from public.channel_fees f where f.channel = v.channel and f.listing_id is null and f.removed_at is null);

-- Each eBay listing's own percentage, from what eBay charged on its own orders (fee before VAT, less the fixed amount).
insert into public.channel_fees (channel, listing_id, from_date, pct, note, created_by)
select 'eBay', x.listing_id, date '2026-08-01', round(100 * (sum(x.fee) - sum(x.fixed)) / sum(x.gross), 2),
  'From eBay''s reports: ' || count(*) || ' order' || case when count(*) = 1 then '' else 's' end || ', ' || round(100 * min((x.fee - x.fixed) / x.gross), 2) || '% to ' || round(100 * max((x.fee - x.fixed) / x.gross), 2) || '%.', 'Claude'
from (
  select o.listing_id, o.gross, o.fee, case when o.gross <= 10 then 0.30 else 0.40 end fixed
  from (select order_ref, sum(gross) gross, sum(-fees) fee, min(listing_id::text)::uuid listing_id, count(distinct listing_id) nl, count(listing_id) n_linked, count(*) n
        from sales_ledger where channel = 'eBay' and source = 'ebay_report' and kind = 'sale' group by 1) o
  where o.gross > 0 and o.nl = 1 and o.n_linked = o.n
) x
where not exists (select 1 from public.channel_fees f where f.channel = 'eBay' and f.listing_id = x.listing_id and f.removed_at is null)
group by x.listing_id;

select public.channel_fee_reapply('eBay'), public.channel_fee_reapply('TikTok');
