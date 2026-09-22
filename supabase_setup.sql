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
