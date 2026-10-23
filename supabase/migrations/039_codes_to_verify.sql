-- Codes still to verify, suggestions to start from, and "sent instead" on the pick list.
--
-- • inv_codes_to_verify(): every code on an open order (uploaded labels, and
--   orders still in HELM) that isn't one of our SKUs and nobody has verified,
--   with how many orders wait on it and what HELM or the office suggests.
-- • Suggestions (inv_channel_skus, how = 'suggested') pre-fill the verify
--   screen. They never count for stock or stamps until a person verifies them.
-- • dispatch_pick_list: each product says when it's being sent instead of what
--   the listing is for (a code verified as "sent instead").
-- Safe to re-run. Applied 19 Oct.

create or replace function public.dispatch_code_info(p_codes text[])
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with c as (select distinct on (public.inv_norm(x)) x as code, public.inv_norm(x) as k from unnest(coalesce(p_codes, '{}')) x where coalesce(x, '') <> ''),
  r as (
    select c.code, c.k, p as own, l, u, sg
    from c
    left join inv_products p on p.code_key = c.k
    left join lateral (select * from inv_channel_skus x where x.source = 'portal' and x.how = 'person'
                         and public.inv_norm(x.sku) = c.k and jsonb_array_length(coalesce(x.items, '[]'::jsonb)) > 0 limit 1) l on true
    left join lateral (select * from dispatch_item_units d where d.code_key = c.k and jsonb_array_length(coalesce(d.components, '[]'::jsonb)) > 0) u on true
    left join lateral (select * from inv_channel_skus x where x.source = 'portal' and x.how = 'suggested'
                         and public.inv_norm(x.sku) = c.k and jsonb_array_length(coalesce(x.items, '[]'::jsonb)) > 0 limit 1) sg on true
  ),
  shaped as (
    select r.code, r.k,
      case when (r.own).id is not null then jsonb_build_array(jsonb_build_object('code', (r.own).code, 'name', (r.own).name, 'stamp', coalesce((r.own).stamp_name, (r.own).name), 'qty', 1, 'product_id', (r.own).id))
           when (r.l).sku is not null then (select jsonb_agg(jsonb_build_object('code', coalesce(p.code, li ->> 'code'), 'name', p.name, 'stamp', coalesce(p.stamp_name, p.name),
                                                                         'qty', coalesce(nullif(li ->> 'qty', '')::numeric, 1), 'product_id', p.id))
                                     from jsonb_array_elements((r.l).items) li left join inv_products p on p.code_key = public.inv_norm(li ->> 'code'))
           when (r.u).code_key is not null then (select jsonb_agg(jsonb_build_object('code', coalesce(p.code, ci ->> 'code'), 'name', coalesce(p.name, ci ->> 'name'), 'stamp', coalesce(p.stamp_name, p.name),
                                                                         'qty', coalesce(nullif(ci ->> 'units', '')::numeric, 1), 'product_id', p.id))
                                     from jsonb_array_elements((r.u).components) ci left join inv_products p on p.code_key = public.inv_norm(ci ->> 'code'))
      end as items,
      case when (r.sg).sku is not null then (select jsonb_agg(jsonb_build_object('code', coalesce(p.code, si ->> 'code'), 'name', p.name, 'stamp', coalesce(p.stamp_name, p.name),
                                                                         'qty', coalesce(nullif(si ->> 'qty', '')::numeric, 1), 'product_id', p.id))
                                     from jsonb_array_elements((r.sg).items) si left join inv_products p on p.code_key = public.inv_norm(si ->> 'code')) end as suggest,
      (r.sg).kind as suggest_kind, (r.sg).wanted_name as suggest_wanted,
      case when (r.own).id is not null then 'own' when (r.l).sku is not null then 'verified' when (r.u).code_key is not null then 'unverified' else 'unknown' end as status,
      (r.l).kind as kind, (r.l).wanted_name as wanted_name, (r.l).verified_by as verified_by, (r.l).verified_at as verified_at,
      (r.l).title as title
    from r
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'key', s.k, 'code', s.code,
      -- A verified code whose product has since gone: hold it like an unverified one
      'status', case when s.status = 'verified' and exists (select 1 from jsonb_array_elements(s.items) i where i ->> 'product_id' is null) then 'broken' else s.status end,
      'items', coalesce(s.items, '[]'::jsonb), 'kind', s.kind, 'wanted_name', s.wanted_name,
      'suggest', s.suggest, 'suggest_kind', s.suggest_kind, 'suggest_wanted', s.suggest_wanted,
      'verified_by', s.verified_by, 'verified_at', s.verified_at, 'title', s.title)), '[]'::jsonb)
  from shaped s
  where public.is_active_user()
$function$;

-- Every code on an open order that still needs a person
create or replace function public.inv_codes_to_verify()
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare codes jsonb; info jsonb;
begin
  if not public.is_active_user() then return '[]'::jsonb; end if;
  with lines as (
    select li ->> 'code' as code, li ->> 'name' as name, l.upload_id::text || '|' || coalesce(l.order_key, l.id::text) as okey
    from dispatch_labels l cross join jsonb_array_elements(coalesce(l.items, '[]'::jsonb)) li
    where l.status in ('ready', 'held')
      and not exists (select 1 from inv_despatched d where d.order_key = l.upload_id::text || '|' || coalesce(l.order_key, l.id::text))
    union all
    select li ->> 'code', li ->> 'name', 'helm|' || h.id from public.helm_open_rows() h cross join jsonb_array_elements(coalesce(h.items, '[]'::jsonb)) li
  )
  select jsonb_agg(jsonb_build_object('code', x.code, 'name', x.name, 'orders', x.n)) into codes
  from (select min(code) as code, min(name) as name, count(distinct okey) as n from lines where coalesce(code, '') <> '' group by public.inv_norm(code)) x;
  select public.dispatch_code_info(array(select x ->> 'code' from jsonb_array_elements(coalesce(codes, '[]'::jsonb)) x)) into info;
  return (select coalesce(jsonb_agg(i || jsonb_build_object('name', c ->> 'name', 'orders', (c ->> 'orders')::int) order by (c ->> 'orders')::int desc), '[]'::jsonb)
          from jsonb_array_elements(coalesce(codes, '[]'::jsonb)) c
          join jsonb_array_elements(coalesce(info, '[]'::jsonb)) i on i ->> 'key' = public.inv_norm(c ->> 'code')
          where i ->> 'status' not in ('own', 'verified'));
end $function$;
revoke all on function public.inv_codes_to_verify() from public, anon;
grant execute on function public.inv_codes_to_verify() to authenticated;

-- The pick list says when a product goes instead of what the listing is for
create or replace function public.dispatch_pick_list(p_batches uuid[], p_all boolean)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare res jsonb;
begin
  if not (public.can_open('dispatch') or public.can_open('inventory')) then raise exception 'Not allowed'; end if;
  with lab as (
    select l.upload_id, coalesce(l.order_key, l.id::text) as order_key,
           (array_agg(l.items order by jsonb_array_length(l.items) desc))[1] as items,
           min(coalesce(nullif(l.channel_ref, ''), nullif(l.helm_order, ''), l.label_ref)) as ref,
           (array_agg(l.batch_id))[1] as batch_id,
           bool_and(l.status = 'dispatched') as gone
    from dispatch_labels l
    where l.batch_id = any(p_batches)
      and (l.status = 'ready' or (p_all and l.status = 'dispatched'))
    group by 1, 2
  ),
  units as (
    select lab.upload_id, lab.order_key, lab.ref, lab.batch_id, lab.gone, e.product_id, e.code, e.name, sum(e.units) as units
    from lab cross join lateral public.inv_expand(lab.items) e
    group by 1, 2, 3, 4, 5, 6, 7, 8
  ),
  per as (
    select u.product_id, min(u.code) as code, min(u.name) as helm_name, sum(u.units) as units,
           count(*) as orders,
           jsonb_agg(jsonb_build_object('upload_id', u.upload_id, 'order_key', u.order_key, 'ref', u.ref,
                                        'batch_id', u.batch_id, 'units', u.units, 'gone', u.gone)) as order_list
    from units u group by u.product_id, case when u.product_id is null then u.code end
  ),
  instead as (
    select distinct p.id as product_id, x.wanted_name
    from lab cross join jsonb_array_elements(coalesce(lab.items, '[]'::jsonb)) li
    join inv_channel_skus x on x.source = 'portal' and x.how = 'person' and x.kind = 'substitute'
                           and public.inv_norm(x.sku) = public.inv_norm(li ->> 'code')
    cross join jsonb_array_elements(x.items) xi
    join inv_products p on p.code_key = public.inv_norm(xi ->> 'code')
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'product_id', per.product_id,
      'code', coalesce(p.code, per.code),
      'name', coalesce(p.name, per.helm_name, per.code),
      'units', per.units,
      'orders', per.orders,
      'order_list', per.order_list,
      'instead', coalesce((select jsonb_agg(i.wanted_name) from instead i where i.product_id = per.product_id), '[]'::jsonb),
      'on_hand', coalesce((select sum(b.qty) from inv_balances b where b.product_id = per.product_id), 0),
      'locations', coalesce((select jsonb_agg(jsonb_build_object('code', b.location, 'qty', b.qty, 'pickable', l.pickable)
                                              order by l.pickable desc, b.qty asc, b.location)
                             from inv_balances b join inv_locations l on l.code = b.location
                             where b.product_id = per.product_id and b.qty > 0), '[]'::jsonb),
      'substitutes', coalesce((select jsonb_agg(jsonb_build_object('upload_id', d.upload_id, 'order_key', d.order_key,
                                  'sub_product_id', d.sub_product_id, 'sub_name', d.sub_name, 'units', d.units,
                                  'ordered_units', d.ordered_units, 'by', d.by_name))
                               from dispatch_substitutes d
                               where d.product_id = per.product_id
                                 and exists (select 1 from jsonb_array_elements(per.order_list) x
                                             where (x ->> 'upload_id')::uuid = d.upload_id and x ->> 'order_key' = d.order_key)), '[]'::jsonb)
    ) order by coalesce(p.name, per.helm_name, per.code)), '[]'::jsonb)
  into res
  from per left join inv_products p on p.id = per.product_id;
  return res;
end $function$;

-- Suggestions from the office (18 Oct), to start the verify screen from. A person still verifies each one.
insert into public.inv_channel_skus (source, sku, title, items, how, kind, wanted_name, updated_by) values
  ('portal', '366601900474', 'Pyrex Glass Measuring Jug 0.5L 500ml', '[{"code":"PYREX-JUG-GLASS-500ML","qty":1}]', 'suggested', 'same', null, 'Suggested'),
  ('portal', '366620801936', 'Pyrex 1 pint Measuring Jug', '[{"code":"PYREX-JUG-GLASS-500ML","qty":1}]', 'suggested', 'same', null, 'Suggested'),
  ('portal', '366634314044', 'Pyrex Measuring Jug 250ml', '[{"code":"PYREX-JUG-GLASS-250ML","qty":1}]', 'suggested', 'same', null, 'Suggested'),
  ('portal', '366636166702', 'Pyrex Mini Glass Measuring Jug 250ml', '[{"code":"PYREX-JUG-GLASS-250ML","qty":1}]', 'suggested', 'same', null, 'Suggested'),
  ('portal', 'JUNGLESCT-INSCTPUMPSPRY-60ML-X002', '2 x Jungle Formula Strong Insect Repellent Spray 60ml', '[{"code":"JUNGLE-INSECTRP-STRONG-60ML","qty":2}]', 'suggested', 'same', null, 'Suggested'),
  ('portal', 'PRIDEGROOM-300ML-PACKOF2-002', 'Pride & Groom 2 x Flea & Tick Dog Shampoo 300ml', '[{"code":"PRDGRM-DOGSHAMP-300ML","qty":2}]', 'suggested', 'same', null, 'Suggested'),
  ('portal', 'RADOX-SHOWERGEL-FEELAWAKE-225ML-X006', 'Radox Feel Awake 2-in-1 6 x 225ml', '[{"code":"RADOX-SHWRGEL-MEN-AWAKE-225ML","qty":6}]', 'suggested', 'same', null, 'Suggested'),
  ('portal', 'FLYWASP-KILLER-SANMEX-300ML-006', 'Fly & Wasp Killer Spray multipack', '[{"code":"SANMEX-FLY-WASP-KILLER-300ML","qty":6}]', 'suggested', 'same', null, 'Suggested'),
  ('portal', '366643105364', 'Swirl Liquid Jewellery Cleaner with Basket', '[{"code":"SWIRL-CLEANER-LIQUID-JEWELLER-145ML","qty":1}]', 'suggested', 'same', null, 'Suggested'),
  ('portal', 'PLENTY-KITROLL-FLEXISHE-12RL', 'Plenty FlexiSheets Kitchen Roll 12 Rolls', '[{"code":"PLENTY-KITROLL-FLEXISHE-2RL","qty":6}]', 'suggested', 'same', null, 'Suggested'),
  ('portal', '366706946770', 'Pyrex 500ml Glass Mixing Bowl, Pack of 2', '[{"code":"PYREX-BOWL-CLASSIC-GLASS-0.7L","qty":2}]', 'suggested', 'substitute', 'Pyrex 500ml Glass Mixing Bowl, Pack of 2', 'Suggested'),
  ('portal', 'PLENTY-ORGNAL-100SHTS-3PACK', 'Plenty Original 100 Sheets 3 Pack', '[{"code":"PLENTY-KITROLL-ULTRASRB-3RL-80SH","qty":1}]', 'suggested', 'substitute', 'Plenty Original 100 Sheets 3 Pack', 'Suggested'),
  ('portal', 'PLENTY-ORGNL-100SHEETS-6PK', 'Plenty Original 100 Sheets - 6 Rolls', '[{"code":"PLENTY-KITROLL-ULTRASRB-3RL-80SH","qty":2}]', 'suggested', 'substitute', 'Plenty Original 100 Sheets 6 Rolls', 'Suggested'),
  ('portal', '12x Plenty-Orignal-ND', 'Plenty Original 12 Rolls', '[{"code":"PLENTY-KITROLL-ULTRASRB-3RL-80SH","qty":4}]', 'suggested', 'substitute', 'Plenty Original 12 Rolls', 'Suggested'),
  ('portal', 'Plenty Kitchen Roll, Pack of -2Days', 'Plenty Kitchen Roll, Pack of 3', '[{"code":"PLENTY-KITROLL-ULTRASRB-3RL-80SH","qty":1}]', 'suggested', 'same', null, 'Suggested')
on conflict (source, sku) do nothing;

-- Verifying a code that only had a suggestion is logged as "verified", not "changed"
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
  n := 0;
  for it in select x ->> 'code' as code, nullif(x ->> 'qty', '')::numeric as qty from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) x loop
    n := n + 1;
    if not exists (select 1 from inv_products where code_key = public.inv_norm(it.code) and active) then raise exception 'No product with SKU %', it.code; end if;
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
  -- Gone out before it was verified: take it off now
  if n > 0 then taken := public.inv_link_catch_up(k, p_code, p_items, p_by); end if;
  update inv_meta set rates_at = null where id = 1;
  return jsonb_build_object('taken', taken);
end $function$;
