-- 131: one listing can be sold under more than one code (eBay and TikTok), and the sales view is closed to
--      anyone who is not signed in.
--
-- Why: the same eBay or TikTok listing reaches the portal under several codes. eBay's report uses the item number or
-- the custom label; HELM uses the custom label, or only its own product code; TikTok's report uses its product ID
-- while HELM uses the seller SKU. The owner's decision (17 Nov 2026): one listing holding all its codes.
--
--   saved_products.data.otherCodes   the listing's other codes (an array of text). listingSku stays the main one.
--   listing_codes                    every code of every eBay / TikTok / website listing, kept in step by a trigger.
--   sales_ledger                     a sale line with no listing by its Listing SKU is looked up in listing_codes by
--                                    its Listing SKU, or by its item code when it has no Listing SKU. Amazon lines
--                                    are never looked up this way, so nothing changes for Amazon.
--   sales_refresh_helm, report_pl_open   find the listing the same way (for the price share and the fee).
--   report_channel_listing_proposals     lists only codes that still have no listing.
--
-- Security: sales_ledger was readable through the API without signing in (a view runs as its owner unless told
-- otherwise, so the row rules on sales_lines did not apply). It now runs as the person asking, and the anonymous
-- role has no rights on it. Every function that reads it is a definer function, so nothing signed-in changes.

create table if not exists public.listing_codes (
  channel text not null,
  code_key text not null,
  listing_id uuid not null references public.saved_products(id) on delete cascade,
  primary key (channel, code_key)
);
create index if not exists listing_codes_listing_idx on public.listing_codes (listing_id);
alter table public.listing_codes enable row level security;
drop policy if exists "Read listing codes" on public.listing_codes;
create policy "Read listing codes" on public.listing_codes for select to authenticated using (public.is_active_user());
revoke all on public.listing_codes from anon;
revoke insert, update, delete, truncate, references, trigger on public.listing_codes from authenticated;

create or replace function public.listing_codes_sync() returns trigger
language plpgsql security definer set search_path to 'public' as $fn$
begin
  if tg_op in ('UPDATE', 'DELETE') then delete from listing_codes where listing_id = old.id; end if;
  if tg_op in ('INSERT', 'UPDATE') and coalesce(new.data->>'channel', 'Amazon') <> 'Amazon'
     and coalesce(new.data->>'archived', '') <> 'true' then
    insert into listing_codes (channel, code_key, listing_id)
    select new.data->>'channel', y.k, new.id from (
      select distinct upper(trim(x.c)) k from (
        select new.data->>'listingSku' c
        union all
        select jsonb_array_elements_text(case when jsonb_typeof(new.data->'otherCodes') = 'array' then new.data->'otherCodes' else '[]'::jsonb end)
      ) x where coalesce(trim(x.c), '') <> ''
    ) y
    on conflict (channel, code_key) do nothing;
  end if;
  return null;
end $fn$;
revoke all on function public.listing_codes_sync() from public, anon, authenticated;

drop trigger if exists listing_codes_sync on public.saved_products;
create trigger listing_codes_sync after insert or update of data or delete on public.saved_products
  for each row execute function public.listing_codes_sync();

create or replace view public.sales_ledger as
 WITH amz_orders AS (
         SELECT DISTINCT sales_lines.channel,
            sales_lines.order_ref
           FROM sales_lines
          WHERE sales_lines.source <> 'helm'::text AND sales_lines.kind = 'sale'::text AND sales_lines.order_ref IS NOT NULL
        )
 SELECT sl.id,
    sl.source,
    sl.source_key,
    sl.kind,
    sl.channel,
    sl.order_ref,
    sl.sale_date,
    sl.posted_at,
    sl.listing_sku,
    sl.item_code,
    sl.description,
    sl.qty,
    sl.fulfilment,
    sl.product_sales,
    sl.product_tax,
    sl.shipping,
    sl.shipping_tax,
    sl.giftwrap,
    sl.giftwrap_tax,
    sl.promo,
    sl.promo_tax,
    sl.selling_fees,
    sl.fba_fees,
    sl.other_fees,
    sl.other,
    sl.total,
    sl.fee_estimated,
    sl.imported_at,
    sl.imported_by,
    sl.product_sales + sl.product_tax + sl.shipping + sl.shipping_tax + sl.giftwrap + sl.giftwrap_tax + sl.promo + sl.promo_tax AS gross,
        CASE
            WHEN sl.product_tax = 0::numeric AND sl.shipping_tax = 0::numeric AND (sl.kind = ANY (ARRAY['sale'::text, 'refund'::text])) THEN round((sl.product_sales + sl.shipping + sl.giftwrap + sl.promo) / 6::numeric, 4)
            ELSE sl.product_tax + sl.shipping_tax + sl.giftwrap_tax + sl.promo_tax
        END AS vat,
        CASE
            WHEN sl.source = ANY (ARRAY['amazon_report'::text, 'ebay_report'::text]) THEN round((sl.selling_fees + sl.fba_fees + sl.other_fees) / 1.2, 4)
            WHEN sl.source = 'tiktok_report'::text THEN sl.selling_fees + sl.other_fees
            ELSE sl.selling_fees
        END AS fees,
    COALESCE(lp.id, lp2.id) AS listing_id,
    COALESCE(lp.name, lp2.name) AS listing_name,
    COALESCE(lp.data, lp2.data) ->> 'asin'::text AS asin
   FROM sales_lines sl
     LEFT JOIN LATERAL ( SELECT sp.id,
            sp.name,
            sp.data
           FROM saved_products sp
          WHERE sl.listing_sku IS NOT NULL AND COALESCE(sp.data ->> 'channel'::text, 'Amazon'::text) = sl.channel AND upper(TRIM(BOTH FROM sp.data ->> 'listingSku'::text)) = upper(TRIM(BOTH FROM sl.listing_sku))
          ORDER BY (COALESCE(sp.data ->> 'archived'::text, ''::text) = 'true'::text)
         LIMIT 1) lp ON true
     LEFT JOIN listing_codes lc ON lp.id IS NULL AND sl.channel <> 'Amazon'::text AND lc.channel = sl.channel
          AND lc.code_key = upper(TRIM(BOTH FROM COALESCE(sl.listing_sku, sl.item_code)))
     LEFT JOIN saved_products lp2 ON lp2.id = lc.listing_id
  WHERE sl.source <> 'helm'::text OR NOT (EXISTS ( SELECT 1
           FROM amz_orders a
          WHERE a.channel = sl.channel AND a.order_ref = sl.order_ref));

alter view public.sales_ledger set (security_invoker = true);
revoke all on public.sales_ledger from anon;
revoke insert, update, delete, truncate, references, trigger on public.sales_ledger from authenticated;

do $$
declare d text; n text; fn text;
  a constant text := $a$(ll.v->>'listing_sku') is not null and upper(trim(sp.data->>'listingSku')) = upper(trim(ll.v->>'listing_sku'))$a$;
  b constant text := $b$(((ll.v->>'listing_sku') is not null and upper(trim(sp.data->>'listingSku')) = upper(trim(ll.v->>'listing_sku')))
          or (o.channel <> 'Amazon' and sp.id = (select lc.listing_id from listing_codes lc where lc.channel = o.channel
                and lc.code_key = upper(trim(coalesce(ll.v->>'listing_sku', ll.v->>'code'))))))$b$;
begin
  foreach fn in array array['public.sales_refresh_helm(date)', 'public.report_pl_open(text)'] loop
    select pg_get_functiondef(fn::regprocedure) into d;
    insert into public.fn_backups(name, def) values (fn || ' before 131', d);
    n := replace(d, a, b);
    if n = d then raise exception '%: the listing lookup was not found', fn; end if;
    execute n;
  end loop;

  select pg_get_functiondef('public.report_channel_listing_proposals()'::regprocedure) into d;
  insert into public.fn_backups(name, def) values ('report_channel_listing_proposals before 131', d);
  n := replace(d, $a$channel in ('eBay', 'TikTok') and item_code is not null group by 1, 2$a$,
                  $b$channel in ('eBay', 'TikTok') and item_code is not null and listing_id is null group by 1, 2$b$);
  if n = d then raise exception 'report_channel_listing_proposals: the sales part was not found'; end if;
  execute n;
end $$;
