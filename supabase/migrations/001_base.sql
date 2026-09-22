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
