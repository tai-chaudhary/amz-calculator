-- Record corrections agreed with the owner on 16 Nov 2026 (see docs/COSTING_SCENARIOS.md, fix list A1–A4).
-- RUN on 16 Nov 2026 at 11:20, approved by the owner, followed by  select public.cost_rebuild();
-- Kept here as the record of what was done. Running it again stops with "already been made".
--   1. Glue order 205-5139624-8858732      substitute 16 → 4   (stock +12 Scola Multipurpose Craft Glue 5 Litre)
--   2. Salt order 206-4547069-2001937      pallet label 58 → 28; the two Evri labels of one bag tied to the order;
--                                          bulk order 58 → 30 (stock +30 Peacock White De-Icing Salt 10kg)
--   3. TidyZ "Pack of 12"                  203-3538541-7487560 → 12; 204-8292173-1233116 → 24;
--                                          202-6365177-2825960 → 4 in the first parcel, and the 8 sent on 3 Nov
--                                          changed from replacement to part of the order (stock −36 TidyZ Handy Bags)
-- Each order gets a "Record corrected" entry in the activity log.
do $$
declare
  u_glue uuid := '0d19b6f1-6f88-4a02-b3b3-657be5c55ff3';
  u_pallet uuid := '123af04f-e9fe-4d74-b9b7-cedd7f36b742';
  u_evri uuid := '3634beea-4e55-4c8b-94c0-06e526268270';
  u_tz uuid := '304f5621-c9df-4e31-a2b3-e896adc0a038';
  u_tz3 uuid := 'a2858cb8-e3f9-4080-be8b-656209f6d079';
  u_tz3b uuid := '4c9f3e62-b376-4452-b4fa-1d63c0f1f787';
  b_id uuid := '69ece645-4e61-4fa2-bffe-b5d0ee3c496c';
  evri1 numeric; pack1 numeric; sid uuid;
begin
  if exists (select 1 from activity_log where action = 'Record corrected' and entity_id = '205-5139624-8858732') then
    raise exception 'These corrections have already been made'; end if;
  -- 1. Glue order: 4 were sent, not 16
  update dispatch_substitutes set units = 4, note = concat_ws(' · ', note, 'Corrected 16-11-2026: 4 were sent, not 16 (confirmed by Taimoor)')
    where upload_id = u_glue and order_key = '205-5139624-8858732';
  if not found then raise exception 'glue substitute not found'; end if;
  perform public.inv_undo_despatch(u_glue, '205-5139624-8858732'); perform public.inv_despatch_order(u_glue, '205-5139624-8858732');

  -- 2. Salt order: 28 on the pallet (not 58) + two Evri parcels of one bag
  update dispatch_labels set items = '[{"qty": 28, "code": "PEACOC-SALT-WHITE-DEICING-10KG", "name": "Peacock White De-Icing Salt 10kg"}]'::jsonb,
      label_name = '28 X PEACOCK WHITE DE-ICING SALT 10KG', note = concat_ws(' · ', note, 'Corrected 16-11-2026: 28 bags went on the pallet, not 58 (confirmed by Taimoor)')
    where id = 'd2c8ba5e-f037-4305-a6a9-0166a96690e3';
  perform public.inv_undo_despatch(u_pallet, '206-4547069-2001937'); perform public.inv_despatch_order(u_pallet, '206-4547069-2001937');
  update dispatch_labels set channel_ref = '206-4547069-2001937', reason = 'order', note = concat_ws(' · ', note, 'Tied to order 206-4547069-2001937 on 16-11-2026: one of its two Evri parcels (the other 28 bags went by pallet)')
    where id in ('4c89a992-e8d4-4211-b3f4-da29a58ff05d', '5a33e35b-6326-4b33-9c73-0d1bf7f3a6df');
  perform public.inv_undo_despatch(u_evri, 'page-0'); perform public.inv_despatch_order(u_evri, 'page-0');
  perform public.inv_undo_despatch(u_evri, 'page-1'); perform public.inv_despatch_order(u_evri, 'page-1');
  update bulk_orders set units = 30, parcel_units = 2, pallet_units = 28,
      note = concat_ws(' · ', note, 'Corrected 16-11-2026: 30 bags in all — 28 by pallet and two Evri parcels of one bag (was entered as 58)') where id = b_id;
  perform public.bulk_order_cost(b_id);
  select x.cost into evri1 from public.parcels_cost(10, 1) x where x.carrier = 'Evri' limit 1;
  select p.stock_item_id into sid from inv_products p where p.code = 'PEACOC-SALT-WHITE-DEICING-10KG' limit 1;
  select c.cost into pack1 from public.parcel_pack_cost(sid, 1) c;
  if evri1 is null then raise exception 'no Evri rate'; end if;
  update bulk_order_money set parcel_shipping = 2 * evri1, packaging = 2 * coalesce(pack1, 0),
      shipping_total = coalesce(pallet_base, 0) + coalesce(fuel, 0) + 2 * evri1 + 2 * coalesce(pack1, 0),
      saving = case when parcels_alt is not null then parcels_alt - (coalesce(pallet_base, 0) + coalesce(fuel, 0) + 2 * evri1 + 2 * coalesce(pack1, 0)) end,
      notes = concat_ws('; ', notes, 'Two Evri parcels of one bag each, entered by hand on 16-11-2026') where order_id = b_id;

  -- 3. TidyZ "Pack of 12": 12 a pack
  perform public.inv_undo_despatch(u_tz, '203-3538541-7487560'); perform public.inv_despatch_order(u_tz, '203-3538541-7487560');
  perform public.inv_undo_despatch(u_tz, '204-8292173-1233116'); perform public.inv_despatch_order(u_tz, '204-8292173-1233116');
  update dispatch_labels set note = concat_ws(' · ', note, 'Corrected 16-11-2026: the pack of 12 was sent (stock had been taken as 1 a pack)')
    where id in ('fd9eca42-ab49-408a-8737-6790da9548df', 'db4947b6-62bd-46ce-970a-fda9ad30a182');
  update dispatch_labels set items = '[{"qty": 4, "code": "TIDYZ-HANDBAG-40CT", "name": "TidyZ Handy Bags 40 Count"}]'::jsonb,
      note = concat_ws(' · ', note, 'Corrected 16-11-2026: 4 packs went in this parcel (label said 1); the other 8 followed on 3 Nov (confirmed by Taimoor)')
    where id = 'b3f51b8e-1a4c-483e-bb5c-103ae9a4da12';
  perform public.inv_undo_despatch(u_tz3, '202-6365177-2825960'); perform public.inv_despatch_order(u_tz3, '202-6365177-2825960');
  update dispatch_labels set reason = 'order', note = concat_ws(' · ', note, 'Changed 16-11-2026 from replacement to order: these 8 were the rest of the order of 12, not a replacement (confirmed by Taimoor)')
    where id = 'c27124ac-537e-4657-b23e-1a96155b6229';
  perform public.inv_undo_despatch(u_tz3b, '202-6365177-2825960'); perform public.inv_despatch_order(u_tz3b, '202-6365177-2825960');

  insert into activity_log (user_name, entity_type, entity_id, entity_name, action, detail, before, after, source) values
   ('Claude','order','205-5139624-8858732','205-5139624-8858732','Record corrected','Substitute glue sent: 16 → 4. The substitute screen had multiplied 4 by 4. Stock +12 Scola Multipurpose Craft Glue 5 Litre. Confirmed by Taimoor 16-11-2026.','{"units":16}','{"units":4}','costing'),
   ('Claude','order','206-4547069-2001937','206-4547069-2001937','Record corrected','Pallet label 58 → 28 bags; the two Evri labels of one bag each tied to this order; bulk order 58 → 30. Stock +30 Peacock White De-Icing Salt 10kg. Confirmed by Taimoor 16-11-2026.','{"units":58}','{"units":30}','costing'),
   ('Claude','order','203-3538541-7487560','203-3538541-7487560','Record corrected','TidyZ pack of 12: stock out 1 → 12. Confirmed by Taimoor 16-11-2026.','{"units":1}','{"units":12}','costing'),
   ('Claude','order','204-8292173-1233116','204-8292173-1233116','Record corrected','TidyZ 2 × pack of 12: stock out 2 → 24. Confirmed by Taimoor 16-11-2026.','{"units":2}','{"units":24}','costing'),
   ('Claude','order','202-6365177-2825960','202-6365177-2825960','Record corrected','TidyZ pack of 12: first parcel 1 → 4; the 8 sent on 3 Nov changed from replacement to part of the order (12 in all). Confirmed by Taimoor 16-11-2026.','{"units":1,"replacement":8}','{"units":12}','costing');
end $$;
