-- 079: Edit booking can add a product that arrived but wasn't booked in (Nov 2026). Safe to re-run.
--   • On an order: one of the PO's lines not on the booking yet — its received count goes up with it.
--   • With no order: any product (picked from Products, or typed).
--   • Shown in the booking's history as "Added: 12 × …".
do $mig$
declare d text;
begin
  d := pg_get_functiondef('public.goods_in_edit(uuid, jsonb, jsonb, text)'::regprocedure);
  if position('Added: %s × %s' in d) > 0 then return; end if;
  d := replace(d,
    $a$if jsonb_array_length(coalesce(p_lines, '[]')) <> jsonb_array_length(coalesce(d.lines, '[]')) then raise exception 'The lines don''t match the booking'; end if;$a$,
    $a$if jsonb_array_length(coalesce(p_lines, '[]')) < jsonb_array_length(coalesce(d.lines, '[]')) then raise exception 'The lines don''t match the booking'; end if;$a$);
  d := replace(d,
    $a$  if coalesce(p_fields ->> 'delivery_note_no', '') is distinct from coalesce(d.delivery_note_no, '')$a$,
    $a$  -- Products that arrived but weren't booked in, added now
  for i in jsonb_array_length(coalesce(d.lines, '[]')) .. jsonb_array_length(p_lines) - 1 loop
    nl := (p_lines -> i) - '_new' - 'check_qty' - 'removed_from_po' - 'old_po_item_id' - 'was_name';
    new_arr := coalesce((nl ->> 'arrived')::numeric, 0);
    if new_arr <= 0 then raise exception 'Say how many of % arrived', coalesce(nullif(nl ->> 'name', ''), 'the added product'); end if;
    if d.po_id is not null then
      new_item := nullif(nl ->> 'po_item_id', '')::uuid;
      select * into it from purchase_order_items where id = new_item and po_id = d.po_id;
      if not found then raise exception 'Choose a product from the order'; end if;
      if exists (select 1 from jsonb_array_elements(out_lines) x where x ->> 'po_item_id' = new_item::text) then raise exception '% is already on this booking', it.name; end if;
      update purchase_order_items set qty_received = coalesce(qty_received, 0) + new_arr where id = new_item;
      nl := nl || jsonb_build_object('name', it.name, 'expected', it.qty);
    elsif coalesce(trim(nl ->> 'name'), '') = '' then
      raise exception 'Choose the product you''re adding';
    end if;
    changes := changes || format('Added: %s × %s', new_arr, nl ->> 'name');
    if coalesce((nl ->> 'damaged')::numeric, 0) > 0 or coalesce((nl ->> 'wrong_qty')::numeric, 0) > 0 or coalesce((nl ->> 'short_qty')::numeric, 0) > 0 then probs := true; end if;
    out_lines := out_lines || jsonb_build_array(nl);
  end loop;
  if coalesce(p_fields ->> 'delivery_note_no', '') is distinct from coalesce(d.delivery_note_no, '')$a$);
  if position('Added: %s × %s' in d) = 0 then raise exception 'goods_in_edit has changed — patch not applied'; end if;
  execute d;
end $mig$;
