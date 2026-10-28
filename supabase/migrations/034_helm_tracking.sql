-- Tracking numbers from HELM, to check (and put right) what was read off the labels.
--
-- helm-sync stores each labelled order's tracking numbers in helm_orders.tracking.
-- dispatch_apply_helm_tracking() then goes through recent labels:
--   · the label's own reading is one of HELM's numbers  → verified
--   · one label on the order, and HELM has one number   → HELM's number is used; what was read
--                                                          is kept in tracking_read for the record
--   · anything less certain (several parcels, several numbers that don't match) is left alone
-- Safe to re-run.

alter table public.helm_orders add column if not exists tracking text[];
alter table public.helm_sync add column if not exists tracking_info jsonb;

alter table public.dispatch_labels add column if not exists tracking_read text;     -- what the label said, when HELM's differed
alter table public.dispatch_labels add column if not exists tracking_source text;   -- helm_verified, helm_corrected, helm_filled, reread

create or replace function public.dispatch_apply_helm_tracking(p_days integer default 30)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v int := 0; c int := 0; f int := 0;
begin
  drop table if exists _m;
  create temp table _m on commit drop as
  with h as (
    select id, keys, tracking from helm_orders where tracking is not null and cardinality(tracking) > 0
  ), l as (
    select dl.id, nullif(dl.tracking, '') as tracking, dl.upload_id, coalesce(dl.order_key, dl.id::text) as okey,
           upper(regexp_replace(coalesce(dl.helm_order, ''), '[^A-Za-z0-9]', '', 'g')) as hk,
           upper(regexp_replace(coalesce(dl.channel_ref, ''), '[^A-Za-z0-9]', '', 'g')) as ck
    from dispatch_labels dl
    where dl.created_at > now() - make_interval(days => p_days) and dl.status <> 'cancelled'
      and coalesce(dl.tracking_source, '') not like 'helm%'
  )
  select l.id, l.tracking, h.tracking as ht,
         count(*) over (partition by l.upload_id, l.okey) as n_labels
  from l join lateral (
    select h.* from h where (l.hk <> '' and l.hk = any(h.keys)) or (length(l.ck) >= 5 and l.ck = any(h.keys)) limit 1
  ) h on true;

  update dispatch_labels d set tracking_source = 'helm_verified'
  from _m where d.id = _m.id and _m.tracking is not null
    and upper(regexp_replace(_m.tracking, '[^A-Za-z0-9]', '', 'g')) in
        (select upper(regexp_replace(t, '[^A-Za-z0-9]', '', 'g')) from unnest(_m.ht) t);
  get diagnostics v = row_count;

  update dispatch_labels d set tracking_read = _m.tracking, tracking = _m.ht[1], tracking_source = 'helm_corrected'
  from _m where d.id = _m.id and _m.tracking is not null and _m.n_labels = 1 and cardinality(_m.ht) = 1
    and coalesce(d.tracking_source, '') not like 'helm%';
  get diagnostics c = row_count;

  update dispatch_labels d set tracking = _m.ht[1], tracking_source = 'helm_filled'
  from _m where d.id = _m.id and _m.tracking is null and _m.n_labels = 1 and cardinality(_m.ht) = 1
    and coalesce(d.tracking_source, '') not like 'helm%';
  get diagnostics f = row_count;

  return jsonb_build_object('verified', v, 'corrected', c, 'filled', f);
end $function$;
revoke all on function public.dispatch_apply_helm_tracking(integer) from public, anon, authenticated;
