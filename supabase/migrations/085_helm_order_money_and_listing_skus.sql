-- 085: HELM order totals and Listing SKUs (06-11-2026). Already applied. Additive only.
--   money          {total, subtotal, tax, shipping, discount, currency} from HELM's order totals (includes=totals; amounts only)
--   listing_lines  [{code, listing_sku, channel_product_id, qty}] — the channel's Listing SKU next to HELM's item code
alter table public.helm_orders add column if not exists money jsonb;
alter table public.helm_orders add column if not exists listing_lines jsonb not null default '[]'::jsonb;

-- One-off fill of past orders: writes ONLY order_total, money, listing_lines, and only where money is still empty —
-- never items, units, status or anything Dispatch / Inventory read. (Run on 06-11-2026 for 4,249 orders.)
create or replace function public.helm_orders_fill_money(p jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update helm_orders h set
    order_total   = nullif((x->>'order_total'),'')::numeric,
    money         = x->'money',
    listing_lines = coalesce(x->'listing_lines', '[]'::jsonb)
  from jsonb_array_elements(p) x
  where h.id = (x->>'id')::bigint and h.money is null;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.helm_orders_fill_money(jsonb) from public, anon, authenticated;
grant execute on function public.helm_orders_fill_money(jsonb) to service_role;
