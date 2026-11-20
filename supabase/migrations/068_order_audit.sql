-- 068: Order audit (Oct 2026): find any order by its reference, HELM order number, tracking number, the customer's
-- name or postcode (what's on the label — the portal keeps no other customer details), our label number, or the day
-- it was uploaded / sent; then everything that happened to it, in order. Page order-audit. Safe to re-run.

create or replace function public.order_audit_search(p_q text default null, p_from date default null, p_to date default null)
returns jsonb language sql stable security definer set search_path = public as $$
  with q as (select upper(regexp_replace(coalesce(p_q, ''), '[^A-Za-z0-9]', '', 'g')) as k, lower(trim(coalesce(p_q, ''))) as t),
  hits as (
    select l.upload_id, coalesce(l.order_key, l.id::text) as order_key, max(l.created_at) as at
    from dispatch_labels l join dispatch_batches b on b.id = l.batch_id
    where public.can_open('order-audit')
      and (p_from is null or b.ship_date >= p_from) and (p_to is null or b.ship_date <= p_to)
      and ((select k from q) = '' or
           public.inv_norm(l.channel_ref) like '%' || (select k from q) || '%' or public.inv_norm(l.helm_order) like '%' || (select k from q) || '%'
        or upper(coalesce(l.tracking, '')) like '%' || (select k from q) || '%' or public.inv_norm(l.label_ref) = (select k from q)
        or (length((select t from q)) >= 3 and lower(coalesce(l.customer, '')) like '%' || (select t from q) || '%')
        or replace(lower(coalesce(l.postcode, '')), ' ', '') like replace((select t from q), ' ', '') || '%'
        or (b.code || public.inv_norm(l.seq::text)) = (select k from q))
    group by 1, 2 order by max(l.created_at) desc limit 60
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'upload_id', h.upload_id, 'order_key', h.order_key,
    'order_ref', (select coalesce(nullif(l.channel_ref, ''), l.helm_order) from dispatch_labels l where l.upload_id = h.upload_id and coalesce(l.order_key, l.id::text) = h.order_key limit 1),
    'customer', (select l.customer from dispatch_labels l where l.upload_id = h.upload_id and coalesce(l.order_key, l.id::text) = h.order_key and l.customer is not null limit 1),
    'postcode', (select l.postcode from dispatch_labels l where l.upload_id = h.upload_id and coalesce(l.order_key, l.id::text) = h.order_key and l.postcode is not null limit 1),
    'stamp', (select b.label_name from dispatch_labels l join dispatch_batches b on b.id = l.batch_id where l.upload_id = h.upload_id and coalesce(l.order_key, l.id::text) = h.order_key limit 1),
    'code', (select b.code || ' #' || l.seq from dispatch_labels l join dispatch_batches b on b.id = l.batch_id where l.upload_id = h.upload_id and coalesce(l.order_key, l.id::text) = h.order_key order by l.seq limit 1),
    'ship_date', (select b.ship_date from dispatch_labels l join dispatch_batches b on b.id = l.batch_id where l.upload_id = h.upload_id and coalesce(l.order_key, l.id::text) = h.order_key limit 1),
    'status', (select string_agg(distinct l.status, ', ') from dispatch_labels l where l.upload_id = h.upload_id and coalesce(l.order_key, l.id::text) = h.order_key),
    'at', h.at) order by h.at desc), '[]'::jsonb)
  from hits h
$$;
revoke all on function public.order_audit_search(text, date, date) from public, anon;
grant execute on function public.order_audit_search(text, date, date) to authenticated;

create or replace function public.order_audit(p_upload uuid, p_order_key text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare labels jsonb; refs text[]; tracks text[]; up jsonb; res jsonb;
begin
  if not public.can_open('order-audit') then raise exception 'Not allowed'; end if;
  select coalesce(jsonb_agg(to_jsonb(l) || jsonb_build_object('batch', jsonb_build_object('code', b.code, 'label_name', b.label_name, 'carrier', b.carrier,
           'service', b.service, 'ship_date', b.ship_date, 'printed_at', b.printed_at, 'printed_by_name', b.printed_by_name, 'print_count', b.print_count)) order by l.seq), '[]'::jsonb),
         array_agg(distinct coalesce(nullif(l.channel_ref, ''), l.helm_order)) filter (where coalesce(l.channel_ref, l.helm_order) is not null),
         array_agg(distinct l.tracking) filter (where l.tracking is not null)
    into labels, refs, tracks
  from dispatch_labels l join dispatch_batches b on b.id = l.batch_id
  where l.upload_id = p_upload and coalesce(l.order_key, l.id::text) = p_order_key;
  select to_jsonb(u) into up from dispatch_uploads u where u.id = p_upload;
  res := jsonb_build_object(
    'labels', labels, 'upload', up,
    'helm', (select coalesce(jsonb_agg(jsonb_build_object('order_number', h.order_number, 'ref', h.ref, 'channel', h.channel, 'carrier', h.carrier, 'service', h.service,
               'status', h.status, 'order_date', h.order_date, 'labelled_at', h.labelled_at, 'first_seen', h.first_seen, 'closed_at', h.closed_at, 'order_total', h.order_total, 'items', h.items)), '[]'::jsonb)
             from helm_orders h where exists (select 1 from unnest(h.keys) k where k = any(select public.inv_norm(r) from unnest(coalesce(refs, '{}')) r))),
    'parcels', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'order_id', p.order_id, 'channel', p.channel, 'tracking', p.tracking, 'tracking_url', p.tracking_url, 'carrier', p.carrier, 'service', p.service, 'status', p.status,
               'shipped_at', p.shipped_at, 'expected_at', p.expected_at, 'collected_at', p.collected_at, 'delivered_at', p.delivered_at, 'returned_at', p.returned_at,
               'last_event', p.last_event, 'last_event_at', p.last_event_at, 'events', p.events)), '[]'::jsonb)
             from helm_parcels p where p.tracking = any(coalesce(tracks, '{}')) or p.order_ref = any(coalesce(refs, '{}'))),
    'substitutes', (select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) from dispatch_substitutes s where s.upload_id = p_upload and s.order_key = p_order_key),
    'claims', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'ref', c.ref, 'status', c.status, 'reason', c.reason, 'value', c.value, 'outcome_amount', c.outcome_amount, 'created_at', c.created_at)), '[]'::jsonb)
               from claims c where c.tracking = any(coalesce(tracks, '{}')) or c.order_ref = any(coalesce(refs, '{}'))),
    'cases', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'ref', c.ref, 'status', c.status, 'kind', c.kind, 'created_at', c.created_at, 'created_by', c.created_by)), '[]'::jsonb)
              from complaints c where c.order_ref = any(coalesce(refs, '{}')) or c.tracking = any(coalesce(tracks, '{}'))),
    'refunds', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'ref', r.ref, 'status', r.status, 'kind', r.kind, 'amount', r.amount, 'paid_amount', r.paid_amount, 'paid_at', r.paid_at, 'requested_at', r.requested_at, 'requested_by', r.requested_by)), '[]'::jsonb)
                from refunds r where r.order_ref = any(coalesce(refs, '{}'))),
    'returns', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'ref', r.ref, 'status', r.status, 'reason', r.reason, 'condition', r.condition, 'received_at', r.received_at, 'received_by', r.received_by, 'created_at', r.created_at)), '[]'::jsonb)
                from returns r where r.order_ref = any(coalesce(refs, '{}')) or r.tracking = any(coalesce(tracks, '{}'))),
    'prints', (select coalesce(jsonb_agg(jsonb_build_object('title', j.title, 'status', j.status, 'sent_by', j.sent_by, 'created_at', j.created_at, 'printed_at', j.printed_at)), '[]'::jsonb)
               from print_jobs j where exists (select 1 from jsonb_array_elements_text(coalesce(j.meta->'batch_ids', '[]')) x
                                               where x::uuid in (select (l->>'batch_id')::uuid from jsonb_array_elements(labels) l)))
  );
  return res;
end $$;
revoke all on function public.order_audit(uuid, text) from public, anon;
grant execute on function public.order_audit(uuid, text) to authenticated;
