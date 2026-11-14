-- 056: Stock planning (reorder at 25 days, sales spikes, stock age) and Customer care (complaints and
-- returns, linked to claims). Safe to re-run.

-- ── Stock planning ───────────────────────────────────────────────────────────
-- Per product: units sold each of the last 21 days, and what came in (goods in, added, opening stock),
-- newest first — the age of what's on the shelf is worked out from these (first in, first out).
create or replace function public.inv_planning()
returns jsonb language sql stable security definer set search_path = public as $$
  with today as (select (now() at time zone 'Europe/London')::date as d),
  recent as (
    select u.product_id, jsonb_agg(jsonb_build_object('d', u.day, 'u', u.units) order by u.day) as days, max(u.day) as last_day
    from public.inv_daily_units((select d from today) - 21, (select d from today)) u group by 1
  ),
  lastsale as (
    select product_id, max(day) as last_day from public.inv_daily_units((select d from today) - 365, (select d from today)) group by 1
  ),
  layers as (
    select m.product_id, jsonb_agg(jsonb_build_object('at', m.at, 'qty', m.qty, 'kind', m.kind) order by m.at desc) as ins
    from (select product_id, at, qty, kind, row_number() over (partition by product_id order by at desc) rn
          from inv_movements where kind in ('goods_in', 'add', 'opening') and qty > 0) m
    where m.rn <= 25 group by 1
  )
  select case when not public.is_active_user() then '[]'::jsonb else coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'recent', coalesce(r.days, '[]'::jsonb), 'last_sale', ls.last_day, 'ins', coalesce(l.ins, '[]'::jsonb)
  )), '[]'::jsonb) end
  from inv_products p left join recent r on r.product_id = p.id left join lastsale ls on ls.product_id = p.id
  left join layers l on l.product_id = p.id where p.active
$$;
revoke all on function public.inv_planning() from public, anon;
grant execute on function public.inv_planning() to authenticated;

-- ── Customer care: complaints ───────────────────────────────────────────────
create sequence if not exists complaints_seq;
create table if not exists complaints (
  id uuid primary key default gen_random_uuid(),
  ref text unique not null default ('CP-' || lpad(nextval('complaints_seq')::text, 4, '0')),
  order_ref text, tracking text, channel text, carrier text,
  label_id uuid, parcel_id bigint, batch_code text, label_seq int, packer text, shipped_at timestamptz,
  product_id uuid, product_name text, qty int,
  kind text not null default 'other',      -- damaged | missing_item | wrong_item | not_received | late | faulty | not_as_described | packaging | other
  details text, customer_wants text,       -- refund | replacement | partial_refund | return | nothing
  outcome text,                            -- refund | replacement | partial_refund | return | no_action
  cost numeric,                            -- what it cost us (refund, replacement stock, postage)
  status text not null default 'open',     -- open | resolved
  claim_id uuid, return_id uuid,
  photos jsonb not null default '[]'::jsonb, history jsonb not null default '[]'::jsonb,
  created_by text, created_at timestamptz not null default now(), resolved_at timestamptz, updated_at timestamptz not null default now()
);
alter table complaints enable row level security;
drop policy if exists "Complaints read" on complaints;
create policy "Complaints read" on complaints for select to authenticated using ((select can_open('customer-care')));
drop policy if exists "Complaints add" on complaints;
create policy "Complaints add" on complaints for insert to authenticated with check ((select can_open('customer-care')));
drop policy if exists "Complaints change" on complaints;
create policy "Complaints change" on complaints for update to authenticated using ((select can_open('customer-care'))) with check ((select can_open('customer-care')));

-- ── Customer care: returns ───────────────────────────────────────────────────
create sequence if not exists returns_seq;
create table if not exists returns (
  id uuid primary key default gen_random_uuid(),
  ref text unique not null default ('RT-' || lpad(nextval('returns_seq')::text, 4, '0')),
  order_ref text, tracking text, channel text, carrier text, parcel_id bigint unique,
  items jsonb not null default '[]'::jsonb,   -- [{ product_id, name, code, qty }]
  reason text not null default 'other',       -- returned_to_sender | damaged | wrong_item | faulty | not_as_described | changed_mind | other
  status text not null default 'expected',    -- expected | received | restocked | written_off | closed
  auto boolean not null default false,
  condition text,                             -- resaleable | damaged | missing
  refund_amount numeric, refunded boolean not null default false,
  complaint_id uuid, notes text, received_at timestamptz, received_by text,
  history jsonb not null default '[]'::jsonb, created_by text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table returns enable row level security;
drop policy if exists "Returns read" on returns;
create policy "Returns read" on returns for select to authenticated using ((select can_open('customer-care')));
drop policy if exists "Returns add" on returns;
create policy "Returns add" on returns for insert to authenticated with check ((select can_open('customer-care')));
drop policy if exists "Returns change" on returns;
create policy "Returns change" on returns for update to authenticated using ((select can_open('customer-care'))) with check ((select can_open('customer-care')));

-- Parcels coming back to us (HELM tracking says returned to sender) are expected returns automatically
create or replace function public.returns_scan() returns int language plpgsql security definer set search_path = public as $$
declare added int;
begin
  insert into returns (parcel_id, order_ref, tracking, channel, carrier, items, reason, auto, history)
  select p.id, p.order_ref, p.tracking, p.channel, p.carrier, coalesce(p.items, '[]'::jsonb), 'returned_to_sender', true,
         jsonb_build_array(jsonb_build_object('at', now(), 'by', 'Portal', 'what', 'Expected back — the carrier is returning it to us'))
  from helm_parcels p
  where p.status = 10 and p.shipped_at > now() - interval '90 days'
  on conflict (parcel_id) do nothing;
  get diagnostics added = row_count;
  return added;
end $$;
revoke all on function public.returns_scan() from public, anon;
grant execute on function public.returns_scan() to authenticated;
do $$ begin
  if not exists (select 1 from cron.job where jobname = 'returns-scan') then
    perform cron.schedule('returns-scan', '15,45 * * * *', 'select public.returns_scan()');
  end if;
end $$;

-- Find an order to log against: its labels (batch, number, who packed it) and parcel, no customer details
create or replace function public.care_find_order(p_text text)
returns jsonb language sql stable security definer set search_path = public as $$
  with q as (select upper(regexp_replace(coalesce(p_text, ''), '[^A-Za-z0-9]', '', 'g')) as k)
  select case when not public.can_open('customer-care') or length((select k from q)) < 4 then '[]'::jsonb else coalesce((
    select jsonb_agg(x) from (
      select jsonb_build_object('label_id', l.id, 'order_ref', coalesce(nullif(l.channel_ref, ''), l.helm_order), 'tracking', l.tracking,
             'batch_code', b.code, 'seq', l.seq, 'stamp', b.label_name, 'packer', l.packer, 'carrier', b.carrier, 'items', l.items,
             'shipped_at', coalesce(l.dispatched_at, l.printed_at), 'parcel_id', hp.id, 'channel', hp.channel) as x
      from dispatch_labels l join dispatch_batches b on b.id = l.batch_id
      left join helm_parcels hp on hp.tracking = l.tracking
      where l.status <> 'cancelled' and (
        upper(regexp_replace(coalesce(l.channel_ref, ''), '[^A-Za-z0-9]', '', 'g')) like '%' || (select k from q) || '%'
        or upper(regexp_replace(coalesce(l.helm_order, ''), '[^A-Za-z0-9]', '', 'g')) like '%' || (select k from q) || '%'
        or upper(coalesce(l.tracking, '')) like '%' || (select k from q) || '%')
      order by l.created_at desc limit 10) s), '[]'::jsonb) end
$$;
revoke all on function public.care_find_order(text) from public, anon;
grant execute on function public.care_find_order(text) to authenticated;

insert into storage.buckets (id, name, public) values ('care-photos', 'care-photos', false) on conflict (id) do nothing;
drop policy if exists "Care photos read" on storage.objects;
create policy "Care photos read" on storage.objects for select to authenticated using (bucket_id = 'care-photos' and (select can_open('customer-care')));
drop policy if exists "Care photos add" on storage.objects;
create policy "Care photos add" on storage.objects for insert to authenticated with check (bucket_id = 'care-photos' and (select can_open('customer-care')));
