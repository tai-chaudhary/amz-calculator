-- 064: Print Station queue (Oct 2026). Phones always send to the station; if it's offline, prints wait and come out
-- when it's back. A batch sent to print stays "to print" until the station has printed it — then it's marked printed
-- by whoever sent it; cancelled or failed, it's simply still to print. If prints wait over 2 minutes with the station
-- offline, Warehouse Team gets a ClickUp nudge (at most every 15 minutes). Safe to re-run.

alter table print_jobs add column if not exists meta jsonb not null default '{}'::jsonb;   -- { batch_ids, person }
alter table print_stations add column if not exists nudged_at timestamptz;
alter table dispatch_batches add column if not exists print_job_id uuid;
alter table dispatch_batches add column if not exists print_sent_at timestamptz;
alter table dispatch_batches add column if not exists print_sent_by text;

-- The station printed it: the batches become printed, by the person who sent it, as printing on a laptop does
create or replace function public.print_job_done(p_job uuid)
returns void language plpgsql security definer set search_path = public as $$
declare j print_jobs; ids uuid[]; who text; t timestamptz := now();
begin
  if not public.is_active_user() then raise exception 'Not allowed'; end if;
  update print_jobs set status = 'printed', printed_at = t, error = null where id = p_job returning * into j;
  if j.id is null then return; end if;
  ids := array(select (x)::uuid from jsonb_array_elements_text(coalesce(j.meta->'batch_ids', '[]'::jsonb)) x);
  if coalesce(array_length(ids, 1), 0) = 0 then return; end if;
  who := coalesce(nullif(j.meta->>'person', ''), j.sent_by);
  update dispatch_batches set print_count = coalesce(print_count, 0) + 1,
         printed_at = coalesce(printed_at, t), printed_by_name = coalesce(printed_by_name, who),
         print_job_id = null, print_sent_at = null, print_sent_by = null
   where id = any(ids);
  update dispatch_labels set printed_at = t, printed_by_name = who where batch_id = any(ids) and printed_at is null;
  if nullif(j.meta->>'person', '') is not null then
    update dispatch_labels set packer = j.meta->>'person' where batch_id = any(ids) and packer is null;
    update dispatch_uploads set picker = j.meta->>'person'
     where id in (select upload_id from dispatch_batches where id = any(ids)) and picker is null;
  end if;
end $$;

-- Failed or cancelled: the batches are just to print again
create or replace function public.print_job_stop(p_job uuid, p_status text, p_error text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_active_user() then raise exception 'Not allowed'; end if;
  update print_jobs set status = case when p_status in ('failed', 'cancelled') then p_status else 'cancelled' end,
         error = nullif(p_error, '') where id = p_job and status in ('queued', 'printing');
  update dispatch_batches set print_job_id = null, print_sent_at = null, print_sent_by = null where print_job_id = p_job;
end $$;
revoke all on function public.print_job_done(uuid) from public, anon;
revoke all on function public.print_job_stop(uuid, text, text) from public, anon;
grant execute on function public.print_job_done(uuid) to authenticated;
grant execute on function public.print_job_stop(uuid, text, text) to authenticated;

create or replace function public.print_station_nudge() returns void
language plpgsql security definer set search_path = public as $$
declare st print_stations; waiting int; oldest timestamptz; titles jsonb;
begin
  select * into st from print_stations where id = 'warehouse';
  if st.id is not null and st.last_seen > now() - interval '30 seconds' then return; end if;
  select count(*), min(created_at), jsonb_agg(jsonb_build_object('title', title, 'by', sent_by) order by created_at)
    into waiting, oldest, titles from print_jobs where station = 'warehouse' and status = 'queued';
  if waiting = 0 or oldest > now() - interval '2 minutes' then return; end if;
  if st.nudged_at is not null and st.nudged_at > now() - interval '15 minutes' then return; end if;
  perform public.queue_event('print_station_offline', jsonb_build_object('waiting', waiting, 'since', oldest, 'jobs', titles));
  insert into print_stations (id, nudged_at) values ('warehouse', now()) on conflict (id) do update set nudged_at = now();
end $$;
revoke all on function public.print_station_nudge() from public, anon, authenticated;
insert into notification_rules (event, channel_name) values ('print_station_offline', 'Warehouse Team') on conflict (event) do nothing;
do $$ begin
  if not exists (select 1 from cron.job where jobname = 'print-station-nudge') then
    perform cron.schedule('print-station-nudge', '* * * * *', 'select public.print_station_nudge()');
  end if;
end $$;
