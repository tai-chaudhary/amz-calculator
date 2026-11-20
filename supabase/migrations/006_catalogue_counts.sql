-- Catalogue size per supplier, without downloading the catalogue
create or replace function public.supplier_catalogue_stats()
returns table (supplier_id uuid, products bigint, with_barcode bigint, latest_list date, last_updated timestamptz)
language sql stable as $$
  select supplier_id, count(*), count(barcode), max(list_date), max(updated_at)
  from supplier_products group by supplier_id
$$;
grant execute on function public.supplier_catalogue_stats() to anon, authenticated;

-- Brand lookups for the product hunter search product names
create index if not exists supplier_products_name_lower_idx on supplier_products (lower(name));
