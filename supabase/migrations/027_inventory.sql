-- ── Inventory ───────────────────────────────────────────────────────────────
-- Stock by product and location. Every change is a movement (opening count,
-- goods in, a move, a manual add or remove with its reason, a despatch), and
-- the balances are kept from the movements, so the numbers always add up and
-- every unit can be traced. Movements are only ever written by the functions
-- below — never directly from the browser — so nothing changes without a
-- reason and a name against it.
--
-- Open orders aren't stored: they're worked out live from the dispatch labels
-- not yet gone, so uploading labels reserves stock straight away, and the
-- units come off the shelf when an order's last label is dispatched.
-- No prices anywhere in here.

-- Warehouse-only sections never see costs
create or replace function public.sees_costs() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and active
      and (role = 'admin' or exists (
        select 1 from jsonb_array_elements_text(permissions) p
        where p not in ('dispatch', 'dispatch-dashboard', 'requests', 'goods-in', 'inventory', 'tasks')))
  )
$$;
grant execute on function public.sees_costs() to authenticated;

-- Codes compared the way the portal compares them: letters and digits only
create or replace function public.inv_norm(t text) returns text
language sql immutable as $$ select upper(regexp_replace(coalesce(t, ''), '[^A-Za-z0-9]', '', 'g')) $$;

-- A real shelf: aisle A–H, bay 1–10 (D has 11), shelf 0 (ground) to 7, section 1–4
create or replace function public.inv_valid_location(c text) returns boolean
language sql immutable as $$
  select coalesce(c ~ '^[A-H]-([1-9]|1[01])-[0-7]-[1-4]$'
    and split_part(c, '-', 2)::int <= case when split_part(c, '-', 1) = 'D' then 11 else 10 end, false)
$$;

create or replace function public.inv_can_edit() returns boolean
language sql stable security definer set search_path = public as $$
  select public.can_open('inventory') or public.sees_costs()
$$;

-- ── Tables ──

create table if not exists inv_meta (
  id int primary key default 1 check (id = 1),
  counted_at timestamptz,          -- when the opening count was taken
  started_at timestamptz,          -- when inventory started following dispatch
  rates_at timestamptz,            -- when sales rates were last worked out
  updated_by text
);
insert into inv_meta (id) values (1) on conflict do nothing;

create table if not exists inv_products (
  id uuid primary key default gen_random_uuid(),
  code text not null,                         -- HELM product code
  code_key text generated always as (public.inv_norm(code)) stored,
  name text not null,
  in_helm boolean not null default true,      -- false: still to be created in HELM
  stock_item_id uuid references stock_items(id) on delete set null,   -- the matching Product, for supplier and lead time
  min_pick int,                               -- keep at least this many on the pick shelf
  daily_override numeric,                     -- e.g. de-icing salt in winter
  override_until date,
  lead_days int,                              -- calendar days from ordering to arriving, if not the supplier's
  active boolean not null default true,
  note text,
  created_by text,
  created_at timestamptz default now(), updated_at timestamptz default now()
);
create unique index if not exists inv_products_code_key on inv_products(code_key);
drop trigger if exists touch_inv_products on inv_products;
create trigger touch_inv_products before update on inv_products for each row execute function touch_updated_at();

create table if not exists inv_locations (
  code text primary key check (public.inv_valid_location(code)),
  pickable boolean not null default false,
  note text,
  updated_by text,
  created_at timestamptz default now(), updated_at timestamptz default now()
);
drop trigger if exists touch_inv_locations on inv_locations;
create trigger touch_inv_locations before update on inv_locations for each row execute function touch_updated_at();

create table if not exists inv_movements (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  product_id uuid not null references inv_products(id) on delete cascade,
  location text references inv_locations(code) on update cascade,   -- null: sold with nowhere to take it from
  qty numeric not null check (qty <> 0),
  kind text not null check (kind in ('opening', 'count', 'goods_in', 'move', 'add', 'remove', 'despatch', 'despatch_undo')),
  reason text, note text,
  ref text,                                   -- order ref, GI number, task number
  ref_id uuid,
  order_key text,                             -- the dispatch order it went out on
  group_id uuid,                              -- the two halves of a move
  by_name text, by_user uuid default auth.uid()
);
create index if not exists inv_movements_product_idx on inv_movements(product_id, at desc);
create index if not exists inv_movements_at_idx on inv_movements(at desc);
create index if not exists inv_movements_kind_idx on inv_movements(kind, at desc);
create index if not exists inv_movements_order_idx on inv_movements(order_key);

-- What's where, kept from the movements. location '' is "not on a shelf".
create table if not exists inv_balances (
  product_id uuid not null references inv_products(id) on delete cascade,
  location text not null default '',
  qty numeric not null default 0,
  primary key (product_id, location)
);
create index if not exists inv_balances_location_idx on inv_balances(location);

-- Orders whose units have come off the shelf, so nothing is ever taken twice
create table if not exists inv_despatched (
  order_key text primary key,                 -- upload id | order key
  at timestamptz not null default now(),
  counted boolean not null default true       -- false: went before the opening count, nothing taken
);

-- Codes sold that aren't in inventory, so they can be added
create table if not exists inv_unmatched (
  code_key text primary key,
  code text, name text,
  units numeric not null default 0,
  last_seen timestamptz default now()
);

-- Things the warehouse needs to do: top up a pick shelf from overflow
create sequence if not exists inv_task_seq;
create table if not exists inv_tasks (
  id uuid primary key default gen_random_uuid(),
  ref text unique not null default ('T-' || lpad(nextval('inv_task_seq')::text, 4, '0')),
  kind text not null default 'replenish',
  product_id uuid not null references inv_products(id) on delete cascade,
  from_location text, to_location text,
  qty numeric,                                -- how many to move
  why text,                                   -- what triggered it
  status text not null default 'open',        -- open | done | cleared | dismissed
  moved numeric,
  done_at timestamptz, done_by text, note text,
  created_at timestamptz default now()
);
create index if not exists inv_tasks_status_idx on inv_tasks(status, created_at desc);
create index if not exists inv_tasks_product_idx on inv_tasks(product_id);

-- Sales history from a marketplace report (no customer details), by SKU and day
create table if not exists inv_channel_sales (
  source text not null, day date not null, sku text not null,
  units numeric not null,
  primary key (source, day, sku)
);
-- What each marketplace SKU is, as HELM item codes per one sold: [{code, qty}]
create table if not exists inv_channel_skus (
  source text not null, sku text not null,
  title text,
  items jsonb not null default '[]'::jsonb,
  how text,                                   -- 'orders' (learned from dispatched orders) | 'person'
  updated_by text, updated_at timestamptz default now(),
  primary key (source, sku)
);

-- Sales rates, worked out every so often
create table if not exists inv_rates (
  product_id uuid primary key references inv_products(id) on delete cascade,
  units_7 numeric not null default 0,
  units_28 numeric not null default 0,
  days numeric not null default 0,            -- days of history behind the rate (up to 28)
  daily numeric not null default 0,
  updated_at timestamptz default now()
);

-- Names a delivery line goes by, so put-away knows the product next time
create table if not exists inv_aliases (
  key text primary key,                       -- 'si:<stock item id>' or 'name:<normalised name>'
  product_id uuid not null references inv_products(id) on delete cascade,
  updated_at timestamptz default now()
);

do $$
declare t text;
begin
  foreach t in array array['inv_meta','inv_products','inv_locations','inv_movements','inv_balances','inv_despatched',
                           'inv_unmatched','inv_tasks','inv_channel_sales','inv_channel_skus','inv_rates','inv_aliases'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "Read inventory" on %I', t);
    -- Anyone signed in can read stock (it has no prices); all changes go through the functions below
    execute format($p$create policy "Read inventory" on %I for select to authenticated using (public.is_active_user())$p$, t);
  end loop;
end $$;

-- ── Balances follow movements ──

create or replace function public.inv_apply_movement() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into inv_balances (product_id, location, qty) values (new.product_id, coalesce(new.location, ''), new.qty)
  on conflict (product_id, location) do update set qty = inv_balances.qty + excluded.qty;
  -- An emptied overflow spot is free again; a pick shelf stays the product's even when empty
  delete from inv_balances b where b.product_id = new.product_id and b.location = coalesce(new.location, '') and b.qty = 0
    and (b.location = '' or not exists (select 1 from inv_locations l where l.code = b.location and l.pickable));
  return null;
end $$;
drop trigger if exists inv_movement_balance on inv_movements;
create trigger inv_movement_balance after insert on inv_movements for each row execute function public.inv_apply_movement();

-- Movements can't be changed or removed: a mistake is put right with another movement
create or replace function public.inv_movements_locked() returns trigger language plpgsql as $$
begin raise exception 'Stock movements can''t be changed — add a correction instead'; end $$;
drop trigger if exists inv_movements_no_change on inv_movements;
create trigger inv_movements_no_change before update or delete on inv_movements for each row
  when (pg_trigger_depth() = 0) execute function public.inv_movements_locked();

-- ── What an order's items are, in inventory products ──

-- items: [{code, qty, name}] as on a packing slip. A HELM bundle is its parts;
-- a code HELM doesn't list is matched on its own. Returns one row per part,
-- product_id null when it isn't in inventory.
create or replace function public.inv_expand(p_items jsonb, p_mult numeric default 1)
returns table (product_id uuid, code text, name text, units numeric)
language sql stable security definer set search_path = public as $$
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
  )
  select p.id, parts.code, parts.name, parts.units
  from parts left join inv_products p on p.code_key = public.inv_norm(parts.code)
$$;

-- Orders uploaded and not yet gone: every label still waiting or on hold.
-- Each order counts once, however many labels it has.
create or replace function public.inv_open_order_units()
returns table (product_id uuid, code text, name text, units numeric, order_key text, ref text, created_at timestamptz, status text)
language sql stable security definer set search_path = public as $$
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
$$;

-- ── Taking stock off the shelf ──

-- Takes units of a product: pick shelves first (smallest first, so a shelf
-- empties rather than several running down together), then overflow. If
-- there isn't enough anywhere, the rest comes off the pick shelf and shows
-- below zero, so a count can put it right.
create or replace function public.inv_take(p_product uuid, p_units numeric, p_kind text, p_at timestamptz,
  p_ref text, p_order_key text, p_by text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare r record; left_ numeric := p_units; t numeric; loc text;
begin
  if p_units <= 0 then return; end if;
  for r in
    select b.location, b.qty from inv_balances b join inv_locations l on l.code = b.location
    where b.product_id = p_product and b.qty > 0
    order by l.pickable desc, b.qty asc, b.location
  loop
    t := least(left_, r.qty);
    insert into inv_movements (at, product_id, location, qty, kind, ref, order_key, by_name, note)
    values (p_at, p_product, r.location, -t, p_kind, p_ref, p_order_key, p_by, p_note);
    left_ := left_ - t;
    exit when left_ <= 0;
  end loop;
  if left_ > 0 then
    select b.location into loc from inv_balances b left join inv_locations l on l.code = b.location
    where b.product_id = p_product
    order by (b.location = '') , coalesce(l.pickable, false) desc, b.qty desc limit 1;
    insert into inv_movements (at, product_id, location, qty, kind, ref, order_key, by_name, note)
    values (p_at, p_product, nullif(loc, ''), -left_, p_kind, p_ref, p_order_key, p_by,
            coalesce(p_note || ' · ', '') || 'not enough on the shelf');
  end if;
end $$;

-- An order's labels have all gone: take its units off the shelf, once.
create or replace function public.inv_despatch_order(p_upload uuid, p_key text)
returns void language plpgsql security definer set search_path = public as $$
declare k text := p_upload::text || '|' || p_key;
  items jsonb; gone_at timestamptz; ref text; who text; is_repl boolean; e record; started timestamptz;
begin
  select started_at into started from inv_meta where id = 1;
  if started is null then return; end if;                -- inventory not set up yet
  if exists (select 1 from dispatch_labels where upload_id = p_upload and coalesce(order_key, id::text) = p_key
             and status not in ('dispatched', 'cancelled')) then return; end if;
  if not exists (select 1 from dispatch_labels where upload_id = p_upload and coalesce(order_key, id::text) = p_key
                 and status = 'dispatched') then return; end if;
  insert into inv_despatched (order_key) values (k) on conflict do nothing;
  if not found then return; end if;

  select (array_agg(l.items order by jsonb_array_length(l.items) desc))[1], max(l.dispatched_at),
         min(coalesce(nullif(l.channel_ref, ''), nullif(l.helm_order, ''), l.customer)),
         max(coalesce(l.packer, l.dispatched_by_name)), bool_or(coalesce(l.reason, '') not in ('', 'order'))
    into items, gone_at, ref, who, is_repl
  from dispatch_labels l where l.upload_id = p_upload and coalesce(l.order_key, l.id::text) = p_key and l.status = 'dispatched';

  for e in select x.product_id, x.code, x.name, sum(x.units) as units from public.inv_expand(items) x group by 1, 2, 3 loop
    if e.product_id is null then
      insert into inv_unmatched (code_key, code, name, units, last_seen)
      values (public.inv_norm(e.code), e.code, e.name, e.units, now())
      on conflict (code_key) do update set units = inv_unmatched.units + excluded.units, last_seen = now(), name = excluded.name;
    else
      perform public.inv_take(e.product_id, e.units, 'despatch', coalesce(gone_at, now()), ref, k, who,
                              case when is_repl then 'replacement' end);
      perform public.inv_check_replenish(e.product_id);
    end if;
  end loop;
end $$;

-- A label taken back from dispatched: put the order's units back where they came from
create or replace function public.inv_undo_despatch(p_upload uuid, p_key text)
returns void language plpgsql security definer set search_path = public as $$
declare k text := p_upload::text || '|' || p_key; m record;
begin
  if not exists (select 1 from inv_despatched where order_key = k and counted) then
    delete from inv_despatched where order_key = k; return;
  end if;
  for m in select product_id, location, sum(qty) as qty from inv_movements
           where order_key = k and kind in ('despatch', 'despatch_undo') group by 1, 2 having sum(qty) <> 0 loop
    insert into inv_movements (product_id, location, qty, kind, order_key, note)
    values (m.product_id, m.location, -m.qty, 'despatch_undo', k, 'label taken back from dispatched');
  end loop;
  delete from inv_despatched where order_key = k;
end $$;

create or replace function public.inv_label_changed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status is not distinct from old.status then return null; end if;
  if new.status in ('dispatched', 'cancelled') then
    perform public.inv_despatch_order(new.upload_id, coalesce(new.order_key, new.id::text));
  elsif old.status = 'dispatched' then
    perform public.inv_undo_despatch(new.upload_id, coalesce(new.order_key, new.id::text));
  end if;
  return null;
exception when others then
  -- Stock must never stop a parcel going out; anything missed shows as a difference at the next count
  raise warning 'inventory: %', sqlerrm;
  return null;
end $$;
drop trigger if exists inv_label_status on dispatch_labels;
create trigger inv_label_status after update of status on dispatch_labels
  for each row execute function public.inv_label_changed();

-- ── Sales rates ──

-- Units sold per product per day, from dispatch labels (every channel) and
-- from imported marketplace reports. For each day, whichever recorded more is
-- used, so a day isn't counted twice and an early half-used day of Dispatch
-- doesn't hide a full day in the report.
create or replace function public.inv_daily_units(p_from date, p_to date)
returns table (day date, product_id uuid, units numeric)
language sql stable security definer set search_path = public as $$
  with orders as (
    select (min(l.created_at) at time zone 'Europe/London')::date as day,
           (array_agg(l.items order by jsonb_array_length(l.items) desc))[1] as items
    from dispatch_labels l
    where l.created_at >= (p_from - 1)::timestamp at time zone 'Europe/London'
      and l.created_at < (p_to + 1)::timestamp at time zone 'Europe/London'
    group by l.upload_id, coalesce(l.order_key, l.id::text)
    having bool_or(l.status <> 'cancelled')
  ), d as (
    select o.day, e.product_id, sum(e.units) as units
    from orders o cross join lateral public.inv_expand(o.items) e
    where o.day between p_from and p_to and e.product_id is not null group by 1, 2
  ), c as (
    select s.day, e.product_id, sum(e.units) as units
    from inv_channel_sales s join inv_channel_skus k on k.source = s.source and k.sku = s.sku
    cross join lateral public.inv_expand(k.items, s.units) e
    where s.day between p_from and p_to and e.product_id is not null group by 1, 2
  ), dt as (select day, sum(units) t from d group by 1), ct as (select day, sum(units) t from c group by 1)
  select d.day, d.product_id, d.units from d join dt using (day) left join ct using (day) where dt.t >= coalesce(ct.t, 0)
  union all
  select c.day, c.product_id, c.units from c join ct using (day) left join dt using (day) where ct.t > coalesce(dt.t, 0)
$$;

-- The rate each product sells at: the busier of the last 7 and last 28 days,
-- so it follows sales that are picking up without being fooled by a quiet week.
create or replace function public.inv_refresh_rates() returns void
language plpgsql security definer set search_path = public as $$
declare yday date := (now() at time zone 'Europe/London')::date - 1; first_day date; span int;
begin
  select least(
    (select (min(created_at) at time zone 'Europe/London')::date from dispatch_labels),
    (select min(day) from inv_channel_sales)) into first_day;
  span := greatest(0, least(28, coalesce(yday - first_day + 1, 0)));
  delete from inv_rates;
  insert into inv_rates (product_id, units_7, units_28, days, daily, updated_at)
  select p.id, coalesce(s.u7, 0), coalesce(s.u28, 0), span,
         case when span = 0 then 0
              else greatest(coalesce(s.u28, 0) / span, coalesce(s.u7, 0) / least(7, span)) end, now()
  from inv_products p
  left join (select product_id, sum(units) filter (where day > yday - 7) as u7, sum(units) as u28
             from public.inv_daily_units(yday - 27, yday) group by 1) s on s.product_id = p.id;
  update inv_meta set rates_at = now() where id = 1;
end $$;

create or replace function public.inv_rate_of(p_product uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select p.daily_override from inv_products p where p.id = p_product and p.daily_override is not null
       and (p.override_until is null or p.override_until >= (now() at time zone 'Europe/London')::date)),
    (select daily from inv_rates where product_id = p_product), 0)
$$;

-- ── Replenishment tasks ──

-- When a pick shelf gets low and there's more in overflow, ask the warehouse
-- to bring some down. Low means under 3 days of sales, or under the product's
-- own minimum. Once the shelf is topped up any other way, the task clears.
create or replace function public.inv_check_replenish(p_product uuid)
returns void language plpgsql security definer set search_path = public as $$
declare pick numeric; daily numeric; minp int; threshold numeric; src record; dest text; target numeric; q numeric;
begin
  select coalesce(sum(greatest(b.qty, 0)), 0) into pick from inv_balances b join inv_locations l on l.code = b.location
    where b.product_id = p_product and l.pickable;
  select min_pick into minp from inv_products where id = p_product and active;
  if not found then return; end if;
  daily := public.inv_rate_of(p_product);
  threshold := greatest(coalesce(minp, 0), ceil(daily * 3));

  if pick > threshold then
    update inv_tasks set status = 'cleared', done_at = now(), note = 'Pick shelf topped up'
    where product_id = p_product and status = 'open' and kind = 'replenish';
    return;
  end if;
  if exists (select 1 from inv_tasks where product_id = p_product and status = 'open' and kind = 'replenish') then return; end if;
  -- Someone said it wasn't needed: don't ask again for a day unless the shelf is empty
  if pick > 0 and exists (select 1 from inv_tasks where product_id = p_product and status = 'dismissed'
                          and done_at > now() - interval '1 day') then return; end if;

  -- From the overflow spot with the least in it, so it empties
  select b.location, b.qty into src from inv_balances b join inv_locations l on l.code = b.location
    where b.product_id = p_product and not l.pickable and b.qty > 0 order by b.qty asc, b.location limit 1;
  if not found then return; end if;
  -- Only for products picked from a pick shelf: ones kept only in overflow are picked from there
  select b.location into dest from inv_balances b join inv_locations l on l.code = b.location
    where b.product_id = p_product and l.pickable order by b.qty desc, b.location limit 1;
  if dest is null then return; end if;

  if daily <= 0 and minp is null then
    q := src.qty;                         -- nothing to go on yet: bring it all, the warehouse says what fitted
  else
    target := greatest(ceil(daily * 14), coalesce(minp, 0) * 2, 1) - greatest(pick, 0);
    q := least(src.qty, greatest(target, 1));
  end if;
  if src.qty - q <= greatest(ceil(daily * 2), 2) then q := src.qty; end if;   -- don't leave a few behind

  insert into inv_tasks (product_id, from_location, to_location, qty, why)
  values (p_product, src.location, dest, q,
          case when pick <= 0 then 'Pick shelf is empty'
               else trim(to_char(pick, 'FM999999')) || ' left on the pick shelf'
                    || case when daily <= 0 then ''
                            when pick / daily < 1 then ', less than a day of sales'
                            when floor(pick / daily) = 1 then ', about 1 day of sales'
                            else ', about ' || floor(pick / daily)::int || ' days of sales' end end);
end $$;

create or replace function public.inv_check_all() returns void
language plpgsql security definer set search_path = public as $$
declare p uuid;
begin
  for p in select id from inv_products where active loop perform public.inv_check_replenish(p); end loop;
end $$;

-- ── Everything for the Inventory page in one go ──

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
    'meta', jsonb_build_object('counted_at', m.counted_at, 'started_at', m.started_at, 'rates_at', m.rates_at),
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
        'done_by', t.done_by, 'moved', t.moved, 'note', t.note) order by t.created_at desc)
      from inv_tasks t join inv_products p on p.id = t.product_id
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

-- The open orders holding one product's stock
create or replace function public.inv_product_orders(p_product uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('ref', ref, 'units', units, 'created_at', created_at, 'status', status)
                            order by created_at), '[]'::jsonb)
  from public.inv_open_order_units() where product_id = p_product and public.is_active_user()
$$;
grant execute on function public.inv_product_orders(uuid) to authenticated;

-- Units out per product per day, from what was taken off the shelf
create or replace function public.inv_despatch_days(p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('day', day, 'product_id', product_id, 'code', code, 'name', name,
           'units', units, 'orders', orders, 'replacements', repl) order by day desc, units desc), '[]'::jsonb)
  from (
    select (m.at at time zone 'Europe/London')::date as day, p.id as product_id, p.code, p.name,
           -sum(m.qty) as units, count(distinct m.order_key) filter (where m.kind = 'despatch') as orders,
           -coalesce(sum(m.qty) filter (where m.note like 'replacement%'), 0) as repl
    from inv_movements m join inv_products p on p.id = m.product_id
    where m.kind in ('despatch', 'despatch_undo') and public.is_active_user()
      and m.at >= p_from::timestamp at time zone 'Europe/London' and m.at < (p_to + 1)::timestamp at time zone 'Europe/London'
    group by 1, 2, 3, 4 having sum(m.qty) <> 0
  ) x
$$;
grant execute on function public.inv_despatch_days(date, date) to authenticated;

-- ── Changing stock (every change has a name and, for manual ones, a reason) ──

create or replace function public.inv_ensure_location(p_code text, p_pickable boolean, p_by text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.inv_valid_location(p_code) then
    raise exception '% isn''t a shelf — use Aisle-Bay-Shelf-Section, e.g. A-10-0-1', coalesce(p_code, 'That');
  end if;
  insert into inv_locations (code, pickable, updated_by) values (p_code, coalesce(p_pickable, false), p_by)
  on conflict (code) do update set pickable = coalesce(p_pickable, inv_locations.pickable),
    updated_by = case when p_pickable is not null and p_pickable <> inv_locations.pickable then p_by else inv_locations.updated_by end;
end $$;

create or replace function public.inv_save_location(p_code text, p_pickable boolean, p_note text, p_by text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.inv_can_edit() or public.can_open('tasks')) then raise exception 'Not allowed'; end if;
  perform public.inv_ensure_location(p_code, p_pickable, p_by);
  update inv_locations set note = nullif(trim(coalesce(p_note, '')), '') where code = p_code;
  -- A shelf turned into overflow lets go of products with nothing on it
  delete from inv_balances b where b.location = p_code and b.qty = 0 and not coalesce(p_pickable, true);
  perform public.inv_check_replenish(b.product_id) from inv_balances b where b.location = p_code;
end $$;
grant execute on function public.inv_save_location(text, boolean, text, text) to authenticated;

-- Move stock between shelves. Can't move more than is there.
create or replace function public.inv_move(p_product uuid, p_from text, p_to text, p_qty numeric, p_by text,
  p_note text default null, p_to_pickable boolean default null, p_task uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare have numeric; g uuid := gen_random_uuid(); tk text;
begin
  if not (public.inv_can_edit() or public.can_open('tasks')) then raise exception 'Not allowed'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'Enter how many to move'; end if;
  if p_from = p_to then raise exception 'Pick a different shelf to move it to'; end if;
  perform public.inv_ensure_location(p_to, p_to_pickable, p_by);
  select coalesce(qty, 0) into have from inv_balances where product_id = p_product and location = coalesce(p_from, '');
  if coalesce(have, 0) < p_qty then
    raise exception 'Only % on %', coalesce(have, 0), coalesce(p_from, 'no shelf');
  end if;
  if p_task is not null then select ref into tk from inv_tasks where id = p_task; end if;
  insert into inv_movements (product_id, location, qty, kind, note, group_id, by_name, ref, ref_id)
  values (p_product, nullif(p_from, ''), -p_qty, 'move', coalesce(p_note, 'to ' || p_to), g, p_by, tk, p_task),
         (p_product, p_to, p_qty, 'move', coalesce(p_note, 'from ' || coalesce(nullif(p_from, ''), 'no shelf')), g, p_by, tk, p_task);
  if p_task is not null then
    update inv_tasks set status = 'done', moved = p_qty, done_at = now(), done_by = p_by,
      to_location = p_to, note = nullif(p_note, '') where id = p_task and status = 'open';
  end if;
  perform public.inv_check_replenish(p_product);
end $$;
grant execute on function public.inv_move(uuid, text, text, numeric, text, text, boolean, uuid) to authenticated;

-- Add or remove by hand, with the reason it isn't going through Goods In or Dispatch
create or replace function public.inv_adjust(p_product uuid, p_location text, p_qty numeric, p_reason text,
  p_note text, p_by text, p_pickable boolean default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.inv_can_edit() then raise exception 'Not allowed'; end if;
  if p_qty is null or p_qty = 0 then raise exception 'Enter how many'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Say why it''s being changed by hand'; end if;
  if coalesce(trim(p_by), '') = '' then raise exception 'Say who''s doing it'; end if;
  if p_location is not null and p_location <> '' then perform public.inv_ensure_location(p_location, p_pickable, p_by); end if;
  insert into inv_movements (product_id, location, qty, kind, reason, note, by_name)
  values (p_product, nullif(p_location, ''), p_qty, case when p_qty > 0 then 'add' else 'remove' end,
          p_reason, nullif(trim(coalesce(p_note, '')), ''), p_by);
  perform public.inv_check_replenish(p_product);
end $$;
grant execute on function public.inv_adjust(uuid, text, numeric, text, text, text, boolean) to authenticated;

-- Counted a shelf: set it to what's really there
create or replace function public.inv_set_count(p_product uuid, p_location text, p_counted numeric, p_note text, p_by text)
returns numeric language plpgsql security definer set search_path = public as $$
declare have numeric; diff numeric;
begin
  if not public.inv_can_edit() then raise exception 'Not allowed'; end if;
  if p_counted is null or p_counted < 0 then raise exception 'Enter what you counted'; end if;
  if coalesce(trim(p_by), '') = '' then raise exception 'Say who counted it'; end if;
  perform public.inv_ensure_location(p_location, null, p_by);
  select coalesce(qty, 0) into have from inv_balances where product_id = p_product and location = p_location;
  diff := p_counted - coalesce(have, 0);
  if diff <> 0 then
    insert into inv_movements (product_id, location, qty, kind, reason, note, by_name)
    values (p_product, p_location, diff, 'count', 'Counted', nullif(trim(coalesce(p_note, '')), ''), p_by);
  end if;
  insert into inv_balances (product_id, location, qty) values (p_product, p_location, 0) on conflict do nothing;
  perform public.inv_check_replenish(p_product);
  return diff;
end $$;
grant execute on function public.inv_set_count(uuid, text, numeric, text, text) to authenticated;

-- Give a product a pick shelf (or take an empty one away)
create or replace function public.inv_assign(p_product uuid, p_location text, p_assign boolean, p_by text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.inv_can_edit() then raise exception 'Not allowed'; end if;
  if p_assign then
    perform public.inv_ensure_location(p_location, true, p_by);
    insert into inv_balances (product_id, location, qty) values (p_product, p_location, 0) on conflict do nothing;
  else
    delete from inv_balances where product_id = p_product and location = p_location and qty = 0;
  end if;
  perform public.inv_check_replenish(p_product);
end $$;
grant execute on function public.inv_assign(uuid, text, boolean, text) to authenticated;

-- Add or change a product
create or replace function public.inv_save_product(p_id uuid, p jsonb, p_by text)
returns uuid language plpgsql security definer set search_path = public as $$
declare rid uuid;
begin
  if not (public.inv_can_edit() or public.can_open('goods-in')) then raise exception 'Not allowed'; end if;
  if p_id is null then
    if coalesce(trim(p ->> 'code'), '') = '' or coalesce(trim(p ->> 'name'), '') = '' then
      raise exception 'A product needs a code and a name'; end if;
    if exists (select 1 from inv_products where code_key = public.inv_norm(p ->> 'code')) then
      raise exception 'There''s already a product with code %', p ->> 'code'; end if;
    insert into inv_products (code, name, in_helm, stock_item_id, created_by)
    values (upper(trim(p ->> 'code')), trim(p ->> 'name'), coalesce((p ->> 'in_helm')::boolean, false),
            nullif(p ->> 'stock_item_id', '')::uuid, p_by)
    returning id into rid;
    return rid;
  end if;
  if not public.inv_can_edit() then raise exception 'Not allowed'; end if;
  update inv_products set
    code = case when p ? 'code' and trim(p ->> 'code') <> '' then upper(trim(p ->> 'code')) else code end,
    name = case when p ? 'name' and trim(p ->> 'name') <> '' then trim(p ->> 'name') else name end,
    in_helm = case when p ? 'in_helm' then (p ->> 'in_helm')::boolean else in_helm end,
    stock_item_id = case when p ? 'stock_item_id' then nullif(p ->> 'stock_item_id', '')::uuid else stock_item_id end,
    min_pick = case when p ? 'min_pick' then nullif(p ->> 'min_pick', '')::int else min_pick end,
    daily_override = case when p ? 'daily_override' then nullif(p ->> 'daily_override', '')::numeric else daily_override end,
    override_until = case when p ? 'override_until' then nullif(p ->> 'override_until', '')::date else override_until end,
    lead_days = case when p ? 'lead_days' then nullif(p ->> 'lead_days', '')::int else lead_days end,
    note = case when p ? 'note' then nullif(p ->> 'note', '') else note end,
    active = case when p ? 'active' then (p ->> 'active')::boolean else active end
  where id = p_id;
  perform public.inv_check_replenish(p_id);
  return p_id;
end $$;
grant execute on function public.inv_save_product(uuid, jsonb, text) to authenticated;

create or replace function public.inv_dismiss_task(p_task uuid, p_note text, p_by text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.inv_can_edit() or public.can_open('tasks')) then raise exception 'Not allowed'; end if;
  update inv_tasks set status = 'dismissed', done_at = now(), done_by = p_by, note = nullif(trim(coalesce(p_note, '')), '')
  where id = p_task and status = 'open';
end $$;
grant execute on function public.inv_dismiss_task(uuid, text, text) to authenticated;

-- ── Goods in: putting a delivery away ──

-- What each line of a delivery probably is, and where that product lives
create or replace function public.inv_put_away_plan(p_delivery uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'i', l.n, 'name', l.line ->> 'name', 'po_item_id', l.line ->> 'po_item_id', 'stock_item_id', i.stock_item_id,
      'units', greatest(coalesce(nullif(l.line ->> 'arrived', '')::numeric, nullif(l.line ->> 'qty', '')::numeric, 0)
                        - coalesce(nullif(l.line ->> 'damaged', '')::numeric, 0), 0),
      'product_id', coalesce(
         (select a.product_id from inv_aliases a where a.key = 'si:' || i.stock_item_id),
         (select p.id from inv_products p where p.stock_item_id = i.stock_item_id and p.active limit 1),
         (select a.product_id from inv_aliases a where a.key = 'name:' || public.inv_norm(l.line ->> 'name')),
         (select p.id from inv_products p where public.inv_norm(p.name) = public.inv_norm(l.line ->> 'name') and p.active limit 1))
    ) order by l.n), '[]'::jsonb)
  from goods_in_deliveries d
  cross join lateral jsonb_array_elements(d.lines) with ordinality as l(line, n)
  left join purchase_order_items i on i.id = nullif(l.line ->> 'po_item_id', '')::uuid
  where d.id = p_delivery and (public.can_open('goods-in') or public.inv_can_edit())
$$;
grant execute on function public.inv_put_away_plan(uuid) to authenticated;

-- lines: [{name, stock_item_id, product_id, location, pickable, units, skip}]
-- A line can be split across shelves by sending it more than once.
create or replace function public.inv_put_away(p_delivery uuid, p_lines jsonb, p_by text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d goods_in_deliveries%rowtype; l jsonb; n int := 0; u numeric := 0; pid uuid;
begin
  if not (public.can_open('goods-in') or public.inv_can_edit()) then raise exception 'Not allowed'; end if;
  if coalesce(trim(p_by), '') = '' then raise exception 'Say who put it away'; end if;
  select * into d from goods_in_deliveries where id = p_delivery for update;
  if not found then raise exception 'Delivery not found'; end if;
  if d.put_away_at is not null then raise exception '% has already been put away', d.ref; end if;

  for l in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    if (l ->> 'skip')::boolean is true then continue; end if;
    pid := nullif(l ->> 'product_id', '')::uuid;
    if pid is null then raise exception 'Choose the product for %', l ->> 'name'; end if;
    if coalesce((l ->> 'units')::numeric, 0) <= 0 then continue; end if;
    perform public.inv_ensure_location(l ->> 'location', nullif(l ->> 'pickable', '')::boolean, p_by);
    insert into inv_movements (product_id, location, qty, kind, ref, ref_id, note, by_name)
    values (pid, l ->> 'location', (l ->> 'units')::numeric, 'goods_in', d.ref, d.id,
            nullif(concat_ws(' · ', d.data ->> 'po_number', d.supplier_name), ''), p_by);
    n := n + 1; u := u + (l ->> 'units')::numeric;
    -- Remember what this line is, for next time
    if nullif(l ->> 'stock_item_id', '') is not null then
      insert into inv_aliases (key, product_id) values ('si:' || (l ->> 'stock_item_id'), pid)
      on conflict (key) do update set product_id = excluded.product_id, updated_at = now();
      update inv_products set stock_item_id = (l ->> 'stock_item_id')::uuid where id = pid and stock_item_id is null;
    end if;
    if coalesce(l ->> 'name', '') <> '' then
      insert into inv_aliases (key, product_id) values ('name:' || public.inv_norm(l ->> 'name'), pid)
      on conflict (key) do update set product_id = excluded.product_id, updated_at = now();
    end if;
    perform public.inv_check_replenish(pid);
  end loop;

  update goods_in_deliveries set put_away_at = now(), put_away_by = p_by,
    data = data || jsonb_build_object('put_away', p_lines) where id = p_delivery;
  insert into activity_log (entity_type, entity_id, entity_name, action, detail, user_name, source)
  values ('delivery', d.id, d.ref, 'Put away', u || ' units onto ' || n || ' shelf' || case when n = 1 then '' else 'es' end, p_by, 'inventory');
  return jsonb_build_object('lines', n, 'units', u);
end $$;
grant execute on function public.inv_put_away(uuid, jsonb, text) to authenticated;

-- ── Imports ──

-- A stock count, as rows: [{location, pickable, code, name, in_helm, qty}].
-- The first one is the opening stock, dated when the count was taken; orders
-- dispatched after that are then taken off, and everything dispatched before
-- it is marked as already counted. Later counts set each listed shelf to what
-- was counted.
create or replace function public.inv_import_count(p_rows jsonb, p_counted_at timestamptz, p_by text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb; pid uuid; opening boolean; have numeric; diff numeric; n int := 0; units numeric := 0;
  o record; caught int := 0; prior int := 0;
begin
  if not public.sees_costs() then raise exception 'Only the office can import a stock count'; end if;
  if p_counted_at is null then raise exception 'Say when the count was taken'; end if;
  opening := (select started_at is null from inv_meta where id = 1);

  -- Shelves: pickable if any row says so
  insert into inv_locations (code, pickable, updated_by)
  select x ->> 'location', bool_or(coalesce((x ->> 'pickable')::boolean, false)), p_by
  from jsonb_array_elements(p_rows) x group by 1
  on conflict (code) do update set pickable = inv_locations.pickable or excluded.pickable;

  for r in select * from jsonb_array_elements(p_rows) loop
    insert into inv_products (code, name, in_helm, created_by)
    values (upper(trim(r ->> 'code')), trim(r ->> 'name'), coalesce((r ->> 'in_helm')::boolean, true), p_by)
    on conflict (code_key) do update set name = case when inv_products.in_helm then inv_products.name else excluded.name end,
      in_helm = inv_products.in_helm or excluded.in_helm
    returning id into pid;
    select qty into have from inv_balances where product_id = pid and location = r ->> 'location';
    diff := coalesce((r ->> 'qty')::numeric, 0) - coalesce(have, 0);
    if diff <> 0 then
      insert into inv_movements (at, product_id, location, qty, kind, reason, by_name, note)
      values (case when opening then p_counted_at else now() end, pid, r ->> 'location', diff,
              case when opening then 'opening' else 'count' end, case when opening then 'Opening count' else 'Stock count' end,
              p_by, 'counted ' || to_char(p_counted_at at time zone 'Europe/London', 'DD Mon YYYY HH24:MI'));
    end if;
    insert into inv_balances (product_id, location, qty) values (pid, r ->> 'location', 0) on conflict do nothing;
    n := n + 1; units := units + coalesce((r ->> 'qty')::numeric, 0);
  end loop;

  if opening then
    update inv_meta set counted_at = p_counted_at, started_at = now(), updated_by = p_by where id = 1;
    -- Orders that went before the count were already off the shelf; ones after come off now
    for o in
      select l.upload_id, coalesce(l.order_key, l.id::text) as k, max(l.dispatched_at) as gone
      from dispatch_labels l group by 1, 2
      having bool_and(l.status in ('dispatched', 'cancelled')) and bool_or(l.status = 'dispatched')
    loop
      if o.gone > p_counted_at then
        perform public.inv_despatch_order(o.upload_id, o.k); caught := caught + 1;
      else
        insert into inv_despatched (order_key, at, counted) values (o.upload_id::text || '|' || o.k, o.gone, false)
        on conflict do nothing;
        prior := prior + 1;
      end if;
    end loop;
    perform public.inv_refresh_rates();
  end if;
  perform public.inv_check_all();
  return jsonb_build_object('rows', n, 'units', units, 'opening', opening, 'orders_taken_off', caught, 'orders_before', prior);
end $$;
grant execute on function public.inv_import_count(jsonb, timestamptz, text) to authenticated;

-- Marketplace sales: rows [{day, sku, units}] and what each SKU is
-- skus: [{sku, title, items:[{code, qty}], how}]. Re-importing a day replaces it.
create or replace function public.inv_import_sales(p_source text, p_rows jsonb, p_skus jsonb, p_by text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.sees_costs() then raise exception 'Only the office can import sales history'; end if;
  delete from inv_channel_sales where source = p_source
    and day in (select distinct (x ->> 'day')::date from jsonb_array_elements(p_rows) x);
  insert into inv_channel_sales (source, day, sku, units)
  select p_source, (x ->> 'day')::date, x ->> 'sku', sum((x ->> 'units')::numeric)
  from jsonb_array_elements(p_rows) x group by 2, 3;
  get diagnostics n = row_count;
  insert into inv_channel_skus (source, sku, title, items, how, updated_by)
  select p_source, s ->> 'sku', s ->> 'title', coalesce(s -> 'items', '[]'::jsonb), s ->> 'how', p_by
  from jsonb_array_elements(coalesce(p_skus, '[]'::jsonb)) s
  on conflict (source, sku) do update set title = coalesce(excluded.title, inv_channel_skus.title),
    items = case when jsonb_array_length(excluded.items) > 0 or inv_channel_skus.how is distinct from 'person'
                 then excluded.items else inv_channel_skus.items end,
    how = case when jsonb_array_length(excluded.items) > 0 or inv_channel_skus.how is distinct from 'person'
               then excluded.how else inv_channel_skus.how end,
    updated_by = excluded.updated_by, updated_at = now();
  perform public.inv_refresh_rates();
  perform public.inv_check_all();
  return jsonb_build_object('rows', n);
end $$;
grant execute on function public.inv_import_sales(text, jsonb, jsonb, text) to authenticated;

-- Set what one SKU is, by hand
create or replace function public.inv_save_sku(p_source text, p_sku text, p_items jsonb, p_by text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.sees_costs() then raise exception 'Not allowed'; end if;
  insert into inv_channel_skus (source, sku, items, how, updated_by) values (p_source, p_sku, coalesce(p_items, '[]'::jsonb), 'person', p_by)
  on conflict (source, sku) do update set items = excluded.items, how = 'person', updated_by = p_by, updated_at = now();
  update inv_meta set rates_at = null where id = 1;
end $$;
grant execute on function public.inv_save_sku(text, text, jsonb, text) to authenticated;

-- Which dispatched orders match marketplace order numbers: their slip items, by order number
create or replace function public.inv_orders_by_ref(p_refs text[]) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(r, items), '{}'::jsonb) from (
    select distinct on (public.inv_norm(l.channel_ref)) public.inv_norm(l.channel_ref) as r, l.items
    from dispatch_labels l
    where public.inv_norm(l.channel_ref) = any (p_refs) and jsonb_array_length(l.items) > 0 and public.sees_costs()
    order by public.inv_norm(l.channel_ref), l.created_at desc
  ) x
$$;
grant execute on function public.inv_orders_by_ref(text[]) to authenticated;

-- HELM item codes and names, for matching SKUs by hand
create or replace function public.inv_helm_items() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('code', code, 'name', name, 'components', components) order by name), '[]'::jsonb)
  from dispatch_item_units where public.is_active_user()
$$;
grant execute on function public.inv_helm_items() to authenticated;

create index if not exists dispatch_labels_channel_norm_idx on dispatch_labels (public.inv_norm(channel_ref));
