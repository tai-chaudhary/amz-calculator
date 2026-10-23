-- Goods In knows the product (v2.42.0)
--   A PO line is for a Product, and a Product is one inventory product, so put-away no longer asks
--   "which product is it?":
--   • Product already in Inventory → that's the product (locked). If something else really arrived,
--     the line says so, with a reason, and nothing is relinked.
--   • Product not in Inventory yet (its first delivery) → the inventory product is made at put-away from
--     the Product: same name, and its SKU (given when its listing was approved). No SKU yet → a NEW-… code
--     and "Office to verify", like any product the warehouse adds.
--   • A line with no Product (carrier charges, fees, equipment) isn't stock: nothing to put away.
-- Safe to re-run. Backwards-compatible: the old sheet's lines (product_id per line) still work.

-- A placeholder code is never a Product's SKU
create or replace function public.inv_name_to_item() returns trigger
 language plpgsql security definer set search_path to 'public'
as $$
begin
  if new.stock_item_id is not null and (tg_op = 'INSERT' or new.name is distinct from old.name or new.code is distinct from old.code
                                        or new.stock_item_id is distinct from old.stock_item_id) then
    update stock_items set name = new.name,
      data = coalesce(data, '{}'::jsonb) || jsonb_build_object('name', new.name)
             || case when new.code like 'NEW-%' then '{}'::jsonb else jsonb_build_object('sku', new.code) end
     where id = new.stock_item_id
       and (name is distinct from new.name or (new.code not like 'NEW-%' and coalesce(data ->> 'sku', '') is distinct from new.code));
  end if;
  return new;
end $$;

create or replace function public.inv_put_away_plan(p_delivery uuid)
 returns jsonb language sql stable security definer set search_path to 'public'
as $function$
  select coalesce(jsonb_agg(x.j order by x.n), '[]'::jsonb) from (
    select l.n, jsonb_build_object(
      'i', l.n, 'po_item_id', l.line ->> 'po_item_id', 'stock_item_id', i.stock_item_id,
      'name', coalesce(s.name, l.line ->> 'name'), 'po_name', l.line ->> 'name',
      'units', greatest(coalesce(nullif(l.line ->> 'arrived', '')::numeric, nullif(l.line ->> 'qty', '')::numeric, 0)
                        - coalesce(nullif(l.line ->> 'damaged', '')::numeric, 0), 0),
      -- product: on the PO and in Inventory · new: on the PO, first delivery · name: no Product, matched by name · none / not_stock
      'match', case when lp.id is not null then 'product'
                    when s.id is not null then 'new'
                    when nm.id is not null then 'name'
                    when i.stock_item_id is null and i.id is not null then 'not_stock'
                    else 'none' end,
      'product_id', coalesce(lp.id, nm.id),
      'product_name', coalesce(lp.name, nm.name), 'product_code', coalesce(lp.code, nm.code),
      'new_name', case when lp.id is null and s.id is not null then s.name end,
      'new_sku', case when lp.id is null and s.id is not null then nullif(s.data ->> 'sku', '') end
    ) j
    from goods_in_deliveries d
    cross join lateral jsonb_array_elements(d.lines) with ordinality as l(line, n)
    left join purchase_order_items i on i.id = nullif(l.line ->> 'po_item_id', '')::uuid
    left join stock_items s on s.id = i.stock_item_id
    left join inv_products lp on lp.stock_item_id = i.stock_item_id and lp.active
    left join lateral (
      select p.id, p.name, p.code from inv_products p
      where i.stock_item_id is null and p.active
        and (p.id = (select a.product_id from inv_aliases a where a.key = 'name:' || public.inv_norm(l.line ->> 'name'))
             or public.inv_norm(p.name) = public.inv_norm(l.line ->> 'name'))
      limit 1) nm on true
    where d.id = p_delivery and (public.can_open('goods-in') or public.inv_can_edit())
  ) x
$function$;

create or replace function public.inv_put_away(p_delivery uuid, p_lines jsonb, p_by text)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare d goods_in_deliveries%rowtype; l jsonb; n int := 0; u numeric := 0; pid uuid; sid uuid; s stock_items; linked inv_products;
        newcode text; made int := 0; note text;
begin
  if not (public.can_open('goods-in') or public.inv_can_edit()) then raise exception 'Not allowed'; end if;
  if coalesce(trim(p_by), '') = '' then raise exception 'Say who put it away'; end if;
  select * into d from goods_in_deliveries where id = p_delivery for update;
  if not found then raise exception 'Delivery not found'; end if;
  if d.put_away_at is not null then raise exception '% has already been put away', d.ref; end if;

  for l in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    if (l ->> 'skip')::boolean is true then continue; end if;
    if coalesce((l ->> 'units')::numeric, 0) <= 0 then continue; end if;
    sid := nullif(l ->> 'stock_item_id', '')::uuid;
    pid := nullif(l ->> 'product_id', '')::uuid;
    note := nullif(concat_ws(' · ', d.data ->> 'po_number', d.supplier_name), '');
    linked := null;
    if sid is not null then select * into linked from inv_products where stock_item_id = sid and active; end if;

    if sid is not null and linked.id is not null then
      -- The PO says which product it is
      if pid is not null and pid <> linked.id then
        if coalesce(trim(l ->> 'reason'), '') = '' then
          raise exception '% is on the PO — say why something else is going on the shelf', linked.name;
        end if;
        note := concat_ws(' · ', note, 'Sent instead of ' || linked.name || ': ' || trim(l ->> 'reason'));
      else
        pid := linked.id;
      end if;
    elsif sid is not null and pid is null then
      -- Its first delivery: the inventory product is made from the Product (once, even over several shelves)
      select * into s from stock_items where id = sid;
      if s.id is null then raise exception 'The product on the PO isn''t there any more'; end if;
      newcode := upper(trim(coalesce(s.data ->> 'sku', '')));
      if newcode = '' or newcode like 'NEW-%' or exists (select 1 from inv_products where code_key = public.inv_norm(newcode)) then
        newcode := 'NEW-' || lpad(nextval('inv_new_product_seq')::text, 4, '0');
      end if;
      insert into inv_products (code, name, in_helm, stock_item_id, created_by, status, requested_by, requested_at, approved_by, approved_at)
      values (newcode, s.name, false, sid, p_by,
              case when newcode like 'NEW-%' then 'pending' else 'live' end,
              case when newcode like 'NEW-%' then p_by end, case when newcode like 'NEW-%' then now() end,
              case when newcode like 'NEW-%' then null else p_by end, case when newcode like 'NEW-%' then null else now() end)
      returning id into pid;
      made := made + 1;
      insert into activity_log (entity_type, entity_id, entity_name, action, detail, user_name, source)
      values ('inventory', pid, s.name, 'Added to Inventory', 'First delivery, ' || d.ref || ' · ' || newcode, p_by, 'inventory');
    end if;
    if pid is null then raise exception 'Choose the product for %', l ->> 'name'; end if;

    perform public.inv_ensure_location(l ->> 'location', nullif(l ->> 'pickable', '')::boolean, p_by);
    insert into inv_movements (product_id, location, qty, kind, ref, ref_id, note, by_name)
    values (pid, l ->> 'location', (l ->> 'units')::numeric, 'goods_in', d.ref, d.id, note, p_by);
    n := n + 1; u := u + (l ->> 'units')::numeric;
    -- A line with no Product on the PO, matched by hand: remembered by its name for next time
    if sid is null and coalesce(l ->> 'name', '') <> '' then
      insert into inv_aliases (key, product_id) values ('name:' || public.inv_norm(l ->> 'name'), pid)
      on conflict (key) do update set product_id = excluded.product_id, updated_at = now();
    end if;
    perform public.inv_check_replenish(pid);
  end loop;

  update goods_in_deliveries set put_away_at = now(), put_away_by = p_by,
    data = data || jsonb_build_object('put_away', p_lines) where id = p_delivery;
  insert into activity_log (entity_type, entity_id, entity_name, action, detail, user_name, source)
  values ('delivery', d.id, d.ref, 'Put away', u || ' units onto ' || n || ' shelf' || case when n = 1 then '' else 'es' end
          || case when made > 0 then ' · ' || made || ' new in Inventory' else '' end, p_by, 'inventory');
  return jsonb_build_object('lines', n, 'units', u, 'made', made);
end $function$;
