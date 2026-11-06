-- 055: Dispatch day tools (warehouse feedback, Oct 2026). Safe to re-run.
--  · pick list orders carry their batch, stamp and label numbers (substitutes by label number)
--  · a parcel can be kept back at Ready for dispatch, with why
--  · driver signatures per carrier at collection
--  · the day's summary kept when the day is closed
--  · 3:30pm ClickUp message: labels made in HELM but not uploaded to Dispatch

alter table dispatch_labels add column if not exists kept_back text;
alter table dispatch_labels add column if not exists kept_back_by text;
alter table dispatch_labels add column if not exists kept_back_at timestamptz;

create table if not exists dispatch_collections (
  id uuid primary key default gen_random_uuid(),
  ship_date date not null,
  carrier text not null,
  parcels int not null default 0,
  driver_name text,
  signature_path text,
  note text,
  by_name text,
  signed_at timestamptz not null default now()
);
alter table dispatch_collections enable row level security;
drop policy if exists "Collections read" on dispatch_collections;
create policy "Collections read" on dispatch_collections for select to authenticated using ((select can_open('dispatch')));
drop policy if exists "Collections add" on dispatch_collections;
create policy "Collections add" on dispatch_collections for insert to authenticated with check ((select can_open('dispatch')));

create table if not exists dispatch_days (
  ship_date date primary key,
  closed_at timestamptz, closed_by text,
  summary jsonb not null default '{}'::jsonb
);
alter table dispatch_days enable row level security;
drop policy if exists "Days read" on dispatch_days;
create policy "Days read" on dispatch_days for select to authenticated using ((select can_open('dispatch')));
drop policy if exists "Days add" on dispatch_days;
create policy "Days add" on dispatch_days for insert to authenticated with check ((select can_open('dispatch')));
drop policy if exists "Days change" on dispatch_days;
create policy "Days change" on dispatch_days for update to authenticated using ((select can_open('dispatch')));

insert into storage.buckets (id, name, public) values ('collection-signatures', 'collection-signatures', false) on conflict (id) do nothing;
drop policy if exists "Signatures read" on storage.objects;
create policy "Signatures read" on storage.objects for select to authenticated using (bucket_id = 'collection-signatures' and (select can_open('dispatch')));
drop policy if exists "Signatures add" on storage.objects;
create policy "Signatures add" on storage.objects for insert to authenticated with check (bucket_id = 'collection-signatures' and (select can_open('dispatch')));

-- Keep back one parcel (or a few) at Ready for dispatch: stays waiting, with the reason on its card
create or replace function public.dispatch_keep_back(p_ids uuid[], p_reason text, p_by text)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.can_open('dispatch') then raise exception 'Not allowed'; end if;
  update dispatch_labels set kept_back = nullif(trim(coalesce(p_reason, '')), ''), kept_back_by = p_by,
         kept_back_at = case when nullif(trim(coalesce(p_reason, '')), '') is null then null else now() end,
         packed_at = case when nullif(trim(coalesce(p_reason, '')), '') is null then packed_at else null end
  where id = any(p_ids) and status = 'ready';
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.dispatch_keep_back(uuid[], text, text) from public, anon;
grant execute on function public.dispatch_keep_back(uuid[], text, text) to authenticated;

-- The pick list's orders: which batch, what's stamped, and the label numbers
create or replace function public.dispatch_pick_list(p_batches uuid[], p_all boolean)
 returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare res jsonb;
begin
  if not (public.can_open('dispatch') or public.can_open('inventory')) then raise exception 'Not allowed'; end if;
  with lab as (
    select l.upload_id, coalesce(l.order_key, l.id::text) as order_key,
           (array_agg(l.items order by jsonb_array_length(l.items) desc))[1] as items,
           min(coalesce(nullif(l.channel_ref, ''), nullif(l.helm_order, ''), l.label_ref)) as ref,
           (array_agg(l.batch_id))[1] as batch_id,
           bool_and(l.status = 'dispatched') as gone,
           array_agg(l.seq order by l.seq) as seqs,
           min(b.code) as batch_code, min(b.label_name) as stamp, min(l.postcode) as postcode
    from dispatch_labels l join dispatch_batches b on b.id = l.batch_id
    where l.batch_id = any(p_batches)
      and (l.status = 'ready' or (p_all and l.status = 'dispatched'))
    group by 1, 2
  ),
  units as (
    select lab.upload_id, lab.order_key, lab.ref, lab.batch_id, lab.gone, lab.seqs, lab.batch_code, lab.stamp, lab.postcode,
           e.product_id, e.code, e.name, sum(e.units) as units
    from lab cross join lateral public.inv_expand(lab.items) e
    group by 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12
  ),
  per as (
    select u.product_id, min(u.code) as code, min(u.name) as helm_name, sum(u.units) as units,
           count(*) as orders,
           jsonb_agg(jsonb_build_object('upload_id', u.upload_id, 'order_key', u.order_key, 'ref', u.ref,
                                        'batch_id', u.batch_id, 'units', u.units, 'gone', u.gone,
                                        'seqs', to_jsonb(u.seqs), 'batch_code', u.batch_code, 'stamp', u.stamp,
                                        'postcode', left(coalesce(u.postcode, ''), 4))
                     order by u.batch_code, u.stamp, u.seqs[1]) as order_list
    from units u group by u.product_id, case when u.product_id is null then u.code end
  ),
  instead as (
    select distinct p.id as product_id, x.wanted_name
    from lab cross join jsonb_array_elements(coalesce(lab.items, '[]'::jsonb)) li
    join inv_channel_skus x on x.source = 'portal' and x.how = 'person' and x.kind = 'substitute'
                           and public.inv_norm(x.sku) = public.inv_norm(li ->> 'code')
    cross join jsonb_array_elements(x.items) xi
    join inv_products p on p.code_key = public.inv_norm(xi ->> 'code')
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'product_id', per.product_id,
      'code', coalesce(p.code, per.code),
      'name', coalesce(p.name, per.helm_name, per.code),
      'units', per.units,
      'orders', per.orders,
      'order_list', per.order_list,
      'instead', coalesce((select jsonb_agg(i.wanted_name) from instead i where i.product_id = per.product_id), '[]'::jsonb),
      'on_hand', coalesce((select sum(b.qty) from inv_balances b where b.product_id = per.product_id), 0),
      'locations', coalesce((select jsonb_agg(jsonb_build_object('code', b.location, 'qty', b.qty, 'pickable', l.pickable)
                                              order by l.pickable desc, b.qty asc, b.location)
                             from inv_balances b join inv_locations l on l.code = b.location
                             where b.product_id = per.product_id and b.qty > 0), '[]'::jsonb),
      'substitutes', coalesce((select jsonb_agg(jsonb_build_object('upload_id', d.upload_id, 'order_key', d.order_key,
                                  'sub_product_id', d.sub_product_id, 'sub_name', d.sub_name, 'units', d.units,
                                  'ordered_units', d.ordered_units, 'by', d.by_name))
                               from dispatch_substitutes d
                               where d.product_id = per.product_id
                                 and exists (select 1 from jsonb_array_elements(per.order_list) x
                                             where (x ->> 'upload_id')::uuid = d.upload_id and x ->> 'order_key' = d.order_key)), '[]'::jsonb)
    ) order by coalesce(p.name, per.helm_name, per.code)), '[]'::jsonb)
  into res
  from per left join inv_products p on p.id = per.product_id;
  return res;
end $function$;

-- Labels HELM has made that aren't in Dispatch yet (today's), for the 3:30pm message
create or replace function public.helm_labels_not_uploaded()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('order', coalesce(r.order_number, r.ref), 'ref', r.ref, 'carrier', r.carrier,
           'labelled_at', r.labelled_at, 'items', r.items) order by r.labelled_at), '[]'::jsonb)
  from public.helm_open_rows() r
  where r.phase = 'labelled' and (r.labelled_at at time zone 'Europe/London')::date = (now() at time zone 'Europe/London')::date
$$;
revoke all on function public.helm_labels_not_uploaded() from public, anon;
grant execute on function public.helm_labels_not_uploaded() to authenticated;

create or replace function public.notify_labels_not_uploaded() returns void
language plpgsql security definer set search_path = public as $$
declare list jsonb;
begin
  -- 3:30pm London, whatever the clocks: the job runs at 14:30 and 15:30 UTC and only one is 3:30pm here
  if extract(hour from (now() at time zone 'Europe/London')) <> 15 then return; end if;
  list := public.helm_labels_not_uploaded();
  if jsonb_array_length(list) = 0 then return; end if;
  perform public.queue_event('labels_not_uploaded', jsonb_build_object('date', (now() at time zone 'Europe/London')::date, 'orders', list));
end $$;
revoke all on function public.notify_labels_not_uploaded() from public, anon, authenticated;

insert into notification_rules (event, channel_name) values ('labels_not_uploaded', 'Warehouse Team') on conflict (event) do nothing;

do $$ begin
  if not exists (select 1 from cron.job where jobname = 'labels-not-uploaded') then
    perform cron.schedule('labels-not-uploaded', '30 14,15 * * 1-6', 'select public.notify_labels_not_uploaded()');
  end if;
end $$;

-- The portal can queue a day_closed with the summary as before
create or replace function public.queue_notification(p_event text, p_payload jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_active_user() then return; end if;
  if p_event not in ('batch_uploaded', 'day_closed') then return; end if;
  perform public.queue_event(p_event, p_payload || jsonb_build_object('by', coalesce(p_payload ->> 'by',
    (select display_name from profiles where id = auth.uid()))));
end $$;
