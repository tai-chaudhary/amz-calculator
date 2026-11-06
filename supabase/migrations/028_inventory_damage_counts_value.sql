-- ── Inventory: damages, daily cycle counts, stock value and slow stock ─────
-- Damages: the warehouse reports damaged stock with a reason (and a photo);
-- the units come off the shelf into "damaged" straight away, and the office
-- decides: write off, send back to the supplier, or put back on a shelf.
-- Cycle counts: a few shelves to count every day, so stock stays right
-- without a full stock-take. Value and slow stock: office only.

alter table inv_movements drop constraint if exists inv_movements_kind_check;
alter table inv_movements add constraint inv_movements_kind_check check (kind in
  ('opening', 'count', 'goods_in', 'move', 'add', 'remove', 'despatch', 'despatch_undo', 'damage', 'damage_restock'));

-- ── Damages ──

create sequence if not exists inv_damage_seq;
create table if not exists inv_damages (
  id uuid primary key default gen_random_uuid(),
  ref text unique not null default ('DM-' || lpad(nextval('inv_damage_seq')::text, 4, '0')),
  product_id uuid not null references inv_products(id) on delete cascade,
  location text,
  qty numeric not null check (qty > 0),
  reason text not null,
  note text,
  photo_path text,
  reported_by text not null,
  reported_at timestamptz not null default now(),
  status text not null default 'open',           -- open | written_off | returned | restocked
  resolved_by text, resolved_at timestamptz, resolution_note text, restock_location text
);
create index if not exists inv_damages_status_idx on inv_damages(status, reported_at desc);
create index if not exists inv_damages_product_idx on inv_damages(product_id);
alter table inv_damages enable row level security;
drop policy if exists "Read inventory" on inv_damages;
create policy "Read inventory" on inv_damages for select to authenticated using (public.is_active_user());

-- Damage photos go with the Goods In photos; anyone in Inventory can add and see them
drop policy if exists "Goods in read photos" on storage.objects;
drop policy if exists "Goods in add photos" on storage.objects;
create policy "Goods in read photos" on storage.objects for select to authenticated
  using (bucket_id = 'goods-in-photos' and (public.can_open('goods-in') or public.can_open('inventory') or public.sees_costs()));
create policy "Goods in add photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'goods-in-photos' and (public.can_open('goods-in') or public.can_open('inventory') or public.sees_costs()));

create or replace function public.inv_report_damage(p_product uuid, p_location text, p_qty numeric, p_reason text,
  p_note text, p_photo text, p_by text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare have numeric; d inv_damages%rowtype;
begin
  if not (public.inv_can_edit() or public.can_open('tasks')) then raise exception 'Not allowed'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'Enter how many are damaged'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Choose what happened'; end if;
  if p_reason = 'Other' and coalesce(trim(p_note), '') = '' then raise exception 'Say what happened'; end if;
  if coalesce(trim(p_by), '') = '' then raise exception 'Say who''s reporting it'; end if;
  select coalesce(qty, 0) into have from inv_balances where product_id = p_product and location = coalesce(p_location, '');
  if coalesce(have, 0) < p_qty then
    raise exception 'Only % on % — count the shelf first if that''s wrong', coalesce(have, 0), coalesce(nullif(p_location, ''), 'no shelf');
  end if;
  insert into inv_damages (product_id, location, qty, reason, note, photo_path, reported_by)
  values (p_product, nullif(p_location, ''), p_qty, p_reason, nullif(trim(coalesce(p_note, '')), ''), nullif(p_photo, ''), p_by)
  returning * into d;
  insert into inv_movements (product_id, location, qty, kind, reason, note, ref, ref_id, by_name)
  values (p_product, nullif(p_location, ''), -p_qty, 'damage', p_reason, d.note, d.ref, d.id, p_by);
  perform public.inv_check_replenish(p_product);
  return jsonb_build_object('id', d.id, 'ref', d.ref);
end $$;
grant execute on function public.inv_report_damage(uuid, text, numeric, text, text, text, text) to authenticated;

-- The office decides what happens to damaged stock
create or replace function public.inv_resolve_damage(p_id uuid, p_action text, p_location text, p_note text, p_by text)
returns void language plpgsql security definer set search_path = public as $$
declare d inv_damages%rowtype;
begin
  if not public.sees_costs() then raise exception 'Only the office can decide what happens to damaged stock'; end if;
  select * into d from inv_damages where id = p_id for update;
  if not found then raise exception 'Damage report not found'; end if;
  if d.status <> 'open' then raise exception '% has already been dealt with', d.ref; end if;
  if p_action not in ('written_off', 'returned', 'restocked') then raise exception 'Choose what to do with it'; end if;
  if p_action = 'restocked' then
    perform public.inv_ensure_location(p_location, null, p_by);
    insert into inv_movements (product_id, location, qty, kind, reason, note, ref, ref_id, by_name)
    values (d.product_id, p_location, d.qty, 'damage_restock', 'Fine to sell', nullif(trim(coalesce(p_note, '')), ''), d.ref, d.id, p_by);
    perform public.inv_check_replenish(d.product_id);
  end if;
  update inv_damages set status = p_action, resolved_by = p_by, resolved_at = now(),
    resolution_note = nullif(trim(coalesce(p_note, '')), ''), restock_location = case when p_action = 'restocked' then p_location end
  where id = p_id;
end $$;
grant execute on function public.inv_resolve_damage(uuid, text, text, text, text) to authenticated;

-- ── Daily cycle counts ──

alter table inv_meta add column if not exists count_per_day int not null default 12;
alter table inv_meta add column if not exists counts_planned date;
alter table inv_tasks alter column product_id drop not null;
alter table inv_tasks add column if not exists result jsonb;

-- Each day, pick the shelves most worth counting: not counted for longest,
-- fast sellers on them, something gone wrong there lately. Shelves counted in
-- the last two weeks (or loaded today) are left alone, and so are empty ones. Counts not done roll over to the next day.
create or replace function public.inv_plan_counts() returns void
language plpgsql security definer set search_path = public as $$
declare today date := (now() at time zone 'Europe/London')::date; m inv_meta%rowtype; want int;
begin
  select * into m from inv_meta where id = 1 for update;
  if m.started_at is null or m.counts_planned = today then return; end if;
  update inv_meta set counts_planned = today where id = 1;
  want := greatest(0, m.count_per_day - (select count(*) from inv_tasks where kind = 'count' and status = 'open'));
  if want = 0 then return; end if;
  insert into inv_tasks (kind, from_location, why)
  select 'count', s.location,
         case when s.trouble then 'Something didn’t add up here lately'
              when s.last_counted is null then 'Not counted since the opening count'
              else 'Last counted ' || (today - s.last_counted) || ' days ago' end
  from (
    select b.location,
      (select max((m2.at at time zone 'Europe/London')::date) from inv_movements m2
         where m2.location = b.location and m2.kind = 'count') as last_counted,
      (select max((m2.at at time zone 'Europe/London')::date) from inv_movements m2
         where m2.location = b.location and m2.kind in ('count', 'opening')) as last_seen,
      bool_or(b.qty < 0) or exists (select 1 from inv_movements m3 where m3.location = b.location
         and m3.at > now() - interval '14 days' and (m3.kind in ('add', 'remove') or m3.note like '%not enough on the shelf%')) as trouble,
      sum(coalesce(r.daily, 0)) as speed, sum(b.qty) as stock
    from inv_balances b
    left join inv_rates r on r.product_id = b.product_id
    where b.location <> ''
    group by b.location
  ) s
  where (s.trouble or (s.stock > 0 and coalesce(s.last_counted, today - 365) <= today - 14 and s.last_seen is distinct from today))
    and not exists (select 1 from inv_tasks t where t.kind = 'count' and t.status = 'open' and t.from_location = s.location)
  order by (case when s.trouble then 40 else 0 end)
           + least(today - coalesce(s.last_counted, s.last_seen, today - 60), 60)
           + least(s.speed, 50) / 2 desc, s.location
  limit want;
end $$;

-- Count a whole shelf. counts: [{product_id, counted}] — including anything
-- found there that wasn't recorded. A shelf that comes out lower needs a note
-- from the warehouse.
create or replace function public.inv_count_shelf(p_location text, p_counts jsonb, p_note text, p_by text, p_task uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c jsonb; have numeric; diff numeric; diffs int := 0; n int := 0; out_ jsonb := '[]'::jsonb; pid uuid; counted numeric;
begin
  if not (public.inv_can_edit() or public.can_open('tasks')) then raise exception 'Not allowed'; end if;
  if coalesce(trim(p_by), '') = '' then raise exception 'Say who counted it'; end if;
  perform public.inv_ensure_location(p_location, null, p_by);
  if not public.sees_costs() and coalesce(trim(p_note), '') = '' and exists (
    select 1 from jsonb_array_elements(p_counts) x
    where (x ->> 'counted')::numeric < coalesce((select qty from inv_balances where product_id = (x ->> 'product_id')::uuid and location = p_location), 0)
  ) then raise exception 'Some came out lower than recorded — say why in the note'; end if;

  if exists (select 1 from inv_balances b where b.location = p_location and b.qty <> 0
             and b.product_id not in (select (x ->> 'product_id')::uuid from jsonb_array_elements(coalesce(p_counts, '[]'::jsonb)) x)) then
    raise exception 'Every product recorded on % needs a count (0 if none)', p_location;
  end if;

  for c in select * from jsonb_array_elements(coalesce(p_counts, '[]'::jsonb)) loop
    pid := (c ->> 'product_id')::uuid; counted := (c ->> 'counted')::numeric;
    if counted is null or counted < 0 then raise exception 'Enter a count for every product'; end if;
    select coalesce(qty, 0) into have from inv_balances where product_id = pid and location = p_location;
    diff := counted - coalesce(have, 0);
    n := n + 1;
    if diff <> 0 then
      diffs := diffs + 1;
      insert into inv_movements (product_id, location, qty, kind, reason, note, ref, ref_id, by_name)
      values (pid, p_location, diff, 'count', 'Cycle count', nullif(trim(coalesce(p_note, '')), ''),
              (select ref from inv_tasks where id = p_task), p_task, p_by);
    end if;
    insert into inv_balances (product_id, location, qty) values (pid, p_location, 0) on conflict do nothing;
    out_ := out_ || jsonb_build_object('product_id', pid, 'was', coalesce(have, 0), 'counted', counted, 'diff', diff);
    perform public.inv_check_replenish(pid);
  end loop;
  if p_task is not null then
    update inv_tasks set status = 'done', done_at = now(), done_by = p_by, moved = diffs,
      note = nullif(trim(coalesce(p_note, '')), ''), result = jsonb_build_object('lines', n, 'diffs', diffs, 'items', out_)
    where id = p_task and status = 'open';
  end if;
  return jsonb_build_object('lines', n, 'diffs', diffs, 'items', out_);
end $$;
grant execute on function public.inv_count_shelf(text, jsonb, text, text, uuid) to authenticated;

create or replace function public.inv_set_count_plan(p_per_day int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.sees_costs() then raise exception 'Not allowed'; end if;
  update inv_meta set count_per_day = greatest(0, least(coalesce(p_per_day, 12), 100)) where id = 1;
end $$;
grant execute on function public.inv_set_count_plan(int) to authenticated;

-- ── Value and slow stock (office only) ──

create table if not exists inv_costs (
  product_id uuid primary key references inv_products(id) on delete cascade,
  unit_cost numeric not null check (unit_cost >= 0),
  updated_by text, updated_at timestamptz default now()
);
alter table inv_costs enable row level security;
drop policy if exists "Office reads costs" on inv_costs;
create policy "Office reads costs" on inv_costs for select to authenticated using (public.sees_costs());

-- Link products to the Products list where the names match, for cost, supplier and lead time
update inv_products p set stock_item_id = s.id
from (select distinct on (public.inv_norm(name)) id, public.inv_norm(name) k from stock_items order by public.inv_norm(name), created_at) s
where p.stock_item_id is null and s.k = public.inv_norm(p.name);

create or replace function public.inv_set_cost(p_product uuid, p_cost numeric, p_by text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.sees_costs() then raise exception 'Not allowed'; end if;
  if p_cost is null then delete from inv_costs where product_id = p_product; return; end if;
  insert into inv_costs (product_id, unit_cost, updated_by) values (p_product, p_cost, p_by)
  on conflict (product_id) do update set unit_cost = excluded.unit_cost, updated_by = excluded.updated_by, updated_at = now();
end $$;
grant execute on function public.inv_set_cost(uuid, numeric, text) to authenticated;

-- What everything is worth, when each last sold, and what damage has cost
create or replace function public.inv_value() returns jsonb
language plpgsql security definer set search_path = public as $$
declare today date := (now() at time zone 'Europe/London')::date; res jsonb;
begin
  if not public.sees_costs() then raise exception 'Not allowed'; end if;
  with cost as (
    select p.id, coalesce(c.unit_cost,
      nullif(regexp_replace(coalesce(si.data ->> 'costPrice', ''), '[^0-9.]', '', 'g'), '')::numeric) as unit_cost,
      case when c.unit_cost is not null then 'set here' when si.id is not null then 'Products' end as cost_from
    from inv_products p left join inv_costs c on c.product_id = p.id left join stock_items si on si.id = p.stock_item_id
  ), sold as (
    select product_id, max(day) as last_day from public.inv_daily_units(today - 180, today) group by 1
  ), dmg as (
    select product_id, sum(qty) filter (where reported_at > now() - interval '30 days') as d30,
           sum(qty) filter (where status = 'open') as held
    from inv_damages group by 1
  )
  select jsonb_build_object('products', coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'code', p.code, 'name', p.name,
      'unit_cost', cost.unit_cost, 'cost_from', cost.cost_from,
      'on_hand', coalesce((select sum(qty) from inv_balances b where b.product_id = p.id), 0),
      'locations', coalesce((select jsonb_agg(jsonb_build_object('code', b.location, 'qty', b.qty)) from inv_balances b
                             where b.product_id = p.id and b.location <> '' and b.qty <> 0), '[]'::jsonb),
      'last_sold', sold.last_day, 'damaged_30', coalesce(dmg.d30, 0), 'damaged_held', coalesce(dmg.held, 0))), '[]'::jsonb),
    'damages', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'unit_cost', c2.unit_cost)) from inv_damages d
                          join cost c2 on c2.id = d.product_id where d.reported_at > now() - interval '120 days'), '[]'::jsonb))
  into res
  from inv_products p join cost on cost.id = p.id left join sold on sold.product_id = p.id left join dmg on dmg.product_id = p.id
  where p.active;
  return res;
end $$;
grant execute on function public.inv_value() to authenticated;

-- Overview: now with damages, count tasks and how accurate counts have been
create or replace function public.inv_overview() returns jsonb
language plpgsql security definer set search_path = public as $$
declare res jsonb; m inv_meta%rowtype;
begin
  if not public.is_active_user() then raise exception 'Not allowed'; end if;
  select * into m from inv_meta where id = 1;
  if m.started_at is not null and (m.rates_at is null or m.rates_at < now() - interval '30 minutes') then
    perform public.inv_refresh_rates();
    select * into m from inv_meta where id = 1;
  end if;
  perform public.inv_plan_counts();

  with open_u as (select * from public.inv_open_order_units()),
  alloc as (select product_id, sum(units) as units, count(distinct order_key) as orders from open_u where product_id is not null group by 1),
  bal as (
    select b.product_id,
           sum(b.qty) as on_hand,
           sum(b.qty) filter (where l.pickable) as pick,
           sum(b.qty) filter (where l.code is not null and not l.pickable) as overflow,
           sum(b.qty) filter (where b.location = '') as nowhere,
           jsonb_agg(jsonb_build_object('code', b.location, 'qty', b.qty, 'pickable', coalesce(l.pickable, false))
                     order by coalesce(l.pickable, false) desc, b.location) filter (where b.location <> '') as locations
    from inv_balances b left join inv_locations l on l.code = b.location group by 1
  ),
  onorder as (
    select p.id as product_id, sum(greatest(i.qty - coalesce(i.qty_received, 0), 0)) as units
    from inv_products p
    join purchase_order_items i on i.stock_item_id = p.stock_item_id
    join purchase_orders po on po.id = i.po_id
    where p.stock_item_id is not null and coalesce(po.kind, 'order') <> 'credit_note'
      and po.status not in ('draft', 'cancelled', 'received', 'completed') and coalesce(i.line_status, 'due') <> 'cancelled'
    group by 1
  ),
  req as (
    select distinct on (p.id) p.id as product_id, r.id, r.ref, r.status, r.qty_requested
    from inv_products p join stock_requests r
      on (public.inv_norm(r.helm_sku) = p.code_key or (p.stock_item_id is not null and r.stock_item_id = p.stock_item_id))
    where r.status in ('raised', 'acknowledged', 'ordered')
      and not (r.status = 'ordered' and exists (select 1 from purchase_order_items i where i.id = r.po_item_id
                                                and coalesce(i.qty_received, 0) >= i.qty))
    order by p.id, r.created_at desc
  ),
  lead as (
    select p.id as product_id,
           coalesce(p.lead_days,
             ceil(nullif(regexp_replace(coalesce(s.data ->> 'leadDays', ''), '[^0-9]', '', 'g'), '')::numeric * 7 / 5)::int,
             7) as days,
           (p.lead_days is not null or (s.data ->> 'leadDays') ~ '\d') as known
    from inv_products p
    left join stock_items si on si.id = p.stock_item_id
    left join lateral (select x.data from suppliers x where lower(x.name) = lower(si.data ->> 'supplierName')
                       order by x.created_at limit 1) s on true
  )
  select jsonb_build_object(
    'meta', jsonb_build_object('counted_at', m.counted_at, 'started_at', m.started_at, 'rates_at', m.rates_at,
      'count_per_day', m.count_per_day,
      'counts_30', (select count(*) from inv_tasks where kind = 'count' and status = 'done' and done_at > now() - interval '30 days'),
      'counts_right_30', (select count(*) from inv_tasks where kind = 'count' and status = 'done' and done_at > now() - interval '30 days'
                          and coalesce((result ->> 'diffs')::int, 0) = 0),
      'damages_open', (select count(*) from inv_damages where status = 'open')),
    'products', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.id, 'code', p.code, 'name', p.name, 'in_helm', p.in_helm or exists (
            select 1 from dispatch_item_units u where u.code_key = p.code_key and u.source = 'helm'),
        'stock_item_id', p.stock_item_id, 'min_pick', p.min_pick, 'daily_override', p.daily_override,
        'override_until', p.override_until, 'lead_days', p.lead_days, 'note', p.note, 'active', p.active,
        'on_hand', coalesce(b.on_hand, 0), 'pick', coalesce(b.pick, 0), 'overflow', coalesce(b.overflow, 0),
        'nowhere', coalesce(b.nowhere, 0), 'locations', coalesce(b.locations, '[]'::jsonb),
        'open_orders', coalesce(a.units, 0), 'open_order_count', coalesce(a.orders, 0),
        'available', coalesce(b.on_hand, 0) - coalesce(a.units, 0),
        'units_7', coalesce(r.units_7, 0), 'units_28', coalesce(r.units_28, 0), 'rate_days', coalesce(r.days, 0),
        'daily', public.inv_rate_of(p.id), 'on_order', coalesce(oo.units, 0),
        'lead', ld.days, 'lead_known', ld.known,
        'damaged', coalesce((select sum(qty) from inv_damages d where d.product_id = p.id and d.status = 'open'), 0),
        'request', case when rq.id is not null then jsonb_build_object('id', rq.id, 'ref', rq.ref, 'status', rq.status, 'qty', rq.qty_requested) end
      ) order by p.name)
      from inv_products p
      left join bal b on b.product_id = p.id
      left join alloc a on a.product_id = p.id
      left join inv_rates r on r.product_id = p.id
      left join onorder oo on oo.product_id = p.id
      left join req rq on rq.product_id = p.id
      left join lead ld on ld.product_id = p.id
      where p.active), '[]'::jsonb),
    'locations', coalesce((select jsonb_agg(jsonb_build_object('code', l.code, 'pickable', l.pickable, 'note', l.note)
        order by split_part(l.code, '-', 1), split_part(l.code, '-', 2)::int, split_part(l.code, '-', 3)::int, split_part(l.code, '-', 4)::int)
      from inv_locations l), '[]'::jsonb),
    'tasks', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'ref', t.ref, 'kind', t.kind, 'product_id', t.product_id,
        'product_name', p.name, 'product_code', p.code, 'from_location', t.from_location, 'to_location', t.to_location,
        'qty', t.qty, 'why', t.why, 'status', t.status, 'created_at', t.created_at, 'done_at', t.done_at,
        'done_by', t.done_by, 'moved', t.moved, 'note', t.note, 'result', t.result) order by t.created_at desc)
      from inv_tasks t left join inv_products p on p.id = t.product_id
      where t.status = 'open' or t.done_at > now() - interval '3 days'), '[]'::jsonb),
    'unmatched_open', coalesce((select jsonb_agg(jsonb_build_object('code', code, 'name', name, 'units', units, 'orders', n))
      from (select code, min(name) as name, sum(units) as units, count(distinct order_key) as n
            from open_u where product_id is null group by code) x), '[]'::jsonb),
    'unmatched_sold', coalesce((select jsonb_agg(to_jsonb(u) order by u.last_seen desc) from inv_unmatched u
      where u.last_seen > now() - interval '60 days'
        and not exists (select 1 from public.inv_expand(jsonb_build_array(jsonb_build_object('code', u.code, 'qty', 1))) e
                        where e.product_id is not null)), '[]'::jsonb)
  ) into res;
  return res;
end $$;
grant execute on function public.inv_overview() to authenticated;
