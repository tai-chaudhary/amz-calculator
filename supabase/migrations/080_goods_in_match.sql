-- 080: A delivery with no order, matched to a PO — or a PO raised from it (Nov 2026). Safe to re-run.
-- goods_in_match puts the delivery on the order properly: each booked line is linked to the order's line for the
-- same product (by product, then by name), the order's received counts go up, and its status follows. A line with
-- no match is marked "Product to choose" for Edit booking. Used by "Match to an order" and by "Raise a PO".
create or replace function public.goods_in_match(p_delivery uuid, p_po uuid, p_by text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d goods_in_deliveries%rowtype; po purchase_orders%rowtype; ln jsonb; out_lines jsonb := '[]'; i int;
        sid uuid; it purchase_order_items%rowtype; used uuid[] := '{}'; matched int := 0; missing text[] := '{}';
        arr numeric; who text;
begin
  if not public.sees_costs() then raise exception 'Only Purchasing can match a delivery to an order'; end if;
  who := coalesce(nullif(trim(p_by), ''), (select display_name from profiles where id = auth.uid()), 'Someone');
  select * into d from goods_in_deliveries where id = p_delivery for update;
  if not found then raise exception 'Delivery not found'; end if;
  select * into po from purchase_orders where id = p_po;
  if not found then raise exception 'Order not found'; end if;
  if d.po_id = p_po then return jsonb_build_object('matched', 0, 'already', true); end if;
  if d.po_id is not null then raise exception '% is already on %', d.ref, coalesce(d.data ->> 'po_number', 'another order'); end if;

  for i in 0 .. jsonb_array_length(coalesce(d.lines, '[]')) - 1 loop
    ln := d.lines -> i;
    arr := coalesce((ln ->> 'arrived')::numeric, (ln ->> 'qty')::numeric, 0);
    sid := coalesce(nullif(ln ->> 'stock_item_id', '')::uuid,
                    (select stock_item_id from inv_products where id = nullif(ln ->> 'product_id', '')::uuid));
    it := null;
    if sid is not null then
      select * into it from purchase_order_items where po_id = p_po and stock_item_id = sid and not (id = any (used))
        and coalesce(line_status, 'due') <> 'cancelled' order by created_at limit 1;
    end if;
    if it.id is null then
      select * into it from purchase_order_items where po_id = p_po and lower(trim(name)) = lower(trim(ln ->> 'name')) and not (id = any (used))
        and coalesce(line_status, 'due') <> 'cancelled' order by created_at limit 1;
    end if;
    if it.id is not null then
      used := used || it.id; matched := matched + 1;
      update purchase_order_items set qty_received = coalesce(qty_received, 0) + arr where id = it.id;
      ln := ln || jsonb_build_object('po_item_id', it.id, 'expected', it.qty,
        -- put-away keeps its count by name, so a line already partly on a shelf keeps its name
        'name', case when public.gi_line_done(d, ln ->> 'name') > 0 then ln ->> 'name' else it.name end);
    else
      missing := missing || (ln ->> 'name');
      ln := ln || jsonb_build_object('removed_from_po', true);
    end if;
    out_lines := out_lines || jsonb_build_array(ln);
  end loop;

  update goods_in_deliveries set po_id = p_po, kind = 'order', lines = out_lines, updated_at = now(),
    data = coalesce(data, '{}') || jsonb_build_object('po_number', po.po_number, 'matched_by', who, 'matched_at', now(), 'was_unexpected', true),
    office_status = case when array_length(missing, 1) is null then 'resolved' else office_status end,
    office_note = case when array_length(missing, 1) is null then concat_ws(E'\n', nullif(office_note, ''), 'Matched to ' || po.po_number) else office_note end,
    resolved_at = case when array_length(missing, 1) is null then now() else resolved_at end,
    resolved_by = case when array_length(missing, 1) is null then who else resolved_by end
  where id = p_delivery;
  perform public.po_refresh_status(p_po);

  insert into activity_log (entity_type, entity_id, entity_name, action, detail, user_name, source) values
    ('delivery', d.id, d.ref, 'Matched to an order', po.po_number || coalesce(' · not on the order: ' || array_to_string(missing, ', '), ''), who, 'goods-in'),
    ('purchase', po.id, po.po_number, 'Delivery matched', d.ref || format(' · %s of %s lines received', matched, jsonb_array_length(coalesce(d.lines, '[]'))), who, 'purchasing');
  return jsonb_build_object('matched', matched, 'missing', to_jsonb(missing), 'po_number', po.po_number);
end $$;
revoke all on function public.goods_in_match(uuid, uuid, text) from public, anon;
grant execute on function public.goods_in_match(uuid, uuid, text) to authenticated;
-- 080 (part 2): the morning database check also checks matching a no-order delivery to a PO
do $mig$ declare d text; begin
  d := pg_get_functiondef('public.db_selftest()'::regprocedure);
  if position('No-order delivery matched' in d) > 0 then return; end if;
  d := replace(d, $a$  out := out || jsonb_build_object('name', 'Only Purchasing sees costs (database rule)'$a$, $a$  begin
    insert into goods_in_deliveries (ref, kind, supplier_name, received_by, lines, data)
    values ('GI-SELFTEST', 'unexpected', 'Selftest', 'Selftest', jsonb_build_array(jsonb_build_object('name', 'Selftest P', 'arrived', 7)), '{}')
    returning id into did;
    r := public.po_save(jsonb_build_object('po_number', 'SELFTEST-PO', 'supplier_name', 'Selftest', 'status', 'awaiting_payment', 'total', 7),
      jsonb_build_array(jsonb_build_object('name', 'Selftest P', 'qty', 7, 'unit_cost', 1)), 'Selftest');
    pid := (r ->> 'id')::uuid;
    perform public.goods_in_match(did, pid, 'Selftest');
    select qty_received into n from purchase_order_items where po_id = pid;
    select (select kind from goods_in_deliveries where id = did) = 'order' and n = 7
      and (select status from purchase_orders where id = pid) = 'received' into ok;
    out := out || jsonb_build_object('name', 'No-order delivery matched to a PO is received on it', 'ok', coalesce(ok, false));
    raise exception 'SELFTEST_UNDO';
  exception when others then
    if sqlerrm <> 'SELFTEST_UNDO' then out := out || jsonb_build_object('name', 'No-order delivery matched to a PO', 'ok', false, 'detail', sqlerrm); end if;
  end;

  out := out || jsonb_build_object('name', 'Only Purchasing sees costs (database rule)'$a$);
  if position('No-order delivery matched' in d) = 0 then raise exception 'db_selftest has changed — patch not applied'; end if;
  execute d;
end $mig$;
