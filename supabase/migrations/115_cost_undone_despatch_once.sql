-- v2.90.0: a despatch that was undone and done again (a label taken back from dispatched, or a substitute recorded
-- afterwards) is charged ONCE. Before, both despatches were charged to the order and the undo came back as a new
-- layer of stock ("despatch undone") — three orders were charged double.
-- cost_rebuild now takes each order's despatch movements net of its undo movements (grouped by the order's key).
-- The function's text before this change is kept in public.fn_backups ("cost_rebuild before 115").
-- Applied 16 Nov 2026. Safe to re-run.
create table if not exists public.fn_backups (name text not null, saved_at timestamptz not null default now(), def text not null);
alter table public.fn_backups enable row level security;
revoke all on public.fn_backups from anon, authenticated;

do $do$
declare d text; n text;
  old1 text := $o$m.kind in ('add','despatch_undo','count','remove','damage')$o$;
  new1 text := $o$m.kind in ('add','count','remove','damage')$o$;
  new2 text := $o$-- despatches, net of any that were undone: an order's stock is charged once, however many times its label was taken back
  insert into _ev select ip.stock_item_id, max(m.at) filter (where m.kind = 'despatch'), 5, 'out', -sum(m.qty), null,
      case when coalesce((array_agg(m.note order by m.at desc) filter (where m.kind = 'despatch'))[1], '') ilike '%replacement%' then 'replacement' else 'sale' end, null,
      (array_agg(m.ref order by m.at desc) filter (where m.kind = 'despatch'))[1]
    from inv_movements m join inv_products ip on ip.id = m.product_id
    where ip.kind = 'product' and m.kind in ('despatch', 'despatch_undo')
    group by ip.stock_item_id, coalesce(m.order_key, m.id::text) having sum(m.qty) < 0;$o$;
begin
  select pg_get_functiondef('public.cost_rebuild()'::regprocedure) into d;
  if position('net of any that were undone' in d) > 0 then return; end if;
  insert into public.fn_backups (name, def) values ('cost_rebuild before 115', d);
  if position(old1 in d) = 0 then raise exception 'cost_rebuild: part 1 not found'; end if;
  n := replace(d, old1, new1);
  d := n;
  n := regexp_replace(d, $r$insert into _ev select ip\.stock_item_id, m\.at, 5, 'out', -m\.qty, null, case when coalesce\(m\.note,''\) ilike '%replacement%' then 'replacement' else 'sale' end, null, m\.ref\s+from inv_movements m join inv_products ip on ip\.id = m\.product_id where ip\.kind = 'product' and m\.kind = 'despatch' and m\.qty < 0;$r$, replace(new2, '\', '\\'));
  if n = d then raise exception 'cost_rebuild: part 2 not found'; end if;
  execute n;
end $do$;
