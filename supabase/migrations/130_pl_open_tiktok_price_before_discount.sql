-- 130: orders not yet sent (P&L "open orders") follow the same rule as 129 for TikTok: price before discount.
do $$
declare d text; n text;
begin
  select pg_get_functiondef('public.report_pl_open(text)'::regprocedure) into d;
  insert into public.fn_backups(name, def) values ('report_pl_open before 130', d);
  n := replace(d,
    $a$coalesce((w.money->>'total')::numeric, 0) tot,$a$,
    $b$coalesce((w.money->>'total')::numeric, 0)
        + case when w.channel = 'TikTok' then coalesce((w.money->>'discount')::numeric, 0) else 0 end tot,$b$);
  if n = d then raise exception 'report_pl_open: the order total part was not found'; end if;
  execute n;
end $$;
