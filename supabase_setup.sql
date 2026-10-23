-- Base schema, generated from the live database (tables created before
-- migrations were tracked). Safe to run on an existing database.
--
-- SECURITY NOTE: every table below allows all access via the public key.
-- That is deliberate for now and must be replaced with authenticated-only
-- policies (and enforced roles) before the portal is considered finished.

create table if not exists settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz default now()
);
create table if not exists saved_products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  data jsonb not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create table if not exists months (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  data jsonb not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create table if not exists recycle_bin (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text default 'product',
  data jsonb not null,
  deleted_at timestamptz default now()
);
create table if not exists inventory (
  id text primary key,
  name text not null,
  data jsonb not null,
  updated_at timestamptz default now()
);
create table if not exists live_products (
  id uuid primary key default gen_random_uuid(),
  saved_product_id uuid references saved_products(id) on delete cascade,
  status text default 'live',
  went_live_at timestamptz default now()
);
create table if not exists price_history (
  id uuid primary key default gen_random_uuid(),
  saved_product_id uuid references saved_products(id) on delete cascade,
  old_price numeric, new_price numeric, old_margin numeric, new_margin numeric,
  old_profit numeric, new_profit numeric, cost_price numeric,
  source text default 'live', note text,
  changed_at timestamptz default now(),
  user_id uuid, user_name text
);
create table if not exists cost_history (
  id uuid primary key default gen_random_uuid(),
  saved_product_id uuid references saved_products(id) on delete cascade,
  old_cost numeric, new_cost numeric, old_margin numeric, new_margin numeric,
  sell_price numeric, supplier_name text,
  is_bundle boolean default false, bundle_qty integer, note text,
  changed_at timestamptz default now(),
  user_id uuid, user_name text
);
create table if not exists stock_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz default now()
);
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  role text default 'member',
  created_at timestamptz default now()
);

do $$
declare t text;
begin
  foreach t in array array['settings','saved_products','months','recycle_bin','inventory','live_products',
                           'price_history','cost_history','stock_items','profiles'] loop
    execute format('alter table %I enable row level security', t);
    if not exists (select 1 from pg_policies where tablename = t) then
      execute format('create policy "Allow all on %s" on %I for all using (true) with check (true)', t, t);
    end if;
  end loop;
end $$;
-- Supplier profiles: terms, and which names they appear under on stock items
create table if not exists suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz default now()
);

-- Every line from every imported price list
create table if not exists supplier_products (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid references suppliers(id) on delete cascade,
  supplier_sku text not null,
  barcode text,
  name text,
  unit_cost numeric,
  data jsonb not null default '{}'::jsonb,
  list_date date,
  updated_at timestamptz default now(),
  unique (supplier_id, supplier_sku)
);
create index if not exists supplier_products_barcode_idx on supplier_products(barcode);

-- A record of each import
create table if not exists price_list_imports (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid references suppliers(id) on delete cascade,
  file_name text,
  list_date date,
  summary jsonb default '{}'::jsonb,
  imported_by text,
  created_at timestamptz default now()
);

-- Changes waiting for approval before they touch existing products
create table if not exists proposed_changes (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  target_type text not null,
  target_id uuid not null,
  payload jsonb not null default '{}'::jsonb,
  reason text,
  status text not null default 'pending',
  dedupe_key text unique,
  decided_by text,
  decided_at timestamptz,
  created_at timestamptz default now()
);
create index if not exists proposed_changes_status_idx on proposed_changes(status);

alter table suppliers enable row level security;
alter table supplier_products enable row level security;
alter table price_list_imports enable row level security;
alter table proposed_changes enable row level security;
create policy "Allow all on suppliers" on suppliers for all using (true) with check (true);
create policy "Allow all on supplier_products" on supplier_products for all using (true) with check (true);
create policy "Allow all on price_list_imports" on price_list_imports for all using (true) with check (true);
create policy "Allow all on proposed_changes" on proposed_changes for all using (true) with check (true);

-- Seed the supplier terms you gave me
insert into suppliers (name, data) values
 ('Sian Wholesale',            '{"moq":5000,"leadDays":5,"source":"list","aliases":["Sian Wholesale","Sian"]}'),
 ('Pricecheck Brand Partners', '{"moq":2500,"leadDays":5,"source":"list","delivery":0,"aliases":["Pricecheck Brand Partners","Price Check","Pricecheck","Price Chcek"]}'),
 ('Daler-Rowney',              '{"moq":250,"leadDays":3,"source":"list","aliases":["Daler-Rowney","Daler Rowney"]}'),
 ('Pound Wholesale',           '{"moq":250,"leadDays":3,"source":"online","website":"https://www.poundwholesale.co.uk","aliases":["Pound Wholesale","Poundwholesale"]}'),
 ('MX Wholesale',              '{"moq":250,"leadDays":3,"source":"online","website":"https://www.mxwholesale.co.uk","aliases":["MX Wholesale"]}'),
 ('JD Catering',               '{"moq":250,"leadDays":3,"source":"online","website":"https://jdcateringequip.co.uk","aliases":["JD Catering"]}'),
 ('EFG Housewares',            '{"moq":250,"leadDays":3,"source":"manual","website":"https://www.efghousewares.co.uk","aliases":["EFG Housewares"]}'),
 ('KD Wholesale',              '{"moq":250,"leadDays":3,"source":"online","aliases":["KD Wholesale"]}'),
 ('Samsons Wholesale',         '{"moq":250,"leadDays":3,"source":"online","aliases":["Samsons Wholesale"]}'),
 ('Commercial Clays',          '{"moq":250,"leadDays":3,"source":"online","aliases":["Commercial Clays"]}'),
 ('Regal Wholesale',           '{"moq":250,"leadDays":3,"source":"online","aliases":["Regal Wholesale"]}'),
 ('121 Wholesale',             '{"moq":250,"leadDays":3,"source":"online","aliases":["121 Wholesale"]}')
on conflict (name) do nothing;
create table if not exists market_listings (
  asin text primary key,
  brand text,
  title text,
  data jsonb not null default '{}'::jsonb,
  source_file text,
  updated_at timestamptz default now()
);
create index if not exists market_listings_brand_idx on market_listings(brand);

create table if not exists asin_matches (
  asin text primary key,
  status text not null,
  components jsonb not null default '[]'::jsonb,
  fee_category text,
  decided_by text,
  decided_at timestamptz default now()
);

alter table market_listings enable row level security;
alter table asin_matches enable row level security;
create policy "Allow all on market_listings" on market_listings for all using (true) with check (true);
create policy "Allow all on asin_matches" on asin_matches for all using (true) with check (true);
create table if not exists hunts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  source_file text,
  status text not null default 'open',
  data jsonb not null default '{}'::jsonb,
  created_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists hunt_items (
  id uuid primary key default gen_random_uuid(),
  hunt_id uuid not null references hunts(id) on delete cascade,
  asin text not null,
  disposition text not null default 'pending',
  reason text,
  note text,
  saved_product_id uuid,
  snapshot jsonb not null default '{}'::jsonb,
  decided_by text,
  decided_at timestamptz,
  unique (hunt_id, asin)
);
create index if not exists hunt_items_asin_idx on hunt_items(asin);

alter table hunts enable row level security;
alter table hunt_items enable row level security;
create policy "Allow all on hunts" on hunts for all using (true) with check (true);
create policy "Allow all on hunt_items" on hunt_items for all using (true) with check (true);
create extension if not exists pg_net;
create extension if not exists pg_cron;

-- Where each supplier's sync has got to, so a long catalogue can be read over several runs
create table if not exists sync_state (
  supplier_id uuid primary key references suppliers(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now()
);

-- One row per completed or failed pass, for the portal to show
create table if not exists sync_runs (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid references suppliers(id) on delete cascade,
  status text not null,
  stats jsonb not null default '{}'::jsonb,
  error text,
  started_at timestamptz default now(),
  finished_at timestamptz
);

alter table sync_state enable row level security;
alter table sync_runs enable row level security;
create policy "Read sync_state" on sync_state for select using (true);
create policy "Read sync_runs" on sync_runs for select using (true);

-- A private key the scheduler uses to call the sync job
select vault.create_secret(encode(gen_random_bytes(24), 'hex'), 'supplier_sync_key', 'Authorises scheduled supplier catalogue syncs')
where not exists (select 1 from vault.secrets where name = 'supplier_sync_key');

create or replace function public.supplier_sync_key() returns text
language sql security definer set search_path = public, vault as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'supplier_sync_key' limit 1
$$;
revoke all on function public.supplier_sync_key() from public, anon, authenticated;
grant execute on function public.supplier_sync_key() to service_role;

-- Which suppliers are read, and how their prices are interpreted
update suppliers set data = data || '{"sync":{"kind":"shopify","base":"https://www.mxwholesale.co.uk","nightlyPages":80,"pricesIncludeVat":true}}'::jsonb where name = 'MX Wholesale';
update suppliers set data = data || '{"sync":{"kind":"shopify","base":"https://www.jdcateringequip.co.uk","nightlyPages":110,"pricesIncludeVat":false}}'::jsonb where name = 'JD Catering';
-- Pound Wholesale's site uses bot protection, so it can't be read automatically
update suppliers set data = (data - 'sync') || '{"syncBlocked":"Site uses bot protection (Sucuri) — automated reading not possible. Ask Pound for a price file."}'::jsonb where name = 'Pound Wholesale';

-- Every 3 minutes between midnight and 6am, until each supplier is done for the night
select cron.schedule('supplier-catalogue-sync', '*/3 0-5 * * *', $cron$
  select net.http_post(
    url := 'https://amuqewxxvlggtsyzbyry.supabase.co/functions/v1/supplier-sync',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-key', public.supplier_sync_key()),
    body := '{}'::jsonb,
    timeout_milliseconds := 90000)
$cron$);
-- Catalogue size per supplier, without downloading the catalogue
create or replace function public.supplier_catalogue_stats()
returns table (supplier_id uuid, products bigint, with_barcode bigint, latest_list date, last_updated timestamptz)
language sql stable as $$
  select supplier_id, count(*), count(barcode), max(list_date), max(updated_at)
  from supplier_products group by supplier_id
$$;
grant execute on function public.supplier_catalogue_stats() to anon, authenticated;

-- Brand lookups for the product hunter search product names
create index if not exists supplier_products_name_lower_idx on supplier_products (lower(name));
-- Who did what, to what, and when — one trail for every kind of change
create table if not exists activity_log (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  user_name text,
  entity_type text not null,
  entity_id text,
  entity_name text,
  action text not null,
  detail text,
  before jsonb,
  after jsonb,
  source text
);
create index if not exists activity_log_entity_idx on activity_log(entity_type, entity_id);
create index if not exists activity_log_at_idx on activity_log(at desc);
alter table activity_log enable row level security;
create policy "Allow all on activity_log" on activity_log for all using (true) with check (true);

-- Every save stamps the time itself, so an edit based on an older copy can be caught
alter table stock_items add column if not exists updated_at timestamptz default now();
update stock_items set updated_at = created_at where updated_at is null;

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists touch_saved_products on saved_products;
create trigger touch_saved_products before update on saved_products for each row execute function touch_updated_at();
drop trigger if exists touch_stock_items on stock_items;
create trigger touch_stock_items before update on stock_items for each row execute function touch_updated_at();
drop trigger if exists touch_settings on settings;
create trigger touch_settings before update on settings for each row execute function touch_updated_at();
-- Who can use the portal, and what of it.
alter table profiles add column if not exists permissions jsonb not null default '[]'::jsonb;
alter table profiles add column if not exists active boolean not null default true;
alter table profiles add column if not exists email text;
alter table profiles add column if not exists created_by uuid;
alter table profiles add column if not exists updated_at timestamptz default now();

insert into profiles (id, display_name, role, permissions, email)
select u.id, coalesce(split_part(u.email, '@', 1), 'User'), 'member', '[]'::jsonb, u.email
from auth.users u where not exists (select 1 from profiles p where p.id = u.id);
update profiles p set email = u.email from auth.users u where u.id = p.id and p.email is distinct from u.email;

drop trigger if exists touch_profiles on profiles;
create trigger touch_profiles before update on profiles for each row execute function touch_updated_at();

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin' and active)
$$;
grant execute on function public.is_admin() to authenticated, anon;

create or replace function public.is_active_user() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and active)
$$;
grant execute on function public.is_active_user() to authenticated, anon;

-- Lock the data to signed-in people (previously open to the public browser key)
do $$
declare t text;
begin
  foreach t in array array[
    'saved_products','months','recycle_bin','inventory','live_products','price_history','cost_history',
    'stock_items','suppliers','supplier_products','price_list_imports','proposed_changes',
    'market_listings','asin_matches','hunts','hunt_items','activity_log'
  ] loop
    execute format('drop policy if exists "Allow all on %s" on %I', t, t);
    execute format('drop policy if exists "Allow all" on %I', t);
    execute format('drop policy if exists "Signed-in users" on %I', t);
    execute format($p$create policy "Signed-in users" on %I for all to authenticated
                     using (public.is_active_user()) with check (public.is_active_user())$p$, t);
  end loop;
end $$;

drop policy if exists "Allow all on settings" on settings;
drop policy if exists "Read settings" on settings;
drop policy if exists "Admins change settings" on settings;
create policy "Read settings" on settings for select to authenticated using (public.is_active_user());
create policy "Admins change settings" on settings for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Allow all on profiles" on profiles;
drop policy if exists "Read profiles" on profiles;
drop policy if exists "Admins manage profiles" on profiles;
drop policy if exists "Change your own name" on profiles;
create policy "Read profiles" on profiles for select to authenticated using (true);
create policy "Admins manage profiles" on profiles for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "Change your own name" on profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid() and role = (select role from profiles where id = auth.uid())
    and permissions = (select permissions from profiles where id = auth.uid())
    and active = (select active from profiles where id = auth.uid()));

drop policy if exists "Read sync_state" on sync_state;
drop policy if exists "Read sync_runs" on sync_runs;
create policy "Read sync_state" on sync_state for select to authenticated using (public.is_active_user());
create policy "Read sync_runs" on sync_runs for select to authenticated using (public.is_active_user());
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
-- Not every payment buys stock: carriers, marketing, professional services
alter table purchase_orders add column if not exists category text not null default 'stock';
create index if not exists purchase_orders_category_idx on purchase_orders(category);
-- Finding an order by the supplier's invoice number
create index if not exists purchase_orders_invoice_idx on purchase_orders(lower(invoice_number));
-- Companies you pay aren't all stock suppliers: carriers, printers, agencies,
-- accountants. One list, tagged with what each is for.
update suppliers set data = jsonb_set(data, '{kinds}', '["stock"]'::jsonb) where not (data ? 'kinds');

insert into suppliers (name, data)
select v.name, jsonb_build_object('kinds', jsonb_build_array('carrier'), 'source', 'manual',
                                  'moq', 0, 'delivery', 0, 'leadDays', 0)
from (values ('Evri'), ('DPD'), ('DHL')) as v(name)
where not exists (select 1 from suppliers s where lower(s.name) = lower(v.name));
-- Orders recorded as delivered before the status fix kept saying "awaiting
-- delivery". Put them right; the portal now works this out from the lines anyway.
with progress as (
  select po.id, sum(i.qty) as ordered, sum(least(i.qty_received, i.qty)) as got
  from purchase_orders po join purchase_order_items i on i.po_id = po.id
  where po.status in ('awaiting_delivery', 'partially_received')
  group by po.id
)
update purchase_orders po
set status = case when p.got >= p.ordered then 'received' when p.got > 0 then 'partially_received' else po.status end
from progress p
where p.id = po.id and p.got > 0;
-- A credit note is money coming back: a refund, a damaged-goods credit, a
-- return. It lives alongside orders so a supplier's page shows both sides.
alter table purchase_orders add column if not exists kind text not null default 'order';
alter table purchase_orders add column if not exists credit_for uuid references purchase_orders(id) on delete set null;
alter table purchase_orders add column if not exists credit_reason text;
create index if not exists purchase_orders_kind_idx on purchase_orders(kind);

create or replace function public.next_credit_number() returns text
language plpgsql security definer set search_path = public as $$
declare d text := to_char(now() at time zone 'Europe/London', 'YYYYMMDD'); n int;
begin
  select count(*) + 1 into n from purchase_orders where po_number like 'CN-HI-' || d || '-%';
  loop
    exit when not exists (select 1 from purchase_orders where po_number = 'CN-HI-' || d || '-' || lpad(n::text, 3, '0'));
    n := n + 1;
  end loop;
  return 'CN-HI-' || d || '-' || lpad(n::text, 3, '0');
end $$;
grant execute on function public.next_credit_number() to authenticated;


-- ── 014_dispatch.sql ──
-- Dispatch: shipping labels uploaded from HELM, sorted into batches by what
-- goes in each parcel, printed with the product stamped on every label.
-- Every label is its own row so printing, dispatch and reprints are tracked
-- per parcel; a batch's state is worked out from its labels.

-- What each order's packing slip turns into: the short name stamped on the
-- label, what goes in each parcel, and how many labels an order should have.
create table if not exists dispatch_mappings (
  id uuid primary key default gen_random_uuid(),
  item_key text not null unique,            -- item codes and quantities, normalised
  items jsonb not null default '[]',        -- [{ code, qty, name }] as read from the slip
  label_name text not null,                 -- stamped on every label, kept short
  contents text,                            -- what goes in each parcel, for the cover page
  parcels int not null default 1 check (parcels > 0),
  updated_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Every file uploaded, kept for good
create table if not exists dispatch_uploads (
  id uuid primary key default gen_random_uuid(),
  file_name text,
  storage_path text not null,
  pages int, orders int, labels int, held int,
  uploaded_by uuid, uploaded_by_name text,
  created_at timestamptz not null default now()
);

create table if not exists dispatch_batches (
  id uuid primary key default gen_random_uuid(),
  upload_id uuid references dispatch_uploads(id) on delete cascade,
  code text not null,                       -- B1, B2… per day, stamped on the labels
  ship_date date not null default (now() at time zone 'Europe/London')::date,
  label_name text not null,
  contents text,
  carrier text, service text,
  label_count int not null default 0,
  order_count int not null default 0,
  printed_at timestamptz, printed_by_name text,
  print_count int not null default 0,
  created_at timestamptz not null default now(),
  unique (ship_date, code)
);

create table if not exists dispatch_labels (
  id uuid primary key default gen_random_uuid(),
  upload_id uuid references dispatch_uploads(id) on delete cascade,
  batch_id uuid references dispatch_batches(id) on delete set null,
  seq int,                                  -- its number in the batch: 7 of 23
  page_index int not null,                  -- page in the uploaded file, from 0
  order_key text,                           -- groups the labels of one order
  channel_ref text, helm_order text, slip_id text, label_ref text,
  carrier text, service text, tracking text,
  customer text, postcode text,
  items jsonb not null default '[]',
  label_name text,
  stamp jsonb not null default '{}',        -- where the stamp goes on this label
  status text not null default 'ready',     -- ready, held, dispatched, cancelled
  hold_reason text,
  printed_at timestamptz, printed_by_name text,
  dispatched_at timestamptz, dispatched_by_name text,
  created_at timestamptz not null default now()
);
create index if not exists dispatch_labels_batch_idx on dispatch_labels(batch_id, seq);
create index if not exists dispatch_labels_status_idx on dispatch_labels(status);
create index if not exists dispatch_labels_created_idx on dispatch_labels(created_at desc);
create index if not exists dispatch_labels_refs_idx on dispatch_labels(channel_ref, helm_order, postcode);
create index if not exists dispatch_batches_date_idx on dispatch_batches(ship_date desc);

do $$
declare t text;
begin
  foreach t in array array['dispatch_mappings','dispatch_uploads','dispatch_batches','dispatch_labels'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "Signed-in users" on %I', t);
    execute format($p$create policy "Signed-in users" on %I for all to authenticated
                     using (public.is_active_user()) with check (public.is_active_user())$p$, t);
  end loop;
end $$;

-- The next free batch code for a day: B1, B2…
create or replace function public.next_dispatch_batch_codes(d date, how_many int)
returns text[] language plpgsql security definer set search_path = public as $$
declare n int; result text[] := '{}';
begin
  perform pg_advisory_xact_lock(hashtext('dispatch_batch_codes' || d::text));
  select coalesce(max(nullif(regexp_replace(code, '\D', '', 'g'), '')::int), 0) into n
    from dispatch_batches where ship_date = d;
  for i in 1..how_many loop result := result || ('B' || (n + i)); end loop;
  return result;
end $$;
grant execute on function public.next_dispatch_batch_codes(date, int) to authenticated;

-- The uploaded files, private, read through short-lived links
insert into storage.buckets (id, name, public) values ('dispatch-labels', 'dispatch-labels', false)
  on conflict (id) do nothing;
drop policy if exists "Staff read dispatch labels" on storage.objects;
create policy "Staff read dispatch labels" on storage.objects for select to authenticated
  using (bucket_id = 'dispatch-labels' and public.is_active_user());
drop policy if exists "Staff upload dispatch labels" on storage.objects;
create policy "Staff upload dispatch labels" on storage.objects for insert to authenticated
  with check (bucket_id = 'dispatch-labels' and public.is_active_user());


-- ── 015_dispatch_reprints.sql ──
-- Reprints: a label can be printed again on its own (damaged, lost, ripped).
-- The latest one is kept on the label; every one is in the activity log.
alter table dispatch_labels add column if not exists reprint_count int not null default 0;
alter table dispatch_labels add column if not exists last_reprinted_at timestamptz;
alter table dispatch_labels add column if not exists last_reprinted_by_name text;
alter table dispatch_labels add column if not exists last_reprint_reason text;
-- Labels still to go out are looked up constantly (Close day, Delayed Dispatch)
create index if not exists dispatch_labels_open_idx on dispatch_labels(status, batch_id) where status = 'ready';
create index if not exists dispatch_labels_tracking_idx on dispatch_labels(tracking);


-- ── 016_dispatch_batch_per_file.sql ──
-- A batch is one uploaded file — one HELM pick list. Every label in it shares
-- the batch number (B1, B2… per day), however many products it's split into.
-- dispatch_batches now holds the product groups inside a batch, each carrying
-- its batch's code.
alter table dispatch_uploads add column if not exists code text;
alter table dispatch_uploads add column if not exists ship_date date;
alter table dispatch_uploads add column if not exists picker text;      -- who's picking and packing it
alter table dispatch_uploads add column if not exists title text;       -- e.g. the pick list's name in HELM

-- Number the files already uploaded, in the order they came in each day
with numbered as (
  select id, (created_at at time zone 'Europe/London')::date as d,
         row_number() over (partition by (created_at at time zone 'Europe/London')::date order by created_at) as n
  from dispatch_uploads where code is null
)
update dispatch_uploads u set code = 'B' || numbered.n, ship_date = numbered.d
  from numbered where u.id = numbered.id;
alter table dispatch_uploads alter column ship_date set default (now() at time zone 'Europe/London')::date;
create unique index if not exists dispatch_uploads_day_code_key on dispatch_uploads(ship_date, code);

-- Product groups take their file's number, so several share one code
alter table dispatch_batches drop constraint if exists dispatch_batches_ship_date_code_key;
update dispatch_batches b set code = u.code from dispatch_uploads u where b.upload_id = u.id and u.code is not null;
create index if not exists dispatch_batches_upload_idx on dispatch_batches(upload_id);

create or replace function public.next_dispatch_upload_code(d date)
returns text language plpgsql security definer set search_path = public as $$
declare n int;
begin
  select coalesce(max(nullif(regexp_replace(code, '\D', '', 'g'), '')::int), 0) into n
    from dispatch_uploads where ship_date = d;
  return 'B' || (n + 1);
end $$;
grant execute on function public.next_dispatch_upload_code(date) to authenticated;


-- ── 017_dispatch_ready.sql ──
-- Ready for dispatch: packed and labelled, waiting for collection.
-- Upload → Print → Ready for dispatch → Dispatched; who and when at every step.
alter table dispatch_labels add column if not exists packed_at timestamptz;
alter table dispatch_labels add column if not exists packed_by_name text;


-- ── 018_dispatch_sort.sql ──
-- The order products print in within a batch: Evri first, then DHL, and the
-- same product side by side in pack size order (2 x, 3 x, 4 x) so the packer
-- works through like with like.
alter table dispatch_batches add column if not exists sort_key text;


-- ── 019_dispatch_units_manual.sql ──
-- What each HELM item code really is: the base product and how many of it.
-- "SANMEX-…-3PK" is 3 of Sanmex Fly & Wasp Killer 300ml. Guessed from the
-- code and name when an item first turns up, confirmed once by a person,
-- and from then on every order's units are exact — past uploads included.
create table if not exists dispatch_item_units (
  code_key text primary key,             -- the item code, normalised
  code text not null,
  name text,
  base_product text not null,
  units int not null default 1 check (units > 0),
  confirmed boolean not null default false,
  updated_by_name text,
  updated_at timestamptz not null default now()
);
alter table dispatch_item_units enable row level security;
drop policy if exists "Signed-in users" on dispatch_item_units;
create policy "Signed-in users" on dispatch_item_units for all to authenticated
  using (public.is_active_user()) with check (public.is_active_user());

-- Labels made by hand, with no packing slip: why they're going out
alter table dispatch_labels add column if not exists reason text;        -- replacement, manual, other (empty: a normal order)
alter table dispatch_labels add column if not exists note text;
alter table dispatch_labels add column if not exists original_ref text;  -- the order a replacement is for
create index if not exists dispatch_labels_postcode_idx on dispatch_labels(postcode);


-- ── 020_dispatch_helm_products.sql ──
-- HELM's product list: every product, and every bundle as its parts
-- ("FAIRY…-10PK" = 10 × FAIRY…-320ML; a mixed set lists each thing in it).
-- Imported from HELM's "Inventory Products and Groups" export and refreshed
-- by uploading it again.
alter table dispatch_item_units add column if not exists components jsonb not null default '[]';
alter table dispatch_item_units add column if not exists source text;    -- 'helm' when it came from HELM's list


-- ── 021_dispatch_packer.sql ──
-- Who picks, packs and dispatches each label. The warehouse shares one login,
-- so the person is asked when a batch is printed and recorded on its labels.
alter table dispatch_labels add column if not exists packer text;
create index if not exists dispatch_labels_packer_idx on dispatch_labels(packer);


-- ── 022_dispatch_slip_page.sql ──
-- Where each label's packing slip is in the uploaded file, so the two can be
-- shown side by side when someone needs to check them by eye.
alter table dispatch_labels add column if not exists slip_page int;
-- When an order will actually arrive. An estimate from the supplier's lead time
-- is only a guide (back orders can turn 3 days into 2 weeks), so a date only
-- counts as firm once someone confirms it with the supplier.
alter table purchase_orders add column if not exists delivery_date date;
alter table purchase_orders add column if not exists delivery_confirmed_at timestamptz;
alter table purchase_orders add column if not exists delivery_confirmed_by text;
alter table purchase_orders add column if not exists delivery_note text;
create index if not exists purchase_orders_delivery_idx on purchase_orders(delivery_date);

-- Not every line arrives with the order. A line can be on back order (with its
-- own date, or none yet) or cancelled by the supplier.
alter table purchase_order_items add column if not exists line_status text not null default 'due';
alter table purchase_order_items add column if not exists back_order_date date;
alter table purchase_order_items add column if not exists line_status_note text;
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
-- ── Goods in ────────────────────────────────────────────────────────────────
-- The warehouse books deliveries in against stock and packaging orders, and
-- logs anything that turns up without one. The warehouse can't read purchase
-- orders (they carry prices), so everything goes through the functions below,
-- which only ever hand back names, quantities and dates.

create or replace function public.can_open(page text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and active
    and (role = 'admin' or permissions ? page))
$$;
grant execute on function public.can_open(text) to authenticated;

create sequence if not exists goods_in_seq;

create table if not exists goods_in_deliveries (
  id uuid primary key default gen_random_uuid(),
  ref text unique not null default ('GI-' || lpad(nextval('goods_in_seq')::text, 4, '0')),
  po_id uuid references purchase_orders(id) on delete set null,
  supplier_name text,
  delivery_note_no text,
  cartons integer, pallets integer,
  signed_unchecked boolean not null default false,
  note_photo_path text,
  photos jsonb not null default '[]'::jsonb,          -- damage and other photos
  lines jsonb not null default '[]'::jsonb,           -- [{po_item_id, name, expected, arrived, damaged, note, photo_path}]
  received_by text, received_by_user uuid default auth.uid(),
  received_at timestamptz default now(),
  kind text not null default 'order',                 -- order | unexpected
  has_problems boolean not null default false,
  office_status text not null default 'none',         -- none | open | resolved
  office_note text, resolved_at timestamptz, resolved_by text,
  put_away_at timestamptz, put_away_by text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz default now(), updated_at timestamptz default now()
);
create index if not exists goods_in_po_idx on goods_in_deliveries(po_id);
create index if not exists goods_in_received_idx on goods_in_deliveries(received_at desc);
drop trigger if exists touch_goods_in on goods_in_deliveries;
create trigger touch_goods_in before update on goods_in_deliveries for each row execute function touch_updated_at();

alter table goods_in_deliveries enable row level security;
drop policy if exists "Goods in staff" on goods_in_deliveries;
create policy "Goods in staff" on goods_in_deliveries for all to authenticated
  using (public.can_open('goods-in') or public.sees_costs())
  with check (public.can_open('goods-in') or public.sees_costs());

-- Photos: delivery notes and damage
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('goods-in-photos', 'goods-in-photos', false, 15728640,
  array['image/png','image/jpeg','image/webp','image/heic','image/heif','application/pdf'])
on conflict (id) do update set public = false, file_size_limit = 15728640, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists "Goods in read photos" on storage.objects;
drop policy if exists "Goods in add photos" on storage.objects;
create policy "Goods in read photos" on storage.objects for select to authenticated
  using (bucket_id = 'goods-in-photos' and (public.can_open('goods-in') or public.sees_costs()));
create policy "Goods in add photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'goods-in-photos' and (public.can_open('goods-in') or public.sees_costs()));

-- What's coming: open stock and packaging orders, plus the last few weeks'
-- finished ones. Names, quantities and dates — no prices. The delivery date is
-- only given once someone has confirmed it with the supplier.
create or replace function public.goods_in_orders()
returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(o order by o->>'sort'), '[]'::jsonb) from (
    select jsonb_build_object(
      'id', po.id, 'po_number', po.po_number, 'supplier_name', po.supplier_name,
      'category', po.category, 'status', po.status, 'terms', po.terms, 'payment_status', po.payment_status,
      'sent_at', po.sent_at, 'paid_at', po.paid_at, 'created_at', po.created_at, 'received_at', po.received_at,
      'delivery_date', po.delivery_date, 'delivery_note', po.delivery_note,
      'sort', coalesce(po.delivery_date::text, '9999') || po.po_number,
      'items', coalesce((select jsonb_agg(jsonb_build_object(
          'id', i.id, 'name', i.name, 'supplier_sku', i.supplier_sku, 'stock_item_id', i.stock_item_id,
          'qty', i.qty, 'qty_received', i.qty_received, 'line_status', i.line_status, 'back_order_date', i.back_order_date,
          'barcode', s.data ->> 'barcode'
        ) order by i.created_at, i.name)
        from purchase_order_items i left join stock_items s on s.id = i.stock_item_id
        where i.po_id = po.id), '[]'::jsonb)
    ) as o
    from purchase_orders po
    where (public.can_open('goods-in') or public.sees_costs())
      and coalesce(po.kind, 'order') <> 'credit_note'
      and coalesce(po.category, 'stock') in ('stock', 'packaging')
      and po.status not in ('draft', 'cancelled')
      and (po.status not in ('received', 'completed') or po.received_at > now() - interval '30 days'
           or exists (select 1 from purchase_order_items i where i.po_id = po.id
                      and coalesce(i.line_status, 'due') <> 'cancelled' and coalesce(i.qty_received, 0) < coalesce(i.qty, 0)))
  ) x
$$;
grant execute on function public.goods_in_orders() to authenticated;

-- Book a delivery in. lines: [{po_item_id, name, expected, arrived, damaged, note, photo_path}]
-- Arrived counts everything that came, damaged included; damage and anything
-- short are reported to the office as delivery problems with their value.
create or replace function public.book_in_delivery(p_po_id uuid, p_lines jsonb, p_delivery jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  po purchase_orders%rowtype;
  l jsonb; it purchase_order_items%rowtype;
  arrived numeric; damaged numeric; problems boolean := false;
  total_qty numeric; total_got numeric; started boolean;
  d goods_in_deliveries%rowtype;
  who text := nullif(p_delivery ->> 'received_by', '');
begin
  if not (public.can_open('goods-in') or public.sees_costs()) then raise exception 'Not allowed'; end if;
  select * into po from purchase_orders where id = p_po_id;
  if not found then raise exception 'Order not found'; end if;
  if po.status in ('draft', 'cancelled') then raise exception 'That order isn''t placed'; end if;

  for l in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    arrived := coalesce((l ->> 'arrived')::numeric, 0);
    damaged := coalesce((l ->> 'damaged')::numeric, 0);
    select * into it from purchase_order_items where id = (l ->> 'po_item_id')::uuid and po_id = p_po_id;
    if not found then continue; end if;
    if arrived <> 0 then
      update purchase_order_items set qty_received = coalesce(qty_received, 0) + arrived where id = it.id;
      -- A back-ordered line that turns up is back with the order
      if it.line_status = 'back_order' and coalesce(it.qty_received, 0) + arrived >= coalesce(it.qty, 0) then
        update purchase_order_items set line_status = 'due', back_order_date = null where id = it.id;
      end if;
      -- Tell the requests on this line
      insert into stock_request_events (request_id, by_name, action, detail)
      select r.id, who, 'Delivery booked in',
             arrived || ' arrived' || case when damaged > 0 then ', ' || damaged || ' damaged' else '' end
      from stock_requests r where r.po_item_id = it.id;
    end if;
    if damaged > 0 then
      problems := true;
      insert into purchase_issues (po_id, po_item_id, kind, qty, value, description, status, reported_by, data)
      values (p_po_id, it.id, 'damaged', damaged, round(damaged * coalesce(it.unit_cost, 0), 2),
              nullif(concat_ws(' · ', 'Found at goods in', nullif(l ->> 'note', '')), ''), 'reported', who,
              jsonb_build_object('photo_path', l ->> 'photo_path', 'source', 'goods_in'));
    end if;
    if (l ->> 'short')::boolean is true then
      problems := true;
      insert into purchase_issues (po_id, po_item_id, kind, qty, value, description, status, reported_by, data)
      values (p_po_id, it.id, 'missing', coalesce((l ->> 'short_qty')::numeric, 0),
              round(coalesce((l ->> 'short_qty')::numeric, 0) * coalesce(it.unit_cost, 0), 2),
              nullif(concat_ws(' · ', 'Short at goods in', nullif(l ->> 'note', '')), ''), 'reported', who,
              jsonb_build_object('source', 'goods_in'));
    end if;
    if coalesce((l ->> 'wrong_qty')::numeric, 0) > 0 then
      problems := true;
      insert into purchase_issues (po_id, po_item_id, kind, qty, value, description, status, reported_by, data)
      values (p_po_id, it.id, 'wrong_item', (l ->> 'wrong_qty')::numeric,
              round((l ->> 'wrong_qty')::numeric * coalesce(it.unit_cost, 0), 2),
              nullif(concat_ws(' · ', 'Wrong item at goods in', nullif(l ->> 'note', '')), ''), 'reported', who,
              jsonb_build_object('photo_path', l ->> 'photo_path', 'source', 'goods_in'));
    end if;
  end loop;

  select coalesce(sum(qty), 0), coalesce(sum(least(coalesce(qty_received, 0), qty)), 0), bool_or(coalesce(qty_received, 0) > 0)
    into total_qty, total_got, started
  from purchase_order_items where po_id = p_po_id and coalesce(line_status, 'due') <> 'cancelled';

  update purchase_orders set
    status = case when status = 'completed' then status
                  when total_qty > 0 and total_got >= total_qty then 'received'
                  when started then 'partially_received' else status end,
    received_at = now()
  where id = p_po_id;

  insert into goods_in_deliveries (po_id, supplier_name, delivery_note_no, cartons, pallets, signed_unchecked,
      note_photo_path, photos, lines, received_by, kind, has_problems, office_status, data)
  values (p_po_id, po.supplier_name, nullif(p_delivery ->> 'delivery_note_no', ''),
      nullif(p_delivery ->> 'cartons', '')::int, nullif(p_delivery ->> 'pallets', '')::int,
      coalesce((p_delivery ->> 'signed_unchecked')::boolean, false),
      nullif(p_delivery ->> 'note_photo_path', ''), coalesce(p_delivery -> 'photos', '[]'::jsonb),
      coalesce(p_lines, '[]'::jsonb), who, 'order', problems, case when problems then 'open' else 'none' end,
      jsonb_build_object('po_number', po.po_number))
  returning * into d;

  insert into activity_log (entity_type, entity_id, entity_name, action, detail, user_name, source)
  values ('purchase', p_po_id, po.po_number, 'Delivery booked in',
          d.ref || coalesce(' by ' || who, '') || case when problems then ' · with problems' else '' end, who, 'goods-in');

  return jsonb_build_object('id', d.id, 'ref', d.ref, 'problems', problems);
end $$;
grant execute on function public.book_in_delivery(uuid, jsonb, jsonb) to authenticated;
-- ── ClickUp messages ─────────────────────────────────────────────────────────
-- Things that happen in the portal post a message to a ClickUp channel. Events
-- are queued here (by the database itself, or by the portal for things like a
-- batch upload), and the "notify" function sends them. The ClickUp token is
-- kept in the vault: it can be set by an admin but never read back by anyone.

-- The key the database uses to call the notify function
select vault.create_secret(encode(gen_random_bytes(24), 'hex'), 'notify_key', 'Authorises the database to send ClickUp messages')
where not exists (select 1 from vault.secrets where name = 'notify_key');

create or replace function public.notify_key() returns text
language sql security definer set search_path = public, vault as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'notify_key' limit 1
$$;
revoke all on function public.notify_key() from public, anon, authenticated;
grant execute on function public.notify_key() to service_role;

create or replace function public.clickup_token() returns text
language sql security definer set search_path = public, vault as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'clickup_token' limit 1
$$;
revoke all on function public.clickup_token() from public, anon, authenticated;
grant execute on function public.clickup_token() to service_role;

-- Admins set (or clear) the token; nobody can read it back
create or replace function public.set_clickup_token(p_token text) returns boolean
language plpgsql security definer set search_path = public, vault as $$
declare sid uuid;
begin
  if not public.is_admin() then raise exception 'Only an admin can connect ClickUp'; end if;
  select id into sid from vault.secrets where name = 'clickup_token';
  if coalesce(trim(p_token), '') = '' then
    if sid is not null then delete from vault.secrets where id = sid; end if;
    return false;
  end if;
  if sid is null then perform vault.create_secret(trim(p_token), 'clickup_token', 'ClickUp API token for portal messages');
  else perform vault.update_secret(sid, trim(p_token)); end if;
  return true;
end $$;
grant execute on function public.set_clickup_token(text) to authenticated;

create or replace function public.clickup_connected() returns boolean
language sql security definer set search_path = public, vault as $$
  select public.is_admin() and exists (select 1 from vault.secrets where name = 'clickup_token')
$$;
grant execute on function public.clickup_connected() to authenticated;

-- Which events go where
create table if not exists notification_rules (
  event text primary key,
  enabled boolean not null default true,
  channel_id text, channel_name text,
  updated_at timestamptz default now(), updated_by text
);
alter table notification_rules enable row level security;
drop policy if exists "Admins manage notification rules" on notification_rules;
create policy "Admins manage notification rules" on notification_rules for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

insert into notification_rules (event, channel_name) values
  ('batch_uploaded', 'Warehouse Team'),
  ('day_closed', 'Warehouse Team'),
  ('request_raised', 'General - Adrian Marsh'),
  ('request_ordered', 'Warehouse Team'),
  ('request_declined', 'Warehouse Team'),
  ('delivery_confirmed', 'Warehouse Team'),
  ('delivery_booked', 'Warehouse Team'),
  ('goods_in_problem', 'General - Adrian Marsh'),
  ('unexpected_delivery', 'General - Adrian Marsh')
on conflict (event) do nothing;

-- What's waiting to go, and what went
create table if not exists notification_outbox (
  id uuid primary key default gen_random_uuid(),
  event text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz default now(),
  sent_at timestamptz, attempts integer not null default 0, error text, channel_name text, message text
);
create index if not exists notification_outbox_pending_idx on notification_outbox(created_at) where sent_at is null;
alter table notification_outbox enable row level security;
drop policy if exists "Admins read the outbox" on notification_outbox;
create policy "Admins read the outbox" on notification_outbox for select to authenticated using (public.is_admin());

-- Send as soon as it's queued
create or replace function public.notify_send_now() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform net.http_post(
    url := 'https://amuqewxxvlggtsyzbyry.supabase.co/functions/v1/notify',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-notify-key', public.notify_key()),
    body := jsonb_build_object('id', new.id),
    timeout_milliseconds := 20000);
  return new;
exception when others then
  return new;   -- the retry job picks it up
end $$;
drop trigger if exists notify_send_now on notification_outbox;
create trigger notify_send_now after insert on notification_outbox for each row execute function public.notify_send_now();

-- Queue an event, if it's switched on
create or replace function public.queue_event(p_event text, p_payload jsonb) returns void
language plpgsql security definer set search_path = public, vault as $$
begin
  if exists (select 1 from notification_rules where event = p_event and enabled)
     and exists (select 1 from vault.secrets where name = 'clickup_token') then
    insert into notification_outbox (event, payload) values (p_event, coalesce(p_payload, '{}'::jsonb));
  end if;
exception when others then
  null;   -- a message must never stop the work it's about
end $$;
revoke all on function public.queue_event(text, jsonb) from public, anon, authenticated;

-- The portal queues the events the database can't see whole (an upload, closing the day)
create or replace function public.queue_notification(p_event text, p_payload jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_active_user() then return; end if;
  if p_event not in ('batch_uploaded', 'day_closed') then return; end if;
  perform public.queue_event(p_event, p_payload || jsonb_build_object('by', coalesce(p_payload ->> 'by',
    (select display_name from profiles where id = auth.uid()))));
end $$;
grant execute on function public.queue_notification(text, jsonb) to authenticated;

-- ── Events the database raises itself ──

create or replace function public.notify_stock_request() returns trigger
language plpgsql security definer set search_path = public as $$
declare po purchase_orders%rowtype; it purchase_order_items%rowtype;
begin
  if tg_op = 'INSERT' then
    perform public.queue_event('request_raised', jsonb_build_object(
      'id', new.id, 'ref', new.ref, 'product', new.product_name, 'qty', new.qty_requested,
      'urgency', new.urgency, 'by', new.raised_by, 'note', new.note, 'in_products', new.stock_item_id is not null));
  elsif new.status = 'declined' and old.status is distinct from 'declined' then
    perform public.queue_event('request_declined', jsonb_build_object(
      'id', new.id, 'ref', new.ref, 'product', new.product_name, 'reason', new.status_reason, 'by', new.raised_by));
  elsif new.po_id is not null and new.po_id is distinct from old.po_id then
    select * into po from purchase_orders where id = new.po_id;
    select * into it from purchase_order_items where id = new.po_item_id;
    perform public.queue_event('request_ordered', jsonb_build_object(
      'id', new.id, 'ref', new.ref, 'product', new.product_name, 'by', new.raised_by,
      'po_number', po.po_number, 'supplier', po.supplier_name, 'qty', it.qty,
      'po_status', po.status, 'delivery_date', po.delivery_date));
  end if;
  return new;
end $$;
drop trigger if exists notify_stock_request on stock_requests;
create trigger notify_stock_request after insert or update on stock_requests for each row execute function public.notify_stock_request();

create or replace function public.notify_delivery_date() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.delivery_date is not null and new.delivery_date is distinct from old.delivery_date
     and coalesce(new.kind, 'order') <> 'credit_note' and coalesce(new.category, 'stock') in ('stock', 'packaging') then
    perform public.queue_event('delivery_confirmed', jsonb_build_object(
      'po_id', new.id, 'po_number', new.po_number, 'supplier', new.supplier_name,
      'date', new.delivery_date, 'was', old.delivery_date, 'note', new.delivery_note, 'by', new.delivery_confirmed_by,
      'lines', coalesce((select jsonb_agg(jsonb_build_object('name', i.name, 'qty', i.qty) order by i.created_at)
                         from purchase_order_items i where i.po_id = new.id and coalesce(i.line_status, 'due') <> 'cancelled'), '[]'::jsonb)));
  end if;
  return new;
end $$;
drop trigger if exists notify_delivery_date on purchase_orders;
create trigger notify_delivery_date after update of delivery_date on purchase_orders for each row execute function public.notify_delivery_date();

create or replace function public.notify_goods_in() returns trigger
language plpgsql security definer set search_path = public as $$
declare base jsonb;
begin
  base := jsonb_build_object('id', new.id, 'ref', new.ref, 'po_number', new.data ->> 'po_number', 'supplier', new.supplier_name,
    'by', new.received_by, 'lines', new.lines, 'cartons', new.cartons, 'pallets', new.pallets,
    'signed_unchecked', new.signed_unchecked, 'problems', new.has_problems, 'note', new.data ->> 'note');
  if new.kind = 'unexpected' then
    perform public.queue_event('unexpected_delivery', base);
  else
    perform public.queue_event('delivery_booked', base);
    if new.has_problems then perform public.queue_event('goods_in_problem', base); end if;
  end if;
  return new;
end $$;
drop trigger if exists notify_goods_in on goods_in_deliveries;
create trigger notify_goods_in after insert on goods_in_deliveries for each row execute function public.notify_goods_in();

-- Anything that didn't go first time is tried again every 5 minutes (up to 5 tries)
select cron.unschedule('notify-retry') where exists (select 1 from cron.job where jobname = 'notify-retry');
select cron.schedule('notify-retry', '*/5 * * * *', $cron$
  select net.http_post(
    url := 'https://amuqewxxvlggtsyzbyry.supabase.co/functions/v1/notify',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-notify-key', public.notify_key()),
    body := '{"retry":true}'::jsonb,
    timeout_milliseconds := 60000)
  where exists (select 1 from public.notification_outbox where sent_at is null and attempts < 5)
$cron$);


-- ── Inventory ───────────────────────────────────────────────────────────────
-- Stock by product and location. Every change is a movement (opening count,
-- goods in, a move, a manual add or remove with its reason, a despatch), and
-- the balances are kept from the movements, so the numbers always add up and
-- every unit can be traced. Movements are only ever written by the functions
-- below — never directly from the browser — so nothing changes without a
-- reason and a name against it.
--
-- Open orders aren't stored: they're worked out live from the dispatch labels
-- not yet gone, so uploading labels reserves stock straight away, and the
-- units come off the shelf when an order's last label is dispatched.
-- No prices anywhere in here.

-- Warehouse-only sections never see costs
create or replace function public.sees_costs() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and active
      and (role = 'admin' or exists (
        select 1 from jsonb_array_elements_text(permissions) p
        where p not in ('dispatch', 'dispatch-dashboard', 'requests', 'goods-in', 'inventory', 'tasks')))
  )
$$;
grant execute on function public.sees_costs() to authenticated;

-- Codes compared the way the portal compares them: letters and digits only
create or replace function public.inv_norm(t text) returns text
language sql immutable as $$ select upper(regexp_replace(coalesce(t, ''), '[^A-Za-z0-9]', '', 'g')) $$;

-- A real shelf: aisle A–H, bay 1–10 (D has 11), shelf 0 (ground) to 7, section 1–4
create or replace function public.inv_valid_location(c text) returns boolean
language sql immutable as $$
  select coalesce(c ~ '^[A-H]-([1-9]|1[01])-[0-7]-[1-4]$'
    and split_part(c, '-', 2)::int <= case when split_part(c, '-', 1) = 'D' then 11 else 10 end, false)
$$;

create or replace function public.inv_can_edit() returns boolean
language sql stable security definer set search_path = public as $$
  select public.can_open('inventory') or public.sees_costs()
$$;

-- ── Tables ──

create table if not exists inv_meta (
  id int primary key default 1 check (id = 1),
  counted_at timestamptz,          -- when the opening count was taken
  started_at timestamptz,          -- when inventory started following dispatch
  rates_at timestamptz,            -- when sales rates were last worked out
  updated_by text
);
insert into inv_meta (id) values (1) on conflict do nothing;

create table if not exists inv_products (
  id uuid primary key default gen_random_uuid(),
  code text not null,                         -- HELM product code
  code_key text generated always as (public.inv_norm(code)) stored,
  name text not null,
  in_helm boolean not null default true,      -- false: still to be created in HELM
  stock_item_id uuid references stock_items(id) on delete set null,   -- the matching Product, for supplier and lead time
  min_pick int,                               -- keep at least this many on the pick shelf
  daily_override numeric,                     -- e.g. de-icing salt in winter
  override_until date,
  lead_days int,                              -- calendar days from ordering to arriving, if not the supplier's
  active boolean not null default true,
  note text,
  created_by text,
  created_at timestamptz default now(), updated_at timestamptz default now()
);
create unique index if not exists inv_products_code_key on inv_products(code_key);
drop trigger if exists touch_inv_products on inv_products;
create trigger touch_inv_products before update on inv_products for each row execute function touch_updated_at();

create table if not exists inv_locations (
  code text primary key check (public.inv_valid_location(code)),
  pickable boolean not null default false,
  note text,
  updated_by text,
  created_at timestamptz default now(), updated_at timestamptz default now()
);
drop trigger if exists touch_inv_locations on inv_locations;
create trigger touch_inv_locations before update on inv_locations for each row execute function touch_updated_at();

create table if not exists inv_movements (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  product_id uuid not null references inv_products(id) on delete cascade,
  location text references inv_locations(code) on update cascade,   -- null: sold with nowhere to take it from
  qty numeric not null check (qty <> 0),
  kind text not null check (kind in ('opening', 'count', 'goods_in', 'move', 'add', 'remove', 'despatch', 'despatch_undo')),
  reason text, note text,
  ref text,                                   -- order ref, GI number, task number
  ref_id uuid,
  order_key text,                             -- the dispatch order it went out on
  group_id uuid,                              -- the two halves of a move
  by_name text, by_user uuid default auth.uid()
);
create index if not exists inv_movements_product_idx on inv_movements(product_id, at desc);
create index if not exists inv_movements_at_idx on inv_movements(at desc);
create index if not exists inv_movements_kind_idx on inv_movements(kind, at desc);
create index if not exists inv_movements_order_idx on inv_movements(order_key);

-- What's where, kept from the movements. location '' is "not on a shelf".
create table if not exists inv_balances (
  product_id uuid not null references inv_products(id) on delete cascade,
  location text not null default '',
  qty numeric not null default 0,
  primary key (product_id, location)
);
create index if not exists inv_balances_location_idx on inv_balances(location);

-- Orders whose units have come off the shelf, so nothing is ever taken twice
create table if not exists inv_despatched (
  order_key text primary key,                 -- upload id | order key
  at timestamptz not null default now(),
  counted boolean not null default true       -- false: went before the opening count, nothing taken
);

-- Codes sold that aren't in inventory, so they can be added
create table if not exists inv_unmatched (
  code_key text primary key,
  code text, name text,
  units numeric not null default 0,
  last_seen timestamptz default now()
);

-- Things the warehouse needs to do: top up a pick shelf from overflow
create sequence if not exists inv_task_seq;
create table if not exists inv_tasks (
  id uuid primary key default gen_random_uuid(),
  ref text unique not null default ('T-' || lpad(nextval('inv_task_seq')::text, 4, '0')),
  kind text not null default 'replenish',
  product_id uuid not null references inv_products(id) on delete cascade,
  from_location text, to_location text,
  qty numeric,                                -- how many to move
  why text,                                   -- what triggered it
  status text not null default 'open',        -- open | done | cleared | dismissed
  moved numeric,
  done_at timestamptz, done_by text, note text,
  created_at timestamptz default now()
);
create index if not exists inv_tasks_status_idx on inv_tasks(status, created_at desc);
create index if not exists inv_tasks_product_idx on inv_tasks(product_id);

-- Sales history from a marketplace report (no customer details), by SKU and day
create table if not exists inv_channel_sales (
  source text not null, day date not null, sku text not null,
  units numeric not null,
  primary key (source, day, sku)
);
-- What each marketplace SKU is, as HELM item codes per one sold: [{code, qty}]
create table if not exists inv_channel_skus (
  source text not null, sku text not null,
  title text,
  items jsonb not null default '[]'::jsonb,
  how text,                                   -- 'orders' (learned from dispatched orders) | 'person'
  updated_by text, updated_at timestamptz default now(),
  primary key (source, sku)
);

-- Sales rates, worked out every so often
create table if not exists inv_rates (
  product_id uuid primary key references inv_products(id) on delete cascade,
  units_7 numeric not null default 0,
  units_28 numeric not null default 0,
  days numeric not null default 0,            -- days of history behind the rate (up to 28)
  daily numeric not null default 0,
  updated_at timestamptz default now()
);

-- Names a delivery line goes by, so put-away knows the product next time
create table if not exists inv_aliases (
  key text primary key,                       -- 'si:<stock item id>' or 'name:<normalised name>'
  product_id uuid not null references inv_products(id) on delete cascade,
  updated_at timestamptz default now()
);

do $$
declare t text;
begin
  foreach t in array array['inv_meta','inv_products','inv_locations','inv_movements','inv_balances','inv_despatched',
                           'inv_unmatched','inv_tasks','inv_channel_sales','inv_channel_skus','inv_rates','inv_aliases'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "Read inventory" on %I', t);
    -- Anyone signed in can read stock (it has no prices); all changes go through the functions below
    execute format($p$create policy "Read inventory" on %I for select to authenticated using (public.is_active_user())$p$, t);
  end loop;
end $$;

-- ── Balances follow movements ──

create or replace function public.inv_apply_movement() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into inv_balances (product_id, location, qty) values (new.product_id, coalesce(new.location, ''), new.qty)
  on conflict (product_id, location) do update set qty = inv_balances.qty + excluded.qty;
  -- An emptied overflow spot is free again; a pick shelf stays the product's even when empty
  delete from inv_balances b where b.product_id = new.product_id and b.location = coalesce(new.location, '') and b.qty = 0
    and (b.location = '' or not exists (select 1 from inv_locations l where l.code = b.location and l.pickable));
  return null;
end $$;
drop trigger if exists inv_movement_balance on inv_movements;
create trigger inv_movement_balance after insert on inv_movements for each row execute function public.inv_apply_movement();

-- Movements can't be changed or removed: a mistake is put right with another movement
create or replace function public.inv_movements_locked() returns trigger language plpgsql as $$
begin raise exception 'Stock movements can''t be changed — add a correction instead'; end $$;
drop trigger if exists inv_movements_no_change on inv_movements;
create trigger inv_movements_no_change before update or delete on inv_movements for each row
  when (pg_trigger_depth() = 0) execute function public.inv_movements_locked();

-- ── What an order's items are, in inventory products ──

-- items: [{code, qty, name}] as on a packing slip. A HELM bundle is its parts;
-- a code HELM doesn't list is matched on its own. Returns one row per part,
-- product_id null when it isn't in inventory.
create or replace function public.inv_expand(p_items jsonb, p_mult numeric default 1)
returns table (product_id uuid, code text, name text, units numeric)
language sql stable security definer set search_path = public as $$
  with it as (
    select i ->> 'code' as code, i ->> 'name' as name,
           coalesce(nullif(regexp_replace(i ->> 'qty', '[^0-9.]', '', 'g'), '')::numeric, 0) * p_mult as qty
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) i
  ), parts as (
    select coalesce(c ->> 'code', it.code) as code, coalesce(c ->> 'name', it.name) as name,
           it.qty * coalesce(nullif(c ->> 'units', '')::numeric, 1) as units
    from it
    left join dispatch_item_units u on u.code_key = public.inv_norm(it.code)
    left join lateral jsonb_array_elements(case when jsonb_array_length(coalesce(u.components, '[]'::jsonb)) > 0
                                                then u.components end) c on true
    where it.qty > 0
  )
  select p.id, parts.code, parts.name, parts.units
  from parts left join inv_products p on p.code_key = public.inv_norm(parts.code)
$$;

-- Orders uploaded and not yet gone: every label still waiting or on hold.
-- Each order counts once, however many labels it has.
create or replace function public.inv_open_order_units()
returns table (product_id uuid, code text, name text, units numeric, order_key text, ref text, created_at timestamptz, status text)
language sql stable security definer set search_path = public as $$
  with o as (
    select l.upload_id::text || '|' || coalesce(l.order_key, l.id::text) as k,
           (array_agg(l.items order by jsonb_array_length(l.items) desc))[1] as items,
           min(coalesce(nullif(l.channel_ref, ''), nullif(l.helm_order, ''), l.customer)) as ref,
           min(l.created_at) as created_at,
           case when bool_or(l.status = 'held') then 'held' else 'waiting' end as status
    from dispatch_labels l
    where l.status in ('ready', 'held')
    group by 1
  )
  select e.product_id, e.code, e.name, sum(e.units), o.k, o.ref, o.created_at, o.status
  from o cross join lateral public.inv_expand(o.items) e
  where not exists (select 1 from inv_despatched d where d.order_key = o.k)
  group by e.product_id, e.code, e.name, o.k, o.ref, o.created_at, o.status
$$;

-- ── Taking stock off the shelf ──

-- Takes units of a product: pick shelves first (smallest first, so a shelf
-- empties rather than several running down together), then overflow. If
-- there isn't enough anywhere, the rest comes off the pick shelf and shows
-- below zero, so a count can put it right.
create or replace function public.inv_take(p_product uuid, p_units numeric, p_kind text, p_at timestamptz,
  p_ref text, p_order_key text, p_by text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare r record; left_ numeric := p_units; t numeric; loc text;
begin
  if p_units <= 0 then return; end if;
  for r in
    select b.location, b.qty from inv_balances b join inv_locations l on l.code = b.location
    where b.product_id = p_product and b.qty > 0
    order by l.pickable desc, b.qty asc, b.location
  loop
    t := least(left_, r.qty);
    insert into inv_movements (at, product_id, location, qty, kind, ref, order_key, by_name, note)
    values (p_at, p_product, r.location, -t, p_kind, p_ref, p_order_key, p_by, p_note);
    left_ := left_ - t;
    exit when left_ <= 0;
  end loop;
  if left_ > 0 then
    select b.location into loc from inv_balances b left join inv_locations l on l.code = b.location
    where b.product_id = p_product
    order by (b.location = '') , coalesce(l.pickable, false) desc, b.qty desc limit 1;
    insert into inv_movements (at, product_id, location, qty, kind, ref, order_key, by_name, note)
    values (p_at, p_product, nullif(loc, ''), -left_, p_kind, p_ref, p_order_key, p_by,
            coalesce(p_note || ' · ', '') || 'not enough on the shelf');
  end if;
end $$;

-- An order's labels have all gone: take its units off the shelf, once.
create or replace function public.inv_despatch_order(p_upload uuid, p_key text)
returns void language plpgsql security definer set search_path = public as $$
declare k text := p_upload::text || '|' || p_key;
  items jsonb; gone_at timestamptz; ref text; who text; is_repl boolean; e record; started timestamptz;
begin
  select started_at into started from inv_meta where id = 1;
  if started is null then return; end if;                -- inventory not set up yet
  if exists (select 1 from dispatch_labels where upload_id = p_upload and coalesce(order_key, id::text) = p_key
             and status not in ('dispatched', 'cancelled')) then return; end if;
  if not exists (select 1 from dispatch_labels where upload_id = p_upload and coalesce(order_key, id::text) = p_key
                 and status = 'dispatched') then return; end if;
  insert into inv_despatched (order_key) values (k) on conflict do nothing;
  if not found then return; end if;

  select (array_agg(l.items order by jsonb_array_length(l.items) desc))[1], max(l.dispatched_at),
         min(coalesce(nullif(l.channel_ref, ''), nullif(l.helm_order, ''), l.customer)),
         max(coalesce(l.packer, l.dispatched_by_name)), bool_or(coalesce(l.reason, '') not in ('', 'order'))
    into items, gone_at, ref, who, is_repl
  from dispatch_labels l where l.upload_id = p_upload and coalesce(l.order_key, l.id::text) = p_key and l.status = 'dispatched';

  for e in select x.product_id, x.code, x.name, sum(x.units) as units from public.inv_expand(items) x group by 1, 2, 3 loop
    if e.product_id is null then
      insert into inv_unmatched (code_key, code, name, units, last_seen)
      values (public.inv_norm(e.code), e.code, e.name, e.units, now())
      on conflict (code_key) do update set units = inv_unmatched.units + excluded.units, last_seen = now(), name = excluded.name;
    else
      perform public.inv_take(e.product_id, e.units, 'despatch', coalesce(gone_at, now()), ref, k, who,
                              case when is_repl then 'replacement' end);
      perform public.inv_check_replenish(e.product_id);
    end if;
  end loop;
end $$;

-- A label taken back from dispatched: put the order's units back where they came from
create or replace function public.inv_undo_despatch(p_upload uuid, p_key text)
returns void language plpgsql security definer set search_path = public as $$
declare k text := p_upload::text || '|' || p_key; m record;
begin
  if not exists (select 1 from inv_despatched where order_key = k and counted) then
    delete from inv_despatched where order_key = k; return;
  end if;
  for m in select product_id, location, sum(qty) as qty from inv_movements
           where order_key = k and kind in ('despatch', 'despatch_undo') group by 1, 2 having sum(qty) <> 0 loop
    insert into inv_movements (product_id, location, qty, kind, order_key, note)
    values (m.product_id, m.location, -m.qty, 'despatch_undo', k, 'label taken back from dispatched');
  end loop;
  delete from inv_despatched where order_key = k;
end $$;

create or replace function public.inv_label_changed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status is not distinct from old.status then return null; end if;
  if new.status in ('dispatched', 'cancelled') then
    perform public.inv_despatch_order(new.upload_id, coalesce(new.order_key, new.id::text));
  elsif old.status = 'dispatched' then
    perform public.inv_undo_despatch(new.upload_id, coalesce(new.order_key, new.id::text));
  end if;
  return null;
exception when others then
  -- Stock must never stop a parcel going out; anything missed shows as a difference at the next count
  raise warning 'inventory: %', sqlerrm;
  return null;
end $$;
drop trigger if exists inv_label_status on dispatch_labels;
create trigger inv_label_status after update of status on dispatch_labels
  for each row execute function public.inv_label_changed();

-- ── Sales rates ──

-- Units sold per product per day, from dispatch labels (every channel) and
-- from imported marketplace reports. For each day, whichever recorded more is
-- used, so a day isn't counted twice and an early half-used day of Dispatch
-- doesn't hide a full day in the report.
create or replace function public.inv_daily_units(p_from date, p_to date)
returns table (day date, product_id uuid, units numeric)
language sql stable security definer set search_path = public as $$
  with orders as (
    select (min(l.created_at) at time zone 'Europe/London')::date as day,
           (array_agg(l.items order by jsonb_array_length(l.items) desc))[1] as items
    from dispatch_labels l
    where l.created_at >= (p_from - 1)::timestamp at time zone 'Europe/London'
      and l.created_at < (p_to + 1)::timestamp at time zone 'Europe/London'
    group by l.upload_id, coalesce(l.order_key, l.id::text)
    having bool_or(l.status <> 'cancelled')
  ), d as (
    select o.day, e.product_id, sum(e.units) as units
    from orders o cross join lateral public.inv_expand(o.items) e
    where o.day between p_from and p_to and e.product_id is not null group by 1, 2
  ), c as (
    select s.day, e.product_id, sum(e.units) as units
    from inv_channel_sales s join inv_channel_skus k on k.source = s.source and k.sku = s.sku
    cross join lateral public.inv_expand(k.items, s.units) e
    where s.day between p_from and p_to and e.product_id is not null group by 1, 2
  ), dt as (select day, sum(units) t from d group by 1), ct as (select day, sum(units) t from c group by 1)
  select d.day, d.product_id, d.units from d join dt using (day) left join ct using (day) where dt.t >= coalesce(ct.t, 0)
  union all
  select c.day, c.product_id, c.units from c join ct using (day) left join dt using (day) where ct.t > coalesce(dt.t, 0)
$$;

-- The rate each product sells at: the busier of the last 7 and last 28 days,
-- so it follows sales that are picking up without being fooled by a quiet week.
create or replace function public.inv_refresh_rates() returns void
language plpgsql security definer set search_path = public as $$
declare yday date := (now() at time zone 'Europe/London')::date - 1; first_day date; span int;
begin
  select least(
    (select (min(created_at) at time zone 'Europe/London')::date from dispatch_labels),
    (select min(day) from inv_channel_sales)) into first_day;
  span := greatest(0, least(28, coalesce(yday - first_day + 1, 0)));
  delete from inv_rates where true;   -- the API refuses a DELETE with no WHERE
  insert into inv_rates (product_id, units_7, units_28, days, daily, updated_at)
  select p.id, coalesce(s.u7, 0), coalesce(s.u28, 0), span,
         case when span = 0 then 0
              else greatest(coalesce(s.u28, 0) / span, coalesce(s.u7, 0) / least(7, span)) end, now()
  from inv_products p
  left join (select product_id, sum(units) filter (where day > yday - 7) as u7, sum(units) as u28
             from public.inv_daily_units(yday - 27, yday) group by 1) s on s.product_id = p.id;
  update inv_meta set rates_at = now() where id = 1;
end $$;

create or replace function public.inv_rate_of(p_product uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select p.daily_override from inv_products p where p.id = p_product and p.daily_override is not null
       and (p.override_until is null or p.override_until >= (now() at time zone 'Europe/London')::date)),
    (select daily from inv_rates where product_id = p_product), 0)
$$;

-- ── Replenishment tasks ──

-- When a pick shelf gets low and there's more in overflow, ask the warehouse
-- to bring some down. Low means under 3 days of sales, or under the product's
-- own minimum. Once the shelf is topped up any other way, the task clears.
create or replace function public.inv_check_replenish(p_product uuid)
returns void language plpgsql security definer set search_path = public as $$
declare pick numeric; daily numeric; minp int; threshold numeric; src record; dest text; target numeric; q numeric;
begin
  select coalesce(sum(greatest(b.qty, 0)), 0) into pick from inv_balances b join inv_locations l on l.code = b.location
    where b.product_id = p_product and l.pickable;
  select min_pick into minp from inv_products where id = p_product and active;
  if not found then return; end if;
  daily := public.inv_rate_of(p_product);
  threshold := greatest(coalesce(minp, 0), ceil(daily * 3));

  if pick > threshold then
    update inv_tasks set status = 'cleared', done_at = now(), note = 'Pick shelf topped up'
    where product_id = p_product and status = 'open' and kind = 'replenish';
    return;
  end if;
  if exists (select 1 from inv_tasks where product_id = p_product and status = 'open' and kind = 'replenish') then return; end if;
  -- Someone said it wasn't needed: don't ask again for a day unless the shelf is empty
  if pick > 0 and exists (select 1 from inv_tasks where product_id = p_product and status = 'dismissed'
                          and done_at > now() - interval '1 day') then return; end if;

  -- From the overflow spot with the least in it, so it empties
  select b.location, b.qty into src from inv_balances b join inv_locations l on l.code = b.location
    where b.product_id = p_product and not l.pickable and b.qty > 0 order by b.qty asc, b.location limit 1;
  if not found then return; end if;
  -- Only for products picked from a pick shelf: ones kept only in overflow are picked from there
  select b.location into dest from inv_balances b join inv_locations l on l.code = b.location
    where b.product_id = p_product and l.pickable order by b.qty desc, b.location limit 1;
  if dest is null then return; end if;

  if daily <= 0 and minp is null then
    q := src.qty;                         -- nothing to go on yet: bring it all, the warehouse says what fitted
  else
    target := greatest(ceil(daily * 14), coalesce(minp, 0) * 2, 1) - greatest(pick, 0);
    q := least(src.qty, greatest(target, 1));
  end if;
  if src.qty - q <= greatest(ceil(daily * 2), 2) then q := src.qty; end if;   -- don't leave a few behind

  insert into inv_tasks (product_id, from_location, to_location, qty, why)
  values (p_product, src.location, dest, q,
          case when pick <= 0 then 'Pick shelf is empty'
               else trim(to_char(pick, 'FM999999')) || ' left on the pick shelf'
                    || case when daily <= 0 then ''
                            when pick / daily < 1 then ', less than a day of sales'
                            when floor(pick / daily) = 1 then ', about 1 day of sales'
                            else ', about ' || floor(pick / daily)::int || ' days of sales' end end);
end $$;

create or replace function public.inv_check_all() returns void
language plpgsql security definer set search_path = public as $$
declare p uuid;
begin
  for p in select id from inv_products where active loop perform public.inv_check_replenish(p); end loop;
end $$;

-- ── Everything for the Inventory page in one go ──

create or replace function public.inv_overview() returns jsonb
language plpgsql security definer set search_path = public as $$
declare res jsonb; m inv_meta%rowtype;
begin
  if not public.is_active_user() then raise exception 'Not allowed'; end if;
  select * into m from inv_meta where id = 1;
  if m.started_at is not null and (m.rates_at is null or m.rates_at < now() - interval '30 minutes') then
    perform public.inv_refresh_rates();
    select * into m from inv_meta where id = 1;
  end if;

  with open_u as (select * from public.inv_open_order_units()),
  alloc as (select product_id, sum(units) as units, count(distinct order_key) as orders from open_u where product_id is not null group by 1),
  bal as (
    select b.product_id,
           sum(b.qty) as on_hand,
           sum(b.qty) filter (where l.pickable) as pick,
           sum(b.qty) filter (where l.code is not null and not l.pickable) as overflow,
           sum(b.qty) filter (where b.location = '') as nowhere,
           jsonb_agg(jsonb_build_object('code', b.location, 'qty', b.qty, 'pickable', coalesce(l.pickable, false))
                     order by coalesce(l.pickable, false) desc, b.location) filter (where b.location <> '') as locations
    from inv_balances b left join inv_locations l on l.code = b.location group by 1
  ),
  onorder as (
    select p.id as product_id, sum(greatest(i.qty - coalesce(i.qty_received, 0), 0)) as units
    from inv_products p
    join purchase_order_items i on i.stock_item_id = p.stock_item_id
    join purchase_orders po on po.id = i.po_id
    where p.stock_item_id is not null and coalesce(po.kind, 'order') <> 'credit_note'
      and po.status not in ('draft', 'cancelled', 'received', 'completed') and coalesce(i.line_status, 'due') <> 'cancelled'
    group by 1
  ),
  req as (
    select distinct on (p.id) p.id as product_id, r.id, r.ref, r.status, r.qty_requested
    from inv_products p join stock_requests r
      on (public.inv_norm(r.helm_sku) = p.code_key or (p.stock_item_id is not null and r.stock_item_id = p.stock_item_id))
    where r.status in ('raised', 'acknowledged', 'ordered')
      and not (r.status = 'ordered' and exists (select 1 from purchase_order_items i where i.id = r.po_item_id
                                                and coalesce(i.qty_received, 0) >= i.qty))
    order by p.id, r.created_at desc
  ),
  lead as (
    select p.id as product_id,
           coalesce(p.lead_days,
             ceil(nullif(regexp_replace(coalesce(s.data ->> 'leadDays', ''), '[^0-9]', '', 'g'), '')::numeric * 7 / 5)::int,
             7) as days,
           (p.lead_days is not null or (s.data ->> 'leadDays') ~ '\d') as known
    from inv_products p
    left join stock_items si on si.id = p.stock_item_id
    left join lateral (select x.data from suppliers x where lower(x.name) = lower(si.data ->> 'supplierName')
                       order by x.created_at limit 1) s on true
  )
  select jsonb_build_object(
    'meta', jsonb_build_object('counted_at', m.counted_at, 'started_at', m.started_at, 'rates_at', m.rates_at),
    'products', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.id, 'code', p.code, 'name', p.name, 'in_helm', p.in_helm or exists (
            select 1 from dispatch_item_units u where u.code_key = p.code_key and u.source = 'helm'),
        'stock_item_id', p.stock_item_id, 'min_pick', p.min_pick, 'daily_override', p.daily_override,
        'override_until', p.override_until, 'lead_days', p.lead_days, 'note', p.note, 'active', p.active,
        'on_hand', coalesce(b.on_hand, 0), 'pick', coalesce(b.pick, 0), 'overflow', coalesce(b.overflow, 0),
        'nowhere', coalesce(b.nowhere, 0), 'locations', coalesce(b.locations, '[]'::jsonb),
        'open_orders', coalesce(a.units, 0), 'open_order_count', coalesce(a.orders, 0),
        'available', coalesce(b.on_hand, 0) - coalesce(a.units, 0),
        'units_7', coalesce(r.units_7, 0), 'units_28', coalesce(r.units_28, 0), 'rate_days', coalesce(r.days, 0),
        'daily', public.inv_rate_of(p.id), 'on_order', coalesce(oo.units, 0),
        'lead', ld.days, 'lead_known', ld.known,
        'request', case when rq.id is not null then jsonb_build_object('id', rq.id, 'ref', rq.ref, 'status', rq.status, 'qty', rq.qty_requested) end
      ) order by p.name)
      from inv_products p
      left join bal b on b.product_id = p.id
      left join alloc a on a.product_id = p.id
      left join inv_rates r on r.product_id = p.id
      left join onorder oo on oo.product_id = p.id
      left join req rq on rq.product_id = p.id
      left join lead ld on ld.product_id = p.id
      where p.active), '[]'::jsonb),
    'locations', coalesce((select jsonb_agg(jsonb_build_object('code', l.code, 'pickable', l.pickable, 'note', l.note)
        order by split_part(l.code, '-', 1), split_part(l.code, '-', 2)::int, split_part(l.code, '-', 3)::int, split_part(l.code, '-', 4)::int)
      from inv_locations l), '[]'::jsonb),
    'tasks', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'ref', t.ref, 'kind', t.kind, 'product_id', t.product_id,
        'product_name', p.name, 'product_code', p.code, 'from_location', t.from_location, 'to_location', t.to_location,
        'qty', t.qty, 'why', t.why, 'status', t.status, 'created_at', t.created_at, 'done_at', t.done_at,
        'done_by', t.done_by, 'moved', t.moved, 'note', t.note) order by t.created_at desc)
      from inv_tasks t join inv_products p on p.id = t.product_id
      where t.status = 'open' or t.done_at > now() - interval '3 days'), '[]'::jsonb),
    'unmatched_open', coalesce((select jsonb_agg(jsonb_build_object('code', code, 'name', name, 'units', units, 'orders', n))
      from (select code, min(name) as name, sum(units) as units, count(distinct order_key) as n
            from open_u where product_id is null group by code) x), '[]'::jsonb),
    'unmatched_sold', coalesce((select jsonb_agg(to_jsonb(u) order by u.last_seen desc) from inv_unmatched u
      where u.last_seen > now() - interval '60 days'
        and not exists (select 1 from public.inv_expand(jsonb_build_array(jsonb_build_object('code', u.code, 'qty', 1))) e
                        where e.product_id is not null)), '[]'::jsonb)
  ) into res;
  return res;
end $$;
grant execute on function public.inv_overview() to authenticated;

-- The open orders holding one product's stock
create or replace function public.inv_product_orders(p_product uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('ref', ref, 'units', units, 'created_at', created_at, 'status', status)
                            order by created_at), '[]'::jsonb)
  from public.inv_open_order_units() where product_id = p_product and public.is_active_user()
$$;
grant execute on function public.inv_product_orders(uuid) to authenticated;

-- Units out per product per day, from what was taken off the shelf
create or replace function public.inv_despatch_days(p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('day', day, 'product_id', product_id, 'code', code, 'name', name,
           'units', units, 'orders', orders, 'replacements', repl) order by day desc, units desc), '[]'::jsonb)
  from (
    select (m.at at time zone 'Europe/London')::date as day, p.id as product_id, p.code, p.name,
           -sum(m.qty) as units, count(distinct m.order_key) filter (where m.kind = 'despatch') as orders,
           -coalesce(sum(m.qty) filter (where m.note like 'replacement%'), 0) as repl
    from inv_movements m join inv_products p on p.id = m.product_id
    where m.kind in ('despatch', 'despatch_undo') and public.is_active_user()
      and m.at >= p_from::timestamp at time zone 'Europe/London' and m.at < (p_to + 1)::timestamp at time zone 'Europe/London'
    group by 1, 2, 3, 4 having sum(m.qty) <> 0
  ) x
$$;
grant execute on function public.inv_despatch_days(date, date) to authenticated;

-- ── Changing stock (every change has a name and, for manual ones, a reason) ──

create or replace function public.inv_ensure_location(p_code text, p_pickable boolean, p_by text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.inv_valid_location(p_code) then
    raise exception '% isn''t a shelf — use Aisle-Bay-Shelf-Section, e.g. A-10-0-1', coalesce(p_code, 'That');
  end if;
  insert into inv_locations (code, pickable, updated_by) values (p_code, coalesce(p_pickable, false), p_by)
  on conflict (code) do update set pickable = coalesce(p_pickable, inv_locations.pickable),
    updated_by = case when p_pickable is not null and p_pickable <> inv_locations.pickable then p_by else inv_locations.updated_by end;
end $$;

create or replace function public.inv_save_location(p_code text, p_pickable boolean, p_note text, p_by text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.inv_can_edit() or public.can_open('tasks')) then raise exception 'Not allowed'; end if;
  perform public.inv_ensure_location(p_code, p_pickable, p_by);
  update inv_locations set note = nullif(trim(coalesce(p_note, '')), '') where code = p_code;
  -- A shelf turned into overflow lets go of products with nothing on it
  delete from inv_balances b where b.location = p_code and b.qty = 0 and not coalesce(p_pickable, true);
  perform public.inv_check_replenish(b.product_id) from inv_balances b where b.location = p_code;
end $$;
grant execute on function public.inv_save_location(text, boolean, text, text) to authenticated;

-- Move stock between shelves. Can't move more than is there.
create or replace function public.inv_move(p_product uuid, p_from text, p_to text, p_qty numeric, p_by text,
  p_note text default null, p_to_pickable boolean default null, p_task uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare have numeric; g uuid := gen_random_uuid(); tk text;
begin
  if not (public.inv_can_edit() or public.can_open('tasks')) then raise exception 'Not allowed'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'Enter how many to move'; end if;
  if p_from = p_to then raise exception 'Pick a different shelf to move it to'; end if;
  perform public.inv_ensure_location(p_to, p_to_pickable, p_by);
  select coalesce(qty, 0) into have from inv_balances where product_id = p_product and location = coalesce(p_from, '');
  if coalesce(have, 0) < p_qty then
    raise exception 'Only % on %', coalesce(have, 0), coalesce(p_from, 'no shelf');
  end if;
  if p_task is not null then select ref into tk from inv_tasks where id = p_task; end if;
  insert into inv_movements (product_id, location, qty, kind, note, group_id, by_name, ref, ref_id)
  values (p_product, nullif(p_from, ''), -p_qty, 'move', coalesce(p_note, 'to ' || p_to), g, p_by, tk, p_task),
         (p_product, p_to, p_qty, 'move', coalesce(p_note, 'from ' || coalesce(nullif(p_from, ''), 'no shelf')), g, p_by, tk, p_task);
  if p_task is not null then
    update inv_tasks set status = 'done', moved = p_qty, done_at = now(), done_by = p_by,
      to_location = p_to, note = nullif(p_note, '') where id = p_task and status = 'open';
  end if;
  perform public.inv_check_replenish(p_product);
end $$;
grant execute on function public.inv_move(uuid, text, text, numeric, text, text, boolean, uuid) to authenticated;

-- Add or remove by hand, with the reason it isn't going through Goods In or Dispatch
create or replace function public.inv_adjust(p_product uuid, p_location text, p_qty numeric, p_reason text,
  p_note text, p_by text, p_pickable boolean default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.inv_can_edit() then raise exception 'Not allowed'; end if;
  if p_qty is null or p_qty = 0 then raise exception 'Enter how many'; end if;
  if p_qty < 0 and not public.sees_costs() then raise exception 'Only the office can remove stock'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Say why it''s being changed by hand'; end if;
  if coalesce(trim(p_by), '') = '' then raise exception 'Say who''s doing it'; end if;
  if p_location is not null and p_location <> '' then perform public.inv_ensure_location(p_location, p_pickable, p_by); end if;
  insert into inv_movements (product_id, location, qty, kind, reason, note, by_name)
  values (p_product, nullif(p_location, ''), p_qty, case when p_qty > 0 then 'add' else 'remove' end,
          p_reason, nullif(trim(coalesce(p_note, '')), ''), p_by);
  perform public.inv_check_replenish(p_product);
end $$;
grant execute on function public.inv_adjust(uuid, text, numeric, text, text, text, boolean) to authenticated;

-- Counted a shelf: set it to what's really there
create or replace function public.inv_set_count(p_product uuid, p_location text, p_counted numeric, p_note text, p_by text)
returns numeric language plpgsql security definer set search_path = public as $$
declare have numeric; diff numeric;
begin
  if not public.inv_can_edit() then raise exception 'Not allowed'; end if;
  if p_counted is null or p_counted < 0 then raise exception 'Enter what you counted'; end if;
  if coalesce(trim(p_by), '') = '' then raise exception 'Say who counted it'; end if;
  perform public.inv_ensure_location(p_location, null, p_by);
  select coalesce(qty, 0) into have from inv_balances where product_id = p_product and location = p_location;
  diff := p_counted - coalesce(have, 0);
  if diff < 0 and not public.sees_costs() and coalesce(trim(p_note), '') = '' then
    raise exception 'Say why there are fewer than recorded'; end if;
  if diff <> 0 then
    insert into inv_movements (product_id, location, qty, kind, reason, note, by_name)
    values (p_product, p_location, diff, 'count', 'Counted', nullif(trim(coalesce(p_note, '')), ''), p_by);
  end if;
  insert into inv_balances (product_id, location, qty) values (p_product, p_location, 0) on conflict do nothing;
  perform public.inv_check_replenish(p_product);
  return diff;
end $$;
grant execute on function public.inv_set_count(uuid, text, numeric, text, text) to authenticated;

-- Give a product a pick shelf (or take an empty one away)
create or replace function public.inv_assign(p_product uuid, p_location text, p_assign boolean, p_by text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.inv_can_edit() then raise exception 'Not allowed'; end if;
  if p_assign then
    perform public.inv_ensure_location(p_location, true, p_by);
    insert into inv_balances (product_id, location, qty) values (p_product, p_location, 0) on conflict do nothing;
  else
    delete from inv_balances where product_id = p_product and location = p_location and qty = 0;
  end if;
  perform public.inv_check_replenish(p_product);
end $$;
grant execute on function public.inv_assign(uuid, text, boolean, text) to authenticated;

-- Add or change a product
create or replace function public.inv_save_product(p_id uuid, p jsonb, p_by text)
returns uuid language plpgsql security definer set search_path = public as $$
declare rid uuid;
begin
  if not (public.inv_can_edit() or public.can_open('goods-in')) then raise exception 'Not allowed'; end if;
  if p_id is null then
    if coalesce(trim(p ->> 'code'), '') = '' or coalesce(trim(p ->> 'name'), '') = '' then
      raise exception 'A product needs a code and a name'; end if;
    if exists (select 1 from inv_products where code_key = public.inv_norm(p ->> 'code')) then
      raise exception 'There''s already a product with code %', p ->> 'code'; end if;
    insert into inv_products (code, name, in_helm, stock_item_id, created_by)
    values (upper(trim(p ->> 'code')), trim(p ->> 'name'), coalesce((p ->> 'in_helm')::boolean, false),
            nullif(p ->> 'stock_item_id', '')::uuid, p_by)
    returning id into rid;
    return rid;
  end if;
  if not public.inv_can_edit() then raise exception 'Not allowed'; end if;
  update inv_products set
    code = case when p ? 'code' and trim(p ->> 'code') <> '' then upper(trim(p ->> 'code')) else code end,
    name = case when p ? 'name' and trim(p ->> 'name') <> '' then trim(p ->> 'name') else name end,
    in_helm = case when p ? 'in_helm' then (p ->> 'in_helm')::boolean else in_helm end,
    stock_item_id = case when p ? 'stock_item_id' then nullif(p ->> 'stock_item_id', '')::uuid else stock_item_id end,
    min_pick = case when p ? 'min_pick' then nullif(p ->> 'min_pick', '')::int else min_pick end,
    daily_override = case when p ? 'daily_override' then nullif(p ->> 'daily_override', '')::numeric else daily_override end,
    override_until = case when p ? 'override_until' then nullif(p ->> 'override_until', '')::date else override_until end,
    lead_days = case when p ? 'lead_days' then nullif(p ->> 'lead_days', '')::int else lead_days end,
    note = case when p ? 'note' then nullif(p ->> 'note', '') else note end,
    active = case when p ? 'active' then (p ->> 'active')::boolean else active end
  where id = p_id;
  perform public.inv_check_replenish(p_id);
  return p_id;
end $$;
grant execute on function public.inv_save_product(uuid, jsonb, text) to authenticated;

create or replace function public.inv_dismiss_task(p_task uuid, p_note text, p_by text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.inv_can_edit() or public.can_open('tasks')) then raise exception 'Not allowed'; end if;
  update inv_tasks set status = 'dismissed', done_at = now(), done_by = p_by, note = nullif(trim(coalesce(p_note, '')), '')
  where id = p_task and status = 'open';
end $$;
grant execute on function public.inv_dismiss_task(uuid, text, text) to authenticated;

-- ── Goods in: putting a delivery away ──

-- What each line of a delivery probably is, and where that product lives
create or replace function public.inv_put_away_plan(p_delivery uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'i', l.n, 'name', l.line ->> 'name', 'po_item_id', l.line ->> 'po_item_id', 'stock_item_id', i.stock_item_id,
      'units', greatest(coalesce(nullif(l.line ->> 'arrived', '')::numeric, nullif(l.line ->> 'qty', '')::numeric, 0)
                        - coalesce(nullif(l.line ->> 'damaged', '')::numeric, 0), 0),
      'product_id', coalesce(
         (select a.product_id from inv_aliases a where a.key = 'si:' || i.stock_item_id),
         (select p.id from inv_products p where p.stock_item_id = i.stock_item_id and p.active limit 1),
         (select a.product_id from inv_aliases a where a.key = 'name:' || public.inv_norm(l.line ->> 'name')),
         (select p.id from inv_products p where public.inv_norm(p.name) = public.inv_norm(l.line ->> 'name') and p.active limit 1))
    ) order by l.n), '[]'::jsonb)
  from goods_in_deliveries d
  cross join lateral jsonb_array_elements(d.lines) with ordinality as l(line, n)
  left join purchase_order_items i on i.id = nullif(l.line ->> 'po_item_id', '')::uuid
  where d.id = p_delivery and (public.can_open('goods-in') or public.inv_can_edit())
$$;
grant execute on function public.inv_put_away_plan(uuid) to authenticated;

-- lines: [{name, stock_item_id, product_id, location, pickable, units, skip}]
-- A line can be split across shelves by sending it more than once.
create or replace function public.inv_put_away(p_delivery uuid, p_lines jsonb, p_by text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d goods_in_deliveries%rowtype; l jsonb; n int := 0; u numeric := 0; pid uuid;
begin
  if not (public.can_open('goods-in') or public.inv_can_edit()) then raise exception 'Not allowed'; end if;
  if coalesce(trim(p_by), '') = '' then raise exception 'Say who put it away'; end if;
  select * into d from goods_in_deliveries where id = p_delivery for update;
  if not found then raise exception 'Delivery not found'; end if;
  if d.put_away_at is not null then raise exception '% has already been put away', d.ref; end if;

  for l in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    if (l ->> 'skip')::boolean is true then continue; end if;
    pid := nullif(l ->> 'product_id', '')::uuid;
    if pid is null then raise exception 'Choose the product for %', l ->> 'name'; end if;
    if coalesce((l ->> 'units')::numeric, 0) <= 0 then continue; end if;
    perform public.inv_ensure_location(l ->> 'location', nullif(l ->> 'pickable', '')::boolean, p_by);
    insert into inv_movements (product_id, location, qty, kind, ref, ref_id, note, by_name)
    values (pid, l ->> 'location', (l ->> 'units')::numeric, 'goods_in', d.ref, d.id,
            nullif(concat_ws(' · ', d.data ->> 'po_number', d.supplier_name), ''), p_by);
    n := n + 1; u := u + (l ->> 'units')::numeric;
    -- Remember what this line is, for next time
    if nullif(l ->> 'stock_item_id', '') is not null then
      insert into inv_aliases (key, product_id) values ('si:' || (l ->> 'stock_item_id'), pid)
      on conflict (key) do update set product_id = excluded.product_id, updated_at = now();
      update inv_products set stock_item_id = (l ->> 'stock_item_id')::uuid where id = pid and stock_item_id is null;
    end if;
    if coalesce(l ->> 'name', '') <> '' then
      insert into inv_aliases (key, product_id) values ('name:' || public.inv_norm(l ->> 'name'), pid)
      on conflict (key) do update set product_id = excluded.product_id, updated_at = now();
    end if;
    perform public.inv_check_replenish(pid);
  end loop;

  update goods_in_deliveries set put_away_at = now(), put_away_by = p_by,
    data = data || jsonb_build_object('put_away', p_lines) where id = p_delivery;
  insert into activity_log (entity_type, entity_id, entity_name, action, detail, user_name, source)
  values ('delivery', d.id, d.ref, 'Put away', u || ' units onto ' || n || ' shelf' || case when n = 1 then '' else 'es' end, p_by, 'inventory');
  return jsonb_build_object('lines', n, 'units', u);
end $$;
grant execute on function public.inv_put_away(uuid, jsonb, text) to authenticated;

-- ── Imports ──

-- A stock count, as rows: [{location, pickable, code, name, in_helm, qty}].
-- The first one is the opening stock, dated when the count was taken; orders
-- dispatched after that are then taken off, and everything dispatched before
-- it is marked as already counted. Later counts set each listed shelf to what
-- was counted.
create or replace function public.inv_import_count(p_rows jsonb, p_counted_at timestamptz, p_by text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb; pid uuid; opening boolean; have numeric; diff numeric; n int := 0; units numeric := 0;
  o record; caught int := 0; prior int := 0;
begin
  if not public.sees_costs() then raise exception 'Only the office can import a stock count'; end if;
  if p_counted_at is null then raise exception 'Say when the count was taken'; end if;
  opening := (select started_at is null from inv_meta where id = 1);

  -- Shelves: pickable if any row says so
  insert into inv_locations (code, pickable, updated_by)
  select x ->> 'location', bool_or(coalesce((x ->> 'pickable')::boolean, false)), p_by
  from jsonb_array_elements(p_rows) x group by 1
  on conflict (code) do update set pickable = inv_locations.pickable or excluded.pickable;

  for r in select * from jsonb_array_elements(p_rows) loop
    insert into inv_products (code, name, in_helm, created_by)
    values (upper(trim(r ->> 'code')), trim(r ->> 'name'), coalesce((r ->> 'in_helm')::boolean, true), p_by)
    on conflict (code_key) do update set name = case when inv_products.in_helm then inv_products.name else excluded.name end,
      in_helm = inv_products.in_helm or excluded.in_helm
    returning id into pid;
    select qty into have from inv_balances where product_id = pid and location = r ->> 'location';
    diff := coalesce((r ->> 'qty')::numeric, 0) - coalesce(have, 0);
    if diff <> 0 then
      insert into inv_movements (at, product_id, location, qty, kind, reason, by_name, note)
      values (case when opening then p_counted_at else now() end, pid, r ->> 'location', diff,
              case when opening then 'opening' else 'count' end, case when opening then 'Opening count' else 'Stock count' end,
              p_by, 'counted ' || to_char(p_counted_at at time zone 'Europe/London', 'DD Mon YYYY HH24:MI'));
    end if;
    insert into inv_balances (product_id, location, qty) values (pid, r ->> 'location', 0) on conflict do nothing;
    n := n + 1; units := units + coalesce((r ->> 'qty')::numeric, 0);
  end loop;

  if opening then
    update inv_meta set counted_at = p_counted_at, started_at = now(), updated_by = p_by where id = 1;
    -- Orders that went before the count were already off the shelf; ones after come off now
    for o in
      select l.upload_id, coalesce(l.order_key, l.id::text) as k, max(l.dispatched_at) as gone
      from dispatch_labels l group by 1, 2
      having bool_and(l.status in ('dispatched', 'cancelled')) and bool_or(l.status = 'dispatched')
    loop
      if o.gone > p_counted_at then
        perform public.inv_despatch_order(o.upload_id, o.k); caught := caught + 1;
      else
        insert into inv_despatched (order_key, at, counted) values (o.upload_id::text || '|' || o.k, o.gone, false)
        on conflict do nothing;
        prior := prior + 1;
      end if;
    end loop;
    perform public.inv_refresh_rates();
  end if;
  perform public.inv_check_all();
  return jsonb_build_object('rows', n, 'units', units, 'opening', opening, 'orders_taken_off', caught, 'orders_before', prior);
end $$;
grant execute on function public.inv_import_count(jsonb, timestamptz, text) to authenticated;

-- Marketplace sales: rows [{day, sku, units}] and what each SKU is
-- skus: [{sku, title, items:[{code, qty}], how}]. Re-importing a day replaces it.
create or replace function public.inv_import_sales(p_source text, p_rows jsonb, p_skus jsonb, p_by text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.sees_costs() then raise exception 'Only the office can import sales history'; end if;
  delete from inv_channel_sales where source = p_source
    and day in (select distinct (x ->> 'day')::date from jsonb_array_elements(p_rows) x);
  insert into inv_channel_sales (source, day, sku, units)
  select p_source, (x ->> 'day')::date, x ->> 'sku', sum((x ->> 'units')::numeric)
  from jsonb_array_elements(p_rows) x group by 2, 3;
  get diagnostics n = row_count;
  insert into inv_channel_skus (source, sku, title, items, how, updated_by)
  select p_source, s ->> 'sku', s ->> 'title', coalesce(s -> 'items', '[]'::jsonb), s ->> 'how', p_by
  from jsonb_array_elements(coalesce(p_skus, '[]'::jsonb)) s
  on conflict (source, sku) do update set title = coalesce(excluded.title, inv_channel_skus.title),
    items = case when jsonb_array_length(excluded.items) > 0 or inv_channel_skus.how is distinct from 'person'
                 then excluded.items else inv_channel_skus.items end,
    how = case when jsonb_array_length(excluded.items) > 0 or inv_channel_skus.how is distinct from 'person'
               then excluded.how else inv_channel_skus.how end,
    updated_by = excluded.updated_by, updated_at = now();
  perform public.inv_refresh_rates();
  perform public.inv_check_all();
  return jsonb_build_object('rows', n);
end $$;
grant execute on function public.inv_import_sales(text, jsonb, jsonb, text) to authenticated;

-- Set what one SKU is, by hand
create or replace function public.inv_save_sku(p_source text, p_sku text, p_items jsonb, p_by text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.sees_costs() then raise exception 'Not allowed'; end if;
  insert into inv_channel_skus (source, sku, items, how, updated_by) values (p_source, p_sku, coalesce(p_items, '[]'::jsonb), 'person', p_by)
  on conflict (source, sku) do update set items = excluded.items, how = 'person', updated_by = p_by, updated_at = now();
  update inv_meta set rates_at = null where id = 1;
end $$;
grant execute on function public.inv_save_sku(text, text, jsonb, text) to authenticated;

-- Which dispatched orders match marketplace order numbers: their slip items, by order number
create or replace function public.inv_orders_by_ref(p_refs text[]) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(r, items), '{}'::jsonb) from (
    select distinct on (public.inv_norm(l.channel_ref)) public.inv_norm(l.channel_ref) as r, l.items
    from dispatch_labels l
    where public.inv_norm(l.channel_ref) = any (p_refs) and jsonb_array_length(l.items) > 0 and public.sees_costs()
    order by public.inv_norm(l.channel_ref), l.created_at desc
  ) x
$$;
grant execute on function public.inv_orders_by_ref(text[]) to authenticated;

-- HELM item codes and names, for matching SKUs by hand
create or replace function public.inv_helm_items() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('code', code, 'name', name, 'components', components) order by name), '[]'::jsonb)
  from dispatch_item_units where public.is_active_user()
$$;
grant execute on function public.inv_helm_items() to authenticated;

create index if not exists dispatch_labels_channel_norm_idx on dispatch_labels (public.inv_norm(channel_ref));


-- ── Inventory: damages, daily cycle counts, stock value and slow stock ─────
-- Damages: the warehouse reports damaged stock with a reason (and a photo);
-- the units come off the shelf into "damaged" straight away, and the office
-- decides: write off, send back to the supplier, or put back on a shelf.
-- Cycle counts: a few shelves to count every day, so stock stays right
-- without a full stock-take. Value and slow stock: office only.

alter table inv_movements drop constraint if exists inv_movements_kind_check;
alter table inv_movements add constraint inv_movements_kind_check check (kind in
  ('opening', 'count', 'goods_in', 'move', 'add', 'remove', 'despatch', 'despatch_undo', 'damage', 'damage_restock'));

-- ── Damages ──

create sequence if not exists inv_damage_seq;
create table if not exists inv_damages (
  id uuid primary key default gen_random_uuid(),
  ref text unique not null default ('DM-' || lpad(nextval('inv_damage_seq')::text, 4, '0')),
  product_id uuid not null references inv_products(id) on delete cascade,
  location text,
  qty numeric not null check (qty > 0),
  reason text not null,
  note text,
  photo_path text,
  reported_by text not null,
  reported_at timestamptz not null default now(),
  status text not null default 'open',           -- open | written_off | returned | restocked
  resolved_by text, resolved_at timestamptz, resolution_note text, restock_location text
);
create index if not exists inv_damages_status_idx on inv_damages(status, reported_at desc);
create index if not exists inv_damages_product_idx on inv_damages(product_id);
alter table inv_damages enable row level security;
drop policy if exists "Read inventory" on inv_damages;
create policy "Read inventory" on inv_damages for select to authenticated using (public.is_active_user());

-- Damage photos go with the Goods In photos; anyone in Inventory can add and see them
drop policy if exists "Goods in read photos" on storage.objects;
drop policy if exists "Goods in add photos" on storage.objects;
create policy "Goods in read photos" on storage.objects for select to authenticated
  using (bucket_id = 'goods-in-photos' and (public.can_open('goods-in') or public.can_open('inventory') or public.sees_costs()));
create policy "Goods in add photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'goods-in-photos' and (public.can_open('goods-in') or public.can_open('inventory') or public.sees_costs()));

create or replace function public.inv_report_damage(p_product uuid, p_location text, p_qty numeric, p_reason text,
  p_note text, p_photo text, p_by text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare have numeric; d inv_damages%rowtype;
begin
  if not (public.inv_can_edit() or public.can_open('tasks')) then raise exception 'Not allowed'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'Enter how many are damaged'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Choose what happened'; end if;
  if p_reason = 'Other' and coalesce(trim(p_note), '') = '' then raise exception 'Say what happened'; end if;
  if coalesce(trim(p_by), '') = '' then raise exception 'Say who''s reporting it'; end if;
  select coalesce(qty, 0) into have from inv_balances where product_id = p_product and location = coalesce(p_location, '');
  if coalesce(have, 0) < p_qty then
    raise exception 'Only % on % — count the shelf first if that''s wrong', coalesce(have, 0), coalesce(nullif(p_location, ''), 'no shelf');
  end if;
  insert into inv_damages (product_id, location, qty, reason, note, photo_path, reported_by)
  values (p_product, nullif(p_location, ''), p_qty, p_reason, nullif(trim(coalesce(p_note, '')), ''), nullif(p_photo, ''), p_by)
  returning * into d;
  insert into inv_movements (product_id, location, qty, kind, reason, note, ref, ref_id, by_name)
  values (p_product, nullif(p_location, ''), -p_qty, 'damage', p_reason, d.note, d.ref, d.id, p_by);
  perform public.inv_check_replenish(p_product);
  return jsonb_build_object('id', d.id, 'ref', d.ref);
end $$;
grant execute on function public.inv_report_damage(uuid, text, numeric, text, text, text, text) to authenticated;

-- The office decides what happens to damaged stock
create or replace function public.inv_resolve_damage(p_id uuid, p_action text, p_location text, p_note text, p_by text)
returns void language plpgsql security definer set search_path = public as $$
declare d inv_damages%rowtype;
begin
  if not public.sees_costs() then raise exception 'Only the office can decide what happens to damaged stock'; end if;
  select * into d from inv_damages where id = p_id for update;
  if not found then raise exception 'Damage report not found'; end if;
  if d.status <> 'open' then raise exception '% has already been dealt with', d.ref; end if;
  if p_action not in ('written_off', 'returned', 'restocked') then raise exception 'Choose what to do with it'; end if;
  if p_action = 'restocked' then
    perform public.inv_ensure_location(p_location, null, p_by);
    insert into inv_movements (product_id, location, qty, kind, reason, note, ref, ref_id, by_name)
    values (d.product_id, p_location, d.qty, 'damage_restock', 'Fine to sell', nullif(trim(coalesce(p_note, '')), ''), d.ref, d.id, p_by);
    perform public.inv_check_replenish(d.product_id);
  end if;
  update inv_damages set status = p_action, resolved_by = p_by, resolved_at = now(),
    resolution_note = nullif(trim(coalesce(p_note, '')), ''), restock_location = case when p_action = 'restocked' then p_location end
  where id = p_id;
end $$;
grant execute on function public.inv_resolve_damage(uuid, text, text, text, text) to authenticated;

-- ── Daily cycle counts ──

alter table inv_meta add column if not exists count_per_day int not null default 12;
alter table inv_meta add column if not exists counts_planned date;
alter table inv_tasks alter column product_id drop not null;
alter table inv_tasks add column if not exists result jsonb;

-- Each day, pick the shelves most worth counting: not counted for longest,
-- fast sellers on them, something gone wrong there lately. Shelves counted in
-- the last two weeks (or loaded today) are left alone, and so are empty ones. Counts not done roll over to the next day.
create or replace function public.inv_plan_counts() returns void
language plpgsql security definer set search_path = public as $$
declare today date := (now() at time zone 'Europe/London')::date; m inv_meta%rowtype; want int;
begin
  select * into m from inv_meta where id = 1 for update;
  if m.started_at is null or m.counts_planned = today then return; end if;
  update inv_meta set counts_planned = today where id = 1;
  want := greatest(0, m.count_per_day - (select count(*) from inv_tasks where kind = 'count' and status = 'open'));
  if want = 0 then return; end if;
  insert into inv_tasks (kind, from_location, why)
  select 'count', s.location,
         case when s.trouble then 'Something didn’t add up here lately'
              when s.last_counted is null then 'Not counted since the opening count'
              else 'Last counted ' || (today - s.last_counted) || ' days ago' end
  from (
    select b.location,
      (select max((m2.at at time zone 'Europe/London')::date) from inv_movements m2
         where m2.location = b.location and m2.kind = 'count') as last_counted,
      (select max((m2.at at time zone 'Europe/London')::date) from inv_movements m2
         where m2.location = b.location and m2.kind in ('count', 'opening')) as last_seen,
      bool_or(b.qty < 0) or exists (select 1 from inv_movements m3 where m3.location = b.location
         and m3.at > now() - interval '14 days' and (m3.kind in ('add', 'remove') or m3.note like '%not enough on the shelf%')) as trouble,
      sum(coalesce(r.daily, 0)) as speed, sum(b.qty) as stock
    from inv_balances b
    left join inv_rates r on r.product_id = b.product_id
    where b.location <> ''
    group by b.location
  ) s
  where (s.trouble or (s.stock > 0 and coalesce(s.last_counted, today - 365) <= today - 14 and s.last_seen is distinct from today))
    and not exists (select 1 from inv_tasks t where t.kind = 'count' and t.status = 'open' and t.from_location = s.location)
  order by (case when s.trouble then 40 else 0 end)
           + least(today - coalesce(s.last_counted, s.last_seen, today - 60), 60)
           + least(s.speed, 50) / 2 desc, s.location
  limit want;
end $$;

-- Count a whole shelf. counts: [{product_id, counted}] — including anything
-- found there that wasn't recorded. A shelf that comes out lower needs a note
-- from the warehouse.
create or replace function public.inv_count_shelf(p_location text, p_counts jsonb, p_note text, p_by text, p_task uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c jsonb; have numeric; diff numeric; diffs int := 0; n int := 0; out_ jsonb := '[]'::jsonb; pid uuid; counted numeric;
begin
  if not (public.inv_can_edit() or public.can_open('tasks')) then raise exception 'Not allowed'; end if;
  if coalesce(trim(p_by), '') = '' then raise exception 'Say who counted it'; end if;
  perform public.inv_ensure_location(p_location, null, p_by);
  if not public.sees_costs() and coalesce(trim(p_note), '') = '' and exists (
    select 1 from jsonb_array_elements(p_counts) x
    where (x ->> 'counted')::numeric < coalesce((select qty from inv_balances where product_id = (x ->> 'product_id')::uuid and location = p_location), 0)
  ) then raise exception 'Some came out lower than recorded — say why in the note'; end if;

  if exists (select 1 from inv_balances b where b.location = p_location and b.qty <> 0
             and b.product_id not in (select (x ->> 'product_id')::uuid from jsonb_array_elements(coalesce(p_counts, '[]'::jsonb)) x)) then
    raise exception 'Every product recorded on % needs a count (0 if none)', p_location;
  end if;

  for c in select * from jsonb_array_elements(coalesce(p_counts, '[]'::jsonb)) loop
    pid := (c ->> 'product_id')::uuid; counted := (c ->> 'counted')::numeric;
    if counted is null or counted < 0 then raise exception 'Enter a count for every product'; end if;
    select coalesce(qty, 0) into have from inv_balances where product_id = pid and location = p_location;
    diff := counted - coalesce(have, 0);
    n := n + 1;
    if diff <> 0 then
      diffs := diffs + 1;
      insert into inv_movements (product_id, location, qty, kind, reason, note, ref, ref_id, by_name)
      values (pid, p_location, diff, 'count', 'Cycle count', nullif(trim(coalesce(p_note, '')), ''),
              (select ref from inv_tasks where id = p_task), p_task, p_by);
    end if;
    insert into inv_balances (product_id, location, qty) values (pid, p_location, 0) on conflict do nothing;
    out_ := out_ || jsonb_build_object('product_id', pid, 'was', coalesce(have, 0), 'counted', counted, 'diff', diff);
    perform public.inv_check_replenish(pid);
  end loop;
  if p_task is not null then
    update inv_tasks set status = 'done', done_at = now(), done_by = p_by, moved = diffs,
      note = nullif(trim(coalesce(p_note, '')), ''), result = jsonb_build_object('lines', n, 'diffs', diffs, 'items', out_)
    where id = p_task and status = 'open';
  end if;
  return jsonb_build_object('lines', n, 'diffs', diffs, 'items', out_);
end $$;
grant execute on function public.inv_count_shelf(text, jsonb, text, text, uuid) to authenticated;

create or replace function public.inv_set_count_plan(p_per_day int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.sees_costs() then raise exception 'Not allowed'; end if;
  update inv_meta set count_per_day = greatest(0, least(coalesce(p_per_day, 12), 100)) where id = 1;
end $$;
grant execute on function public.inv_set_count_plan(int) to authenticated;

-- ── Value and slow stock (office only) ──

create table if not exists inv_costs (
  product_id uuid primary key references inv_products(id) on delete cascade,
  unit_cost numeric not null check (unit_cost >= 0),
  updated_by text, updated_at timestamptz default now()
);
alter table inv_costs enable row level security;
drop policy if exists "Office reads costs" on inv_costs;
create policy "Office reads costs" on inv_costs for select to authenticated using (public.sees_costs());

-- Link products to the Products list where the names match, for cost, supplier and lead time
update inv_products p set stock_item_id = s.id
from (select distinct on (public.inv_norm(name)) id, public.inv_norm(name) k from stock_items order by public.inv_norm(name), created_at) s
where p.stock_item_id is null and s.k = public.inv_norm(p.name);

create or replace function public.inv_set_cost(p_product uuid, p_cost numeric, p_by text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.sees_costs() then raise exception 'Not allowed'; end if;
  if p_cost is null then delete from inv_costs where product_id = p_product; return; end if;
  insert into inv_costs (product_id, unit_cost, updated_by) values (p_product, p_cost, p_by)
  on conflict (product_id) do update set unit_cost = excluded.unit_cost, updated_by = excluded.updated_by, updated_at = now();
end $$;
grant execute on function public.inv_set_cost(uuid, numeric, text) to authenticated;

-- What everything is worth, when each last sold, and what damage has cost
create or replace function public.inv_value() returns jsonb
language plpgsql security definer set search_path = public as $$
declare today date := (now() at time zone 'Europe/London')::date; res jsonb;
begin
  if not public.sees_costs() then raise exception 'Not allowed'; end if;
  with cost as (
    select p.id, coalesce(c.unit_cost,
      nullif(regexp_replace(coalesce(si.data ->> 'costPrice', ''), '[^0-9.]', '', 'g'), '')::numeric) as unit_cost,
      case when c.unit_cost is not null then 'set here' when si.id is not null then 'Products' end as cost_from
    from inv_products p left join inv_costs c on c.product_id = p.id left join stock_items si on si.id = p.stock_item_id
  ), sold as (
    select product_id, max(day) as last_day from public.inv_daily_units(today - 180, today) group by 1
  ), dmg as (
    select product_id, sum(qty) filter (where reported_at > now() - interval '30 days') as d30,
           sum(qty) filter (where status = 'open') as held
    from inv_damages group by 1
  )
  select jsonb_build_object('products', coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'code', p.code, 'name', p.name,
      'unit_cost', cost.unit_cost, 'cost_from', cost.cost_from,
      'on_hand', coalesce((select sum(qty) from inv_balances b where b.product_id = p.id), 0),
      'locations', coalesce((select jsonb_agg(jsonb_build_object('code', b.location, 'qty', b.qty)) from inv_balances b
                             where b.product_id = p.id and b.location <> '' and b.qty <> 0), '[]'::jsonb),
      'last_sold', sold.last_day, 'damaged_30', coalesce(dmg.d30, 0), 'damaged_held', coalesce(dmg.held, 0))), '[]'::jsonb),
    'damages', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'unit_cost', c2.unit_cost)) from inv_damages d
                          join cost c2 on c2.id = d.product_id where d.reported_at > now() - interval '120 days'), '[]'::jsonb))
  into res
  from inv_products p join cost on cost.id = p.id left join sold on sold.product_id = p.id left join dmg on dmg.product_id = p.id
  where p.active;
  return res;
end $$;
grant execute on function public.inv_value() to authenticated;

-- Overview: now with damages, count tasks and how accurate counts have been
create or replace function public.inv_overview() returns jsonb
language plpgsql security definer set search_path = public as $$
declare res jsonb; m inv_meta%rowtype;
begin
  if not public.is_active_user() then raise exception 'Not allowed'; end if;
  select * into m from inv_meta where id = 1;
  if m.started_at is not null and (m.rates_at is null or m.rates_at < now() - interval '30 minutes') then
    perform public.inv_refresh_rates();
    select * into m from inv_meta where id = 1;
  end if;
  perform public.inv_plan_counts();

  with open_u as (select * from public.inv_open_order_units()),
  alloc as (select product_id, sum(units) as units, count(distinct order_key) as orders from open_u where product_id is not null group by 1),
  bal as (
    select b.product_id,
           sum(b.qty) as on_hand,
           sum(b.qty) filter (where l.pickable) as pick,
           sum(b.qty) filter (where l.code is not null and not l.pickable) as overflow,
           sum(b.qty) filter (where b.location = '') as nowhere,
           jsonb_agg(jsonb_build_object('code', b.location, 'qty', b.qty, 'pickable', coalesce(l.pickable, false))
                     order by coalesce(l.pickable, false) desc, b.location) filter (where b.location <> '') as locations
    from inv_balances b left join inv_locations l on l.code = b.location group by 1
  ),
  onorder as (
    select p.id as product_id, sum(greatest(i.qty - coalesce(i.qty_received, 0), 0)) as units
    from inv_products p
    join purchase_order_items i on i.stock_item_id = p.stock_item_id
    join purchase_orders po on po.id = i.po_id
    where p.stock_item_id is not null and coalesce(po.kind, 'order') <> 'credit_note'
      and po.status not in ('draft', 'cancelled', 'received', 'completed') and coalesce(i.line_status, 'due') <> 'cancelled'
    group by 1
  ),
  req as (
    select distinct on (p.id) p.id as product_id, r.id, r.ref, r.status, r.qty_requested
    from inv_products p join stock_requests r
      on (public.inv_norm(r.helm_sku) = p.code_key or (p.stock_item_id is not null and r.stock_item_id = p.stock_item_id))
    where r.status in ('raised', 'acknowledged', 'ordered')
      and not (r.status = 'ordered' and exists (select 1 from purchase_order_items i where i.id = r.po_item_id
                                                and coalesce(i.qty_received, 0) >= i.qty))
    order by p.id, r.created_at desc
  ),
  lead as (
    select p.id as product_id,
           coalesce(p.lead_days,
             ceil(nullif(regexp_replace(coalesce(s.data ->> 'leadDays', ''), '[^0-9]', '', 'g'), '')::numeric * 7 / 5)::int,
             7) as days,
           (p.lead_days is not null or (s.data ->> 'leadDays') ~ '\d') as known
    from inv_products p
    left join stock_items si on si.id = p.stock_item_id
    left join lateral (select x.data from suppliers x where lower(x.name) = lower(si.data ->> 'supplierName')
                       order by x.created_at limit 1) s on true
  )
  select jsonb_build_object(
    'meta', jsonb_build_object('counted_at', m.counted_at, 'started_at', m.started_at, 'rates_at', m.rates_at,
      'count_per_day', m.count_per_day,
      'counts_30', (select count(*) from inv_tasks where kind = 'count' and status = 'done' and done_at > now() - interval '30 days'),
      'counts_right_30', (select count(*) from inv_tasks where kind = 'count' and status = 'done' and done_at > now() - interval '30 days'
                          and coalesce((result ->> 'diffs')::int, 0) = 0),
      'damages_open', (select count(*) from inv_damages where status = 'open')),
    'products', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.id, 'code', p.code, 'name', p.name, 'in_helm', p.in_helm or exists (
            select 1 from dispatch_item_units u where u.code_key = p.code_key and u.source = 'helm'),
        'stock_item_id', p.stock_item_id, 'min_pick', p.min_pick, 'daily_override', p.daily_override,
        'override_until', p.override_until, 'lead_days', p.lead_days, 'note', p.note, 'active', p.active,
        'on_hand', coalesce(b.on_hand, 0), 'pick', coalesce(b.pick, 0), 'overflow', coalesce(b.overflow, 0),
        'nowhere', coalesce(b.nowhere, 0), 'locations', coalesce(b.locations, '[]'::jsonb),
        'open_orders', coalesce(a.units, 0), 'open_order_count', coalesce(a.orders, 0),
        'available', coalesce(b.on_hand, 0) - coalesce(a.units, 0),
        'units_7', coalesce(r.units_7, 0), 'units_28', coalesce(r.units_28, 0), 'rate_days', coalesce(r.days, 0),
        'daily', public.inv_rate_of(p.id), 'on_order', coalesce(oo.units, 0),
        'lead', ld.days, 'lead_known', ld.known,
        'damaged', coalesce((select sum(qty) from inv_damages d where d.product_id = p.id and d.status = 'open'), 0),
        'request', case when rq.id is not null then jsonb_build_object('id', rq.id, 'ref', rq.ref, 'status', rq.status, 'qty', rq.qty_requested) end
      ) order by p.name)
      from inv_products p
      left join bal b on b.product_id = p.id
      left join alloc a on a.product_id = p.id
      left join inv_rates r on r.product_id = p.id
      left join onorder oo on oo.product_id = p.id
      left join req rq on rq.product_id = p.id
      left join lead ld on ld.product_id = p.id
      where p.active), '[]'::jsonb),
    'locations', coalesce((select jsonb_agg(jsonb_build_object('code', l.code, 'pickable', l.pickable, 'note', l.note)
        order by split_part(l.code, '-', 1), split_part(l.code, '-', 2)::int, split_part(l.code, '-', 3)::int, split_part(l.code, '-', 4)::int)
      from inv_locations l), '[]'::jsonb),
    'tasks', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'ref', t.ref, 'kind', t.kind, 'product_id', t.product_id,
        'product_name', p.name, 'product_code', p.code, 'from_location', t.from_location, 'to_location', t.to_location,
        'qty', t.qty, 'why', t.why, 'status', t.status, 'created_at', t.created_at, 'done_at', t.done_at,
        'done_by', t.done_by, 'moved', t.moved, 'note', t.note, 'result', t.result) order by t.created_at desc)
      from inv_tasks t left join inv_products p on p.id = t.product_id
      where t.status = 'open' or t.done_at > now() - interval '3 days'), '[]'::jsonb),
    'unmatched_open', coalesce((select jsonb_agg(jsonb_build_object('code', code, 'name', name, 'units', units, 'orders', n))
      from (select code, min(name) as name, sum(units) as units, count(distinct order_key) as n
            from open_u where product_id is null group by code) x), '[]'::jsonb),
    'unmatched_sold', coalesce((select jsonb_agg(to_jsonb(u) order by u.last_seen desc) from inv_unmatched u
      where u.last_seen > now() - interval '60 days'
        and not exists (select 1 from public.inv_expand(jsonb_build_array(jsonb_build_object('code', u.code, 'qty', 1))) e
                        where e.product_id is not null)), '[]'::jsonb)
  ) into res;
  return res;
end $$;
grant execute on function public.inv_overview() to authenticated;
