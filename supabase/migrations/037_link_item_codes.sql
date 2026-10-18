-- Every code on an order belongs to an inventory product.
--
-- When HELM hasn't linked an order line to one of its products, it sends the
-- marketplace SKU (sometimes a barcode). Those codes matched nothing here, so
-- no stock was held for the order and nothing came off the shelf when it went.
--
-- Now a code is worked out, in turn, as:
--   1. a pack or set from HELM's product list (dispatch_item_units components)
--   2. a product's own code
--   3. a code linked to products in the portal (inv_channel_skus: the same
--      "what each SKU is" list Inventory set-up already keeps for sales)
-- and that applies everywhere stock is worked out: open orders (labels and
-- orders still in HELM), the pick list, New Orders' stock check and despatch.
--
-- inv_link_code() links a code from wherever it shows up. Anything that went
-- out under that code before it was linked comes off the shelves there and then.
-- Safe to re-run.
--
-- Applied 18 Oct: inv_expand, inv_open_order_units, helm_new_orders.
-- Not applied yet: inv_link_code, inv_code_links (waiting on the go-ahead).

create or replace function public.inv_expand(p_items jsonb, p_mult numeric default 1)
 returns table(product_id uuid, code text, name text, units numeric)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with it as (
    select i ->> 'code' as code, i ->> 'name' as name,
           coalesce(nullif(regexp_replace(i ->> 'qty', '[^0-9.]', '', 'g'), '')::numeric, 0) * p_mult as qty
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) i
  ), parts as (
    select coalesce(c ->> 'code', it.code) as code, coalesce(c ->> 'name', it.name) as name,
           it.qty * coalesce(nullif(c ->> 'units', '')::numeric, 1) as units
    from it
    left join dispatch_item_units u on u.code_key = public.inv_norm(it.code)
    left join lateral jsonb_array_elements(case when jsonb_array_length(coalesce(u.components, '[]'::jsonb)) > 0
                                                then u.components end) c on true
    where it.qty > 0
  ), linked as (
    -- What a person has said a code is, when it isn't a product's own code (never a guess:
    -- links learned automatically from order history, how = 'orders', don't count)
    select parts.code, parts.name, parts.units, s.items
    from parts
    left join lateral (
      select x.items from inv_channel_skus x
      where public.inv_norm(x.sku) = public.inv_norm(parts.code) and x.how = 'person'
        and jsonb_array_length(coalesce(x.items, '[]'::jsonb)) > 0
      order by (x.source = 'portal') desc, x.updated_at desc limit 1
    ) s on true
    where not exists (select 1 from inv_products p where p.code_key = public.inv_norm(parts.code))
  )
  select p.id, parts.code, parts.name, parts.units
  from parts join inv_products p on p.code_key = public.inv_norm(parts.code)
  union all
  select p.id, coalesce(p.code, si ->> 'code'), coalesce(p.name, linked.name),
         linked.units * coalesce(nullif(si ->> 'qty', '')::numeric, 1)
  from linked cross join lateral jsonb_array_elements(linked.items) si
  left join inv_products p on p.code_key = public.inv_norm(si ->> 'code')
  where linked.items is not null
  union all
  select null::uuid, linked.code, linked.name, linked.units from linked where linked.items is null
$function$;

-- Orders still in HELM go through the same rules as uploaded labels
create or replace function public.inv_open_order_units()
 returns table(product_id uuid, code text, name text, units numeric, order_key text, ref text, created_at timestamp with time zone, status text)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with o as (
    select l.upload_id::text || '|' || coalesce(l.order_key, l.id::text) as k,
           (array_agg(l.items order by jsonb_array_length(l.items) desc))[1] as items,
           min(coalesce(nullif(l.channel_ref, ''), nullif(l.helm_order, ''), l.customer)) as ref,
           min(l.created_at) as created_at,
           case when bool_or(l.status = 'held') then 'held' else 'waiting' end as status
    from dispatch_labels l
    where l.status in ('ready', 'held')
    group by 1
  )
  select e.product_id, e.code, e.name, sum(e.units), o.k, o.ref, o.created_at, o.status
  from o cross join lateral public.inv_expand(o.items) e
  where not exists (select 1 from inv_despatched d where d.order_key = o.k)
  group by e.product_id, e.code, e.name, o.k, o.ref, o.created_at, o.status
  union all
  select e.product_id, e.code, e.name, sum(e.units),
         'helm|' || h.id, coalesce(h.ref, h.order_number), coalesce(h.order_date, h.first_seen), h.phase
  from public.helm_open_rows() h
  cross join lateral public.inv_expand(h.units) e
  group by e.product_id, e.code, e.name, h.id, h.ref, h.order_number, h.order_date, h.first_seen, h.phase
$function$;

-- New Orders' stock check: the same rules
create or replace function public.helm_new_orders()
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with h as (
    select r.*, o.status as helm_status from public.helm_open_rows() r join helm_orders o on o.id = r.id
    where public.is_active_user()
  ), unit_rows as (
    select h.id, e.product_id, e.code, e.units as qty
    from h cross join lateral public.inv_expand(h.units) e
  ), prods as (select distinct product_id from unit_rows where product_id is not null),
  uploaded as (
    select o.product_id, sum(o.units) as units from public.inv_open_order_units() o
    where o.order_key not like 'helm|%' and o.product_id in (select product_id from prods)
    group by o.product_id
  )
  select jsonb_build_object(
    'today', (now() at time zone 'Europe/London')::date,
    'orders', coalesce((select jsonb_agg(jsonb_build_object(
        'id', h.id, 'order_number', h.order_number, 'ref', h.ref, 'channel', h.channel, 'carrier', h.carrier,
        'service', h.service, 'phase', h.phase, 'status', h.helm_status, 'items', h.items, 'order_date', h.order_date,
        'labelled_at', h.labelled_at, 'first_seen', h.first_seen, 'ship_day', h.ship_day,
        'units', (select coalesce(jsonb_agg(jsonb_build_object('product_id', r.product_id, 'code', r.code, 'qty', r.qty)), '[]'::jsonb)
                  from unit_rows r where r.id = h.id))
        order by h.order_date) from h), '[]'::jsonb),
    'stock', coalesce((select jsonb_object_agg(p.id, jsonb_build_object(
        'name', p.name, 'code', p.code,
        'on_hand', coalesce((select sum(b.qty) from inv_balances b where b.product_id = p.id and b.location <> ''), 0),
        'pick', coalesce((select sum(b.qty) from inv_balances b join inv_locations l on l.code = b.location
                          where b.product_id = p.id and l.pickable), 0),
        'uploaded', coalesce((select u.units from uploaded u where u.product_id = p.id), 0)))
      from inv_products p where p.id in (select product_id from prods)), '{}'::jsonb),
    'sync', (select to_jsonb(s) from helm_sync s),
    'cutoffs', (select cutoffs from helm_settings where id = 1)
  )
$function$;

-- ── Link a code to the product(s) it is ────────────────────────────────────
-- p_items: [{ "code": "<inventory product code>", "qty": <how many of it one of this code is> }, …]
-- An empty list takes the link away. Returns what came off the shelves for
-- orders that had already gone out under this code.
create or replace function public.inv_link_code(p_code text, p_name text, p_items jsonb, p_by text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare k text := public.inv_norm(p_code); u record; it record; pid uuid; taken numeric := 0;
begin
  if not public.inv_can_edit() then raise exception 'Not allowed'; end if;
  if coalesce(k, '') = '' then raise exception 'No code to link'; end if;
  if exists (select 1 from inv_products where code_key = k) then raise exception '% is already a product''s own code', p_code; end if;
  for it in select x ->> 'code' as code, coalesce(nullif(x ->> 'qty', '')::numeric, 1) as qty
            from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) x loop
    if not exists (select 1 from inv_products where code_key = public.inv_norm(it.code)) then
      raise exception 'No product with code %', it.code;
    end if;
    if it.qty <= 0 then raise exception 'How many has to be more than 0'; end if;
  end loop;

  insert into inv_channel_skus (source, sku, title, items, how, updated_by)
  values ('portal', p_code, p_name, coalesce(p_items, '[]'::jsonb), 'person', p_by)
  on conflict (source, sku) do update set items = excluded.items, title = coalesce(excluded.title, inv_channel_skus.title),
    how = 'person', updated_by = p_by, updated_at = now();

  -- Gone out before it was linked: take it off now
  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) > 0 then
    select * into u from inv_unmatched where code_key = k;
    if found and u.units > 0 then
      for it in select x ->> 'code' as code, coalesce(nullif(x ->> 'qty', '')::numeric, 1) as qty
                from jsonb_array_elements(p_items) x loop
        select id into pid from inv_products where code_key = public.inv_norm(it.code);
        perform public.inv_take(pid, u.units * it.qty, 'despatch', now(), null, 'linked|' || k, p_by,
                                'Gone out as ' || p_code || ' before it was linked');
        perform public.inv_check_replenish(pid);
        taken := taken + u.units * it.qty;
      end loop;
      delete from inv_unmatched where code_key = k;
    end if;
  end if;
  update inv_meta set rates_at = null where id = 1;
  return jsonb_build_object('taken', taken);
end $function$;
revoke all on function public.inv_link_code(text, text, jsonb, text) from public, anon;
grant execute on function public.inv_link_code(text, text, jsonb, text) to authenticated;

-- What each code is linked to, for showing next to it
create or replace function public.inv_code_links()
 returns table(code text, title text, items jsonb, source text, updated_by text, updated_at timestamptz)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select sku, title, items, source, updated_by, updated_at from inv_channel_skus
  where public.inv_can_edit() and jsonb_array_length(coalesce(items, '[]'::jsonb)) > 0
$function$;
revoke all on function public.inv_code_links() from public, anon;
grant execute on function public.inv_code_links() to authenticated;
