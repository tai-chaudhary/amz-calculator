-- 063: Print Station (Oct 2026). Phones send prints to the warehouse Mac, which prints them on the Zebra.
-- A print job is the PDF (in the private print-jobs bucket) plus a row here; the station page on the Mac
-- claims queued jobs, prints them and marks them printed. The station says it's alive every few seconds, so
-- phones know whether to send or print themselves. Safe to re-run.

create table if not exists print_stations (
  id text primary key,                         -- 'warehouse'
  name text not null default 'Print Station',
  last_seen timestamptz, signed_in_as text, printer_note text
);
alter table print_stations enable row level security;
drop policy if exists "Stations read" on print_stations;
create policy "Stations read" on print_stations for select to authenticated using ((select public.is_active_user()));
drop policy if exists "Stations write" on print_stations;
create policy "Stations write" on print_stations for all to authenticated using ((select public.is_active_user())) with check ((select public.is_active_user()));

create table if not exists print_jobs (
  id uuid primary key default gen_random_uuid(),
  station text not null default 'warehouse',
  title text not null default 'Print',
  kind text,                                   -- batch | reprint | collection | pick_list | shelf_labels | other
  file_path text not null,
  pages int,
  status text not null default 'queued',       -- queued | printing | printed | failed | cancelled
  sent_by text, sent_by_id uuid default auth.uid(),
  created_at timestamptz not null default now(),
  claimed_at timestamptz, printed_at timestamptz, error text
);
create index if not exists print_jobs_queue_idx on print_jobs (station, status, created_at);
alter table print_jobs enable row level security;
drop policy if exists "Print jobs" on print_jobs;
create policy "Print jobs" on print_jobs for all to authenticated using ((select public.is_active_user())) with check ((select public.is_active_user()));

-- The station takes the oldest waiting job; only one station gets each job
create or replace function public.print_claim(p_station text)
returns setof print_jobs language sql security invoker set search_path = public as $$
  update print_jobs set status = 'printing', claimed_at = now()
  where id = (select id from print_jobs where station = p_station and status = 'queued' order by created_at for update skip locked limit 1)
  returning *
$$;
grant execute on function public.print_claim(text) to authenticated;

insert into storage.buckets (id, name, public) values ('print-jobs', 'print-jobs', false) on conflict (id) do nothing;
drop policy if exists "Print files read" on storage.objects;
create policy "Print files read" on storage.objects for select to authenticated using (bucket_id = 'print-jobs' and (select public.is_active_user()));
drop policy if exists "Print files add" on storage.objects;
create policy "Print files add" on storage.objects for insert to authenticated with check (bucket_id = 'print-jobs' and (select public.is_active_user()));

do $$ begin
  if not exists (select 1 from cron.job where jobname = 'print-jobs-trim') then
    perform cron.schedule('print-jobs-trim', '41 3 * * *', $c$delete from print_jobs where created_at < now() - interval '7 days'$c$);
  end if;
end $$;
