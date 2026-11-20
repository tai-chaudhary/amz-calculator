-- 105: Overheads — how often each is paid, and overheads by day for the P&L (v2.82.1, 15 Nov 2026).
-- Applied to the live database on 15-11-2026. Safe to re-run.
--
-- The owner's rules (15 Nov):
--   * An overhead is paid weekly, monthly, quarterly or yearly. Whatever the frequency, it is counted BY DAYS:
--       weekly     amount ÷ 7 for each day
--       monthly    amount ÷ the days in that calendar month
--       quarterly  amount ÷ the days in that calendar quarter (Jan–Mar, Apr–Jun, Jul–Sep, Oct–Dec)
--       yearly     amount ÷ the days in that calendar year
--     so a whole month / quarter / year always comes to exactly the amount entered.
--   * The P&L shows the overheads of each day (Day view) and each month, and uses accounting terms:
--     Gross profit (after cost of sales) and Net profit (after overheads).
--
-- overhead_amounts.monthly is renamed "amount" and gets "every" (week | month | quarter | year). The frequency belongs
-- to the amount, so a change of amount from a date can change how often it is paid as well.
-- Kept for the v2.82.0 screens: overhead_save still accepts "monthly"; the list still returns "monthly" on each amount
-- and "monthly_now" (now the monthly equivalent).

do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'overhead_amounts' and column_name = 'monthly') then
    alter table public.overhead_amounts rename column monthly to amount;
  end if;
end $$;
alter table public.overhead_amounts add column if not exists every text not null default 'month';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'overhead_amounts_every_check') then
    alter table public.overhead_amounts add constraint overhead_amounts_every_check check (every in ('week', 'month', 'quarter', 'year'));
  end if;
end $$;

-- What one day costs for an amount paid at a frequency
create or replace function public.overhead_day_cost(p_amount numeric, p_every text, p_day date) returns numeric
language sql immutable set search_path = public as $$
  select p_amount / case p_every
    when 'week' then 7
    when 'quarter' then (date_trunc('quarter', p_day::timestamp) + interval '3 months')::date - date_trunc('quarter', p_day::timestamp)::date
    when 'year' then (date_trunc('year', p_day::timestamp) + interval '1 year')::date - date_trunc('year', p_day::timestamp)::date
    else (date_trunc('month', p_day::timestamp) + interval '1 month')::date - date_trunc('month', p_day::timestamp)::date
  end
$$;

-- The same amount as an average month (a year ÷ 12), for "running now" totals and Build a Month
create or replace function public.overhead_monthly_equiv(p_amount numeric, p_every text) returns numeric
language sql immutable set search_path = public as $$
  select round(case p_every when 'week' then p_amount * 52 / 12 when 'quarter' then p_amount / 3 when 'year' then p_amount / 12 else p_amount end, 2)
$$;

create or replace function public.overhead_every_word(p_every text) returns text
language sql immutable set search_path = public as $$
  select case p_every when 'week' then 'a week' when 'quarter' then 'a quarter' when 'year' then 'a year' else 'a month' end
$$;

-- Internal: the amount in force on a day (the latest on or before it; before the first, the first)
create or replace function public.overhead_amount_on(p_id uuid, p_day date) returns public.overhead_amounts
language sql stable security definer set search_path = public as $$
  select a from overhead_amounts a
  where a.overhead_id = p_id and a.removed_at is null
  order by (a.from_date <= p_day) desc, case when a.from_date <= p_day then a.from_date end desc nulls last, a.from_date asc
  limit 1
$$;

-- Internal: every overhead's cost on every day it runs between two dates (both included)
create or replace function public.overheads_daily(p_from date, p_to date)
returns table (overhead_id uuid, day date, cost numeric)
language sql stable security definer set search_path = public as $$
  select o.id, d.day, public.overhead_day_cost(a.amount, a.every, d.day)
  from overheads o
  cross join lateral (
    select greatest(p_from, o.start_date) + n as day
    from generate_series(0, least(p_to, coalesce(o.end_date, p_to)) - greatest(p_from, o.start_date)) n
  ) d
  cross join lateral public.overhead_amount_on(o.id, d.day) a
  where o.removed_at is null
$$;

-- Internal: what each overhead costs between two dates, by days
create or replace function public.overheads_cost(p_from date, p_to date)
returns table (overhead_id uuid, cost numeric, days integer)
language sql stable security definer set search_path = public as $$
  select x.overhead_id, round(sum(x.cost), 2), count(*)::int from public.overheads_daily(p_from, p_to) x group by x.overhead_id
$$;

drop function if exists public.overhead_rate_on(uuid, date);

create or replace function public.overheads_list(p_from date default null, p_to date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  today date := public.uk_today();
  d_from date := coalesce(p_from, date_trunc('month', today)::date);
  d_to date := coalesce(p_to, (date_trunc('month', coalesce(p_from, today)::timestamp) + interval '1 month' - interval '1 day')::date);
  res jsonb;
begin
  if not public.can_open('overheads') then raise exception 'Not allowed'; end if;
  if d_to < d_from then raise exception 'The end date is before the start date'; end if;
  with c as (select * from public.overheads_cost(d_from, d_to)),
  items as (
    select o.*, coalesce(c.cost, 0) period_cost, coalesce(c.days, 0) period_days,
           case when o.start_date > today then 'upcoming' when o.end_date is not null and o.end_date < today then 'ended' else 'running' end status,
           n.amount amount_now, n.every every_now, public.overhead_monthly_equiv(n.amount, n.every) monthly_now
    from overheads o left join c on c.overhead_id = o.id
    cross join lateral public.overhead_amount_on(o.id, greatest(today, o.start_date)) n
    where o.removed_at is null
  )
  select jsonb_build_object(
    'from', d_from, 'to', d_to, 'today', today,
    'total', coalesce((select sum(period_cost) from items), 0),
    'running_monthly', coalesce((select sum(monthly_now) from items where status = 'running'), 0),
    'by_category', coalesce((select jsonb_object_agg(category, t) from (select category, sum(period_cost) t from items group by category) g), '{}'::jsonb),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'id', i.id, 'name', i.name, 'category', i.category, 'note', i.note,
        'start_date', i.start_date, 'end_date', i.end_date, 'status', i.status,
        'amount_now', i.amount_now, 'every_now', i.every_now, 'monthly_now', i.monthly_now,
        'period_cost', i.period_cost, 'period_days', i.period_days,
        'created_by', i.created_by, 'created_at', i.created_at,
        'amounts', (select jsonb_agg(jsonb_build_object('id', a.id, 'from_date', a.from_date, 'amount', a.amount, 'every', a.every, 'monthly', a.amount, 'by', a.created_by, 'at', a.created_at) order by a.from_date desc)
                    from overhead_amounts a where a.overhead_id = i.id and a.removed_at is null),
        'log', (select coalesce(jsonb_agg(jsonb_build_object('at', l.at, 'by', l.user_name, 'action', l.action, 'detail', l.detail) order by l.at desc, l.id desc), '[]'::jsonb)
                from overhead_log l where l.overhead_id = i.id)
      ) order by i.category, lower(i.name)) from items i), '[]'::jsonb)
  ) into res;
  return res;
end $$;

-- new: { name, category, note, start_date, amount, every, end_date? }   change: { id, name, category, note, start_date }
create or replace function public.overhead_save(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_name text := btrim(coalesce(p->>'name', ''));
  v_cat text := coalesce(nullif(p->>'category', ''), 'other');
  v_note text := nullif(btrim(coalesce(p->>'note', '')), '');
  v_start date := nullif(p->>'start_date', '')::date;
  v_end date := nullif(p->>'end_date', '')::date;
  v_amount numeric := round(nullif(coalesce(p->>'amount', p->>'monthly'), '')::numeric, 2);
  v_every text := coalesce(nullif(p->>'every', ''), 'month');
  o overheads; first_id uuid; changes text[] := '{}'; who text := public.my_name();
  cats jsonb := '{"staff":"Staff & payroll","software":"Software & subscriptions","office":"Office & premises","marketing":"Marketing & advertising","professional":"Professional services","other":"Other"}';
begin
  if not public.can_open('overheads') then raise exception 'Not allowed'; end if;
  if v_name = '' then raise exception 'Give it a name'; end if;
  if not cats ? v_cat then raise exception 'Choose a category'; end if;
  if v_start is null then raise exception 'Choose the date it starts from'; end if;

  if v_id is null then
    if v_amount is null or v_amount <= 0 then raise exception 'Enter the amount'; end if;
    if v_every not in ('week', 'month', 'quarter', 'year') then raise exception 'Choose how often it is paid'; end if;
    if v_end is not null and v_end < v_start then raise exception 'The last day is before the start date'; end if;
    insert into overheads (name, category, note, start_date, end_date, created_by, updated_by)
    values (v_name, v_cat, v_note, v_start, v_end, who, who) returning id into v_id;
    insert into overhead_amounts (overhead_id, from_date, amount, every, created_by) values (v_id, v_start, v_amount, v_every, who);
    perform public.overhead_note(v_id, v_name, 'Overhead added',
      format('%s, from %s%s', cats->>v_cat, to_char(v_start, 'DD-MM-YYYY'), case when v_end is not null then ' to ' || to_char(v_end, 'DD-MM-YYYY') else '' end),
      format('£%s %s from %s%s (%s)', to_char(v_amount, 'FM999,999,990.00'), public.overhead_every_word(v_every), to_char(v_start, 'DD-MM-YYYY'),
             case when v_end is not null then ' to ' || to_char(v_end, 'DD-MM-YYYY') else '' end, cats->>v_cat));
    return jsonb_build_object('id', v_id);
  end if;

  select * into o from overheads where id = v_id and removed_at is null for update;
  if not found then raise exception 'That overhead is no longer there'; end if;
  if o.end_date is not null and o.end_date < v_start then raise exception 'It ends on % — that is before this start date', to_char(o.end_date, 'DD-MM-YYYY'); end if;
  if o.name <> v_name then changes := changes || format('name %s → %s', o.name, v_name); end if;
  if o.category <> v_cat then changes := changes || format('category %s → %s', cats->>o.category, cats->>v_cat); end if;
  if o.start_date <> v_start then changes := changes || format('start date %s → %s', to_char(o.start_date, 'DD-MM-YYYY'), to_char(v_start, 'DD-MM-YYYY')); end if;
  if coalesce(o.note, '') <> coalesce(v_note, '') then changes := changes || 'note changed'::text; end if;
  if array_length(changes, 1) is null then return jsonb_build_object('id', v_id, 'unchanged', true); end if;

  update overheads set name = v_name, category = v_cat, note = v_note, start_date = v_start, updated_at = now(), updated_by = who where id = v_id;
  if o.start_date <> v_start then
    select a.id into first_id from overhead_amounts a where a.overhead_id = v_id and a.removed_at is null order by a.from_date limit 1;
    update overhead_amounts a set from_date = v_start
    where a.id = first_id and not exists (select 1 from overhead_amounts b where b.overhead_id = v_id and b.removed_at is null and b.id <> first_id and b.from_date <= v_start);
  end if;
  perform public.overhead_note(v_id, v_name, 'Overhead changed', array_to_string(changes, '; '), array_to_string(changes, '; '));
  return jsonb_build_object('id', v_id);
end $$;

-- A new amount (and, if given, a new frequency) from a date, or a correction of what is already set for that date.
drop function if exists public.overhead_set_amount(uuid, date, numeric);
create or replace function public.overhead_set_amount(p_id uuid, p_from date, p_monthly numeric, p_every text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o overheads; was overhead_amounts; v numeric := round(p_monthly, 2); ev text; same_day uuid; who text := public.my_name();
begin
  if not public.can_open('overheads') then raise exception 'Not allowed'; end if;
  select * into o from overheads where id = p_id and removed_at is null for update;
  if not found then raise exception 'That overhead is no longer there'; end if;
  if p_from is null then raise exception 'Choose the date the new amount applies from'; end if;
  if v is null or v < 0 then raise exception 'Enter the amount'; end if;
  if p_from < o.start_date then raise exception 'That is before it starts (%). Change the start date instead.', to_char(o.start_date, 'DD-MM-YYYY'); end if;
  if o.end_date is not null and p_from > o.end_date then raise exception 'It ends on % — that is before this date', to_char(o.end_date, 'DD-MM-YYYY'); end if;
  was := public.overhead_amount_on(p_id, p_from);
  ev := coalesce(nullif(p_every, ''), was.every, 'month');
  if ev not in ('week', 'month', 'quarter', 'year') then raise exception 'Choose how often it is paid'; end if;
  select a.id into same_day from overhead_amounts a where a.overhead_id = p_id and a.removed_at is null and a.from_date = p_from;
  if was.amount = v and was.every = ev then
    if same_day is not null then return jsonb_build_object('id', p_id, 'unchanged', true); end if;
    raise exception 'It is already £% % on that date', to_char(v, 'FM999,999,990.00'), public.overhead_every_word(ev);
  end if;
  if same_day is not null then
    update overhead_amounts set amount = v, every = ev, created_by = who, created_at = now() where id = same_day;
  else
    insert into overhead_amounts (overhead_id, from_date, amount, every, created_by) values (p_id, p_from, v, ev, who);
  end if;
  update overheads set updated_at = now(), updated_by = who where id = p_id;
  perform public.overhead_note(p_id, o.name, 'Overhead amount changed',
    format('New amount from %s', to_char(p_from, 'DD-MM-YYYY')),
    format('£%s %s → £%s %s from %s', to_char(was.amount, 'FM999,999,990.00'), public.overhead_every_word(was.every),
           to_char(v, 'FM999,999,990.00'), public.overhead_every_word(ev), to_char(p_from, 'DD-MM-YYYY')));
  return jsonb_build_object('id', p_id);
end $$;

create or replace function public.overhead_remove_amount(p_amount_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a overhead_amounts; o overheads; first_id uuid; who text := public.my_name();
begin
  if not public.can_open('overheads') then raise exception 'Not allowed'; end if;
  select * into a from overhead_amounts where id = p_amount_id and removed_at is null for update;
  if not found then raise exception 'That amount is no longer there'; end if;
  select * into o from overheads where id = a.overhead_id;
  select x.id into first_id from overhead_amounts x where x.overhead_id = a.overhead_id and x.removed_at is null order by x.from_date limit 1;
  if first_id = a.id then raise exception 'This is the starting amount — change it instead of removing it'; end if;
  update overhead_amounts set removed_at = now(), removed_by = who where id = a.id;
  update overheads set updated_at = now(), updated_by = who where id = o.id;
  perform public.overhead_note(o.id, o.name, 'Overhead amount change removed',
    format('The change from %s was removed', to_char(a.from_date, 'DD-MM-YYYY')),
    format('The change to £%s %s from %s was removed', to_char(a.amount, 'FM999,999,990.00'), public.overhead_every_word(a.every), to_char(a.from_date, 'DD-MM-YYYY')));
  return jsonb_build_object('id', o.id);
end $$;

-- The P&L: overheads between two dates — the total, by category, and for each day. Never a name.
create or replace function public.overheads_for_pl(p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare res jsonb;
begin
  if not (public.sees_costs() and (public.can_open('reports') or public.can_open('overheads'))) then raise exception 'Not allowed'; end if;
  if p_from is null or p_to is null or p_to < p_from then raise exception 'Choose the dates'; end if;
  with d as (select x.overhead_id, x.day, x.cost, o.category from public.overheads_daily(p_from, p_to) x join overheads o on o.id = x.overhead_id),
  per as (select overhead_id, category, round(sum(cost), 2) cost from d group by overhead_id, category)
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'total', coalesce((select sum(cost) from per), 0),
    'by_category', coalesce((select jsonb_object_agg(category, t) from (select category, sum(cost) t from per group by category having sum(cost) <> 0) g), '{}'::jsonb),
    'by_day', coalesce((select jsonb_object_agg(day, t) from (select day, round(sum(cost), 4) t from d group by day) g), '{}'::jsonb),
    'set_up', (select count(*) from overheads where removed_at is null),
    'first_start', (select min(start_date) from overheads where removed_at is null)
  ) into res;
  return res;
end $$;

revoke all on function public.overhead_amount_on(uuid, date) from public, anon, authenticated;
revoke all on function public.overheads_daily(date, date) from public, anon, authenticated;
revoke all on function public.overheads_cost(date, date) from public, anon, authenticated;
revoke all on function public.overhead_set_amount(uuid, date, numeric, text) from public, anon;
grant execute on function public.overhead_set_amount(uuid, date, numeric, text) to authenticated;
