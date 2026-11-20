-- ALREADY APPLIED to the live database on 14-11-2026. A summary.
-- 103: cost_splits (pack_stock_item_id, single_stock_item_id, bottles_per_pack, note) — packs opened to sell singles.
-- Rows: Scola Artmix Assorted 12 x 600ml opened for White and Burnt Umber singles: a bottle costs pack cost / 12; the
-- opened packs stay in stock at the rest of their cost (they will be refilled). Also on 14 Nov: the scratch table
-- doc_text_scratch and the edge function doc-text (reads the text of PDFs in the purchase-docs bucket) — kept, useful
-- for carrier invoices. The function's source is in Supabase only; it is not in this repo yet.
select 1;
