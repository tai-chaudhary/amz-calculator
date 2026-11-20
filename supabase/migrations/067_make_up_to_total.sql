-- 067: "Make up to a total" item codes (Oct 2026). A code can be N units each (e.g. Plenty Original 6pk = 6 rolls),
-- made up from packs (Ultrasorb 4pk = 4 rolls, 2pk = 2 rolls). For each order the total (quantity × N) is made up
-- the cheapest exact way, from each pack's cost — 1 → 4pk + 2pk, 2 → 3 × 4pk, 3 → 4 × 4pk + 2pk. If it can't be
-- made up exactly, the order holds for the office to decide. Stock, the pick list, stamps and the labels all use the
-- same combination. Safe to re-run.

alter table inv_channel_skus add column if not exists fill_per numeric;   -- units in one ordered item (6)
alter table inv_channel_skus add column if not exists fill_unit text;     -- what a unit is called ('rolls')

-- The cheapest exact way to make p_total from packs [{ code, units }]; fewest packs if two cost the same.
-- Returns [{ code, qty }] (qty = how many of that pack), or null if it can't be done exactly.
create or replace function public.inv_fill(p_packs jsonb, p_total int)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  packs jsonb := '[]'; pk jsonb; n int; i int; t int; u int; c numeric;
  best_cost numeric[]; best_n int[]; choice int[]; res jsonb := '[]'; cnt jsonb := '{}'; code text;
begin
  if p_total is null or p_total <= 0 or p_total > 5000 then return null; end if;
  -- each pack with its cost (last price paid on the product, or its cost price)
  for pk in select x from jsonb_array_elements(coalesce(p_packs, '[]')) x loop
    u := coalesce(nullif(pk->>'units', '')::numeric, nullif(pk->>'qty', '')::numeric, 0)::int;
    if u <= 0 then continue; end if;
    select coalesce(case when jsonb_typeof(si.data->'lastPaid') = 'object' then nullif(si.data->'lastPaid'->>'unit', '')::numeric end,
                    nullif(regexp_replace(coalesce(si.data->>'costPrice', ''), '[^0-9.]', '', 'g'), '')::numeric, 1)
      into c from inv_products ip left join stock_items si on si.id = ip.stock_item_id where ip.code_key = public.inv_norm(pk->>'code') limit 1;
    packs := packs || jsonb_build_array(jsonb_build_object('code', pk->>'code', 'units', u, 'cost', coalesce(c, 1)));
  end loop;
  n := jsonb_array_length(packs);
  if n = 0 then return null; end if;
  best_cost := array_fill(null::numeric, array[p_total + 1], array[0]);
  best_n := array_fill(null::int, array[p_total + 1], array[0]);
  choice := array_fill(null::int, array[p_total + 1], array[0]);
  best_cost[0] := 0; best_n[0] := 0;
  for t in 1..p_total loop
    for i in 0..n - 1 loop
      u := (packs->i->>'units')::int; c := (packs->i->>'cost')::numeric;
      if u <= t and best_cost[t - u] is not null then
        if best_cost[t] is null or best_cost[t - u] + c < best_cost[t] - 0.00001
           or (abs(best_cost[t - u] + c - best_cost[t]) <= 0.00001 and best_n[t - u] + 1 < best_n[t]) then
          best_cost[t] := best_cost[t - u] + c; best_n[t] := best_n[t - u] + 1; choice[t] := i;
        end if;
      end if;
    end loop;
  end loop;
  if best_cost[p_total] is null then return null; end if;
  t := p_total;
  while t > 0 loop
    i := choice[t]; code := packs->i->>'code';
    cnt := jsonb_set(cnt, array[code], to_jsonb(coalesce((cnt->>code)::int, 0) + 1));
    t := t - (packs->i->>'units')::int;
  end loop;
  select coalesce(jsonb_agg(jsonb_build_object('code', key, 'qty', value::int) order by key), '[]') into res from jsonb_each_text(cnt);
  return res;
end $$;
grant execute on function public.inv_fill(jsonb, int) to authenticated;

create or replace function public.inv_set_code_fill(p_code text, p_per numeric, p_unit text, p_by text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.can_link_codes() then raise exception 'You don''t have permission to link item codes'; end if;
  update inv_channel_skus set fill_per = nullif(p_per, 0), fill_unit = nullif(trim(coalesce(p_unit, '')), ''), updated_by = coalesce(p_by, updated_by), updated_at = now()
   where source = 'portal' and how = 'person' and public.inv_norm(sku) = public.inv_norm(p_code);
end $$;
revoke all on function public.inv_set_code_fill(text, numeric, text, text) from public, anon;
grant execute on function public.inv_set_code_fill(text, numeric, text, text) to authenticated;

-- Stock, pick lists and open orders: a make-up code takes the cheapest exact combination for its quantity
create or replace function public.inv_expand(p_items jsonb, p_mult numeric default 1)
 returns table(product_id uuid, code text, name text, units numeric)
 language sql stable security definer set search_path to 'public' as $function$
  with it as (
    select i ->> 'code' as code, i ->> 'name' as name,
           coalesce(nullif(regexp_replace(i ->> 'qty', '[^0-9.]', '', 'g'), '')::numeric, 0) * p_mult as qty
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) i
  ), own as (
    select it.code, it.name, it.qty, p.id as pid, p.code as pcode, p.name as pname, lk.items as link, lk.fill_per,
           (select u.components from dispatch_item_units u
             where u.code_key = public.inv_norm(it.code) and jsonb_array_length(coalesce(u.components, '[]'::jsonb)) > 0) as helm
    from it left join inv_products p on p.code_key = public.inv_norm(it.code)
    left join lateral (select x.items, x.fill_per from inv_channel_skus x
             where x.source = 'portal' and x.how = 'person' and public.inv_norm(x.sku) = public.inv_norm(it.code)
               and jsonb_array_length(coalesce(x.items, '[]'::jsonb)) > 0 limit 1) lk on true
    where it.qty > 0
  ), filled as (
    select o.*, case when o.pid is null and o.link is not null and o.fill_per > 0
                     then public.inv_fill(o.link, (o.qty * o.fill_per)::int) end as combo
    from own o
  )
  -- 1. our own SKU
  select o.pid, o.pcode, o.pname, o.qty from filled o where o.pid is not null
  union all
  -- 2a. made up to a total: the cheapest exact combination of packs
  select p.id, coalesce(p.code, ci ->> 'code'), coalesce(p.name, o.name), (ci ->> 'qty')::numeric
  from filled o cross join lateral jsonb_array_elements(o.combo) ci
  left join inv_products p on p.code_key = public.inv_norm(ci ->> 'code')
  where o.pid is null and o.link is not null and o.fill_per > 0 and o.combo is not null
  union all
  -- 2b. verified by a person
  select p.id, coalesce(p.code, li ->> 'code'), coalesce(p.name, o.name), o.qty * coalesce(nullif(li ->> 'qty', '')::numeric, 1)
  from filled o cross join lateral jsonb_array_elements(o.link) li
  left join inv_products p on p.code_key = public.inv_norm(li ->> 'code')
  where o.pid is null and o.link is not null and coalesce(o.fill_per, 0) <= 0
  union all
  -- 3. HELM's pack split (holds stock; an upload still asks a person to verify it)
  select p.id, coalesce(p.code, c ->> 'code'), coalesce(p.name, c ->> 'name', o.name), o.qty * coalesce(nullif(c ->> 'units', '')::numeric, 1)
  from filled o cross join lateral jsonb_array_elements(o.helm) c
  left join inv_products p on p.code_key = public.inv_norm(c ->> 'code')
  where o.pid is null and o.link is null and o.helm is not null
  union all
  -- 4. nothing known — or a make-up code that can't be made up exactly
  select null::uuid, o.code, o.name, o.qty from filled o
  where o.pid is null and ((o.link is null and o.helm is null) or (o.fill_per > 0 and o.combo is null))
$function$;

-- What each code is, for stamps at upload: make-up codes also carry their combination for 1–40 ordered
do $$ declare d text;
begin
  d := pg_get_functiondef('public.dispatch_code_info(text[])'::regprocedure);
  if position('fill_combos' in d) = 0 then
    d := replace(d, '(r.l).title as title', '(r.l).title as title, (r.l).fill_per as fill_per, (r.l).fill_unit as fill_unit,
      case when (r.l).fill_per > 0 then (select jsonb_object_agg(g::text, public.inv_fill((r.l).items, (g * (r.l).fill_per)::int)) from generate_series(1, 40) g) end as fill_combos');
    d := replace(d, '''title'', s.title)', '''title'', s.title, ''fill_per'', s.fill_per, ''fill_unit'', s.fill_unit, ''fill_combos'', s.fill_combos)');
    execute d;
  end if;
end $$;
