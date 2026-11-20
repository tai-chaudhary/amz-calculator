-- v2.90.0: the P&L counts only parcels that really became a label. HELM keeps a row for every label attempt; the
-- failed ones (no tracking number) were being costed as parcels (two orders of one 25kg bag showed £7.59 instead of
-- £4.59). A label voided in HELM (shipment status 4) counts only if the carrier moved it.
-- Applied 16 Nov 2026. Safe to re-run (does nothing once the filter is there).
do $do$
declare d text; n text;
begin
  select pg_get_functiondef('public.report_pl_lines(date,date,text)'::regprocedure) into d;
  if position('p.tracking' in d) > 0 then return; end if;
  n := regexp_replace(d, 'join helm_parcels p on p\.order_id = h\.id(\s+)group by o\.order_ref',
    E'join helm_parcels p on p.order_id = h.id\\1where coalesce(p.tracking, \'\') <> \'\' and (p.shipment_status is distinct from 4 or p.collected_at is not null or p.delivered_at is not null)\\1group by o.order_ref');
  if n = d then raise exception 'report_pl_lines: the parcels part was not found'; end if;
  execute n;
end $do$;
