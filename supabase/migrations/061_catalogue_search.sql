-- 061: Search the supplier price lists from a purchase order (Oct 2026). Every word must appear (in the name or
-- the brand), or it's the exact supplier SKU or barcode; if nothing has every word, the ones with most of them.
-- Trigram index keeps it quick across ~50,000 lines. Security invoker: supplier_products' own read rules apply.
create extension if not exists pg_trgm with schema extensions;
create index if not exists supplier_products_search_trgm on supplier_products
  using gin ((lower(coalesce(data->>'brand', '') || ' ' || name)) extensions.gin_trgm_ops);
create or replace function public.catalogue_search(p_q text, p_supplier uuid default null, p_limit int default 60)
returns table(id uuid, supplier_id uuid, supplier_name text, supplier_sku text, barcode text, name text, unit_cost numeric, data jsonb, list_date date, exact boolean)
language plpgsql stable security invoker set search_path = public, extensions as $$
declare words text[]; q text := trim(coalesce(p_q, ''));
begin
  if length(q) < 2 then return; end if;
  words := array(select '%' || w || '%' from regexp_split_to_table(lower(q), '\s+') w where length(w) > 0);
  return query
    select sp.id, sp.supplier_id, s.name, sp.supplier_sku, sp.barcode, sp.name, sp.unit_cost, sp.data, sp.list_date::date,
           (lower(sp.supplier_sku) = lower(q) or sp.barcode = q) as exact
    from supplier_products sp left join suppliers s on s.id = sp.supplier_id
    where (p_supplier is null or sp.supplier_id = p_supplier)
      and (lower(coalesce(sp.data->>'brand', '') || ' ' || sp.name) like all (words) or lower(sp.supplier_sku) = lower(q) or sp.barcode = q)
    order by (lower(sp.supplier_sku) = lower(q) or sp.barcode = q) desc, length(sp.name)
    limit greatest(1, least(p_limit, 200));
  if not found and array_length(words, 1) > 1 then
    return query
      select sp.id, sp.supplier_id, s.name, sp.supplier_sku, sp.barcode, sp.name, sp.unit_cost, sp.data, sp.list_date::date, false
      from supplier_products sp left join suppliers s on s.id = sp.supplier_id
      where (p_supplier is null or sp.supplier_id = p_supplier)
        and lower(coalesce(sp.data->>'brand', '') || ' ' || sp.name) like any (words)
      order by (select count(*) from unnest(words) w where lower(coalesce(sp.data->>'brand', '') || ' ' || sp.name) like w) desc, length(sp.name)
      limit greatest(1, least(p_limit, 200));
  end if;
end $$;
revoke all on function public.catalogue_search(text, uuid, int) from public, anon;
grant execute on function public.catalogue_search(text, uuid, int) to authenticated;
