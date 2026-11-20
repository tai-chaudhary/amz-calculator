-- 083: Changing a code in Inventory → Item codes now updates Dispatch's pack sizes too (06-11-2026). Already applied.
-- Every verify/change in Item codes is written to inv_code_log; a trigger follows it into dispatch_item_units.
-- One product × N = N units (12 × Handy Bags = 12); a set of different products = 1 unit (as Dispatch counts sets).
-- "We send something else" substitutes are left alone. 8 codes already out of step were brought into line, and the
-- morning database check now checks the two agree.
create or replace function public.inv_code_to_dispatch_units() returns trigger
language plpgsql security definer set search_path = public as $$
declare comps jsonb; total numeric; products int; base text; k text;
begin
  if new.kind is distinct from 'same' or new.action not in ('verified', 'changed')
     or jsonb_array_length(coalesce(new.items, '[]')) = 0 then return new; end if;
  select jsonb_agg(jsonb_build_object('code', coalesce(p.code, i ->> 'code'), 'name', coalesce(p.name, i ->> 'code'), 'units', (i ->> 'qty')::numeric) order by ord),
         sum((i ->> 'qty')::numeric), count(distinct upper(i ->> 'code')), max(p.name)
    into comps, total, products, base
  from jsonb_array_elements(new.items) with ordinality x(i, ord)
  left join inv_products p on upper(p.code) = upper(i ->> 'code');
  if comps is null or total is null or total <= 0 then return new; end if;
  k := upper(regexp_replace(new.code, '[^A-Za-z0-9]', '', 'g'));
  insert into dispatch_item_units (code, code_key, name, units, components, base_product, confirmed, source, updated_at, updated_by_name)
  values (new.code, k, coalesce(new.title, new.code), case when products = 1 then total else 1 end, comps,
          case when products = 1 then base else coalesce(new.title, new.code) end, true, 'item codes', now(), new.by_name)
  on conflict (code_key) do update set units = excluded.units, components = excluded.components,
    base_product = excluded.base_product, confirmed = true, updated_at = now(), updated_by_name = excluded.updated_by_name;
  return new;
end $$;
drop trigger if exists inv_code_to_dispatch_units on inv_code_log;
create trigger inv_code_to_dispatch_units after insert on inv_code_log for each row execute function public.inv_code_to_dispatch_units();
