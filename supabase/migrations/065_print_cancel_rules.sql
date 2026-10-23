-- 065: Who can cancel a print, and a record of who did. Only the person who sent it, or an admin, can cancel —
-- and only while it's waiting (once printing, the label's already coming out). Cancelling records who and when
-- (print_jobs.cancelled_by / cancelled_at). Failed prints (from the station) are unchanged. Safe to re-run.
alter table print_jobs add column if not exists cancelled_by text;
alter table print_jobs add column if not exists cancelled_at timestamptz;
alter table dispatch_batches add column if not exists print_sent_by_id uuid;

create or replace function public.print_job_stop(p_job uuid, p_status text, p_error text default null)
returns void language plpgsql security definer set search_path = public as $$
declare j print_jobs; me_name text;
begin
  if not public.is_active_user() then raise exception 'Not allowed'; end if;
  select * into j from print_jobs where id = p_job;
  if j.id is null then raise exception 'That print isn''t there any more'; end if;
  if p_status = 'cancelled' then
    if j.status <> 'queued' then raise exception 'It''s already %', case j.status when 'printing' then 'printing — too late to cancel' else j.status end; end if;
    if not (j.sent_by_id = auth.uid() or public.is_admin()) then
      raise exception 'Only % or an admin can cancel this print', coalesce(j.sent_by, 'the person who sent it');
    end if;
  end if;
  select display_name into me_name from profiles where id = auth.uid();
  update print_jobs set status = case when p_status in ('failed', 'cancelled') then p_status else 'cancelled' end,
         error = nullif(p_error, ''),
         cancelled_by = case when p_status = 'cancelled' then me_name end,
         cancelled_at = case when p_status = 'cancelled' then now() end
   where id = p_job and status in ('queued', 'printing');
  update dispatch_batches set print_job_id = null, print_sent_at = null, print_sent_by = null where print_job_id = p_job;
end $$;
revoke all on function public.print_job_stop(uuid, text, text) from public, anon;
grant execute on function public.print_job_stop(uuid, text, text) to authenticated;
