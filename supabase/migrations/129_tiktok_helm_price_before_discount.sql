-- 129: TikTok orders still on HELM's figures are counted at the price before discount.
-- The owner runs no promotions of his own on TikTok (18 Nov 2026), so every discount HELM shows on a TikTok order
-- is funded by TikTok and is paid back in the settlement. HELM's order total is what the customer paid, so the
-- discount is added back. Only HELM-estimated TikTok lines change; the Income report still replaces them.
do $$
declare d text; n text;
begin
  select pg_get_functiondef('public.sales_refresh_helm(date)'::regprocedure) into d;
  insert into public.fn_backups(name, def) values ('sales_refresh_helm before 129', d);
  n := replace(d,
    $a$coalesce((w.money->>'total')::numeric, 0) tot,$a$,
    $b$coalesce((w.money->>'total')::numeric, 0)
        + case when w.channel = 'TikTok' then coalesce((w.money->>'discount')::numeric, 0) else 0 end tot,$b$);
  if n = d then raise exception 'sales_refresh_helm: the order total part was not found'; end if;
  execute n;
end $$;

-- Lines already made (the 15-minute job only looks back 4 days): add each line's share of the order's discount.
update public.sales_lines sl
set product_sales = round(sl.product_sales + x.disc * x.share, 4),
    total = round(sl.total + x.disc * x.share, 4)
from (
  select s.id, coalesce((h.money->>'discount')::numeric, 0) disc,
         s.total / nullif((h.money->>'total')::numeric, 0) share
  from public.sales_lines s
  join public.helm_orders h on h.id = split_part(s.source_key, ':', 2)::bigint
  where s.source = 'helm' and s.channel = 'TikTok' and s.kind = 'sale'
) x
where x.id = sl.id and x.disc > 0 and x.share is not null;
