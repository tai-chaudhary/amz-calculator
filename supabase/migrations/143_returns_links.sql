-- 143 (v2.111.0, 19-11-2026): Returns rebuilt, part 3 — linked into the rest of the portal.
--
--   command_search   ⌘K finds a return by its RMA, and Amazon return requests by RMA or return-label tracking
--   order_audit      the order's Amazon return request(s) on its timeline (asked for, delivered back, SAFE-T)
--   returns_product  a product's returns over N days for its page: units sold, units asked back, rate, reasons,
--                    what state they came back in (no money)
-- All additive / guarded patches; safe to re-run.

set lock_timeout = '10s';

do $$
declare src text := pg_get_functiondef('public.command_search(text)'::regprocedure);
begin
  if position('amazon_returns' in src) = 0 then
    src := replace(src,
      $a$or public.inv_norm(r.return_tracking) like k || '%' limit 6) r;$a$,
      $b$or public.inv_norm(r.return_tracking) like k || '%' or public.inv_norm(r.rma) like k || '%' limit 6) r;
    -- v2.111.0: Amazon's return requests not logged yet, by RMA or the return label's tracking (opened on the Returns page)
    rets := rets || coalesce((select jsonb_agg(jsonb_build_object('ref', a.rma, 'order_ref', a.order_ref, 'status', 'amazon return request', 'at', a.request_date))
      from (select * from amazon_returns a where a.return_id is null and (public.inv_norm(a.rma) like k || '%' or public.inv_norm(a.tracking) like k || '%') limit 4) a), '[]'::jsonb);$b$);
    if position('amazon_returns' in src) = 0 then raise exception 'command_search did not patch cleanly — nothing changed'; end if;
    execute src;
  end if;
end $$;

do $$
declare src text := pg_get_functiondef('public.order_audit(uuid, text)'::regprocedure);
begin
  if position('amazon_returns' in src) = 0 then
    src := replace(src, $a$    'prints', (select$a$,
      $b$    'amazon_returns', (select coalesce(jsonb_agg(jsonb_build_object('rma', a.rma, 'qty', a.qty, 'item_name', a.item_name, 'sku', a.sku, 'reason_code', a.reason_code,
        'label_type', a.label_type, 'tracking', a.tracking, 'request_date', a.request_date, 'delivered_at', a.delivered_at, 'refund_amount', a.refund_amount,
        'safet_claim_id', a.safet_claim_id, 'safet_state', a.safet_state, 'safet_amount', a.safet_amount, 'safet_created_at', a.safet_created_at, 'return_id', a.return_id)), '[]'::jsonb)
        from amazon_returns a where a.order_ref = any(coalesce(refs, '{}'))),
    'prints', (select$b$);
    if position('amazon_returns' in src) = 0 then raise exception 'order_audit did not patch cleanly — nothing changed'; end if;
    execute src;
  end if;
end $$;

create or replace function public.returns_product(p_product uuid, p_days integer default 90) returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare since date := current_date - greatest(coalesce(p_days, 90), 1); sid uuid;
begin
  if not public.is_active_user() then raise exception 'Not allowed'; end if;
  select stock_item_id into sid from inv_products where id = p_product;
  return jsonb_build_object(
    'days', p_days,
    'sold', coalesce((select sum(s.qty * coalesce(nullif(c->>'qty', '')::numeric, 1)) from sales_ledger s join saved_products sp on sp.id = s.listing_id,
        jsonb_array_elements(coalesce(sp.data->'components', '[]'::jsonb)) c where s.kind = 'sale' and s.qty > 0 and s.sale_date >= since and nullif(c->>'stockItemId', '')::uuid = sid), 0),
    'asked', coalesce((select sum((i->>'qty')::numeric) from amazon_returns a, jsonb_array_elements(a.items) i
        where a.request_date >= since and nullif(i->>'product_id', '')::uuid = p_product), 0),
    'requests', (select count(*) from amazon_returns a where a.request_date >= since and exists (select 1 from jsonb_array_elements(a.items) i where nullif(i->>'product_id', '')::uuid = p_product)),
    'reasons', coalesce((select jsonb_object_agg(reason, n) from (select a.reason, count(*) n from amazon_returns a
        where a.request_date >= since and exists (select 1 from jsonb_array_elements(a.items) i where nullif(i->>'product_id', '')::uuid = p_product) group by 1) x), '{}'::jsonb),
    'outcomes', coalesce((select jsonb_object_agg(o, n) from (select coalesce(i->>'outcome', 'not sorted') o, sum((i->>'qty')::numeric) n from returns r, jsonb_array_elements(r.items) i
        where r.status <> 'expected' and r.received_at >= since and nullif(i->>'product_id', '')::uuid = p_product group by 1) x), '{}'::jsonb),
    'other_returns', (select count(*) from returns r where r.status <> 'expected' and r.rma is null and r.received_at >= since
        and exists (select 1 from jsonb_array_elements(r.items) i where nullif(i->>'product_id', '')::uuid = p_product)));
end $$;
revoke all on function public.returns_product(uuid, integer) from public, anon;
grant execute on function public.returns_product(uuid, integer) to authenticated;
