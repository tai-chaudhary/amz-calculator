-- 139 (v2.109.0) — Off Shore: setting the courier in HELM, and the ClickUp alert for costly off shore orders.
--
--   offshore_orders_all()          the open HELM orders with a postcode (what offshore_open_orders() returns), with no
--                                  user check — only for the offshore-check job (service role). The page keeps
--                                  offshore_open_orders(), which checks the user may open the Off Shore page.
--   helm_courier_changes           every courier change the portal made in HELM: who, when, from and to, and HELM's answer
--   helm_courier_log(p jsonb)      the helm-courier function writes a line (service role only)
--   helm_courier_recent()          the last changes, for the page
--   helm_courier_allowed()         may this user use the page, and do they see costs (offshore-check and helm-courier ask)
--   offshore_alerts                each order alerted once (order ref), so the alert never repeats
--   offshore_alert_queue(p jsonb)  the offshore-check job: the orders over the limit not alerted yet → one ClickUp
--                                  message (event offshore_extra, "Warehouse Team" unless changed in Notifications)
--   cron 'offshore-check'          every 15 minutes, 7am–7pm London, Monday to Saturday
--
-- Nothing about a customer is kept: the order reference, the district (first half of the postcode) and the £ extra.

create or replace function public.offshore_orders_all() returns jsonb
language sql stable security definer set search_path = public as $$
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
  from helm_orders o
  where o.closed_at is null and o.status <> 8 and coalesce(o.postcode, '') <> ''
$$;
revoke all on function public.offshore_orders_all() from public, anon, authenticated;

create or replace function public.offshore_open_orders() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_active_user() or not public.can_open('offshore') then raise exception 'Not allowed'; end if;
  return public.offshore_orders_all();
end $$;
revoke all on function public.offshore_open_orders() from public, anon;
grant execute on function public.offshore_open_orders() to authenticated;

-- ── courier changes made in HELM ─────────────────────────────────────────
create table if not exists public.helm_courier_changes (
  id bigserial primary key,
  at timestamptz not null default now(),
  order_id bigint not null,
  order_ref text,
  from_service integer,
  to_service integer not null,
  by_name text,
  ok boolean not null,
  note text
);
alter table public.helm_courier_changes enable row level security;
revoke all on public.helm_courier_changes from anon, authenticated;

create or replace function public.helm_courier_log(p jsonb) returns void
language sql security definer set search_path = public as $$
  insert into helm_courier_changes(order_id, order_ref, from_service, to_service, by_name, ok, note)
  values ((p ->> 'order_id')::bigint, p ->> 'order_ref', nullif(p ->> 'from_service', '')::integer, (p ->> 'to_service')::integer,
          p ->> 'by_name', coalesce((p ->> 'ok')::boolean, false), left(p ->> 'note', 300))
$$;
revoke all on function public.helm_courier_log(jsonb) from public, anon, authenticated;

create or replace function public.helm_courier_recent() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_active_user() or not public.can_open('offshore') then raise exception 'Not allowed'; end if;
  return coalesce((select jsonb_agg(to_jsonb(c) order by c.at desc) from (
    select at, order_id, order_ref, from_service, to_service, by_name, ok, note from helm_courier_changes
    where at > now() - interval '14 days' order by at desc limit 200) c), '[]'::jsonb);
end $$;
revoke all on function public.helm_courier_recent() from public, anon;
grant execute on function public.helm_courier_recent() to authenticated;

-- may this person use the Off Shore page (see its orders, change an order's courier in HELM), and do they see costs
create or replace function public.helm_courier_allowed() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_active_user() or not public.can_open('offshore') then return jsonb_build_object('ok', false); end if;
  return jsonb_build_object('ok', true, 'costs', public.sees_costs(), 'name', (select display_name from profiles where id = auth.uid()));
end $$;
revoke all on function public.helm_courier_allowed() from public, anon;
grant execute on function public.helm_courier_allowed() to authenticated;

-- ── the alert ────────────────────────────────────────────────────────────
create table if not exists public.offshore_alerts (
  order_ref text primary key,
  district text,
  extra numeric,
  at timestamptz not null default now()
);
alter table public.offshore_alerts enable row level security;
revoke all on public.offshore_alerts from anon, authenticated;

-- p: [{ ref, district, area, extra, carrier, parcels, prime }] — the job's orders over the limit; only the new ones go out
create or replace function public.offshore_alert_queue(p jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare fresh jsonb;
begin
  with x as (
    select e from jsonb_array_elements(coalesce(p, '[]'::jsonb)) e
    where coalesce(e ->> 'ref', '') <> '' and not exists (select 1 from offshore_alerts a where a.order_ref = e ->> 'ref')
  ), ins as (
    insert into offshore_alerts(order_ref, district, extra)
    select e ->> 'ref', e ->> 'district', nullif(e ->> 'extra', '')::numeric from x
    on conflict (order_ref) do nothing returning order_ref
  )
  select coalesce(jsonb_agg(x.e), '[]'::jsonb) into fresh from x where (x.e ->> 'ref') in (select order_ref from ins);
  if jsonb_array_length(fresh) = 0 then return 0; end if;
  perform public.queue_event('offshore_extra', jsonb_build_object('orders', fresh));
  return jsonb_array_length(fresh);
end $$;
revoke all on function public.offshore_alert_queue(jsonb) from public, anon, authenticated;

insert into notification_rules (event, channel_name) values ('offshore_extra', 'Warehouse Team') on conflict (event) do nothing;

select cron.unschedule('offshore-check') where exists (select 1 from cron.job where jobname = 'offshore-check');
select cron.schedule('offshore-check', '*/15 6-19 * * 1-6', $cron$
  select net.http_post(
    url := 'https://amuqewxxvlggtsyzbyry.supabase.co/functions/v1/offshore-check',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-notify-key', public.notify_key()),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000)
$cron$);
