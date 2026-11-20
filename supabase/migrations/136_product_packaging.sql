-- 136: each product's "packaging when sent on its own", dated — for costing website orders as baskets.
--
-- The owner's rule (18 Nov 2026): a Plenty&More or Salt 4 U order has no listing. The warehouse picks the box that fits;
-- the portal costs it as "the biggest item decides the box": the dearest of the order's products' own packaging, once
-- for each real parcel. This table holds that packaging for each product, from a date (earlier days keep what they had).
-- A wrong row is removed, never edited. Packaging costs themselves stay in Cost Settings → Packaging.
create table if not exists public.product_packaging (
  id bigserial primary key,
  stock_item_id uuid not null references public.stock_items(id) on delete cascade,
  from_date date not null,
  packaging_id text,                               -- a packaging type of Cost Settings, or null with own_packaging
  own_packaging boolean not null default false,    -- sent in its own packaging: no box, no cost
  note text,
  created_at timestamptz not null default now(), created_by text,
  removed_at timestamptz, removed_by text,
  check (own_packaging or coalesce(packaging_id, '') <> '')
);
create index if not exists product_packaging_lookup on public.product_packaging (stock_item_id, from_date desc) where removed_at is null;
alter table public.product_packaging enable row level security;
drop policy if exists "Read product packaging" on public.product_packaging;
create policy "Read product packaging" on public.product_packaging for select to authenticated using (public.is_active_user());
revoke all on public.product_packaging from anon;
revoke insert, update, delete, truncate, references, trigger on public.product_packaging from authenticated;

create or replace function public.product_packaging_list() returns jsonb
language plpgsql stable security definer set search_path to 'public' as $fn$
begin
  if not public.is_active_user() then raise exception 'Not allowed'; end if;
  return jsonb_build_object('today', public.uk_today(), 'rows', coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'stock_item_id', p.stock_item_id, 'from_date', p.from_date, 'packaging_id', p.packaging_id,
      'own', p.own_packaging, 'note', p.note, 'by', p.created_by, 'at', p.created_at) order by p.stock_item_id, p.from_date desc, p.id desc)
    from product_packaging p where p.removed_at is null), '[]'::jsonb));
end $fn$;

create or replace function public.product_packaging_set(p_item uuid, p_packaging text, p_own boolean, p_from date default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $fn$
declare v_from date := coalesce(p_from, public.uk_today()); v_id bigint; v_name text; v_pack text;
begin
  if not (public.is_admin() or public.sees_costs()) then raise exception 'Only people who see costs can set a product''s packaging'; end if;
  select name into v_name from stock_items where id = p_item;
  if v_name is null then raise exception 'That product was not found'; end if;
  if not coalesce(p_own, false) then
    select x->>'name' into v_pack from settings st, jsonb_array_elements(st.value->'packaging') x where st.key = 'app_settings' and x->>'id' = p_packaging;
    if v_pack is null then raise exception 'Choose a packaging type, or "own packaging"'; end if;
  end if;
  insert into product_packaging (stock_item_id, from_date, packaging_id, own_packaging, note, created_by)
  values (p_item, v_from, case when coalesce(p_own, false) then null else p_packaging end, coalesce(p_own, false), nullif(trim(coalesce(p_note, '')), ''), public.my_name())
  returning id into v_id;
  insert into activity_log (user_name, entity_type, entity_id, entity_name, action, detail, source)
  values (public.my_name(), 'stock', p_item::text, v_name, 'Packaging when sent on its own',
    coalesce(v_pack, 'Own packaging (no box)') || ' from ' || to_char(v_from, 'DD Mon YYYY') || coalesce(' — ' || nullif(trim(coalesce(p_note, '')), ''), ''), 'packaging');
  return jsonb_build_object('id', v_id, 'from_date', v_from);
end $fn$;

create or replace function public.product_packaging_remove(p_id bigint) returns jsonb
language plpgsql security definer set search_path to 'public' as $fn$
declare r product_packaging; v_name text;
begin
  if not (public.is_admin() or public.sees_costs()) then raise exception 'Only people who see costs can change a product''s packaging'; end if;
  select * into r from product_packaging where id = p_id and removed_at is null;
  if r.id is null then raise exception 'That entry is not there any more'; end if;
  update product_packaging set removed_at = now(), removed_by = public.my_name() where id = p_id;
  select name into v_name from stock_items where id = r.stock_item_id;
  insert into activity_log (user_name, entity_type, entity_id, entity_name, action, detail, source)
  values (public.my_name(), 'stock', r.stock_item_id::text, v_name, 'Packaging when sent on its own removed', 'The entry from ' || to_char(r.from_date, 'DD Mon YYYY') || ' — entered by mistake', 'packaging');
  return jsonb_build_object('removed', p_id);
end $fn$;

-- Where it starts: the Amazon listing that sends exactly ONE of the product (packaging set; the most sold where there
-- are several). Products with no such listing start with nothing and show as "not set".
insert into public.product_packaging (stock_item_id, from_date, packaging_id, own_packaging, note, created_by)
select distinct on (x.stock_item_id) x.stock_item_id, date '2026-08-01', nullif(x.pid, ''), x.own,
  'From the Amazon listing "' || x.sku || '", which sends one of this product.', 'Claude'
from (
  select (sp.data->'components'->0->>'stockItemId')::uuid stock_item_id, sp.data->>'listingSku' sku, coalesce(sp.data->>'packagingId', '') pid,
    coalesce(sp.data->>'ownPackaging', '') = 'true' own,
    (select count(*) from sales_lines sl where sl.channel = 'Amazon' and sl.kind = 'sale' and upper(trim(sl.listing_sku)) = upper(trim(sp.data->>'listingSku'))) sold
  from saved_products sp
  where coalesce(sp.data->>'channel', 'Amazon') = 'Amazon' and coalesce(sp.data->>'archived', '') <> 'true'
    and jsonb_typeof(sp.data->'components') = 'array' and jsonb_array_length(sp.data->'components') = 1
    and coalesce(nullif(sp.data->'components'->0->>'qty', ''), '1')::numeric = 1
    and (coalesce(sp.data->>'packagingId', '') <> '' or coalesce(sp.data->>'ownPackaging', '') = 'true')
    and (sp.data->'components'->0->>'stockItemId') is not null
) x
join public.stock_items s on s.id = x.stock_item_id
where not exists (select 1 from public.product_packaging p where p.stock_item_id = x.stock_item_id and p.removed_at is null)
order by x.stock_item_id, x.sold desc, x.sku;
