-- Where each label's packing slip is in the uploaded file, so the two can be
-- shown side by side when someone needs to check them by eye.
alter table dispatch_labels add column if not exists slip_page int;
