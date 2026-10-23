-- Packaging items (v2.44.0)
--   A packaging item is a Products entry marked data.packaging = true (and data.alsoSold = true when we sell
--   it too). Its Inventory side follows: kind 'packaging' (kept out of selling) unless it's also sold.
--   The Kite Packaging entries are packaging items.
-- Safe to re-run.

create or replace function public.item_kind_to_inv() returns trigger
 language plpgsql security definer set search_path to 'public'
as $$
declare k text := case when coalesce((new.data ->> 'packaging')::boolean, false) and not coalesce((new.data ->> 'alsoSold')::boolean, false)
                       then 'packaging' else 'product' end;
begin
  if tg_op = 'INSERT' or (new.data ->> 'packaging') is distinct from (old.data ->> 'packaging')
     or (new.data ->> 'alsoSold') is distinct from (old.data ->> 'alsoSold') then
    update inv_products set kind = k, updated_at = now() where stock_item_id = new.id and kind is distinct from k;
  end if;
  return new;
end $$;
drop trigger if exists item_kind_to_inv on public.stock_items;
create trigger item_kind_to_inv after insert or update of data on public.stock_items for each row execute function public.item_kind_to_inv();

-- Marking packaging in Inventory (Add product → "It's packaging") marks the Products entry too
create or replace function public.inv_kind_to_item() returns trigger
 language plpgsql security definer set search_path to 'public'
as $$
begin
  if new.stock_item_id is not null and (tg_op = 'INSERT' or new.kind is distinct from old.kind) and new.kind = 'packaging' then
    update stock_items set data = coalesce(data, '{}'::jsonb) || jsonb_build_object('packaging', true, 'alsoSold', false)
     where id = new.stock_item_id and not (coalesce((data ->> 'packaging')::boolean, false) and not coalesce((data ->> 'alsoSold')::boolean, false));
  end if;
  return new;
end $$;
drop trigger if exists inv_kind_to_item on public.inv_products;
create trigger inv_kind_to_item after insert or update of kind on public.inv_products for each row execute function public.inv_kind_to_item();

update stock_items set data = coalesce(data, '{}'::jsonb) || jsonb_build_object('packaging', true)
 where data ->> 'supplierName' ilike 'kite packaging%' and not coalesce((data ->> 'packaging')::boolean, false);

-- A packaging item's first delivery (Goods In) comes into Inventory as packaging
create or replace function public.inv_pair_on_insert() returns trigger
 language plpgsql security definer set search_path to 'public'
as $$
begin
  if new.stock_item_id is null then
    insert into stock_items(name, data)
    values (new.name, jsonb_build_object('name', new.name, 'createdByName', coalesce(new.created_by, 'Inventory'), 'createdAt', now()))
    returning id into new.stock_item_id;
  elsif exists (select 1 from stock_items s where s.id = new.stock_item_id
                and coalesce((s.data ->> 'packaging')::boolean, false) and not coalesce((s.data ->> 'alsoSold')::boolean, false)) then
    new.kind := 'packaging';
  end if;
  return new;
end $$;
