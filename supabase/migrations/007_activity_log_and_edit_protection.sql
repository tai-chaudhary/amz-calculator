-- Who did what, to what, and when — one trail for every kind of change
create table if not exists activity_log (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  user_name text,
  entity_type text not null,
  entity_id text,
  entity_name text,
  action text not null,
  detail text,
  before jsonb,
  after jsonb,
  source text
);
create index if not exists activity_log_entity_idx on activity_log(entity_type, entity_id);
create index if not exists activity_log_at_idx on activity_log(at desc);
alter table activity_log enable row level security;
create policy "Allow all on activity_log" on activity_log for all using (true) with check (true);

-- Every save stamps the time itself, so an edit based on an older copy can be caught
alter table stock_items add column if not exists updated_at timestamptz default now();
update stock_items set updated_at = created_at where updated_at is null;

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists touch_saved_products on saved_products;
create trigger touch_saved_products before update on saved_products for each row execute function touch_updated_at();
drop trigger if exists touch_stock_items on stock_items;
create trigger touch_stock_items before update on stock_items for each row execute function touch_updated_at();
drop trigger if exists touch_settings on settings;
create trigger touch_settings before update on settings for each row execute function touch_updated_at();
