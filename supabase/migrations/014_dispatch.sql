-- Dispatch: shipping labels uploaded from HELM, sorted into batches by what
-- goes in each parcel, printed with the product stamped on every label.
-- Every label is its own row so printing, dispatch and reprints are tracked
-- per parcel; a batch's state is worked out from its labels.

-- What each order's packing slip turns into: the short name stamped on the
-- label, what goes in each parcel, and how many labels an order should have.
create table if not exists dispatch_mappings (
  id uuid primary key default gen_random_uuid(),
  item_key text not null unique,            -- item codes and quantities, normalised
  items jsonb not null default '[]',        -- [{ code, qty, name }] as read from the slip
  label_name text not null,                 -- stamped on every label, kept short
  contents text,                            -- what goes in each parcel, for the cover page
  parcels int not null default 1 check (parcels > 0),
  updated_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Every file uploaded, kept for good
create table if not exists dispatch_uploads (
  id uuid primary key default gen_random_uuid(),
  file_name text,
  storage_path text not null,
  pages int, orders int, labels int, held int,
  uploaded_by uuid, uploaded_by_name text,
  created_at timestamptz not null default now()
);

create table if not exists dispatch_batches (
  id uuid primary key default gen_random_uuid(),
  upload_id uuid references dispatch_uploads(id) on delete cascade,
  code text not null,                       -- B1, B2… per day, stamped on the labels
  ship_date date not null default (now() at time zone 'Europe/London')::date,
  label_name text not null,
  contents text,
  carrier text, service text,
  label_count int not null default 0,
  order_count int not null default 0,
  printed_at timestamptz, printed_by_name text,
  print_count int not null default 0,
  created_at timestamptz not null default now(),
  unique (ship_date, code)
);

create table if not exists dispatch_labels (
  id uuid primary key default gen_random_uuid(),
  upload_id uuid references dispatch_uploads(id) on delete cascade,
  batch_id uuid references dispatch_batches(id) on delete set null,
  seq int,                                  -- its number in the batch: 7 of 23
  page_index int not null,                  -- page in the uploaded file, from 0
  order_key text,                           -- groups the labels of one order
  channel_ref text, helm_order text, slip_id text, label_ref text,
  carrier text, service text, tracking text,
  customer text, postcode text,
  items jsonb not null default '[]',
  label_name text,
  stamp jsonb not null default '{}',        -- where the stamp goes on this label
  status text not null default 'ready',     -- ready, held, dispatched, cancelled
  hold_reason text,
  printed_at timestamptz, printed_by_name text,
  dispatched_at timestamptz, dispatched_by_name text,
  created_at timestamptz not null default now()
);
create index if not exists dispatch_labels_batch_idx on dispatch_labels(batch_id, seq);
create index if not exists dispatch_labels_status_idx on dispatch_labels(status);
create index if not exists dispatch_labels_created_idx on dispatch_labels(created_at desc);
create index if not exists dispatch_labels_refs_idx on dispatch_labels(channel_ref, helm_order, postcode);
create index if not exists dispatch_batches_date_idx on dispatch_batches(ship_date desc);

do $$
declare t text;
begin
  foreach t in array array['dispatch_mappings','dispatch_uploads','dispatch_batches','dispatch_labels'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "Signed-in users" on %I', t);
    execute format($p$create policy "Signed-in users" on %I for all to authenticated
                     using (public.is_active_user()) with check (public.is_active_user())$p$, t);
  end loop;
end $$;

-- The next free batch code for a day: B1, B2…
create or replace function public.next_dispatch_batch_codes(d date, how_many int)
returns text[] language plpgsql security definer set search_path = public as $$
declare n int; result text[] := '{}';
begin
  perform pg_advisory_xact_lock(hashtext('dispatch_batch_codes' || d::text));
  select coalesce(max(nullif(regexp_replace(code, '\D', '', 'g'), '')::int), 0) into n
    from dispatch_batches where ship_date = d;
  for i in 1..how_many loop result := result || ('B' || (n + i)); end loop;
  return result;
end $$;
grant execute on function public.next_dispatch_batch_codes(date, int) to authenticated;

-- The uploaded files, private, read through short-lived links
insert into storage.buckets (id, name, public) values ('dispatch-labels', 'dispatch-labels', false)
  on conflict (id) do nothing;
drop policy if exists "Staff read dispatch labels" on storage.objects;
create policy "Staff read dispatch labels" on storage.objects for select to authenticated
  using (bucket_id = 'dispatch-labels' and public.is_active_user());
drop policy if exists "Staff upload dispatch labels" on storage.objects;
create policy "Staff upload dispatch labels" on storage.objects for insert to authenticated
  with check (bucket_id = 'dispatch-labels' and public.is_active_user());
