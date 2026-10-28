-- Not every payment buys stock: carriers, marketing, professional services
alter table purchase_orders add column if not exists category text not null default 'stock';
create index if not exists purchase_orders_category_idx on purchase_orders(category);
-- Finding an order by the supplier's invoice number
create index if not exists purchase_orders_invoice_idx on purchase_orders(lower(invoice_number));
