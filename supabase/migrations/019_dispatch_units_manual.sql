-- What each HELM item code really is: the base product and how many of it.
-- "SANMEX-…-3PK" is 3 of Sanmex Fly & Wasp Killer 300ml. Guessed from the
-- code and name when an item first turns up, confirmed once by a person,
-- and from then on every order's units are exact — past uploads included.
create table if not exists dispatch_item_units (
  code_key text primary key,             -- the item code, normalised
  code text not null,
  name text,
  base_product text not null,
  units int not null default 1 check (units > 0),
  confirmed boolean not null default false,
  updated_by_name text,
  updated_at timestamptz not null default now()
);
alter table dispatch_item_units enable row level security;
drop policy if exists "Signed-in users" on dispatch_item_units;
create policy "Signed-in users" on dispatch_item_units for all to authenticated
  using (public.is_active_user()) with check (public.is_active_user());

-- Labels made by hand, with no packing slip: why they're going out
alter table dispatch_labels add column if not exists reason text;        -- replacement, manual, other (empty: a normal order)
alter table dispatch_labels add column if not exists note text;
alter table dispatch_labels add column if not exists original_ref text;  -- the order a replacement is for
create index if not exists dispatch_labels_postcode_idx on dispatch_labels(postcode);
