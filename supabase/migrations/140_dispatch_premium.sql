-- 140 (v2.110.0, 19-11-2026): Premium orders in Dispatch, the same way as Prime (migration 112).
--
-- Premium = Amazon's paid faster delivery on an offer that is not Prime (HELM's Requested Shipping Service "UK Next";
-- Prime orders are "SFP - UK Next"). The owner set a HELM rule on 19 Nov that tags these orders "Premium". They must go
-- the same day, so they are marked like Prime: on the label (Evri "PREMIUM" bar, DHL "N" box), on the header pages and
-- on every Dispatch screen, with a batch of their own after Prime. An order is never both: Prime wins.
--
-- ADDITIVE ONLY: three flags that default to "not Premium", one read-only lookup, one small job. Nothing that exists is
-- altered; a label, batch or upload with premium = false behaves exactly as before.
alter table public.dispatch_labels  add column if not exists premium boolean not null default false;
alter table public.dispatch_labels  add column if not exists premium_source text;     -- helm | upload | both
alter table public.dispatch_batches add column if not exists premium boolean not null default false;
alter table public.dispatch_uploads add column if not exists premium boolean not null default false;

-- Any tag with the word "premium" ("Premium", "PREMIUM - Dispatched", …). "Prime" never matches it, nor it "Prime".
create or replace function public.tags_premium(p_tags text[]) returns boolean language sql immutable as $$
  select exists (select 1 from unnest(coalesce(p_tags, '{}'::text[])) t where t ~* '\mpremium\M')
$$;

-- At upload: which of these orders has HELM tagged Premium (and not Prime)? Same rules and shape as dispatch_prime_orders.
create or replace function public.dispatch_premium_orders(p_refs text[], p_postcodes text[] default null)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare k text[]; pc text[];
begin
  if not public.is_active_user() then raise exception 'Not allowed'; end if;
  select coalesce(array_agg(distinct x), '{}') into k from (select regexp_replace(upper(r), '[^A-Z0-9]', '', 'g') x from unnest(coalesce(p_refs, '{}'::text[])) r) s where x <> '';
  select coalesce(array_agg(distinct x), '{}') into pc from (select regexp_replace(upper(r), '[^A-Z0-9]', '', 'g') x from unnest(coalesce(p_postcodes, '{}'::text[])) r) s where x <> '';
  return jsonb_build_object(
    'refs', coalesce((select jsonb_agg(distinct key) from helm_orders h, unnest(h.keys) key
        where h.keys && k and key = any(k) and public.tags_premium(h.tags) and not public.tags_prime(h.tags)), '[]'::jsonb),
    'postcodes', coalesce((select jsonb_agg(p) from (
        select regexp_replace(upper(h.postcode), '[^A-Z0-9]', '', 'g') p
        from helm_orders h where h.postcode is not null and regexp_replace(upper(h.postcode), '[^A-Z0-9]', '', 'g') = any(pc)
        group by 1 having count(*) = 1 and bool_and(public.tags_premium(h.tags) and not public.tags_prime(h.tags))) x), '[]'::jsonb),
    'checked_at', now());
end $$;
revoke all on function public.dispatch_premium_orders(text[], text[]) from public, anon;
grant execute on function public.dispatch_premium_orders(text[], text[]) to authenticated, service_role;

-- Follow HELM, as for Prime: a label still to go whose HELM order is tagged Premium (and not Prime) is marked Premium.
-- Never moves a label, never touches one that has gone or been cancelled, never one already Prime. Only the two Premium
-- columns change, so the status triggers (stock, cancel guard) do not fire.
create or replace function public.dispatch_follow_helm_premium()
returns integer language plpgsql security definer set search_path to 'public' as $$
declare n integer;
begin
  update dispatch_labels l
     set premium = true, premium_source = case when l.premium_source = 'upload' then 'both' else 'helm' end
   where l.status not in ('dispatched', 'cancelled') and l.created_at >= now() - interval '10 days'
     and l.prime = false and (l.premium = false or l.premium_source = 'upload') and l.channel_ref is not null
     and exists (select 1 from helm_orders h
                  where h.keys @> array[regexp_replace(upper(l.channel_ref), '[^A-Z0-9]', '', 'g')]
                    and public.tags_premium(h.tags) and not public.tags_prime(h.tags));
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.dispatch_follow_helm_premium() from public, anon, authenticated;

select cron.unschedule('dispatch-premium-follow') where exists (select 1 from cron.job where jobname = 'dispatch-premium-follow');
select cron.schedule('dispatch-premium-follow', '*/5 * * * *', $cron$ select public.dispatch_follow_helm_premium() $cron$);
