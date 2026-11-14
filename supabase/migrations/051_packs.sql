-- Bought in packs (v2.45.0)
--   Kite sells mailers in packs of 100: the PO and Goods In check-in count packs, Inventory counts units.
--   Put-away turns packs into units (packs × units in a pack, from the Product — or the PO line, if it
--   recorded the pack size). Safe to re-run.

create or replace function public.inv_put_away_plan(p_delivery uuid)
 returns jsonb language sql stable security definer set search_path to 'public'
as $function$
  select coalesce(jsonb_agg(x.j order by x.n), '[]'::jsonb) from (
    select l.n, jsonb_build_object(
      'i', l.n, 'po_item_id', l.line ->> 'po_item_id', 'stock_item_id', i.stock_item_id,
      'name', coalesce(s.name, l.line ->> 'name'), 'po_name', l.line ->> 'name',
      'packs', pk.packs, 'pack_units', pk.per,
      'units', pk.packs * pk.per,
      'match', case when lp.id is not null then 'product'
                    when s.id is not null then 'new'
                    when nm.id is not null then 'name'
                    when i.stock_item_id is null and i.id is not null then 'not_stock'
                    else 'none' end,
      'product_id', coalesce(lp.id, nm.id),
      'product_name', coalesce(lp.name, nm.name), 'product_code', coalesce(lp.code, nm.code),
      'new_name', case when lp.id is null and s.id is not null then s.name end,
      'new_sku', case when lp.id is null and s.id is not null then nullif(s.data ->> 'sku', '') end
    ) j
    from goods_in_deliveries d
    cross join lateral jsonb_array_elements(d.lines) with ordinality as l(line, n)
    left join purchase_order_items i on i.id = nullif(l.line ->> 'po_item_id', '')::uuid
    left join stock_items s on s.id = i.stock_item_id
    left join inv_products lp on lp.stock_item_id = i.stock_item_id and lp.active
    cross join lateral (select
        greatest(coalesce(nullif(l.line ->> 'arrived', '')::numeric, nullif(l.line ->> 'qty', '')::numeric, 0)
                 - coalesce(nullif(l.line ->> 'damaged', '')::numeric, 0), 0) as packs,
        greatest(coalesce(nullif(i.data ->> 'packUnits', '')::numeric, nullif(s.data ->> 'packUnits', '')::numeric, 1), 1) as per) pk
    left join lateral (
      select p.id, p.name, p.code from inv_products p
      where i.stock_item_id is null and p.active
        and (p.id = (select a.product_id from inv_aliases a where a.key = 'name:' || public.inv_norm(l.line ->> 'name'))
             or public.inv_norm(p.name) = public.inv_norm(l.line ->> 'name'))
      limit 1) nm on true
    where d.id = p_delivery and (public.can_open('goods-in') or public.inv_can_edit())
  ) x
$function$;
