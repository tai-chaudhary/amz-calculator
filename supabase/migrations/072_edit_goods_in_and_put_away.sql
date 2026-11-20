-- 072: Edit a Goods In booking, and correct a put-away (warehouse feedback, Oct 2026). Safe to re-run.
--
-- Editing a booking (before it's all put away): delivery note number, cartons, pallets, and each line's numbers —
-- arrived, damaged, wrong, short — plus, for deliveries with no order, the supplier and product names. On an order,
-- the PO's received quantities move by the difference, and its status follows. A line can't go below what's already
-- been put on a shelf. Every edit is kept (data.edits: who, when, what changed) and logged.
--
-- Correcting a put-away (any time, done or not): change the shelf and/or the number for one put-away line. Stock is
-- never edited backwards: the old shelf gets the units taken off and the new shelf gets them added, as stock
-- movements noted "Correction", so the history shows it. Refused if the old shelf no longer has that many (some
-- have been picked or moved) — say so and correct what's there. Kept in data.put_away (each line remembers what it
-- was) and logged.

create or replace function public.goods_in_edit(p_delivery uuid, p_fields jsonb, p_lines jsonb, p_by text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d goods_in_deliveries%rowtype; old jsonb; nl jsonb; i int; delta numeric; changes text[] := '{}'; k text;
        done numeric; total_qty numeric; total_got numeric; started boolean; probs boolean := false;
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
    done := case when jsonb_typeof(d.data -> 'put_done' -> k) = 'number' then (d.data -> 'put_done' ->> k)::numeric else 0 end;
    if coalesce((nl ->> 'arrived')::numeric, 0) < done then
      raise exception '% — % already put on a shelf, so it can''t be less than that', k, done;
    end if;
    delta := coalesce((nl ->> 'arrived')::numeric, 0) - coalesce((old ->> 'arrived')::numeric, (old ->> 'qty')::numeric, 0);
    if delta <> 0 then
      changes := changes || format('%s: arrived %s → %s', k, coalesce(old ->> 'arrived', old ->> 'qty', '0'), nl ->> 'arrived');
      if d.po_id is not null and (old ->> 'po_item_id') is not null then
        update purchase_order_items set qty_received = greatest(0, coalesce(qty_received, 0) + delta) where id = (old ->> 'po_item_id')::uuid;
      end if;
    end if;
    if coalesce((nl ->> 'damaged')::numeric, 0) <> coalesce((old ->> 'damaged')::numeric, 0) then changes := changes || format('%s: damaged %s → %s', k, coalesce(old ->> 'damaged', '0'), coalesce(nl ->> 'damaged', '0')); end if;
    if coalesce((nl ->> 'wrong_qty')::numeric, 0) <> coalesce((old ->> 'wrong_qty')::numeric, 0) then changes := changes || format('%s: wrong item %s → %s', k, coalesce(old ->> 'wrong_qty', '0'), coalesce(nl ->> 'wrong_qty', '0')); end if;
    if coalesce((nl ->> 'short_qty')::numeric, 0) <> coalesce((old ->> 'short_qty')::numeric, 0) then changes := changes || format('%s: short %s → %s', k, coalesce(old ->> 'short_qty', '0'), coalesce(nl ->> 'short_qty', '0')); end if;
    if d.kind = 'unexpected' and coalesce(nl ->> 'name', '') <> coalesce(old ->> 'name', '') then changes := changes || format('Product: %s → %s', old ->> 'name', nl ->> 'name'); end if;
    if coalesce((nl ->> 'damaged')::numeric, 0) > 0 or coalesce((nl ->> 'wrong_qty')::numeric, 0) > 0 or coalesce((nl ->> 'short_qty')::numeric, 0) > 0 then probs := true; end if;
  end loop;
  if coalesce(p_fields ->> 'delivery_note_no', '') is distinct from coalesce(d.delivery_note_no, '') then changes := changes || format('Delivery note: %s → %s', coalesce(d.delivery_note_no, '—'), coalesce(nullif(p_fields ->> 'delivery_note_no', ''), '—')); end if;
  if nullif(p_fields ->> 'cartons', '')::int is distinct from d.cartons then changes := changes || format('Cartons: %s → %s', coalesce(d.cartons::text, '—'), coalesce(nullif(p_fields ->> 'cartons', ''), '—')); end if;
  if nullif(p_fields ->> 'pallets', '')::int is distinct from d.pallets then changes := changes || format('Pallets: %s → %s', coalesce(d.pallets::text, '—'), coalesce(nullif(p_fields ->> 'pallets', ''), '—')); end if;
  if d.kind = 'unexpected' and coalesce(p_fields ->> 'supplier_name', '') <> coalesce(d.supplier_name, '') then changes := changes || format('Supplier: %s → %s', coalesce(d.supplier_name, '—'), p_fields ->> 'supplier_name'); end if;
  if array_length(changes, 1) is null then return jsonb_build_object('changed', 0); end if;

  update goods_in_deliveries set
    lines = p_lines,
    delivery_note_no = nullif(p_fields ->> 'delivery_note_no', ''),
    cartons = nullif(p_fields ->> 'cartons', '')::int, pallets = nullif(p_fields ->> 'pallets', '')::int,
    supplier_name = case when kind = 'unexpected' then coalesce(nullif(p_fields ->> 'supplier_name', ''), supplier_name) else supplier_name end,
    has_problems = case when kind = 'unexpected' then has_problems else probs end,
    office_status = case when kind <> 'unexpected' and probs and office_status = 'none' then 'open' else office_status end,
    data = data || jsonb_build_object('edits', coalesce(data -> 'edits', '[]'::jsonb) || jsonb_build_array(jsonb_build_object('at', now(), 'by', p_by, 'changes', to_jsonb(changes)))),
    updated_at = now()
  where id = p_delivery;

  if d.po_id is not null then
    select coalesce(sum(qty), 0), coalesce(sum(least(coalesce(qty_received, 0), qty)), 0), bool_or(coalesce(qty_received, 0) > 0)
      into total_qty, total_got, started from purchase_order_items where po_id = d.po_id and coalesce(line_status, 'due') <> 'cancelled';
    update purchase_orders set status = case when status = 'completed' then status when total_qty > 0 and total_got >= total_qty then 'received'
      when started then 'partially_received' else 'awaiting_delivery' end where id = d.po_id and status not in ('draft', 'cancelled');
  end if;
  insert into activity_log (entity_type, entity_id, entity_name, action, detail, user_name, source)
  values ('delivery', d.id, d.ref, 'Booking edited', array_to_string(changes, ' · '), p_by, 'goods-in');
  return jsonb_build_object('changed', array_length(changes, 1), 'changes', to_jsonb(changes));
end $$;
revoke all on function public.goods_in_edit(uuid, jsonb, jsonb, text) from public, anon;
grant execute on function public.goods_in_edit(uuid, jsonb, jsonb, text) to authenticated;

create or replace function public.inv_put_away_correct(p_delivery uuid, p_index int, p_location text, p_units numeric, p_reason text, p_by text, p_pickable boolean default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d goods_in_deliveries%rowtype; e jsonb; pid uuid; oldloc text; newloc text; oldu numeric; newu numeric; have numeric; k text; note text; done numeric;
begin
  if not (public.can_open('goods-in') or public.inv_can_edit()) then raise exception 'Not allowed'; end if;
  if coalesce(trim(p_by), '') = '' then raise exception 'Say who''s correcting it'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Say why it''s being corrected'; end if;
  select * into d from goods_in_deliveries where id = p_delivery for update;
  if not found then raise exception 'Delivery not found'; end if;
  e := d.data -> 'put_away' -> p_index;
  if e is null or coalesce((e ->> 'units')::numeric, 0) <= 0 or coalesce(e ->> 'location', '') = '' then raise exception 'That put-away line isn''t there'; end if;
  pid := nullif(e ->> 'product_id', '')::uuid;
  if pid is null and nullif(e ->> 'stock_item_id', '') is not null then select id into pid from inv_products where stock_item_id = (e ->> 'stock_item_id')::uuid and active; end if;
  if pid is null then raise exception 'Can''t tell which product that line was — correct it in Inventory'; end if;
  oldloc := e ->> 'location'; oldu := (e ->> 'units')::numeric;
  newloc := upper(trim(coalesce(nullif(p_location, ''), oldloc))); newu := greatest(0, coalesce(p_units, oldu));
  if newloc = oldloc and newu = oldu then return jsonb_build_object('changed', false); end if;
  select coalesce(sum(qty), 0) into have from inv_balances where product_id = pid and location = oldloc;
  if have < oldu then
    raise exception 'Only % left on % (the rest has been picked or moved) — correct it in Inventory instead', have, oldloc;
  end if;
  note := format('Correction %s: %s — %s', d.ref, trim(p_reason), p_by);
  insert into inv_movements (product_id, location, qty, kind, ref, ref_id, note, by_name) values (pid, oldloc, -oldu, 'goods_in', d.ref, d.id, note, p_by);
  if newu > 0 then
    perform public.inv_ensure_location(newloc, p_pickable, p_by);
    insert into inv_movements (product_id, location, qty, kind, ref, ref_id, note, by_name) values (pid, newloc, newu, 'goods_in', d.ref, d.id, note, p_by);
  end if;
  k := coalesce(nullif(e ->> 'key', ''), e ->> 'name');
  done := case when jsonb_typeof(d.data -> 'put_done' -> k) = 'number' then (d.data -> 'put_done' ->> k)::numeric else 0 end;
  update goods_in_deliveries set data = jsonb_set(
      jsonb_set(data, array['put_away', p_index::text], e || jsonb_build_object('location', newloc, 'units', newu,
        'was', jsonb_build_object('location', oldloc, 'units', oldu), 'corrected_by', p_by, 'corrected_at', now(), 'correction', trim(p_reason))),
      array['put_done', k], to_jsonb(greatest(0, done - oldu + newu)), true),
    updated_at = now()
  where id = p_delivery;
  perform public.inv_check_replenish(pid);
  insert into activity_log (entity_type, entity_id, entity_name, action, detail, user_name, source)
  values ('delivery', d.id, d.ref, 'Put-away corrected', format('%s: %s on %s → %s on %s · %s', e ->> 'name', oldu, oldloc, newu, newloc, trim(p_reason)), p_by, 'inventory');
  return jsonb_build_object('changed', true);
end $$;
revoke all on function public.inv_put_away_correct(uuid, int, text, numeric, text, text, boolean) from public, anon;
grant execute on function public.inv_put_away_correct(uuid, int, text, numeric, text, text, boolean) to authenticated;
