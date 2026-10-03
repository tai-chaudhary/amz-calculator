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
