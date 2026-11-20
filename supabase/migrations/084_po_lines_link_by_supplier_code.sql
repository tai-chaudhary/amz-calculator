-- 084: PO lines link to their product by supplier code (06-11-2026). Already applied.
-- A PO line read from a supplier's document ("P586 Pyrex Measuring Jug 500ml") wasn't linked to the product with
-- that supplier code, so Goods In treated it as "not stock" and put-away skipped it (GI-0020). A PO line with no
-- product is now linked when its supplier code — on the line, or at the start of its name — is that supplier's code
-- for exactly one product. GI-0020's line was linked and its put-away reopened.
create or replace function public.poi_link_by_supplier_code() returns trigger
language plpgsql security definer set search_path = public as $$
declare sup text; tok text; hits uuid[];
begin
  if new.stock_item_id is not null then return new; end if;
  select supplier_name into sup from purchase_orders where id = new.po_id;
  tok := coalesce(nullif(trim(new.supplier_sku), ''), nullif(substring(trim(new.name) from '^([A-Za-z0-9][A-Za-z0-9\-\./]{1,19})\s'), ''));
  if tok is null or sup is null then return new; end if;
  select array_agg(distinct s.id) into hits from stock_items s
  where (upper(s.data ->> 'supplierSku') = upper(tok) and public.same_supplier(s.data ->> 'supplierName', sup))
     or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(s.data -> 'suppliers') = 'array' then s.data -> 'suppliers' else '[]' end) x
                where upper(x ->> 'supplierSku') = upper(tok) and public.same_supplier(x ->> 'supplierName', sup));
  if array_length(hits, 1) = 1 then
    new.stock_item_id := hits[1];
    new.supplier_sku := coalesce(nullif(trim(new.supplier_sku), ''), tok);
  end if;
  return new;
end $$;
drop trigger if exists poi_link_by_supplier_code on purchase_order_items;
create trigger poi_link_by_supplier_code before insert or update of name, supplier_sku, stock_item_id on purchase_order_items
  for each row execute function public.poi_link_by_supplier_code();
