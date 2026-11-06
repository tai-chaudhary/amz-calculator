-- HELM's product list: every product, and every bundle as its parts
-- ("FAIRY…-10PK" = 10 × FAIRY…-320ML; a mixed set lists each thing in it).
-- Imported from HELM's "Inventory Products and Groups" export and refreshed
-- by uploading it again.
alter table dispatch_item_units add column if not exists components jsonb not null default '[]';
alter table dispatch_item_units add column if not exists source text;    -- 'helm' when it came from HELM's list
