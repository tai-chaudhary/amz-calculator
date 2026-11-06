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
