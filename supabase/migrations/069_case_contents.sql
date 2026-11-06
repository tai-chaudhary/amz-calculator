-- 069: Cases, refunds and returns can name the exact product affected inside an order — even when it was ordered as a
-- set (e.g. "Pyrex 2 Piece Jug Set" = a 250ml jug + a 500ml jug). Finding an order now also gives what was actually
-- in it (inv_expand: sets and packs opened into their products), and each record keeps what was ordered as well as
-- what was affected. Safe to re-run.

-- What was in an order's parcel: its slip lines opened into our products, totalled
create or replace function public.order_contents(p_items jsonb)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('product_id', product_id, 'code', code, 'name', name, 'qty', units) order by name), '[]'::jsonb)
  from (select e.product_id, min(e.code) code, min(e.name) name, sum(e.units) units from public.inv_expand(p_items) e group by e.product_id, case when e.product_id is null then e.code end) x
$$;
grant execute on function public.order_contents(jsonb) to authenticated;

alter table complaints add column if not exists ordered jsonb not null default '[]'::jsonb;
alter table refunds add column if not exists ordered jsonb not null default '[]'::jsonb;
alter table returns add column if not exists ordered jsonb not null default '[]'::jsonb;

do $$ declare d text;
begin
  d := pg_get_functiondef('public.care_find_order(text)'::regprocedure);
  if position('order_contents' in d) = 0 then
    d := replace(d, '''items'', l.items,', '''items'', l.items, ''contents'', public.order_contents(l.items),');
    execute d;
  end if;
  d := pg_get_functiondef('public.order_audit(uuid,text)'::regprocedure);
  if position('order_contents' in d) = 0 then
    d := replace(d, '''labels'', labels, ''upload'', up,', '''labels'', labels, ''upload'', up, ''contents'', public.order_contents((labels->0)->''items''),');
    execute d;
  end if;
end $$;
