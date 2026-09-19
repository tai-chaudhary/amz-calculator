-- Run this entire script in your Supabase SQL editor
-- Go to: Supabase Dashboard → SQL Editor → New query → paste → Run

-- Settings table (stores carriers, packaging, routing rules)
create table if not exists settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz default now()
);

-- Saved products table
create table if not exists saved_products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  data jsonb not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Months table (Build a Month forecasts)
create table if not exists months (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  data jsonb not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Enable Row Level Security (keep data private)
alter table settings enable row level security;
alter table saved_products enable row level security;
alter table months enable row level security;

-- Allow full access via anon key (personal tool — no auth needed)
create policy "Allow all on settings" on settings for all using (true) with check (true);
create policy "Allow all on saved_products" on saved_products for all using (true) with check (true);
create policy "Allow all on months" on months for all using (true) with check (true);

-- Live Products table
create table if not exists live_products (
  id uuid primary key default gen_random_uuid(),
  saved_product_id uuid references saved_products(id) on delete cascade,
  status text default 'live',
  went_live_at timestamptz default now()
);
alter table live_products enable row level security;
create policy "Allow all on live_products" on live_products for all using (true) with check (true);

-- Price change history
create table if not exists price_history (
  id uuid primary key default gen_random_uuid(),
  saved_product_id uuid references saved_products(id) on delete cascade,
  old_price numeric,
  new_price numeric,
  old_margin numeric,
  new_margin numeric,
  old_profit numeric,
  new_profit numeric,
  cost_price numeric,
  source text default 'live',
  note text,
  changed_at timestamptz default now()
);
alter table price_history enable row level security;
create policy "Allow all on price_history" on price_history for all using (true) with check (true);
create index if not exists price_history_product_idx on price_history(saved_product_id, changed_at desc);

-- Cost change history
create table if not exists cost_history (
  id uuid primary key default gen_random_uuid(),
  saved_product_id uuid references saved_products(id) on delete cascade,
  old_cost numeric,
  new_cost numeric,
  old_margin numeric,
  new_margin numeric,
  sell_price numeric,
  supplier_name text,
  is_bundle boolean default false,
  bundle_qty integer,
  note text,
  changed_at timestamptz default now()
);
alter table cost_history enable row level security;
create policy "Allow all on cost_history" on cost_history for all using (true) with check (true);
create index if not exists cost_history_product_idx on cost_history(saved_product_id, changed_at desc);

-- Stock items: the physical things you buy (parent products)
create table if not exists stock_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz default now()
);
alter table stock_items enable row level security;
create policy "Allow all on stock_items" on stock_items for all using (true) with check (true);

-- ── User attribution ──────────────────────────────────────────────────────────

-- Display names and roles, keyed to Supabase auth users
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  role text default 'member',
  created_at timestamptz default now()
);
alter table profiles enable row level security;
create policy "Allow all on profiles" on profiles for all using (true) with check (true);

-- Who made each change
alter table price_history add column if not exists user_id uuid;
alter table price_history add column if not exists user_name text;
alter table cost_history  add column if not exists user_id uuid;
alter table cost_history  add column if not exists user_name text;
