-- 109 — Finance pages (v2.84.0): the figures the new Profit & Loss screen needs by day, and a log of report uploads.
-- Safe to re-run. Nothing existing is changed: two new functions for reading, one table and two functions for the log.
-- Finance is for admins only (the owner, 15 Nov 2026), so everything here checks is_admin().

-- 1. What the P&L holds outside any one order, BY DAY, so a day, a week or a month can be added up and compared with
--    the one before from a single load:
--      charges       a channel's other charges and credits (kind = 'charge' in the sales ledger), by day and channel
--      replacements  stock sent again (the costing), by day — the whole business, so only under All channels
--      losses        stock losses and damages, from 1 Dec 2026 (the owner's rule), by day — All channels only
--      outside       what is shown under the P&L but is not in it, by day — All channels only
--    report_pl_lines gives the same three as one total for its dates; these add up to those totals.
create or replace function public.report_pl_days(p_from date, p_to date, p_channel text default null)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare res jsonb;
begin
  if not public.is_admin() then raise exception 'Not allowed'; end if;
  if p_from is null or p_to is null or p_to < p_from then raise exception 'Choose the dates'; end if;
  select jsonb_build_object(
    'charges', coalesce((select jsonb_agg(jsonb_build_object('d', d, 'channel', channel, 'amount', amount)) from (
        select sale_date d, channel, round(sum(coalesce(total, 0)), 4) amount from sales_ledger
        where sale_date between p_from and p_to and kind = 'charge' and (p_channel is null or channel = p_channel)
        group by 1, 2 having sum(coalesce(total, 0)) <> 0) c), '[]'::jsonb),
    'replacements', case when p_channel is null then coalesce((select jsonb_agg(jsonb_build_object('d', d, 'cost', cost, 'units', units, 'orders', orders)) from (
        select (used_at at time zone 'Europe/London')::date d, round(sum(cost), 4) cost, sum(units) units, count(distinct order_ref) orders
        from cost_uses where kind = 'replacement' and (used_at at time zone 'Europe/London')::date between p_from and p_to group by 1) r), '[]'::jsonb) else '[]'::jsonb end,
    'losses', case when p_channel is null then coalesce((select jsonb_agg(jsonb_build_object('d', d, 'cost', cost)) from (
        select (used_at at time zone 'Europe/London')::date d, round(sum(cost), 4) cost
        from cost_uses where kind in ('damage', 'removed', 'stock loss')
          and (used_at at time zone 'Europe/London')::date between greatest(p_from, date '2026-12-01') and p_to group by 1) l), '[]'::jsonb) else '[]'::jsonb end,
    -- Shown under the P&L but not part of it (the owner's rules): stock returned to a supplier (its credit note covers
    -- it), start-up differences, and stock removed or damaged before 1 Dec
    'outside', case when p_channel is null then coalesce((select jsonb_agg(jsonb_build_object('d', d, 'returned', returned, 'startup', startup, 'losses_before', losses_before)) from (
        select (used_at at time zone 'Europe/London')::date d,
          round(coalesce(sum(cost) filter (where kind = 'returned to supplier'), 0), 4) returned,
          round(coalesce(sum(cost) filter (where kind = 'start-up difference'), 0), 4) startup,
          round(coalesce(sum(cost) filter (where kind in ('damage', 'removed', 'stock loss') and (used_at at time zone 'Europe/London')::date < date '2026-12-01'), 0), 4) losses_before
        from cost_uses where kind in ('returned to supplier', 'start-up difference', 'damage', 'removed', 'stock loss')
          and (used_at at time zone 'Europe/London')::date between p_from and p_to group by 1) o
        where returned <> 0 or startup <> 0 or losses_before <> 0), '[]'::jsonb) else '[]'::jsonb end
  ) into res;
  return res;
end $$;
revoke all on function public.report_pl_days(date, date, text) from public, anon;
grant execute on function public.report_pl_days(date, date, text) to authenticated;

-- 2. The log of report uploads: one row each time an admin imports a file on Finance → Uploads.
create table if not exists public.report_uploads (
  id bigint generated always as identity primary key,
  source text not null,                 -- amazon_report | ebay_report | tiktok_report
  file_name text,                       -- null for uploads made before the log began
  date_from date,
  date_to date,
  lines integer not null default 0,     -- lines in the file
  new_lines integer not null default 0, -- lines that were not already in
  uploaded_by text,
  uploaded_by_id uuid,
  uploaded_at timestamptz not null default now()
);
alter table public.report_uploads enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'report_uploads' and policyname = 'Admins read report uploads') then
    create policy "Admins read report uploads" on public.report_uploads for select to authenticated using ((select public.is_admin()));
  end if;
end $$;
-- no insert / update / delete policy: rows are only written by report_upload_log()

create or replace function public.report_upload_log(p_source text, p_file text, p_from date, p_to date, p_lines integer, p_new integer, p_by text default null)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.is_admin() then raise exception 'Only an admin can import sales'; end if;
  if p_source not in ('amazon_report', 'ebay_report', 'tiktok_report') then raise exception 'Unknown report type %', p_source; end if;
  insert into report_uploads (source, file_name, date_from, date_to, lines, new_lines, uploaded_by, uploaded_by_id)
  values (p_source, nullif(left(coalesce(p_file, ''), 200), ''), p_from, p_to, greatest(coalesce(p_lines, 0), 0), greatest(coalesce(p_new, 0), 0), nullif(p_by, ''), auth.uid());
end $$;
revoke all on function public.report_upload_log(text, text, date, date, integer, integer, text) from public, anon;
grant execute on function public.report_upload_log(text, text, date, date, integer, integer, text) to authenticated;

-- The Uploads page: the log, newest first, and how far each channel's report reaches (its latest order date).
create or replace function public.report_uploads_list()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not public.is_admin() then raise exception 'Not allowed'; end if;
  return jsonb_build_object(
    'uploads', coalesce((select jsonb_agg(to_jsonb(u) - 'uploaded_by_id' order by u.uploaded_at desc) from (select * from report_uploads order by uploaded_at desc limit 200) u), '[]'::jsonb),
    'covered', coalesce((select jsonb_agg(jsonb_build_object('source', source, 'channel', channel, 'to', d2, 'from', d1, 'lines', n)) from (
        select source, channel, min(sale_date) d1, max(sale_date) d2, count(*) n from sales_lines
        where source <> 'helm' and kind in ('sale', 'refund') group by 1, 2) c), '[]'::jsonb),
    'today', public.uk_today());
end $$;
revoke all on function public.report_uploads_list() from public, anon;
grant execute on function public.report_uploads_list() to authenticated;

-- The uploads made before the log began (four, 11 and 14 Nov 2026), read back from the lines they brought in.
insert into public.report_uploads (source, file_name, date_from, date_to, lines, new_lines, uploaded_by, uploaded_at)
select source, null, min(sale_date), max(sale_date), count(*), count(*), imported_by, min(imported_at)
from sales_lines where source <> 'helm' and not exists (select 1 from public.report_uploads)
group by source, imported_by, date_trunc('hour', imported_at);
