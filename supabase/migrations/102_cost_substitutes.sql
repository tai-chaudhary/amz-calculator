-- ALREADY APPLIED to the live database on 14-11-2026. A summary.
-- 102: cost_substitutes (sold_stock_item_id, sent_stock_item_id, until_at, note) — an order for one product that was
-- sent another until a date. One row: Scola Multipurpose Glue 5L orders drew on Clear PVA 5L until Multipurpose was
-- first stocked (4 Nov 2026). cost_rebuild() costs those sales from the product that was really sent.
select 1;
