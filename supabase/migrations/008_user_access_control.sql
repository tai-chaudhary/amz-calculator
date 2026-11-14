-- Who can use the portal, and what of it.
alter table profiles add column if not exists permissions jsonb not null default '[]'::jsonb;
alter table profiles add column if not exists active boolean not null default true;
alter table profiles add column if not exists email text;
alter table profiles add column if not exists created_by uuid;
alter table profiles add column if not exists updated_at timestamptz default now();

insert into profiles (id, display_name, role, permissions, email)
select u.id, coalesce(split_part(u.email, '@', 1), 'User'), 'member', '[]'::jsonb, u.email
from auth.users u where not exists (select 1 from profiles p where p.id = u.id);
update profiles p set email = u.email from auth.users u where u.id = p.id and p.email is distinct from u.email;

drop trigger if exists touch_profiles on profiles;
create trigger touch_profiles before update on profiles for each row execute function touch_updated_at();

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin' and active)
$$;
grant execute on function public.is_admin() to authenticated, anon;

create or replace function public.is_active_user() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and active)
$$;
grant execute on function public.is_active_user() to authenticated, anon;

-- Lock the data to signed-in people (previously open to the public browser key)
do $$
declare t text;
begin
  foreach t in array array[
    'saved_products','months','recycle_bin','inventory','live_products','price_history','cost_history',
    'stock_items','suppliers','supplier_products','price_list_imports','proposed_changes',
    'market_listings','asin_matches','hunts','hunt_items','activity_log'
  ] loop
    execute format('drop policy if exists "Allow all on %s" on %I', t, t);
    execute format('drop policy if exists "Allow all" on %I', t);
    execute format('drop policy if exists "Signed-in users" on %I', t);
    execute format($p$create policy "Signed-in users" on %I for all to authenticated
                     using (public.is_active_user()) with check (public.is_active_user())$p$, t);
  end loop;
end $$;

drop policy if exists "Allow all on settings" on settings;
drop policy if exists "Read settings" on settings;
drop policy if exists "Admins change settings" on settings;
create policy "Read settings" on settings for select to authenticated using (public.is_active_user());
create policy "Admins change settings" on settings for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Allow all on profiles" on profiles;
drop policy if exists "Read profiles" on profiles;
drop policy if exists "Admins manage profiles" on profiles;
drop policy if exists "Change your own name" on profiles;
create policy "Read profiles" on profiles for select to authenticated using (true);
create policy "Admins manage profiles" on profiles for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "Change your own name" on profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid() and role = (select role from profiles where id = auth.uid())
    and permissions = (select permissions from profiles where id = auth.uid())
    and active = (select active from profiles where id = auth.uid()));

drop policy if exists "Read sync_state" on sync_state;
drop policy if exists "Read sync_runs" on sync_runs;
create policy "Read sync_state" on sync_state for select to authenticated using (public.is_active_user());
create policy "Read sync_runs" on sync_runs for select to authenticated using (public.is_active_user());
