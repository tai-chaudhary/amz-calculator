-- 086: listings clean-up groundwork (06-11-2026). Already applied.
--   amz_import_listings   Amazon Active Listings (06-11-2026) + fees actually charged 01-08 to 05-11-2026, one row per
--                         Listing SKU — staging for splitting listings per Listing SKU and checking fees
--   helm_probe_results    scratch output from the one-off helm-probe checks (field names and amounts only)
--   backup_20261106_*     copies of saved_products, live_products, inv_channel_skus before the clean-up
create table if not exists public.amz_import_listings (
  sku text primary key, asin text, title text, price numeric, qty numeric, fc text, grp text, active boolean,
  units numeric, sales_inc numeric, fee_rate numeric, rmin numeric, rmax numeric, last_sold date,
  imported_at timestamptz not null default now()
);
alter table public.amz_import_listings enable row level security;
create table if not exists public.helm_probe_results (
  id bigserial primary key, at timestamptz not null default now(), kind text, channel text, order_id bigint, data jsonb
);
alter table public.helm_probe_results enable row level security;
