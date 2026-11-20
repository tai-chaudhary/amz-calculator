-- ALREADY APPLIED to the live database on 14-11-2026. A summary.
-- 100: cost_receipts — the product lines of the 15 supplier invoices from July to September 2026 that were entered as
-- one PO line per invoice (data.broughtForward). Columns: stock_item_id, received_on, units, unit_cost, kind
-- ('stock' | 'delivery'), source, ref, name, note. 49 product lines and 3 delivery-charge rows, each invoice
-- reconciled to its total. Read with the scratch edge function doc-text. RLS on, no app access: only the costing reads it.
select 1;
