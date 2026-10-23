-- Deleting a product (v2.39.0) — admins only
--   • No stock and no history (made by mistake): deleted completely.
--   • No stock but it has history (stock went in and out): taken out of Inventory instead, so the history
--     stays true. Its SKU is freed (renamed …-DELETED-<time>), so that code can be linked to the right
--     product, and its open tasks go.
--   • Stock still on a shelf: refused — move it or count it to 0 first.
--   Codes verified as this product stop resolving ("its product has gone — check it again"), so their
--   orders hold rather than take stock from nothing.
-- p_dry = true only says what would happen. Safe to re-run; only adds.

create or replace function public.inv_delete_product(p_id uuid, p_by text, p_dry boolean default false)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare p inv_products; on_hand numeric; history boolean; links int; open_orders int; outcome text;
begin
  if not public.is_admin() then raise exception 'Only an admin can delete a product'; end if;
  select * into p from inv_products where id = p_id;
  if p.id is null then raise exception 'That product isn''t there any more'; end if;

  select coalesce(sum(qty), 0) into on_hand from inv_balances where product_id = p.id;
  history := exists (select 1 from inv_movements where product_id = p.id)
          or exists (select 1 from inv_damages where product_id = p.id)
          or exists (select 1 from dispatch_substitutes where product_id = p.id or sub_product_id = p.id);
  select count(*) into links from inv_channel_skus x
   where x.how = 'person' and exists (select 1 from jsonb_array_elements(coalesce(x.items, '[]'::jsonb)) i where public.inv_norm(i ->> 'code') = p.code_key);
  select count(distinct (l.upload_id, coalesce(l.order_key, l.id::text))) into open_orders from dispatch_labels l
   where l.status in ('ready', 'held') and exists (select 1 from jsonb_array_elements(coalesce(l.items, '[]'::jsonb)) i where public.inv_norm(i ->> 'code') = p.code_key);
  outcome := case when on_hand <> 0 then 'blocked' when history then 'archived' else 'deleted' end;

  if not p_dry then
    if outcome = 'blocked' then
      raise exception 'It still has % in stock — move them or count it to 0 first', on_hand;
    elsif outcome = 'deleted' then
      delete from inv_products where id = p.id;
    else
      update inv_products set active = false, code = p.code || '-DELETED-' || to_char(now() at time zone 'Europe/London', 'YYYYMMDDHH24MISS'),
             note = concat_ws(' · ', nullif(trim(coalesce(note, '')), ''), 'Deleted by ' || coalesce(nullif(trim(p_by), ''), 'admin') || ' on '
                    || to_char(now() at time zone 'Europe/London', 'DD Mon YYYY') || ' (was ' || p.code || ')'),
             updated_at = now()
       where id = p.id;
      delete from inv_tasks where product_id = p.id and status = 'open';
    end if;
  end if;

  return jsonb_build_object('outcome', outcome, 'on_hand', on_hand, 'history', history, 'links', links,
                            'open_orders', open_orders, 'code', p.code, 'name', p.name, 'done', not p_dry);
end $function$;
revoke all on function public.inv_delete_product(uuid, text, boolean) from public, anon;
grant execute on function public.inv_delete_product(uuid, text, boolean) to authenticated;
