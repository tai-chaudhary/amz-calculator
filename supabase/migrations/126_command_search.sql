-- 126 — ⌘K can find any order however old, item codes, returns, cases and finished tasks (v2.98.0)
--
-- APPLIED to the live database on 17 Nov 2026. Read-only: one new function and seven indexes. Nothing existing changed.
--
-- Why: ⌘K's index is built in the browser from what the portal has already loaded — the last 14 days of labels, open
-- tasks, and so on. An older order number found nothing; an order whose label was made outside the portal could not
-- be found at all; eBay item numbers and TikTok codes, returns, cases and finished tasks were not searchable.
-- Loading all of that into the browser would slow the portal down, so ⌘K asks for one thing at a time instead:
-- when what is typed looks like a number or a code (src/lib/search.js `looksLikeCode`), after a 300ms pause.
--
-- command_search(p_q) → { orders, returns, cases, codes, tasks }, each at most 6, already limited to the pages the
-- person may open (can_open). It matches the START of the text with everything but letters and digits removed
-- (inv_norm), needs at least 5 characters, and returns no customer details and no money.
--   orders   by channel order number, HELM number or tracking number — from Dispatch labels of any age, the sales
--            ledger (orders with no label here), HELM's orders and HELM's parcels. Each says: channel, labels and when
--            despatched, when sold, what, HELM's state, whether it is a pallet order, and its return / case / claim numbers.
--   returns  by RT number or tracking          cases  by CP number
--   codes    channel item codes (eBay item numbers, TikTok IDs and seller SKUs) with the products they send, where no
--            listing already carries the code (listings are searched in the browser)
--   tasks    tasks that are no longer open, by T number (open ones are searched in the browser)
--
-- Speed, as a signed-in admin on the live database (8,000 labels, 29,000 sale lines, 7,100 HELM orders, 8,300 parcels):
-- 8–25 ms a lookup. Without the indexes below it was 350–430 ms (inv_norm is a regular expression, run on every row).
-- The first step is run with the typed text written into the statement so each branch can use its index.

create index if not exists sales_lines_ref_norm_idx on public.sales_lines (public.inv_norm(order_ref) text_pattern_ops);
create index if not exists dispatch_labels_ref_prefix_idx on public.dispatch_labels (public.inv_norm(channel_ref) text_pattern_ops);
create index if not exists dispatch_labels_helm_prefix_idx on public.dispatch_labels (public.inv_norm(helm_order) text_pattern_ops);
create index if not exists dispatch_labels_tracking_prefix_idx on public.dispatch_labels (public.inv_norm(tracking) text_pattern_ops);
create index if not exists helm_orders_ref_prefix_idx on public.helm_orders (public.inv_norm(ref) text_pattern_ops);
create index if not exists helm_orders_number_prefix_idx on public.helm_orders (public.inv_norm(order_number) text_pattern_ops);
create index if not exists helm_parcels_tracking_prefix_idx on public.helm_parcels (public.inv_norm(tracking) text_pattern_ops);

create or replace function public.command_search(p_q text)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $fn$
declare
  k text := public.inv_norm(p_q);
  see_orders boolean; see_returns boolean; see_cases boolean; see_claims boolean; see_codes boolean; see_tasks boolean;
  ks_key text[]; ks_ref text[];
  orders jsonb := '[]'::jsonb; rets jsonb := '[]'::jsonb; cases jsonb := '[]'::jsonb; codes jsonb := '[]'::jsonb; tasks jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if length(k) < 5 then
    return jsonb_build_object('orders', orders, 'returns', rets, 'cases', cases, 'codes', codes, 'tasks', tasks);
  end if;
  see_orders := public.can_open('order-audit');
  see_returns := public.can_open('returns');
  see_cases := public.can_open('customer-care');
  see_claims := public.can_open('claims');
  see_codes := public.can_open('inventory');
  see_tasks := public.can_open('tasks');

  -- Orders: by channel order number, HELM number or tracking number, whatever their age and whether or not the portal
  -- holds a label for them. No customer details and no money.
  -- Step 1 finds the order numbers. It is run with the typed text written in, so each branch uses its index
  -- (k holds only A-Z and 0-9, and is quoted by format all the same).
  if see_orders then
    execute format($q$
      select array_agg(key order by exact desc, key), array_agg(ref order by exact desc, key) from (
        select key, min(ref) ref, (key = %2$L) exact from (
          select public.inv_norm(l.channel_ref) key, l.channel_ref ref from dispatch_labels l where public.inv_norm(l.channel_ref) like %1$L
          union all select public.inv_norm(l.channel_ref), l.channel_ref from dispatch_labels l where public.inv_norm(l.helm_order) like %1$L
          union all select public.inv_norm(l.channel_ref), l.channel_ref from dispatch_labels l where public.inv_norm(l.tracking) like %1$L
          union all select public.inv_norm(s.order_ref), s.order_ref from sales_lines s where public.inv_norm(s.order_ref) like %1$L
          union all select public.inv_norm(h.ref), h.ref from helm_orders h where public.inv_norm(h.ref) like %1$L
          union all select public.inv_norm(h.ref), h.ref from helm_orders h where public.inv_norm(h.order_number) like %1$L
          union all select public.inv_norm(p.order_ref), p.order_ref from helm_parcels p where public.inv_norm(p.tracking) like %1$L
        ) hits where coalesce(key, '') <> '' group by key order by (key = %2$L) desc, key limit 6
      ) top $q$, k || '%', k) into ks_key, ks_ref;

    select coalesce(jsonb_agg(q.o order by q.exact desc, q.at desc nulls last), '[]'::jsonb) into orders from (
      select (ks.key = k) exact, coalesce(lb.last_at, sl.d::timestamptz, ho.order_date) at,
        jsonb_build_object(
          'ref', ks.ref,
          'channel', coalesce(sl.channel, ho.channel),
          'labels', coalesce(lb.n, 0), 'cancelled', coalesce(lb.cancelled, 0),
          'label_at', lb.last_at, 'dispatched_at', lb.dispatched_at,
          'what', coalesce(lb.what, sl.what),
          'sold', sl.d, 'units', sl.units,
          'helm', ho.order_number, 'helm_open', (ho.id is not null and ho.closed_at is null), 'helm_closed', ho.closed_reason,
          'pallet', exists (select 1 from bulk_orders b where public.inv_norm(b.channel_ref) = ks.key and b.status <> 'cancelled'),
          'returns', case when see_returns or see_cases then (select coalesce(jsonb_agg(r.ref order by r.created_at), '[]'::jsonb) from returns r where public.inv_norm(r.order_ref) = ks.key) else '[]'::jsonb end,
          'cases', case when see_cases then (select coalesce(jsonb_agg(c.ref order by c.created_at), '[]'::jsonb) from complaints c where public.inv_norm(c.order_ref) = ks.key) else '[]'::jsonb end,
          'claims', case when see_claims then (select coalesce(jsonb_agg(c.ref order by c.created_at), '[]'::jsonb) from claims c where public.inv_norm(c.order_ref) = ks.key) else '[]'::jsonb end
        ) o
      from unnest(coalesce(ks_key, '{}'::text[]), coalesce(ks_ref, '{}'::text[])) ks(key, ref)
      left join lateral (
        select count(*) filter (where l.status <> 'cancelled') n, count(*) filter (where l.status = 'cancelled') cancelled,
               max(l.created_at) last_at, max(l.dispatched_at) dispatched_at,
               (array_agg(l.label_name order by l.created_at desc) filter (where l.label_name is not null))[1] what
        from dispatch_labels l where public.inv_norm(l.channel_ref) = ks.key) lb on true
      left join lateral (
        select max(s.channel) channel, min(s.sale_date) d, sum(s.qty) units,
               (array_agg(s.description order by s.id) filter (where s.description is not null))[1] what
        from sales_lines s where public.inv_norm(s.order_ref) = ks.key and s.kind = 'sale') sl on true
      left join lateral (
        select h.id, h.order_number, h.channel, h.closed_at, h.closed_reason, h.order_date
        from helm_orders h where public.inv_norm(h.ref) = ks.key order by h.last_seen desc limit 1) ho on true
    ) q;
  end if;

  if see_returns then
    select coalesce(jsonb_agg(jsonb_build_object('ref', r.ref, 'order_ref', r.order_ref, 'status', r.status, 'at', coalesce(r.received_at, r.created_at)) order by r.created_at desc), '[]'::jsonb) into rets
    from (select * from returns r where public.inv_norm(r.ref) like k || '%' or public.inv_norm(r.tracking) like k || '%' or public.inv_norm(r.return_tracking) like k || '%' limit 6) r;
  end if;

  if see_cases then
    select coalesce(jsonb_agg(jsonb_build_object('ref', c.ref, 'order_ref', c.order_ref, 'status', c.status, 'kind', c.kind, 'product', c.product_name, 'at', c.created_at) order by c.created_at desc), '[]'::jsonb) into cases
    from (select * from complaints c where public.inv_norm(c.ref) like k || '%' limit 6) c;
  end if;

  -- Channel item codes (eBay item numbers, TikTok product IDs and seller SKUs) linked to products, where no listing
  -- already carries that code (listings are searched in the browser)
  if see_codes then
    select coalesce(jsonb_agg(jsonb_build_object('sku', c.sku, 'title', c.title, 'items',
        (select coalesce(jsonb_agg(jsonb_build_object('qty', (it->>'qty')::numeric, 'code', it->>'code', 'name', p.name, 'product_id', p.id)), '[]'::jsonb)
         from jsonb_array_elements(case when jsonb_typeof(c.items) = 'array' then c.items else '[]'::jsonb end) it
         left join inv_products p on p.code = it->>'code')) order by c.sku), '[]'::jsonb) into codes
    from (select * from inv_channel_skus c where public.inv_norm(c.sku) like k || '%'
            and not exists (select 1 from saved_products sp where upper(trim(sp.data->>'listingSku')) = upper(trim(c.sku)))
          order by c.sku limit 6) c;
  end if;

  -- Tasks that are no longer open (open ones are searched in the browser)
  if see_tasks then
    select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'ref', t.ref, 'kind', t.kind, 'status', t.status, 'product', p.name, 'from', t.from_location, 'to', t.to_location,
        'qty', t.qty, 'done_at', t.done_at, 'done_by', t.done_by) order by t.created_at desc), '[]'::jsonb) into tasks
    from (select * from inv_tasks t where t.status <> 'open' and public.inv_norm(t.ref) like k || '%' limit 6) t
    left join inv_products p on p.id = t.product_id;
  end if;

  return jsonb_build_object('orders', orders, 'returns', rets, 'cases', cases, 'codes', codes, 'tasks', tasks);
end $fn$;

revoke all on function public.command_search(text) from public, anon;
grant execute on function public.command_search(text) to authenticated;
