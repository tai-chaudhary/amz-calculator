import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { PageHeader, Icon, SearchInput, EmptyState, Drawer, Modal, Spinner, StatusBadge, Flag, SegmentedControl, SuggestInput, MetricCard } from './UI'
import { loadCare, addCare, saveCare, uploadCarePhotos, invAdjust } from '../lib/db'
import { smartFilter, hay } from '../lib/match'
import { takePrefill } from './OrderAuditPage'
import { OrderFinder, OrderCard, ItemsPicker, contentsOf, startPicked, PhotoPicker, Photos, History, RETURN_REASONS, CONDITIONS, day, itemsText } from './CareParts'

/**
 * Returns (warehouse, Oct 2026): everything that comes back. From a customer (often one the office asked for), or
 * from the carrier — undeliverable, refused, damaged in transit. Logged the day it arrives with photos, the product,
 * its condition, and who it's from: the order if it can be found (by ref, tracking, or the name / postcode on the
 * label); if not, what's on the label and the slip. Then it's back in stock (added to Inventory) or written off.
 * Returns the office is expecting are listed first, so the warehouse can tick them off.
 */
export const RETURN_STATUS = {
  expected: { label: 'Expected back', tone: 'warn' }, received: { label: 'Received — to sort', tone: 'alert' },
  restocked: { label: 'Back in stock', tone: 'live' }, written_off: { label: 'Written off', tone: 'quiet' }, closed: { label: 'Closed', tone: 'quiet' },
}

export default function ReturnsPage({ me, showToast, inventory }) {
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
  const today = new Date().toISOString().slice(0, 10)
  const VIEWS = {
    expected: r => r.status === 'expected',
    sort: r => r.status === 'received',
    today: r => String(r.received_at || '').slice(0, 10) === today,
    all: () => true,
  }
  const list = smartFilter(rows.filter(VIEWS[view]), q, r => hay(r.ref, r.order_ref, r.tracking, r.from_name, r.from_postcode, itemsText(r.items), r.carrier, r.delivered_by), { keepOrder: true })
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
                          <Flag tone={r.source === 'carrier' ? 'amber' : 'blue'}>{r.source === 'carrier' ? 'From the carrier' : 'From a customer'}</Flag>
                          <span className="text-xs text-ink/55">{RETURN_REASONS[r.reason] || r.reason}</span>
                          {waited != null && waited >= 14 && <Flag tone="red" icon="clock">Expected {waited} days</Flag>}
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
      {logging && <LogReturn me={me} expected={logging.expected} initialOrder={logging.order || null} products={products} showToast={showToast} onClose={() => setLogging(null)}
        onSaved={(row) => { changed(row); setLogging(null); setOpenId(row.id) }} />}
      {open && <ReturnDrawer r={open} me={me} inventory={inventory} showToast={showToast} onClose={() => setOpenId(null)} onChanged={changed} />}
    </div>
  )
}

function LogReturn({ me, expected, initialOrder = null, products, showToast, onClose, onSaved }) {
  const [source, setSource] = useState(expected?.source || 'customer')
  const [reason, setReason] = useState(expected?.reason || 'not_happy')
  const [order, setOrder] = useState(initialOrder)
  const [unknown, setUnknown] = useState(false)
  const [from, setFrom] = useState({ name: '', postcode: '', tracking: expected?.tracking || '', carrier: '', note: '' })
  const [items, setItems] = useState(expected ? (expected.items || []).map((i, k) => ({ key: `${k}|${i.code || i.name}`, name: i.name || i.code, code: i.code, product_id: i.product_id || null, qty: Number(i.qty) || 1 })) : startPicked(initialOrder))
  const [typed, setTyped] = useState('')
  const [condition, setCondition] = useState('resaleable')
  const [files, setFiles] = useState([])
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const orderItems = order ? contentsOf(order) : expected?.items || []
  const ok = items.length > 0 && (expected || order || unknown) && condition && files.length > 0
  return (
    <Modal title={expected ? `${expected.ref} has arrived` : 'Log a return'} description={expected ? `${itemsText(expected.items)}${expected.order_ref ? ` · ${expected.order_ref}` : ''}` : 'What came back, who from, and what state it’s in.'} onClose={onClose} maxWidth="max-w-lg">
      <div className="space-y-3">
        {!expected && (
          <>
            <div><div className="label">Who sent it back?</div>
              <SegmentedControl value={source} onChange={v => { setSource(v); setReason(v === 'carrier' ? 'returned_to_sender' : 'not_happy') }} label="From" items={[{ id: 'customer', label: 'A customer' }, { id: 'carrier', label: 'The carrier' }]} /></div>
            <div><label className="label" htmlFor="rt-why">Why</label>
              <select id="rt-why" className="input" value={reason} onChange={e => setReason(e.target.value)}>
                {(source === 'carrier' ? ['returned_to_sender', 'refused', 'damaged', 'other'] : ['not_happy', 'wrong_item', 'damaged', 'faulty', 'changed_mind', 'other']).map(k => <option key={k} value={k}>{RETURN_REASONS[k]}</option>)}
              </select></div>
            {order ? <OrderCard o={order} onChange={() => { setOrder(null); setItems([]) }} /> : !unknown ? (
              <div>
                <div className="label">Which order? (look on the label or the slip inside)</div>
                <OrderFinder allowNames onPick={(o) => { setOrder(o); setItems(startPicked(o)) }} />
                <button type="button" className="btn btn-ghost btn-xs mt-1" onClick={() => setUnknown(true)}>Can’t find the order</button>
              </div>
            ) : (
              <div className="card space-y-2">
                <div className="flex items-center justify-between"><div className="section-title">Who it’s from</div><button type="button" className="btn btn-ghost btn-xs" onClick={() => setUnknown(false)}>Search again</button></div>
                <input className="input text-base sm:text-sm" placeholder="Name on the label or slip" value={from.name} onChange={e => setFrom(f => ({ ...f, name: e.target.value }))} />
                <input className="input text-base sm:text-sm" placeholder="Postcode" value={from.postcode} onChange={e => setFrom(f => ({ ...f, postcode: e.target.value.toUpperCase() }))} />
                <input className="input text-base sm:text-sm" placeholder="Tracking number on the parcel" value={from.tracking} onChange={e => setFrom(f => ({ ...f, tracking: e.target.value.toUpperCase() }))} />
                <select className="input" value={from.carrier} onChange={e => setFrom(f => ({ ...f, carrier: e.target.value }))}>
                  <option value="">Which carrier brought it back?</option>{['Evri', 'DHL', 'Royal Mail', 'Parcelforce', 'Other'].map(c => <option key={c}>{c}</option>)}
                </select>
                <input className="input text-base sm:text-sm" placeholder="Anything else on the label or slip (order no., marketplace…)" value={from.note} onChange={e => setFrom(f => ({ ...f, note: e.target.value }))} />
              </div>
            )}
          </>
        )}
        {orderItems.length > 0 ? <ItemsPicker items={orderItems} ordered={order?.items || null} value={items} onChange={setItems} /> : (
          <div>
            <div className="label">What’s in it?</div>
            <div className="flex gap-2">
              <div className="flex-1"><SuggestInput value={typed} onChange={setTyped} options={products} placeholder="Product"
                onPick={o => { if (o) { setItems(xs => [...xs, { key: `p|${o.id}`, name: o.label, code: o.sub, product_id: o.id, qty: 1 }]); setTyped('') } }} /></div>
              <button type="button" className="btn btn-secondary btn-sm" disabled={!typed.trim()} onClick={() => { setItems(xs => [...xs, { key: `t|${typed}`, name: typed.trim(), qty: 1 }]); setTyped('') }}>Add</button>
            </div>
            {items.map(i => (
              <div key={i.key} className="flex items-center gap-2 text-sm mt-1.5">
                <input type="number" min="1" className="input w-16" value={i.qty} onChange={e => setItems(xs => xs.map(x => x.key === i.key ? { ...x, qty: Number(e.target.value) || 1 } : x))} />
                <span className="flex-1">{i.name}</span>
                <button type="button" className="btn btn-ghost btn-xs" onClick={() => setItems(xs => xs.filter(x => x.key !== i.key))}><Icon name="close" size={12} /></button>
              </div>
            ))}
          </div>
        )}
        <div><div className="label">What state is it in?</div>
          <div className="grid grid-cols-3 gap-2">{Object.entries(CONDITIONS).map(([k, v]) => <button key={k} type="button" className={`btn btn-sm justify-center ${condition === k ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setCondition(k)}>{v}</button>)}</div></div>
        <PhotoPicker files={files} onChange={setFiles} label="Photos (the parcel, the label, the product)" />
        <div><label className="label" htmlFor="rt-notes">Notes</label><input id="rt-notes" className="input text-base sm:text-sm" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Anything worth knowing" /></div>
        <button className="btn btn-primary w-full justify-center" disabled={busy || !ok} onClick={async () => {
          setBusy(true)
          try {
            const now = new Date().toISOString()
            const base = {
              status: 'received', condition, received_at: now, received_by: me?.name || null, notes: notes.trim() || expected?.notes || null,
              items: items.map(({ key, ...i }) => i),
            }
            let row
            if (expected) row = await saveCare('returns', expected, base, `Arrived — ${CONDITIONS[condition]}`, me?.name)
            else row = await addCare('returns', {
              ...base, source, reason, ordered: order?.items || [], order_ref: order?.order_ref || null, tracking: order?.tracking || from.tracking || null,
              carrier: order?.carrier || null, channel: order?.channel || null, delivered_by: from.carrier || null,
              from_name: from.name.trim() || null, from_postcode: from.postcode.trim() || null, label_note: from.note.trim() || null,
            }, me?.name)
            const paths = await uploadCarePhotos(row.id, files)
            row = await saveCare('returns', row, { photos: [...(row.photos || []), ...paths] }, null, me?.name)
            showToast?.(`${row.ref} logged`)
            onSaved(row)
          } catch (e) { showToast?.(`Couldn't save — ${e?.message || 'try again'}`, 'error'); setBusy(false) }
        }}>{!items.length ? 'Say what’s in it' : !files.length ? 'Add at least one photo' : busy ? 'Saving…' : 'Log it'}</button>
      </div>
    </Modal>
  )
}

function ReturnDrawer({ r, me, inventory, showToast, onClose, onChanged }) {
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
          <div className="text-sm text-ink">{itemsText(r.items) || 'Product not set'}</div>
          <div className="text-xs text-ink/55">{[r.order_ref, r.tracking, r.delivered_by || r.carrier].filter(Boolean).join(' · ')}</div>
          {(r.from_name || r.from_postcode || r.label_note) && <div className="text-xs text-ink/55">From: {[r.from_name, r.from_postcode, r.label_note].filter(Boolean).join(' · ')}</div>}
          {r.condition && <Flag tone={r.condition === 'resaleable' ? 'green' : 'red'}>{CONDITIONS[r.condition]}</Flag>}
          {r.received_at && <div className="text-[11px] text-ink/45">Received {day(r.received_at)}{r.received_by ? ` by ${r.received_by}` : ''}</div>}
        </div>
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
