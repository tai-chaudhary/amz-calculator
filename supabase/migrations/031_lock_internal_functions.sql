-- Lock down database functions that skip the sign-in check.
--
-- These run with the database owner's rights (security definer) and don't
-- check who is calling. Postgres lets everyone run new functions by default,
-- so anyone holding the public key that ships in the portal's JavaScript,
-- signed in or not, could call them through /rest/v1/rpc/…:
--   inv_take              takes stock off any product
--   inv_undo_despatch /   puts stock back / takes it off for an order
--   inv_despatch_order
--   inv_ensure_location   creates shelves
--   inv_open_order_units  lists open orders, falling back to the customer's
--                         name when an order has no reference
--
-- None of them is called by the portal or the edge functions directly; they
-- run inside other functions and triggers, which keep working because those
-- run as the owner. The ones the portal does call (next_po_number,
-- next_credit_number, next_dispatch_upload_code) stay open to signed-in users.
--
-- Safe to re-run.

do $$
declare f text;
begin
  foreach f in array array[
    'public.helm_ship_day(timestamptz, text, timestamptz)',
    'public.inv_check_all()',
    'public.inv_check_replenish(uuid)',
    'public.inv_daily_units(date, date)',
    'public.inv_despatch_order(uuid, text)',
    'public.inv_ensure_location(text, boolean, text)',
    'public.inv_expand(jsonb, numeric)',
    'public.inv_open_order_units()',
    'public.inv_plan_counts()',
    'public.inv_rate_of(uuid)',
    'public.inv_refresh_rates()',
    'public.inv_take(uuid, numeric, text, timestamptz, text, text, text, text)',
    'public.inv_undo_despatch(uuid, text)',
    'public.next_dispatch_batch_codes(date, integer)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;

  -- Used by the portal, but only ever by someone signed in
  foreach f in array array[
    'public.next_po_number()',
    'public.next_credit_number()',
    'public.next_dispatch_upload_code(date)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- New functions shouldn't be callable by signed-out visitors unless granted on purpose
alter default privileges in schema public revoke execute on functions from public, anon;
