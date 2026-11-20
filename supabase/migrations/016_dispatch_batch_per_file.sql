-- A batch is one uploaded file — one HELM pick list. Every label in it shares
-- the batch number (B1, B2… per day), however many products it's split into.
-- dispatch_batches now holds the product groups inside a batch, each carrying
-- its batch's code.
alter table dispatch_uploads add column if not exists code text;
alter table dispatch_uploads add column if not exists ship_date date;
alter table dispatch_uploads add column if not exists picker text;      -- who's picking and packing it
alter table dispatch_uploads add column if not exists title text;       -- e.g. the pick list's name in HELM

-- Number the files already uploaded, in the order they came in each day
with numbered as (
  select id, (created_at at time zone 'Europe/London')::date as d,
         row_number() over (partition by (created_at at time zone 'Europe/London')::date order by created_at) as n
  from dispatch_uploads where code is null
)
update dispatch_uploads u set code = 'B' || numbered.n, ship_date = numbered.d
  from numbered where u.id = numbered.id;
alter table dispatch_uploads alter column ship_date set default (now() at time zone 'Europe/London')::date;
create unique index if not exists dispatch_uploads_day_code_key on dispatch_uploads(ship_date, code);

-- Product groups take their file's number, so several share one code
alter table dispatch_batches drop constraint if exists dispatch_batches_ship_date_code_key;
update dispatch_batches b set code = u.code from dispatch_uploads u where b.upload_id = u.id and u.code is not null;
create index if not exists dispatch_batches_upload_idx on dispatch_batches(upload_id);

create or replace function public.next_dispatch_upload_code(d date)
returns text language plpgsql security definer set search_path = public as $$
declare n int;
begin
  select coalesce(max(nullif(regexp_replace(code, '\D', '', 'g'), '')::int), 0) into n
    from dispatch_uploads where ship_date = d;
  return 'B' || (n + 1);
end $$;
grant execute on function public.next_dispatch_upload_code(date) to authenticated;
