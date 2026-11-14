-- One name everywhere (v2.41.0)
--   • The Products name is the product's only name — Inventory, Products and purchase orders all use it.
--     The old "supplier's name" copies are dropped, and PO lines follow a rename from now on.
--   • The 10 products with approved listings but no SKU get their (approved) names and SKUs.
-- Safe to re-run.

-- Purchase order lines show the product's own name
create or replace function public.item_name_to_po_lines() returns trigger
 language plpgsql security definer set search_path to 'public'
as $$
begin
  if new.name is distinct from old.name and coalesce(trim(new.name), '') <> '' then
    update purchase_order_items set name = new.name where stock_item_id = new.id and name is distinct from new.name;
  end if;
  return new;
end $$;
drop trigger if exists item_name_to_po_lines on public.stock_items;
create trigger item_name_to_po_lines after update of name on public.stock_items for each row execute function public.item_name_to_po_lines();

-- Linking no longer keeps the old Products name as a second name (preLinkName stays, only for Undo)
do $$
declare d text := pg_get_functiondef('public.inv_link_stock_item'::regproc);
begin
  if position('supplierProductName' in d) > 0 then
    execute replace(d, $r$           || case when lower(trim(s.name)) <> lower(trim(p.name)) and coalesce(data ->> 'supplierProductName', '') = ''
                   then jsonb_build_object('supplierProductName', s.name) else '{}'::jsonb end
$r$, '');
  end if;
end $$;

-- The 10 approved products: name and SKU, as approved on 19 Oct 2026
with v(old_name, new_name, sku) as (values
  ('BARTOLINE WHITE SPIRIT 500ML', 'Bartoline White Spirit 500ml', 'BARTOL-SPIRIT-WHITE-500ML'),
  ('Fairy Beads 155g Almond Milk And Manuka', 'Fairy Scent Beads Almond Milk & Manuka 155g', 'FAIRY-BEADS-ALMOND-MANUKA-155G'),
  ('Gillette Fusion 5 Pg Starter Pck (Handle+4 Blades)', 'Gillette Fusion5 Razor Starter Pack (Handle + 4 Blades)', 'GILLET-RAZOR-FUSION5-STARTER'),
  ('Gillette Sensor Excel Blades 10''S', 'Gillette Sensor Excel Razor Blades 10 Pack', 'GILLET-BLADES-SENSOR-EXCEL-10PK'),
  ('Gillette Venus Razor Blades Smooth Sensitive 8pcs', 'Gillette Venus Smooth Sensitive Razor Blade Refills 8 Pack', 'GILLET-BLADES-VENUS-SMOOTH-SENS-8PK'),
  ('Nivea Gift Set Men Anti Age Regime (200ml S/Foam, 200ml S/Balm, 50ml F/Cream, 15ml E', 'Nivea Men Anti-Age Regime Gift Set 4 Pieces', 'NIVEA-GIFTSET-MEN-ANTI-AGE-4PC'),
  ('PLENTY ORIGINAL KITCHEN TOWEL (1x95sh)', 'Plenty Original Kitchen Towel 1 Roll - 95 Sheets', 'PLENTY-KITROLL-ORIG-1RL-95SH'),
  ('Regina Blitz Kitchen Roll 8 Rolls, 2 Packs of 4 Triple Layered Household Towels, 70 Extra Large Sheets Per Roll, 560 Sheets Total, 3 Ply Super Absorbent Multi Purpose Paper Towels', 'Regina Blitz Kitchen Roll 8 Rolls (2 x 4)', 'REGINA-KITROLL-BLITZ-8RL'),
  ('Simple Kind to Skin Cleansing Facial Wipes Sensitive Skin 25pk', 'Simple Kind to Skin Sensitive Facial Wipes 25 Pack', 'SIMPLE-FACEWIPE-SENSITIVE-25PK'),
  ('Zero In Fly & Wasp Killer Spray 300ml', 'Zero In Fly & Wasp Killer Spray 300ml', 'ZEROIN-PESTSPR-FLY-WASP-300ML'))
update stock_items s set name = v.new_name,
  data = coalesce(s.data, '{}'::jsonb) || jsonb_build_object('name', v.new_name, 'sku', v.sku, 'skuSetByName', 'Taimoor', 'skuSetAt', now())
from v
where s.name = v.old_name and coalesce(s.data ->> 'sku', '') = ''
  and not exists (select 1 from inv_products p where p.stock_item_id = s.id)
  and not exists (select 1 from inv_products p where p.code_key = public.inv_norm(v.sku))
  and not exists (select 1 from stock_items o where o.id <> s.id and public.inv_norm(o.data ->> 'sku') = public.inv_norm(v.sku));

-- No second names: the product's own name is the one
update stock_items set data = data - 'supplierProductName' where data ? 'supplierProductName';

-- Every PO line shows its product's name (open and past)
update purchase_order_items i set name = s.name from stock_items s where s.id = i.stock_item_id and i.name is distinct from s.name;
