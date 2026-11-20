-- 132: the worked-out plan for the eBay and TikTok listings (one row per listing), kept as the record of what was
-- created from what. Filled and used once, on 18 Nov 2026 (72 listings created; 1 row held: 2 x Peacock White
-- De-Icing Salt 10kg on eBay, no packaging chosen yet). No one reads it through the API.
--
-- How each row was worked out (the query is in AI_HANDOVER.md, addendum of 18 Nov):
--   products    the code's link in inv_channel_skus (portal), or the product itself when the code is its own code
--   one listing every code on a channel that sends the same products and quantities
--   packaging   the owner's choice in the listings sheet (26 rows), otherwise the Amazon listing that sends the same
--               products and quantities
--   weight      the products' weights x quantity
--   carrier     the Amazon listing's, otherwise the listing's own labels (DHL above 15kg)
--   service     the listing's own labels (Evri 48 -> standard, Evri 24 -> next day), otherwise the Amazon listing's
--   fee         left blank: the channel fee rules are not agreed yet
create table if not exists public.channel_listing_plan (
  id bigserial primary key,
  channel text not null, sig text, name text, products text,
  primary_code text, other_codes jsonb, item_id text, codes_seen text,
  kg numeric, components jsonb, cost numeric,
  packaging text, packaging_id text, own_packaging boolean, pack_source text,
  twin_sku text, twin_cat text,
  carrier_id text, carrier_cat_id text, service text, labels text,
  price numeric, orders int, hold text,
  data jsonb, listing_id uuid, created_at timestamptz not null default now()
);
alter table public.channel_listing_plan enable row level security;
revoke all on public.channel_listing_plan from anon, authenticated;
