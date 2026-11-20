-- 057: inv_planning reads the daily sales once (120 days) instead of twice (21 days + a year), and returns
-- straight away for anyone not signed in. It was running alongside inv_overview and pushing it past the
-- statement timeout, so Inventory failed to load on phones. Safe to re-run.
create or replace function public.inv_planning()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare res jsonb; today date := (now() at time zone 'Europe/London')::date;
begin
  if not public.is_active_user() then return '[]'::jsonb; end if;
  with sales as (select * from public.inv_daily_units(today - 120, today)),
  recent as (
    select product_id, jsonb_agg(jsonb_build_object('d', day, 'u', units) order by day) as days
    from sales where day >= today - 21 group by 1
  ),
  lastsale as (select product_id, max(day) as last_day from sales where units > 0 group by 1),
  layers as (
    select m.product_id, jsonb_agg(jsonb_build_object('at', m.at, 'qty', m.qty, 'kind', m.kind) order by m.at desc) as ins
    from (select product_id, at, qty, kind, row_number() over (partition by product_id order by at desc) rn
          from inv_movements where kind in ('goods_in', 'add', 'opening') and qty > 0) m
    where m.rn <= 25 group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'recent', coalesce(r.days, '[]'::jsonb), 'last_sale', ls.last_day, 'ins', coalesce(l.ins, '[]'::jsonb))), '[]'::jsonb)
  into res
  from inv_products p left join recent r on r.product_id = p.id left join lastsale ls on ls.product_id = p.id
  left join layers l on l.product_id = p.id where p.active;
  return res;
end $$;
revoke all on function public.inv_planning() from public, anon;
grant execute on function public.inv_planning() to authenticated;
