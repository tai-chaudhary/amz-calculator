import React, { useState, useRef } from 'react'
import { smartFilter, matches, hay } from '../lib/match'
import { GROUPS, groupExpected, toCome, arrivalOf, bookingLines, needsOffice, deliveryUnits } from '../lib/goodsIn'
import { PageHeader, Icon, StatusBadge, SegmentedControl, SearchInput, EmptyState, Drawer, Modal , SuggestInput } from './UI'
import { expectsDelivery } from '../lib/purchases'
import PutAwaySheet from './PutAwaySheet'

const num = (v) => (Number.isFinite(parseFloat(v)) ? parseFloat(v) : 0)
const when = (d) => (d ? new Date(d).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '')
const rememberedWho = () => { try { return localStorage.getItem('sr-who') || '' } catch { return '' } }
const rememberWho = (n) => { try { localStorage.setItem('sr-who', n) } catch { /* fine */ } }

/**
 * Deliveries, as the warehouse handles them: what's coming, booking it in,
 * putting it away, and anything that turned up without an order.
 * Names, quantities and dates only — never a price.
 */
export default function GoodsInPage({
  me, orders = [], deliveries = [], people = [], focusId, canOrder = false, purchaseOrders = [],
  onBookIn, onUnexpected, onUpdateDelivery, onUploadPhoto, onViewPhoto, onRefresh, onOpenPo,
  inventory = null, office = false, showToast, onPutAwayDone, suppliers = [],
}) {
  const [view, setView] = useState('expected')
  const [search, setSearch] = useState('')
  const [receiving, setReceiving] = useState(null)   // order
  const [unexpected, setUnexpected] = useState(false)
  const [openId, setOpenId] = useState(null)
  const [puttingAway, setPuttingAway] = useState(null)
  // Once stock is kept in Inventory, putting away says where each thing went
  const tracked = !!inventory?.meta?.started_at
  const putAway = (d) => (tracked ? setPuttingAway(d)
    : onUpdateDelivery(d, { put_away_at: new Date().toISOString(), put_away_by: rememberedWho() || me?.name }, 'Put away'))

  React.useEffect(() => { if (focusId && deliveries.some(d => d.id === focusId)) setOpenId(focusId) }, [focusId]) // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => {
    onRefresh?.()
    const t = setInterval(() => onRefresh?.(), 60000)
    return () => clearInterval(t)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const q = search.trim().toLowerCase()
  const match = (...xs) => !q || matches(hay(xs), q)
  const openOrders = orders.filter(o => toCome(o).length && match(o.po_number, o.supplier_name, ...(o.items || []).map(i => i.name), ...(o.items || []).map(i => i.barcode)))
  const groups = groupExpected(openOrders)
  const toPutAway = deliveries.filter(d => !d.put_away_at && deliveryUnits(d) > 0)
  const problems = deliveries.filter(needsOffice)
  const recent = deliveries.filter(d => match(d.ref, d.supplier_name, d.data?.po_number, d.delivery_note_no, d.received_by, ...(d.lines || []).map(l => l.name)))

  const VIEWS = [
    { id: 'expected', label: 'Expected', count: openOrders.length },
    { id: 'putaway', label: 'To put away', count: toPutAway.length },
    ...(canOrder ? [{ id: 'problems', label: 'For the office', count: problems.length }] : []),
    { id: 'booked', label: 'Booked in', count: null },
  ]
  const shownDeliveries = view === 'putaway' ? toPutAway : view === 'problems' ? problems : recent
  const open = deliveries.find(d => d.id === openId)

  return (
    <div>
      <PageHeader
        eyebrow="Warehouse / goods in"
        title="Goods in"
        description="What’s on its way, and booking it in when it arrives."
        actions={
          <button className="btn btn-secondary w-full sm:w-auto justify-center py-3 sm:py-2" onClick={() => setUnexpected(true)}>
            <Icon name="alert" size={16} /> Arrived with no order
          </button>
        }
      />

      <div className="flex gap-3 flex-wrap items-center justify-between mb-4">
        <div className="overflow-x-auto max-w-full -mx-1 px-1">
          <SegmentedControl label="Show" value={view} onChange={setView} items={VIEWS} />
        </div>
        <SearchInput value={search} onChange={e => setSearch(e.target.value)} placeholder="Supplier, PO, product or barcode" className="w-full sm:w-72" />
      </div>

      {view === 'expected' && (
        openOrders.length === 0 ? (
          <EmptyState icon="package" title="Nothing on its way" sub="Stock and packaging orders show here once they’re placed." />
        ) : (
          <div className="space-y-5">
            {GROUPS.filter(g => groups[g.id].length).map(g => (
              <section key={g.id}>
                <h2 className={`text-xs font-semibold uppercase tracking-[0.08em] mb-2 ${g.id === 'overdue' ? 'text-loss' : 'text-ink/50'}`}>
                  {g.label} <span className="text-ink/35">{groups[g.id].length}</span>
                </h2>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
                  {groups[g.id].map(o => <OrderCard key={o.id} o={o} onOpen={() => setReceiving(o)} />)}
                </div>
              </section>
            ))}
          </div>
        )
      )}

      {view !== 'expected' && (
        shownDeliveries.length === 0 ? (
          <EmptyState icon="package"
            title={view === 'putaway' ? 'Everything’s been put away' : view === 'problems' ? 'Nothing waiting for the office' : 'No deliveries booked in yet'} />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
            {shownDeliveries.map(d => (
              <DeliveryCard key={d.id} d={d} focused={focusId === d.id} onOpen={() => setOpenId(d.id)}
                onPutAway={view === 'putaway' ? () => putAway(d) : null} />
            ))}
          </div>
        )
      )}

      {receiving && (
        <ReceiveSheet order={receiving} me={me} people={people} canOrder={canOrder} onUploadPhoto={onUploadPhoto}
          onClose={() => setReceiving(null)}
          onBookIn={async (lines, delivery) => { const r = await onBookIn(receiving, lines, delivery); if (r) { setReceiving(null); setView('putaway') } }} />
      )}
      {unexpected && (
        <UnexpectedForm me={me} people={people} canOrder={canOrder} onUploadPhoto={onUploadPhoto} onClose={() => setUnexpected(false)}
          supplierOptions={(() => {
            // Everyone we buy from: the supplier list, plus names on orders and past deliveries
            const names = new Map()
            for (const x of suppliers) if (x?.name) names.set(x.name.toLowerCase(), { id: `s-${x.id}`, label: x.name, sub: 'Supplier' })
            for (const o of [...purchaseOrders, ...orders]) if (o?.supplier_name && !names.has(o.supplier_name.toLowerCase())) names.set(o.supplier_name.toLowerCase(), { id: `o-${o.supplier_name}`, label: o.supplier_name, sub: 'From past orders' })
            for (const d of deliveries) if (d?.supplier_name && !names.has(d.supplier_name.toLowerCase())) names.set(d.supplier_name.toLowerCase(), { id: `d-${d.supplier_name}`, label: d.supplier_name, sub: 'Delivered before' })
            return [...names.values()].sort((a, b) => a.label.localeCompare(b.label))
          })()}
          productOptions={(inventory?.products || []).filter(p => p.active !== false).map(p => ({ id: p.id, label: p.name, sub: [p.code, p.stamp_name].filter(Boolean).join(' · '), product_id: p.id, stock_item_id: p.stock_item_id, code: p.code }))}
          onSave={async (row) => { const r = await onUnexpected(row); if (r) { setUnexpected(false); setView(canOrder ? 'problems' : 'putaway') } }} />
      )}
      {open && (
        <DeliveryDrawer d={open} me={me} canOrder={canOrder} purchaseOrders={purchaseOrders} onClose={() => setOpenId(null)}
          onUpdate={onUpdateDelivery} onViewPhoto={onViewPhoto} onOpenPo={onOpenPo}
          onPutAway={tracked ? (d) => { setOpenId(null); setPuttingAway(d) } : null} />
      )}
      {puttingAway && (
        <PutAwaySheet delivery={puttingAway} me={me} people={people} office={office} showToast={showToast}
          products={inventory?.products || []} locations={inventory?.locations || []}
          onClose={() => setPuttingAway(null)} onDone={() => { setPuttingAway(null); onPutAwayDone?.() }} />
      )}
    </div>
  )
}

function OrderCard({ o, onOpen }) {
  const lines = toCome(o)
  const units = lines.reduce((s, l) => s + l.left, 0)
  const a = o.arrival || arrivalOf(o)
  const started = (o.items || []).some(i => num(i.qty_received) > 0)
  return (
    <button className="card text-left w-full hover:border-royal-300 transition-colors" onClick={onOpen}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-semibold text-ink">{o.supplier_name || 'Supplier'}</div>
          <div className="text-xs text-ink/50">{o.po_number}{o.category === 'packaging' ? ' · Packaging' : ''}</div>
        </div>
        <StatusBadge tone={a.tone} dot>{a.label}</StatusBadge>
      </div>
      <div className="text-sm text-ink/75 mt-2 line-clamp-2">
        {lines.slice(0, 3).map(l => `${l.left} × ${l.name}`).join(' · ')}{lines.length > 3 ? ` · +${lines.length - 3} more` : ''}
      </div>
      <div className="flex items-center justify-between mt-2.5 text-xs">
        <span className="text-ink/55">{lines.length} line{lines.length !== 1 ? 's' : ''} · {units} unit{units !== 1 ? 's' : ''} to come{started ? ' · part arrived' : ''}</span>
        <span className="text-royal-600 font-semibold inline-flex items-center gap-1">Book in <Icon name="chevronRight" size={13} /></span>
      </div>
      {o.delivery_note && <div className="text-xs text-ink/50 mt-1">{o.delivery_note}</div>}
    </button>
  )
}

function DeliveryCard({ d, onOpen, onPutAway, focused }) {
  const units = deliveryUnits(d)
  return (
    <div className={`card p-0 overflow-hidden ${focused ? 'ring-2 ring-royal-300' : ''}`}>
      <button className="w-full text-left px-4 py-3 hover:bg-sky/15" onClick={onOpen}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="font-semibold text-ink">{d.supplier_name || 'Unknown supplier'}</div>
            <div className="text-xs text-ink/50">{d.ref}{d.data?.po_number ? ` · ${d.data.po_number}` : ''} · {d.received_by || 'someone'} · {when(d.received_at)}</div>
          </div>
          {d.kind === 'unexpected' ? <StatusBadge tone="alert">No order</StatusBadge>
            : d.has_problems ? <StatusBadge tone="alert">Problems</StatusBadge>
            : <StatusBadge tone="live">All OK</StatusBadge>}
        </div>
        <div className="text-sm text-ink/75 mt-1.5 line-clamp-2">
          {(d.lines || []).filter(l => num(l.arrived ?? l.qty) > 0).map(l => `${num(l.arrived ?? l.qty)} × ${l.name}`).join(' · ') || 'Nothing booked'}
        </div>
        <div className="text-xs text-ink/50 mt-1">
          {[units && `${units} units`, d.cartons && `${d.cartons} carton${d.cartons !== 1 ? 's' : ''}`, d.pallets && `${d.pallets} pallet${d.pallets !== 1 ? 's' : ''}`,
            d.put_away_at ? `put away by ${d.put_away_by || 'someone'}` : null].filter(Boolean).join(' · ')}
        </div>
      </button>
      {onPutAway && (
        <div className="px-4 pb-3">
          <button className="btn btn-primary w-full justify-center py-3 sm:py-2" onClick={onPutAway}><Icon name="check" size={15} /> Put away</button>
        </div>
      )}
    </div>
  )
}

/** A photo from the phone camera, uploaded straight away. */
function PhotoButton({ label, path, onUpload, kind, small }) {
  const ref = useRef(null)
  const [busy, setBusy] = useState(false)
  return (
    <>
      <input ref={ref} type="file" accept="image/*" capture="environment" className="hidden"
        onChange={async e => {
          const f = e.target.files?.[0]; e.target.value = ''
          if (!f) return
          setBusy(true)
          try { await onUpload(f, kind) } finally { setBusy(false) }
        }} />
      <button type="button" className={`btn btn-secondary ${small ? 'btn-xs' : 'btn-sm'}`} disabled={busy} onClick={() => ref.current?.click()}>
        <Icon name="camera" size={small ? 12 : 14} /> {busy ? 'Uploading…' : path ? 'Retake' : label}
      </button>
      {path && !busy && <span className="text-xs text-gain">✓ Photo added</span>}
    </>
  )
}

function WhoField({ people, value, onChange, id }) {
  return (
    <div>
      <label className="label" htmlFor={id}>Who’s booking it in?</label>
      <select id={id} className="input text-base sm:text-sm" value={value} onChange={e => onChange(e.target.value)}>
        <option value="">Choose your name</option>
        {people.map(p => <option key={p} value={p}>{p}</option>)}
      </select>
    </div>
  )
}

/** Booking a delivery in: one tap if it's all there, line by line if it isn't. */
function ReceiveSheet({ order, me, people, canOrder, onClose, onBookIn, onUploadPhoto }) {
  const lines = toCome(order)
  const [entries, setEntries] = useState({})
  const [problemOpen, setProblemOpen] = useState({})
  const [delivery, setDelivery] = useState({ delivery_note_no: '', cartons: '', pallets: '', signed_unchecked: false, note_photo_path: '' })
  const startWho = canOrder ? me?.name : (people.includes(rememberedWho()) ? rememberedWho() : '')
  const [who, setWho] = useState(startWho || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (id, k, v) => setEntries(e => ({ ...e, [id]: { ...(e[id] || {}), [k]: v } }))
  const allArrived = () => setEntries(Object.fromEntries(lines.map(l => [l.id,
    { ...(entries[l.id] || {}), arrived: l.line_status === 'back_order' ? (entries[l.id]?.arrived || '') : String(l.left) }])))
  const booking = bookingLines(order, entries)
  const anyProblem = booking.some(l => l.damaged || l.wrong_qty || l.short)
  const shortNoFlag = lines.filter(l => num(entries[l.id]?.arrived) > 0 && num(entries[l.id]?.arrived) < l.left && !entries[l.id]?.short && l.line_status !== 'back_order')
  const ready = booking.length > 0 && (canOrder || who)

  return (
    <Drawer title={`Book in · ${order.supplier_name || 'delivery'}`} description={`${order.po_number}${order.delivery_note ? ` · ${order.delivery_note}` : ''}`} onClose={onClose}
      footer={
        <div className="flex gap-2">
          <button className="btn btn-secondary flex-1 justify-center py-3 sm:py-2" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary flex-[2] justify-center py-3 sm:py-2" disabled={busy || !ready}
            onClick={async () => {
              setBusy(true); setError('')
              try {
                if (!canOrder) rememberWho(who)
                await onBookIn(booking, { ...delivery, received_by: who || me?.name })
              } catch (e) { setError(e?.message || 'Could not book it in — try again') } finally { setBusy(false) }
            }}>
            {busy ? 'Booking in…' : anyProblem ? 'Book in and report problems' : 'Book in'}
          </button>
        </div>
      }>
      <button className="w-full rounded-card border-2 border-gain/40 bg-lime/15 hover:bg-lime/25 text-ink font-semibold py-4 mb-1 flex items-center justify-center gap-2" onClick={allArrived}>
        <Icon name="check" size={18} /> Everything arrived OK
      </button>
      <div className="text-xs text-ink/50 text-center mb-4">Fills every line with what’s due. Change any that don’t match.</div>

      <div className="space-y-2.5 mb-5">
        {lines.map(l => {
          const e = entries[l.id] || {}
          const arrived = num(e.arrived)
          const open = problemOpen[l.id] || num(e.damaged) || num(e.wrong) || e.short || e.note
          return (
            <div key={l.id} className={`rounded-card border bg-white p-3 ${arrived >= l.left && !open ? 'border-gain/40' : 'border-rule'}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-ink">{l.name}</div>
                  <div className="text-xs text-ink/50">
                    {l.left} to come{num(l.qty_received) ? ` (${num(l.qty_received)} of ${num(l.qty)} already in)` : ''}
                    {l.barcode ? ` · ${l.barcode}` : l.supplier_sku ? ` · ${l.supplier_sku}` : ''}
                  </div>
                  {l.line_status === 'back_order' && <div className="text-xs text-warn">On back order{l.back_order_date ? ` — due ${new Date(l.back_order_date + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : ''}</div>}
                </div>
                <div className="w-24 flex-shrink-0">
                  <label className="sr-only" htmlFor={`arr-${l.id}`}>Arrived</label>
                  <input id={`arr-${l.id}`} type="number" inputMode="numeric" min="0" className="input text-base text-right font-semibold"
                    value={e.arrived ?? ''} placeholder="0" onChange={ev => set(l.id, 'arrived', ev.target.value)} />
                  <div className="text-[10px] text-ink/45 text-right mt-0.5">arrived</div>
                </div>
              </div>
              {!open ? (
                <button className="text-xs text-royal-600 mt-1.5" onClick={() => setProblemOpen(p => ({ ...p, [l.id]: true }))}>Damaged, wrong or missing?</button>
              ) : (
                <div className="mt-2.5 pt-2.5 border-t border-rule/70 space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <div><label className="label" htmlFor={`dmg-${l.id}`}>Of those, damaged</label>
                      <input id={`dmg-${l.id}`} type="number" inputMode="numeric" min="0" className="input text-base" value={e.damaged ?? ''} onChange={ev => set(l.id, 'damaged', ev.target.value)} /></div>
                    <div><label className="label" htmlFor={`wr-${l.id}`}>Wrong item sent</label>
                      <input id={`wr-${l.id}`} type="number" inputMode="numeric" min="0" className="input text-base" value={e.wrong ?? ''} onChange={ev => set(l.id, 'wrong', ev.target.value)} /></div>
                  </div>
                  {arrived < l.left && l.line_status !== 'back_order' && (
                    <label className="flex items-center gap-2 text-sm text-ink/75">
                      <input type="checkbox" className="w-5 h-5 accent-royal-500" checked={!!e.short} onChange={ev => set(l.id, 'short', ev.target.checked)} />
                      {l.left - arrived} missing — report it
                    </label>
                  )}
                  <input className="input text-base sm:text-sm" placeholder="What’s wrong? (optional)" value={e.note || ''} onChange={ev => set(l.id, 'note', ev.target.value)} aria-label="Note" />
                  <div className="flex items-center gap-2">
                    <PhotoButton small label="Photo of the problem" path={e.photo_path} kind="damage"
                      onUpload={async (f, kind) => set(l.id, 'photo_path', await onUploadPhoto(f, kind))} />
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {shortNoFlag.length > 0 && (
        <div className="panel-notice text-sm mb-4">
          Fewer than due on {shortNoFlag.length === 1 ? shortNoFlag[0].name : `${shortNoFlag.length} lines`}. The rest stays as still to come —
          tick “missing” on the line if the delivery note says it’s not coming.
        </div>
      )}

      <div className="card space-y-3">
        <div className="title-case text-sm font-semibold text-ink">The delivery</div>
        <div className="flex items-center gap-2 flex-wrap">
          <PhotoButton label="Photo of the delivery note" path={delivery.note_photo_path} kind="note"
            onUpload={async (f, kind) => { const p = await onUploadPhoto(f, kind); setDelivery(d => ({ ...d, note_photo_path: p })) }} />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div className="col-span-3 sm:col-span-1"><label className="label" htmlFor="gi-dn">Delivery note no.</label>
            <input id="gi-dn" className="input text-base sm:text-sm" value={delivery.delivery_note_no} onChange={e => setDelivery(d => ({ ...d, delivery_note_no: e.target.value }))} /></div>
          <div><label className="label" htmlFor="gi-ct">Cartons</label>
            <input id="gi-ct" type="number" inputMode="numeric" min="0" className="input text-base sm:text-sm" value={delivery.cartons} onChange={e => setDelivery(d => ({ ...d, cartons: e.target.value }))} /></div>
          <div><label className="label" htmlFor="gi-pl">Pallets</label>
            <input id="gi-pl" type="number" inputMode="numeric" min="0" className="input text-base sm:text-sm" value={delivery.pallets} onChange={e => setDelivery(d => ({ ...d, pallets: e.target.value }))} /></div>
        </div>
        <label className="flex items-start gap-2 text-sm text-ink/75">
          <input type="checkbox" className="w-5 h-5 mt-0.5 accent-royal-500" checked={delivery.signed_unchecked} onChange={e => setDelivery(d => ({ ...d, signed_unchecked: e.target.checked }))} />
          <span>Signed the driver’s paperwork as “unchecked”<span className="block text-xs text-ink/45">Always do this if you couldn’t check it before they left — it protects any damage claim.</span></span>
        </label>
        {!canOrder && <WhoField id="gi-who" people={people} value={who} onChange={setWho} />}
      </div>
      {error && <div className="text-sm text-loss mt-3">{error}</div>}
    </Drawer>
  )
}

/** Something turned up and there's no order for it on the list. */
function UnexpectedForm({ me, people, canOrder, onClose, onSave, onUploadPhoto, supplierOptions = [], productOptions = [] }) {
  const [row, setRow] = useState({ supplier_name: '', delivery_note_no: '', cartons: '', pallets: '', note: '', note_photo_path: '', signed_unchecked: false })
  const [items, setItems] = useState([{ name: '', qty: '' }])
  const [who, setWho] = useState(canOrder ? me?.name : (people.includes(rememberedWho()) ? rememberedWho() : ''))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const filled = items.filter(i => i.name.trim())
  const ready = (row.supplier_name.trim() || row.note_photo_path) && (filled.length || row.note.trim() || row.note_photo_path) && who
  return (
    <Modal title="Arrived with no order" description="Log it so the office can match it to an order or sort it with the supplier." onClose={onClose} maxWidth="max-w-lg">
      <div className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <PhotoButton label="Photo of the delivery note" path={row.note_photo_path} kind="note"
            onUpload={async (f, kind) => { const p = await onUploadPhoto(f, kind); setRow(r => ({ ...r, note_photo_path: p })) }} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div><label className="label" htmlFor="ux-sup">Who’s it from?</label>
            <SuggestInput id="ux-sup" value={row.supplier_name} onChange={v => setRow(r => ({ ...r, supplier_name: v }))} options={supplierOptions} placeholder="Supplier or sender" /></div>
          <div><label className="label" htmlFor="ux-dn">Delivery note no.</label>
            <input id="ux-dn" className="input text-base sm:text-sm" value={row.delivery_note_no} onChange={e => setRow(r => ({ ...r, delivery_note_no: e.target.value }))} /></div>
        </div>
        <div>
          <div className="label">What came?</div>
          <div className="space-y-2">
            {items.map((it, i) => (
              <div key={i} className="flex gap-2">
                <div className="flex-1 min-w-0">
                  <SuggestInput placeholder="Product" value={it.name} aria-label="Product" options={productOptions}
                    onChange={v => setItems(xs => xs.map((x, j) => j === i ? { ...x, name: v } : x))}
                    onPick={o => setItems(xs => xs.map((x, j) => j === i ? { ...x, product_id: o?.product_id || null, stock_item_id: o?.stock_item_id || null, code: o?.code || null } : x))} />
                </div>
                <input className="input w-20 text-base sm:text-sm" type="number" inputMode="numeric" min="0" placeholder="Qty" value={it.qty} aria-label="Quantity"
                  onChange={e => setItems(xs => xs.map((x, j) => j === i ? { ...x, qty: e.target.value } : x))} />
              </div>
            ))}
          </div>
          <button className="btn btn-ghost btn-xs mt-1.5" onClick={() => setItems(xs => [...xs, { name: '', qty: '' }])}><Icon name="plus" size={12} /> Another product</button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div><label className="label" htmlFor="ux-ct">Cartons</label>
            <input id="ux-ct" type="number" inputMode="numeric" min="0" className="input text-base sm:text-sm" value={row.cartons} onChange={e => setRow(r => ({ ...r, cartons: e.target.value }))} /></div>
          <div><label className="label" htmlFor="ux-pl">Pallets</label>
            <input id="ux-pl" type="number" inputMode="numeric" min="0" className="input text-base sm:text-sm" value={row.pallets} onChange={e => setRow(r => ({ ...r, pallets: e.target.value }))} /></div>
        </div>
        <input className="input text-base sm:text-sm" placeholder="Anything else? (optional)" value={row.note} onChange={e => setRow(r => ({ ...r, note: e.target.value }))} aria-label="Note" />
        <label className="flex items-center gap-2 text-sm text-ink/75">
          <input type="checkbox" className="w-5 h-5 accent-royal-500" checked={row.signed_unchecked} onChange={e => setRow(r => ({ ...r, signed_unchecked: e.target.checked }))} />
          Signed for as “unchecked”
        </label>
        {!canOrder && <WhoField id="ux-who" people={people} value={who} onChange={setWho} />}
        {error && <div className="text-sm text-loss">{error}</div>}
        <div className="flex gap-2 pt-1">
          <button className="btn btn-secondary flex-1 justify-center py-3 sm:py-2" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary flex-1 justify-center py-3 sm:py-2" disabled={busy || !ready}
            onClick={async () => {
              setBusy(true); setError('')
              try {
                if (!canOrder) rememberWho(who)
                await onSave({
                  supplier_name: row.supplier_name.trim() || null, delivery_note_no: row.delivery_note_no.trim() || null,
                  cartons: parseInt(row.cartons) || null, pallets: parseInt(row.pallets) || null, signed_unchecked: row.signed_unchecked,
                  note_photo_path: row.note_photo_path || null, received_by: who || me?.name,
                  lines: filled.map(i => ({ name: i.name.trim(), arrived: num(i.qty), ...(i.product_id ? { product_id: i.product_id, stock_item_id: i.stock_item_id, code: i.code } : {}) })),
                  data: { note: row.note.trim() || null },
                })
              } catch (e) { setError(e?.message || 'Could not save it — try again') } finally { setBusy(false) }
            }}>
            {busy ? 'Saving…' : 'Log it'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

/** One delivery: what came, the paperwork, and — for the office — sorting it out. */
function DeliveryDrawer({ d, me, canOrder, purchaseOrders, onClose, onUpdate, onViewPhoto, onOpenPo, onPutAway }) {
  const [note, setNote] = useState(d.office_note || '')
  const [matching, setMatching] = useState(false)
  const [busy, setBusy] = useState(false)
  const run = async (fn) => { setBusy(true); try { await fn() } finally { setBusy(false) } }
  const photos = [d.note_photo_path && { path: d.note_photo_path, label: 'Delivery note' },
    ...(d.lines || []).filter(l => l.photo_path).map(l => ({ path: l.photo_path, label: l.name }))].filter(Boolean)
  return (
    <Drawer title={d.supplier_name || 'Delivery'} description={`${d.ref}${d.data?.po_number ? ` · ${d.data.po_number}` : ''} · ${d.received_by || 'someone'} · ${when(d.received_at)}`} onClose={onClose}
      footer={
        <div className="flex gap-2 justify-end flex-wrap">
          {!d.put_away_at && deliveryUnits(d) > 0 && (
            <button className="btn btn-secondary btn-sm" disabled={busy}
              onClick={() => (onPutAway ? onPutAway(d) : run(() => onUpdate(d, { put_away_at: new Date().toISOString(), put_away_by: rememberedWho() || me?.name }, 'Put away')))}>
              <Icon name="check" size={14} /> Put away
            </button>
          )}
          {canOrder && d.po_id && <button className="btn btn-secondary btn-sm" onClick={() => onOpenPo(d.po_id)}>Open PO</button>}
        </div>
      }>
      <div className="flex gap-2 flex-wrap mb-4">
        {d.kind === 'unexpected' ? <StatusBadge tone="alert">Arrived with no order</StatusBadge>
          : d.has_problems ? <StatusBadge tone="alert">Problems reported</StatusBadge> : <StatusBadge tone="live">All OK</StatusBadge>}
        {d.office_status === 'resolved' && <StatusBadge tone="live">Sorted by the office</StatusBadge>}
        {d.signed_unchecked && <StatusBadge tone="quiet">Signed unchecked</StatusBadge>}
        {d.put_away_at ? <StatusBadge tone="quiet">Put away</StatusBadge> : deliveryUnits(d) > 0 && <StatusBadge tone="paused">Not put away</StatusBadge>}
      </div>

      <div className="card mb-4 p-0 overflow-hidden">
        {(d.lines || []).map((l, i) => (
          <div key={i} className="px-4 py-2.5 border-b border-rule/70 last:border-0">
            <div className="flex justify-between gap-3">
              <span className="text-sm text-ink">{l.name}</span>
              <span className="text-sm font-semibold text-ink whitespace-nowrap">{num(l.arrived ?? l.qty)}{l.expected ? <span className="text-ink/45 font-normal"> / {num(l.expected)}</span> : ''}</span>
            </div>
            {(num(l.damaged) > 0 || num(l.wrong_qty) > 0 || l.short || l.note) && (
              <div className="text-xs text-loss mt-0.5">
                {[num(l.damaged) > 0 && `${num(l.damaged)} damaged`, num(l.wrong_qty) > 0 && `${num(l.wrong_qty)} wrong item`,
                  l.short && `${num(l.short_qty)} missing`, l.note].filter(Boolean).join(' · ')}
              </div>
            )}
          </div>
        ))}
      </div>

      {(d.data?.put_away || []).some(l => !l.skip && l.location) && (
        <div className="card mb-4 p-0 overflow-hidden">
          <div className="px-4 pt-2.5 text-xs font-semibold text-ink/50">Where it went</div>
          {d.data.put_away.filter(l => !l.skip && l.location).map((l, i) => (
            <div key={i} className="px-4 py-2 flex justify-between gap-3 text-sm border-b border-rule/70 last:border-0">
              <span className="text-ink/80">{l.name}</span><span className="tabular-nums whitespace-nowrap"><b>{num(l.units)}</b> on {l.location}</span>
            </div>
          ))}
        </div>
      )}

      <div className="card mb-4 text-sm space-y-1.5">
        {[['Delivery note', d.delivery_note_no], ['Cartons', d.cartons], ['Pallets', d.pallets],
          ['Put away', d.put_away_at ? `${d.put_away_by || ''} · ${when(d.put_away_at)}` : null], ['Note', d.data?.note]]
          .filter(([, v]) => v).map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3"><span className="text-ink/60">{k}</span><span className="text-ink text-right">{v}</span></div>
          ))}
        {photos.length > 0 && (
          <div className="flex gap-2 flex-wrap pt-1">
            {photos.map((p, i) => <button key={i} className="btn btn-secondary btn-xs" onClick={() => onViewPhoto(p.path)}><Icon name="camera" size={12} /> {p.label}</button>)}
          </div>
        )}
      </div>

      {canOrder && d.office_status === 'open' && (
        <div className="card border-warn/50">
          <div className="title-case text-sm font-semibold text-ink mb-1">For the office</div>
          <div className="text-xs text-ink/55 mb-2">
            {d.kind === 'unexpected'
              ? 'Match it to an order (then book the quantities in on the PO), or note what you did with it.'
              : 'The problems are in Delivery Problems with their value, ready to raise with the supplier.'}
          </div>
          <input className="input mb-2" value={note} onChange={e => setNote(e.target.value)} placeholder="What was done — e.g. credit requested, sent back, matched" aria-label="Office note" />
          <div className="flex gap-2 flex-wrap">
            {d.kind === 'unexpected' && <button className="btn btn-secondary btn-sm" onClick={() => setMatching(true)}>Match to an order</button>}
            <button className="btn btn-primary btn-sm" disabled={busy}
              onClick={() => run(() => onUpdate(d, { office_status: 'resolved', office_note: note.trim() || null, resolved_at: new Date().toISOString(), resolved_by: me?.name }, 'Sorted'))}>
              <Icon name="check" size={14} /> Sorted
            </button>
          </div>
        </div>
      )}
      {d.office_status === 'resolved' && d.office_note && (
        <div className="panel-notice text-sm"><b>Office:</b> {d.office_note}{d.resolved_by ? ` — ${d.resolved_by}` : ''}</div>
      )}

      {matching && (
        <Modal title="Match to an order" description="Which order did this delivery belong to?" onClose={() => setMatching(false)} maxWidth="max-w-lg">
          <div className="border border-rule rounded-[6px] bg-white divide-y divide-rule/70 overflow-hidden max-h-[60vh] overflow-y-auto">
            {purchaseOrders.filter(po => expectsDelivery(po) && !['draft', 'cancelled', 'completed'].includes(po.status))
              .sort((a, b) => (String(b.supplier_name || '').toLowerCase().includes(String(d.supplier_name || '~').toLowerCase().slice(0, 4)) -
                               String(a.supplier_name || '').toLowerCase().includes(String(d.supplier_name || '~').toLowerCase().slice(0, 4))))
              .map(po => (
                <button key={po.id} className="w-full text-left px-3 py-2.5 hover:bg-sky/25"
                  onClick={() => run(async () => {
                    await onUpdate(d, { po_id: po.id, data: { ...(d.data || {}), po_number: po.po_number } }, `Matched to ${po.po_number}`)
                    setMatching(false); onOpenPo(po.id)
                  })}>
                  <div className="text-sm text-ink">{po.po_number} · {po.supplier_name}</div>
                  <div className="text-xs text-ink/50 truncate">{(po.items || []).map(i => `${num(i.qty)} × ${i.name}`).join(' · ')}</div>
                </button>
              ))}
          </div>
        </Modal>
      )}
    </Drawer>
  )
}
