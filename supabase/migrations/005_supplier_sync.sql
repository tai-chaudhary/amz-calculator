create extension if not exists pg_net;
create extension if not exists pg_cron;

-- Where each supplier's sync has got to, so a long catalogue can be read over several runs
create table if not exists sync_state (
  supplier_id uuid primary key references suppliers(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now()
);

-- One row per completed or failed pass, for the portal to show
create table if not exists sync_runs (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid references suppliers(id) on delete cascade,
  status text not null,
  stats jsonb not null default '{}'::jsonb,
  error text,
  started_at timestamptz default now(),
  finished_at timestamptz
);

alter table sync_state enable row level security;
alter table sync_runs enable row level security;
create policy "Read sync_state" on sync_state for select using (true);
create policy "Read sync_runs" on sync_runs for select using (true);

-- A private key the scheduler uses to call the sync job
select vault.create_secret(encode(gen_random_bytes(24), 'hex'), 'supplier_sync_key', 'Authorises scheduled supplier catalogue syncs')
where not exists (select 1 from vault.secrets where name = 'supplier_sync_key');

create or replace function public.supplier_sync_key() returns text
language sql security definer set search_path = public, vault as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'supplier_sync_key' limit 1
$$;
revoke all on function public.supplier_sync_key() from public, anon, authenticated;
grant execute on function public.supplier_sync_key() to service_role;

-- Which suppliers are read, and how their prices are interpreted
update suppliers set data = data || '{"sync":{"kind":"shopify","base":"https://www.mxwholesale.co.uk","nightlyPages":80,"pricesIncludeVat":true}}'::jsonb where name = 'MX Wholesale';
update suppliers set data = data || '{"sync":{"kind":"shopify","base":"https://www.jdcateringequip.co.uk","nightlyPages":110,"pricesIncludeVat":false}}'::jsonb where name = 'JD Catering';
-- Pound Wholesale's site uses bot protection, so it can't be read automatically
update suppliers set data = (data - 'sync') || '{"syncBlocked":"Site uses bot protection (Sucuri) — automated reading not possible. Ask Pound for a price file."}'::jsonb where name = 'Pound Wholesale';

-- Every 3 minutes between midnight and 6am, until each supplier is done for the night
select cron.schedule('supplier-catalogue-sync', '*/3 0-5 * * *', $cron$
  select net.http_post(
    url := 'https://amuqewxxvlggtsyzbyry.supabase.co/functions/v1/supplier-sync',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-key', public.supplier_sync_key()),
    body := '{}'::jsonb,
    timeout_milliseconds := 90000)
$cron$);
