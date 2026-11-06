-- 062: HELM's open orders in ~30ms instead of ~9s. The check "is this order already uploaded to Dispatch?" was
-- re-run against every label for every HELM order, closed ones included, so the New orders card timed out
-- ("canceling statement due to statement timeout") and ⌘K's index, refreshed every couple of minutes per open tab,
-- was the database's biggest load. Now: the uploaded references are worked out once, only open orders are checked.
create index if not exists dispatch_labels_ref_norm_idx on dispatch_labels (public.inv_norm(channel_ref)) where status <> 'cancelled';
create index if not exists dispatch_labels_helm_norm_idx on dispatch_labels (public.inv_norm(helm_order)) where status <> 'cancelled';

create or replace function public.helm_open_rows()
 returns table(id bigint, order_number text, ref text, channel text, carrier text, service text, phase text, items jsonb, units jsonb, order_date timestamptz, labelled_at timestamptz, first_seen timestamptz, ship_day date)
 language sql stable security definer set search_path to 'public' as $function$
  with uploaded as materialized (
    select distinct public.inv_norm(l.channel_ref) as ukey from dispatch_labels l where l.status <> 'cancelled' and coalesce(l.channel_ref, '') <> ''
    union
    select public.inv_norm(l.helm_order) from dispatch_labels l where l.status <> 'cancelled' and coalesce(l.helm_order, '') <> ''
  ),
  open_h as materialized (
    select h.* from helm_orders h
    where h.closed_at is null and h.status not in (1, 9)
      and (h.status <> 8 or coalesce(h.labelled_at, h.last_seen) > now() - interval '14 days')
  ),
  done as materialized (
    select distinct o.id from open_h o cross join lateral unnest(o.keys) hk(hkey) join uploaded u on u.ukey = hk.hkey
  )
  select h.id, h.order_number, h.ref, h.channel, h.carrier, h.service, public.helm_phase(h::helm_orders),
         h.items, h.units, h.order_date, h.labelled_at, h.first_seen,
         public.helm_ship_day(h.order_date, h.channel, h.ship_by)
  from open_h h
  where not exists (select 1 from done d where d.id = h.id)
$function$;
