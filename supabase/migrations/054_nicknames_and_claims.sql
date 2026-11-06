-- 054: Product nicknames, and the Claims list. Safe to re-run.

-- ── Nicknames ────────────────────────────────────────────────────────────────
-- Kept on the product (stock_items.data.nickname): Products is the master record.
-- Everyone can read them (the warehouse sees nicknames); only the office sets them.
create unique index if not exists stock_items_nickname_key
  on stock_items (lower(trim(data->>'nickname'))) where coalesce(trim(data->>'nickname'), '') <> '';

create or replace function public.product_nicknames()
returns table(stock_item_id uuid, inv_id uuid, code text, name text, stamp_name text, nickname text)
language sql stable security definer set search_path = public as $$
  select si.id, ip.id, ip.code, coalesce(ip.name, si.name), ip.stamp_name, trim(si.data->>'nickname')
  from stock_items si left join inv_products ip on ip.stock_item_id = si.id
  where is_active_user() and coalesce(trim(si.data->>'nickname'), '') <> ''
$$;
revoke all on function public.product_nicknames() from public, anon;
grant execute on function public.product_nicknames() to authenticated;

create or replace function public.item_set_nickname(p_item uuid, p_nick text, p_by text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare n text := nullif(trim(regexp_replace(coalesce(p_nick, ''), '\s+', ' ', 'g')), ''); clash text;
begin
  if not (sees_costs() or can_approve_products()) then raise exception 'Only the office can set nicknames'; end if;
  if n is not null then
    select name into clash from stock_items where id <> p_item and lower(trim(data->>'nickname')) = lower(n) limit 1;
    if clash is not null then raise exception 'Already the nickname of %', clash; end if;
  end if;
  update stock_items set data = case when n is null then (data - 'nickname') || jsonb_build_object('nicknameBy', p_by, 'nicknameAt', now())
                                     else data || jsonb_build_object('nickname', n, 'nicknameBy', p_by, 'nicknameAt', now()) end
  where id = p_item;
  if not found then raise exception 'Product not found'; end if;
  return jsonb_build_object('id', p_item, 'nickname', n);
end $$;
revoke all on function public.item_set_nickname(uuid, text, text) from public, anon;
grant execute on function public.item_set_nickname(uuid, text, text) to authenticated;

-- ── What the customer paid (from HELM, when it says) ─────────────────────────
alter table helm_orders add column if not exists order_total numeric;

-- ── Claims ───────────────────────────────────────────────────────────────────
create sequence if not exists claims_seq;
create table if not exists claims (
  id uuid primary key default gen_random_uuid(),
  ref text unique not null default ('CL-' || lpad(nextval('claims_seq')::text, 4, '0')),
  parcel_id bigint unique,
  order_id bigint, order_ref text, tracking text, carrier text, service text, channel text,
  items jsonb default '[]'::jsonb,
  reason text not null default 'other',        -- returned | undeliverable | expired | not_delivered | damaged | lost | other
  status text not null default 'to_raise',     -- to_raise | raised | accepted | rejected | closed | not_needed
  auto boolean not null default false,
  shipped_at timestamptz, due_day date,
  value numeric, value_source text,            -- order | estimated | manual
  carrier_ref text, raised_at timestamptz, raised_by text,
  outcome_amount numeric, outcome_at timestamptz, outcome_by text,
  notes text, photos jsonb not null default '[]'::jsonb, history jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table claims enable row level security;
drop policy if exists "Claims read" on claims;
create policy "Claims read" on claims for select to authenticated using ((select can_open('claims')));
drop policy if exists "Claims add" on claims;
create policy "Claims add" on claims for insert to authenticated with check ((select can_open('claims')));
drop policy if exists "Claims change" on claims;
create policy "Claims change" on claims for update to authenticated using ((select can_open('claims'))) with check ((select can_open('claims')));
create index if not exists claims_status_idx on claims (status);

-- Working days with Sunday off, as Delivery tracking counts them
create or replace function public.wd_add(d date, n int) returns date language plpgsql immutable as $$
declare x date := d; left_ int := n;
begin while left_ > 0 loop x := x + 1; if extract(dow from x) <> 0 then left_ := left_ - 1; end if; end loop; return x; end $$;
create or replace function public.wd_between(a date, b date) returns int language sql immutable as $$
  select count(*)::int from generate_series(a + 1, b, interval '1 day') g where extract(dow from g) <> 0
$$;

/**
 * Puts parcels that need a claim on the list: returned to sender, undeliverable (address problem),
 * tracking expired, and anything not delivered 4+ working days after its due day. A late one that
 * gets delivered before anyone raised it comes off again ("not needed"). Run every half hour and
 * when the page opens.
 */
create or replace function public.claims_scan() returns int language plpgsql security definer set search_path = public as $$
declare added int;
begin
  insert into claims (parcel_id, order_id, order_ref, tracking, carrier, service, channel, items, reason, auto, shipped_at, due_day, value, value_source, history)
  select p.id, p.order_id, p.order_ref, p.tracking, p.carrier, p.service, p.channel, coalesce(p.items, '[]'::jsonb),
         case p.status when 10 then 'returned' when 9 then 'undeliverable' when 11 then 'expired' else 'not_delivered' end,
         true, p.shipped_at, wd_add((p.shipped_at at time zone 'Europe/London')::date, 2),
         o.order_total, case when o.order_total is not null then 'order' end,
         jsonb_build_array(jsonb_build_object('at', now(), 'by', 'Portal', 'what', 'Added automatically — ' ||
           case p.status when 10 then 'returned to sender' when 9 then 'undeliverable' when 11 then 'tracking expired' else 'not delivered 4+ working days after it was due' end))
  from helm_parcels p left join helm_orders o on o.id = p.order_id
  where p.tracking is not null and (p.shipment_status is null or p.shipment_status = 1)
    and p.shipped_at > now() - interval '90 days'
    and (p.status in (9, 10, 11)
         or (coalesce(p.status, 0) not in (7, 12, 14)
             and wd_between(wd_add((p.shipped_at at time zone 'Europe/London')::date, 2), (now() at time zone 'Europe/London')::date) >= 4))
  on conflict (parcel_id) do nothing;
  get diagnostics added = row_count;

  update claims c set status = 'not_needed', updated_at = now(),
    history = c.history || jsonb_build_array(jsonb_build_object('at', now(), 'by', 'Portal', 'what', 'Delivered after all — taken off the list'))
  from helm_parcels p
  where c.parcel_id = p.id and c.auto and c.status = 'to_raise' and c.reason = 'not_delivered' and p.status = 7;
  return added;
end $$;
revoke all on function public.claims_scan() from public, anon;
grant execute on function public.claims_scan() to authenticated;

do $$ begin
  if not exists (select 1 from cron.job where jobname = 'claims-scan') then
    perform cron.schedule('claims-scan', '*/30 * * * *', 'select public.claims_scan()');
  end if;
end $$;

-- Photos of damage go in the existing private bucket under claims/
insert into storage.buckets (id, name, public) values ('claim-photos', 'claim-photos', false) on conflict (id) do nothing;
drop policy if exists "Claim photos read" on storage.objects;
create policy "Claim photos read" on storage.objects for select to authenticated using (bucket_id = 'claim-photos' and (select can_open('claims')));
drop policy if exists "Claim photos add" on storage.objects;
create policy "Claim photos add" on storage.objects for insert to authenticated with check (bucket_id = 'claim-photos' and (select can_open('claims')));
