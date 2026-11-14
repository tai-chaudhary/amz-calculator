import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { Modal, Icon, SuggestInput, SegmentedControl, Spinner, StatusBadge, SearchInput, EmptyState } from './UI'
import { QtyInput } from './CareParts'
import { useInventoryProducts } from './ManualParcel'
import { wholesaleLabelsPdf } from './WholesaleOrders'
import { bulkOrderLookup, bulkShipOptions, saveBulkOrder, cancelBulkOrder, loadBulkOrders, loadBulkCheck } from '../lib/db'
import { FARRALLS } from '../lib/bulkOrders'
import { smartFilter, hay } from '../lib/match'
import { exportRowsToCsv, stampedName } from '../lib/csv'
import { fmtDate, londonToday } from '../lib/dates'

/**
 * Bulk orders (v2.78.0). Three kinds of order leave on a pallet:
 *
 *  - Stone & Surfaces  — drop-ship. They arrange the collection (GForce) and pay per bundle of bags from their price
 *                        list; we pay no delivery. Added with the "Stone & Surfaces order" form (WholesaleOrders.jsx).
 *  - Bulk order        — an Amazon / eBay / TikTok order sent by Farrall's pallet, with ONE parcel by DHL or Evri so
 *                        there's a tracking number to upload to the marketplace. Linked by the CHANNEL order number.
 *  - Salt 4 U bulk     — a website order: the whole order goes on the pallet, no parcel.
 *
 * The one parcel label is made in HELM and uploaded to Dispatch as normal — before or after this form, it finds its
 * bulk order by the channel order number and is never held for "one label, many units" (lib/bulkOrders.js).
 * Costs, savings and what's left are only sent to people who see costs (the database decides).
 */
const money = (n) => (n == null ? '—' : `£${Number(n).toFixed(2)}`)
const KIND = { stone: 'Stone & Surfaces', bulk: 'Bulk order', salt4u: 'Salt 4 U bulk' }
const tidyRef = (r) => String(r || '').trim()
const palRef = (ref) => `PAL${String(ref || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(-9)}`

export function BulkOrderModal({ me, onLog, onClose, onStarted, prefill = null }) {
  const picker = useInventoryProducts()
  const products = useMemo(() => picker.filter(p => p.kind !== 'packaging' && p.code).map(p => ({ id: p.id, code: p.code, label: p.name, sub: p.code })), [picker])
  const [ref, setRef] = useState(prefill?.channel_ref || '')
  const [found, setFound] = useState(null)          // what the lookup said
  const [looking, setLooking] = useState(false)
  const [kind, setKind] = useState(prefill?.kind === 'salt4u' ? 'salt4u' : 'bulk')
  const [product, setProduct] = useState(prefill?.code ? { code: prefill.code, label: prefill.product } : null)
  const [typed, setTyped] = useState(prefill?.product || '')
  const [units, setUnits] = useState(prefill?.units || 20)
  const [parcelUnits, setParcelUnits] = useState(prefill?.parcel_units || 1)
  const [customer, setCustomer] = useState(prefill?.customer || '')
  const [postcode, setPostcode] = useState(prefill?.postcode || '')
  const [service, setService] = useState(prefill?.service || '24hr')
  const [plan, setPlan] = useState(null)
  const [planning, setPlanning] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const byParcel = kind === 'bulk' ? Math.min(parcelUnits, Math.max(units - 1, 0)) : 0
  const onPallet = Math.max(units - byParcel, 0)

  const lookup = useCallback(async (value) => {
    const r = tidyRef(value)
    if (r.length < 4) return
    setLooking(true); setErr('')
    try {
      const res = await bulkOrderLookup(r)
      setFound(res)
      if (res?.ok) {
        if (res.channel) setKind(/woo/i.test(res.channel) ? 'salt4u' : 'bulk')
        const ex = res.existing
        const item = (res.items || []).length === 1 ? res.items[0] : null
        if (ex) {
          setProduct({ code: ex.code, label: ex.product }); setTyped(ex.product || ''); setUnits(ex.units)
          setParcelUnits(ex.parcel_units || 1); if (ex.customer) setCustomer(ex.customer); if (ex.postcode) setPostcode(ex.postcode)
          if (ex.kind === 'salt4u' || ex.kind === 'bulk') setKind(ex.kind)
        } else if (item?.known) { setProduct({ code: item.code, label: item.name }); setTyped(item.name); setUnits(item.qty) }
        const pl = res.parcel_label
        if (pl) { setCustomer(c => c || pl.customer || ''); setPostcode(p => p || pl.postcode || '') }
        // HELM's delivery postcode (kept since v2.79.0): the pallet can be priced before any label exists
        if (res.postcode) setPostcode(p => p || res.postcode)
      }
    } catch (e) { setErr(e?.message || 'Couldn’t look that order up') }
    finally { setLooking(false) }
  }, [])
  useEffect(() => { if (prefill?.channel_ref) lookup(prefill.channel_ref) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // The pallet for what's been entered: how many, what size — and the costs, for people who see them
  useEffect(() => {
    setPlan(null)
    if (!product?.code || units < 1 || postcode.trim().length < 2 || onPallet < 1) return
    let live = true
    setPlanning(true)
    const t = setTimeout(() => {
      bulkShipOptions({ code: product.code, units, postcode: postcode.trim(), tracked: byParcel > 0, perParcel: Math.max(byParcel, 1), service })
        .then(r => { if (live) setPlan(r) }).catch(() => { if (live) setPlan({ ok: false, why: 'Couldn’t work out the pallet' }) })
        .finally(() => { if (live) setPlanning(false) })
    }, 350)
    return () => { live = false; clearTimeout(t) }
  }, [product?.code, units, postcode, byParcel, service, onPallet])

  const pal = plan?.options?.find(o => o.id === 'pallet')
  const alt = plan?.options?.find(o => o.id === 'parcels')
  const many = (found?.items || []).length > 1
  const problem = !tidyRef(ref) ? 'channel order number' : !product ? 'product' : units < 2 ? 'quantity' : !customer.trim() ? 'customer name' : postcode.trim().length < 5 ? 'full postcode' : !pal ? null : null
  const ok = !problem && !!pal && !busy && !many
  const already = found?.pallet_labels > 0

  const submit = async () => {
    setBusy(true); setErr('')
    try {
      const saved = await saveBulkOrder({ kind, channel_ref: tidyRef(ref), code: product.code, units, parcel_units: byParcel,
        parcel_carrier: found?.parcel_label?.carrier || pal?.parcel_carrier || null, customer: customer.trim(), postcode: postcode.trim(), service: pal.service, pallets: pal.pallets })
      const pallets = saved?.pallets || pal.pallets || 1
      const tracking = palRef(ref)
      const order = { customer: customer.trim(), postcode: postcode.trim().toUpperCase(), ref: tidyRef(ref), ssd: tracking, productName: product.label, qty: onPallet, pallets,
        head: `${FARRALLS} PALLET · ${pal.service}`, bigLabel: 'Deliver to', big: postcode.trim().toUpperCase() }
      const bytes = await wholesaleLabelsPdf([order], kind === 'salt4u' ? 'SALT 4 U' : (found?.channel || 'BULK ORDER'), { head: order.head })
      const file = new File([bytes], `pallet-${tracking}-${londonToday()}.pdf`, { type: 'application/pdf' })
      const labels = Array.from({ length: pallets }, (_, i) => ({ pageIndex: i, carrier: FARRALLS, service: `Pallet ${pal.service}`, ref: tracking, refs: [tracking], tracking,
        postcode: order.postcode, customer: order.customer, stamp: {} }))
      const preset = [{ labels, slip: { pageIndex: null, channelRef: order.ref, helmOrder: '', slipId: tracking, customer: order.customer, postcode: order.postcode,
        items: [{ code: product.code, name: product.label, qty: onPallet }], wholesale: KIND[kind] } }]
      const { startJob } = await import('../lib/dispatchJobs')
      startJob(file, { title: `${KIND[kind]} · ${FARRALLS} · ${order.ref}`, me, onLog, preset: { orders: preset, pageCount: pallets } })
      onStarted?.(pallets)
    } catch (e) { setErr(e?.message || 'Couldn’t make the pallet label'); setBusy(false) }
  }

  return (
    <Modal title="Bulk order by pallet" description={`An order sent on a ${FARRALLS} pallet. Marketplace orders also send one parcel, for the tracking number.`} onClose={onClose} maxWidth="max-w-2xl">
      <div className="space-y-3.5">
        <div>
          <label className="label" htmlFor="bo-ref">Channel order number</label>
          <div className="flex gap-2">
            <input id="bo-ref" className="input text-base sm:text-sm font-mono flex-1" value={ref} placeholder="e.g. 202-8026382-3615501" autoComplete="off"
              onChange={e => { setRef(e.target.value); setFound(null) }} onBlur={() => !found && lookup(ref)} onKeyDown={e => { if (e.key === 'Enter') lookup(ref) }} />
            <button className="btn btn-secondary" disabled={looking || tidyRef(ref).length < 4} onClick={() => lookup(ref)}>{looking ? 'Looking…' : 'Find order'}</button>
          </div>
          {found?.ok && (
            <div className="text-xs mt-1.5 space-y-0.5">
              <div className={found.in_helm ? 'text-ink/60' : 'text-warn'}>
                {found.in_helm ? `Found in HELM${found.channel ? ` — ${found.channel}` : ''}: ${(found.items || []).map(i => `${i.qty} × ${i.name}`).join(', ')}` : 'Not found in HELM — check the number, or carry on and choose the product yourself'}
              </div>
              {many && <div className="text-loss">This order has more than one product. A bulk order is one product for now — tell the office.</div>}
              {found.existing && <div className="text-ink/60">{found.existing.status === 'to_arrange' ? 'Its parcel label is already in Dispatch — this makes the pallet for the rest.' : 'Already added as a bulk order — saving again updates it.'}</div>}
              {already && <div className="text-warn">A pallet label for this order is already in Dispatch. Making another would be held as a repeat.</div>}
            </div>
          )}
        </div>

        <SegmentedControl label="Where the order came from" value={kind} onChange={setKind}
          items={[{ id: 'bulk', label: 'Amazon / eBay / TikTok' }, { id: 'salt4u', label: 'Salt 4 U website' }]} />

        <div className="grid grid-cols-6 gap-3">
          <div className="col-span-6 sm:col-span-4">
            <label className="label" htmlFor="bo-product">Product</label>
            <SuggestInput id="bo-product" value={product ? product.label : typed} options={products} placeholder="Find the product"
              onChange={v => { setTyped(v); setProduct(null) }} onPick={o => { if (o) { setProduct(o); setTyped(o.label) } }} />
          </div>
          <div className="col-span-3 sm:col-span-1"><label className="label" htmlFor="bo-units">Ordered</label>
            <QtyInput id="bo-units" className="input w-full text-base sm:text-sm" value={units} onChange={setUnits} /></div>
          <div className="col-span-3 sm:col-span-1"><label className="label" htmlFor="bo-parcel">By parcel</label>
            {kind === 'bulk' ? <QtyInput id="bo-parcel" className="input w-full text-base sm:text-sm" value={parcelUnits} onChange={setParcelUnits} />
              : <input id="bo-parcel" className="input w-full text-base sm:text-sm" value="0" disabled />}</div>
          <div className="col-span-6 sm:col-span-3"><label className="label" htmlFor="bo-cust">Deliver to</label>
            <input id="bo-cust" className="input text-base sm:text-sm" value={customer} onChange={e => setCustomer(e.target.value)} placeholder="Customer name" autoComplete="off" /></div>
          <div className="col-span-3 sm:col-span-2"><label className="label" htmlFor="bo-pc">Postcode</label>
            <input id="bo-pc" className="input text-base sm:text-sm uppercase" value={postcode} onChange={e => setPostcode(e.target.value)} autoComplete="off" /></div>
          <div className="col-span-3 sm:col-span-1"><label className="label" htmlFor="bo-svc">Service</label>
            <select id="bo-svc" className="input text-base sm:text-sm" value={service} onChange={e => setService(e.target.value)}><option value="24hr">24hr</option><option value="48hr">48hr</option></select></div>
        </div>

        {planning && <Spinner />}
        {plan && !plan.ok && <div className="text-sm text-loss" role="alert">{plan.why || 'Couldn’t work out the pallet.'}</div>}
        {plan?.ok && !pal && <div className="text-sm text-loss" role="alert">{(plan.notes || [])[0] || `${FARRALLS} has no price for this postcode.`}</div>}
        {pal && (
          <div className="rounded-card border border-rule bg-white p-3.5 space-y-2" aria-live="polite">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-ink/50">How it goes</div>
            {byParcel > 0 && (
              <div className="flex items-start gap-2.5 text-sm">
                <Icon name="box" size={15} className="mt-0.5 text-ink/45" />
                <div><b>{byParcel}</b> by {found?.parcel_label?.carrier || pal.parcel_carrier || 'parcel'} — for the tracking number
                  <div className="text-xs text-ink/55">{found?.parcel_label
                    ? `Label already in Dispatch${found.parcel_label.batch ? ` (${found.parcel_label.batch})` : ''} ✓`
                    : 'Make this label in HELM and upload it to Dispatch as normal — it links itself by the order number and won’t be held.'}</div></div>
              </div>
            )}
            <div className="flex items-start gap-2.5 text-sm">
              <Icon name="truck" size={15} className="mt-0.5 text-ink/45" />
              <div><b>{onPallet}</b> on {pal.pallets > 1 ? `${pal.pallets} pallets` : `a ${String(pal.size).toLowerCase()}`} by {FARRALLS} · {Math.round(pal.pallet_kg)}kg · {pal.service}
                <div className="text-xs text-ink/55">No packaging. {pal.pallets} pallet label{pal.pallets === 1 ? '' : 's'} will be made and added to Dispatch as a batch.</div></div>
            </div>
            {plan.money && (
              <div className="border-t border-rule pt-2 grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5 text-xs text-ink/65 tabular-nums">
                <span>{FARRALLS} {String(pal.size).toLowerCase()}, band {pal.band}</span><span className="text-right">{money(pal.pallet_base)}</span>
                <span>Fuel surcharge {pal.fuel_pct}%</span><span className="text-right">{money(pal.fuel)}</span>
                {byParcel > 0 && <><span>1 × {pal.parcel_carrier} parcel and its packaging</span><span className="text-right">{money((pal.parcel_shipping || 0) + (pal.packaging || 0))}</span></>}
                <span className="font-semibold text-ink">Delivery in all</span><span className="text-right font-semibold text-ink">{money(pal.total)}</span>
                {alt && <><span>As {alt.parcels} parcels by {alt.carrier} it would be</span><span className="text-right">{money(alt.total)}</span></>}
                {alt && <span className={`col-span-2 mt-1 ${pal.total <= alt.total ? 'text-ink' : 'text-loss'}`}>
                  {pal.total <= alt.total ? `The pallet saves ${money(alt.total - pal.total)}.` : `The pallet costs ${money(pal.total - alt.total)} more than parcels.`}</span>}
              </div>
            )}
            {!plan.money && alt && plan.best === 'parcels' && <div className="text-xs text-warn border-t border-rule pt-2">Parcels would be the cheaper way for this order — check with the office before sending a pallet.</div>}
          </div>
        )}

        {err && <div className="text-sm text-loss" role="alert">{err}</div>}
        <div className="flex items-center justify-between gap-3 flex-wrap border-t border-rule pt-3">
          <div className="text-sm text-ink/60">{problem ? <span className="text-loss">Add the {problem}</span> : pal ? `${pal.pallets} pallet label${pal.pallets === 1 ? '' : 's'}` : ''}</div>
          <button className="btn btn-primary" disabled={!ok} onClick={submit}><Icon name="upload" size={14} /> {busy ? 'Making the label…' : 'Make pallet label and add to Dispatch'}</button>
        </div>
      </div>
    </Modal>
  )
}

const stage = (o) => {
  if (o.status === 'cancelled') return { label: 'Removed', tone: 'quiet' }
  if (o.status === 'to_arrange') return { label: 'Pallet to arrange', tone: 'alert' }
  const pl = o.pallet_labels || []
  if (!pl.length) return { label: 'No pallet label', tone: 'warn' }
  if (pl.every(l => l.status === 'dispatched')) return { label: o.kind === 'stone' ? 'Collected' : 'Gone', tone: 'live' }
  if (pl.some(l => l.status === 'held')) return { label: 'On hold', tone: 'alert' }
  return { label: 'In Dispatch', tone: 'warn' }
}

/** The Wholesale tab: pallets still to arrange first, then every bulk order and where it's got to */
export function BulkOrdersPanel({ onArrange, reloadKey = 0, showToast }) {
  const [rows, setRows] = useState(null)
  const [open, setOpen] = useState([])            // open orders heavy enough for a pallet (no label yet)
  const [showAllOpen, setShowAllOpen] = useState(false)
  const [q, setQ] = useState('')
  const [days, setDays] = useState(60)
  const [kind, setKind] = useState('all')
  const [removing, setRemoving] = useState(null)
  const [reason, setReason] = useState('')
  const [n, setN] = useState(0)
  useEffect(() => {
    let live = true
    setRows(null)
    loadBulkOrders(days).then(r => { if (live) setRows(r || []) }).catch(() => { if (live) setRows([]) })
    loadBulkCheck().then(r => { if (live) setOpen(r || []) }).catch(() => {})
    return () => { live = false }
  }, [days, reloadKey, n])
  const seesMoney = (rows || []).some(r => r.money)
  const all = (rows || []).filter(r => r.status !== 'cancelled')
  const toArrange = all.filter(r => r.status === 'to_arrange')
  const list = smartFilter(all.filter(r => r.status !== 'to_arrange' && (kind === 'all' || r.kind === kind)), q,
    r => hay(r.channel_ref, r.ssd, r.customer, r.postcode, r.product, r.account), { keepOrder: true })
  const left = (r) => (r.money?.revenue != null && r.money?.product_cost != null ? r.money.revenue - r.money.product_cost - (r.money.shipping_total || 0) : null)
  const exportCsv = () => exportRowsToCsv(stampedName('bulk-orders'), list, [
    { header: 'Date', value: r => (r.created_at || '').slice(0, 10) }, { header: 'Kind', value: r => KIND[r.kind] }, { header: 'Order', value: r => r.channel_ref },
    { header: 'SSD', value: r => r.ssd }, { header: 'Customer', value: r => r.customer }, { header: 'Postcode', value: r => r.postcode },
    { header: 'Product', value: r => r.product }, { header: 'Units', value: r => r.units }, { header: 'By parcel', value: r => r.parcel_units }, { header: 'By pallet', value: r => r.pallet_units },
    { header: 'Pallets', value: r => r.pallets }, { header: 'Status', value: r => stage(r).label },
    ...(seesMoney ? [{ header: 'Sale ex VAT', value: r => r.money?.revenue }, { header: 'Product cost', value: r => r.money?.product_cost },
      { header: 'Delivery and packaging', value: r => r.money?.shipping_total }, { header: 'As parcels would cost', value: r => r.money?.parcels_alt }, { header: 'Saving', value: r => r.money?.saving }] : []),
  ])
  const remove = async () => {
    try { await cancelBulkOrder(removing.id, reason); showToast?.('Removed'); setRemoving(null); setReason(''); setN(x => x + 1) }
    catch (e) { showToast?.(e?.message || 'Couldn’t remove it', 'error') }
  }

  const openTodo = open.filter(o => !o.bulk_status)
  const byPallet = openTodo.filter(o => o.best === 'pallet')
  const otherOpen = openTodo.filter(o => o.best !== 'pallet')

  return (
    <div className="space-y-4">
      {openTodo.length > 0 && <OpenCheck byPallet={byPallet} others={otherOpen} showAll={showAllOpen} onShowAll={() => setShowAllOpen(v => !v)} onArrange={onArrange} />}
      {toArrange.length > 0 && (
        <div className="card border-warn/40">
          <div className="text-sm font-semibold text-ink">Pallets to arrange · {toArrange.length}</div>
          <div className="text-xs text-ink/55 mt-0.5 mb-2">These orders had one parcel label for more than a box holds. One went by parcel; the rest is waiting for a pallet.</div>
          <div className="divide-y divide-rule/70">
            {toArrange.map(r => (
              <div key={r.id} className="py-2.5 flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="text-sm text-ink"><b>{r.pallet_units} × {r.product}</b> still to send</div>
                  <div className="text-xs text-ink/60">Order <span className="font-mono">{r.channel_ref}</span>{r.channel ? ` · ${r.channel}` : ''} · {r.customer || 'customer not read'} · {r.postcode || 'no postcode'} · {r.parcel_units} went by {r.parcel_carrier || 'parcel'} · {fmtDate(r.created_at)}</div>
                </div>
                <div className="flex gap-2">
                  <button className="btn btn-primary btn-sm" onClick={() => onArrange?.(r)}><Icon name="truck" size={14} /> Make pallet label</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => { setRemoving(r); setReason('') }}>Not a pallet order</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="filter-bar">
        <SegmentedControl label="Kind of order" value={kind} onChange={setKind} items={[{ id: 'all', label: 'All' }, { id: 'stone', label: 'Stone & Surfaces' }, { id: 'bulk', label: 'Bulk' }, { id: 'salt4u', label: 'Salt 4 U' }]} />
        <select className="input text-sm w-auto" value={days} onChange={e => setDays(Number(e.target.value))} aria-label="Period">
          <option value={14}>Last 14 days</option><option value={60}>Last 60 days</option><option value={365}>Last year</option>
        </select>
        <button className="btn btn-secondary btn-sm" onClick={exportCsv} disabled={!list.length}><Icon name="download" size={14} /> Export</button>
        <SearchInput value={q} onChange={e => setQ(e.target.value)} placeholder="Order, SSD, customer, postcode, product" className="w-full sm:w-72 sm:ml-auto" />
      </div>

      {!rows ? <Spinner /> : !list.length ? <div className="surface"><EmptyState icon="truck" title="No bulk orders here yet" sub="Add a Stone & Surfaces order or a bulk order by pallet with the buttons above." /></div> : (
        <>
          <div className="text-xs text-ink/55">{list.length} order{list.length === 1 ? '' : 's'} · {list.reduce((t, r) => t + (r.units || 0), 0)} units · {list.reduce((t, r) => t + (r.pallets || 0), 0)} pallets</div>
          <div className="card p-0 overflow-hidden">
            {list.map(r => {
              const st = stage(r), m = r.money, l = left(r)
              const parcel = (r.parcel_labels || [])[0]
              return (
                <div key={r.id} className="px-4 py-3 border-b border-rule last:border-0">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm text-ink"><b>{r.units} × {r.product}</b></div>
                      <div className="text-xs text-ink/60">{KIND[r.kind]}{r.kind === 'stone' && r.ssd ? ` · SSD ${r.ssd}` : ''} · Order <span className="font-mono">{r.channel_ref}</span> · {r.customer} · {r.postcode}</div>
                      <div className="text-[11px] text-ink/45 mt-0.5">
                        {r.kind === 'stone' ? `${r.pallets || 1} pallet${(r.pallets || 1) === 1 ? '' : 's'} · collected by GForce`
                          : `${r.pallet_units} on ${r.pallets > 1 ? `${r.pallets} pallets` : String(r.pallet_size || 'a pallet').toLowerCase()} by ${r.pallet_carrier || FARRALLS}${r.service ? `, ${r.service}` : ''}`}
                        {r.kind === 'bulk' && ` · ${r.parcel_units} by parcel: ${parcel ? `${parcel.carrier}${parcel.batch ? ` ${parcel.batch}` : ''}${parcel.status === 'dispatched' ? ', gone' : ''} ✓` : 'label not uploaded yet'}`}
                        {' · '}{fmtDate(r.created_at)}{r.created_by ? ` · ${r.created_by}` : ''}
                      </div>
                    </div>
                    <StatusBadge tone={st.tone}>{st.label}</StatusBadge>
                  </div>
                  {m && (
                    <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs tabular-nums text-ink/70">
                      {m.revenue != null && <span>Sale ex VAT <b className="text-ink">{money(m.revenue)}</b></span>}
                      {m.product_cost != null && <span>Product <b className="text-ink">{money(m.product_cost)}</b></span>}
                      {r.kind !== 'stone' && <span>Delivery and packaging <b className="text-ink">{money(m.shipping_total)}</b></span>}
                      {l != null && <span>{r.kind === 'stone' ? 'Profit' : 'Left before marketplace fees'} <b className={l < 0 ? 'text-loss' : 'text-ink'}>{money(l)}</b></span>}
                      {r.kind !== 'stone' && m.saving != null && <span className={m.saving < 0 ? 'text-loss' : ''}>{m.saving >= 0 ? `Saved ${money(m.saving)} against parcels` : `${money(-m.saving)} dearer than parcels`}</span>}
                      {m.notes && <span className="text-warn">{m.notes}</span>}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}

      {removing && (
        <Modal title="Not a pallet order?" description={`${removing.pallet_units} × ${removing.product} — order ${removing.channel_ref}`} onClose={() => setRemoving(null)}>
          <div className="text-sm text-ink/70 mb-3">This takes it off the list. If the rest of the order still has to go by parcel, make its labels in HELM and upload them — they may show as a repeat of the first label, and can be released from On hold.</div>
          <label className="label" htmlFor="bo-why">Why (optional)</label>
          <input id="bo-why" className="input text-base sm:text-sm" value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. customer only wanted one" />
          <div className="flex gap-2 pt-4">
            <button className="btn btn-secondary flex-1 justify-center" onClick={() => setRemoving(null)}>Keep it</button>
            <button className="btn btn-primary flex-1 justify-center" onClick={remove}>Take it off the list</button>
          </div>
        </Modal>
      )}
    </div>
  )
}

/**
 * Open orders checked before anyone labels them (v2.79.0): one product, 100kg or more, with HELM's delivery postcode.
 * "Send by pallet" where a pallet (plus one tracked parcel for marketplace orders) is cheaper than boxes.
 */
function OpenCheck({ byPallet, others, showAll, onShowAll, onArrange }) {
  const row = (o, pallet) => {
    const pal = (o.options || []).find(x => x.id === 'pallet'), par = (o.options || []).find(x => x.id === 'parcels')
    return (
      <div key={o.ref} className="py-2.5 flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="text-sm text-ink"><b>{o.units} × {o.product}</b> · {Math.round(o.total_kg)}kg</div>
          <div className="text-xs text-ink/60">Order <span className="font-mono">{o.ref}</span>{o.channel ? ` · ${o.channel === 'WooCommerce' ? 'Salt 4 U' : o.channel}` : ''}{o.postcode ? ` · ${o.postcode}` : ''}</div>
          <div className="text-xs mt-0.5 text-ink/70">
            {o.why ? <span className="text-warn">{o.why}</span>
              : pallet ? <>{pal?.label}{o.money && o.saving != null ? <> — <b className="text-ink tabular-nums">saves {money(o.saving)}</b> against {par?.label || 'parcels'} ({money(par?.total)} → {money(pal?.total)})</> : null}</>
              : <>Send as {par?.label || 'parcels'}{o.money && pal ? <> — a pallet would cost <span className="tabular-nums">{money(o.saving)}</span> more</> : !pal ? ' — no pallet price for this postcode' : ''}</>}
          </div>
        </div>
        {pallet && <button className="btn btn-primary btn-sm" onClick={() => onArrange?.({ channel_ref: o.ref, kind: o.channel === 'WooCommerce' ? 'salt4u' : 'bulk', code: o.code, product: o.product, units: o.units, postcode: o.postcode })}><Icon name="truck" size={14} /> Arrange pallet</button>}
      </div>
    )
  }
  return (
    <div className={`card ${byPallet.length ? 'border-live/50' : ''}`}>
      <div className="text-sm font-semibold text-ink">{byPallet.length ? `Send by pallet · ${byPallet.length} open order${byPallet.length === 1 ? '' : 's'}` : 'Big open orders — parcels are cheaper'}</div>
      <div className="text-xs text-ink/55 mt-0.5 mb-1">Checked before any label is made: open orders of 100kg or more, priced as boxes and as a pallet to their postcode.</div>
      <div className="divide-y divide-rule/70">{byPallet.map(o => row(o, true))}</div>
      {others.length > 0 && byPallet.length > 0 && <button className="btn btn-ghost btn-xs mt-1" onClick={onShowAll}>{showAll ? 'Hide' : `${others.length} more where parcels are cheaper`}</button>}
      {(showAll || !byPallet.length) && <div className="divide-y divide-rule/70">{others.map(o => row(o, false))}</div>}
    </div>
  )
}
