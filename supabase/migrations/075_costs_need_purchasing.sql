-- Only Purchasing sees costs (v2.67.0)
--   • Rule: anyone without Purchasing access (Purchase Orders, Pending Payments or Delivery Problems)
--     never sees a cost. Admins always do.
--   • Replaces the "everything except warehouse pages" list: new pages are cost-free unless they
--     need Purchasing, so a new page can never quietly reveal costs again.
--   • Claims gets what it needs without costs: each carrier's claim time limit and contact, and
--     listing sell prices (for the estimated claim value).
--   • Keep the list in step with PURCHASING in src/lib/access.js (npm test checks it).
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
      and (role = 'admin' or permissions ?| array['purchases', 'payments', 'issues'])
  )
$function$;

create or replace function public.claim_context()
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select case when not public.can_open('claims') then '{}'::jsonb else jsonb_build_object(
    'carriers', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'data',
        jsonb_build_object('claimDays', s.data -> 'claimDays', 'claimsContact', s.data -> 'claimsContact')))
      from suppliers s where coalesce(s.data ->> 'claimDays', '') <> '' or coalesce(s.data ->> 'claimsContact', '') <> ''), '[]'::jsonb),
    'listings', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'data',
        jsonb_build_object('sellPrice', p.data -> 'sellPrice')))
      from saved_products p where exists (select 1 from live_products l where l.saved_product_id = p.id)
        and coalesce(p.data ->> 'sellPrice', '') <> ''), '[]'::jsonb)
  ) end
$function$;
revoke all on function public.claim_context() from public, anon;
grant execute on function public.claim_context() to authenticated;
