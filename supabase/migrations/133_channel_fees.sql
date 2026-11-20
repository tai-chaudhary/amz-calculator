-- 133: what each sales channel charges, dated.
-- One row for a channel (its percentage and its fixed amount per order) and, where a listing's percentage differs
-- (eBay charges by category), one row for that listing. Every row applies from a date; earlier days keep what they had.
create table if not exists public.channel_fees (
  id bigserial primary key,
  channel text not null,
  listing_id uuid references public.saved_products(id) on delete cascade,
  from_date date not null,
  pct numeric not null check (pct >= 0 and pct <= 100),          -- % of what the customer paid (sale + delivery), fee ex VAT
  per_order numeric check (per_order >= 0),                       -- fixed amount an order, ex VAT (channel rows only)
  per_order_small numeric check (per_order_small >= 0),           -- the fixed amount on a small order, where it differs
  small_order_max numeric check (small_order_max >= 0),           -- "small" = an order of this much or less
  note text,
  created_at timestamptz not null default now(), created_by text,
  removed_at timestamptz, removed_by text
);
create index if not exists channel_fees_lookup on public.channel_fees (channel, listing_id, from_date desc) where removed_at is null;
alter table public.channel_fees enable row level security;
drop policy if exists "Cost viewers read channel fees" on public.channel_fees;
create policy "Cost viewers read channel fees" on public.channel_fees for select to authenticated using (public.sees_costs());
revoke all on public.channel_fees from anon;
revoke insert, update, delete, truncate, references, trigger on public.channel_fees from authenticated;

-- The percentage in force for a listing on a day: the listing's own, else the channel's. Null when the channel has no
-- rule at all (Amazon: the listing's own fee is used, as before).
create or replace function public.channel_fee_pct(p_channel text, p_listing uuid, p_day date) returns numeric
language sql stable security definer set search_path to 'public' as $fn$
  select coalesce(
    (select f.pct from channel_fees f where f.removed_at is null and f.channel = p_channel and f.listing_id = p_listing and f.from_date <= p_day order by f.from_date desc, f.id desc limit 1),
    (select f.pct from channel_fees f where f.removed_at is null and f.channel = p_channel and f.listing_id is null and f.from_date <= p_day order by f.from_date desc, f.id desc limit 1))
$fn$;

-- The fixed amount for one order on a day (0 when the channel has none).
create or replace function public.channel_fee_fixed(p_channel text, p_day date, p_order_total numeric) returns numeric
language sql stable security definer set search_path to 'public' as $fn$
  select coalesce((
    select case when f.per_order_small is not null and f.small_order_max is not null and coalesce(p_order_total, 0) <= f.small_order_max
                then f.per_order_small else coalesce(f.per_order, 0) end
    from channel_fees f where f.removed_at is null and f.channel = p_channel and f.listing_id is null and f.from_date <= p_day
    order by f.from_date desc, f.id desc limit 1), 0)
$fn$;
