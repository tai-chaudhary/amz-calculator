-- Delivery tracking: every parcel HELM booked in the last 30 days, with the
-- courier's status and history, refreshed every half hour by the helm-tracking
-- edge function. Read only towards HELM. No customer details are stored.
--
-- Parcels go Next Day, so one not delivered within 2 working days (Sunday off)
-- is a red flag for account health. The page works that out from shipped_at.
-- Safe to re-run.

create table if not exists public.helm_parcels (
  id bigint primary key,                 -- HELM parcel id
  shipment_id bigint not null,
  order_id bigint,                       -- HELM order id (helm_orders.id)
  order_ref text,                        -- marketplace order number
  channel text,
  items jsonb,                           -- [{code, qty, name}] as ordered
  carrier text,
  service text,
  shipment_status integer,
  parcel_no integer,
  parcels integer,                       -- parcels on the shipment
  tracking text,
  tracking_url text,                     -- the courier's tracking page
  status integer,                        -- HELM tracking status (1 booked … 7 delivered, 10 returned …)
  shipped_at timestamptz,                -- label booked
  expected_at timestamptz,
  collected_at timestamptz,
  delivered_at timestamptz,
  problem_at timestamptz,                -- first failed attempt, hold, address issue or return
  returned_at timestamptz,
  last_event_at timestamptz,
  last_event text,
  events jsonb,                          -- [{s: status, at, d: courier message, cleaned}]
  synced_at timestamptz not null default now()
);
create index if not exists helm_parcels_shipped_idx on public.helm_parcels(shipped_at);
create index if not exists helm_parcels_order_idx on public.helm_parcels(order_id);
create index if not exists helm_parcels_tracking_idx on public.helm_parcels(tracking);

alter table public.helm_parcels enable row level security;
drop policy if exists "Read parcels" on public.helm_parcels;
create policy "Read parcels" on public.helm_parcels for select to authenticated
  using ((select public.can_open('tracking')));
-- Written only by the edge function (service role)

create table if not exists public.helm_tracking_sync (
  id integer primary key default 1 check (id = 1),
  last_run timestamptz,
  last_ok timestamptz,
  last_error text,
  parcels integer
);
alter table public.helm_tracking_sync enable row level security;
drop policy if exists "Read tracking sync" on public.helm_tracking_sync;
create policy "Read tracking sync" on public.helm_tracking_sync for select to authenticated
  using ((select public.can_open('tracking')));

-- Every half hour (HELM's couriers update a few times a day)
select cron.unschedule('helm-tracking') where exists (select 1 from cron.job where jobname = 'helm-tracking');
select cron.schedule('helm-tracking', '7,37 * * * *', $$
  select net.http_post(
    url := 'https://amuqewxxvlggtsyzbyry.supabase.co/functions/v1/helm-tracking',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-notify-key', public.notify_key()),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000)
$$);

-- Delivery tracking shows no costs: it's a warehouse section like the others
create or replace function public.sees_costs()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select exists (
    select 1 from profiles
    where id = auth.uid() and active
      and (role = 'admin' or exists (
        select 1 from jsonb_array_elements_text(permissions) p
        where p not in ('dispatch', 'dispatch-dashboard', 'requests', 'goods-in', 'inventory', 'tasks', 'tracking')))
  )
$function$;
