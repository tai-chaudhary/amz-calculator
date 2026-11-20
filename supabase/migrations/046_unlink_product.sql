-- Undo a link between Inventory and Products (v2.40.0)
--   Linking renames the Products entry to the Inventory name and gives it the Inventory SKU. What it was
--   before is kept (preLinkName / preLinkSku), so a link made by mistake can be undone exactly.
-- Safe to re-run; only adds.

create or replace function public.inv_link_stock_item(p_product uuid, p_item uuid, p_by text)
 returns void language plpgsql security definer set search_path to 'public'
as $$
declare p inv_products; s stock_items; other text;
begin
  if not public.sees_costs() then raise exception 'Only the office links products'; end if;
  select * into p from inv_products where id = p_product and active;
  select * into s from stock_items where id = p_item;
  if p.id is null or s.id is null then raise exception 'That product isn''t there any more'; end if;
  select name into other from inv_products where stock_item_id = p_item and id <> p_product;
  if other is not null then raise exception 'That Products entry is already % in Inventory', other; end if;
  if p.stock_item_id is not null and p.stock_item_id <> p_item then raise exception '% is already linked to another Products entry', p.name; end if;
  update stock_items set
    data = coalesce(data, '{}'::jsonb)
           || case when lower(trim(s.name)) <> lower(trim(p.name)) and coalesce(data ->> 'supplierProductName', '') = ''
                   then jsonb_build_object('supplierProductName', s.name) else '{}'::jsonb end
           || jsonb_build_object('name', p.name, 'linkedByName', coalesce(p_by, ''), 'linkedAt', now(),
                                 'preLinkName', s.name, 'preLinkSku', coalesce(s.data ->> 'sku', '')),
    name = p.name
   where id = p_item;
  update inv_products set stock_item_id = p_item, updated_at = now() where id = p_product;
end $$;
revoke all on function public.inv_link_stock_item(uuid, uuid, text) from public, anon;
grant execute on function public.inv_link_stock_item(uuid, uuid, text) to authenticated;

-- Undo: the inventory product goes back to having no Products entry; the Products entry gets back the
-- name and SKU it had. A Products entry made for it (nothing before it) is archived.
create or replace function public.inv_unlink_stock_item(p_product uuid, p_by text)
 returns void language plpgsql security definer set search_path to 'public'
as $$
declare p inv_products; s stock_items;
begin
  if not public.sees_costs() then raise exception 'Only the office links products'; end if;
  select * into p from inv_products where id = p_product;
  if p.id is null or p.stock_item_id is null then raise exception 'It isn''t linked'; end if;
  select * into s from stock_items where id = p.stock_item_id;
  update inv_products set stock_item_id = null, updated_at = now() where id = p.id;
  if s.data ? 'preLinkName' then
    update stock_items set name = s.data ->> 'preLinkName',
      data = (coalesce(data, '{}'::jsonb) - 'linkedByName' - 'linkedAt' - 'preLinkName' - 'preLinkSku'
              - case when coalesce(data ->> 'supplierProductName', '') = s.data ->> 'preLinkName' then 'supplierProductName' else '' end)
             || jsonb_build_object('name', s.data ->> 'preLinkName')
             || case when coalesce(s.data ->> 'preLinkSku', '') = '' then '{}'::jsonb else jsonb_build_object('sku', s.data ->> 'preLinkSku') end
     where id = s.id;
    update stock_items set data = data - 'sku' where id = s.id and coalesce(s.data ->> 'preLinkSku', '') = '';
  elsif s.data ? 'createdByName' and not exists (select 1 from purchase_order_items i where i.stock_item_id = s.id) then
    -- Made for it (nothing before it, never ordered): archived, not deleted, in case anything points at it
    update stock_items set data = (coalesce(data, '{}'::jsonb) - 'sku') || jsonb_build_object('archived', true) where id = s.id;
  end if;
  -- Anything else (linked before the clean-up, or already ordered) is just unlinked and left as it is
end $$;
revoke all on function public.inv_unlink_stock_item(uuid, text) from public, anon;
grant execute on function public.inv_unlink_stock_item(uuid, text) to authenticated;
