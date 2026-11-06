-- New products need the office.
--
-- The warehouse adds products at Goods In (putting a delivery away) when
-- something arrives that inventory hasn't seen. Spelled wrong, or given the
-- wrong code, and every order linked to it goes wrong — so:
--   • added by the office (or someone trusted to link item codes): live straight away
--   • added by anyone else: "pending" — usable at once (stock can go on a shelf),
--     shown in Inventory as "Office to verify", given a temporary code if none was given
--   • the office approves it: checks the name, gives it its SKU (and a short stamp name)
--   • only the office changes a product's name or SKU; a SKU change carries every
--     verified code with it, and is logged
--   • codes can't be linked to a product until it's approved
-- Safe to re-run. Applied 19 Oct.

alter table public.inv_products add column if not exists status text not null default 'live';
alter table public.inv_products add column if not exists requested_by text;
alter table public.inv_products add column if not exists requested_at timestamptz;
alter table public.inv_products add column if not exists approved_by text;
alter table public.inv_products add column if not exists approved_at timestamptz;
create sequence if not exists public.inv_new_product_seq;

create or replace function public.can_approve_products()
 returns boolean language sql stable security definer set search_path to 'public'
as $$ select public.sees_costs() or public.can_link_codes() $$;
revoke all on function public.can_approve_products() from public, anon;
grant execute on function public.can_approve_products() to authenticated;

-- A SKU changed: every verified (or suggested) code that pointed at it follows
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
  return n;
end $function$;
revoke all on function public.inv_rename_sku(text, text, text) from public, anon, authenticated;

create or replace function public.inv_save_product(p_id uuid, p jsonb, p_by text)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare rid uuid; office boolean := public.can_approve_products(); cur inv_products%rowtype; newcode text; newname text;
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

-- The office checks a new product: its name, its SKU, its stamp name
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
  update inv_products set code = newcode, name = trim(p_name), stamp_name = nullif(trim(coalesce(p_stamp, '')), ''),
    status = 'live', approved_by = p_by, approved_at = now()
  where id = p_id;
  if newcode <> cur.code then perform public.inv_rename_sku(cur.code, newcode, p_by); end if;
end $function$;
revoke all on function public.inv_approve_product(uuid, text, text, text, text) from public, anon;
grant execute on function public.inv_approve_product(uuid, text, text, text, text) to authenticated;

-- Codes link only to approved products
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
  where p.active and p.status = 'live' and public.is_active_user()
  order by p.name
$function$;

-- inv_overview: each product also says whether it's waiting for the office, and its stamp name
do $patch$
declare d text := pg_get_functiondef('public.inv_overview'::regproc);
begin
  if position('''stamp_name'', p.stamp_name' in d) = 0 then
    execute replace(d, '''request'', case when rq.id',
      '''status'', p.status, ''stamp_name'', p.stamp_name, ''requested_by'', p.requested_by, ''requested_at'', p.requested_at, ''request'', case when rq.id');
  end if;
end $patch$;

-- Linking a code: the product it points at must be approved
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

-- An order code that is a product still waiting for the office: "pending", so its
-- orders hold (its name, and so its stamp, hasn't been checked yet)
do $patch2$
declare d text := pg_get_functiondef('public.dispatch_code_info'::regproc);
begin
  if position('''pending''' in d) = 0 then
    execute replace(d, 'case when (r.own).id is not null then ''own'' when',
      'case when (r.own).id is not null and (r.own).status <> ''live'' then ''pending'' when (r.own).id is not null then ''own'' when');
  end if;
end $patch2$;
