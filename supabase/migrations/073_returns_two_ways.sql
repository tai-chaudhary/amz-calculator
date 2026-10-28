-- 073: Returns, two ways (Oct 2026).
--  · The office expects a return (order known) — it waits on the warehouse's Expected list.
--  · The warehouse logs whatever turns up: the tracking on the box, what's inside, each product's condition and what
--    happened to it (back in stock on a shelf, or disposed). The portal tries to match it to an order; if it can't, it
--    waits for the office in "To match" (needs_match), and a daily summary goes to the Warehouse Team channel.
-- Safe to re-run.

alter table returns add column if not exists needs_match boolean not null default false;
alter table returns add column if not exists matched_at timestamptz;
alter table returns add column if not exists matched_by text;
create index if not exists returns_needs_match_idx on returns (needs_match) where needs_match;

-- Sagar's return, logged before this: the office finds the order
update returns set needs_match = true where status <> 'expected' and order_ref is null and not needs_match;

create or replace function public.returns_daily_summary() returns void
language plpgsql security definer set search_path = public as $$
declare n int; rows jsonb;
begin
  select count(*), jsonb_agg(jsonb_build_object('ref', ref, 'tracking', return_tracking, 'items', items, 'at', coalesce(received_at, created_at)) order by created_at)
    into n, rows from returns where needs_match;
  if n = 0 then return; end if;
  perform public.queue_event('returns_to_match', jsonb_build_object('count', n, 'returns', rows));
end $$;
revoke all on function public.returns_daily_summary() from public, anon, authenticated;
insert into notification_rules (event, channel_name) values ('returns_to_match', 'Warehouse Team') on conflict (event) do nothing;
do $$ begin
  -- 16:45 London (15:45 or 16:45 UTC — runs at both, posts once: the function only runs at London 16:xx)
  if not exists (select 1 from cron.job where jobname = 'returns-to-match') then
    perform cron.schedule('returns-to-match', '45 15,16 * * 1-6',
      $c$select public.returns_daily_summary() where extract(hour from now() at time zone 'Europe/London') = 16$c$);
  end if;
end $$;
