-- 125 — report_pl_ship also says which products left the shelf for orders that have no listing (v2.97.0)
--
-- APPLIED to the live database on 17 Nov 2026. Read-only. The function's text before this is in public.fn_backups
-- ("report_pl_ship before 125 (order_products)").
--
-- Why: an order whose SKU has no listing in the portal (every eBay and TikTok order, and a few Amazon SKUs) showed
-- "(not linked to a product)" in the P&L's "Orders that lost money". The costing already knows what left the shelf
-- for it (cost_uses), so the screen can name it.
--
-- One new key; everything else is exactly migration 123:
--   order_products  { order ref → [{ id, name, units }] }   for the period's orders with a line that has no listing:
--                   the stock items that went out as that order's sale, largest first.
-- Checked 1 Aug – 17 Nov: 534 of the 544 such orders have products (the other 10 have no stock out recorded yet);
-- cashback (8,458 orders) and charges (£2,519.07) unchanged; 1.3s as a signed-in admin.
--
-- Applied as a patch to the live function (below). The whole function is in 123 with these two pieces added.

do $do$
declare d text; n text;
  a1 text := $o$  ), pat as ($o$;
  b1 text := $o$  ), prods as materialized (
    select q.order_ref, jsonb_agg(jsonb_build_object('id', q.id, 'name', q.name, 'units', q.units) order by q.units desc, q.name) items
    from (select nl.order_ref, s.id, s.name, sum(u.units) units from nl join cost_uses u on u.order_ref = nl.order_ref and u.kind = 'sale'
          join stock_items s on s.id = u.stock_item_id group by 1, 2, 3) q
    group by q.order_ref
  ), pat as ($o$;
  a2 text := $o$    'weights', coalesce($o$;
  b2 text := $o$    'order_products', coalesce((select jsonb_object_agg(order_ref, items) from prods), '{}'::jsonb),
    'weights', coalesce($o$;
begin
  select pg_get_functiondef('public.report_pl_ship(date,date,text)'::regprocedure) into d;
  if position('order_products' in d) > 0 then raise exception 'report_pl_ship already returns order_products'; end if;
  if (length(d) - length(replace(d, a1, ''))) / length(a1) <> 1 or (length(d) - length(replace(d, a2, ''))) / length(a2) <> 1 then
    raise exception 'report_pl_ship: an anchor was not found exactly once, nothing changed'; end if;
  insert into public.fn_backups(name, def) values ('report_pl_ship before 125 (order_products)', d);
  n := replace(replace(d, a1, b1), a2, b2);
  execute n;
end $do$;
