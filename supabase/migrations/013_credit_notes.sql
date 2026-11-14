-- A credit note is money coming back: a refund, a damaged-goods credit, a
-- return. It lives alongside orders so a supplier's page shows both sides.
alter table purchase_orders add column if not exists kind text not null default 'order';
alter table purchase_orders add column if not exists credit_for uuid references purchase_orders(id) on delete set null;
alter table purchase_orders add column if not exists credit_reason text;
create index if not exists purchase_orders_kind_idx on purchase_orders(kind);

create or replace function public.next_credit_number() returns text
language plpgsql security definer set search_path = public as $$
declare d text := to_char(now() at time zone 'Europe/London', 'YYYYMMDD'); n int;
begin
  select count(*) + 1 into n from purchase_orders where po_number like 'CN-HI-' || d || '-%';
  loop
    exit when not exists (select 1 from purchase_orders where po_number = 'CN-HI-' || d || '-' || lpad(n::text, 3, '0'));
    n := n + 1;
  end loop;
  return 'CN-HI-' || d || '-' || lpad(n::text, 3, '0');
end $$;
grant execute on function public.next_credit_number() to authenticated;
