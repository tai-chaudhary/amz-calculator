-- v2.90.0: the database knows Amazon's fee schedule, so a fee it estimates (a sale not yet in a report, an open order)
-- follows the listing's fee CATEGORY and price, as the listing page does. Before, the estimate read the plain
-- percentage stored on the listing and ignored the category: 50 of 88 category listings were estimated at the wrong rate.
--   fee_categories            Amazon UK's referral fee schedule (2026-09-21), a copy of src/lib/feeSchedule.js.
--                             When that file changes, this table must be re-seeded (tests/feeSchedule.test.mjs says how).
--   fee_referral(cat, price)  the referral fee in pounds, minimum and 2% digital services fee included; null for an
--                             unknown category
--   listing_fee_pct(data)     a listing's fee as a percentage of its price: from its category when it has one, else
--                             the percentage stored on it
-- The checks at the end compare the database's answer with the app's for every category: below the minimum, at an
-- ordinary price, and on and just over every price where its rate changes.
-- Applied 16 Nov 2026. Safe to re-run.
create table if not exists public.fee_categories (name text primary key, def jsonb not null, updated_at timestamptz not null default now());
alter table public.fee_categories enable row level security;
drop policy if exists "Read fee categories" on public.fee_categories;
create policy "Read fee categories" on public.fee_categories for select to authenticated using (true);
insert into public.fee_categories (name, def) values
  ('Amazon Device Accessories', '{"flat":45,"min":0.25}'::jsonb),
  ('Automotive and Powersports', '{"type":"portion","tiers":[[45,15],[null,9]],"min":0.25}'::jsonb),
  ('Baby Products', '{"type":"whole","tiers":[[10,8],[null,15]],"min":0.25}'::jsonb),
  ('Baby Pushchairs and Safety Equipment', '{"type":"whole","tiers":[[10,8],[null,15]],"min":0.25}'::jsonb),
  ('Rucksacks and Handbags', '{"flat":15,"min":0.25}'::jsonb),
  ('Beauty, Health and Personal Care', '{"type":"whole","tiers":[[10,8],[null,15]],"min":0.25}'::jsonb),
  ('Reusable Work and Safety Gloves', '{"type":"whole","tiers":[[10,8],[null,15]],"min":0.25}'::jsonb),
  ('Beer, Wine and Spirits', '{"flat":10,"min":0.25}'::jsonb),
  ('Books', '{"flat":15,"min":null}'::jsonb),
  ('Business, Industrial & Scientific Supplies', '{"flat":15,"min":0.25}'::jsonb),
  ('Compact Appliances', '{"flat":15,"min":0.25}'::jsonb),
  ('Clothing and Accessories', '{"type":"whole","tiers":[[15,5],[20,10],[null,15]],"min":0.25,"note":"FBA/SFP above £40: 15% portion up to £40, 7% above"}'::jsonb),
  ('Commercial Electrical and Energy Supplies', '{"flat":12,"min":0.25}'::jsonb),
  ('Computers', '{"flat":7,"min":0.25}'::jsonb),
  ('Consumer Electronics', '{"flat":7,"min":0.25}'::jsonb),
  ('Cycling Accessories', '{"flat":15,"min":0.25}'::jsonb),
  ('Electronic Accessories', '{"type":"portion","tiers":[[100,15],[null,8]],"min":0.25}'::jsonb),
  ('Printer and Scanner Accessories', '{"type":"portion","tiers":[[100,15],[null,8]],"min":0.25}'::jsonb),
  ('Eyewear', '{"flat":15,"min":0.25}'::jsonb),
  ('Eyewear Protection', '{"flat":15,"min":0.25}'::jsonb),
  ('Footwear', '{"flat":15,"min":0.25}'::jsonb),
  ('Full-Size Appliances', '{"flat":7,"min":0.25}'::jsonb),
  ('Furniture', '{"type":"portion","tiers":[[175,15],[null,10]],"min":0.25}'::jsonb),
  ('Furniture Accessories', '{"flat":13,"min":0.25}'::jsonb),
  ('Grocery and Gourmet', '{"type":"whole","tiers":[[10,5],[null,15]],"min":null}'::jsonb),
  ('Handmade', '{"flat":12,"min":0.25}'::jsonb),
  ('Home Products', '{"type":"whole","tiers":[[20,8],[null,15]],"min":0.25}'::jsonb),
  ('Kitchen', '{"flat":15,"min":0.25}'::jsonb),
  ('Home Linen and Rugs', '{"flat":15,"min":0.25}'::jsonb),
  ('Jewellery', '{"type":"portion","tiers":[[225,20],[null,5]],"min":0.25}'::jsonb),
  ('Lawn and Garden', '{"flat":15,"min":0.25}'::jsonb),
  ('Luggage', '{"flat":15,"min":0.25}'::jsonb),
  ('Luggage Accessories', '{"flat":15,"min":0.25}'::jsonb),
  ('Mattresses', '{"flat":15,"min":0.25}'::jsonb),
  ('Music, Video and DVD', '{"flat":15,"min":null}'::jsonb),
  ('Musical Instruments and AV Production', '{"flat":12,"min":0.25}'::jsonb),
  ('Office Products', '{"flat":15,"min":0.25}'::jsonb),
  ('Packing Materials', '{"flat":15,"min":0.25}'::jsonb),
  ('Pet Supplies', '{"flat":15,"min":0.25}'::jsonb),
  ('Pet Clothing and Food', '{"type":"whole","tiers":[[10,5],[null,15]],"min":0.25}'::jsonb),
  ('Software', '{"flat":15,"min":null}'::jsonb),
  ('Sports and Outdoors', '{"flat":15,"min":0.25}'::jsonb),
  ('Tyres', '{"flat":7,"min":0.25}'::jsonb),
  ('Tools and Home Improvement', '{"flat":13,"min":0.25}'::jsonb),
  ('Door, Window and Shower Accessories', '{"flat":13,"min":0.25}'::jsonb),
  ('Home Adhesives and Cable Ties', '{"flat":13,"min":0.25}'::jsonb),
  ('Toys and Games', '{"flat":15,"min":0.25}'::jsonb),
  ('Video Games and Gaming Accessories', '{"flat":15,"min":null}'::jsonb),
  ('Video Game Consoles', '{"flat":8,"min":null}'::jsonb),
  ('Vitamins, Minerals and Supplements', '{"type":"whole","tiers":[[10,5],[null,15]],"min":0.25}'::jsonb),
  ('Watches', '{"type":"portion","tiers":[[225,15],[null,5]],"min":0.25}'::jsonb),
  ('Everything else', '{"flat":15,"min":0.25}'::jsonb)
on conflict (name) do update set def = excluded.def, updated_at = now();

create or replace function public.fee_referral(p_cat text, p_price numeric)
 returns numeric language plpgsql stable set search_path to 'public' as $f$
declare c jsonb; fee numeric := 0; t jsonb; lim numeric; rate numeric; frm numeric := 0; upto numeric;
begin
  select def into c from fee_categories where name = p_cat;
  if c is null then return null; end if;
  if p_price is null or p_price <= 0 then return 0; end if;
  if c ? 'flat' then
    fee := p_price * (c->>'flat')::numeric / 100;
  elsif c->>'type' = 'whole' then
    rate := null;
    for t in select e from jsonb_array_elements(c->'tiers') with ordinality x(e, n) order by n loop
      if jsonb_typeof(t->0) = 'null' or p_price <= (t->>0)::numeric then rate := (t->>1)::numeric; exit; end if;
    end loop;
    if rate is null then rate := (c->'tiers'->-1->>1)::numeric; end if;
    fee := p_price * rate / 100;
  elsif c->>'type' = 'portion' then
    for t in select e from jsonb_array_elements(c->'tiers') with ordinality x(e, n) order by n loop
      lim := case when jsonb_typeof(t->0) = 'null' then null else (t->>0)::numeric end;
      rate := (t->>1)::numeric;
      upto := case when lim is null then p_price else least(p_price, lim) end;
      if upto > frm then fee := fee + (upto - frm) * rate / 100; end if;
      if lim is null or p_price <= lim then exit; end if;
      frm := lim;
    end loop;
  end if;
  if jsonb_typeof(c->'min') = 'number' then fee := greatest(fee, (c->>'min')::numeric); end if;
  return fee * 1.02;
end $f$;

create or replace function public.listing_fee_pct(p_data jsonb)
 returns numeric language sql stable set search_path to 'public' as $f$
  select coalesce(
    case when coalesce(p_data->>'feeCategory', '') <> '' and nullif(p_data->>'sellPrice', '')::numeric > 0
      then round(public.fee_referral(p_data->>'feeCategory', (p_data->>'sellPrice')::numeric) / (p_data->>'sellPrice')::numeric * 100, 4) end,
    nullif(p_data->>'refFee', '')::numeric)
$f$;
grant execute on function public.fee_referral(text, numeric), public.listing_fee_pct(jsonb) to authenticated;

do $do$
declare bad text; d text; n text;
begin
  select string_agg(v.cat || ' @ ' || v.price || ': app ' || v.want || ', database ' || coalesce(public.fee_referral(v.cat, v.price)::text, 'null'), '; ')
    into bad from (values
('Amazon Device Accessories',0.5,0.255000),('Amazon Device Accessories',12.34,5.664060),('Automotive and Powersports',0.5,0.255000),('Automotive and Powersports',7.77,1.188810),('Automotive and Powersports',600,57.834000),('Automotive and Powersports',45,6.885000),('Automotive and Powersports',45.01,6.885918),('Baby Products',0.5,0.255000),('Baby Products',7.77,0.634032),('Baby Products',600,91.800000),('Baby Products',10,0.816000),('Baby Products',10.01,1.531530),('Baby Pushchairs and Safety Equipment',0.5,0.255000),('Baby Pushchairs and Safety Equipment',7.77,0.634032),('Baby Pushchairs and Safety Equipment',600,91.800000),('Baby Pushchairs and Safety Equipment',10,0.816000),('Baby Pushchairs and Safety Equipment',10.01,1.531530),('Rucksacks and Handbags',0.5,0.255000),('Rucksacks and Handbags',12.34,1.888020),('Beauty, Health and Personal Care',0.5,0.255000),('Beauty, Health and Personal Care',7.77,0.634032),('Beauty, Health and Personal Care',600,91.800000),('Beauty, Health and Personal Care',10,0.816000),('Beauty, Health and Personal Care',10.01,1.531530),('Reusable Work and Safety Gloves',0.5,0.255000),('Reusable Work and Safety Gloves',7.77,0.634032),('Reusable Work and Safety Gloves',600,91.800000),('Reusable Work and Safety Gloves',10,0.816000),('Reusable Work and Safety Gloves',10.01,1.531530),('Beer, Wine and Spirits',0.5,0.255000),('Beer, Wine and Spirits',12.34,1.258680),('Books',0.5,0.076500),('Books',12.34,1.888020),('Business, Industrial & Scientific Supplies',0.5,0.255000),('Business, Industrial & Scientific Supplies',12.34,1.888020),('Compact Appliances',0.5,0.255000),('Compact Appliances',12.34,1.888020),('Clothing and Accessories',0.5,0.255000),('Clothing and Accessories',7.77,0.396270),('Clothing and Accessories',600,91.800000),('Clothing and Accessories',15,0.765000),('Clothing and Accessories',15.01,1.531020),('Clothing and Accessories',20,2.040000),('Clothing and Accessories',20.01,3.061530),('Commercial Electrical and Energy Supplies',0.5,0.255000),('Commercial Electrical and Energy Supplies',12.34,1.510416),('Computers',0.5,0.255000),('Computers',12.34,0.881076),('Consumer Electronics',0.5,0.255000),('Consumer Electronics',12.34,0.881076),('Cycling Accessories',0.5,0.255000),('Cycling Accessories',12.34,1.888020),('Electronic Accessories',0.5,0.255000),('Electronic Accessories',7.77,1.188810),('Electronic Accessories',600,56.100000),('Electronic Accessories',100,15.300000),('Electronic Accessories',100.01,15.300816),('Printer and Scanner Accessories',0.5,0.255000),('Printer and Scanner Accessories',7.77,1.188810),('Printer and Scanner Accessories',600,56.100000),('Printer and Scanner Accessories',100,15.300000),('Printer and Scanner Accessories',100.01,15.300816),('Eyewear',0.5,0.255000),('Eyewear',12.34,1.888020),('Eyewear Protection',0.5,0.255000),('Eyewear Protection',12.34,1.888020),('Footwear',0.5,0.255000),('Footwear',12.34,1.888020),('Full-Size Appliances',0.5,0.255000),('Full-Size Appliances',12.34,0.881076),('Furniture',0.5,0.255000),('Furniture',7.77,1.188810),('Furniture',600,70.125000),('Furniture',175,26.775000),('Furniture',175.01,26.776020),('Furniture Accessories',0.5,0.255000),('Furniture Accessories',12.34,1.636284),('Grocery and Gourmet',0.5,0.025500),('Grocery and Gourmet',7.77,0.396270),('Grocery and Gourmet',600,91.800000),('Grocery and Gourmet',10,0.510000),('Grocery and Gourmet',10.01,1.531530),('Handmade',0.5,0.255000),('Handmade',12.34,1.510416),('Home Products',0.5,0.255000),('Home Products',7.77,0.634032),('Home Products',600,91.800000),('Home Products',20,1.632000),('Home Products',20.01,3.061530),('Kitchen',0.5,0.255000),('Kitchen',12.34,1.888020),('Home Linen and Rugs',0.5,0.255000),('Home Linen and Rugs',12.34,1.888020),('Jewellery',0.5,0.255000),('Jewellery',7.77,1.585080),('Jewellery',600,65.025000),('Jewellery',225,45.900000),('Jewellery',225.01,45.900510),('Lawn and Garden',0.5,0.255000),('Lawn and Garden',12.34,1.888020),('Luggage',0.5,0.255000),('Luggage',12.34,1.888020),('Luggage Accessories',0.5,0.255000),('Luggage Accessories',12.34,1.888020),('Mattresses',0.5,0.255000),('Mattresses',12.34,1.888020),('Music, Video and DVD',0.5,0.076500),('Music, Video and DVD',12.34,1.888020),('Musical Instruments and AV Production',0.5,0.255000),('Musical Instruments and AV Production',12.34,1.510416),('Office Products',0.5,0.255000),('Office Products',12.34,1.888020),('Packing Materials',0.5,0.255000),('Packing Materials',12.34,1.888020),('Pet Supplies',0.5,0.255000),('Pet Supplies',12.34,1.888020),('Pet Clothing and Food',0.5,0.255000),('Pet Clothing and Food',7.77,0.396270),('Pet Clothing and Food',600,91.800000),('Pet Clothing and Food',10,0.510000),('Pet Clothing and Food',10.01,1.531530),('Software',0.5,0.076500),('Software',12.34,1.888020),('Sports and Outdoors',0.5,0.255000),('Sports and Outdoors',12.34,1.888020),('Tyres',0.5,0.255000),('Tyres',12.34,0.881076),('Tools and Home Improvement',0.5,0.255000),('Tools and Home Improvement',12.34,1.636284),('Door, Window and Shower Accessories',0.5,0.255000),('Door, Window and Shower Accessories',12.34,1.636284),('Home Adhesives and Cable Ties',0.5,0.255000),('Home Adhesives and Cable Ties',12.34,1.636284),('Toys and Games',0.5,0.255000),('Toys and Games',12.34,1.888020),('Video Games and Gaming Accessories',0.5,0.076500),('Video Games and Gaming Accessories',12.34,1.888020),('Video Game Consoles',0.5,0.040800),('Video Game Consoles',12.34,1.006944),('Vitamins, Minerals and Supplements',0.5,0.255000),('Vitamins, Minerals and Supplements',7.77,0.396270),('Vitamins, Minerals and Supplements',600,91.800000),('Vitamins, Minerals and Supplements',10,0.510000),('Vitamins, Minerals and Supplements',10.01,1.531530),('Watches',0.5,0.255000),('Watches',7.77,1.188810),('Watches',600,53.550000),('Watches',225,34.425000),('Watches',225.01,34.425510),('Everything else',0.5,0.255000),('Everything else',12.34,1.888020)
    ) v(cat, price, want) where abs(coalesce(public.fee_referral(v.cat, v.price), -1) - v.want) > 0.00001;
  if bad is not null then raise exception 'fee schedule check failed: %', left(bad, 600); end if;
  if public.listing_fee_pct('{"feeCategory":"Home Products","sellPrice":"17.95","refFee":"15.3"}'::jsonb) <> 8.16 then raise exception 'listing check 1'; end if;
  if public.listing_fee_pct('{"feeCategory":"Home Products","sellPrice":"24.95","refFee":"8.16"}'::jsonb) <> 15.3 then raise exception 'listing check 2'; end if;
  if public.listing_fee_pct('{"sellPrice":"24.95","refFee":"13.26"}'::jsonb) <> 13.26 then raise exception 'listing check 3'; end if;
  if public.listing_fee_pct('{"feeCategory":"Not a category","sellPrice":"9","refFee":"8.16"}'::jsonb) <> 8.16 then raise exception 'listing check 4'; end if;
  -- open orders are estimated with it
  select pg_get_functiondef('public.report_pl_open(text)'::regprocedure) into d;
  if position('listing_fee_pct' in d) = 0 then
    n := replace(d, $o$nullif(s.data->>'refFee','')::numeric fee_pct$o$, $o$public.listing_fee_pct(s.data) fee_pct$o$);
    if n = d then raise exception 'report_pl_open: the fee part was not found'; end if;
    execute n;
  end if;
end $do$;
