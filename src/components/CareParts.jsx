import React, { useState, useEffect } from 'react'
import { Icon, SearchInput, Flag } from './UI'
import { findCareOrder, uploadCarePhotos, carePhotoUrl, saveCare } from '../lib/db'

export const CASE_KINDS = {
  damaged: 'Damaged', wrong_item: 'Wrong item sent', missing_item: 'Missing item', not_received: 'Not received',
  not_happy: 'Not happy with it', refused: 'Refused delivery', other: 'Other',
}
// Whose problem it usually is: the packing bench, the carrier, or the product / customer
export const CAUSE = { wrong_item: 'packing', missing_item: 'packing', damaged: 'carrier', not_received: 'carrier', refused: 'customer', not_happy: 'product', other: 'other' }
export const RETURN_REASONS = {
  returned_to_sender: 'Undeliverable (carrier returned it)', refused: 'Refused by the customer', damaged: 'Damaged in transit',
  wrong_item: 'Wrong item', faulty: 'Faulty', not_happy: 'Customer not happy', changed_mind: 'Changed mind', other: 'Other',
}
export const CONDITIONS = { resaleable: 'Can be resold', damaged: 'Damaged', missing: 'Items missing' }
export const PARCEL_STATE = { 7: 'Delivered', 10: 'Returned to sender', 9: 'Address problem', 11: 'Tracking expired', 6: 'Delivery attempted', 1: 'Not scanned yet' }
export const day = (iso) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—')
export const when = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '')
export const itemsText = (items = []) => items.map(i => `${i.qty > 1 ? `${i.qty} × ` : ''}${i.name || i.code}`).join(', ')
export const money = (v) => (v == null || v === '' ? '—' : `£${Number(v).toFixed(2)}`)

/** Find an order by its reference, tracking number, or the name / postcode on a label. */
export function OrderFinder({ onPick, placeholder = 'Order reference or tracking number', allowNames = false }) {
  const [q, setQ] = useState('')
  const [found, setFound] = useState([])
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (q.trim().length < 3) { setFound([]); return }
    setBusy(true)
    const t = setTimeout(() => findCareOrder(q).then(r => setFound(Array.isArray(r) ? r : [])).catch(() => setFound([])).finally(() => setBusy(false)), 300)
    return () => clearTimeout(t)
  }, [q])
  return (
    <div className="space-y-2">
      <SearchInput value={q} onChange={e => setQ(e.target.value)} placeholder={allowNames ? 'Order ref, tracking number, name or postcode on the label' : placeholder} className="w-full" autoFocus />
      {busy && <div className="text-xs text-ink/45">Looking…</div>}
      {!busy && q.trim().length >= 3 && !found.length && <div className="text-xs text-ink/55">No order found for that.</div>}
      {found.length > 0 && (
        <div className="border border-rule rounded-[6px] divide-y divide-rule/70 max-h-60 overflow-y-auto bg-white">
          {found.map(o => (
            <button key={o.label_id} type="button" className="w-full text-left px-3 py-2 hover:bg-paper" onClick={() => onPick(o)}>
              <div className="text-sm font-medium text-ink">{o.order_ref || o.tracking} · {String(o.carrier || '').split(' ')[0]}{o.channel ? ` · ${o.channel}` : ''}</div>
              <div className="text-xs text-ink/55 truncate">{itemsText(o.items)}</div>
              <div className="text-[11px] text-ink/40">{o.batch_code} #{o.seq}{o.packer ? ` · packed by ${o.packer}` : ''} · sent {day(o.shipped_at)}{o.postcode ? ` · ${o.postcode}` : ''}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** The order, once found: what's in it, how the parcel got on, who packed it. */
export function OrderCard({ o, onChange }) {
  const st = o.parcel_status != null ? PARCEL_STATE[o.parcel_status] : null
  return (
    <div className="surface-sky p-3 text-sm flex items-start justify-between gap-2">
      <div className="min-w-0">
        <div><b>{o.order_ref || o.tracking}</b> · {String(o.carrier || '').split(' ')[0]}{o.channel ? ` · ${o.channel}` : ''}</div>
        <div className="text-xs text-ink/60">{o.batch_code} #{o.seq}{o.packer ? ` · packed by ${o.packer}` : ''} · sent {day(o.shipped_at)}</div>
        {st && <div className="mt-1"><Flag tone={o.parcel_status === 7 ? 'green' : o.parcel_status === 10 || o.parcel_status === 9 ? 'red' : 'amber'}>{st}{o.delivered_at ? ` ${day(o.delivered_at)}` : ''}</Flag>
          {o.tracking_url && <a className="text-xs text-royal-600 hover:underline ml-2" href={o.tracking_url} target="_blank" rel="noreferrer">Tracking</a>}</div>}
      </div>
      {onChange && <button type="button" className="btn btn-ghost btn-xs" onClick={onChange}>Change</button>}
    </div>
  )
}

/** What was actually in the parcel: sets and packs opened into our products (falls back to the slip lines). */
export const contentsOf = (o) => (o?.contents?.length ? o.contents : o?.items || [])
/** Start with everything ticked only when there's one product; with several, the person picks which were affected. */
export const startPicked = (o) => { const c = contentsOf(o); return c.length === 1 ? c.map((i, k) => ({ key: `${k}|${i.code || i.name}`, name: i.name || i.code, code: i.code, product_id: i.product_id || null, qty: Number(i.qty) || 1 })) : [] }

/** Which of the order's products this is about — all, or some, and how many of each. */
export function ItemsPicker({ items = [], ordered = null, value, onChange }) {
  const chosen = new Map(value.map(v => [v.key, v]))
  const keyOf = (i, k) => `${k}|${i.code || i.name}`
  const all = items.length > 0 && items.every((i, k) => chosen.has(keyOf(i, k)))
  const setLine = ordered && ordered.length && (ordered.length !== items.length || ordered.some((o, k) => (o.code || o.name) !== (items[k]?.code || items[k]?.name)))
  return (
    <div>
      {setLine && <div className="text-xs text-ink/55 mb-1.5">Ordered as: {ordered.map(o => `${o.qty > 1 ? `${o.qty} × ` : ''}${o.name || o.code}`).join(', ')} — tick which product{items.length > 1 ? 's' : ''} inside it {items.length > 1 ? 'were' : 'was'} affected</div>}
      <div className="flex items-center justify-between mb-1.5">
        <div className="label mb-0">Which products{items.length > 1 ? ' were affected' : ''}?</div>
        {items.length > 1 && <button type="button" className="btn btn-ghost btn-xs" onClick={() => onChange(all ? [] : items.map((i, k) => ({ key: keyOf(i, k), name: i.name || i.code, code: i.code, product_id: i.product_id || null, qty: Number(i.qty) || 1 })))}>{all ? 'None' : 'All of them'}</button>}
      </div>
      <div className="border border-rule rounded-[6px] divide-y divide-rule/70 bg-white">
        {items.map((i, k) => {
          const key = keyOf(i, k), on = chosen.get(key)
          return (
            <div key={key} className="flex items-center gap-2 px-3 py-2">
              <input type="checkbox" className="w-5 h-5 accent-royal-500" checked={!!on} aria-label={i.name}
                onChange={e => onChange(e.target.checked ? [...value, { key, name: i.name || i.code, code: i.code, product_id: i.product_id || null, qty: Number(i.qty) || 1 }] : value.filter(v => v.key !== key))} />
              <span className="flex-1 text-sm text-ink">{i.name || i.code}</span>
              {on && Number(i.qty) > 1 && (
                <select className="input text-sm w-28" value={on.qty} onChange={e => onChange(value.map(v => v.key === key ? { ...v, qty: Number(e.target.value) } : v))}>
                  {Array.from({ length: Number(i.qty) }, (_, n) => n + 1).map(n => <option key={n} value={n}>{n} of {i.qty}</option>)}
                </select>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** Pick several photos at once (camera or library); held until the record's saved. */
export function PhotoPicker({ files, onChange, label = 'Photos' }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className="flex flex-wrap gap-2">
        {files.map((f, i) => (
          <div key={i} className="relative w-20 h-20 rounded-[6px] overflow-hidden border border-rule bg-paper">
            <img src={URL.createObjectURL(f)} alt="" className="w-full h-full object-cover" />
            <button type="button" className="absolute top-0.5 right-0.5 bg-white/90 rounded-full w-5 h-5 flex items-center justify-center" onClick={() => onChange(files.filter((_, j) => j !== i))} aria-label="Remove photo"><Icon name="close" size={11} /></button>
          </div>
        ))}
        <label className="w-20 h-20 rounded-[6px] border-2 border-dashed border-rule flex flex-col items-center justify-center text-ink/50 text-[11px] cursor-pointer hover:border-royal-300">
          <Icon name="camera" size={18} /> Add
          <input type="file" accept="image/*" multiple className="hidden" onChange={e => { const fs = [...(e.target.files || [])]; e.target.value = ''; onChange([...files, ...fs]) }} />
        </label>
      </div>
    </div>
  )
}

/** Photos on a saved record: view them, add more (several at once). */
export function Photos({ rec, table, me, onChanged, showToast }) {
  const [urls, setUrls] = useState({})
  const [busy, setBusy] = useState(false)
  useEffect(() => { Promise.all((rec.photos || []).map(p => carePhotoUrl(p).then(u => [p, u]))).then(l => setUrls(Object.fromEntries(l))) }, [rec.photos])
  return (
    <div className="card">
      <div className="flex items-center justify-between mb-2"><div className="section-title">Photos ({(rec.photos || []).length})</div>
        <label className={`btn btn-secondary btn-xs cursor-pointer ${busy ? 'opacity-50' : ''}`}><Icon name="camera" size={12} /> {busy ? 'Uploading…' : 'Add photos'}
          <input type="file" accept="image/*" multiple className="hidden" disabled={busy} onChange={async e => {
            const fs = [...(e.target.files || [])]; e.target.value = ''; if (!fs.length) return
            setBusy(true)
            try { const paths = await uploadCarePhotos(rec.id, fs); onChanged(await saveCare(table, rec, { photos: [...(rec.photos || []), ...paths] }, `${fs.length} photo${fs.length === 1 ? '' : 's'} added`, me?.name)) }
            catch (er) { showToast?.(er?.message || 'Couldn’t upload', 'error') } finally { setBusy(false) }
          }} /></label></div>
      {(rec.photos || []).length ? <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">{rec.photos.map(p => urls[p] ? <a key={p} href={urls[p]} target="_blank" rel="noreferrer"><img src={urls[p]} alt="" className="w-full h-24 object-cover rounded-[6px] border border-rule" /></a> : <div key={p} className="h-24 bg-paper rounded-[6px]" />)}</div>
        : <div className="text-sm text-ink/45">None yet.</div>}
    </div>
  )
}

export function History({ list = [] }) {
  return (
    <div className="card"><div className="section-title mb-2">History</div>
      <ol className="space-y-2">{[...list].reverse().map((h, k) => <li key={k} className="text-sm"><div className="text-ink">{h.what}</div><div className="text-[11px] text-ink/40">{h.by} · {when(h.at)}</div></li>)}</ol>
    </div>
  )
}
