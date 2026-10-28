-- 070: Order audit shows replacements. Labels uploaded as a replacement (dispatch_labels.reason = 'replacement',
-- original_ref = the original order) are listed on the original order with their own tracking, and a replacement
-- order says what it replaces. Applied as an edit to order_audit (see 068): adds 'replacements' and 'replacement_of'.
-- Safe to re-run.
do $$ declare d text; begin
  d := pg_get_functiondef('public.order_audit(uuid,text)'::regprocedure);
  if position('''replacements''' in d) = 0 then
    d := replace(d, '''labels'', labels, ''upload'', up,', '''labels'', labels, ''upload'', up,
    ''replacements'', (select coalesce(jsonb_agg(jsonb_build_object(''id'', r.id, ''upload_id'', r.upload_id, ''order_key'', coalesce(r.order_key, r.id::text), ''seq'', r.seq,
        ''tracking'', r.tracking, ''status'', r.status, ''items'', r.items, ''label_name'', r.label_name, ''note'', r.note, ''created_at'', r.created_at,
        ''printed_at'', r.printed_at, ''dispatched_at'', r.dispatched_at, ''dispatched_by_name'', r.dispatched_by_name, ''code'', rb.code, ''carrier'', rb.carrier,
        ''delivered_at'', rp.delivered_at, ''parcel_status'', rp.status, ''tracking_url'', rp.tracking_url) order by r.created_at), ''[]''::jsonb)
      from dispatch_labels r join dispatch_batches rb on rb.id = r.batch_id left join helm_parcels rp on rp.tracking = r.tracking
      where r.reason = ''replacement'' and r.status <> ''cancelled'' and public.inv_norm(r.original_ref) = any(select public.inv_norm(x) from unnest(coalesce(refs, ''{}'')) x)
        and r.upload_id <> p_upload),
    ''replacement_of'', (select coalesce(nullif(l->>''original_ref'', ''''), null) from jsonb_array_elements(labels) l where l->>''reason'' = ''replacement'' limit 1),');
    execute d;
  end if;
end $$;
