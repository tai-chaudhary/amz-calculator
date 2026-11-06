-- Substitutes and pick lists.
--
-- Substitutes: when a product runs out, the warehouse sometimes sends a
-- similar one the customer is happy with. Recording what was sent means the
-- right stock comes off the shelf (the substitute's, not the ordered one's)
-- and every substitute is logged, so the office can see how often it happens.
--
-- Pick list: for a set of batches, how many of each product to pick and from
-- which shelves, worked out with the same rules as despatch (pack sizes and
-- bundles through inv_expand, pick shelf first, then overflow).
--
-- Safe to re-run. Applied 17 Oct (033a table, policy, 033b functions, 033c pick list).

-- ── What was sent instead ───────────────────────────────────────────────────
create table if not exists public.dispatch_substitutes (
  id uuid primary key default gen_random_uuid(),
  upload_id uuid not null references public.dispatch_uploads(id) on delete cascade,
  order_key text not null,                 -- coalesce(dispatch_labels.order_key, id) within the upload
  ref text,                                -- order reference, for reading the log
  product_id uuid not null references public.inv_products(id) on delete cascade,
  product_name text,
  ordered_units numeric not null,          -- units of the ordered product this order needed
  sub_product_id uuid not null references public.inv_products(id) on delete cascade,
  sub_name text,
  units numeric not null check (units > 0),-- units of the substitute that went instead
  note text,
  by_name text,
  created_at timestamptz not null default now(),
  unique (upload_id, order_key, product_id)
);
create index if not exists dispatch_substitutes_created_idx on public.dispatch_substitutes(created_at);
create index if not exists dispatch_substitutes_product_idx on public.dispatch_substitutes(product_id);
create index if not exists dispatch_substitutes_sub_idx on public.dispatch_substitutes(sub_product_id);

alter table public.dispatch_substitutes enable row level security;
drop policy if exists "Read substitutes" on public.dispatch_substitutes;
create policy "Read substitutes" on public.dispatch_substitutes for select to authenticated
  using ((select public.can_open('dispatch')) or (select public.can_open('dispatch-dashboard')) or (select public.can_open('inventory')));
-- Written only through dispatch_set_substitute below

-- ── Despatch takes the substitute's stock when one was sent ─────────────────
create or replace function public.inv_despatch_order(p_upload uuid, p_key text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare k text := p_upload::text || '|' || p_key;
  items jsonb; gone_at timestamptz; ref text; who text; is_repl boolean; e record; started timestamptz; s record;
begin
  select started_at into started from inv_meta where id = 1;
  if started is null then return; end if;
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
      select * into s from dispatch_substitutes d
        where d.upload_id = p_upload and d.order_key = p_key and d.product_id = e.product_id;
      if found then
        perform public.inv_take(s.sub_product_id, s.units, 'despatch', coalesce(gone_at, now()), ref, k, who,
                                concat_ws(' · ', case when is_repl then 'replacement' end,
                                          'substitute for ' || coalesce(s.product_name, e.name)));
        perform public.inv_check_replenish(s.sub_product_id);
      else
        perform public.inv_take(e.product_id, e.units, 'despatch', coalesce(gone_at, now()), ref, k, who,
                                case when is_repl then 'replacement' end);
        perform public.inv_check_replenish(e.product_id);
      end if;
    end if;
  end loop;
end $function$;
revoke all on function public.inv_despatch_order(uuid, text) from public, anon, authenticated;

-- ── Record (or take back) a substitute for one or more orders ───────────────
-- p_orders: [{ "upload_id": "...", "order_key": "..." }, …]
-- p_ratio: substitute units sent for each unit ordered (1 = like for like)
-- p_sub null takes the substitute back off those orders.
-- An order already despatched has its stock put right straight away.
create or replace function public.dispatch_set_substitute(p_orders jsonb, p_product uuid, p_sub uuid, p_ratio numeric, p_by text, p_note text default null)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare o record; items jsonb; ordered numeric; r text; n int := 0; pname text; sname text;
begin
  if not public.can_open('dispatch') then raise exception 'Not allowed'; end if;
  if p_sub is not null and p_sub = p_product then raise exception 'Pick a different product as the substitute'; end if;
  if p_sub is not null and coalesce(p_ratio, 0) <= 0 then raise exception 'How many were sent has to be more than 0'; end if;
  select name into pname from inv_products where id = p_product;
  select name into sname from inv_products where id = p_sub;

  for o in select (x ->> 'upload_id')::uuid as upload_id, x ->> 'order_key' as order_key
           from jsonb_array_elements(coalesce(p_orders, '[]'::jsonb)) x loop
    if p_sub is null then
      delete from dispatch_substitutes where upload_id = o.upload_id and order_key = o.order_key and product_id = p_product;
    else
      select (array_agg(l.items order by jsonb_array_length(l.items) desc))[1],
             min(coalesce(nullif(l.channel_ref, ''), nullif(l.helm_order, ''), l.label_ref))
        into items, r
      from dispatch_labels l where l.upload_id = o.upload_id and coalesce(l.order_key, l.id::text) = o.order_key
        and l.status <> 'cancelled';
      select coalesce(sum(e.units), 0) into ordered from public.inv_expand(items) e where e.product_id = p_product;
      if ordered <= 0 then continue; end if;
      insert into dispatch_substitutes (upload_id, order_key, ref, product_id, product_name, ordered_units,
                                        sub_product_id, sub_name, units, note, by_name)
      values (o.upload_id, o.order_key, r, p_product, pname, ordered, p_sub, sname, ordered * p_ratio, p_note, p_by)
      on conflict (upload_id, order_key, product_id) do update
        set sub_product_id = excluded.sub_product_id, sub_name = excluded.sub_name, units = excluded.units,
            ordered_units = excluded.ordered_units, note = excluded.note, by_name = excluded.by_name, created_at = now();
    end if;
    n := n + 1;
    -- Already gone: put the stock back as it was ordered, then take it again the right way
    if exists (select 1 from inv_despatched where order_key = o.upload_id::text || '|' || o.order_key and counted) then
      perform public.inv_undo_despatch(o.upload_id, o.order_key);
      perform public.inv_despatch_order(o.upload_id, o.order_key);
    end if;
  end loop;
  return n;
end $function$;
revoke all on function public.dispatch_set_substitute(jsonb, uuid, uuid, numeric, text, text) from public, anon;
grant execute on function public.dispatch_set_substitute(jsonb, uuid, uuid, numeric, text, text) to authenticated;

-- ── Pick list for a set of batches ──────────────────────────────────────────
-- Orders on these batches still to go (and, with p_all, those already
-- dispatched, so a substitute can be recorded afterwards), expanded into
-- products. Each product comes with its shelves (pick shelves first) and how
-- much is on them, any substitutes already recorded, and the orders it's on.
-- (An earlier one-argument version may still exist on the live database; the
-- portal always calls this one.)
create or replace function public.dispatch_pick_list(p_batches uuid[], p_all boolean)
 returns jsonb
 language plpgsql
 stable
 security definer
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
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'product_id', per.product_id,
      'code', coalesce(p.code, per.code),
      'name', coalesce(p.name, per.helm_name, per.code),
      'units', per.units,
      'orders', per.orders,
      'order_list', per.order_list,
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
revoke all on function public.dispatch_pick_list(uuid[], boolean) from public, anon;
grant execute on function public.dispatch_pick_list(uuid[], boolean) to authenticated;

-- ── Products to choose a substitute from ────────────────────────────────────
create or replace function public.inv_product_picker()
 returns table (id uuid, code text, name text, on_hand numeric)
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  select p.id, p.code, p.name, coalesce((select sum(b.qty) from inv_balances b where b.product_id = p.id), 0)
  from inv_products p
  where p.active and (public.can_open('dispatch') or public.can_open('inventory'))
  order by p.name
$function$;
revoke all on function public.inv_product_picker() from public, anon;
grant execute on function public.inv_product_picker() to authenticated;
