-- Who picks, packs and dispatches each label. The warehouse shares one login,
-- so the person is asked when a batch is printed and recorded on its labels.
alter table dispatch_labels add column if not exists packer text;
create index if not exists dispatch_labels_packer_idx on dispatch_labels(packer);
