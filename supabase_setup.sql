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

-- Recycle bin table (run this if upgrading from a previous version)
create table if not exists recycle_bin (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text default 'product',
  data jsonb not null,
  deleted_at timestamptz default now()
);
alter table recycle_bin enable row level security;
create policy "Allow all on recycle_bin" on recycle_bin for all using (true) with check (true);
