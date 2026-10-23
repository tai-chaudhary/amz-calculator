import React, { useState, useEffect } from 'react'
import { PageHeader, Icon, SearchInput, EmptyState, Spinner, Flag, StatusBadge, capFirst, SuggestInput } from './UI'
import { fmtDate } from '../lib/dates'
import { searchOrderAudit, loadOrderAudit } from '../lib/db'
import { LabelImage } from './DispatchPage'

/**
 * Order audit (Oct 2026): find any order — by its reference, HELM number, tracking number, the customer's name or
 * postcode, our label number (B4 #12), or the day — and see everything that happened to it, in order: HELM,
 * the upload, what the packing slip said, what was stamped, who printed, packed and dispatched it, what went in the
 * parcel (substitutes included), its tracking scans, and any case, refund, return or claim.
 * (The portal keeps only the name and postcode from the label — no addresses, phone numbers or emails.)
 */
const when = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '')
const itemsText = (items = []) => items.map(i => `${i.qty > 1 ? `${i.qty} × ` : ''}${i.name || i.code}`).join(', ')
const HELM_STATUS = { 2: 'New order', 3: 'Processing', 4: 'Picking', 7: 'Packing', 8: 'Labelled', 9: 'Cancelled', 12: 'Back order' }
const PARCEL = { 1: 'Not scanned yet', 2: 'Collected', 3: 'In transit', 4: 'At depot', 5: 'Out for delivery', 6: 'Delivery attempted', 7: 'Delivered', 9: 'Address problem', 10: 'Returned to sender', 11: 'Tracking expired' }

/** Hand an order to another page's form (Cases & Refunds, Returns): it opens with everything we know filled in. */
export function sendPrefill(kind, order) { try { sessionStorage.setItem('gg-prefill', JSON.stringify({ kind, order, at: Date.now() })) } catch { /* private mode */ } }
export function takePrefill(kinds) {
  try {
    const p = JSON.parse(sessionStorage.getItem('gg-prefill') || 'null')
    if (!p || !kinds.includes(p.kind) || Date.now() - p.at > 60000) return null
    sessionStorage.removeItem('gg-prefill'); return p
  } catch { return null }
}

export default function OrderAuditPage({ canOpen = () => true, onNavigate, me, onLog, showToast, inventory }) {
  const [q, setQ] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [rows, setRows] = useState(null)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(null)
  useEffect(() => {
    if (q.trim().length < 2 && !from && !to) { setRows(null); return }
    setBusy(true)
    const t = setTimeout(() => searchOrderAudit(q.trim(), from || null, to || null).then(r => setRows(Array.isArray(r) ? r : [])).catch(() => setRows([])).finally(() => setBusy(false)), 350)
    return () => clearTimeout(t)
  }, [q, from, to])
  if (open) return <Audit row={open} onBack={() => setOpen(null)} canOpen={canOpen} onNavigate={onNavigate} me={me} onLog={onLog} showToast={showToast} inventory={inventory} />
  return (
    <div>
      <PageHeader eyebrow="Warehouse / order audit" title="Order Audit"
        description="Find any order and see everything that happened to it: upload, packing slip, stamp, who printed, packed and sent it, tracking, and any case, refund, return or claim." />
      <div className="filter-bar">
        <SearchInput value={q} onChange={e => setQ(e.target.value)} placeholder="Order ref, HELM number, tracking, name, postcode, or B4 #12" className="flex-1 min-w-[260px]" autoFocus />
        <div className="flex items-center gap-1.5 text-xs text-ink/55">
          <input type="date" className="input text-sm w-[150px]" value={from} onChange={e => setFrom(e.target.value)} aria-label="Sent from" /> to
          <input type="date" className="input text-sm w-[150px]" value={to} onChange={e => setTo(e.target.value)} aria-label="Sent to" />
        </div>
      </div>
      {busy && <Spinner />}
      {!busy && rows === null && <div className="surface"><EmptyState icon="search" title="Search for an order" sub="Any reference, tracking number, the customer's name or postcode, or pick dates." /></div>}
      {!busy && rows && !rows.length && <div className="surface"><EmptyState icon="search" title="Nothing found" sub="Try part of the reference, the postcode, or a wider date range." /></div>}
      {!busy && rows?.length > 0 && (
        <div className="card p-0 overflow-hidden">
          {rows.map(r => (
            <button key={`${r.upload_id}|${r.order_key}`} className="w-full text-left px-4 py-3 border-b border-rule last:border-0 hover:bg-paper/70" onClick={() => setOpen(r)}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-ink">{r.order_ref || 'No order reference'} <span className="text-xs text-ink/45 font-normal">· {r.code}</span></div>
                  <div className="text-xs text-ink/60 truncate">{[r.customer, r.postcode, r.stamp].filter(Boolean).join(' · ')}</div>
                </div>
                <div className="text-right shrink-0"><div className="text-xs text-ink/55">{fmtDate(r.ship_date)}</div><div className="text-[11px] text-ink/45">{capFirst(r.status)}</div></div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function Audit({ row, onBack, canOpen, onNavigate, me, onLog, showToast, inventory }) {
  const [d, setD] = useState(null)
  const [err, setErr] = useState('')
  const [replacing, setReplacing] = useState(false)
  const reload = () => loadOrderAudit(row.upload_id, row.order_key).then(setD).catch(e => setErr(e?.message || 'Couldn’t load'))
  useEffect(() => { reload() }, [row]) // eslint-disable-line react-hooks/exhaustive-deps
  if (err) return <div className="card text-loss">{err}</div>
  if (!d) return <Spinner />
  const labels = d.labels || [], first = labels[0] || {}, up = d.upload || {}, helm = (d.helm || [])[0], parcels = d.parcels || []
  // Everything that happened, in order
  const ev = []
  const add = (at, what, who, tone = 'blue') => at && ev.push({ at, what, who, tone })
  if (helm) { add(helm.order_date, `Order placed on ${helm.channel || 'the marketplace'}`, helm.order_number && `HELM ${helm.order_number}`, 'grey'); add(helm.labelled_at, 'Label made in HELM', null, 'grey') }
  add(up.created_at, `Uploaded to Dispatch — ${up.code || ''}${up.title ? ` (${up.title})` : ''}`, up.uploaded_by_name)
  for (const l of labels) {
    const tag = labels.length > 1 ? ` — parcel ${labels.indexOf(l) + 1} of ${labels.length} (#${l.seq})` : ''
    if (l.hold_reason && l.status === 'held') add(l.created_at, `On hold: ${l.hold_reason}${tag}`, null, 'amber')
    add(l.printed_at, `Label printed${tag}`, l.printed_by_name || l.batch?.printed_by_name)
    if (l.reprint_count) add(l.last_reprinted_at, `Reprinted ${l.reprint_count}×${l.last_reprint_reason ? ` — ${l.last_reprint_reason}` : ''}${tag}`, l.last_reprinted_by_name, 'amber')
    add(l.packed_at, `Packed — ready for dispatch${tag}`, l.packed_by_name || l.packer, 'blue')
    if (l.kept_back) add(l.kept_back_at, `Kept back: ${l.kept_back}${tag}`, l.kept_back_by, 'red')
    add(l.dispatched_at, `Dispatched${tag}`, l.dispatched_by_name, 'green')
    if (l.status === 'cancelled') add(l.cancelled_at, `${l.removed_kind ? 'Removed' : 'Cancelled'}: ${l.hold_reason || ''}${tag}`, l.cancelled_by_name, 'red')
  }
  for (const s of d.substitutes || []) add(s.created_at, `Substitute: ${s.product_name || s.name || ''} → ${s.sub_name}${s.units ? ` (${s.units})` : ''}`, s.by_name, 'amber')
  for (const j of d.prints || []) add(j.created_at, `Sent to the Print Station — ${j.title} (${j.status})`, j.sent_by, 'grey')
  for (const p of parcels) {
    add(p.collected_at, `Collected by ${p.carrier || 'the carrier'}`, null, 'grey')
    for (const e of (p.events || []).slice(-12)) add(e.at || e.date || e.time, `${p.carrier || 'Carrier'}: ${e.d || PARCEL[e.s] || 'scan'}`, e.location || null, 'grey')
    add(p.delivered_at, 'Delivered', null, 'green'); add(p.returned_at, 'Returned to sender', null, 'red')
  }
  for (const c of d.cases || []) add(c.created_at, `Case ${c.ref} — ${c.kind?.replace(/_/g, ' ')} (${c.status})`, c.created_by, 'amber')
  for (const r of d.refunds || []) { add(r.requested_at, `Refund ${r.ref} requested — ${r.kind}${r.amount ? ` £${Number(r.amount).toFixed(2)}` : ''}`, r.requested_by, 'amber'); add(r.paid_at, `Refunded £${Number(r.paid_amount || 0).toFixed(2)}`, null, 'red') }
  for (const r of d.returns || []) add(r.received_at || r.created_at, `Return ${r.ref} — ${r.status}${r.condition ? `, ${r.condition}` : ''}`, r.received_by, 'amber')
  for (const r of d.replacements || []) {
    add(r.created_at, `Replacement uploaded — ${r.code} #${r.seq}${r.tracking ? ` · ${r.tracking}` : ''}`, null, 'blue')
    add(r.dispatched_at, `Replacement dispatched${r.tracking ? ` · ${r.tracking}` : ''}`, r.dispatched_by_name, 'green')
    add(r.delivered_at, 'Replacement delivered', null, 'green')
  }
  for (const c of d.claims || []) add(c.created_at, `Claim ${c.ref} — ${c.status}${c.outcome_amount ? `, £${c.outcome_amount}` : ''}`, null, 'amber')
  ev.sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
  // What the forms need, from what we know here (all the order's parcels)
  const p0 = parcels[0] || {}
  const order = {
    label_id: first.id, order_ref: first.channel_ref || first.helm_order, tracking: labels.map(l => l.tracking).filter(Boolean)[0] || p0.tracking,
    batch_code: first.batch?.code, seq: first.seq, stamp: first.label_name || first.batch?.label_name, packer: first.packer || first.packed_by_name,
    carrier: first.batch?.carrier || p0.carrier, channel: helm?.channel || p0.channel, items: first.items || [], contents: d.contents || [], shipped_at: first.dispatched_at || first.printed_at,
    parcel_id: p0.id || null, parcel_status: p0.status, delivered_at: p0.delivered_at, tracking_url: p0.tracking_url, postcode: (first.postcode || '').slice(0, 4),
    order_total: helm?.order_total ?? null, parcels: labels.length,
  }
  const go = (kind, page) => { sendPrefill(kind, order); onNavigate?.(page) }
  const allGone = labels.every(l => l.status === 'dispatched'), someGone = labels.some(l => l.status === 'dispatched')
  const dot = { blue: 'bg-royal-500', green: 'bg-gain', amber: 'bg-warn', red: 'bg-coral', grey: 'bg-ink/30' }
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <button className="btn btn-ghost btn-sm" onClick={onBack}><Icon name="back" size={14} /> Back to search</button>
        <div className="flex gap-2 flex-wrap">
          {canOpen('customer-care') && <button className="btn btn-secondary btn-sm" onClick={() => go('case', 'customer-care')}><Icon name="review" size={14} /> Raise a case</button>}
          {canOpen('customer-care') && <button className="btn btn-secondary btn-sm" onClick={() => go('refund', 'customer-care')}><Icon name="pound" size={14} /> Request a refund</button>}
          {canOpen('returns') && <button className="btn btn-secondary btn-sm" onClick={() => go('return', 'returns')}><Icon name="inbox" size={14} /> Log a return</button>}
          {canOpen('dispatch') && <button className="btn btn-primary btn-sm" onClick={() => setReplacing(true)}><Icon name="swap" size={14} /> Arrange a replacement</button>}
        </div>
      </div>
      <div className="card">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="text-xs text-ink/45">Order</div>
            <div className="text-2xl font-semibold text-ink">{first.channel_ref || first.helm_order || 'No reference'}</div>
            <div className="text-sm text-ink/70 mt-0.5">{[first.customer, first.postcode, helm?.channel].filter(Boolean).join(' · ')}</div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {labels.length > 1 && <Flag tone="blue" icon="box">{labels.length} parcels</Flag>}
            <StatusBadge tone={allGone ? 'live' : someGone ? 'warn' : labels.some(l => l.status === 'held') ? 'alert' : 'quiet'}>
              {allGone ? 'Dispatched' : someGone ? `${labels.filter(l => l.status === 'dispatched').length} of ${labels.length} dispatched` : capFirst([...new Set(labels.map(l => l.status))].join(', '))}
            </StatusBadge>
            {parcels.map(p => p.status != null && <Flag key={p.tracking} tone={p.status === 7 ? 'green' : p.status >= 9 ? 'red' : 'amber'}>{PARCEL[p.status] || 'Tracking'}</Flag>)}
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 text-xs">
          {[['Batch', `${first.batch?.code || ''} · ${fmtDate(first.batch?.ship_date)}`], ['Carrier', `${first.batch?.carrier || ''} ${first.batch?.service || ''}`],
            ['Original tracking', labels.map(l => l.tracking).filter(Boolean).join(', ') || '—'], ['HELM', helm ? `${helm.order_number} · ${HELM_STATUS[helm.status] || helm.status}` : '—'],
            ['Uploaded by', up.uploaded_by_name || '—'], ['Picker', up.picker || '—'], ['Label numbers', labels.map(l => `#${l.seq}`).join(', ')], ['Paid', helm?.order_total ? `£${helm.order_total}` : '—']].map(([k, v]) => (
            <div key={k}><div className="text-ink/45">{k}</div><div className="text-ink font-medium break-words">{v}</div></div>
          ))}
        </div>
        {parcels[0]?.tracking_url && <a className="text-xs text-royal-600 hover:underline mt-2 inline-block" href={parcels[0].tracking_url} target="_blank" rel="noreferrer">Carrier tracking page →</a>}
      </div>

      {d.replacement_of && <div className="card border-l-2 border-l-royal-500 text-sm">This order is <b>a replacement for {d.replacement_of}</b>.</div>}
      {(d.replacements || []).length > 0 && (
        <div className="card border-l-2 border-l-royal-500 space-y-2">
          <div className="section-title">Replacements sent ({d.replacements.length})</div>
          {d.replacements.map(r => (
            <div key={r.id} className="flex items-start justify-between gap-3 flex-wrap border-t border-rule pt-2 first:border-0 first:pt-0">
              <div className="min-w-0">
                <div className="text-sm text-ink"><b>{r.code} #{r.seq}</b> · {itemsText(r.items)}</div>
                <div className="text-xs text-ink/60 break-all">Replacement tracking: <b className="text-ink">{r.tracking || 'not read yet'}</b> · {String(r.carrier || '').split(' ')[0]}</div>
                {r.note && <div className="text-xs text-ink/55">{r.note}</div>}
              </div>
              <div className="flex flex-col items-end gap-1">
                <StatusBadge tone={r.status === 'dispatched' ? 'live' : 'warn'}>{r.status}</StatusBadge>
                {r.parcel_status != null && <Flag tone={r.parcel_status === 7 ? 'green' : 'amber'}>{PARCEL[r.parcel_status] || 'Tracking'}</Flag>}
                {r.tracking_url && <a className="text-xs text-royal-600 hover:underline" href={r.tracking_url} target="_blank" rel="noreferrer">Track the replacement</a>}
              </div>
            </div>
          ))}
        </div>
      )}
      {replacing && <ReplacementModal order={order} contents={d.contents?.length ? d.contents : first.items || []} me={me} onLog={onLog} showToast={showToast}
        products={(inventory?.products || []).filter(p => p.kind !== 'packaging').map(p => ({ id: p.id, code: p.code, label: p.name, sub: p.code }))}
        onClose={() => { setReplacing(false); reload() }} onDone={() => reload()} />}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card space-y-3">
          <div className="section-title">What was in it</div>
          <div><div className="text-xs text-ink/45">Packing slip said</div><div className="text-sm text-ink">{itemsText(first.items) || '—'}</div></div>
          {(d.contents || []).length > 0 && itemsText(d.contents) !== itemsText(first.items) && <div><div className="text-xs text-ink/45">Which is</div><div className="text-sm text-ink">{itemsText(d.contents)}</div></div>}
          {helm && itemsText(helm.items) !== itemsText(first.items) && <div><div className="text-xs text-ink/45">HELM order said</div><div className="text-sm text-ink">{itemsText(helm.items)}</div></div>}
          <div><div className="text-xs text-ink/45">Stamped on the label</div><div className="text-sm font-mono text-ink">{[...new Set(labels.map(l => l.label_name || l.batch?.label_name).filter(Boolean))].join(' / ')}</div></div>
          {(d.substitutes || []).length > 0 && <div><div className="text-xs text-ink/45">Sent instead</div>{d.substitutes.map(s => <div key={s.id} className="text-sm text-warn">{s.product_name || ''} → {s.sub_name} {s.by_name ? `(${s.by_name})` : ''}</div>)}</div>}
        </div>
        <div className="card space-y-3 lg:col-span-2 lg:order-last">
          <div className="section-title">{labels.length > 1 ? `The ${labels.length} parcels` : 'The parcel'}</div>
          <div className={`grid gap-3 ${labels.length > 1 ? 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3' : 'grid-cols-1 md:grid-cols-2'}`}>
            {labels.map((l, k) => {
              const pc = parcels.find(p => p.tracking && p.tracking === l.tracking)
              return (
                <div key={l.id} className="border border-rule rounded-[6px] p-3 space-y-2 bg-white">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <b className="text-sm">{labels.length > 1 ? `Parcel ${k + 1} of ${labels.length}` : 'Parcel'} · #{l.seq}</b>
                    <StatusBadge tone={l.status === 'dispatched' ? 'live' : l.status === 'held' ? 'alert' : l.status === 'cancelled' ? 'quiet' : 'warn'}>{l.status}</StatusBadge>
                  </div>
                  <div className="text-xs text-ink/60 break-all">{l.tracking || 'No tracking number'}{pc?.status != null ? ` · ${PARCEL[pc.status] || ''}` : ''}</div>
                  <div className="text-[11px] text-ink/50 space-y-0.5">
                    {l.printed_at && <div>Printed {when(l.printed_at)}{l.printed_by_name ? ` · ${l.printed_by_name}` : ''}</div>}
                    {l.packed_at && <div>Packed {when(l.packed_at)}{(l.packed_by_name || l.packer) ? ` · ${l.packed_by_name || l.packer}` : ''}</div>}
                    {l.dispatched_at && <div>Dispatched {when(l.dispatched_at)}{l.dispatched_by_name ? ` · ${l.dispatched_by_name}` : ''}</div>}
                    {pc?.delivered_at && <div className="text-gain">Delivered {when(pc.delivered_at)}</div>}
                  </div>
                  {up.storage_path && <LabelImage label={{ ...l, file: { storage_path: up.storage_path }, batch: { ...l.batch, upload: up } }} compact />}
                </div>
              )
            })}
          </div>
        </div>
        <div className="card">
          <div className="section-title mb-3">Everything that happened</div>
          <ol className="relative border-l border-rule ml-1.5 space-y-3">
            {ev.map((e, k) => (
              <li key={k} className="pl-4 relative">
                <span className={`absolute -left-[5px] top-1.5 w-2.5 h-2.5 rounded-full ${dot[e.tone]}`} />
                <div className="text-sm text-ink">{e.what}</div>
                <div className="text-[11px] text-ink/45">{when(e.at)}{e.who ? ` · ${e.who}` : ''}</div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  )
}

/**
 * Arrange a replacement: what's being replaced (from the order — sets opened into their products) and anything
 * extra, then the replacement's label. It's read and saved as a new Dispatch batch, every label marked as a
 * replacement for this order, so it shows here with its own tracking — apart from the original.
 */
export function ReplacementModal({ order, contents = [], products = [], me, onLog, showToast, onClose, onDone }) {
  const [items, setItems] = useState(contents.length === 1 ? contents.map(c => ({ code: c.code, name: c.name, qty: Number(c.qty) || 1 })) : [])
  const [extra, setExtra] = useState('')
  const [file, setFile] = useState(null)
  const [note, setNote] = useState('')
  const [state, setState] = useState(null)     // null | reading | saved | review | error
  const [msg, setMsg] = useState('')
  const toggle = (c) => setItems(xs => xs.some(x => x.code === c.code) ? xs.filter(x => x.code !== c.code) : [...xs, { code: c.code, name: c.name, qty: Number(c.qty) || 1 }])
  const submit = async () => {
    setState('reading'); setMsg('Reading the label…')
    const { startJob, subscribeJobs } = await import('../lib/dispatchJobs')
    const ref = order.order_ref
    const id = startJob(file, { title: `Replacement for ${ref}`, me, onLog, manualAll: { items, note: note.trim() || `Replacement for ${ref}`, originalRef: ref } })
    const stop = subscribeJobs(jobs => {
      const j = jobs.find(x => x.id === id)
      if (!j) return
      if (j.status === 'saved') { setState('saved'); setMsg(`Saved as batch ${j.result?.upload?.code || ''} — ready to print in Dispatch`); stop?.(); onDone?.() }
      else if (j.status === 'review') { setState('review'); setMsg('Almost — it needs a quick look in Dispatch (e.g. which carrier) before it saves. Open Dispatch to finish it.'); stop?.() }
      else if (j.status === 'error') { setState('error'); setMsg(j.error || 'Couldn’t read that file'); stop?.() }
    })
  }
  return (
    <div className="fixed inset-0 z-50 bg-ink/40 flex items-center justify-center p-4" role="dialog" aria-label="Arrange a replacement">
      <div className="bg-white rounded-[10px] shadow-modal w-full max-w-lg max-h-[92vh] overflow-y-auto">
        <div className="px-5 py-4 border-b border-rule flex items-start justify-between gap-3">
          <div><div className="modal-title font-semibold text-base text-ink">Arrange a replacement</div>
            <div className="text-xs text-ink/55 mt-0.5">For {order.order_ref}{order.carrier ? ` · first sent ${String(order.carrier).split(' ')[0]}` : ''}</div></div>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" size={16} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <div className="label">What's being replaced</div>
            <div className="border border-rule rounded-[6px] divide-y divide-rule/70">
              {contents.map(c => {
                const on = items.find(x => x.code === c.code)
                return (
                  <div key={c.code} className="flex items-center gap-2 px-3 py-2">
                    <input type="checkbox" className="w-5 h-5 accent-royal-500" checked={!!on} onChange={() => toggle(c)} aria-label={c.name} />
                    <span className="flex-1 text-sm">{c.name}</span>
                    {on && <input type="number" min="1" className="input w-16 text-sm" value={on.qty} onChange={e => setItems(xs => xs.map(x => x.code === c.code ? { ...x, qty: Math.max(1, Number(e.target.value) || 1) } : x))} />}
                  </div>
                )
              })}
            </div>
          </div>
          <div>
            <div className="label">Anything else going in it?</div>
            <SuggestInput value={extra} onChange={setExtra} options={products} placeholder="Add a product"
              onPick={o => { if (o) { setItems(xs => xs.some(x => x.code === o.code) ? xs : [...xs, { code: o.code, name: o.label, qty: 1 }]); setExtra('') } }} />
            {items.filter(i => !contents.some(c => c.code === i.code)).map(i => (
              <div key={i.code} className="flex items-center gap-2 text-sm mt-1.5">
                <input type="number" min="1" className="input w-16" value={i.qty} onChange={e => setItems(xs => xs.map(x => x.code === i.code ? { ...x, qty: Math.max(1, Number(e.target.value) || 1) } : x))} />
                <span className="flex-1">{i.name}</span><Flag tone="blue">Added</Flag>
                <button className="btn btn-ghost btn-xs" onClick={() => setItems(xs => xs.filter(x => x.code !== i.code))}><Icon name="close" size={12} /></button>
              </div>
            ))}
          </div>
          <div>
            <div className="label">The replacement's label</div>
            <label className={`flex items-center gap-3 border-2 border-dashed rounded-[8px] px-4 py-3 cursor-pointer ${file ? 'border-royal-300 bg-sky/30' : 'border-rule hover:border-royal-300'}`}>
              <Icon name="upload" size={18} />
              <span className="text-sm">{file ? file.name : 'Choose the label PDF (from HELM or the marketplace)'}</span>
              <input type="file" accept="application/pdf,image/*" className="hidden" onChange={e => setFile(e.target.files?.[0] || null)} />
            </label>
          </div>
          <div><label className="label" htmlFor="rp-note">Note (optional)</label>
            <input id="rp-note" className="input text-base sm:text-sm" value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. 250ml jug missing from the first parcel" /></div>
          {msg && <div className={`text-sm ${state === 'error' ? 'text-loss' : state === 'saved' ? 'text-gain font-semibold' : 'text-ink/70'}`}>{msg}</div>}
          {state === 'saved' || state === 'review' ? (
            <button className="btn btn-primary w-full justify-center" onClick={onClose}>Done</button>
          ) : (
            <button className="btn btn-primary w-full justify-center" disabled={!items.length || !file || state === 'reading'} onClick={submit}>
              {state === 'reading' ? 'Reading the label…' : !items.length ? 'Tick what’s being replaced' : !file ? 'Add the replacement’s label' : 'Upload the replacement'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
