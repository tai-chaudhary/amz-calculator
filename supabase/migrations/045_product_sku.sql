-- Our SKU on Products (v2.40.0)
--   • A Products entry carries our SKU in data.sku. For anything in Inventory it's always the Inventory SKU
--     (kept the same by trigger); for a product not stocked yet it's given when its first listing is
--     approved (approval means we're ordering it), with a house-style suggestion.
--   • SKUs are unique across Inventory and Products.
--   • The office can fill in a product's details (supplier, cost, weight…) when it's added from Inventory.
-- Safe to re-run; only adds.

-- Inventory → Products: name and SKU stay the same (Inventory's are the accurate ones)
create or replace function public.inv_name_to_item() returns trigger
 language plpgsql security definer set search_path to 'public'
as $$
begin
  if new.stock_item_id is not null and (tg_op = 'INSERT' or new.name is distinct from old.name or new.code is distinct from old.code
                                        or new.stock_item_id is distinct from old.stock_item_id) then
    update stock_items set name = new.name, data = coalesce(data, '{}'::jsonb) || jsonb_build_object('name', new.name, 'sku', new.code)
     where id = new.stock_item_id and (name is distinct from new.name or coalesce(data ->> 'sku', '') is distinct from new.code);
  end if;
  return new;
end $$;
drop trigger if exists inv_name_to_item on public.inv_products;
create trigger inv_name_to_item after insert or update of name, code, stock_item_id on public.inv_products
  for each row execute function public.inv_name_to_item();

-- Everything already linked gets its SKU on Products now
update stock_items s set data = coalesce(s.data, '{}'::jsonb) || jsonb_build_object('sku', p.code)
  from inv_products p where p.stock_item_id = s.id and coalesce(s.data ->> 'sku', '') is distinct from p.code;

-- Who already has this SKU (Inventory, or a Products entry not stocked yet)? null = free
create or replace function public.item_sku_owner(p_code text, p_item uuid default null)
 returns text language sql stable security definer set search_path to 'public'
as $$
  select coalesce(
    (select p.name from inv_products p where p.code_key = public.inv_norm(p_code) and p.stock_item_id is distinct from p_item limit 1),
    (select s.name from stock_items s where public.inv_norm(s.data ->> 'sku') = public.inv_norm(p_code) and s.id is distinct from p_item
       and coalesce(s.data ->> 'sku', '') <> '' limit 1))
  where public.sees_costs()
$$;
revoke all on function public.item_sku_owner(text, uuid) from public, anon;
grant execute on function public.item_sku_owner(text, uuid) to authenticated;

-- Give a product that isn't stocked yet its SKU (one in Inventory has its SKU changed there)
create or replace function public.item_set_sku(p_item uuid, p_code text, p_by text)
 returns text language plpgsql security definer set search_path to 'public'
as $$
declare code text := upper(regexp_replace(trim(coalesce(p_code, '')), '\s+', '-', 'g')); owner text;
begin
  if not public.sees_costs() then raise exception 'Only the office gives SKUs'; end if;
  if not exists (select 1 from stock_items where id = p_item) then raise exception 'That product isn''t there any more'; end if;
  if exists (select 1 from inv_products where stock_item_id = p_item) then raise exception 'It''s in Inventory — change its SKU there'; end if;
  if code = '' or code like 'NEW-%' then raise exception 'Give it its SKU'; end if;
  owner := public.item_sku_owner(code, p_item);
  if owner is not null then raise exception '% is already the SKU of %', code, owner; end if;
  update stock_items set data = coalesce(data, '{}'::jsonb)
    || jsonb_build_object('sku', code, 'skuSetByName', coalesce(p_by, ''), 'skuSetAt', now()) where id = p_item;
  return code;
end $$;
revoke all on function public.item_set_sku(uuid, text, text) from public, anon;
grant execute on function public.item_set_sku(uuid, text, text) to authenticated;

-- The office fills in a product's details when adding it from Inventory (only these fields)
create or replace function public.item_set_details(p_product uuid, p_details jsonb)
 returns void language plpgsql security definer set search_path to 'public'
as $$
declare sid uuid; keep jsonb;
begin
  if not public.sees_costs() then raise exception 'Only the office sets these'; end if;
  select stock_item_id into sid from inv_products where id = p_product;
  if sid is null then raise exception 'That product has no Products entry'; end if;
  select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) into keep from jsonb_each(coalesce(p_details, '{}'::jsonb)) e(k, v)
   where k in ('brand', 'supplierName', 'supplierSku', 'costPrice', 'weightKg', 'leadDays', 'barcode', 'notes')
     and v is not null and v <> '""'::jsonb;
  update stock_items set data = coalesce(data, '{}'::jsonb) || keep where id = sid;
end $$;
revoke all on function public.item_set_details(uuid, jsonb) from public, anon;
grant execute on function public.item_set_details(uuid, jsonb) to authenticated;
