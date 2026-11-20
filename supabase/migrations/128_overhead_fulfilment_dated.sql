-- 128 — the fulfilment share of an overhead is dated, like its amounts (v2.101.0)
--
-- APPLIED to the live database on 17 Nov 2026. No figure changed on the day: the shares set in 127 became shares from
-- each overhead's own start date, so every period reads exactly as it did (October 2026 fulfilment £12,734.64 of
-- £20,204.37; 1 Aug – 16 Nov £39,675.62 of £65,221.92 — the same before and after).
--
-- Why — the owner, 17 Nov: "The share should definitely be dated… wherever the costs are involved they should be
-- dated." A change of share must apply from a date and leave earlier periods as they were, exactly as a change of
-- amount does. THE RULE FOR EVERYTHING THAT FOLLOWS: anything that changes a cost carries the date it applies from.
--
--   overhead_fulfilment            one row per dated share: overhead_id, from_date, share (0–100); removed ones are
--                                  kept (removed_at / removed_by), never deleted
--   overhead_fulfilment_on(id, day)   the share in force on a day: the latest dated on or before it; none = 0
--   overhead_set_fulfilment(id, share, from)   from defaults to today; a date before the overhead started becomes its
--                                  start date; the same share as already in force = unchanged; going back to what it
--                                  was the day before needs no row of its own. Logged in the overhead's history.
--   overhead_remove_fulfilment(row id)         takes out a dated share entered by mistake. Logged.
--   overheads_for_pl               each day's cost × the share in force that day (fulfilment, _by_category, _by_day)
--   overheads_list                 each item: fulfilment_share (today's), period_fulfilment (the month's, by days),
--                                  fulfilment_shares (the dated ones, newest first)
--   overheads.fulfilment_share     the undated column of 127 is dropped: there is one source of truth
-- The functions' text before this is in public.fn_backups ("… before 128 (dated fulfilment)").
-- Tried on the live database in a transaction that was rolled back: set from a date, the same again, a later date,
-- back to what it was, a date before the start, remove, a share over 100 refused.

create table if not exists public.overhead_fulfilment (
  id uuid primary key default gen_random_uuid(),
  overhead_id uuid not null references public.overheads(id),
  from_date date not null,
  share numeric(5,2) not null check (share >= 0 and share <= 100),
  removed_at timestamptz, removed_by text,
  created_at timestamptz not null default now(), created_by text
);
create index if not exists overhead_fulfilment_live_idx on public.overhead_fulfilment (overhead_id, from_date desc) where removed_at is null;
alter table public.overhead_fulfilment enable row level security;
drop policy if exists "Overheads page reads" on public.overhead_fulfilment;
create policy "Overheads page reads" on public.overhead_fulfilment for select using (public.can_open('overheads'));
revoke all on public.overhead_fulfilment from anon, authenticated;
grant select on public.overhead_fulfilment to authenticated;

-- What v2.100.0 set (one undated share on each overhead) becomes a share from that overhead's own start date,
-- so every period reads exactly as it did
insert into public.overhead_fulfilment (overhead_id, from_date, share, created_by)
select o.id, o.start_date, o.fulfilment_share, 'Claude' from public.overheads o
where o.fulfilment_share > 0 and not exists (select 1 from public.overhead_fulfilment f where f.overhead_id = o.id);

insert into public.fn_backups(name, def) values
  ('overheads_for_pl before 128 (dated fulfilment)', pg_get_functiondef('public.overheads_for_pl(date,date)'::regprocedure)),
  ('overheads_list before 128 (dated fulfilment)', pg_get_functiondef('public.overheads_list(date,date)'::regprocedure)),
  ('overhead_set_fulfilment before 128 (dated fulfilment)', pg_get_functiondef('public.overhead_set_fulfilment(uuid,numeric)'::regprocedure));

alter table public.overheads drop column fulfilment_share;

create or replace function public.overhead_fulfilment_on(p_id uuid, p_day date)
returns numeric language sql stable security definer set search_path to 'public' as $$
  select coalesce((select f.share from overhead_fulfilment f
                   where f.overhead_id = p_id and f.removed_at is null and f.from_date <= p_day
                   order by f.from_date desc, f.created_at desc limit 1), 0)
$$;

drop function if exists public.overhead_set_fulfilment(uuid, numeric);
create or replace function public.overhead_set_fulfilment(p_id uuid, p_share numeric, p_from date default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $fn$
declare o overheads; ex overhead_fulfilment; v numeric := round(coalesce(p_share, 0), 2);
  v_from date := coalesce(p_from, public.uk_today()); before numeric; was numeric; who text := public.my_name(); txt text;
begin
  if not public.can_open('overheads') then raise exception 'Not allowed'; end if;
  if v < 0 or v > 100 then raise exception 'The share is between 0 and 100'; end if;
  select * into o from overheads where id = p_id and removed_at is null for update;
  if not found then raise exception 'That overhead is no longer there'; end if;
  if v_from < o.start_date then v_from := o.start_date; end if;
  if o.end_date is not null and v_from > o.end_date then raise exception 'It ends on % — choose a date on or before that', to_char(o.end_date, 'DD-MM-YYYY'); end if;
  select * into ex from overhead_fulfilment f where f.overhead_id = p_id and f.removed_at is null and f.from_date = v_from order by f.created_at desc limit 1;
  before := public.overhead_fulfilment_on(p_id, v_from - 1);          -- the share up to the day before
  was := coalesce(ex.share, before);                                   -- the share on that day as things stand
  if was = v then return jsonb_build_object('id', p_id, 'unchanged', true); end if;
  if ex.id is not null then update overhead_fulfilment set removed_at = now(), removed_by = who where id = ex.id; end if;
  -- going back to what it was the day before needs no entry of its own
  if v <> before then insert into overhead_fulfilment (overhead_id, from_date, share, created_by) values (p_id, v_from, v, who); end if;
  update overheads set updated_at = now(), updated_by = who where id = p_id;
  txt := format('From %s: %s (was %s)', to_char(v_from, 'DD-MM-YYYY'), public.overhead_fulfilment_word(v), public.overhead_fulfilment_word(was));
  perform public.overhead_note(p_id, o.name, 'Fulfilment share changed', txt, txt);
  return jsonb_build_object('id', p_id, 'from', v_from);
end $fn$;
revoke all on function public.overhead_set_fulfilment(uuid, numeric, date) from public, anon;
grant execute on function public.overhead_set_fulfilment(uuid, numeric, date) to authenticated;

create or replace function public.overhead_remove_fulfilment(p_row_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $fn$
declare f overhead_fulfilment; o overheads; who text := public.my_name(); txt text;
begin
  if not public.can_open('overheads') then raise exception 'Not allowed'; end if;
  select * into f from overhead_fulfilment where id = p_row_id and removed_at is null for update;
  if not found then raise exception 'That change is no longer there'; end if;
  select * into o from overheads where id = f.overhead_id;
  update overhead_fulfilment set removed_at = now(), removed_by = who where id = f.id;
  update overheads set updated_at = now(), updated_by = who where id = o.id;
  txt := format('The change from %s (%s) was removed', to_char(f.from_date, 'DD-MM-YYYY'), public.overhead_fulfilment_word(f.share));
  perform public.overhead_note(o.id, o.name, 'Fulfilment share change removed', txt, txt);
  return jsonb_build_object('id', o.id);
end $fn$;
revoke all on function public.overhead_remove_fulfilment(uuid) from public, anon;
grant execute on function public.overhead_remove_fulfilment(uuid) to authenticated;

-- The P&L: each day's cost times the share in force on that day
create or replace function public.overheads_for_pl(p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare res jsonb;
begin
  if not (public.sees_costs() and (public.can_open('reports') or public.can_open('overheads'))) then raise exception 'Not allowed'; end if;
  if p_from is null or p_to is null or p_to < p_from then raise exception 'Choose the dates'; end if;
  with d as materialized (select x.overhead_id, x.day, x.cost, o.category, public.overhead_fulfilment_on(x.overhead_id, x.day) / 100 f
             from public.overheads_daily(p_from, p_to) x join overheads o on o.id = x.overhead_id),
  per as (select overhead_id, category, round(sum(cost), 2) cost, round(sum(cost * f), 2) ful from d group by overhead_id, category)
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'total', coalesce((select sum(cost) from per), 0),
    'by_category', coalesce((select jsonb_object_agg(category, t) from (select category, sum(cost) t from per group by category having sum(cost) <> 0) g), '{}'::jsonb),
    'by_day', coalesce((select jsonb_object_agg(day, t) from (select day, round(sum(cost), 4) t from d group by day) g), '{}'::jsonb),
    'fulfilment', coalesce((select sum(ful) from per), 0),
    'fulfilment_by_category', coalesce((select jsonb_object_agg(category, t) from (select category, sum(ful) t from per group by category having sum(ful) <> 0) g), '{}'::jsonb),
    'fulfilment_by_day', coalesce((select jsonb_object_agg(day, t) from (select day, round(sum(cost * f), 4) t from d group by day having sum(cost * f) <> 0) g), '{}'::jsonb),
    'set_up', (select count(*) from overheads where removed_at is null),
    'first_start', (select min(start_date) from overheads where removed_at is null)
  ) into res;
  return res;
end $function$;

-- The Overheads page: the share in force today, the dated shares, and the month's fulfilment part worked out by days
create or replace function public.overheads_list(p_from date default null::date, p_to date default null::date)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare
  today date := public.uk_today();
  d_from date := coalesce(p_from, date_trunc('month', today)::date);
  d_to date := coalesce(p_to, (date_trunc('month', coalesce(p_from, today)::timestamp) + interval '1 month' - interval '1 day')::date);
  res jsonb;
begin
  if not public.can_open('overheads') then raise exception 'Not allowed'; end if;
  if d_to < d_from then raise exception 'The end date is before the start date'; end if;
  with c as (select * from public.overheads_cost(d_from, d_to)),
  ful as (select x.overhead_id, round(sum(x.cost * public.overhead_fulfilment_on(x.overhead_id, x.day) / 100), 2) cost from public.overheads_daily(d_from, d_to) x group by x.overhead_id),
  items as (
    select o.*, coalesce(c.cost, 0) period_cost, coalesce(c.days, 0) period_days, coalesce(ful.cost, 0) period_fulfilment,
           case when o.start_date > today then 'upcoming' when o.end_date is not null and o.end_date < today then 'ended' else 'running' end status,
           n.amount amount_now, n.every every_now, public.overhead_monthly_equiv(n.amount, n.every) monthly_now,
           public.overhead_fulfilment_on(o.id, greatest(today, o.start_date)) fulfilment_share
    from overheads o left join c on c.overhead_id = o.id left join ful on ful.overhead_id = o.id
    cross join lateral public.overhead_amount_on(o.id, greatest(today, o.start_date)) n
    where o.removed_at is null
  )
  select jsonb_build_object(
    'from', d_from, 'to', d_to, 'today', today,
    'total', coalesce((select sum(period_cost) from items), 0),
    'fulfilment', coalesce((select sum(period_fulfilment) from items), 0),
    'fulfilment_monthly', coalesce((select round(sum(monthly_now * fulfilment_share / 100), 2) from items where status = 'running'), 0),
    'running_monthly', coalesce((select sum(monthly_now) from items where status = 'running'), 0),
    'by_category', coalesce((select jsonb_object_agg(category, t) from (select category, sum(period_cost) t from items group by category) g), '{}'::jsonb),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'id', i.id, 'name', i.name, 'category', i.category, 'note', i.note,
        'start_date', i.start_date, 'end_date', i.end_date, 'status', i.status,
        'amount_now', i.amount_now, 'every_now', i.every_now, 'monthly_now', i.monthly_now,
        'period_cost', i.period_cost, 'period_days', i.period_days,
        'fulfilment_share', i.fulfilment_share, 'period_fulfilment', i.period_fulfilment,
        'fulfilment_shares', (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'from_date', f.from_date, 'share', f.share, 'by', f.created_by, 'at', f.created_at) order by f.from_date desc, f.created_at desc), '[]'::jsonb)
                              from overhead_fulfilment f where f.overhead_id = i.id and f.removed_at is null),
        'created_by', i.created_by, 'created_at', i.created_at,
        'amounts', (select jsonb_agg(jsonb_build_object('id', a.id, 'from_date', a.from_date, 'amount', a.amount, 'every', a.every, 'monthly', a.amount, 'by', a.created_by, 'at', a.created_at) order by a.from_date desc)
                    from overhead_amounts a where a.overhead_id = i.id and a.removed_at is null),
        'log', (select coalesce(jsonb_agg(jsonb_build_object('at', l.at, 'by', l.user_name, 'action', l.action, 'detail', l.detail) order by l.at desc, l.id desc), '[]'::jsonb)
                from overhead_log l where l.overhead_id = i.id)
      ) order by i.category, lower(i.name)) from items i), '[]'::jsonb)
  ) into res;
  return res;
end $function$;
