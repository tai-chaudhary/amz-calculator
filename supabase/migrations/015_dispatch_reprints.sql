-- Reprints: a label can be printed again on its own (damaged, lost, ripped).
-- The latest one is kept on the label; every one is in the activity log.
alter table dispatch_labels add column if not exists reprint_count int not null default 0;
alter table dispatch_labels add column if not exists last_reprinted_at timestamptz;
alter table dispatch_labels add column if not exists last_reprinted_by_name text;
alter table dispatch_labels add column if not exists last_reprint_reason text;
-- Labels still to go out are looked up constantly (Close day, Delayed Dispatch)
create index if not exists dispatch_labels_open_idx on dispatch_labels(status, batch_id) where status = 'ready';
create index if not exists dispatch_labels_tracking_idx on dispatch_labels(tracking);
