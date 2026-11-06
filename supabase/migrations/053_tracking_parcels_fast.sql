-- 053: Delivery tracking loads in one request.
-- The page used to fetch every parcel with its full scan history in pages of
-- 1,000 (a count first, then the rest). This returns the whole range at once,
-- without the scan history: only the statuses each parcel has been through,
-- which is all the page's figures need. The history itself is fetched when a
-- parcel is opened. Security invoker, so the page's own read policy
-- (can_open('tracking')) still decides who sees parcels. Safe to re-run.

create or replace function public.tracking_parcels(p_from timestamptz default null)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(jsonb_agg(to_jsonb(r) order by r.shipped_at desc), '[]'::jsonb)
  from (
    select p.id, p.shipment_id, p.order_id, p.order_ref, p.channel, p.items, p.carrier, p.service,
           p.shipment_status, p.parcel_no, p.parcels, p.tracking, p.tracking_url, p.status,
           p.shipped_at, p.expected_at, p.collected_at, p.delivered_at, p.problem_at, p.returned_at,
           p.last_event_at, p.last_event,
           (select coalesce(array_agg(distinct (e->>'s')::int), '{}')
              from jsonb_array_elements(case when jsonb_typeof(p.events) = 'array' then p.events else '[]'::jsonb end) e
              where (e->>'s') ~ '^\d+$') as event_codes
    from helm_parcels p
    where p_from is null or p.shipped_at >= p_from
  ) r
$$;

revoke all on function public.tracking_parcels(timestamptz) from public, anon;
grant execute on function public.tracking_parcels(timestamptz) to authenticated;
