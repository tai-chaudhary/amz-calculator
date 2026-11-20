-- 076: A product changed on the PO follows into Goods In (Oct 2026). Safe to re-run.
--
-- Before: changing or swapping a product on a PO after its delivery was booked in left the booking on the old
-- product (pointing at a PO line that no longer existed), and Edit booking couldn't change it — so put-away would
-- have put the wrong product on the shelf.
--
-- Now, while a delivery isn't fully put away:
--   • A PO line renamed or given another product: the booked line follows it, and is marked "Check the quantity".
--   • A PO line swapped for another (taken off, new one added): the booked line moves to the new product, its
--     received count moves with it, and it's marked "Check the quantity". If more than one line was swapped at once,
--     the booked lines are marked "No longer on the order" and the team chooses which PO line each one is.
--   • Edit booking can change which PO line a booked line is, and confirm the quantity.
--   • Put-away refuses a line until its quantity is confirmed (or its product chosen).
--   • If some of that line is already on a shelf as the old product, nothing is switched: the delivery goes to the
--     office (Delivery problems) to correct the stock.

create or replace function public.po_refresh_status(p_po uuid) returns void
language plpgsql security definer set search_path = public as $$
declare total_qty numeric; total_got numeric; started boolean;
begin
  select coalesce(sum(qty), 0), coalesce(sum(least(coalesce(qty_received, 0), qty)), 0), bool_or(coalesce(qty_received, 0) > 0)
    into total_qty, total_got, started from purchase_order_items where po_id = p_po and coalesce(line_status, 'due') <> 'cancelled';
  update purchase_orders set status = case when total_qty > 0 and total_got >= total_qty then 'received'
      when started then 'partially_received' else 'awaiting_delivery' end
  where id = p_po and status not in ('draft', 'cancelled', 'completed');
end $$;
revoke all on function public.po_refresh_status(uuid) from public, anon;

-- How many of a booked line are already on a shelf (put_done is kept by line name)
create or replace function public.gi_line_done(d goods_in_deliveries, p_name text) returns numeric
language sql immutable as $$
  select case when jsonb_typeof(d.data -> 'put_done' -> p_name) = 'number' then (d.data -> 'put_done' ->> p_name)::numeric else 0 end
$$;

create or replace function public.poi_follow_goods_in() returns trigger
language plpgsql security definer set search_path = public as $$
declare d goods_in_deliveries%rowtype; ln jsonb; i int; changed boolean; orphans int; o_d uuid; o_i int; note text;
begin
  if tg_op = 'UPDATE' then
    if new.name is not distinct from old.name and new.stock_item_id is not distinct from old.stock_item_id
       and (new.data ->> 'packUnits') is not distinct from (old.data ->> 'packUnits') then return new; end if;
    for d in select * from goods_in_deliveries where po_id = new.po_id and put_away_at is null for update loop
      changed := false; note := null;
      for i in 0 .. jsonb_array_length(coalesce(d.lines, '[]')) - 1 loop
        ln := d.lines -> i;
        if (ln ->> 'po_item_id') is distinct from new.id::text then continue; end if;
        if public.gi_line_done(d, ln ->> 'name') > 0 then
          note := format('%s was changed on the PO to %s after some had gone on a shelf — correct the stock in Inventory', ln ->> 'name', new.name);
          continue;
        end if;
        d.lines := jsonb_set(d.lines, array[i::text], ln || jsonb_build_object('name', new.name, 'expected', new.qty, 'check_qty', true,
          'was_name', coalesce(ln ->> 'was_name', ln ->> 'name')));
        changed := true;
      end loop;
      if changed or note is not null then
        update goods_in_deliveries set lines = d.lines, updated_at = now(),
          office_status = case when note is not null and office_status = 'none' then 'open' else office_status end,
          office_note = case when note is not null then concat_ws(E'\n', office_note, note) else office_note end
        where id = d.id;
        insert into activity_log (entity_type, entity_id, entity_name, action, detail, user_name, source)
        values ('delivery', d.id, d.ref, 'Product changed on the PO', coalesce(note, format('Now %s — quantity to check', new.name)), 'Portal', 'goods-in');
      end if;
    end loop;
    return new;

  elsif tg_op = 'DELETE' then
    for d in select * from goods_in_deliveries where po_id = old.po_id and put_away_at is null for update loop
      changed := false; note := null;
      for i in 0 .. jsonb_array_length(coalesce(d.lines, '[]')) - 1 loop
        ln := d.lines -> i;
        if (ln ->> 'po_item_id') is distinct from old.id::text then continue; end if;
        if public.gi_line_done(d, ln ->> 'name') > 0 then
          note := format('%s was taken off the PO after some had gone on a shelf — correct the stock in Inventory', ln ->> 'name');
        end if;
        d.lines := jsonb_set(d.lines, array[i::text], (ln - 'po_item_id') || jsonb_build_object('removed_from_po', true,
          'old_po_item_id', old.id, 'was_name', coalesce(ln ->> 'was_name', ln ->> 'name')));
        changed := true;
      end loop;
      if changed then
        update goods_in_deliveries set lines = d.lines, updated_at = now(),
          office_status = case when note is not null and office_status = 'none' then 'open' else office_status end,
          office_note = case when note is not null then concat_ws(E'\n', office_note, note) else office_note end
        where id = d.id;
      end if;
    end loop;
    return old;

  else -- INSERT: a new line on the PO. If exactly one booked line lost its PO line, this is its replacement.
    select count(*) into orphans from goods_in_deliveries g, jsonb_array_elements(g.lines) x
      where g.po_id = new.po_id and g.put_away_at is null and (x ->> 'removed_from_po')::boolean is true
        and public.gi_line_done(g, x ->> 'name') = 0;
    if orphans <> 1 then return new; end if;
    if exists (select 1 from goods_in_deliveries g, jsonb_array_elements(g.lines) x where g.po_id = new.po_id and x ->> 'po_item_id' = new.id::text) then return new; end if;
    for d in select * from goods_in_deliveries where po_id = new.po_id and put_away_at is null for update loop
      for i in 0 .. jsonb_array_length(coalesce(d.lines, '[]')) - 1 loop
        ln := d.lines -> i;
        if (ln ->> 'removed_from_po')::boolean is true and public.gi_line_done(d, ln ->> 'name') = 0 then
          update goods_in_deliveries set updated_at = now(), lines = jsonb_set(lines, array[i::text],
            (ln - 'removed_from_po' - 'old_po_item_id') || jsonb_build_object('po_item_id', new.id, 'name', new.name, 'expected', new.qty, 'check_qty', true))
          where id = d.id;
          update purchase_order_items set qty_received = coalesce(qty_received, 0) + coalesce((ln ->> 'arrived')::numeric, 0) where id = new.id;
          insert into activity_log (entity_type, entity_id, entity_name, action, detail, user_name, source)
          values ('delivery', d.id, d.ref, 'Product changed on the PO', format('%s → %s — quantity to check', ln ->> 'name', new.name), 'Portal', 'goods-in');
        end if;
      end loop;
    end loop;
    perform public.po_refresh_status(new.po_id);
    return new;
  end if;
end $$;

drop trigger if exists poi_follow_goods_in_upd on purchase_order_items;
create trigger poi_follow_goods_in_upd after update on purchase_order_items for each row execute function public.poi_follow_goods_in();
drop trigger if exists poi_follow_goods_in_del on purchase_order_items;
create trigger poi_follow_goods_in_del before delete on purchase_order_items for each row execute function public.poi_follow_goods_in();
drop trigger if exists poi_follow_goods_in_ins on purchase_order_items;
create trigger poi_follow_goods_in_ins after insert on purchase_order_items for each row execute function public.poi_follow_goods_in();

-- Put-away can't take a line whose quantity isn't confirmed, or whose product isn't known
create or replace function public.gi_guard_put_away() returns trigger
language plpgsql set search_path = public as $$
declare ln jsonb;
begin
  for ln in select * from jsonb_array_elements(coalesce(new.lines, '[]')) loop
    if ((ln ->> 'check_qty')::boolean is true or (ln ->> 'removed_from_po')::boolean is true)
       and public.gi_line_done(new, ln ->> 'name') > public.gi_line_done(old, ln ->> 'name') then
      raise exception '% changed on the order — % before putting it away', ln ->> 'name',
        case when (ln ->> 'removed_from_po')::boolean is true then 'choose which product it is in Edit booking' else 'check the quantity in Edit booking' end;
    end if;
  end loop;
  return new;
end $$;
drop trigger if exists gi_guard_put_away on goods_in_deliveries;
create trigger gi_guard_put_away before update on goods_in_deliveries for each row execute function public.gi_guard_put_away();

-- The PO's lines for Edit booking: names and quantities only, never a price
create or replace function public.goods_in_po_lines(p_delivery uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name, 'qty', i.qty, 'qty_received', i.qty_received,
      'pack_units', nullif(i.data ->> 'packUnits', '')::numeric, 'note', i.line_note) order by i.created_at), '[]'::jsonb)
  from goods_in_deliveries d join purchase_order_items i on i.po_id = d.po_id
  where d.id = p_delivery and coalesce(i.line_status, 'due') <> 'cancelled' and (public.can_open('goods-in') or public.sees_costs())
$$;
revoke all on function public.goods_in_po_lines(uuid) from public, anon;
grant execute on function public.goods_in_po_lines(uuid) to authenticated;

-- Edit booking: as before, plus changing which PO line a booked line is, and confirming a quantity
create or replace function public.goods_in_edit(p_delivery uuid, p_fields jsonb, p_lines jsonb, p_by text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d goods_in_deliveries%rowtype; old jsonb; nl jsonb; i int; delta numeric; changes text[] := '{}'; k text;
        done numeric; probs boolean := false; out_lines jsonb := '[]'; old_item uuid; new_item uuid; it purchase_order_items%rowtype;
        old_arr numeric; new_arr numeric;
begin
  if not (public.can_open('goods-in') or public.sees_costs()) then raise exception 'Not allowed'; end if;
  if coalesce(trim(p_by), '') = '' then raise exception 'Say who''s editing it'; end if;
  select * into d from goods_in_deliveries where id = p_delivery for update;
  if not found then raise exception 'Delivery not found'; end if;
  if d.put_away_at is not null then raise exception '% has been put away — correct the put-away instead', d.ref; end if;
  if jsonb_array_length(coalesce(p_lines, '[]')) <> jsonb_array_length(coalesce(d.lines, '[]')) then raise exception 'The lines don''t match the booking'; end if;

  for i in 0 .. jsonb_array_length(d.lines) - 1 loop
    old := d.lines -> i; nl := p_lines -> i;
    k := old ->> 'name';
    done := public.gi_line_done(d, k);
    old_arr := coalesce((old ->> 'arrived')::numeric, (old ->> 'qty')::numeric, 0);
    new_arr := coalesce((nl ->> 'arrived')::numeric, 0);
    if new_arr < done then raise exception '% — % already put on a shelf, so it can''t be less than that', k, done; end if;
    old_item := nullif(old ->> 'po_item_id', '')::uuid;
    new_item := coalesce(nullif(nl ->> 'po_item_id', '')::uuid, old_item);

    if d.po_id is not null and new_item is distinct from old_item then
      -- Which product this line is: another line on the same order, not already on this booking
      if done > 0 then raise exception '% is already on a shelf — correct the put-away instead', k; end if;
      select * into it from purchase_order_items where id = new_item and po_id = d.po_id;
      if not found then raise exception 'That product isn''t on this order'; end if;
      if exists (select 1 from jsonb_array_elements(p_lines) with ordinality x(l, n) where n - 1 <> i and x.l ->> 'po_item_id' = new_item::text) then
        raise exception '% is already on another line of this booking', it.name;
      end if;
      if old_item is not null then update purchase_order_items set qty_received = greatest(0, coalesce(qty_received, 0) - old_arr) where id = old_item; end if;
      update purchase_order_items set qty_received = coalesce(qty_received, 0) + new_arr where id = new_item;
      changes := changes || format('Product: %s → %s', k, it.name);
      nl := (nl - 'removed_from_po' - 'old_po_item_id') || jsonb_build_object('po_item_id', new_item, 'name', it.name, 'expected', it.qty,
        'was_name', coalesce(old ->> 'was_name', k), 'check_qty', false);
      if new_arr <> old_arr then changes := changes || format('%s: arrived %s → %s', it.name, old_arr, new_arr); end if;
    else
      if d.kind <> 'unexpected' then nl := nl || jsonb_build_object('name', k); end if;  -- an order's product names come from the PO
      delta := new_arr - old_arr;
      if delta <> 0 then
        changes := changes || format('%s: arrived %s → %s', k, old_arr, new_arr);
        if d.po_id is not null and old_item is not null then
          update purchase_order_items set qty_received = greatest(0, coalesce(qty_received, 0) + delta) where id = old_item;
        end if;
      end if;
      if (old ->> 'check_qty')::boolean is true and (nl ->> 'check_qty')::boolean is not true then
        changes := changes || format('%s: quantity checked — %s', k, new_arr);
      end if;
    end if;
    if (nl ->> 'check_qty')::boolean is not true then nl := nl - 'check_qty'; end if;

    if coalesce((nl ->> 'damaged')::numeric, 0) <> coalesce((old ->> 'damaged')::numeric, 0) then changes := changes || format('%s: damaged %s → %s', k, coalesce(old ->> 'damaged', '0'), coalesce(nl ->> 'damaged', '0')); end if;
    if coalesce((nl ->> 'wrong_qty')::numeric, 0) <> coalesce((old ->> 'wrong_qty')::numeric, 0) then changes := changes || format('%s: wrong item %s → %s', k, coalesce(old ->> 'wrong_qty', '0'), coalesce(nl ->> 'wrong_qty', '0')); end if;
    if coalesce((nl ->> 'short_qty')::numeric, 0) <> coalesce((old ->> 'short_qty')::numeric, 0) then changes := changes || format('%s: short %s → %s', k, coalesce(old ->> 'short_qty', '0'), coalesce(nl ->> 'short_qty', '0')); end if;
    if d.kind = 'unexpected' and coalesce(nl ->> 'name', '') <> coalesce(old ->> 'name', '') then changes := changes || format('Product: %s → %s', old ->> 'name', nl ->> 'name'); end if;
    if coalesce((nl ->> 'damaged')::numeric, 0) > 0 or coalesce((nl ->> 'wrong_qty')::numeric, 0) > 0 or coalesce((nl ->> 'short_qty')::numeric, 0) > 0 then probs := true; end if;
    out_lines := out_lines || jsonb_build_array(nl);
  end loop;
  if coalesce(p_fields ->> 'delivery_note_no', '') is distinct from coalesce(d.delivery_note_no, '') then changes := changes || format('Delivery note: %s → %s', coalesce(d.delivery_note_no, '—'), coalesce(nullif(p_fields ->> 'delivery_note_no', ''), '—')); end if;
  if nullif(p_fields ->> 'cartons', '')::int is distinct from d.cartons then changes := changes || format('Cartons: %s → %s', coalesce(d.cartons::text, '—'), coalesce(nullif(p_fields ->> 'cartons', ''), '—')); end if;
  if nullif(p_fields ->> 'pallets', '')::int is distinct from d.pallets then changes := changes || format('Pallets: %s → %s', coalesce(d.pallets::text, '—'), coalesce(nullif(p_fields ->> 'pallets', ''), '—')); end if;
  if d.kind = 'unexpected' and coalesce(p_fields ->> 'supplier_name', '') <> coalesce(d.supplier_name, '') then changes := changes || format('Supplier: %s → %s', coalesce(d.supplier_name, '—'), p_fields ->> 'supplier_name'); end if;
  if array_length(changes, 1) is null then return jsonb_build_object('changed', 0); end if;

  update goods_in_deliveries set
    lines = out_lines,
    delivery_note_no = nullif(p_fields ->> 'delivery_note_no', ''),
    cartons = nullif(p_fields ->> 'cartons', '')::int, pallets = nullif(p_fields ->> 'pallets', '')::int,
    supplier_name = case when kind = 'unexpected' then coalesce(nullif(p_fields ->> 'supplier_name', ''), supplier_name) else supplier_name end,
    has_problems = case when kind = 'unexpected' then has_problems else probs end,
    office_status = case when kind <> 'unexpected' and probs and office_status = 'none' then 'open' else office_status end,
    data = data || jsonb_build_object('edits', coalesce(data -> 'edits', '[]'::jsonb) || jsonb_build_array(jsonb_build_object('at', now(), 'by', p_by, 'changes', to_jsonb(changes)))),
    updated_at = now()
  where id = p_delivery;

  if d.po_id is not null then perform public.po_refresh_status(d.po_id); end if;
  insert into activity_log (entity_type, entity_id, entity_name, action, detail, user_name, source)
  values ('delivery', d.id, d.ref, 'Booking edited', array_to_string(changes, ' · '), p_by, 'goods-in');
  return jsonb_build_object('changed', array_length(changes, 1), 'changes', to_jsonb(changes));
end $$;
revoke all on function public.goods_in_edit(uuid, jsonb, jsonb, text) from public, anon;
grant execute on function public.goods_in_edit(uuid, jsonb, jsonb, text) to authenticated;
