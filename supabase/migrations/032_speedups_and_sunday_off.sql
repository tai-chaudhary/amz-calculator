-- Small database speed-ups, and no shelf counts planned on Sundays.
-- Nothing here changes what anyone can see or do. Safe to re-run.
-- Applied 17 Oct as 032a (indexes) and 032c (counts). A rewrite of the
-- profiles "Change your own name" policy was left out: profiles is read on
-- every request, so the change couldn't get its lock.

-- ── Indexes behind foreign keys (Supabase performance advisor) ─────────────
create index if not exists dispatch_labels_upload_idx    on public.dispatch_labels(upload_id);
create index if not exists inv_aliases_product_idx       on public.inv_aliases(product_id);
create index if not exists inv_movements_location_idx    on public.inv_movements(location);
create index if not exists inv_products_stock_item_idx   on public.inv_products(stock_item_id);
create index if not exists live_products_saved_idx       on public.live_products(saved_product_id);
create index if not exists price_list_imports_supplier_idx on public.price_list_imports(supplier_id);
create index if not exists purchase_issues_po_item_idx   on public.purchase_issues(po_item_id);
create index if not exists purchase_orders_credit_for_idx on public.purchase_orders(credit_for);
create index if not exists stock_requests_po_item_idx    on public.stock_requests(po_item_id);
create index if not exists sync_runs_supplier_idx        on public.sync_runs(supplier_id);

-- ── Shelf counts: Monday to Saturday only (Sunday the warehouse is closed) ──
-- On a Sunday nothing is planned and the day isn't marked as planned, so
-- Monday morning plans as normal.
create or replace function public.inv_plan_counts()
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare today date := (now() at time zone 'Europe/London')::date; m inv_meta%rowtype; want int;
begin
  if extract(isodow from today) = 7 then return; end if;
  select * into m from inv_meta where id = 1 for update;
  if m.started_at is null or m.counts_planned = today then return; end if;
  update inv_meta set counts_planned = today where id = 1;
  want := greatest(0, m.count_per_day - (select count(*) from inv_tasks where kind = 'count' and status = 'open'));
  if want = 0 then return; end if;
  insert into inv_tasks (kind, from_location, why)
  select 'count', s.location,
         case when s.trouble then 'Something didn’t add up here lately'
              when s.last_counted is null then 'Not counted since the opening count'
              else 'Last counted ' || (today - s.last_counted) || ' days ago' end
  from (
    select b.location,
      (select max((m2.at at time zone 'Europe/London')::date) from inv_movements m2
         where m2.location = b.location and m2.kind = 'count') as last_counted,
      (select max((m2.at at time zone 'Europe/London')::date) from inv_movements m2
         where m2.location = b.location and m2.kind in ('count', 'opening')) as last_seen,
      bool_or(b.qty < 0) or exists (select 1 from inv_movements m3 where m3.location = b.location
         and m3.at > now() - interval '14 days' and (m3.kind in ('add', 'remove') or m3.note like '%not enough on the shelf%')) as trouble,
      sum(coalesce(r.daily, 0)) as speed, sum(b.qty) as stock
    from inv_balances b
    left join inv_rates r on r.product_id = b.product_id
    where b.location <> ''
    group by b.location
  ) s
  where (s.trouble or (s.stock > 0 and coalesce(s.last_counted, today - 365) <= today - 14 and s.last_seen is distinct from today))
    and not exists (select 1 from inv_tasks t where t.kind = 'count' and t.status = 'open' and t.from_location = s.location)
  order by (case when s.trouble then 40 else 0 end)
           + least(today - coalesce(s.last_counted, s.last_seen, today - 60), 60)
           + least(s.speed, 50) / 2 desc, s.location
  limit want;
end $function$;
revoke all on function public.inv_plan_counts() from public, anon, authenticated;
