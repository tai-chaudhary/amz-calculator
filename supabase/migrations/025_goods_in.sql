-- ── Goods in ────────────────────────────────────────────────────────────────
-- The warehouse books deliveries in against stock and packaging orders, and
-- logs anything that turns up without one. The warehouse can't read purchase
-- orders (they carry prices), so everything goes through the functions below,
-- which only ever hand back names, quantities and dates.

create or replace function public.can_open(page text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and active
    and (role = 'admin' or permissions ? page))
$$;
grant execute on function public.can_open(text) to authenticated;

create sequence if not exists goods_in_seq;

create table if not exists goods_in_deliveries (
  id uuid primary key default gen_random_uuid(),
  ref text unique not null default ('GI-' || lpad(nextval('goods_in_seq')::text, 4, '0')),
  po_id uuid references purchase_orders(id) on delete set null,
  supplier_name text,
  delivery_note_no text,
  cartons integer, pallets integer,
  signed_unchecked boolean not null default false,
  note_photo_path text,
  photos jsonb not null default '[]'::jsonb,          -- damage and other photos
  lines jsonb not null default '[]'::jsonb,           -- [{po_item_id, name, expected, arrived, damaged, note, photo_path}]
  received_by text, received_by_user uuid default auth.uid(),
  received_at timestamptz default now(),
  kind text not null default 'order',                 -- order | unexpected
  has_problems boolean not null default false,
  office_status text not null default 'none',         -- none | open | resolved
  office_note text, resolved_at timestamptz, resolved_by text,
  put_away_at timestamptz, put_away_by text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz default now(), updated_at timestamptz default now()
);
create index if not exists goods_in_po_idx on goods_in_deliveries(po_id);
create index if not exists goods_in_received_idx on goods_in_deliveries(received_at desc);
drop trigger if exists touch_goods_in on goods_in_deliveries;
create trigger touch_goods_in before update on goods_in_deliveries for each row execute function touch_updated_at();

alter table goods_in_deliveries enable row level security;
drop policy if exists "Goods in staff" on goods_in_deliveries;
create policy "Goods in staff" on goods_in_deliveries for all to authenticated
  using (public.can_open('goods-in') or public.sees_costs())
  with check (public.can_open('goods-in') or public.sees_costs());

-- Photos: delivery notes and damage
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('goods-in-photos', 'goods-in-photos', false, 15728640,
  array['image/png','image/jpeg','image/webp','image/heic','image/heif','application/pdf'])
on conflict (id) do update set public = false, file_size_limit = 15728640, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists "Goods in read photos" on storage.objects;
drop policy if exists "Goods in add photos" on storage.objects;
create policy "Goods in read photos" on storage.objects for select to authenticated
  using (bucket_id = 'goods-in-photos' and (public.can_open('goods-in') or public.sees_costs()));
create policy "Goods in add photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'goods-in-photos' and (public.can_open('goods-in') or public.sees_costs()));

-- What's coming: open stock and packaging orders, plus the last few weeks'
-- finished ones. Names, quantities and dates — no prices. The delivery date is
-- only given once someone has confirmed it with the supplier.
create or replace function public.goods_in_orders()
returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(o order by o->>'sort'), '[]'::jsonb) from (
    select jsonb_build_object(
      'id', po.id, 'po_number', po.po_number, 'supplier_name', po.supplier_name,
      'category', po.category, 'status', po.status, 'terms', po.terms, 'payment_status', po.payment_status,
      'sent_at', po.sent_at, 'paid_at', po.paid_at, 'created_at', po.created_at, 'received_at', po.received_at,
      'delivery_date', po.delivery_date, 'delivery_note', po.delivery_note,
      'sort', coalesce(po.delivery_date::text, '9999') || po.po_number,
      'items', coalesce((select jsonb_agg(jsonb_build_object(
          'id', i.id, 'name', i.name, 'supplier_sku', i.supplier_sku, 'stock_item_id', i.stock_item_id,
          'qty', i.qty, 'qty_received', i.qty_received, 'line_status', i.line_status, 'back_order_date', i.back_order_date,
          'barcode', s.data ->> 'barcode'
        ) order by i.created_at, i.name)
        from purchase_order_items i left join stock_items s on s.id = i.stock_item_id
        where i.po_id = po.id), '[]'::jsonb)
    ) as o
    from purchase_orders po
    where (public.can_open('goods-in') or public.sees_costs())
      and coalesce(po.kind, 'order') <> 'credit_note'
      and coalesce(po.category, 'stock') in ('stock', 'packaging')
      and po.status not in ('draft', 'cancelled')
      and (po.status not in ('received', 'completed') or po.received_at > now() - interval '30 days'
           or exists (select 1 from purchase_order_items i where i.po_id = po.id
                      and coalesce(i.line_status, 'due') <> 'cancelled' and coalesce(i.qty_received, 0) < coalesce(i.qty, 0)))
  ) x
$$;
grant execute on function public.goods_in_orders() to authenticated;

-- Book a delivery in. lines: [{po_item_id, name, expected, arrived, damaged, note, photo_path}]
-- Arrived counts everything that came, damaged included; damage and anything
-- short are reported to the office as delivery problems with their value.
create or replace function public.book_in_delivery(p_po_id uuid, p_lines jsonb, p_delivery jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  po purchase_orders%rowtype;
  l jsonb; it purchase_order_items%rowtype;
  arrived numeric; damaged numeric; problems boolean := false;
  total_qty numeric; total_got numeric; started boolean;
  d goods_in_deliveries%rowtype;
  who text := nullif(p_delivery ->> 'received_by', '');
begin
  if not (public.can_open('goods-in') or public.sees_costs()) then raise exception 'Not allowed'; end if;
  select * into po from purchase_orders where id = p_po_id;
  if not found then raise exception 'Order not found'; end if;
  if po.status in ('draft', 'cancelled') then raise exception 'That order isn''t placed'; end if;

  for l in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    arrived := coalesce((l ->> 'arrived')::numeric, 0);
    damaged := coalesce((l ->> 'damaged')::numeric, 0);
    select * into it from purchase_order_items where id = (l ->> 'po_item_id')::uuid and po_id = p_po_id;
    if not found then continue; end if;
    if arrived <> 0 then
      update purchase_order_items set qty_received = coalesce(qty_received, 0) + arrived where id = it.id;
      -- A back-ordered line that turns up is back with the order
      if it.line_status = 'back_order' and coalesce(it.qty_received, 0) + arrived >= coalesce(it.qty, 0) then
        update purchase_order_items set line_status = 'due', back_order_date = null where id = it.id;
      end if;
      -- Tell the requests on this line
      insert into stock_request_events (request_id, by_name, action, detail)
      select r.id, who, 'Delivery booked in',
             arrived || ' arrived' || case when damaged > 0 then ', ' || damaged || ' damaged' else '' end
      from stock_requests r where r.po_item_id = it.id;
    end if;
    if damaged > 0 then
      problems := true;
      insert into purchase_issues (po_id, po_item_id, kind, qty, value, description, status, reported_by, data)
      values (p_po_id, it.id, 'damaged', damaged, round(damaged * coalesce(it.unit_cost, 0), 2),
              nullif(concat_ws(' · ', 'Found at goods in', nullif(l ->> 'note', '')), ''), 'reported', who,
              jsonb_build_object('photo_path', l ->> 'photo_path', 'source', 'goods_in'));
    end if;
    if (l ->> 'short')::boolean is true then
      problems := true;
      insert into purchase_issues (po_id, po_item_id, kind, qty, value, description, status, reported_by, data)
      values (p_po_id, it.id, 'missing', coalesce((l ->> 'short_qty')::numeric, 0),
              round(coalesce((l ->> 'short_qty')::numeric, 0) * coalesce(it.unit_cost, 0), 2),
              nullif(concat_ws(' · ', 'Short at goods in', nullif(l ->> 'note', '')), ''), 'reported', who,
              jsonb_build_object('source', 'goods_in'));
    end if;
    if coalesce((l ->> 'wrong_qty')::numeric, 0) > 0 then
      problems := true;
      insert into purchase_issues (po_id, po_item_id, kind, qty, value, description, status, reported_by, data)
      values (p_po_id, it.id, 'wrong_item', (l ->> 'wrong_qty')::numeric,
              round((l ->> 'wrong_qty')::numeric * coalesce(it.unit_cost, 0), 2),
              nullif(concat_ws(' · ', 'Wrong item at goods in', nullif(l ->> 'note', '')), ''), 'reported', who,
              jsonb_build_object('photo_path', l ->> 'photo_path', 'source', 'goods_in'));
    end if;
  end loop;

  select coalesce(sum(qty), 0), coalesce(sum(least(coalesce(qty_received, 0), qty)), 0), bool_or(coalesce(qty_received, 0) > 0)
    into total_qty, total_got, started
  from purchase_order_items where po_id = p_po_id and coalesce(line_status, 'due') <> 'cancelled';

  update purchase_orders set
    status = case when status = 'completed' then status
                  when total_qty > 0 and total_got >= total_qty then 'received'
                  when started then 'partially_received' else status end,
    received_at = now()
  where id = p_po_id;

  insert into goods_in_deliveries (po_id, supplier_name, delivery_note_no, cartons, pallets, signed_unchecked,
      note_photo_path, photos, lines, received_by, kind, has_problems, office_status, data)
  values (p_po_id, po.supplier_name, nullif(p_delivery ->> 'delivery_note_no', ''),
      nullif(p_delivery ->> 'cartons', '')::int, nullif(p_delivery ->> 'pallets', '')::int,
      coalesce((p_delivery ->> 'signed_unchecked')::boolean, false),
      nullif(p_delivery ->> 'note_photo_path', ''), coalesce(p_delivery -> 'photos', '[]'::jsonb),
      coalesce(p_lines, '[]'::jsonb), who, 'order', problems, case when problems then 'open' else 'none' end,
      jsonb_build_object('po_number', po.po_number))
  returning * into d;

  insert into activity_log (entity_type, entity_id, entity_name, action, detail, user_name, source)
  values ('purchase', p_po_id, po.po_number, 'Delivery booked in',
          d.ref || coalesce(' by ' || who, '') || case when problems then ' · with problems' else '' end, who, 'goods-in');

  return jsonb_build_object('id', d.id, 'ref', d.ref, 'problems', problems);
end $$;
grant execute on function public.book_in_delivery(uuid, jsonb, jsonb) to authenticated;
