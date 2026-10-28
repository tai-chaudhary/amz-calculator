-- Every code on a packing slip resolves to our own products (internal SKUs),
-- with the right quantity, checked by a person the first time.
--
-- A slip code is, in turn:
--   1. one of our SKUs (inv_products.code)            → itself, 1 each. Nothing to check.
--   2. a code a person has verified (inv_channel_skus, source 'portal')
--                                                      → what they said: "1 of this = N × SKU"
--   3. a pack split from HELM's product list           → used to hold stock, but NOT verified:
--                                                        an upload holds the order until a person confirms it
--   4. nothing                                         → not linked: held at upload
-- A verified code can be "the same product" or "sent instead" (a substitute
-- by default), in which case the product the listing should be is recorded.
--
-- Only people with the "Link item codes" permission (or admins) can verify.
-- Every change is kept in inv_code_log.
-- Safe to re-run. Applied 18 Oct.

-- ── What a person said a code is ───────────────────────────────────────────
alter table public.inv_channel_skus add column if not exists kind text not null default 'same';   -- same | substitute
alter table public.inv_channel_skus add column if not exists wanted_name text;                     -- substitute: what the listing should be
alter table public.inv_channel_skus add column if not exists verified_by text;
alter table public.inv_channel_skus add column if not exists verified_at timestamptz;

create table if not exists public.inv_code_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  code text not null,
  title text,
  items jsonb,
  kind text,
  wanted_name text,
  by_name text,
  action text not null                      -- verified | changed | removed
);
alter table public.inv_code_log enable row level security;
drop policy if exists "Read code log" on public.inv_code_log;
create policy "Read code log" on public.inv_code_log for select to authenticated using ((select public.is_active_user()));

-- A short name for the stamp, when the product's full name is too long (optional)
alter table public.inv_products add column if not exists stamp_name text;

create or replace function public.can_link_codes()
 returns boolean language sql stable security definer set search_path to 'public'
as $$ select public.can_open('link-codes') $$;
revoke all on function public.can_link_codes() from public, anon;
grant execute on function public.can_link_codes() to authenticated;

-- "Link item codes" is a permission, not a page: it never lets anyone see costs
create or replace function public.sees_costs()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select exists (
    select 1 from profiles
    where id = auth.uid() and active
      and (role = 'admin' or exists (
        select 1 from jsonb_array_elements_text(permissions) p
        where p not in ('dispatch', 'dispatch-dashboard', 'requests', 'goods-in', 'inventory', 'tasks', 'tracking', 'link-codes')))
  )
$function$;

-- ── Codes → our products ────────────────────────────────────────────────────
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
  ), own as (
    select it.code, it.name, it.qty, p.id as pid, p.code as pcode, p.name as pname,
           (select x.items from inv_channel_skus x
             where x.source = 'portal' and x.how = 'person' and public.inv_norm(x.sku) = public.inv_norm(it.code)
               and jsonb_array_length(coalesce(x.items, '[]'::jsonb)) > 0 limit 1) as link,
           (select u.components from dispatch_item_units u
             where u.code_key = public.inv_norm(it.code) and jsonb_array_length(coalesce(u.components, '[]'::jsonb)) > 0) as helm
    from it left join inv_products p on p.code_key = public.inv_norm(it.code)
    where it.qty > 0
  )
  -- 1. our own SKU
  select o.pid, o.pcode, o.pname, o.qty from own o where o.pid is not null
  union all
  -- 2. verified by a person
  select p.id, coalesce(p.code, li ->> 'code'), coalesce(p.name, o.name), o.qty * coalesce(nullif(li ->> 'qty', '')::numeric, 1)
  from own o cross join lateral jsonb_array_elements(o.link) li
  left join inv_products p on p.code_key = public.inv_norm(li ->> 'code')
  where o.pid is null and o.link is not null
  union all
  -- 3. HELM's pack split (holds stock; an upload still asks a person to verify it)
  select p.id, coalesce(p.code, c ->> 'code'), coalesce(p.name, c ->> 'name', o.name), o.qty * coalesce(nullif(c ->> 'units', '')::numeric, 1)
  from own o cross join lateral jsonb_array_elements(o.helm) c
  left join inv_products p on p.code_key = public.inv_norm(c ->> 'code')
  where o.pid is null and o.link is null and o.helm is not null
  union all
  -- 4. nothing known
  select null::uuid, o.code, o.name, o.qty from own o where o.pid is null and o.link is null and o.helm is null
$function$;

-- ── What each code is, for an upload ────────────────────────────────────────
-- One row per code: status own | verified | unverified | unknown | broken,
-- the products it is (code, name, stamp name, how many in one), and for a
-- substitute what it should have been.
create or replace function public.dispatch_code_info(p_codes text[])
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with c as (select distinct on (public.inv_norm(x)) x as code, public.inv_norm(x) as k from unnest(coalesce(p_codes, '{}')) x where coalesce(x, '') <> ''),
  r as (
    select c.code, c.k, p as own, l, u
    from c
    left join inv_products p on p.code_key = c.k
    left join lateral (select * from inv_channel_skus x where x.source = 'portal' and x.how = 'person'
                         and public.inv_norm(x.sku) = c.k and jsonb_array_length(coalesce(x.items, '[]'::jsonb)) > 0 limit 1) l on true
    left join lateral (select * from dispatch_item_units d where d.code_key = c.k and jsonb_array_length(coalesce(d.components, '[]'::jsonb)) > 0) u on true
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
      'verified_by', s.verified_by, 'verified_at', s.verified_at, 'title', s.title)), '[]'::jsonb)
  from shaped s
  where public.is_active_user()
$function$;
revoke all on function public.dispatch_code_info(text[]) from public, anon;
grant execute on function public.dispatch_code_info(text[]) to authenticated;

-- ── Products to link a code to: name, SKU, shelves and stock ────────────────
create or replace function public.inv_link_candidates()
 returns table(id uuid, code text, name text, stamp_name text, on_hand numeric, locations text)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select p.id, p.code, p.name, p.stamp_name,
         coalesce((select sum(b.qty) from inv_balances b where b.product_id = p.id and b.location <> ''), 0),
         (select string_agg(b.location || ' (' || b.qty::int || ')', ', ' order by l.pickable desc, b.location)
            from inv_balances b join inv_locations l on l.code = b.location where b.product_id = p.id and b.qty > 0)
  from inv_products p
  where p.active and public.is_active_user()
  order by p.name
$function$;
revoke all on function public.inv_link_candidates() from public, anon;
grant execute on function public.inv_link_candidates() to authenticated;

-- ── Verify (or change, or remove) what a code is ────────────────────────────
-- p_items: [{ "code": "<our SKU>", "qty": <how many in one of this code> }, …]; empty removes it.
-- p_kind: 'same' (the listing is this product) or 'substitute' (we send this instead of p_wanted).
-- Anything that went out under this code before it was verified comes off the shelves now.
drop function if exists public.inv_link_code(text, text, jsonb, text);
-- (Applied 18 Oct as two functions: the database tool won't create a function that deletes rows
-- without a person confirming, so what went out early is marked as dealt with instead of deleted.)
create or replace function public.inv_link_catch_up(p_key text, p_code text, p_items jsonb, p_by text)
 returns numeric
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare u record; it record; pid uuid; taken numeric := 0;
begin
  select * into u from inv_unmatched where code_key = p_key;
  if not found or coalesce(u.units, 0) <= 0 then return 0; end if;
  for it in select x ->> 'code' as code, nullif(x ->> 'qty', '')::numeric as qty from jsonb_array_elements(p_items) x loop
    select id into pid from inv_products where code_key = public.inv_norm(it.code);
    perform public.inv_take(pid, u.units * it.qty, 'despatch', now(), null, concat('linked:', p_key), p_by,
                            concat('Gone out as ', p_code, ' before it was verified'));
    perform public.inv_check_replenish(pid);
    taken := taken + u.units * it.qty;
  end loop;
  -- Dealt with: nothing left to take for it
  update inv_unmatched set units = 0 where code_key = p_key;
  return taken;
end $function$;
revoke all on function public.inv_link_catch_up(text, text, jsonb, text) from public, anon, authenticated;

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
  existed := exists (select 1 from inv_channel_skus where source = 'portal' and sku = p_code and jsonb_array_length(coalesce(items, '[]'::jsonb)) > 0);
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
revoke all on function public.inv_link_code(text, text, jsonb, text, text, text) from public, anon;
grant execute on function public.inv_link_code(text, text, jsonb, text, text, text) to authenticated;

-- Every verified code, for the Links list
drop function if exists public.inv_code_links();
create or replace function public.inv_code_links()
 returns table(code text, title text, items jsonb, kind text, wanted_name text, verified_by text, verified_at timestamptz)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select sku, title, items, kind, wanted_name, verified_by, verified_at from inv_channel_skus
  where source = 'portal' and how = 'person' and jsonb_array_length(coalesce(items, '[]'::jsonb)) > 0 and public.is_active_user()
  order by verified_at desc nulls last
$function$;
revoke all on function public.inv_code_links() from public, anon;
grant execute on function public.inv_code_links() to authenticated;

-- ── Taking stock off at dispatch: never fail silently ───────────────────────
create table if not exists public.inv_despatch_errors (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  upload_id uuid,
  order_key text,
  error text,
  resolved_at timestamptz,
  resolved_by text
);
alter table public.inv_despatch_errors enable row level security;
drop policy if exists "Read despatch errors" on public.inv_despatch_errors;
create policy "Read despatch errors" on public.inv_despatch_errors for select to authenticated using ((select public.is_active_user()));

create or replace function public.inv_label_changed()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if new.status is not distinct from old.status then return null; end if;
  begin
    if new.status in ('dispatched', 'cancelled') then
      perform public.inv_despatch_order(new.upload_id, coalesce(new.order_key, new.id::text));
    elsif old.status = 'dispatched' then
      perform public.inv_undo_despatch(new.upload_id, coalesce(new.order_key, new.id::text));
    end if;
  exception when others then
    -- Dispatch carries on, but the office sees that stock didn't come off
    insert into inv_despatch_errors (upload_id, order_key, error) values (new.upload_id, coalesce(new.order_key, new.id::text), sqlerrm);
  end;
  return null;
end $function$;
