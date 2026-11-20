-- ── Who sees costs ──────────────────────────────────────────────────────────
-- Warehouse-only people (dispatch, stock requests, goods in) never see what
-- anything costs — not on screen, and not by reading the database from the
-- browser. Anyone with any other section, and admins, see costs as before.
create or replace function public.sees_costs() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and active
      and (role = 'admin' or exists (
        select 1 from jsonb_array_elements_text(permissions) p
        where p not in ('dispatch', 'dispatch-dashboard', 'requests', 'goods-in')))
  )
$$;
grant execute on function public.sees_costs() to authenticated;

do $$
declare t text;
begin
  foreach t in array array[
    'saved_products','months','recycle_bin','inventory','live_products','price_history','cost_history',
    'stock_items','suppliers','supplier_products','price_list_imports','proposed_changes',
    'market_listings','asin_matches','hunts','hunt_items',
    'purchase_orders','purchase_order_items','purchase_issues'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop policy if exists "Signed-in users" on %I', t);
      execute format('drop policy if exists "Cost viewers" on %I', t);
      execute format($p$create policy "Cost viewers" on %I for all to authenticated
                       using (public.sees_costs()) with check (public.sees_costs())$p$, t);
    end if;
  end loop;
end $$;

-- Overheads are costs too, wherever they're kept
do $$ begin
  if to_regclass('public.overheads') is not null then
    execute 'drop policy if exists "Signed-in users" on overheads';
    execute 'drop policy if exists "Cost viewers" on overheads';
    execute $p$create policy "Cost viewers" on overheads for all to authenticated
      using (public.sees_costs()) with check (public.sees_costs())$p$;
  end if;
end $$;

-- Cost settings: carrier rates and packaging prices
drop policy if exists "Read settings" on settings;
create policy "Read settings" on settings for select to authenticated using (public.sees_costs());

-- The warehouse still needs the dispatch part of settings (who packs, the cut-off)
create or replace function public.dispatch_settings() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((select value -> 'dispatch' from settings where key = 'app_settings'), '{}'::jsonb)
  where public.is_active_user()
$$;
grant execute on function public.dispatch_settings() to authenticated;

-- The activity log records prices; everyone can add to it, only cost viewers read it
drop policy if exists "Signed-in users" on activity_log;
drop policy if exists "Anyone signed in adds" on activity_log;
drop policy if exists "Cost viewers read" on activity_log;
create policy "Anyone signed in adds" on activity_log for insert to authenticated with check (public.is_active_user());
create policy "Cost viewers read" on activity_log for select to authenticated using (public.sees_costs());

-- Proformas and invoices
drop policy if exists "Staff read purchase docs" on storage.objects;
drop policy if exists "Staff upload purchase docs" on storage.objects;
drop policy if exists "Staff replace purchase docs" on storage.objects;
create policy "Staff read purchase docs" on storage.objects for select to authenticated
  using (bucket_id = 'purchase-docs' and public.sees_costs());
create policy "Staff upload purchase docs" on storage.objects for insert to authenticated
  with check (bucket_id = 'purchase-docs' and public.sees_costs());
create policy "Staff replace purchase docs" on storage.objects for update to authenticated
  using (bucket_id = 'purchase-docs' and public.sees_costs()) with check (bucket_id = 'purchase-docs');

-- ── Stock requests ──────────────────────────────────────────────────────────
create sequence if not exists stock_request_seq;

create table if not exists stock_requests (
  id uuid primary key default gen_random_uuid(),
  ref text unique not null default ('SR-' || lpad(nextval('stock_request_seq')::text, 4, '0')),
  stock_item_id uuid references stock_items(id) on delete set null,
  product_name text not null,
  barcode text, helm_sku text, photo_path text,
  qty_requested numeric,
  urgency text not null default 'running_low',          -- low | running_low | out
  note text,
  raised_by text, raised_by_user uuid default auth.uid(),
  status text not null default 'raised',                -- raised | acknowledged | ordered | declined | cancelled
  status_reason text,
  acknowledged_at timestamptz, acknowledged_by text,
  po_id uuid references purchase_orders(id) on delete set null,
  po_item_id uuid references purchase_order_items(id) on delete set null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz default now(), updated_at timestamptz default now()
);
create index if not exists stock_requests_status_idx on stock_requests(status);
create index if not exists stock_requests_po_idx on stock_requests(po_id);
create index if not exists stock_requests_item_idx on stock_requests(stock_item_id);

create table if not exists stock_request_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references stock_requests(id) on delete cascade,
  at timestamptz default now(),
  by_name text, action text not null, detail text
);
create index if not exists stock_request_events_req_idx on stock_request_events(request_id);

drop trigger if exists touch_stock_requests on stock_requests;
create trigger touch_stock_requests before update on stock_requests for each row execute function touch_updated_at();

alter table stock_requests enable row level security;
alter table stock_request_events enable row level security;
drop policy if exists "Signed-in users" on stock_requests;
drop policy if exists "Signed-in users" on stock_request_events;
create policy "Signed-in users" on stock_requests for all to authenticated
  using (public.is_active_user()) with check (public.is_active_user());
create policy "Signed-in users" on stock_request_events for all to authenticated
  using (public.is_active_user()) with check (public.is_active_user());

-- Products to request from: names and codes only, never prices
create or replace function public.request_products()
returns table (id uuid, name text, barcode text, supplier_sku text, supplier_name text)
language sql stable security definer set search_path = public as $$
  select s.id, s.name, s.data ->> 'barcode', s.data ->> 'supplierSku', s.data ->> 'supplierName'
  from stock_items s
  where public.is_active_user() and coalesce((s.data ->> 'archived')::boolean, false) = false
  order by s.name
$$;
grant execute on function public.request_products() to authenticated;

-- Where each request's order is up to: PO number, supplier, quantities and
-- dates. No prices. Only a confirmed delivery date is shown.
create or replace function public.request_progress()
returns table (
  request_id uuid, po_number text, supplier_name text, po_status text, po_terms text,
  payment_status text, sent_at timestamptz, paid_at timestamptz,
  delivery_date date, delivery_confirmed_at timestamptz,
  item_name text, qty numeric, qty_received numeric, line_status text, back_order_date date,
  received_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select r.id, po.po_number, po.supplier_name, po.status, po.terms,
         po.payment_status, po.sent_at, po.paid_at,
         po.delivery_date, po.delivery_confirmed_at,
         i.name, i.qty, i.qty_received, i.line_status, i.back_order_date,
         po.received_at
  from stock_requests r
  join purchase_orders po on po.id = r.po_id
  left join purchase_order_items i on i.id = r.po_item_id
  where public.is_active_user()
$$;
grant execute on function public.request_progress() to authenticated;

-- Photos of things that aren't in Products yet
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('request-photos', 'request-photos', false, 15728640,
  array['image/png','image/jpeg','image/webp','image/heic','image/heif'])
on conflict (id) do update set public = false, file_size_limit = 15728640, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists "Staff read request photos" on storage.objects;
drop policy if exists "Staff add request photos" on storage.objects;
create policy "Staff read request photos" on storage.objects for select to authenticated
  using (bucket_id = 'request-photos' and public.is_active_user());
create policy "Staff add request photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'request-photos' and public.is_active_user());
