-- 112 (v2.87.0, 16-11-2026): Prime orders in Dispatch.
--
-- The owner: a Prime order must be plain to see — on the label, the batch's header pages and every Dispatch screen —
-- and Prime orders get a batch of their own, even when they arrive in a mixed file. HELM tags Prime orders itself
-- (helm_orders.tags, migration 111), so HELM decides; the office's "These are Prime orders" tick is the backup.
--
-- ADDITIVE ONLY: three flags that default to "not Prime", one read-only lookup, and one small job. Nothing that
-- exists is altered; a label, batch or upload with prime = false behaves exactly as before.
alter table public.dispatch_labels  add column if not exists prime boolean not null default false;
alter table public.dispatch_labels  add column if not exists prime_source text;     -- helm | upload | both
alter table public.dispatch_batches add column if not exists prime boolean not null default false;
alter table public.dispatch_uploads add column if not exists prime boolean not null default false;

-- Any tag with the word "prime": "Prime", "PRIME - Dispatched", "Label Created from Amazon (Prime Order)"
create or replace function public.tags_prime(p_tags text[]) returns boolean language sql immutable as $$
  select exists (select 1 from unnest(coalesce(p_tags, '{}'::text[])) t where t ~* '\mprime\M')
$$;

-- At upload: which of these orders has HELM tagged Prime? p_refs are order numbers as read off the slips (any
-- punctuation); p_postcodes are for labels with NO order number, and count only when exactly ONE order HELM still
-- holds a postcode for is at that postcode (a misread postcode then matches nothing, never the wrong order).
-- Returns { refs: [order numbers, letters and digits only], postcodes: [no spaces], checked_at }.
create or replace function public.dispatch_prime_orders(p_refs text[], p_postcodes text[] default null)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare k text[]; pc text[];
begin
  if not public.is_active_user() then raise exception 'Not allowed'; end if;
  select coalesce(array_agg(distinct x), '{}') into k from (select regexp_replace(upper(r), '[^A-Z0-9]', '', 'g') x from unnest(coalesce(p_refs, '{}'::text[])) r) s where x <> '';
  select coalesce(array_agg(distinct x), '{}') into pc from (select regexp_replace(upper(r), '[^A-Z0-9]', '', 'g') x from unnest(coalesce(p_postcodes, '{}'::text[])) r) s where x <> '';
  return jsonb_build_object(
    'refs', coalesce((select jsonb_agg(distinct key) from helm_orders h, unnest(h.keys) key
        where h.keys && k and key = any(k) and public.tags_prime(h.tags)), '[]'::jsonb),
    'postcodes', coalesce((select jsonb_agg(p) from (
        select regexp_replace(upper(h.postcode), '[^A-Z0-9]', '', 'g') p
        from helm_orders h where h.postcode is not null and regexp_replace(upper(h.postcode), '[^A-Z0-9]', '', 'g') = any(pc)
        group by 1 having count(*) = 1 and bool_and(public.tags_prime(h.tags))) x), '[]'::jsonb),
    'checked_at', now());
end $$;
revoke all on function public.dispatch_prime_orders(text[], text[]) from public, anon;
grant execute on function public.dispatch_prime_orders(text[], text[]) to authenticated, service_role;

-- "If an order is uploaded as not Prime but HELM says Prime, follow HELM": a label still to go whose HELM order
-- carries a Prime tag is marked Prime (the mark then shows on the screens and on any later print). It never moves
-- a label to another batch and never touches a label that has gone or been cancelled. Only the two Prime columns
-- change, so the status triggers (stock, cancel guard) do not fire.
create or replace function public.dispatch_follow_helm_prime()
returns integer language plpgsql security definer set search_path to 'public' as $$
declare n integer;
begin
  update dispatch_labels l
     set prime = true, prime_source = case when l.prime_source = 'upload' then 'both' else 'helm' end
   where l.status not in ('dispatched', 'cancelled') and l.created_at >= now() - interval '10 days'
     and (l.prime = false or l.prime_source = 'upload') and l.channel_ref is not null
     and exists (select 1 from helm_orders h
                  where h.keys @> array[regexp_replace(upper(l.channel_ref), '[^A-Z0-9]', '', 'g')] and public.tags_prime(h.tags));
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.dispatch_follow_helm_prime() from public, anon, authenticated;

select cron.unschedule('dispatch-prime-follow') where exists (select 1 from cron.job where jobname = 'dispatch-prime-follow');
select cron.schedule('dispatch-prime-follow', '*/5 * * * *', $cron$ select public.dispatch_follow_helm_prime() $cron$);
