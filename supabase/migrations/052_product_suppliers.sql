-- A product's suppliers (v2.47.0)
--   One product can be bought from several suppliers. data.suppliers holds one entry per supplier: their code,
--   pack size, pack price and cost per unit from the last PO raised with them, when, and on which PO — plus
--   anything set by hand (lead time, preferred). Ordering from a new supplier adds them automatically.
--   The product's cost (what listing margins use) is the LAST PRICE ACTUALLY PAID: the latest PO line for it
--   that isn't a draft, cancelled or a credit note. The preferred supplier stays the product's supplier.
--   Rebuilt from the PO lines themselves, so editing an old PO can't overwrite a newer price.
-- Safe to re-run.

create or replace function public.supplier_key(t text) returns text language sql immutable as $$
  select regexp_replace(lower(coalesce(t, '')), '[^a-z0-9]+', '', 'g') $$;

-- Same supplier? Exact, or one name starting with the other ("Pricecheck" / "Pricecheck Brand Partners")
create or replace function public.same_supplier(a text, b text) returns boolean language sql immutable as $$
  select public.supplier_key(a) <> '' and public.supplier_key(b) <> ''
     and (public.supplier_key(a) = public.supplier_key(b)
          or (length(public.supplier_key(a)) >= 5 and length(public.supplier_key(b)) >= 5
              and (public.supplier_key(a) like public.supplier_key(b) || '%' or public.supplier_key(b) like public.supplier_key(a) || '%'))) $$;

create or replace function public.item_learn(p_item uuid, p_dry boolean default false)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare si stock_items; r record; list jsonb := '[]'::jsonb; e jsonb; idx int; per numeric; unit numeric;
        last jsonb := null; newdata jsonb; oldcost numeric; pref text;
begin
  select * into si from stock_items where id = p_item;
  if si.id is null then return null; end if;
  list := coalesce(case when jsonb_typeof(si.data -> 'suppliers') = 'array' then si.data -> 'suppliers' end, '[]'::jsonb);
  pref := coalesce((select x ->> 'name' from jsonb_array_elements(list) x where (x ->> 'preferred')::boolean limit 1), si.data ->> 'supplierName');

  for r in
    select i.unit_cost, i.supplier_sku, i.data as ldata, po.supplier_name, po.supplier_id, po.po_number, po.created_at
    from purchase_order_items i join purchase_orders po on po.id = i.po_id
    where i.stock_item_id = p_item and po.status not in ('draft', 'cancelled') and coalesce(po.kind, 'order') = 'order'
      and coalesce(i.line_status, '') <> 'cancelled' and coalesce(i.unit_cost, 0) > 0 and coalesce(po.supplier_name, '') <> ''
    order by po.created_at, i.created_at
  loop
    idx := (select o - 1 from jsonb_array_elements(list) with ordinality t(x, o) where public.same_supplier(x ->> 'name', r.supplier_name) limit 1);
    e := case when idx is null then '{}'::jsonb else list -> idx end;
    per := greatest(coalesce(nullif(r.ldata ->> 'packUnits', '')::numeric,
                             nullif(e ->> 'packUnits', '')::numeric,
                             case when public.same_supplier(si.data ->> 'supplierName', r.supplier_name) then nullif(si.data ->> 'packUnits', '')::numeric end,
                             1), 1);
    unit := round(r.unit_cost / per, 4);
    e := e || jsonb_build_object('name', coalesce(e ->> 'name', r.supplier_name), 'supplierId', r.supplier_id,
            'supplierSku', coalesce(nullif(r.supplier_sku, ''), e ->> 'supplierSku', ''),
            'packUnits', per, 'packPrice', case when per > 1 then r.unit_cost end, 'costPrice', unit,
            'lastPrice', unit, 'lastPackPrice', r.unit_cost, 'lastBoughtAt', r.created_at, 'lastPo', r.po_number,
            'orders', coalesce((e ->> 'orders')::int, 0) + 1);
    if idx is null then list := list || jsonb_build_array(e); else list := jsonb_set(list, array[idx::text], e); end if;
    last := jsonb_build_object('supplier', r.supplier_name, 'unit', unit, 'packUnits', per, 'packPrice', r.unit_cost, 'po', r.po_number, 'at', r.created_at);
  end loop;

  -- The product's own supplier is on its list even if never ordered here
  if coalesce(si.data ->> 'supplierName', '') <> ''
     and not exists (select 1 from jsonb_array_elements(list) x where public.same_supplier(x ->> 'name', si.data ->> 'supplierName')) then
    list := jsonb_build_array(jsonb_build_object('name', si.data ->> 'supplierName', 'supplierSku', coalesce(si.data ->> 'supplierSku', ''),
              'packUnits', nullif(si.data ->> 'packUnits', ''), 'packPrice', nullif(si.data ->> 'packPrice', ''), 'costPrice', nullif(si.data ->> 'costPrice', ''))) || list;
  end if;
  -- One preferred: the one marked, else the product's own supplier
  list := (select coalesce(jsonb_agg(x || jsonb_build_object('preferred', coalesce(public.same_supplier(x ->> 'name', pref), false)) order by o), '[]'::jsonb)
           from jsonb_array_elements(list) with ordinality t(x, o));

  newdata := coalesce(si.data, '{}'::jsonb) || jsonb_build_object('suppliers', list);
  oldcost := nullif(si.data ->> 'costPrice', '')::numeric;
  if last is not null then
    newdata := newdata || jsonb_build_object('lastPaid', last, 'costPrice', (last ->> 'unit'))
               || case when (last ->> 'packUnits')::numeric > 1
                       then jsonb_build_object('packUnits', (last ->> 'packUnits')::numeric, 'packPrice', (last ->> 'packPrice')::numeric)
                       else jsonb_build_object('packUnits', '', 'packPrice', '') end;
  end if;

  if not p_dry and newdata is distinct from si.data then
    update stock_items set data = newdata where id = p_item;
    if last is not null and oldcost is distinct from (last ->> 'unit')::numeric then
      insert into activity_log (entity_type, entity_id, entity_name, action, detail, user_name, source)
      values ('stock', si.id, si.name, 'Cost changed', 'Last price paid: ' || coalesce('£' || to_char(oldcost, 'FM9990.0000'), 'none') || ' → £'
              || to_char((last ->> 'unit')::numeric, 'FM9990.0000') || ' (' || (last ->> 'supplier') || ', ' || (last ->> 'po') || ')', 'Purchase order', 'stock');
    end if;
  end if;
  return jsonb_build_object('id', si.id, 'name', si.name, 'old', oldcost, 'new', (last ->> 'unit')::numeric,
                            'supplier', last ->> 'supplier', 'po', last ->> 'po', 'at', last ->> 'at', 'suppliers', jsonb_array_length(list));
end $$;
revoke all on function public.item_learn(uuid, boolean) from public, anon;

-- Keep it current: any change to a PO line, or a PO's status, relearns the products on it
create or replace function public.po_line_learn() returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if tg_op <> 'DELETE' and new.stock_item_id is not null then perform public.item_learn(new.stock_item_id); end if;
  if tg_op <> 'INSERT' and old.stock_item_id is not null and (tg_op = 'DELETE' or old.stock_item_id is distinct from new.stock_item_id) then
    perform public.item_learn(old.stock_item_id);
  end if;
  return null;
end $$;
drop trigger if exists po_line_learn on public.purchase_order_items;
create trigger po_line_learn after insert or update of unit_cost, stock_item_id, line_status, data, supplier_sku or delete
  on public.purchase_order_items for each row execute function public.po_line_learn();

create or replace function public.po_learn() returns trigger language plpgsql security definer set search_path to 'public' as $$
declare sid uuid;
begin
  if new.status is distinct from old.status or new.supplier_name is distinct from old.supplier_name or new.kind is distinct from old.kind then
    for sid in select distinct stock_item_id from purchase_order_items where po_id = new.id and stock_item_id is not null loop
      perform public.item_learn(sid);
    end loop;
  end if;
  return null;
end $$;
drop trigger if exists po_learn on public.purchase_orders;
create trigger po_learn after update of status, supplier_name, kind on public.purchase_orders for each row execute function public.po_learn();
