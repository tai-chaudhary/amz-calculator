-- Ready for dispatch: packed and labelled, waiting for collection.
-- Upload → Print → Ready for dispatch → Dispatched; who and when at every step.
alter table dispatch_labels add column if not exists packed_at timestamptz;
alter table dispatch_labels add column if not exists packed_by_name text;
