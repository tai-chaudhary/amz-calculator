-- 078: Requesting a refund failed: every Cases & Refunds record saves who logged it (created_by), but the refunds
-- table never had that column. Added, filled from requested_by. (Applied 03-11-2026.)
alter table refunds add column if not exists created_by text;
update refunds set created_by = requested_by where created_by is null;
notify pgrst, 'reload schema';
