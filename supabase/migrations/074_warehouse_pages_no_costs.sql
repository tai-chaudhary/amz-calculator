-- Warehouse pages never reveal costs (v2.66.1)
--   • Print Station, Returns and Order Audit were added after the warehouse list was last set, so ticking
--     them made someone a cost viewer — purchase orders, unit costs and margins included. They're warehouse
--     pages: none of them needs a cost to work.
--   • Keep this list in step with WAREHOUSE_ONLY in src/lib/access.js (npm test checks it).
-- Safe to re-run.
create or replace function public.sees_costs()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select exists (
    select 1 from profiles
    where id = auth.uid() and active
      and (role = 'admin' or exists (
        select 1 from jsonb_array_elements_text(permissions) p
        where p not in ('dispatch', 'dispatch-dashboard', 'requests', 'goods-in', 'inventory', 'tasks', 'tracking',
                        'print-station', 'returns', 'order-audit',
                        'link-codes', 'cancel-labels')))
  )
$function$;
