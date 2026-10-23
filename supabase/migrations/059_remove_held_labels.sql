-- 059: Remove labels from On hold (warehouse feedback, Oct 2026): a page that isn't a label (an Amazon packing
-- slip uploaded with its label), an order the customer cancelled, a wrong label. Anyone on Dispatch can do it
-- for held labels only, with a reason; nothing is deleted — the label is marked removed (cancelled) with who,
-- when and why, and shows in Dispatch → Removed labels. Safe to re-run.

alter table dispatch_labels add column if not exists removed_kind text;   -- packing_slip | customer_cancelled | wrong_label | other
alter table dispatch_labels add column if not exists removed_from text;   -- the status it had: held

create or replace function public.dispatch_remove_held(p_ids uuid[], p_kind text, p_reason text, p_by text)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.can_open('dispatch') then raise exception 'Not allowed'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Say why it''s being removed'; end if;
  if coalesce(trim(p_by), '') = '' then raise exception 'Say who''s removing it'; end if;
  update dispatch_labels
     set status = 'cancelled', removed_from = status, removed_kind = coalesce(nullif(trim(p_kind), ''), 'other'),
         hold_reason = trim(p_reason), cancelled_at = now(), cancelled_by_name = trim(p_by)
   where id = any(coalesce(p_ids, '{}')) and status = 'held';
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.dispatch_remove_held(uuid[], text, text, text) from public, anon;
grant execute on function public.dispatch_remove_held(uuid[], text, text, text) to authenticated;
