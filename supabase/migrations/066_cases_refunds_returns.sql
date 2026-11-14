-- 066: Customer care rebuilt around how the team works (Oct 2026).
--  Cases (complaints) and Refunds: the office and Jignesh (page customer-care).
--  Returns: the warehouse logs what comes back (page returns) — from customers, and from carriers (undeliverable,
--  refused, damaged in transit) — with photos, condition, and who it's from when the order isn't known.
--  Refunds: requested (with a recommendation) → approved / declined by an admin only → paid (done on the
--  marketplace) with the amount actually refunded. Safe to re-run.

-- Cases: which of the order's products, several photos, replacement / POD
alter table complaints add column if not exists items jsonb not null default '[]'::jsonb;
alter table complaints add column if not exists replacement_ref text;
alter table complaints add column if not exists pod_sent_at timestamptz;
alter table complaints add column if not exists order_total numeric;

create sequence if not exists refunds_seq;
create table if not exists refunds (
  id uuid primary key default gen_random_uuid(),
  ref text unique not null default ('RF-' || lpad(nextval('refunds_seq')::text, 4, '0')),
  complaint_id uuid, return_id uuid,
  order_ref text, tracking text, carrier text, channel text, parcel_id bigint,
  items jsonb not null default '[]'::jsonb,
  reason text not null default 'other',          -- damaged | wrong_item | missing_item | not_received | not_happy | refused | other
  recommendation text,                           -- give | dont_give
  recommendation_note text,
  kind text not null default 'full',             -- none | partial | full
  amount numeric, order_total numeric,
  status text not null default 'requested',      -- requested | approved | declined | paid
  requested_by text, requested_at timestamptz not null default now(),
  decided_by text, decided_at timestamptz, decision_note text,
  paid_amount numeric, paid_at timestamptz, paid_by text, marketplace_ref text,
  history jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table refunds enable row level security;
drop policy if exists "Refunds read" on refunds;
create policy "Refunds read" on refunds for select to authenticated using ((select can_open('customer-care')));
drop policy if exists "Refunds add" on refunds;
create policy "Refunds add" on refunds for insert to authenticated with check ((select can_open('customer-care')));
drop policy if exists "Refunds change" on refunds;
create policy "Refunds change" on refunds for update to authenticated using ((select can_open('customer-care'))) with check ((select can_open('customer-care')));

-- Only an admin approves or declines; paid only once approved
create or replace function public.refunds_rules() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('app.undoing', true), '') = 'on' then return new; end if;
  if new.status is distinct from old.status then
    if new.status in ('approved', 'declined') and not public.is_admin() then raise exception 'Only an admin can approve or decline a refund'; end if;
    if new.status = 'paid' and old.status <> 'approved' then raise exception 'A refund is paid once it''s been approved'; end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists refunds_rules on refunds;
create trigger refunds_rules before update on refunds for each row execute function public.refunds_rules();
drop trigger if exists undo_capture on refunds;
create trigger undo_capture after insert or update or delete on refunds for each row execute function public.undo_capture();

-- Returns: logged by the warehouse
alter table returns add column if not exists source text not null default 'customer';     -- customer | carrier
alter table returns add column if not exists photos jsonb not null default '[]'::jsonb;
alter table returns add column if not exists from_name text;
alter table returns add column if not exists from_postcode text;
alter table returns add column if not exists delivered_by text;                           -- the carrier that brought it back
alter table returns add column if not exists label_note text;                             -- anything else on the label / slip
alter table returns add column if not exists refund_id uuid;
alter table returns add column if not exists outcome text;                                -- back_in_stock | written_off
alter table returns add column if not exists location text;
drop policy if exists "Returns read" on returns;
create policy "Returns read" on returns for select to authenticated using ((select can_open('customer-care') or can_open('returns')));
drop policy if exists "Returns add" on returns;
create policy "Returns add" on returns for insert to authenticated with check ((select can_open('customer-care') or can_open('returns')));
drop policy if exists "Returns change" on returns;
create policy "Returns change" on returns for update to authenticated using ((select can_open('customer-care') or can_open('returns'))) with check ((select can_open('customer-care') or can_open('returns')));

drop policy if exists "Care photos read" on storage.objects;
create policy "Care photos read" on storage.objects for select to authenticated using (bucket_id = 'care-photos' and (select can_open('customer-care') or can_open('returns')));
drop policy if exists "Care photos add" on storage.objects;
create policy "Care photos add" on storage.objects for insert to authenticated with check (bucket_id = 'care-photos' and (select can_open('customer-care') or can_open('returns')));

-- Find an order: by order ref, tracking, or — for a return nobody can place — the name or postcode on the label
create or replace function public.care_find_order(p_text text)
returns jsonb language sql stable security definer set search_path = public as $$
  with q as (select upper(regexp_replace(coalesce(p_text, ''), '[^A-Za-z0-9]', '', 'g')) as k, lower(trim(coalesce(p_text, ''))) as t)
  select case when not (public.can_open('customer-care') or public.can_open('returns')) or length((select k from q)) < 3 then '[]'::jsonb else coalesce((
    select jsonb_agg(x) from (
      select jsonb_build_object('label_id', l.id, 'order_ref', coalesce(nullif(l.channel_ref, ''), l.helm_order), 'tracking', l.tracking,
             'batch_code', b.code, 'seq', l.seq, 'stamp', b.label_name, 'packer', l.packer, 'carrier', b.carrier, 'items', l.items,
             'shipped_at', coalesce(l.dispatched_at, l.printed_at), 'parcel_id', hp.id, 'channel', coalesce(hp.channel, hp2.channel),
             'parcel_status', hp.status, 'delivered_at', hp.delivered_at, 'tracking_url', hp.tracking_url,
             'postcode', left(coalesce(l.postcode, ''), 4), 'order_total', ho.order_total) as x
      from dispatch_labels l join dispatch_batches b on b.id = l.batch_id
      left join helm_parcels hp on hp.tracking = l.tracking
      left join helm_orders ho on ho.id = hp.order_id
      left join lateral (select channel from helm_parcels h2 where h2.order_ref = l.channel_ref limit 1) hp2 on true
      where l.status <> 'cancelled' and (
        public.inv_norm(l.channel_ref) like '%' || (select k from q) || '%'
        or public.inv_norm(l.helm_order) like '%' || (select k from q) || '%'
        or upper(coalesce(l.tracking, '')) like '%' || (select k from q) || '%'
        or (length((select t from q)) >= 4 and (lower(coalesce(l.customer, '')) like '%' || (select t from q) || '%'
            or replace(lower(coalesce(l.postcode, '')), ' ', '') = replace((select t from q), ' ', ''))))
      order by l.created_at desc limit 12) s), '[]'::jsonb) end
$$;
revoke all on function public.care_find_order(text) from public, anon;
grant execute on function public.care_find_order(text) to authenticated;
