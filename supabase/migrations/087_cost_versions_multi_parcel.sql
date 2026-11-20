-- 087: dated cost versions + multi-parcel carrier rules (06-11-2026). Already applied.
-- Every saved change to a cost (carrier rates first) is kept as a version with the date it applies FROM.
-- The P&L uses the version in force on each order's date, so later changes never rewrite earlier months.
-- An admin can back-date a version (e.g. a rate that really changed last month); every change is logged.
create table if not exists public.cost_versions (
  id uuid primary key default gen_random_uuid(),
  kind text not null,                 -- 'carrier' (later: 'packaging', 'fee', 'overhead')
  ref text not null,                  -- e.g. the carrier's id in Cost Settings
  effective_from date not null,
  value jsonb not null,               -- the whole cost record as it was from that date
  summary text, note text,
  created_by text, created_at timestamptz not null default now(),
  history jsonb not null default '[]'::jsonb   -- date changes: [{at, by, from, to}]
);
create index if not exists cost_versions_lookup on public.cost_versions (kind, ref, effective_from desc);
alter table public.cost_versions enable row level security;
drop policy if exists "Read cost versions" on public.cost_versions;
create policy "Read cost versions" on public.cost_versions for select to authenticated using (public.is_active_user());
drop policy if exists "Admins change cost versions" on public.cost_versions;
create policy "Admins change cost versions" on public.cost_versions for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
-- Data set on 06-11-2026 (in Cost Settings): DHL multi = subsequent £3.00, DPD multi = all £3.50, Evri same;
-- HELM services per carrier (DHL Parcel UK Parcel; Evri Next Day Contract Rate, Hermes 24 POD → Next Day,
-- Hermes 48 POD → Standard); starting versions of every carrier from 01-01-2026.

-- Listings clean-up (06-11-2026, already applied): 234 Amazon Listing SKUs set / created from listing_split_plan,
-- 42 prices set to Amazon's live price (price_history), 4 duplicate Live records removed, and:
create unique index if not exists saved_products_listing_sku_uniq
  on saved_products ((coalesce(data->>'channel','Amazon')), (upper(trim(data->>'listingSku'))))
  where coalesce(trim(data->>'listingSku'),'') <> '' and coalesce(data->>'archived','') <> 'true';
