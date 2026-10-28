import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { londonToday } from '../lib/dates'
import { PageHeader, Icon, SearchInput, EmptyState, Drawer, Modal, Spinner, StatusBadge, Flag, SegmentedControl, SuggestInput, MetricCard } from './UI'
import { loadCare, addCare, saveCare, uploadCarePhotos, invAdjust, findCareOrder } from '../lib/db'
import { smartFilter, hay } from '../lib/match'
import { takePrefill } from './OrderAuditPage'
import { OrderFinder, OrderCard, ItemsPicker, contentsOf, startPicked, QtyInput, PhotoPicker, Photos, History, RETURN_REASONS, CONDITIONS, day, itemsText } from './CareParts'

/**
 * Returns (warehouse, Oct 2026): everything that comes back. From a customer (often one the office asked for), or
 * from the carrier — undeliverable, refused, damaged in transit. Logged the day it arrives with photos, the product,
 * its condition, and who it's from: the order if it can be found (by ref, tracking, or the name / postcode on the
 * label); if not, what's on the label and the slip. Then it's back in stock (added to Inventory) or written off.
 * Returns the office is expecting are listed first, so the warehouse can tick them off.
 */
export const RETURN_STATUS = {
  expected: { label: 'Expected back', tone: 'warn' }, received: { label: 'Received — to sort', tone: 'alert' },
  restocked: { label: 'Back in stock', tone: 'live' }, processed: { label: 'Sorted — part back in stock', tone: 'live' }, written_off: { label: 'Written off', tone: 'quiet' }, closed: { label: 'Closed', tone: 'quiet' },
}

export default function ReturnsPage({ me, showToast, inventory, office = false }) {
  const [data, setData] = useState(null)
  const [view, setView] = useState('expected')
  const [q, setQ] = useState('')
  const [openId, setOpenId] = useState(null)
  const [logging, setLogging] = useState(null)       // null | {} | { expected: row }
  const load = useCallback(() => loadCare().then(setData).catch(() => setData({ returns: [] })), [])
  useEffect(() => { load() }, [load])
  // Sent from Order Audit: start logging with the order filled in
  useEffect(() => { const p = takePrefill(['return']); if (p) setLogging({ order: p.order }) }, [])
  const rows = data?.returns || []
  const today = londonToday()
  const VIEWS = {
    expected: r => r.status === 'expected',
    sort: r => r.status === 'received',
    today: r => String(r.received_at || '').slice(0, 10) === today,
    all: () => true,
  }
  const list = smartFilter(rows.filter(VIEWS[view]), q, r => hay(r.ref, r.order_ref, r.tracking, r.return_tracking, r.from_name, r.from_postcode, itemsText(r.items), r.carrier, r.delivered_by), { keepOrder: true })
  const changed = (row) => setData(d => ({ ...d, returns: d.returns.some(x => x.id === row.id) ? d.returns.map(x => x.id === row.id ? row : x) : [row, ...d.returns] }))
  const open = rows.find(r => r.id === openId)
  const products = useMemo(() => (inventory?.products || []).filter(p => p.kind !== 'packaging').map(p => ({ id: p.id, label: p.name, sub: p.code, product: p })), [inventory])

  return (
    <div>
      <PageHeader eyebrow="Warehouse / returns" title="Returns"
        description="Log everything that comes back, the day it arrives: from customers, and from carriers (undeliverable, refused, damaged in transit)."
        actions={<button className="btn btn-primary btn-sm" onClick={() => setLogging({})}><Icon name="plus" size={14} /> Log a return</button>} />
      {!data ? <Spinner /> : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <MetricCard label="Expected back" value={rows.filter(VIEWS.expected).length} color={rows.some(VIEWS.expected) ? 'text-warn' : 'text-ink'} onClick={() => setView('expected')} />
            <MetricCard label="To sort" value={rows.filter(VIEWS.sort).length} sub="received, not put back" color={rows.some(VIEWS.sort) ? 'text-loss' : 'text-ink'} onClick={() => setView('sort')} />
            <MetricCard label="Logged today" value={rows.filter(VIEWS.today).length} onClick={() => setView('today')} />
            <MetricCard label="Expected 14+ days" value={rows.filter(r => r.status === 'expected' && Date.now() - Date.parse(r.created_at) > 14 * 864e5).length} sub="not back yet" />
          </div>
          <div className="filter-bar">
            <SegmentedControl value={view} onChange={setView} label="Show" items={[
              { id: 'expected', label: `Expected ${rows.filter(VIEWS.expected).length}` }, { id: 'sort', label: `To sort ${rows.filter(VIEWS.sort).length}` },
              { id: 'today', label: 'Today' }, { id: 'all', label: 'All' }]} />
            <SearchInput value={q} onChange={e => setQ(e.target.value)} placeholder="Ref, order, tracking, name, postcode, product" className="w-full sm:w-80 sm:ml-auto" />
          </div>
          {!list.length ? <div className="surface"><EmptyState icon="inbox" title={view === 'expected' ? 'Nothing expected back' : 'No returns here'} sub="Tap “Log a return” when something comes back." /></div> : (
            <div className="card p-0 overflow-hidden">
              {list.map(r => {
                const st = RETURN_STATUS[r.status] || RETURN_STATUS.expected
                const waited = r.status === 'expected' ? Math.floor((Date.now() - Date.parse(r.created_at)) / 864e5) : null
                return (
                  <button key={r.id} className="w-full text-left px-4 py-3 border-b border-rule last:border-0 hover:bg-paper/70" onClick={() => r.status === 'expected' ? setLogging({ expected: r }) : setOpenId(r.id)}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-sm">{r.ref}</span>
                          {r.source !== 'unknown' && <Flag tone={r.source === 'carrier' ? 'amber' : 'blue'}>{r.source === 'carrier' ? 'From the carrier' : 'From a customer'}</Flag>}
                          <span className="text-xs text-ink/55">{RETURN_REASONS[r.reason] || r.reason}</span>
                          {waited != null && waited >= 14 && <Flag tone="red" icon="clock">Expected {waited} days</Flag>}
                          {r.needs_match && <Flag tone="amber">Office to find the order</Flag>}
                        </div>
                        <div className="text-sm text-ink mt-0.5 truncate">{itemsText(r.items) || 'Product not set'}</div>
                        <div className="text-xs text-ink/50">{[r.order_ref || (r.from_name && `From ${r.from_name}`), r.from_postcode, r.delivered_by || r.carrier, day(r.received_at || r.created_at)].filter(Boolean).join(' · ')}</div>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <StatusBadge tone={st.tone}>{st.label}</StatusBadge>
                        {r.status === 'expected' && <span className="text-xs text-royal-600 font-semibold">It’s arrived →</span>}
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </>
      )}
      {logging && <LogReturn me={me} inventory={inventory} expected={logging.expected} initialOrder={logging.order || null} products={products} showToast={showToast} onClose={() => setLogging(null)}
        onSaved={(row) => { changed(row); setLogging(null); setOpenId(row.id) }} />}
      {open && <ReturnDrawer r={open} me={me} office={office} inventory={inventory} showToast={showToast} onClose={() => setOpenId(null)} onChanged={changed} />}
    </div>
  )
}

/** A product's pick shelf (or its first shelf) — where a resaleable return goes unless changed. */
const shelfOf = (p) => (p?.locations || []).find(l => l.pickable)?.code || p?.locations?.[0]?.code || ''

/**
 * Something's come back (warehouse). What they know is what's on the box and what's inside: the tracking number,
 * the products, each one's condition. Resaleable goes back on a shelf (its pick shelf, changeable); damaged is
 * disposed of. Both happen as it's logged. The portal then tries to match it to an order (an expected return, or
 * an order with that tracking); if it can't, the office finds the order (To match).
 */
function LogReturn({ me, expected, initialOrder = null, products, inventory, showToast, onClose, onSaved }) {
  const invById = useMemo(() => new Map((inventory?.products || []).map(p => [p.id, p])), [inventory])
  const invByName = useMemo(() => new Map((inventory?.products || []).map(p => [String(p.name).toLowerCase(), p])), [inventory])
  const productFor = (i) => invById.get(i.product_id) || invByName.get(String(i.name || '').toLowerCase()) || null
  const lineFor = (i, k) => {
    const p = productFor(i)
    return { key: `${k}|${i.code || i.name}`, name: i.name || i.code, code: i.code || p?.code, product_id: p?.id || i.product_id || null, qty: Number(i.qty) || 1, condition: 'resaleable', location: shelfOf(p) }
  }
  const [tracking, setTracking] = useState(expected?.return_tracking || '')
  const [delivered, setDelivered] = useState('')
  const [items, setItems] = useState(() => (expected?.items || initialOrder?.contents || initialOrder?.items || []).map(lineFor))
  const [typed, setTyped] = useState('')
  const [files, setFiles] = useState([])
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (key, patch) => setItems(xs => xs.map(x => (x.key === key ? { ...x, ...patch } : x)))
  const ok = items.length > 0 && files.length > 0 && (expected || tracking.trim().length >= 6) && items.every(i => i.condition === 'damaged' || (i.location && i.product_id))
  const why = !items.length ? 'Say what’s in it' : !expected && tracking.trim().length < 6 ? 'Add the tracking number on the box'
    : items.some(i => i.condition !== 'damaged' && !i.product_id) ? 'Pick the product from the list (so it can go back in stock)'
    : items.some(i => i.condition !== 'damaged' && !i.location) ? 'Say which shelf it’s going on' : !files.length ? 'Add at least one photo' : null

  const save = async () => {
    setBusy(true)
    try {
      const now = new Date().toISOString()
      const lines = items.map(({ key, ...i }) => ({ ...i, outcome: i.condition === 'damaged' ? 'disposed' : 'back_in_stock', location: i.condition === 'damaged' ? null : i.location }))
      const back = lines.filter(l => l.outcome === 'back_in_stock'), gone = lines.filter(l => l.outcome === 'disposed')
      const status = !gone.length ? 'restocked' : !back.length ? 'written_off' : 'processed'
      const base = { status, items: lines, condition: gone.length ? (back.length ? 'part_damaged' : 'damaged') : 'resaleable', outcome: status === 'processed' ? 'mixed' : status === 'restocked' ? 'back_in_stock' : 'disposed',
        received_at: now, received_by: me?.name || null, notes: notes.trim() || expected?.notes || null }
      // Try to match it to an order: one the office is expecting back, or an order with that tracking number
      let row, matched = null
      if (expected) row = await saveCare('returns', expected, { ...base, return_tracking: tracking.trim() || expected.return_tracking || null }, `Arrived — ${back.length} back in stock, ${gone.length} disposed`, me?.name)
      else {
        const hits = tracking.trim() ? await findCareOrder(tracking.trim()).catch(() => []) : []
        const one = Array.isArray(hits) && hits.length === 1 ? hits[0] : null
        if (one) matched = one
        row = await addCare('returns', {
          ...base, source: one ? 'carrier' : 'unknown', reason: one ? 'returned_to_sender' : 'to_check', return_tracking: tracking.trim(), delivered_by: delivered || null,
          ...(one ? { order_ref: one.order_ref, tracking: one.tracking, carrier: one.carrier, channel: one.channel, ordered: one.items || [], matched_at: now, matched_by: 'Matched by tracking number' } : { needs_match: true }),
        }, me?.name)
      }
      // Back on the shelf: stock goes up as it's logged
      for (const l of back) {
        if (!l.product_id) continue
        await invAdjust({ productId: l.product_id, location: l.location, qty: l.qty, reason: 'Customer return', note: `${row.ref}${row.order_ref ? ` · ${row.order_ref}` : ''}`, by: me?.name })
      }
      const paths = await uploadCarePhotos(row.id, files)
      row = await saveCare('returns', row, { photos: [...(row.photos || []), ...paths] }, null, me?.name)
      showToast?.(`${row.ref} logged — ${back.length ? `${back.reduce((t, l) => t + l.qty, 0)} back in stock` : ''}${back.length && gone.length ? ', ' : ''}${gone.length ? `${gone.reduce((t, l) => t + l.qty, 0)} disposed` : ''}${expected || matched ? '' : ' · the office will find the order'}`)
      onSaved(row)
    } catch (e) { showToast?.(`Couldn't save — ${e?.message || 'try again'}`, 'error'); setBusy(false) }
  }

  return (
    <Modal title={expected ? `${expected.ref} has arrived` : 'Something’s come back'} description={expected ? `${itemsText(expected.items)}${expected.order_ref ? ` · ${expected.order_ref}` : ''}` : 'What’s on the box, what’s inside, and what state it’s in.'} onClose={onClose} maxWidth="max-w-lg">
      <div className="space-y-3">
        {!expected && (
          <>
            <div><label className="label" htmlFor="rt-trk">Tracking number on the box</label>
              <input id="rt-trk" className="input text-base sm:text-sm font-mono" value={tracking} onChange={e => setTracking(e.target.value.toUpperCase().replace(/\s+/g, ''))} placeholder="Scan or type it" />
              <div className="text-[11px] text-ink/45 mt-1">The return label's — or the original label if the carrier sent it back.</div></div>
            <div><label className="label" htmlFor="rt-car">Who brought it back? (optional)</label>
              <select id="rt-car" className="input" value={delivered} onChange={e => setDelivered(e.target.value)}>
                <option value="">Not sure</option>{['Evri', 'DHL', 'Royal Mail', 'Parcelforce', 'Other'].map(c => <option key={c}>{c}</option>)}
              </select></div>
          </>
        )}
        <div>
          <div className="label">What’s inside — and what state is each in?</div>
          <div className="space-y-2">
            {items.map(i => (
              <div key={i.key} className="card p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <QtyInput value={i.qty} onChange={n => set(i.key, { qty: n })} />
                  <span className="flex-1 text-sm text-ink">{i.name}</span>
                  <button type="button" className="btn btn-ghost btn-xs" onClick={() => setItems(xs => xs.filter(x => x.key !== i.key))} aria-label="Remove"><Icon name="close" size={12} /></button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" className={`btn btn-sm justify-center ${i.condition !== 'damaged' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => set(i.key, { condition: 'resaleable' })}>Fine — back in stock</button>
                  <button type="button" className={`btn btn-sm justify-center ${i.condition === 'damaged' ? 'btn-danger' : 'btn-secondary'}`} onClick={() => set(i.key, { condition: 'damaged' })}>Damaged — dispose</button>
                </div>
                {i.condition !== 'damaged' && (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-ink/60">Shelf</span>
                    <input className="input w-36 font-mono uppercase text-base sm:text-sm" value={i.location} onChange={e => set(i.key, { location: e.target.value.toUpperCase() })} placeholder="e.g. C-5-1-1" />
                    {i.product_id && i.location === shelfOf(productFor(i)) && <span className="text-[11px] text-ink/45">its pick shelf</span>}
                  </div>
                )}
              </div>
            ))}
            <div className="flex gap-2">
              <div className="flex-1"><SuggestInput value={typed} onChange={setTyped} options={products} placeholder="Add a product"
                onPick={o => { if (o) { const p = invById.get(o.id); setItems(xs => [...xs, { key: `p|${o.id}|${xs.length}`, name: o.label, code: o.sub, product_id: o.id, qty: 1, condition: 'resaleable', location: shelfOf(p) }]); setTyped('') } }} /></div>
            </div>
          </div>
        </div>
        <PhotoPicker files={files} onChange={setFiles} label="Photos (the box, its label, what's inside)" />
        <div><label className="label" htmlFor="rt-notes">Notes (optional)</label><input id="rt-notes" className="input text-base sm:text-sm" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Anything on the label or a slip inside" /></div>
        <button className="btn btn-primary w-full justify-center" disabled={busy || !ok} onClick={save}>{why || (busy ? 'Saving…' : 'Log it')}</button>
      </div>
    </Modal>
  )
}

function ReturnDrawer({ r, me, office = false, inventory, showToast, onClose, onChanged }) {
  const [busy, setBusy] = useState(false)
  const st = RETURN_STATUS[r.status] || RETURN_STATUS.expected
  const invByName = useMemo(() => new Map((inventory?.products || []).map(p => [String(p.name).toLowerCase(), p])), [inventory])
  const save = async (patch, what) => { setBusy(true); try { onChanged(await saveCare('returns', r, patch, what, me?.name)) } catch (e) { showToast?.(e?.message || 'Couldn’t save', 'error') } finally { setBusy(false) } }
  const backInStock = async () => {
    setBusy(true)
    try {
      // Each product back on its shelf (its pick shelf if it has one), noted as a customer return
      for (const it of r.items || []) {
        const p = (inventory?.products || []).find(x => x.id === it.product_id) || invByName.get(String(it.name || '').toLowerCase())
        if (!p) continue
        const loc = (p.locations || []).find(l => l.pickable)?.code || p.locations?.[0]?.code || ''
        await invAdjust({ productId: p.id, location: loc, qty: Number(it.qty) || 1, reason: 'Customer return', note: `${r.ref}${r.order_ref ? ` · ${r.order_ref}` : ''}`, by: me?.name })
      }
      onChanged(await saveCare('returns', r, { status: 'restocked', outcome: 'back_in_stock' }, 'Back in stock (added to Inventory)', me?.name))
      showToast?.('Back in stock')
    } catch (e) { showToast?.(e?.message || 'Couldn’t add it to stock', 'error') } finally { setBusy(false) }
  }
  return (
    <Drawer title={r.ref} onClose={onClose} description={`${RETURN_REASONS[r.reason] || r.reason} · ${r.source === 'carrier' ? 'from the carrier' : 'from a customer'}`}>
      <div className="space-y-4">
        <div className="card space-y-1.5">
          <StatusBadge tone={st.tone}>{st.label}</StatusBadge>
          {(r.items || []).some(i => i.outcome) ? (
            <div className="space-y-0.5">{r.items.map((i, k) => (
              <div key={k} className="text-sm text-ink">{i.qty} × {i.name} — {i.outcome === 'disposed' ? <span className="text-loss">damaged, disposed</span> : <span className="text-gain">back in stock on <b className="font-mono">{i.location}</b></span>}</div>
            ))}</div>
          ) : <div className="text-sm text-ink">{itemsText(r.items) || 'Product not set'}</div>}
          {r.needs_match && <Flag tone="amber">The office will find which order this was</Flag>}
          <div className="text-xs text-ink/55">{[r.order_ref, r.tracking, r.delivered_by || r.carrier].filter(Boolean).join(' · ')}</div>
          {r.return_tracking && <div className="text-xs text-ink/70">Return label tracking: <b className="font-mono">{r.return_tracking}</b></div>}
          {(r.from_name || r.from_postcode || r.label_note) && <div className="text-xs text-ink/55">From: {[r.from_name, r.from_postcode, r.label_note].filter(Boolean).join(' · ')}</div>}
          {r.condition && <Flag tone={r.condition === 'resaleable' ? 'green' : 'red'}>{CONDITIONS[r.condition]}</Flag>}
          {r.received_at && <div className="text-[11px] text-ink/45">Received {day(r.received_at)}{r.received_by ? ` by ${r.received_by}` : ''}</div>}
        </div>
        {office && (
          <div className="card space-y-2">
            <div className="section-title">Why it came back {r.reason === 'to_check' && <Flag tone="amber">Office to fill in</Flag>}</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <select className="input" value={r.source || 'unknown'} onChange={e => save({ source: e.target.value }, `From: ${e.target.value === 'carrier' ? 'the carrier' : e.target.value === 'customer' ? 'a customer' : 'not known'}`)}>
                <option value="unknown">Not known</option><option value="customer">A customer</option><option value="carrier">The carrier</option>
              </select>
              <select className="input" value={r.reason} onChange={e => save({ reason: e.target.value }, `Reason: ${RETURN_REASONS[e.target.value]}`)}>
                {Object.entries(RETURN_REASONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
          </div>
        )}
        {r.status === 'received' && (
          <div className="card flex gap-2 flex-wrap">
            <button className="btn btn-primary btn-sm" disabled={busy || r.condition !== 'resaleable'} onClick={backInStock} title={r.condition !== 'resaleable' ? 'Only for ones that can be resold' : ''}><Icon name="box" size={13} /> Back in stock</button>
            <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => save({ status: 'written_off', outcome: 'written_off' }, 'Written off')}>Write off</button>
          </div>
        )}
        <Photos rec={r} table="returns" me={me} onChanged={onChanged} showToast={showToast} />
        <History list={r.history} />
      </div>
    </Drawer>
  )
}
