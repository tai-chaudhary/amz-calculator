-- v2.91.0: a sale HELM reports before the channel's report arrives is estimated at the listing's fee category rate
-- (migration 117's listing_fee_pct), like open orders. Before, it read the plain percentage stored on the listing.
-- Applied 16 Nov 2026. Safe to re-run.
do $do$
declare d text; n text;
begin
  select pg_get_functiondef('public.sales_refresh_helm(date)'::regprocedure) into d;
  if position('listing_fee_pct' in d) > 0 then return; end if;
  n := replace(d, $o$nullif(s.data->>'refFee','')::numeric fee_pct$o$, $o$public.listing_fee_pct(s.data) fee_pct$o$);
  if n = d then raise exception 'sales_refresh_helm: the fee part was not found'; end if;
  execute n;
end $do$;
