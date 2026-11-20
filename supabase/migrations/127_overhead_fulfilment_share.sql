-- 127 — each overhead says how much of it is a cost of fulfilment (v2.100.0)
--
-- APPLIED to the live database on 17 Nov 2026. No existing figure changes: overheads, gross and net profit are what
-- they were. The functions' text before this is in public.fn_backups ("… before 127 (fulfilment)").
--
-- Why: the owner wants the P&L to show what fulfilment cost in each period — storing, picking, packing and sending.
-- That is the carriers and the packaging (already on every order) plus the overheads that exist only because the
-- orders are sent in-house: warehouse rent, warehouse and dispatch staff, HELM. "All overheads ÷ orders" would mix in
-- costs paid whoever sends the orders (management, office software), so each overhead carries its own share instead.
--
--   overheads.fulfilment_share   0 to 100 (%). 0 = not a fulfilment cost (the default), 100 = all of it.
--   overhead_set_fulfilment(id, share)   people who can open Overheads; logged in the overhead's history.
--   overheads_for_pl   also returns fulfilment (total), fulfilment_by_category and fulfilment_by_day.
--   overheads_list     each item's fulfilment_share; the month's fulfilment and the active monthly fulfilment.
--
-- SUPERSEDED THE SAME DAY BY 128: the share is dated there (a table of dated shares), and this file's undated column
-- is dropped. Run 127 then 128 on a fresh database.
--
-- Data set the same day, logged on each as "Fulfilment share changed" by Claude (the owner's list): Warehouse Rent,
-- Helm, Starlink Warehouse and three warehouse / dispatch staff = 100. Everything else stays 0 (management, a
-- developer, the office's software, GS1). Checked: October 2026 overheads £20,204.37 as before, of which fulfilment
-- £12,734.64; 1 Aug – 16 Nov £65,221.92, of which £39,675.62.

alter table public.overheads add column if not exists fulfilment_share numeric(5,2) not null default 0;
do $c$ begin
  if not exists (select 1 from pg_constraint where conname = 'overheads_fulfilment_share_range') then
    alter table public.overheads add constraint overheads_fulfilment_share_range check (fulfilment_share >= 0 and fulfilment_share <= 100);
  end if;
end $c$;

create or replace function public.overhead_fulfilment_word(p_share numeric)
returns text language sql immutable set search_path to 'public' as $$
  select case when coalesce(p_share, 0) <= 0 then 'not a fulfilment cost' when p_share >= 100 then 'all of it is a fulfilment cost'
              else trim(to_char(p_share, 'FM990.##'), '.') || '% of it is a fulfilment cost' end
$$;

create or replace function public.overhead_set_fulfilment(p_id uuid, p_share numeric)
returns jsonb language plpgsql security definer set search_path to 'public' as $fn$
declare o overheads; v numeric := round(coalesce(p_share, 0), 2); txt text;
begin
  if not public.can_open('overheads') then raise exception 'Not allowed'; end if;
  if v < 0 or v > 100 then raise exception 'The share is between 0 and 100'; end if;
  select * into o from overheads where id = p_id and removed_at is null for update;
  if not found then raise exception 'That overhead is no longer there'; end if;
  if o.fulfilment_share = v then return jsonb_build_object('id', p_id, 'unchanged', true); end if;
  update overheads set fulfilment_share = v, updated_at = now(), updated_by = public.my_name() where id = p_id;
  txt := format('%s → %s', public.overhead_fulfilment_word(o.fulfilment_share), public.overhead_fulfilment_word(v));
  perform public.overhead_note(p_id, o.name, 'Fulfilment share changed', txt, txt);
  return jsonb_build_object('id', p_id);
end $fn$;
revoke all on function public.overhead_set_fulfilment(uuid, numeric) from public, anon;
grant execute on function public.overhead_set_fulfilment(uuid, numeric) to authenticated;

-- The P&L: the same figures as before, plus the fulfilment part of the overheads (total, by day, by category)
insert into public.fn_backups(name, def) values ('overheads_for_pl before 127 (fulfilment)', pg_get_functiondef('public.overheads_for_pl(date,date)'::regprocedure));
create or replace function public.overheads_for_pl(p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare res jsonb;
begin
  if not (public.sees_costs() and (public.can_open('reports') or public.can_open('overheads'))) then raise exception 'Not allowed'; end if;
  if p_from is null or p_to is null or p_to < p_from then raise exception 'Choose the dates'; end if;
  with d as (select x.overhead_id, x.day, x.cost, o.category, o.fulfilment_share / 100 f from public.overheads_daily(p_from, p_to) x join overheads o on o.id = x.overhead_id),
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

-- The Overheads page: each overhead's share, and the month's fulfilment part (a patch to the live function)
do $do$
declare d text;
  a1 text := $o$        'period_cost', i.period_cost, 'period_days', i.period_days,$o$;
  b1 text := $o$        'period_cost', i.period_cost, 'period_days', i.period_days, 'fulfilment_share', i.fulfilment_share,$o$;
  a2 text := $o$    'running_monthly', coalesce($o$;
  b2 text := $o$    'fulfilment', coalesce((select round(sum(period_cost * fulfilment_share / 100), 2) from items), 0),
    'fulfilment_monthly', coalesce((select round(sum(monthly_now * fulfilment_share / 100), 2) from items where status = 'running'), 0),
    'running_monthly', coalesce($o$;
begin
  select pg_get_functiondef('public.overheads_list(date,date)'::regprocedure) into d;
  if position('fulfilment_share' in d) > 0 then raise exception 'overheads_list already returns fulfilment_share'; end if;
  if (length(d) - length(replace(d, a1, ''))) / length(a1) <> 1 or (length(d) - length(replace(d, a2, ''))) / length(a2) <> 1 then
    raise exception 'overheads_list: an anchor was not found exactly once, nothing changed'; end if;
  insert into public.fn_backups(name, def) values ('overheads_list before 127 (fulfilment)', d);
  execute replace(replace(d, a1, b1), a2, b2);
end $do$;
