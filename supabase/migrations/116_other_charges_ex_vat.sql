-- v2.90.0: "other charges and credits" ex VAT, like every other cost in the portal.
--   eBay            every charge in its report includes VAT (Promoted Listings, shop subscription) -> / 1.2
--   Amazon          "Service Fee" lines (the monthly subscription, £25 + VAT) -> / 1.2
--                   Ship+ cashback ("Incentive disbursement") is ex VAT as received (owner, 16 Nov 2026); SAFE-T
--                   reimbursements are compensation; delivery labels and return postage are left as charged until
--                   their VAT is confirmed from an Amazon invoice.
-- report_pl_days and report_pl_lines now add up public.ledger_charge_net(channel, description, total).
-- Applied 16 Nov 2026. Safe to re-run.
create or replace function public.ledger_charge_net(p_channel text, p_description text, p_total numeric)
 returns numeric language sql immutable set search_path to 'public' as $f$
  select case
    when p_total is null then 0
    when p_channel = 'eBay' then round(p_total / 1.2, 4)
    when p_channel = 'Amazon' and coalesce(p_description, '') ilike 'Service Fee%' then round(p_total / 1.2, 4)
    else p_total end
$f$;

do $do$
declare d text; n text;
begin
  select pg_get_functiondef('public.report_pl_days(date,date,text)'::regprocedure) into d;
  if position('ledger_charge_net' in d) = 0 then
    n := replace(d, 'round(sum(coalesce(total, 0)), 4) amount', 'round(sum(public.ledger_charge_net(channel, description, total)), 4) amount');
    if n = d then raise exception 'report_pl_days: the charges part was not found'; end if;
    execute n;
  end if;
  select pg_get_functiondef('public.report_pl_lines(date,date,text)'::regprocedure) into d;
  if position('ledger_charge_net' in d) = 0 then
    n := replace(d, 'select coalesce(sum(total), 0) amazon_charges from sales_ledger', 'select coalesce(sum(public.ledger_charge_net(channel, description, total)), 0) amazon_charges from sales_ledger');
    if n = d then raise exception 'report_pl_lines: the charges part was not found'; end if;
    execute n;
  end if;
  if public.ledger_charge_net('eBay', 'Other fee: Promoted Listings - General fee', -1.20) <> -1 then raise exception 'check 1'; end if;
  if public.ledger_charge_net('Amazon', 'Service Fee: Subscription', -30) <> -25 then raise exception 'check 2'; end if;
  if public.ledger_charge_net('Amazon', 'Delivery Services: Incentive disbursement', 0.4) <> 0.4 then raise exception 'check 3'; end if;
end $do$;
