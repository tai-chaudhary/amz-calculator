-- ── ClickUp messages ─────────────────────────────────────────────────────────
-- Things that happen in the portal post a message to a ClickUp channel. Events
-- are queued here (by the database itself, or by the portal for things like a
-- batch upload), and the "notify" function sends them. The ClickUp token is
-- kept in the vault: it can be set by an admin but never read back by anyone.

-- The key the database uses to call the notify function
select vault.create_secret(encode(gen_random_bytes(24), 'hex'), 'notify_key', 'Authorises the database to send ClickUp messages')
where not exists (select 1 from vault.secrets where name = 'notify_key');

create or replace function public.notify_key() returns text
language sql security definer set search_path = public, vault as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'notify_key' limit 1
$$;
revoke all on function public.notify_key() from public, anon, authenticated;
grant execute on function public.notify_key() to service_role;

create or replace function public.clickup_token() returns text
language sql security definer set search_path = public, vault as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'clickup_token' limit 1
$$;
revoke all on function public.clickup_token() from public, anon, authenticated;
grant execute on function public.clickup_token() to service_role;

-- Admins set (or clear) the token; nobody can read it back
create or replace function public.set_clickup_token(p_token text) returns boolean
language plpgsql security definer set search_path = public, vault as $$
declare sid uuid;
begin
  if not public.is_admin() then raise exception 'Only an admin can connect ClickUp'; end if;
  select id into sid from vault.secrets where name = 'clickup_token';
  if coalesce(trim(p_token), '') = '' then
    if sid is not null then delete from vault.secrets where id = sid; end if;
    return false;
  end if;
  if sid is null then perform vault.create_secret(trim(p_token), 'clickup_token', 'ClickUp API token for portal messages');
  else perform vault.update_secret(sid, trim(p_token)); end if;
  return true;
end $$;
grant execute on function public.set_clickup_token(text) to authenticated;

create or replace function public.clickup_connected() returns boolean
language sql security definer set search_path = public, vault as $$
  select public.is_admin() and exists (select 1 from vault.secrets where name = 'clickup_token')
$$;
grant execute on function public.clickup_connected() to authenticated;

-- Which events go where
create table if not exists notification_rules (
  event text primary key,
  enabled boolean not null default true,
  channel_id text, channel_name text,
  updated_at timestamptz default now(), updated_by text
);
alter table notification_rules enable row level security;
drop policy if exists "Admins manage notification rules" on notification_rules;
create policy "Admins manage notification rules" on notification_rules for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

insert into notification_rules (event, channel_name) values
  ('batch_uploaded', 'Warehouse Team'),
  ('day_closed', 'Warehouse Team'),
  ('request_raised', 'General - Adrian Marsh'),
  ('request_ordered', 'Warehouse Team'),
  ('request_declined', 'Warehouse Team'),
  ('delivery_confirmed', 'Warehouse Team'),
  ('delivery_booked', 'Warehouse Team'),
  ('goods_in_problem', 'General - Adrian Marsh'),
  ('unexpected_delivery', 'General - Adrian Marsh')
on conflict (event) do nothing;

-- What's waiting to go, and what went
create table if not exists notification_outbox (
  id uuid primary key default gen_random_uuid(),
  event text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz default now(),
  sent_at timestamptz, attempts integer not null default 0, error text, channel_name text, message text
);
create index if not exists notification_outbox_pending_idx on notification_outbox(created_at) where sent_at is null;
alter table notification_outbox enable row level security;
drop policy if exists "Admins read the outbox" on notification_outbox;
create policy "Admins read the outbox" on notification_outbox for select to authenticated using (public.is_admin());

-- Send as soon as it's queued
create or replace function public.notify_send_now() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform net.http_post(
    url := 'https://amuqewxxvlggtsyzbyry.supabase.co/functions/v1/notify',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-notify-key', public.notify_key()),
    body := jsonb_build_object('id', new.id),
    timeout_milliseconds := 20000);
  return new;
exception when others then
  return new;   -- the retry job picks it up
end $$;
drop trigger if exists notify_send_now on notification_outbox;
create trigger notify_send_now after insert on notification_outbox for each row execute function public.notify_send_now();

-- Queue an event, if it's switched on
create or replace function public.queue_event(p_event text, p_payload jsonb) returns void
language plpgsql security definer set search_path = public, vault as $$
begin
  if exists (select 1 from notification_rules where event = p_event and enabled)
     and exists (select 1 from vault.secrets where name = 'clickup_token') then
    insert into notification_outbox (event, payload) values (p_event, coalesce(p_payload, '{}'::jsonb));
  end if;
exception when others then
  null;   -- a message must never stop the work it's about
end $$;
revoke all on function public.queue_event(text, jsonb) from public, anon, authenticated;

-- The portal queues the events the database can't see whole (an upload, closing the day)
create or replace function public.queue_notification(p_event text, p_payload jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_active_user() then return; end if;
  if p_event not in ('batch_uploaded', 'day_closed') then return; end if;
  perform public.queue_event(p_event, p_payload || jsonb_build_object('by', coalesce(p_payload ->> 'by',
    (select display_name from profiles where id = auth.uid()))));
end $$;
grant execute on function public.queue_notification(text, jsonb) to authenticated;

-- ── Events the database raises itself ──

create or replace function public.notify_stock_request() returns trigger
language plpgsql security definer set search_path = public as $$
declare po purchase_orders%rowtype; it purchase_order_items%rowtype;
begin
  if tg_op = 'INSERT' then
    perform public.queue_event('request_raised', jsonb_build_object(
      'id', new.id, 'ref', new.ref, 'product', new.product_name, 'qty', new.qty_requested,
      'urgency', new.urgency, 'by', new.raised_by, 'note', new.note, 'in_products', new.stock_item_id is not null));
  elsif new.status = 'declined' and old.status is distinct from 'declined' then
    perform public.queue_event('request_declined', jsonb_build_object(
      'id', new.id, 'ref', new.ref, 'product', new.product_name, 'reason', new.status_reason, 'by', new.raised_by));
  elsif new.po_id is not null and new.po_id is distinct from old.po_id then
    select * into po from purchase_orders where id = new.po_id;
    select * into it from purchase_order_items where id = new.po_item_id;
    perform public.queue_event('request_ordered', jsonb_build_object(
      'id', new.id, 'ref', new.ref, 'product', new.product_name, 'by', new.raised_by,
      'po_number', po.po_number, 'supplier', po.supplier_name, 'qty', it.qty,
      'po_status', po.status, 'delivery_date', po.delivery_date));
  end if;
  return new;
end $$;
drop trigger if exists notify_stock_request on stock_requests;
create trigger notify_stock_request after insert or update on stock_requests for each row execute function public.notify_stock_request();

create or replace function public.notify_delivery_date() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.delivery_date is not null and new.delivery_date is distinct from old.delivery_date
     and coalesce(new.kind, 'order') <> 'credit_note' and coalesce(new.category, 'stock') in ('stock', 'packaging') then
    perform public.queue_event('delivery_confirmed', jsonb_build_object(
      'po_id', new.id, 'po_number', new.po_number, 'supplier', new.supplier_name,
      'date', new.delivery_date, 'was', old.delivery_date, 'note', new.delivery_note, 'by', new.delivery_confirmed_by,
      'lines', coalesce((select jsonb_agg(jsonb_build_object('name', i.name, 'qty', i.qty) order by i.created_at)
                         from purchase_order_items i where i.po_id = new.id and coalesce(i.line_status, 'due') <> 'cancelled'), '[]'::jsonb)));
  end if;
  return new;
end $$;
drop trigger if exists notify_delivery_date on purchase_orders;
create trigger notify_delivery_date after update of delivery_date on purchase_orders for each row execute function public.notify_delivery_date();

create or replace function public.notify_goods_in() returns trigger
language plpgsql security definer set search_path = public as $$
declare base jsonb;
begin
  base := jsonb_build_object('id', new.id, 'ref', new.ref, 'po_number', new.data ->> 'po_number', 'supplier', new.supplier_name,
    'by', new.received_by, 'lines', new.lines, 'cartons', new.cartons, 'pallets', new.pallets,
    'signed_unchecked', new.signed_unchecked, 'problems', new.has_problems, 'note', new.data ->> 'note');
  if new.kind = 'unexpected' then
    perform public.queue_event('unexpected_delivery', base);
  else
    perform public.queue_event('delivery_booked', base);
    if new.has_problems then perform public.queue_event('goods_in_problem', base); end if;
  end if;
  return new;
end $$;
drop trigger if exists notify_goods_in on goods_in_deliveries;
create trigger notify_goods_in after insert on goods_in_deliveries for each row execute function public.notify_goods_in();

-- Anything that didn't go first time is tried again every 5 minutes (up to 5 tries)
select cron.unschedule('notify-retry') where exists (select 1 from cron.job where jobname = 'notify-retry');
select cron.schedule('notify-retry', '*/5 * * * *', $cron$
  select net.http_post(
    url := 'https://amuqewxxvlggtsyzbyry.supabase.co/functions/v1/notify',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-notify-key', public.notify_key()),
    body := '{"retry":true}'::jsonb,
    timeout_milliseconds := 60000)
  where exists (select 1 from public.notification_outbox where sent_at is null and attempts < 5)
$cron$);
