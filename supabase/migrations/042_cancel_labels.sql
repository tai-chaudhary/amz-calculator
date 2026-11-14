-- Cancelling labels (v2.37.0)
--   • A label uploaded by mistake can be cancelled: one order, or every order in an upload.
--     It stays on record (who, when, why), stops holding stock, and can be uploaded again later.
--   • Only someone with Dispatch who is the office (sees costs) or is ticked "Cancel labels" in Team & Access can do it.
--   • An order with any label already dispatched is never cancelled: its stock has come off,
--     and cancelling it would leave inventory wrong.
-- Safe to re-run. Backwards-compatible with v2.36.0 (it only adds).

-- "Cancel labels" is a permission, not a page: it never lets anyone see costs
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
                        'link-codes', 'cancel-labels')))
  )
$function$;

alter table public.dispatch_labels add column if not exists cancelled_at timestamptz;
alter table public.dispatch_labels add column if not exists cancelled_by_name text;

create or replace function public.can_cancel_labels()
 returns boolean language sql stable security definer set search_path to 'public'
-- Needs the Dispatch page too: accounts see costs but have no business cancelling labels
as $$ select public.can_open('dispatch') and (public.sees_costs() or public.can_open('cancel-labels')) $$;
revoke all on function public.can_cancel_labels() from public, anon;
grant execute on function public.can_cancel_labels() to authenticated;

-- p_ids: any labels of the orders to cancel. Every label of each of those orders is cancelled
-- together (an order is never half cancelled). Orders with a dispatched label are skipped.
create or replace function public.dispatch_cancel_labels(p_ids uuid[], p_reason text, p_by text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare n_labels int := 0; n_orders int := 0; n_skipped int := 0;
begin
  if not public.can_cancel_labels() then raise exception 'You don''t have permission to cancel labels'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Say why it''s being cancelled'; end if;
  if coalesce(trim(p_by), '') = '' then raise exception 'Say who''s cancelling it'; end if;

  with picked as (
    select distinct upload_id, coalesce(order_key, id::text) as k
    from dispatch_labels where id = any(coalesce(p_ids, '{}'))
  ),
  orders as (
    select p.upload_id, p.k,
           bool_or(l.status = 'dispatched') as gone,
           bool_or(l.status not in ('dispatched', 'cancelled')) as open
    from picked p join dispatch_labels l on l.upload_id is not distinct from p.upload_id and coalesce(l.order_key, l.id::text) = p.k
    group by 1, 2
  ),
  done as (
    update dispatch_labels l
       set status = 'cancelled', hold_reason = trim(p_reason), cancelled_at = now(), cancelled_by_name = trim(p_by)
      from orders o
     where not o.gone and o.open
       and l.upload_id is not distinct from o.upload_id and coalesce(l.order_key, l.id::text) = o.k
       and l.status not in ('dispatched', 'cancelled')
    returning l.upload_id, coalesce(l.order_key, l.id::text) as k
  )
  select (select count(*) from done),
         (select count(distinct (upload_id, k)) from done),
         (select count(*) from orders where gone)
    into n_labels, n_orders, n_skipped;

  return jsonb_build_object('labels', n_labels, 'orders', n_orders, 'skipped', n_skipped);
end $function$;
revoke all on function public.dispatch_cancel_labels(uuid[], text, text) from public, anon;
grant execute on function public.dispatch_cancel_labels(uuid[], text, text) to authenticated;
