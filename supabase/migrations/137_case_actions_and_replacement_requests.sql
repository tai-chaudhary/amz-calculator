-- 137: Cases — "held at depot since", "actions taken"; and replacement requests (19 Nov 2026, the owner's brief).
--
-- 1. A case can be "Undeliverable" or "Held at depot" (kinds are free text; the app lists them). Held at depot
--    records since when. "Actions taken" are ticks on the case: responded to buyer, awaiting buyer response,
--    offered refund or replacement.
alter table public.complaints add column if not exists held_since date;
alter table public.complaints add column if not exists actions jsonb not null default '[]'::jsonb;

-- 2. A replacement request, the twin of a refund request: the office asks (what to send, how many, why), an admin
--    approves or declines, then the admin uploads the replacement's label on the request. That upload is an ordinary
--    Dispatch batch marked as a replacement for the order (the path Order Audit's "Arrange a replacement" has used
--    since v2.60), so Dispatch itself is unchanged. What happened to the label is read back from Dispatch.
create sequence if not exists public.replacement_requests_seq;
create table if not exists public.replacement_requests (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique default ('RP-' || lpad(nextval('public.replacement_requests_seq')::text, 4, '0')),
  complaint_id uuid references public.complaints(id) on delete set null,
  order_ref text, tracking text, carrier text, channel text, parcel_id bigint,
  items jsonb not null default '[]'::jsonb,        -- what to send: [{ code, name, qty }]
  ordered jsonb not null default '[]'::jsonb,
  reason text not null default 'other',
  note text,
  status text not null default 'requested' check (status in ('requested', 'approved', 'declined')),
  requested_by text, requested_at timestamptz not null default now(),
  decided_by text, decided_at timestamptz, decision_note text,
  upload_id uuid, upload_code text, label_uploaded_at timestamptz, label_uploaded_by text,
  history jsonb not null default '[]'::jsonb,
  created_by text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists replacement_requests_order on public.replacement_requests (order_ref);
create index if not exists replacement_requests_case on public.replacement_requests (complaint_id);
alter table public.replacement_requests enable row level security;
drop policy if exists "Replacement requests read" on public.replacement_requests;
drop policy if exists "Replacement requests add" on public.replacement_requests;
drop policy if exists "Replacement requests change" on public.replacement_requests;
create policy "Replacement requests read" on public.replacement_requests for select to authenticated using ((select public.can_open('customer-care')));
create policy "Replacement requests add" on public.replacement_requests for insert to authenticated with check ((select public.can_open('customer-care')));
create policy "Replacement requests change" on public.replacement_requests for update to authenticated
  using ((select public.can_open('customer-care'))) with check ((select public.can_open('customer-care')));
revoke all on public.replacement_requests from anon;
revoke delete, truncate, references, trigger on public.replacement_requests from authenticated;

create or replace function public.replacement_requests_rules() returns trigger
language plpgsql security definer set search_path to 'public' as $fn$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'requested' then raise exception 'A replacement starts as a request'; end if;
    if jsonb_typeof(new.items) <> 'array' or jsonb_array_length(new.items) = 0 then raise exception 'Say what is to be sent'; end if;
    return new;
  end if;
  if new.status is distinct from old.status then
    if old.status <> 'requested' then raise exception 'This request has already been %', old.status; end if;
    if not public.is_admin() then raise exception 'Only an admin can approve or decline a replacement'; end if;
  end if;
  if (new.upload_id is distinct from old.upload_id or new.label_uploaded_at is distinct from old.label_uploaded_at) then
    if new.status <> 'approved' then raise exception 'The label goes on once the replacement is approved'; end if;
    if not public.is_admin() then raise exception 'Only an admin can add the replacement''s label'; end if;
  end if;
  new.updated_at := now();
  return new;
end $fn$;
drop trigger if exists replacement_requests_rules on public.replacement_requests;
create trigger replacement_requests_rules before insert or update on public.replacement_requests
  for each row execute function public.replacement_requests_rules();

-- What Dispatch holds for each request: the replacement labels for its order made since it was asked for.
-- Read-only; for people who can open Cases & Refunds (they may not be able to open Dispatch).
create or replace function public.care_replacement_labels() returns jsonb
language plpgsql stable security definer set search_path to 'public' as $fn$
begin
  if not public.can_open('customer-care') then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('request_id', q.id, 'id', l.id, 'upload_id', l.upload_id, 'code', b.code, 'seq', l.seq,
      'tracking', l.tracking, 'status', l.status, 'items', l.items, 'label_name', l.label_name, 'created_at', l.created_at,
      'printed_at', l.printed_at, 'dispatched_at', l.dispatched_at, 'dispatched_by_name', l.dispatched_by_name,
      'delivered_at', p.delivered_at, 'tracking_url', p.tracking_url) order by l.created_at)
    from replacement_requests q
    join dispatch_labels l on l.reason = 'replacement' and l.status <> 'cancelled'
      and (l.upload_id = q.upload_id or (public.inv_norm(l.original_ref) = public.inv_norm(q.order_ref) and l.created_at >= q.requested_at))
    left join dispatch_batches b on b.id = l.batch_id
    left join helm_parcels p on p.tracking = l.tracking
    where q.status = 'approved'), '[]'::jsonb);
end $fn$;
revoke all on function public.care_replacement_labels() from anon;
