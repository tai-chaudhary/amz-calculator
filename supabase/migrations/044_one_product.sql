-- One product, two views (v2.40.0)
--   Inventory (inv_products: SKU, name, stamp, shelves, stock) and Products (stock_items: cost, supplier,
--   supplier SKU, weight, barcode, brand) are the same product, linked one to one.
--   • Strictly one to one (unique stock_item_id).
--   • A new inventory product gets its Products entry straight away; names stay the same both ways.
--   • A Products entry that's in Inventory can't be deleted from Products (delete it in Inventory).
--   • Packaging (boxes, mailers) is kind = 'packaging': in Inventory with shelves and counts, kept out of
--     selling (code linking, substitutes, labels with no slip).
--   • Office tools for the one-off clean-up: link, create the Products side, add a Products item to Inventory.
-- Safe to re-run. Backwards-compatible with v2.39.0.

alter table public.inv_products add column if not exists kind text not null default 'product';
do $$ begin
  alter table public.inv_products add constraint inv_products_kind check (kind in ('product', 'packaging'));
exception when duplicate_object then null; end $$;
create unique index if not exists inv_products_one_stock_item on public.inv_products(stock_item_id) where stock_item_id is not null;

-- A new inventory product gets its Products entry (details filled in later on Products)
create or replace function public.inv_pair_on_insert() returns trigger
 language plpgsql security definer set search_path to 'public'
as $$
begin
  if new.stock_item_id is null then
    insert into stock_items(name, data)
    values (new.name, jsonb_build_object('name', new.name, 'createdByName', coalesce(new.created_by, 'Inventory'), 'createdAt', now()))
    returning id into new.stock_item_id;
  end if;
  return new;
end $$;
drop trigger if exists inv_pair_on_insert on public.inv_products;
create trigger inv_pair_on_insert before insert on public.inv_products for each row execute function public.inv_pair_on_insert();

-- One name: a change on either side changes the other
create or replace function public.inv_name_to_item() returns trigger
 language plpgsql security definer set search_path to 'public'
as $$
begin
  if new.stock_item_id is not null and new.name is distinct from old.name then
    update stock_items set name = new.name, data = coalesce(data, '{}'::jsonb) || jsonb_build_object('name', new.name)
     where id = new.stock_item_id and name is distinct from new.name;
  end if;
  return new;
end $$;
drop trigger if exists inv_name_to_item on public.inv_products;
create trigger inv_name_to_item after update of name on public.inv_products for each row execute function public.inv_name_to_item();

create or replace function public.item_name_to_inv() returns trigger
 language plpgsql security definer set search_path to 'public'
as $$
begin
  if new.name is distinct from old.name and coalesce(trim(new.name), '') <> '' then
    update inv_products set name = new.name, updated_at = now() where stock_item_id = new.id and name is distinct from new.name;
  end if;
  return new;
end $$;
drop trigger if exists item_name_to_inv on public.stock_items;
create trigger item_name_to_inv after update of name on public.stock_items for each row execute function public.item_name_to_inv();

-- Products can't delete what Inventory holds
create or replace function public.item_keep_if_in_inventory() returns trigger
 language plpgsql security definer set search_path to 'public'
as $$
begin
  if exists (select 1 from inv_products where stock_item_id = old.id and active) then
    raise exception 'This product is in Inventory — delete it there (admins only)';
  end if;
  return old;
end $$;
drop trigger if exists item_keep_if_in_inventory on public.stock_items;
create trigger item_keep_if_in_inventory before delete on public.stock_items for each row execute function public.item_keep_if_in_inventory();

-- Packaging stays out of selling
do $$
declare d text;
begin
  d := pg_get_functiondef('public.inv_link_candidates'::regproc);
  if position('p.kind' in d) = 0 then
    execute replace(d, 'where p.active and p.status = ''live''', 'where p.active and p.status = ''live'' and p.kind = ''product''');
  end if;
  d := pg_get_functiondef('public.inv_product_picker'::regproc);
  if position('p.kind' in d) = 0 then
    execute replace(d, 'where p.active and', 'where p.active and p.kind = ''product'' and');
  end if;
  d := pg_get_functiondef('public.inv_overview'::regproc);
  if position('''kind'', p.kind' in d) = 0 then
    execute replace(d, '''active'', p.active,', '''active'', p.active, ''kind'', p.kind,');
  end if;
end $$;

-- Every inventory product with what Products needs: SKU, kind, stock on the shelves, on open orders, available
create or replace function public.inv_item_stock()
 returns table(product_id uuid, stock_item_id uuid, code text, name text, kind text, status text, on_hand numeric, on_orders numeric, available numeric)
 language sql stable security definer set search_path to 'public'
as $$
  with bal as (select b.product_id, sum(b.qty) q from inv_balances b group by 1),
       open as (select o.product_id, sum(o.units) u from public.inv_open_order_units() o group by 1)
  select p.id, p.stock_item_id, p.code, p.name, p.kind, p.status,
         coalesce(bal.q, 0), coalesce(open.u, 0), coalesce(bal.q, 0) - coalesce(open.u, 0)
  from inv_products p left join bal on bal.product_id = p.id left join open on open.product_id = p.id
  where p.active and public.sees_costs()
  order by p.name
$$;
revoke all on function public.inv_item_stock() from public, anon;
grant execute on function public.inv_item_stock() to authenticated;

-- Link an inventory product to a Products entry. The Inventory name becomes the one name; the Products
-- name, if different, is kept as the supplier's name for it.
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
           || jsonb_build_object('name', p.name, 'linkedByName', coalesce(p_by, ''), 'linkedAt', now()),
    name = p.name
   where id = p_item;
  update inv_products set stock_item_id = p_item, updated_at = now() where id = p_product;
end $$;
revoke all on function public.inv_link_stock_item(uuid, uuid, text) from public, anon;
grant execute on function public.inv_link_stock_item(uuid, uuid, text) to authenticated;

-- The Products side for inventory products that have none (details blank, filled in on Products)
create or replace function public.inv_pair_new_items(p_products uuid[], p_by text)
 returns int language plpgsql security definer set search_path to 'public'
as $$
declare p inv_products; n int := 0; sid uuid;
begin
  if not public.sees_costs() then raise exception 'Only the office creates products'; end if;
  for p in select * from inv_products where id = any(coalesce(p_products, '{}')) and active and stock_item_id is null loop
    insert into stock_items(name, data)
    values (p.name, jsonb_build_object('name', p.name, 'createdByName', coalesce(p_by, 'Inventory'), 'createdAt', now()))
    returning id into sid;
    update inv_products set stock_item_id = sid, updated_at = now() where id = p.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.inv_pair_new_items(uuid[], text) from public, anon;
grant execute on function public.inv_pair_new_items(uuid[], text) to authenticated;

-- A Products entry that isn't in Inventory yet: give it its SKU (and say if it's packaging)
create or replace function public.inv_add_from_stock_item(p_item uuid, p_code text, p_kind text, p_by text)
 returns uuid language plpgsql security definer set search_path to 'public'
as $$
declare s stock_items; id uuid; clash text;
begin
  if not public.sees_costs() then raise exception 'Only the office adds products'; end if;
  select * into s from stock_items where stock_items.id = p_item;
  if s.id is null then raise exception 'That Products entry isn''t there any more'; end if;
  if exists (select 1 from inv_products where stock_item_id = p_item) then raise exception '% is already in Inventory', s.name; end if;
  if coalesce(trim(p_code), '') = '' or upper(trim(p_code)) like 'NEW-%' then raise exception 'Give it its SKU'; end if;
  select name into clash from inv_products where code_key = public.inv_norm(p_code);
  if clash is not null then raise exception '% is already the SKU of %', upper(trim(p_code)), clash; end if;
  insert into inv_products(code, name, in_helm, status, created_by, kind, stock_item_id)
  values (upper(trim(p_code)), s.name, false, 'live', coalesce(p_by, 'office'), case when p_kind = 'packaging' then 'packaging' else 'product' end, p_item)
  returning inv_products.id into id;
  return id;
end $$;
revoke all on function public.inv_add_from_stock_item(uuid, text, text, text) from public, anon;
grant execute on function public.inv_add_from_stock_item(uuid, text, text, text) to authenticated;

-- Packaging or product: the office says which
create or replace function public.inv_set_kind(p_product uuid, p_kind text)
 returns void language plpgsql security definer set search_path to 'public'
as $$
begin
  if not public.sees_costs() then raise exception 'Only the office changes this'; end if;
  if p_kind not in ('product', 'packaging') then raise exception 'Product or packaging'; end if;
  update inv_products set kind = p_kind, updated_at = now() where id = p_product;
end $$;
revoke all on function public.inv_set_kind(uuid, text) from public, anon;
grant execute on function public.inv_set_kind(uuid, text) to authenticated;

-- Deleting a product in Inventory archives its Products entry with it (kept, can be restored there)
do $$
declare d text;
begin
  d := pg_get_functiondef('public.inv_delete_product'::regproc);
  if position('archived'', true' in d) = 0 then
    execute replace(d, '  if not p_dry then
    if outcome = ''blocked'' then',
      '  if not p_dry then
    if outcome <> ''blocked'' and p.stock_item_id is not null then
      update stock_items set data = coalesce(data, ''{}''::jsonb) || jsonb_build_object(''archived'', true) where id = p.stock_item_id;
    end if;
    if outcome = ''blocked'' then');
  end if;
end $$;
