-- 124 — labels with no packing slip: which HELM order is this parcel? (v2.94.0)
--
-- APPLIED to the live database on 16 Nov 2026. Read-only: three functions, no table touched.
--
-- A label bought outside HELM (Amazon Buy Shipping, Veeqo, a carrier's own site) is uploaded with no slip, so its
-- product and quantity were chosen by hand. HELM still holds the order — open, with no label of its own, and with the
-- postcode (kept on helm_orders since v2.79.0). dispatch_no_slip_orders(postcodes) returns, for each postcode asked,
-- the orders that could be it:
--   · no HELM label (labelled_at is null), open or closed in the last three days
--   · HELM knows every item's code
--   · no label in Dispatch already carries the order number
--   · the postcode is the same, or ONE character out, once look-alike characters are made the same (O 0 Q, I L 1,
--     S 5, B 8, Z 2, G C) — the same rule the app uses (samePostcode in src/lib/dispatch.js)
-- Result: { "<postcode as asked>": [{ ref, channel, postcode, items, order_date, closed, closed_reason, prime }] },
-- exact postcode first. The app only ever OFFERS these; a person confirms with a click.
--
-- Checked on the live data: 6 open unlabelled orders asked for by their own postcode, the postcode squashed, the last
-- character wrong, and the last character missing — found 6 of 6 each time, never two orders for one postcode; a
-- postcode nobody has — nothing. 150 postcodes in 0.4s.

create or replace function public.pc_squash(t text) returns text language sql immutable set search_path to 'public' as $$
  select translate(regexp_replace(upper(coalesce(t, '')), '[^A-Z0-9]', '', 'g'), 'OILSBZQG', '0115820C')
$$;

create or replace function public.pc_near(a text, b text) returns boolean language plpgsql immutable set search_path to 'public' as $$
declare x text := public.pc_squash(a); y text := public.pc_squash(b); i int; d int := 0; s text; l text;
begin
  if x = '' or y = '' then return false; end if;
  if x = y then return true; end if;
  if length(x) = length(y) then
    for i in 1..length(x) loop if substr(x, i, 1) <> substr(y, i, 1) then d := d + 1; if d > 1 then return false; end if; end if; end loop;
    return true;
  end if;
  if abs(length(x) - length(y)) <> 1 then return false; end if;
  if length(x) > length(y) then l := x; s := y; else l := y; s := x; end if;
  for i in 1..length(l) loop if overlay(l placing '' from i for 1) = s then return true; end if; end loop;
  return false;
end $$;

create or replace function public.dispatch_no_slip_orders(p_postcodes text[])
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare res jsonb;
begin
  if not public.is_active_user() then raise exception 'Not allowed'; end if;
  with ask as (
    select distinct x from unnest(coalesce(p_postcodes, '{}'::text[])) x where length(public.pc_squash(x)) between 5 and 8
  ), cand as materialized (
    select h.ref, h.channel, h.postcode, h.items, h.order_date, h.closed_at, h.closed_reason, public.tags_prime(h.tags) prime
    from helm_orders h
    where h.postcode is not null and h.labelled_at is null and coalesce(h.ref, '') <> ''
      and (h.closed_at is null or h.closed_at > now() - interval '3 days')
      and jsonb_typeof(h.items) = 'array' and jsonb_array_length(h.items) > 0
      and not exists (select 1 from jsonb_array_elements(h.items) i where coalesce(i->>'code', '') = '')
      and not exists (select 1 from dispatch_labels l where l.channel_ref = h.ref and l.status <> 'cancelled')
  )
  select coalesce(jsonb_object_agg(q.x, q.orders), '{}'::jsonb) into res from (
    select a.x, jsonb_agg(jsonb_build_object('ref', c.ref, 'channel', c.channel, 'postcode', c.postcode, 'items', c.items,
        'order_date', c.order_date, 'closed', c.closed_at is not null, 'closed_reason', c.closed_reason, 'prime', c.prime)
        order by (public.pc_squash(c.postcode) = public.pc_squash(a.x)) desc, c.order_date desc) orders
    from ask a join cand c on public.pc_near(c.postcode, a.x)
    group by a.x) q;
  return res;
end $function$;

revoke all on function public.dispatch_no_slip_orders(text[]) from public, anon;
grant execute on function public.dispatch_no_slip_orders(text[]) to authenticated;
