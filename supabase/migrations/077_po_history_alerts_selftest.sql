-- 077 (part 1): Purchase orders — one-step save with a full change history, cancelling needs a reason (Oct 2026)
--   • po_save: the order and its lines saved together in one database step (never half-saved), and every change
--     to a live order written to its history: what changed, from what, to what, by whom.
--   • Received quantities only come from Goods In: po_save never changes them.
--   • Cancelling always needs a reason. A paid order can be cancelled, and is then flagged "Credit note awaited"
--     until a credit note is raised against it.
-- Safe to re-run.

create or replace function public.po_money(n numeric) returns text language sql immutable set search_path = public as $$
  select '£' || to_char(coalesce(n, 0), 'FM999,999,990.00')
$$;

create or replace function public.po_save(p_po jsonb, p_items jsonb, p_by text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  who text; pid uuid; po_old purchase_orders%rowtype; po_new purchase_orders%rowtype; existed boolean := false;
  cols text; sets text; it jsonb; old_it purchase_order_items%rowtype; new_it purchase_order_items%rowtype; iid uuid;
  keep uuid[] := '{}'; changes text[] := '{}'; f text; a text; b text; label text;
begin
  if not public.sees_costs() then raise exception 'Not allowed'; end if;
  who := coalesce(nullif(trim(p_by), ''), (select display_name from profiles where id = auth.uid()), 'Someone');
  pid := nullif(p_po ->> 'id', '')::uuid;
  if pid is not null then
    select * into po_old from purchase_orders where id = pid for update;
    existed := found;
  end if;

  if existed then
    select string_agg(format('%1$I = r.%1$I', c.column_name), ', ') into sets
      from information_schema.columns c
      where c.table_schema = 'public' and c.table_name = 'purchase_orders' and p_po ? c.column_name
        and c.column_name not in ('id', 'created_at', 'updated_at');
    if sets is not null then
      execute format('update purchase_orders t set %s, updated_at = now() from jsonb_populate_record(null::purchase_orders, $1) r where t.id = $2', sets)
        using p_po, pid;
    end if;
  else
    select string_agg(format('%I', c.column_name), ', ') into cols
      from information_schema.columns c
      where c.table_schema = 'public' and c.table_name = 'purchase_orders' and p_po ? c.column_name
        and c.column_name not in ('created_at', 'updated_at') and not (c.column_name = 'id' and pid is null);
    execute format('insert into purchase_orders (%1$s) select %1$s from jsonb_populate_record(null::purchase_orders, $1) returning id', cols)
      using p_po into pid;
  end if;
  if p_items is not null then
    -- Which existing lines stay (the rest are taken off first, so Goods In can follow a swapped product)
    for it in select * from jsonb_array_elements(p_items) loop
      iid := nullif(it ->> 'id', '')::uuid;
      if iid is not null and exists (select 1 from purchase_order_items where id = iid and po_id = pid) then keep := keep || iid; end if;
    end loop;
    for old_it in select * from purchase_order_items where po_id = pid and not (id = any (keep)) order by created_at loop
      changes := changes || format('Removed: %s × %s', old_it.qty, old_it.name);
      delete from purchase_order_items where id = old_it.id;
    end loop;

    for it in select * from jsonb_array_elements(p_items) loop
      iid := nullif(it ->> 'id', '')::uuid;
      if iid is not null and iid = any (keep) then
        select * into old_it from purchase_order_items where id = iid;
        select string_agg(format('%1$I = r.%1$I', c.column_name), ', ') into sets
          from information_schema.columns c
          where c.table_schema = 'public' and c.table_name = 'purchase_order_items' and it ? c.column_name
            and c.column_name not in ('id', 'po_id', 'created_at', 'qty_received');
        if sets is not null then
          execute format('update purchase_order_items t set %s from jsonb_populate_record(null::purchase_order_items, $1) r where t.id = $2', sets)
            using it, iid;
        end if;
        select * into new_it from purchase_order_items where id = iid;
        label := old_it.name;
        if new_it.name is distinct from old_it.name or new_it.stock_item_id is distinct from old_it.stock_item_id then
          changes := changes || format('Product: %s → %s', old_it.name, new_it.name); label := new_it.name;
        end if;
        if new_it.qty is distinct from old_it.qty then changes := changes || format('%s: qty %s → %s', label, old_it.qty, new_it.qty); end if;
        if new_it.unit_cost is distinct from old_it.unit_cost then changes := changes || format('%s: price %s → %s', label, po_money(old_it.unit_cost), po_money(new_it.unit_cost)); end if;
        if coalesce(new_it.line_note, '') is distinct from coalesce(old_it.line_note, '') then changes := changes || format('%s: note “%s” → “%s”', label, coalesce(old_it.line_note, ''), coalesce(new_it.line_note, '')); end if;
        if coalesce(new_it.supplier_sku, '') is distinct from coalesce(old_it.supplier_sku, '') then changes := changes || format('%s: supplier code %s → %s', label, coalesce(old_it.supplier_sku, '—'), coalesce(new_it.supplier_sku, '—')); end if;
        if new_it.line_status is distinct from old_it.line_status then changes := changes || format('%s: %s → %s', label, replace(coalesce(old_it.line_status, 'due'), '_', ' '), replace(coalesce(new_it.line_status, 'due'), '_', ' ')); end if;
      else
        select string_agg(format('%I', c.column_name), ', ') into cols
          from information_schema.columns c
          where c.table_schema = 'public' and c.table_name = 'purchase_order_items' and it ? c.column_name
            and c.column_name not in ('id', 'po_id', 'created_at', 'qty_received');
        execute format('insert into purchase_order_items (po_id%1$s) select $2%2$s from jsonb_populate_record(null::purchase_order_items, $1) returning *',
          coalesce(', ' || cols, ''), coalesce(', ' || cols, '')) using it, pid into new_it;
        changes := changes || format('Added: %s × %s at %s', new_it.qty, new_it.name, po_money(new_it.unit_cost));
      end if;
    end loop;
  end if;

  -- The order itself
  if existed then
    for f, label in select * from (values ('supplier_name', 'Supplier'), ('delivery_date', 'Delivery date'), ('terms', 'Terms'),
        ('order_method', 'How it’s ordered'), ('payment_due_at', 'Pay by'), ('category', 'Category'), ('subtotal', 'Subtotal'),
        ('vat', 'VAT'), ('delivery', 'Delivery charge'), ('total', 'Total'), ('notes', 'Notes'), ('invoice_number', 'Invoice no.'),
        ('invoice_total', 'Invoice total'), ('online_url', 'Order link'), ('login_hint', 'Login'), ('delivery_note', 'Delivery note'),
        ('credit_reason', 'Credit reason'), ('proforma_path', 'Proforma'), ('invoice_path', 'Invoice')) v(f, label) loop
      execute format('select ($1).%1$I::text, (select %1$I::text from purchase_orders where id = $2)', f) using po_old, pid into a, b;
      if a is distinct from b then
        if f in ('subtotal', 'vat', 'delivery', 'total', 'invoice_total') then changes := changes || format('%s: %s → %s', label, po_money(a::numeric), po_money(b::numeric));
        elsif f in ('proforma_path', 'invoice_path') then changes := changes || format('%s %s', label, case when b is null then 'removed' when a is null then 'added' else 'replaced' end);
        elsif f = 'notes' then changes := changes || 'Notes changed';
        else changes := changes || format('%s: %s → %s', label, coalesce(a, '—'), coalesce(b, '—')); end if;
      end if;
    end loop;
    if po_old.status <> 'draft' and array_length(changes, 1) > 0 then
      insert into activity_log (entity_type, entity_id, entity_name, action, detail, user_name, source)
      values ('purchase', pid, po_old.po_number, 'Edited', array_to_string(changes, ' · '), who, 'purchasing');
    end if;
  end if;

  select * into po_new from purchase_orders where id = pid;
  return to_jsonb(po_new) || jsonb_build_object('changes', coalesce(array_length(changes, 1), 0),
    'items', coalesce((select jsonb_agg(to_jsonb(i) order by i.created_at) from purchase_order_items i where i.po_id = pid), '[]'::jsonb));
end $$;
revoke all on function public.po_save(jsonb, jsonb, text) from public, anon;
grant execute on function public.po_save(jsonb, jsonb, text) to authenticated;

-- Cancelling: always with a reason; a paid order then waits for its credit note
create or replace function public.po_cancel(p_po uuid, p_reason text, p_by text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare po purchase_orders%rowtype; who text; paid boolean;
begin
  if not public.sees_costs() then raise exception 'Not allowed'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Say why it’s being cancelled'; end if;
  who := coalesce(nullif(trim(p_by), ''), (select display_name from profiles where id = auth.uid()), 'Someone');
  select * into po from purchase_orders where id = p_po for update;
  if not found then raise exception 'Order not found'; end if;
  if po.status = 'cancelled' then raise exception '% is already cancelled', po.po_number; end if;
  paid := po.payment_status = 'paid';
  update purchase_orders set status = 'cancelled', updated_at = now(),
    data = coalesce(data, '{}') || jsonb_build_object('cancelReason', trim(p_reason), 'cancelledBy', who, 'cancelledAt', now(),
      'cancelledFrom', po.status, 'creditAwaited', paid)
  where id = p_po;
  insert into activity_log (entity_type, entity_id, entity_name, action, detail, user_name, source)
  values ('purchase', p_po, po.po_number, 'Cancelled',
    trim(p_reason) || case when paid then format(' · paid %s — credit note awaited', po_money(po.total)) else '' end, who, 'purchasing');
  return jsonb_build_object('credit_awaited', paid);
end $$;
revoke all on function public.po_cancel(uuid, text, text) from public, anon;
grant execute on function public.po_cancel(uuid, text, text) to authenticated;

-- Nothing cancels an order without a reason, whatever path it comes by
create or replace function public.po_cancel_guard() returns trigger language plpgsql set search_path = public as $$
begin
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' and coalesce(new.data ->> 'cancelReason', '') = '' then
    raise exception 'Say why it’s being cancelled';
  end if;
  return new;
end $$;
drop trigger if exists po_cancel_guard on purchase_orders;
create trigger po_cancel_guard before update of status on purchase_orders for each row execute function public.po_cancel_guard();

-- A credit note raised against an order clears its "credit note awaited"
create or replace function public.po_credit_raised() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.credit_for is not null and (tg_op = 'INSERT' or old.credit_for is distinct from new.credit_for) then
    update purchase_orders set data = coalesce(data, '{}') || jsonb_build_object('creditAwaited', false, 'creditRaised', new.po_number)
    where id = new.credit_for and (data ->> 'creditAwaited')::boolean is true;
  end if;
  return new;
end $$;
drop trigger if exists po_credit_raised on purchase_orders;
create trigger po_credit_raised after insert or update of credit_for on purchase_orders for each row execute function public.po_credit_raised();
-- 077 (part 2): Alerts, permissions and tidy-ups (Oct 2026). Safe to re-run.

-- ── Portal error alerts: a DM to Taimoor on ClickUp, at most once per error every 6 hours ──────────────────
create table if not exists client_errors (
  id uuid primary key default gen_random_uuid(),
  sig text not null unique,
  message text, stack text, page text, version text, user_id uuid, user_name text, extra jsonb,
  count int not null default 1,
  first_at timestamptz not null default now(), last_at timestamptz not null default now(), alerted_at timestamptz
);
alter table client_errors enable row level security;
drop policy if exists "Admins read errors" on client_errors;
create policy "Admins read errors" on client_errors for select to authenticated using ((select public.is_admin()));

create or replace function public.report_client_error(p_message text, p_stack text, p_page text, p_version text, p_extra jsonb default '{}')
returns void language plpgsql security definer set search_path = public as $$
declare s text; e client_errors%rowtype; who text;
begin
  if not public.is_active_user() or coalesce(trim(p_message), '') = '' then return; end if;
  -- The same error (message, stripped of numbers and ids) is one row however often it happens
  s := md5(regexp_replace(left(p_message, 300), '[0-9a-f]{8}-[0-9a-f-]{27}|\d+', '#', 'g') || '|' || coalesce(p_page, ''));
  who := (select display_name from profiles where id = auth.uid());
  insert into client_errors (sig, message, stack, page, version, user_id, user_name, extra)
  values (s, left(p_message, 1000), left(p_stack, 4000), left(p_page, 200), left(p_version, 20), auth.uid(), who, coalesce(p_extra, '{}'))
  on conflict (sig) do update set count = client_errors.count + 1, last_at = now(), version = excluded.version,
    user_id = excluded.user_id, user_name = excluded.user_name, stack = coalesce(excluded.stack, client_errors.stack)
  returning * into e;
  if (e.alerted_at is null or e.alerted_at < now() - interval '6 hours')
     and (select count(*) from client_errors where alerted_at > now() - interval '1 day') < 30 then
    update client_errors set alerted_at = now() where id = e.id;
    perform public.queue_event('portal_error', jsonb_build_object('message', e.message, 'page', e.page, 'who', who,
      'version', e.version, 'count', e.count, 'first_at', e.first_at, 'stack', left(e.stack, 600)));
  end if;
end $$;
revoke all on function public.report_client_error(text, text, text, text, jsonb) from public, anon;
grant execute on function public.report_client_error(text, text, text, text, jsonb) to authenticated;

-- ── Negative stock: allowed, but the Warehouse Team hears about it ──────────────────────────────────────────
create or replace function public.inv_negative_alert() returns trigger language plpgsql security definer set search_path = public as $$
declare p inv_products%rowtype; m record;
begin
  if new.qty < 0 and (tg_op = 'INSERT' or coalesce(old.qty, 0) >= 0) then
    select * into p from inv_products where id = new.product_id;
    select by_name, kind, ref, note into m from inv_movements where product_id = new.product_id and location = new.location order by at desc limit 1;
    perform public.queue_event('stock_negative', jsonb_build_object('product', p.name, 'code', p.code, 'location', new.location,
      'qty', new.qty, 'by', m.by_name, 'kind', m.kind, 'ref', m.ref, 'product_id', p.id));
  end if;
  return new;
end $$;
drop trigger if exists inv_negative_alert on inv_balances;
create trigger inv_negative_alert after insert or update of qty on inv_balances for each row execute function public.inv_negative_alert();

insert into notification_rules (event, enabled, channel_name, channel_id) values
  ('portal_error', true, 'dm:Taimoor', null),
  ('db_check_failed', true, 'dm:Taimoor', null),
  ('stock_negative', true, 'Warehouse Team', '4-90154888970-8')
on conflict (event) do nothing;

-- ── Dispatch: anyone signed in can read; only people with a dispatch page can change labels ────────────────
create or replace function public.dispatch_writer() returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or public.can_open('dispatch') or public.can_open('dispatch-dashboard')
      or public.can_open('print-station') or public.can_open('order-audit')
$$;
revoke all on function public.dispatch_writer() from public, anon;
grant execute on function public.dispatch_writer() to authenticated;

do $$ declare t text; begin
  foreach t in array array['dispatch_labels', 'dispatch_batches', 'dispatch_uploads', 'dispatch_item_units', 'dispatch_mappings'] loop
    execute format('drop policy if exists "Signed-in users" on %I', t);
    execute format('drop policy if exists "Dispatch read" on %I', t);
    execute format('drop policy if exists "Dispatch write" on %I', t);
    execute format('create policy "Dispatch read" on %I for select to authenticated using ((select public.is_active_user()))', t);
    execute format('create policy "Dispatch write" on %I for all to authenticated using ((select public.dispatch_writer())) with check ((select public.dispatch_writer()))', t);
  end loop;
end $$;

-- Cancelling a label straight through the API needs the Cancel labels right (re-uploading a label replaces the old one)
create or replace function public.dispatch_cancel_guard() returns trigger language plpgsql set search_path = public as $$
begin
  if current_user = 'authenticated' and new.status = 'cancelled' and old.status is distinct from 'cancelled'
     and coalesce(new.hold_reason, '') not like 'Uploaded again in %' and not public.can_cancel_labels() then
    raise exception 'Only the office (or someone ticked Cancel labels) can cancel a label';
  end if;
  return new;
end $$;
drop trigger if exists dispatch_cancel_guard on dispatch_labels;
create trigger dispatch_cancel_guard before update of status on dispatch_labels for each row execute function public.dispatch_cancel_guard();

-- Stock requests: everyone can see them; the warehouse (Requests) and Purchasing change them
drop policy if exists "Signed-in users" on stock_requests;
drop policy if exists "Requests read" on stock_requests;
drop policy if exists "Requests write" on stock_requests;
create policy "Requests read" on stock_requests for select to authenticated using ((select public.is_active_user()));
create policy "Requests write" on stock_requests for all to authenticated
  using ((select public.can_open('requests') or public.sees_costs())) with check ((select public.can_open('requests') or public.sees_costs()));
drop policy if exists "Signed-in users" on stock_request_events;
drop policy if exists "Request events read" on stock_request_events;
drop policy if exists "Request events write" on stock_request_events;
create policy "Request events read" on stock_request_events for select to authenticated using ((select public.is_active_user()));
create policy "Request events write" on stock_request_events for insert to authenticated with check ((select public.can_open('requests') or public.sees_costs()));

-- ── Tidy-ups ───────────────────────────────────────────────────────────────────────────────────────────────
-- Nothing in the database can be called without signing in (now or for functions added later)
-- (whoever could call a function before — signed-in users, the server — still can; only "not signed in" loses it)
do $$ declare f record; auth_ok boolean; svc_ok boolean; begin
  for f in select p.oid, p.oid::regprocedure as sig from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
             and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e') loop
    auth_ok := has_function_privilege('authenticated', f.oid, 'execute');
    svc_ok := has_function_privilege('service_role', f.oid, 'execute');
    execute format('revoke execute on function %s from public, anon', f.sig);
    if auth_ok then execute format('grant execute on function %s to authenticated', f.sig); end if;
    if svc_ok then execute format('grant execute on function %s to service_role', f.sig); end if;
  end loop;
end $$;
alter default privileges in schema public revoke execute on functions from public, anon;
alter default privileges in schema public grant execute on functions to authenticated, service_role;

-- Fixed search paths
do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p where p.pronamespace = 'public'::regnamespace
             and p.proname in ('supplier_key', 'same_supplier', 'wd_add', 'wd_between', 'inv_movements_locked', 'touch_updated_at',
               'gi_line_done', 'supplier_catalogue_stats', 'inv_norm', 'inv_valid_location', 'helm_phase', 'next_working_day') loop
    execute format('alter function %s set search_path = public', f.sig);
  end loop;
end $$;

-- Profiles: same rule, checked once per query rather than per row
drop policy if exists "Change your own name" on profiles;
create policy "Change your own name" on profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid())
    and role = (select p.role from profiles p where p.id = (select auth.uid()))
    and permissions = (select p.permissions from profiles p where p.id = (select auth.uid()))
    and active = (select p.active from profiles p where p.id = (select auth.uid())));
-- 077 (part 3): Database self-test (Oct 2026). Safe to re-run.
-- public.db_selftest() runs every check and returns [{name, ok, detail}]. The scenario checks really do the work
-- (a PO saved, edited, swapped, cancelled; stock moved below zero) inside a step that's then undone — nothing is
-- kept. Admins run it from Settings; it also runs every morning at 6:15 and DMs Taimoor if anything fails.

create or replace function public.db_selftest() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  out jsonb := '[]'; prev_claims text; admin_id uuid; r jsonb; pid uuid; iid uuid; did uuid; prod uuid; n numeric; t text; ok boolean;
begin
  if auth.uid() is not null and not public.is_admin() then raise exception 'Only an admin can run the database checks'; end if;
  prev_claims := current_setting('request.jwt.claims', true);
  select id into admin_id from profiles where role = 'admin' and active order by created_at limit 1;

  -- ── Integrity: read-only checks on the live data ────────────────────────────────────────────────────────
  select count(*) into n from (select product_id, location, sum(qty) s from inv_movements group by 1, 2) m
    full join inv_balances b using (product_id, location) where coalesce(m.s, 0) <> coalesce(b.qty, 0);
  out := out || jsonb_build_object('name', 'Stock balances match their movements', 'ok', n = 0, 'detail', case when n > 0 then n || ' shelf balances differ' end);

  select count(*) into n from purchase_orders po where status in ('awaiting_delivery', 'partially_received', 'received')
    and exists (select 1 from purchase_order_items where po_id = po.id)
    and status <> (select case when sum(qty) > 0 and sum(least(coalesce(qty_received, 0), qty)) >= sum(qty) then 'received'
                    when bool_or(coalesce(qty_received, 0) > 0) then 'partially_received' else 'awaiting_delivery' end
                   from purchase_order_items i where i.po_id = po.id and coalesce(line_status, 'due') <> 'cancelled');
  out := out || jsonb_build_object('name', 'Order statuses match what’s been received', 'ok', n = 0, 'detail', case when n > 0 then n || ' orders out of step' end);

  select count(*) into n from goods_in_deliveries d, jsonb_array_elements(d.lines) l
    where d.put_away_at is null and nullif(l ->> 'po_item_id', '') is not null
      and not exists (select 1 from purchase_order_items i where i.id::text = l ->> 'po_item_id');
  out := out || jsonb_build_object('name', 'Goods In lines point at real order lines', 'ok', n = 0, 'detail', case when n > 0 then n || ' lines point at nothing' end);

  select count(*) into n from purchase_order_items i where exists (select 1 from goods_in_deliveries d where d.po_id = i.po_id)
    and coalesce(i.qty_received, 0) <> coalesce((select sum(coalesce((l ->> 'arrived')::numeric, (l ->> 'qty')::numeric, 0))
      from goods_in_deliveries d, jsonb_array_elements(d.lines) l where l ->> 'po_item_id' = i.id::text), 0);
  out := out || jsonb_build_object('name', 'Received on the order = booked in at Goods In', 'ok', n = 0, 'detail', case when n > 0 then n || ' order lines differ' end);

  select count(*) into n from notification_outbox where sent_at is null and attempts >= 5 and created_at > now() - interval '2 days';
  out := out || jsonb_build_object('name', 'ClickUp messages are going out', 'ok', n = 0, 'detail', case when n > 0 then n || ' messages failed 5 times' end);

  select string_agg(jobname, ', ') into t from cron.job where not active;
  out := out || jsonb_build_object('name', 'Scheduled jobs are all on', 'ok', t is null, 'detail', t);

  -- ── Scenarios, as an admin, each undone afterwards ─────────────────────────────────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);

  -- A. Saving and editing an order keeps a history, and never touches received quantities
  begin
    r := public.po_save(jsonb_build_object('po_number', 'SELFTEST-PO', 'supplier_name', 'Selftest', 'status', 'awaiting_delivery', 'category', 'stock', 'total', 10),
      jsonb_build_array(jsonb_build_object('name', 'Selftest A', 'qty', 5, 'unit_cost', 2)), 'Selftest');
    pid := (r ->> 'id')::uuid; iid := (r -> 'items' -> 0 ->> 'id')::uuid;
    r := public.po_save(jsonb_build_object('id', pid, 'total', 12),
      jsonb_build_array(jsonb_build_object('id', iid, 'name', 'Selftest A', 'qty', 6, 'unit_cost', 2, 'qty_received', 99)), 'Selftest');
    select detail into t from activity_log where entity_id::text = pid::text and action = 'Edited' order by at desc limit 1;
    ok := t like '%qty 5 → 6%' and t like '%Total: £10.00 → £12.00%';
    out := out || jsonb_build_object('name', 'Editing an order records what changed', 'ok', ok, 'detail', case when not ok then coalesce(t, 'nothing logged') end);
    select qty_received into n from purchase_order_items where id = iid;
    out := out || jsonb_build_object('name', 'Received quantities only come from Goods In', 'ok', n = 0, 'detail', case when n <> 0 then 'po_save changed it to ' || n end);
    raise exception 'SELFTEST_UNDO';
  exception when others then
    if sqlerrm <> 'SELFTEST_UNDO' then out := out || jsonb_build_object('name', 'Order save and history', 'ok', false, 'detail', sqlerrm); end if;
  end;

  -- B. Cancelling needs a reason; a paid order waits for its credit note, which clears it
  begin
    r := public.po_save(jsonb_build_object('po_number', 'SELFTEST-PO', 'supplier_name', 'Selftest', 'status', 'awaiting_delivery', 'payment_status', 'paid', 'total', 10),
      jsonb_build_array(jsonb_build_object('name', 'Selftest A', 'qty', 1, 'unit_cost', 10)), 'Selftest');
    pid := (r ->> 'id')::uuid;
    ok := false;
    begin update purchase_orders set status = 'cancelled' where id = pid; exception when others then ok := sqlerrm like '%why%'; end;
    out := out || jsonb_build_object('name', 'An order can’t be cancelled without a reason', 'ok', ok);
    perform public.po_cancel(pid, 'Selftest', 'Selftest');
    select (data ->> 'creditAwaited')::boolean into ok from purchase_orders where id = pid;
    out := out || jsonb_build_object('name', 'Cancelling a paid order flags “Credit note awaited”', 'ok', coalesce(ok, false));
    insert into purchase_orders (po_number, kind, credit_for, status, supplier_name) values ('SELFTEST-CN', 'credit_note', pid, 'draft', 'Selftest');
    select coalesce((data ->> 'creditAwaited')::boolean, false) into ok from purchase_orders where id = pid;
    out := out || jsonb_build_object('name', 'Raising the credit note clears it', 'ok', not ok);
    raise exception 'SELFTEST_UNDO';
  exception when others then
    if sqlerrm <> 'SELFTEST_UNDO' then out := out || jsonb_build_object('name', 'Cancelling orders', 'ok', false, 'detail', sqlerrm); end if;
  end;

  -- C. A product swapped on the PO after booking in follows into Goods In, and put-away waits for the count
  begin
    r := public.po_save(jsonb_build_object('po_number', 'SELFTEST-PO', 'supplier_name', 'Selftest', 'status', 'awaiting_delivery', 'total', 10),
      jsonb_build_array(jsonb_build_object('name', 'Selftest wrong', 'qty', 10, 'unit_cost', 1)), 'Selftest');
    pid := (r ->> 'id')::uuid; iid := (r -> 'items' -> 0 ->> 'id')::uuid;
    insert into goods_in_deliveries (ref, po_id, kind, supplier_name, received_by, lines, data)
    values ('GI-SELFTEST', pid, 'order', 'Selftest', 'Selftest',
      jsonb_build_array(jsonb_build_object('po_item_id', iid, 'name', 'Selftest wrong', 'arrived', 10, 'expected', 10)), '{}')
    returning id into did;
    update purchase_order_items set qty_received = 10 where id = iid;
    r := public.po_save(jsonb_build_object('id', pid), jsonb_build_array(jsonb_build_object('name', 'Selftest right', 'qty', 10, 'unit_cost', 1)), 'Selftest');
    select (lines -> 0 ->> 'name') = 'Selftest right' and (lines -> 0 ->> 'check_qty')::boolean into ok from goods_in_deliveries where id = did;
    out := out || jsonb_build_object('name', 'A product swapped on the PO follows into Goods In', 'ok', coalesce(ok, false));
    select qty_received into n from purchase_order_items where po_id = pid;
    out := out || jsonb_build_object('name', '…and its received count moves with it', 'ok', n = 10);
    ok := false;
    begin
      update goods_in_deliveries set data = jsonb_set(data, '{put_done}', '{"Selftest right": 5}') where id = did;
    exception when others then ok := sqlerrm like '%check the quantity%';
    end;
    out := out || jsonb_build_object('name', '…and can’t be put away until the count is checked', 'ok', ok);
    raise exception 'SELFTEST_UNDO';
  exception when others then
    if sqlerrm <> 'SELFTEST_UNDO' then out := out || jsonb_build_object('name', 'Goods In follows the PO', 'ok', false, 'detail', sqlerrm); end if;
  end;

  -- D. Stock movements keep shelf balances, and going below zero alerts the warehouse
  begin
    insert into inv_products (code, name, status, kind, in_helm) values ('SELFTEST-SKU', 'Selftest product', 'live', 'product', false) returning id into prod;
    perform public.inv_adjust(prod, 'H-10-7-4', 5, 'Selftest', null, 'Selftest', true);
    select qty into n from inv_balances where product_id = prod and location = 'H-10-7-4';
    out := out || jsonb_build_object('name', 'Adding stock updates the shelf balance', 'ok', n = 5);
    perform public.inv_adjust(prod, 'H-10-7-4', -7, 'Selftest', null, 'Selftest', true);
    select qty into n from inv_balances where product_id = prod and location = 'H-10-7-4';
    out := out || jsonb_build_object('name', 'Stock can go below zero', 'ok', n = -2);
    if exists (select 1 from notification_rules where event = 'stock_negative' and enabled) and exists (select 1 from vault.secrets where name = 'clickup_token') then
      select exists (select 1 from notification_outbox where event = 'stock_negative' and payload ->> 'product_id' = prod::text) into ok;
      out := out || jsonb_build_object('name', '…and the Warehouse Team is told', 'ok', ok);
    end if;
    raise exception 'SELFTEST_UNDO';
  exception when others then
    if sqlerrm <> 'SELFTEST_UNDO' then out := out || jsonb_build_object('name', 'Stock movements', 'ok', false, 'detail', sqlerrm); end if;
  end;

  -- E. Permissions: the warehouse never sees costs
  out := out || jsonb_build_object('name', 'Only Purchasing sees costs (database rule)', 'ok',
    position('purchases' in pg_get_functiondef('public.sees_costs()'::regprocedure)) > 0);
  select string_agg(display_name, ', ') into t from profiles p where active and role <> 'admin'
    and not (permissions ?| array['purchases', 'payments', 'issues'])
    and exists (select 1 from jsonb_array_elements_text(permissions) x where x in ('calculator', 'saved', 'live', 'stock', 'suppliers', 'hunter'));
  out := out || jsonb_build_object('name', 'Nobody has cost pages without Purchasing', 'ok', t is null, 'detail', t);

  perform set_config('request.jwt.claims', coalesce(prev_claims, ''), true);
  return out;
end $$;
revoke all on function public.db_selftest() from public, anon;
grant execute on function public.db_selftest() to authenticated;

-- Every morning: run it, and DM Taimoor only if something failed
create or replace function public.db_selftest_daily() returns void language plpgsql security definer set search_path = public as $$
declare r jsonb; bad jsonb;
begin
  r := public.db_selftest();
  select jsonb_agg(x) into bad from jsonb_array_elements(r) x where not (x ->> 'ok')::boolean;
  if bad is not null then perform public.queue_event('db_check_failed', jsonb_build_object('failed', bad, 'total', jsonb_array_length(r))); end if;
end $$;
revoke all on function public.db_selftest_daily() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'db-selftest';
select cron.schedule('db-selftest', '15 6 * * *', 'select public.db_selftest_daily()');

-- Data: PO-HI-20261023-007 was cancelled by mistake after booking in; restored to received (28-10-2026).
-- ClickUp: portal_error and db_check_failed go to a direct message (channel_name 'dm:Taimoor'); the notify
-- function finds the DM the first time and keeps its id.
