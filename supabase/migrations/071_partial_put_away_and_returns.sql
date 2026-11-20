-- 071: Put away in parts (warehouse feedback, Oct 2026). Putting some of a delivery on a shelf no longer closes it:
-- what's been put away is remembered per line (data.put_done) and the delivery stays "to put away" until every line
-- is done — or someone says the rest isn't going on a shelf. Every put-away is kept (data.put_away, a list).
-- Also: returns keep the tracking number on the return label. GI-0013 (Daler-Rowney, 48 of 288 put away) reopened.
-- Safe to re-run.

alter table returns add column if not exists return_tracking text;

drop function if exists public.inv_put_away(uuid, jsonb, text);
create or replace function public.inv_put_away(p_delivery uuid, p_lines jsonb, p_by text, p_finish boolean default false)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare d goods_in_deliveries%rowtype; l jsonb; n int := 0; u numeric := 0; pid uuid; sid uuid; s stock_items; linked inv_products;
        newcode text; made int := 0; note text; done jsonb; k text; left_total numeric := 0; closed boolean;
begin
  if not (public.can_open('goods-in') or public.inv_can_edit()) then raise exception 'Not allowed'; end if;
  if coalesce(trim(p_by), '') = '' then raise exception 'Say who put it away'; end if;
  select * into d from goods_in_deliveries where id = p_delivery for update;
  if not found then raise exception 'Delivery not found'; end if;
  if d.put_away_at is not null then raise exception '% has already been put away', d.ref; end if;
  done := coalesce(d.data -> 'put_done', '{}'::jsonb);

  for l in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    k := coalesce(nullif(l ->> 'key', ''), l ->> 'name');
    if (l ->> 'skip')::boolean is true then done := done || jsonb_build_object(k, 'skip'); continue; end if;
    if coalesce((l ->> 'units')::numeric, 0) <= 0 then continue; end if;
    sid := nullif(l ->> 'stock_item_id', '')::uuid;
    pid := nullif(l ->> 'product_id', '')::uuid;
    note := nullif(concat_ws(' · ', d.data ->> 'po_number', d.supplier_name), '');
    linked := null;
    if sid is not null then select * into linked from inv_products where stock_item_id = sid and active; end if;
    if sid is not null and linked.id is not null then
      if pid is not null and pid <> linked.id then
        if coalesce(trim(l ->> 'reason'), '') = '' then raise exception '% is on the PO — say why something else is going on the shelf', linked.name; end if;
        note := concat_ws(' · ', note, 'Sent instead of ' || linked.name || ': ' || trim(l ->> 'reason'));
      else pid := linked.id; end if;
    elsif sid is not null and pid is null then
      select * into s from stock_items where id = sid;
      if s.id is null then raise exception 'The product on the PO isn''t there any more'; end if;
      newcode := upper(trim(coalesce(s.data ->> 'sku', '')));
      if newcode = '' or newcode like 'NEW-%' or exists (select 1 from inv_products where code_key = public.inv_norm(newcode)) then
        newcode := 'NEW-' || lpad(nextval('inv_new_product_seq')::text, 4, '0');
      end if;
      insert into inv_products (code, name, in_helm, stock_item_id, created_by, status, requested_by, requested_at, approved_by, approved_at)
      values (newcode, s.name, false, sid, p_by, case when newcode like 'NEW-%' then 'pending' else 'live' end,
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
    done := done || jsonb_build_object(k, coalesce(case when jsonb_typeof(done -> k) = 'number' then (done ->> k)::numeric end, 0) + (l ->> 'units')::numeric);
    if sid is null and coalesce(l ->> 'name', '') <> '' then
      insert into inv_aliases (key, product_id) values ('name:' || public.inv_norm(l ->> 'name'), pid)
      on conflict (key) do update set product_id = excluded.product_id, updated_at = now();
    end if;
    perform public.inv_check_replenish(pid);
  end loop;

  -- What's still to go on a shelf, line by line (each line says how many it needs: expected)
  select coalesce(sum(greatest(0, coalesce((x ->> 'expected')::numeric, 0)
           - case when jsonb_typeof(done -> coalesce(nullif(x ->> 'key', ''), x ->> 'name')) = 'number' then (done ->> coalesce(nullif(x ->> 'key', ''), x ->> 'name'))::numeric
                  when done ->> coalesce(nullif(x ->> 'key', ''), x ->> 'name') = 'skip' then coalesce((x ->> 'expected')::numeric, 0) else 0 end)), 0)
    into left_total from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) x;
  closed := p_finish or left_total <= 0;

  update goods_in_deliveries set
    put_away_at = case when closed then now() end, put_away_by = case when closed then p_by else put_away_by end,
    data = data || jsonb_build_object('put_done', done,
      'put_away', coalesce(case when jsonb_typeof(data -> 'put_away') = 'array' then data -> 'put_away' end, '[]'::jsonb) || coalesce(p_lines, '[]'::jsonb),
      'put_away_log', coalesce(data -> 'put_away_log', '[]'::jsonb) || jsonb_build_array(jsonb_build_object('at', now(), 'by', p_by, 'units', u, 'lines', n, 'closed', closed)))
  where id = p_delivery;
  insert into activity_log (entity_type, entity_id, entity_name, action, detail, user_name, source)
  values ('delivery', d.id, d.ref, case when closed then 'Put away' else 'Partly put away' end,
          u || ' units onto ' || n || ' shelf' || case when n = 1 then '' else 'es' end
          || case when not closed then ' · ' || left_total || ' still to put away' else '' end
          || case when made > 0 then ' · ' || made || ' new in Inventory' else '' end, p_by, 'inventory');
  return jsonb_build_object('lines', n, 'units', u, 'made', made, 'left', left_total, 'closed', closed);
end $function$;
revoke all on function public.inv_put_away(uuid, jsonb, text, boolean) from public, anon;
grant execute on function public.inv_put_away(uuid, jsonb, text, boolean) to authenticated;

-- GI-0013: 48 of 288 went on a shelf; the rest is still to put away
update goods_in_deliveries set put_away_at = null, put_away_by = null,
  data = data || jsonb_build_object('put_done', jsonb_build_object('Scola Artmix Poster Paint Assorted Colours 12 x 600ml', 48))
where ref = 'GI-0013' and put_away_at is not null and not (data ? 'put_done');
