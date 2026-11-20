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
