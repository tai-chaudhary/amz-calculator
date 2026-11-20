-- 104: Overheads with dates (v2.82.0, 15 Nov 2026). Applied to the live database on 15-11-2026. Safe to re-run.
--
-- The owner's rules:
--   * Overheads are FIXED monthly costs only (wages, rent, software…). One-offs, other running costs and equipment are
--     not kept here — how those are handled is still to be decided.
--   * Each overhead has the date it starts from, and can have a last day. A part month is charged BY DAYS:
--     monthly amount ÷ days in that month × days it ran.
--   * When an amount changes, the new amount is added with the date it applies from; earlier days keep the old amount.
--   * Amounts are ex VAT.
--   * The list starts EMPTY: the nine undated items of the old page (settings key 'overheads') were not carried over.
--     That settings row is left as it was and is no longer read by the portal.
--
-- Who sees what: wages are in here, so the list is only for people who can open the Overheads page
-- (can_open('overheads') — admins, or anyone ticked for it). The P&L gets a total and a split by category through
-- overheads_for_pl(), for people who see costs and can open Reports or Overheads. The portal-wide activity log gets
-- one line per change WITHOUT any amount (it is read by everyone who sees costs); the amounts are in overhead_log,
-- which only the Overheads page reads.

create table if not exists public.overheads (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  category text not null default 'other' check (category in ('staff', 'software', 'office', 'marketing', 'professional', 'other')),
  note text,
  start_date date not null,
  end_date date check (end_date is null or end_date >= start_date),   -- the last day it is charged
  removed_at timestamptz, removed_by text, removed_reason text,       -- added by mistake: kept, never counted
  created_at timestamptz not null default now(), created_by text,
  updated_at timestamptz not null default now(), updated_by text
);

-- The monthly amount, and the day each amount applies from. The earliest row is the starting amount.
create table if not exists public.overhead_amounts (
  id uuid primary key default gen_random_uuid(),
  overhead_id uuid not null references public.overheads(id) on delete cascade,
  from_date date not null,
  monthly numeric(12,2) not null check (monthly >= 0),
  removed_at timestamptz, removed_by text,
  created_at timestamptz not null default now(), created_by text
);
create unique index if not exists overhead_amounts_one_per_day on public.overhead_amounts (overhead_id, from_date) where removed_at is null;
create index if not exists overhead_amounts_overhead_idx on public.overhead_amounts (overhead_id);

-- Every change, with the amounts. Only read by the Overheads page.
create table if not exists public.overhead_log (
  id bigserial primary key,
  overhead_id uuid not null references public.overheads(id) on delete cascade,
  at timestamptz not null default now(),
  user_name text,
  action text not null,
  detail text
);
create index if not exists overhead_log_overhead_idx on public.overhead_log (overhead_id, at desc);

alter table public.overheads enable row level security;
alter table public.overhead_amounts enable row level security;
alter table public.overhead_log enable row level security;
drop policy if exists "Overheads page reads" on public.overheads;
create policy "Overheads page reads" on public.overheads for select to authenticated using (public.can_open('overheads'));
drop policy if exists "Overheads page reads" on public.overhead_amounts;
create policy "Overheads page reads" on public.overhead_amounts for select to authenticated using (public.can_open('overheads'));
drop policy if exists "Overheads page reads" on public.overhead_log;
create policy "Overheads page reads" on public.overhead_log for select to authenticated using (public.can_open('overheads'));
-- No insert / update / delete policies: every change goes through the functions below.

-- Today's date in the UK (the database clock is UTC)
create or replace function public.uk_today() returns date
language sql stable set search_path = public as $$ select (now() at time zone 'Europe/London')::date $$;

-- Internal: the monthly amount in force on a day (the latest amount on or before it; before the first, the first)
create or replace function public.overhead_rate_on(p_id uuid, p_day date) returns numeric
language sql stable security definer set search_path = public as $$
  select a.monthly from overhead_amounts a
  where a.overhead_id = p_id and a.removed_at is null
  order by (a.from_date <= p_day) desc, case when a.from_date <= p_day then a.from_date end desc nulls last, a.from_date asc
  limit 1
$$;

-- Internal: what each overhead costs between two dates (both included), by days.
-- Each day costs that day's monthly amount ÷ the days in its month, so a whole month always comes to the monthly amount.
create or replace function public.overheads_cost(p_from date, p_to date)
returns table (overhead_id uuid, cost numeric, days integer)
language sql stable security definer set search_path = public as $$
  select o.id,
         round(coalesce(sum(public.overhead_rate_on(o.id, d.day)
               / extract(day from (date_trunc('month', d.day::timestamp) + interval '1 month' - interval '1 day'))::numeric), 0), 2),
         count(d.day)::int
  from overheads o
  left join lateral (
    select greatest(p_from, o.start_date) + n as day
    from generate_series(0, least(p_to, coalesce(o.end_date, p_to)) - greatest(p_from, o.start_date)) n
  ) d on true
  where o.removed_at is null
  group by o.id
$$;

-- Internal: one line in both logs. The portal-wide log never carries an amount.
create or replace function public.overhead_note(p_id uuid, p_name text, p_action text, p_public text, p_private text)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into overhead_log (overhead_id, user_name, action, detail) values (p_id, public.my_name(), p_action, p_private);
  insert into activity_log (entity_type, entity_id, entity_name, action, detail, user_name, source)
  values ('overhead', p_id::text, p_name, p_action, p_public, public.my_name(), 'overheads');
end $$;

-- The Overheads page: every overhead with its amounts and history, and what each costs in the period shown.
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
           public.overhead_rate_on(o.id, greatest(today, o.start_date)) monthly_now
    from overheads o left join c on c.overhead_id = o.id
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
        'monthly_now', i.monthly_now, 'period_cost', i.period_cost, 'period_days', i.period_days,
        'created_by', i.created_by, 'created_at', i.created_at,
        'amounts', (select jsonb_agg(jsonb_build_object('id', a.id, 'from_date', a.from_date, 'monthly', a.monthly, 'by', a.created_by, 'at', a.created_at) order by a.from_date desc)
                    from overhead_amounts a where a.overhead_id = i.id and a.removed_at is null),
        'log', (select coalesce(jsonb_agg(jsonb_build_object('at', l.at, 'by', l.user_name, 'action', l.action, 'detail', l.detail) order by l.at desc, l.id desc), '[]'::jsonb)
                from overhead_log l where l.overhead_id = i.id)
      ) order by i.category, lower(i.name)) from items i), '[]'::jsonb)
  ) into res;
  return res;
end $$;

-- Add an overhead, or change its name, category, note or start date.
--   new:    { name, category, note, start_date, monthly, end_date? }
--   change: { id, name, category, note, start_date }
create or replace function public.overhead_save(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_name text := btrim(coalesce(p->>'name', ''));
  v_cat text := coalesce(nullif(p->>'category', ''), 'other');
  v_note text := nullif(btrim(coalesce(p->>'note', '')), '');
  v_start date := nullif(p->>'start_date', '')::date;
  v_end date := nullif(p->>'end_date', '')::date;
  v_monthly numeric := round(nullif(p->>'monthly', '')::numeric, 2);
  o overheads; first_id uuid; changes text[] := '{}'; who text := public.my_name();
  cats jsonb := '{"staff":"Staff & payroll","software":"Software & subscriptions","office":"Office & premises","marketing":"Marketing & advertising","professional":"Professional services","other":"Other"}';
begin
  if not public.can_open('overheads') then raise exception 'Not allowed'; end if;
  if v_name = '' then raise exception 'Give it a name'; end if;
  if not cats ? v_cat then raise exception 'Choose a category'; end if;
  if v_start is null then raise exception 'Choose the date it starts from'; end if;

  if v_id is null then
    if v_monthly is null or v_monthly <= 0 then raise exception 'Enter the monthly amount'; end if;
    if v_end is not null and v_end < v_start then raise exception 'The last day is before the start date'; end if;
    insert into overheads (name, category, note, start_date, end_date, created_by, updated_by)
    values (v_name, v_cat, v_note, v_start, v_end, who, who) returning id into v_id;
    insert into overhead_amounts (overhead_id, from_date, monthly, created_by) values (v_id, v_start, v_monthly, who);
    perform public.overhead_note(v_id, v_name, 'Overhead added',
      format('%s, from %s%s', cats->>v_cat, to_char(v_start, 'DD-MM-YYYY'), case when v_end is not null then ' to ' || to_char(v_end, 'DD-MM-YYYY') else '' end),
      format('£%s a month from %s%s (%s)', to_char(v_monthly, 'FM999,999,990.00'), to_char(v_start, 'DD-MM-YYYY'),
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
    -- The starting amount moves with the start date, unless a later amount already applies by then
    select a.id into first_id from overhead_amounts a where a.overhead_id = v_id and a.removed_at is null order by a.from_date limit 1;
    update overhead_amounts a set from_date = v_start
    where a.id = first_id and not exists (select 1 from overhead_amounts b where b.overhead_id = v_id and b.removed_at is null and b.id <> first_id and b.from_date <= v_start);
  end if;
  perform public.overhead_note(v_id, v_name, 'Overhead changed', array_to_string(changes, '; '), array_to_string(changes, '; '));
  return jsonb_build_object('id', v_id);
end $$;

-- A new monthly amount from a date (or a correction of the amount already set for that date).
create or replace function public.overhead_set_amount(p_id uuid, p_from date, p_monthly numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o overheads; was numeric; v numeric := round(p_monthly, 2); same_day uuid; who text := public.my_name();
begin
  if not public.can_open('overheads') then raise exception 'Not allowed'; end if;
  select * into o from overheads where id = p_id and removed_at is null for update;
  if not found then raise exception 'That overhead is no longer there'; end if;
  if p_from is null then raise exception 'Choose the date the new amount applies from'; end if;
  if v is null or v < 0 then raise exception 'Enter the monthly amount'; end if;
  if p_from < o.start_date then raise exception 'That is before it starts (%). Change the start date instead.', to_char(o.start_date, 'DD-MM-YYYY'); end if;
  if o.end_date is not null and p_from > o.end_date then raise exception 'It ends on % — that is before this date', to_char(o.end_date, 'DD-MM-YYYY'); end if;
  was := public.overhead_rate_on(p_id, p_from);
  select a.id into same_day from overhead_amounts a where a.overhead_id = p_id and a.removed_at is null and a.from_date = p_from;
  if same_day is not null then
    if was = v then return jsonb_build_object('id', p_id, 'unchanged', true); end if;
    update overhead_amounts set monthly = v, created_by = who, created_at = now() where id = same_day;
  else
    if was = v then raise exception 'It is already £% a month on that date', to_char(v, 'FM999,999,990.00'); end if;
    insert into overhead_amounts (overhead_id, from_date, monthly, created_by) values (p_id, p_from, v, who);
  end if;
  update overheads set updated_at = now(), updated_by = who where id = p_id;
  perform public.overhead_note(p_id, o.name, 'Overhead amount changed',
    format('New amount from %s', to_char(p_from, 'DD-MM-YYYY')),
    format('£%s → £%s a month from %s', to_char(was, 'FM999,999,990.00'), to_char(v, 'FM999,999,990.00'), to_char(p_from, 'DD-MM-YYYY')));
  return jsonb_build_object('id', p_id);
end $$;

-- Take back an amount change entered by mistake (never the starting amount — correct that instead).
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
    format('The change to £%s a month from %s was removed', to_char(a.monthly, 'FM999,999,990.00'), to_char(a.from_date, 'DD-MM-YYYY')));
  return jsonb_build_object('id', o.id);
end $$;

-- End it (p_end = the last day it is charged), or set it running again (p_end null).
create or replace function public.overhead_end(p_id uuid, p_end date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o overheads; who text := public.my_name(); msg text;
begin
  if not public.can_open('overheads') then raise exception 'Not allowed'; end if;
  select * into o from overheads where id = p_id and removed_at is null for update;
  if not found then raise exception 'That overhead is no longer there'; end if;
  if p_end is not null and p_end < o.start_date then raise exception 'It starts on % — the last day cannot be before that', to_char(o.start_date, 'DD-MM-YYYY'); end if;
  if o.end_date is not distinct from p_end then return jsonb_build_object('id', p_id, 'unchanged', true); end if;
  update overheads set end_date = p_end, updated_at = now(), updated_by = who where id = p_id;
  msg := case when p_end is null then format('No end date any more (was %s)', to_char(o.end_date, 'DD-MM-YYYY'))
              when o.end_date is null then format('Last day charged: %s', to_char(p_end, 'DD-MM-YYYY'))
              else format('Last day charged: %s (was %s)', to_char(p_end, 'DD-MM-YYYY'), to_char(o.end_date, 'DD-MM-YYYY')) end;
  perform public.overhead_note(p_id, o.name, case when p_end is null then 'Overhead running again' else 'Overhead ended' end, msg, msg);
  return jsonb_build_object('id', p_id);
end $$;

-- Added by mistake: it stops counting on every date. Kept on record with who and why.
create or replace function public.overhead_remove(p_id uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o overheads; who text := public.my_name(); why text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not public.can_open('overheads') then raise exception 'Not allowed'; end if;
  select * into o from overheads where id = p_id and removed_at is null for update;
  if not found then raise exception 'That overhead is no longer there'; end if;
  update overheads set removed_at = now(), removed_by = who, removed_reason = why, updated_at = now(), updated_by = who where id = p_id;
  perform public.overhead_note(p_id, o.name, 'Overhead removed', coalesce(why, 'No reason given'), coalesce(why, 'No reason given'));
  return jsonb_build_object('id', p_id);
end $$;

-- The P&L: overheads between two dates, by days. A total and a split by category only — never a name.
create or replace function public.overheads_for_pl(p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare res jsonb;
begin
  if not (public.sees_costs() and (public.can_open('reports') or public.can_open('overheads'))) then raise exception 'Not allowed'; end if;
  if p_from is null or p_to is null or p_to < p_from then raise exception 'Choose the dates'; end if;
  with c as (select o.category, x.cost from public.overheads_cost(p_from, p_to) x join overheads o on o.id = x.overhead_id)
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'total', coalesce((select sum(cost) from c), 0),
    'by_category', coalesce((select jsonb_object_agg(category, t) from (select category, sum(cost) t from c group by category having sum(cost) <> 0) g), '{}'::jsonb),
    'set_up', (select count(*) from overheads where removed_at is null),
    'first_start', (select min(start_date) from overheads where removed_at is null)
  ) into res;
  return res;
end $$;

-- Internal functions are not callable from the browser; the rest only by signed-in people (each checks who).
revoke all on function public.overhead_rate_on(uuid, date) from public, anon, authenticated;
revoke all on function public.overheads_cost(date, date) from public, anon, authenticated;
revoke all on function public.overhead_note(uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.overheads_list(date, date) from public, anon;
revoke all on function public.overhead_save(jsonb) from public, anon;
revoke all on function public.overhead_set_amount(uuid, date, numeric) from public, anon;
revoke all on function public.overhead_remove_amount(uuid) from public, anon;
revoke all on function public.overhead_end(uuid, date) from public, anon;
revoke all on function public.overhead_remove(uuid, text) from public, anon;
revoke all on function public.overheads_for_pl(date, date) from public, anon;
grant execute on function public.overheads_list(date, date) to authenticated;
grant execute on function public.overhead_save(jsonb) to authenticated;
grant execute on function public.overhead_set_amount(uuid, date, numeric) to authenticated;
grant execute on function public.overhead_remove_amount(uuid) to authenticated;
grant execute on function public.overhead_end(uuid, date) to authenticated;
grant execute on function public.overhead_remove(uuid, text) to authenticated;
grant execute on function public.overheads_for_pl(date, date) to authenticated;
