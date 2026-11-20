-- 060: Undo (portal feedback, Oct 2026). Anything a person does — dispatching, ready for dispatch, keeping back,
-- substitutes, stock moves and counts, damages, goods in, requests, orders, claims, complaints, returns — can be
-- undone by them within 5 minutes.
--
-- How: every change a signed-in person makes to these tables is written to undo_log with the row before and after,
-- grouped by the request (transaction) it was made in — one tap in the portal is one group. Undo puts each row back
-- as it was, newest change first. Stock is never edited backwards: a stock movement is undone by adding the
-- opposite movement (so the stock history stays complete), and a dispatch is undone by un-dispatching the label,
-- which puts its stock back by itself. If anyone else has changed the same thing since, undo refuses and says who.
-- Changes by the system (HELM sync, timers) aren't logged and can't be undone. Kept for a day. Safe to re-run.

create table if not exists undo_log (
  id bigserial primary key,
  txid bigint not null default txid_current(),
  user_id uuid, at timestamptz not null default now(),
  tbl text not null, op text not null, row_id text not null,
  old jsonb, new jsonb, undone_at timestamptz
);
create index if not exists undo_log_user_idx on undo_log (user_id, at desc);
create index if not exists undo_log_row_idx on undo_log (tbl, row_id, id);
create index if not exists undo_log_tx_idx on undo_log (txid);
alter table undo_log enable row level security;   -- only through the functions below

create or replace function public.undo_capture() returns trigger
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null or coalesce(current_setting('app.undoing', true), '') = 'on' then return null; end if;
  insert into undo_log (user_id, tbl, op, row_id, old, new)
  values (uid, tg_table_name, tg_op,
          coalesce(case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end ->> 'id', ''),
          case when tg_op <> 'INSERT' then to_jsonb(old) end, case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return null;
end $$;

do $$ declare t text;
begin
  foreach t in array array['dispatch_labels','dispatch_batches','dispatch_uploads','dispatch_substitutes','dispatch_collections',
    'inv_movements','inv_damages','inv_tasks','inv_products','goods_in_deliveries','stock_requests','purchase_orders',
    'purchase_order_items','claims','complaints','returns','stock_items','saved_products','live_products','suppliers'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists undo_capture on public.%I', t);
      execute format('create trigger undo_capture after insert or update or delete on public.%I for each row execute function public.undo_capture()', t);
    end if;
  end loop;
end $$;

-- What I've done in the last 5 minutes that can still be undone, newest first
create or replace function public.my_undoable()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(g order by g->>'at' desc), '[]'::jsonb) from (
    select jsonb_build_object('txid', txid, 'at', min(at), 'left', greatest(0, 300 - extract(epoch from now() - min(at)))::int,
      'parts', (select jsonb_agg(jsonb_build_object('tbl', tbl, 'op', op, 'n', n, 'from', f, 'to', t, 'name', nm))
                from (select tbl, op, count(*) n, min(old->>'status') f, min(new->>'status') t,
                             min(coalesce(new->>'name', old->>'name', new->>'product_name', new->>'label_name', old->>'label_name', new->>'ref', old->>'ref', new->>'po_number')) nm
                      from undo_log x where x.txid = u.txid group by tbl, op) s)) g
    from undo_log u
    where u.user_id = auth.uid() and u.undone_at is null and u.at > now() - interval '5 minutes'
    group by txid
  ) q
$$;
revoke all on function public.my_undoable() from public, anon;
grant execute on function public.my_undoable() to authenticated;

create or replace function public.undo_action(p_txid bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record; cols text; first_at timestamptz; clash text; n int := 0; mv jsonb;
begin
  select min(at) into first_at from undo_log where txid = p_txid and user_id = auth.uid() and undone_at is null;
  if first_at is null then raise exception 'Nothing to undo — it may already be undone'; end if;
  if first_at < now() - interval '5 minutes' then raise exception 'Too late — undo works for 5 minutes'; end if;
  -- Someone changed the same thing afterwards: putting it back would undo their work too
  select string_agg(distinct coalesce(p.display_name, 'someone'), ', ') into clash
  from undo_log a join undo_log b on b.tbl = a.tbl and b.row_id = a.row_id and b.id > a.id and b.txid <> a.txid and b.undone_at is null
  left join profiles p on p.id = b.user_id
  where a.txid = p_txid;
  if clash is not null then raise exception 'Can''t undo — % changed the same thing since', clash; end if;

  perform set_config('app.undoing', 'on', true);
  for r in select * from undo_log where txid = p_txid order by id desc loop
    select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols
    from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = r.tbl and c.is_generated = 'NEVER'
      and coalesce(c.identity_generation, '') <> 'ALWAYS' and c.column_name <> 'id';
    if r.tbl = 'inv_movements' then
      -- Stock: never edited backwards — the opposite movement goes in. Despatch movements follow their label.
      if r.op = 'INSERT' and coalesce(r.new->>'kind', '') <> 'despatch' then
        mv := r.new - 'id' || jsonb_build_object('qty', -((r.new->>'qty')::numeric), 'at', now(),
          'note', left('Undone: ' || coalesce(r.new->>'note', r.new->>'kind', ''), 500));
        execute format('insert into public.inv_movements (%s) select %s from jsonb_populate_record(null::public.inv_movements, $1)', cols, cols) using mv;
      end if;
    elsif r.op = 'INSERT' then
      execute format('delete from public.%I where id::text = $1', r.tbl) using r.row_id;
    elsif r.op = 'UPDATE' then
      execute format('update public.%I t set (%s) = (select %s from jsonb_populate_record(null::public.%I, $1)) where t.id::text = $2',
        r.tbl, cols, cols, r.tbl) using r.old, r.row_id;
    elsif r.op = 'DELETE' then
      execute format('insert into public.%I (id, %s) select id, %s from jsonb_populate_record(null::public.%I, $1)', r.tbl, cols, cols, r.tbl) using r.old;
    end if;
    n := n + 1;
  end loop;
  perform set_config('app.undoing', 'off', true);
  update undo_log set undone_at = now() where txid = p_txid;
  return jsonb_build_object('rows', n);
end $$;
revoke all on function public.undo_action(bigint) from public, anon;
grant execute on function public.undo_action(bigint) to authenticated;

do $$ begin
  if not exists (select 1 from cron.job where jobname = 'undo-log-trim') then
    perform cron.schedule('undo-log-trim', '17 * * * *', $c$delete from undo_log where at < now() - interval '1 day'$c$);
  end if;
end $$;
