-- When an order will actually arrive. An estimate from the supplier's lead time
-- is only a guide (back orders can turn 3 days into 2 weeks), so a date only
-- counts as firm once someone confirms it with the supplier.
alter table purchase_orders add column if not exists delivery_date date;
alter table purchase_orders add column if not exists delivery_confirmed_at timestamptz;
alter table purchase_orders add column if not exists delivery_confirmed_by text;
alter table purchase_orders add column if not exists delivery_note text;
create index if not exists purchase_orders_delivery_idx on purchase_orders(delivery_date);

-- Not every line arrives with the order. A line can be on back order (with its
-- own date, or none yet) or cancelled by the supplier.
alter table purchase_order_items add column if not exists line_status text not null default 'due';
alter table purchase_order_items add column if not exists back_order_date date;
alter table purchase_order_items add column if not exists line_status_note text;
