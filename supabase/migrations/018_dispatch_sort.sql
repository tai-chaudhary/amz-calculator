-- The order products print in within a batch: Evri first, then DHL, and the
-- same product side by side in pack size order (2 x, 3 x, 4 x) so the packer
-- works through like with like.
alter table dispatch_batches add column if not exists sort_key text;
