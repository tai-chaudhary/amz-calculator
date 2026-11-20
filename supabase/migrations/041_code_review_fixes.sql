-- From the review of the item-code work:
--   • a product can't be given a code that is already a packing-slip code linked in Item codes,
--     or a HELM pack code: our own SKU always wins, so it would quietly take over those orders
--   • links that count for stock are only made through Item codes (inv_link_code): the old
--     inv_save_sku / inv_import_sales can no longer write 'portal' rows
--   • a SKU changed: the old code becomes a verified code for the new one, so slips and HELM
--     orders that still carry the old SKU keep taking the right stock
--   • one link per code however it's spelled
-- Safe to re-run. Applied 18 Oct.

create or replace function public.inv_code_clash(p_code text)
 returns text
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select case
    when exists (select 1 from inv_channel_skus x where x.source = 'portal' and public.inv_norm(x.sku) = public.inv_norm(p_code)
                   and jsonb_array_length(coalesce(x.items, '[]'::jsonb)) > 0)
      then p_code || ' is a packing-slip code already linked in Inventory → Item codes. Give the product its own SKU'
    when exists (select 1 from dispatch_item_units d where d.code_key = public.inv_norm(p_code)
                   and exists (select 1 from jsonb_array_elements(coalesce(d.components, '[]'::jsonb)) c
                               where public.inv_norm(c ->> 'code') <> d.code_key or coalesce(nullif(c ->> 'units', '')::numeric, 1) <> 1))
      then p_code || ' is a HELM pack code (more than one product, or more than one in it). Give the product its own SKU'
  end
$function$;
revoke all on function public.inv_code_clash(text) from public, anon, authenticated;

create or replace function public.inv_save_product(p_id uuid, p jsonb, p_by text)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare rid uuid; office boolean := public.can_approve_products(); cur inv_products%rowtype; newcode text; newname text; clash text;
begin
  if not (public.inv_can_edit() or public.can_open('goods-in')) then raise exception 'Not allowed'; end if;
  if p_id is null then
    if coalesce(trim(p ->> 'name'), '') = '' then raise exception 'A product needs a name'; end if;
    newcode := upper(trim(coalesce(p ->> 'code', '')));
    if newcode = '' then
      if office then raise exception 'A product needs a SKU'; end if;
      newcode := 'NEW-' || lpad(nextval('inv_new_product_seq')::text, 4, '0');
    end if;
    if exists (select 1 from inv_products where code_key = public.inv_norm(newcode)) then
      raise exception 'There''s already a product with code %', newcode; end if;
    clash := public.inv_code_clash(newcode);
    if clash is not null then raise exception '%', clash; end if;
    insert into inv_products (code, name, in_helm, stock_item_id, created_by, status, requested_by, requested_at, approved_by, approved_at)
    values (newcode, trim(p ->> 'name'), coalesce((p ->> 'in_helm')::boolean, false), nullif(p ->> 'stock_item_id', '')::uuid, p_by,
            case when office then 'live' else 'pending' end,
            case when office then null else p_by end, case when office then null else now() end,
            case when office then p_by end, case when office then now() end)
    returning id into rid;
    return rid;
  end if;
  if not public.inv_can_edit() then raise exception 'Not allowed'; end if;
  select * into cur from inv_products where id = p_id;
  if not found then raise exception 'No such product'; end if;
  newcode := case when p ? 'code' and trim(p ->> 'code') <> '' then upper(trim(p ->> 'code')) else cur.code end;
  newname := case when p ? 'name' and trim(p ->> 'name') <> '' then trim(p ->> 'name') else cur.name end;
  if (newcode <> cur.code or newname <> cur.name) and not office then
    raise exception 'Only the office can change a product''s name or SKU'; end if;
  if newcode <> cur.code and exists (select 1 from inv_products where code_key = public.inv_norm(newcode) and id <> p_id) then
    raise exception 'There''s already a product with code %', newcode; end if;
  if newcode <> cur.code then
    clash := public.inv_code_clash(newcode);
    if clash is not null then raise exception '%', clash; end if;
  end if;
  update inv_products set
    code = newcode,
    name = newname,
    stamp_name = case when p ? 'stamp_name' and office then nullif(trim(p ->> 'stamp_name'), '') else stamp_name end,
    in_helm = case when p ? 'in_helm' then (p ->> 'in_helm')::boolean else in_helm end,
    stock_item_id = case when p ? 'stock_item_id' then nullif(p ->> 'stock_item_id', '')::uuid else stock_item_id end,
    min_pick = case when p ? 'min_pick' then nullif(p ->> 'min_pick', '')::int else min_pick end,
    daily_override = case when p ? 'daily_override' then nullif(p ->> 'daily_override', '')::numeric else daily_override end,
    override_until = case when p ? 'override_until' then nullif(p ->> 'override_until', '')::date else override_until end,
    lead_days = case when p ? 'lead_days' then nullif(p ->> 'lead_days', '')::int else lead_days end,
    note = case when p ? 'note' then nullif(p ->> 'note', '') else note end,
    active = case when p ? 'active' then (p ->> 'active')::boolean else active end
  where id = p_id;
  if newcode <> cur.code then perform public.inv_rename_sku(cur.code, newcode, p_by); end if;
  perform public.inv_check_replenish(p_id);
  return p_id;
end $function$;

create or replace function public.inv_approve_product(p_id uuid, p_code text, p_name text, p_stamp text, p_by text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare cur inv_products%rowtype; newcode text := upper(trim(coalesce(p_code, '')));
begin
  if not public.can_approve_products() then raise exception 'Only the office can approve products'; end if;
  select * into cur from inv_products where id = p_id;
  if not found then raise exception 'No such product'; end if;
  if newcode = '' or coalesce(trim(p_name), '') = '' then raise exception 'It needs a name and a SKU'; end if;
  if newcode like 'NEW-%' then raise exception 'Give it its real SKU'; end if;
  if exists (select 1 from inv_products where code_key = public.inv_norm(newcode) and id <> p_id) then
    raise exception 'There''s already a product with code %', newcode; end if;
  if newcode <> cur.code and public.inv_code_clash(newcode) is not null then raise exception '%', public.inv_code_clash(newcode); end if;
  update inv_products set code = newcode, name = trim(p_name), stamp_name = nullif(trim(coalesce(p_stamp, '')), ''),
    status = 'live', approved_by = p_by, approved_at = now()
  where id = p_id;
  if newcode <> cur.code then perform public.inv_rename_sku(cur.code, newcode, p_by); end if;
end $function$;

create or replace function public.inv_link_code(p_code text, p_name text, p_items jsonb, p_kind text, p_wanted text, p_by text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare k text := public.inv_norm(p_code); it record; existed boolean; n int; taken numeric := 0;
begin
  if not public.can_link_codes() then raise exception 'You don''t have permission to link item codes'; end if;
  if coalesce(k, '') = '' then raise exception 'No code to link'; end if;
  if exists (select 1 from inv_products where code_key = k) then raise exception '% is already one of our SKUs', p_code; end if;
  if coalesce(p_kind, 'same') not in ('same', 'substitute') then raise exception 'Say whether it''s the same product or sent instead'; end if;
  if p_kind = 'substitute' and coalesce(btrim(p_wanted), '') = '' then raise exception 'Say which product the listing should be'; end if;
  -- One link per code however it's spelled ("ABC-1" and "abc1" are the same code): keep the spelling already there
  p_code := coalesce((select x.sku from inv_channel_skus x where x.source = 'portal' and public.inv_norm(x.sku) = k
                      order by (x.how = 'person') desc, x.updated_at desc nulls last limit 1), p_code);
  n := 0;
  for it in select x ->> 'code' as code, nullif(x ->> 'qty', '')::numeric as qty from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) x loop
    n := n + 1;
    if not exists (select 1 from inv_products where code_key = public.inv_norm(it.code) and active) then raise exception 'No product with SKU %', it.code; end if;
    if exists (select 1 from inv_products where code_key = public.inv_norm(it.code) and status <> 'live') then raise exception '% is waiting for the office to approve it', it.code; end if;
    if it.qty is null or it.qty <= 0 or it.qty <> trunc(it.qty) then raise exception 'How many has to be a whole number above 0'; end if;
  end loop;
  existed := exists (select 1 from inv_channel_skus where source = 'portal' and sku = p_code and how = 'person' and jsonb_array_length(coalesce(items, '[]'::jsonb)) > 0);
  insert into inv_channel_skus (source, sku, title, items, how, updated_by, kind, wanted_name, verified_by, verified_at)
  values ('portal', p_code, p_name, coalesce(p_items, '[]'::jsonb), 'person', p_by, coalesce(p_kind, 'same'),
          case when p_kind = 'substitute' then btrim(p_wanted) end, p_by, now())
  on conflict (source, sku) do update set items = excluded.items, title = coalesce(excluded.title, inv_channel_skus.title),
    how = 'person', updated_by = p_by, updated_at = now(), kind = excluded.kind, wanted_name = excluded.wanted_name,
    verified_by = excluded.verified_by, verified_at = excluded.verified_at;
  insert into inv_code_log (code, title, items, kind, wanted_name, by_name, action)
  values (p_code, p_name, coalesce(p_items, '[]'::jsonb), coalesce(p_kind, 'same'), case when p_kind = 'substitute' then btrim(p_wanted) end, p_by,
          case when n = 0 then 'removed' when existed then 'changed' else 'verified' end);
  if n > 0 then taken := public.inv_link_catch_up(k, p_code, p_items, p_by); end if;
  update inv_meta set rates_at = null where id = 1;
  return jsonb_build_object('taken', taken);
end $function$;

-- A SKU changed: links follow it, and the old code becomes a verified code for the new one
create or replace function public.inv_rename_sku(p_old text, p_new text, p_by text)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare k text := public.inv_norm(p_old); n int;
begin
  update inv_channel_skus x
     set items = (select jsonb_agg(case when public.inv_norm(e ->> 'code') = k then jsonb_set(e, '{code}', to_jsonb(p_new)) else e end)
                  from jsonb_array_elements(x.items) e),
         updated_at = now()
   where x.source = 'portal'
     and exists (select 1 from jsonb_array_elements(coalesce(x.items, '[]'::jsonb)) e where public.inv_norm(e ->> 'code') = k);
  get diagnostics n = row_count;
  if n > 0 then
    insert into inv_code_log (code, title, items, kind, by_name, action)
    values (p_old, concat('SKU ', p_old, ' is now ', p_new), jsonb_build_array(jsonb_build_object('code', p_new)), 'same', p_by, 'sku renamed');
  end if;
  -- Orders still carrying the old SKU (slips, HELM): 1 of the new. Not for the warehouse's temporary NEW-… codes
  if p_old not like 'NEW-%' and public.inv_norm(p_old) <> public.inv_norm(p_new) then
    insert into inv_channel_skus (source, sku, title, items, how, updated_by, kind, verified_by, verified_at)
    values ('portal', p_old, concat('Old SKU of ', p_new), jsonb_build_array(jsonb_build_object('code', p_new, 'qty', 1)), 'person', p_by, 'same', p_by, now())
    on conflict (source, sku) do nothing;
    insert into inv_code_log (code, title, items, kind, by_name, action)
    values (p_old, concat('Old SKU of ', p_new), jsonb_build_array(jsonb_build_object('code', p_new, 'qty', 1)), 'same', p_by, 'verified');
  end if;
  return n;
end $function$;
revoke all on function public.inv_rename_sku(text, text, text) from public, anon, authenticated;

-- Only Item codes makes links that count for stock
do $patch$
declare d text;
begin
  d := pg_get_functiondef('public.inv_save_sku(text,text,jsonb,text)'::regprocedure);
  if position('Item codes' in d) = 0 then
    execute replace(d, 'if not public.sees_costs() then raise exception ''Not allowed''; end if;',
      'if not public.sees_costs() then raise exception ''Not allowed''; end if;
  if p_source = ''portal'' then raise exception ''Link packing-slip codes in Inventory → Item codes''; end if;');
  end if;
  d := pg_get_functiondef('public.inv_import_sales(text,jsonb,jsonb,text)'::regprocedure);
  if position('Item codes' in d) = 0 then
    execute replace(d, 'if not public.sees_costs() then raise exception ''Only the office can import sales history''; end if;',
      'if not public.sees_costs() then raise exception ''Only the office can import sales history''; end if;
  if p_source = ''portal'' then raise exception ''Link packing-slip codes in Inventory → Item codes''; end if;');
  end if;
end $patch$;
