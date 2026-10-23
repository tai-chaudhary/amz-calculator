-- Stock buying, from raising an order to the goods arriving and the invoice
-- being filed. Payment and delivery are tracked separately, because on credit
-- accounts the goods arrive long before the money leaves.
create table if not exists purchase_orders (
  id uuid primary key default gen_random_uuid(),
  po_number text unique not null,
  supplier_id uuid references suppliers(id),
  supplier_name text,
  status text not null default 'draft',
  payment_status text not null default 'unpaid',
  terms text not null default 'prepay',
  payment_due_at date,
  order_method text default 'proforma',
  online_url text, login_hint text,
  proforma_path text, invoice_path text, invoice_number text, invoice_total numeric,
  subtotal numeric default 0, vat numeric default 0, delivery numeric default 0, total numeric default 0,
  notes text, data jsonb not null default '{}'::jsonb,
  created_by text, created_at timestamptz default now(),
  sent_at timestamptz, sent_by text,
  paid_at timestamptz, paid_by text, payment_method text, payment_reference text,
  received_at timestamptz, completed_at timestamptz, completed_by text,
  updated_at timestamptz default now()
);
create index if not exists purchase_orders_supplier_idx on purchase_orders(supplier_id);
create index if not exists purchase_orders_status_idx on purchase_orders(status);

create table if not exists purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  po_id uuid not null references purchase_orders(id) on delete cascade,
  stock_item_id uuid references stock_items(id),
  name text not null, supplier_sku text,
  qty numeric not null default 1, unit_cost numeric not null default 0, qty_received numeric not null default 0,
  line_note text, data jsonb not null default '{}'::jsonb, created_at timestamptz default now()
);
create index if not exists po_items_po_idx on purchase_order_items(po_id);
create index if not exists po_items_stock_idx on purchase_order_items(stock_item_id);

create table if not exists purchase_issues (
  id uuid primary key default gen_random_uuid(),
  po_id uuid not null references purchase_orders(id) on delete cascade,
  po_item_id uuid references purchase_order_items(id) on delete cascade,
  kind text not null, qty numeric default 0, value numeric default 0, description text,
  status text not null default 'reported', supplier_response text,
  reported_by text, reported_at timestamptz default now(),
  last_chased_at timestamptz, resolved_at timestamptz, resolved_by text,
  data jsonb not null default '{}'::jsonb, updated_at timestamptz default now()
);
create index if not exists purchase_issues_po_idx on purchase_issues(po_id);
create index if not exists purchase_issues_status_idx on purchase_issues(status);

-- PO-HI-20260928-001, numbered in the database so two people can't clash
create or replace function public.next_po_number() returns text
language plpgsql security definer set search_path = public as $$
declare d text := to_char(now() at time zone 'Europe/London', 'YYYYMMDD'); n int;
begin
  select count(*) + 1 into n from purchase_orders where po_number like 'PO-HI-' || d || '-%';
  loop
    exit when not exists (select 1 from purchase_orders where po_number = 'PO-HI-' || d || '-' || lpad(n::text, 3, '0'));
    n := n + 1;
  end loop;
  return 'PO-HI-' || d || '-' || lpad(n::text, 3, '0');
end $$;
grant execute on function public.next_po_number() to authenticated;

drop trigger if exists touch_purchase_orders on purchase_orders;
create trigger touch_purchase_orders before update on purchase_orders for each row execute function touch_updated_at();
drop trigger if exists touch_purchase_issues on purchase_issues;
create trigger touch_purchase_issues before update on purchase_issues for each row execute function touch_updated_at();

alter table purchase_orders enable row level security;
alter table purchase_order_items enable row level security;
alter table purchase_issues enable row level security;
drop policy if exists "Signed-in users" on purchase_orders;
drop policy if exists "Signed-in users" on purchase_order_items;
drop policy if exists "Signed-in users" on purchase_issues;
create policy "Signed-in users" on purchase_orders for all to authenticated
  using (public.is_active_user()) with check (public.is_active_user());
create policy "Signed-in users" on purchase_order_items for all to authenticated
  using (public.is_active_user()) with check (public.is_active_user());
create policy "Signed-in users" on purchase_issues for all to authenticated
  using (public.is_active_user()) with check (public.is_active_user());

-- Proformas and invoices: private, staff only
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('purchase-docs', 'purchase-docs', false, 26214400,
  array['application/pdf','image/png','image/jpeg','image/webp','image/heic',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-excel','text/csv'])
on conflict (id) do update set public = false, file_size_limit = 26214400, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Staff read purchase docs" on storage.objects;
drop policy if exists "Staff upload purchase docs" on storage.objects;
drop policy if exists "Staff replace purchase docs" on storage.objects;
create policy "Staff read purchase docs" on storage.objects for select to authenticated
  using (bucket_id = 'purchase-docs' and public.is_active_user());
create policy "Staff upload purchase docs" on storage.objects for insert to authenticated
  with check (bucket_id = 'purchase-docs' and public.is_active_user());
create policy "Staff replace purchase docs" on storage.objects for update to authenticated
  using (bucket_id = 'purchase-docs' and public.is_active_user()) with check (bucket_id = 'purchase-docs');
