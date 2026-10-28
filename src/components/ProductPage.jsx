import React, { useEffect, useMemo, useState } from 'react'
import { NicknameLine } from './Nicknames'
import { Icon, Modal, Spinner, StatusBadge, Tabs, ProductImage, MetricCard } from './UI'
import { AmazonLink, SupplierLink, BrandLink } from './Links'
import { calcProduct, hasComponents, fmt, pct } from '../lib/calc'
import { fmtUnits, stockState } from '../lib/inventory'
import { loadProductSales, loadProductPurchases, loadProductTimeline, loadMovements, itemSetSku } from '../lib/db'
import SkuField from './SkuField'
import AddProductSheet from './AddProductSheet'
import { LiveProductRow } from './LiveProductsPage'
import { sameSupplier } from '../lib/packaging'

const money = (v) => (parseFloat(v) > 0 ? fmt(parseFloat(v)) : '')
const day = (iso) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '')
const time = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '')

// The details a Product holds; what's missing is flagged (listings and orders work them out from these)
const FIELDS = [
  { k: 'name', label: 'Name', wide: true, required: true },
  { k: 'brand', label: 'Brand' },
  { k: 'supplierName', label: 'Supplier', required: true },
  { k: 'supplierSku', label: 'Supplier SKU', required: true },
  { k: 'costPrice', label: 'Unit cost (last price paid)', type: 'money', required: true },
  { k: 'weightKg', label: 'Unit weight', type: 'kg', required: true },
  { k: 'leadDays', label: 'Lead time', type: 'days' },
  { k: 'barcode', label: 'Barcode' },
  { k: 'notes', label: 'Notes', wide: true, multiline: true },
]
const show = (f, v) => {
  if (v === undefined || v === null || String(v).trim() === '') return ''
  if (f.type === 'money') return parseFloat(v) > 0 ? fmt(parseFloat(v)) : ''
  if (f.type === 'kg') return parseFloat(v) > 0 ? `${(+v).toFixed(3)} kg` : ''
  if (f.type === 'days') return `${v} working days`
  return String(v)
}

/** Status from what's actually happened to it */
function statusOf({ archived, ip, listings, openPo }) {
  if (archived) return { label: 'Discontinued', tone: 'quiet' }
  if (ip && ip.on_hand > 0) return { label: 'In stock', tone: 'live' }
  if (openPo || ip?.on_order > 0) return { label: 'On order', tone: 'brand' }
  if (ip) return { label: 'Out of stock', tone: 'alert' }
  if (listings.some(l => l.row.data?.reviewStatus === 'approved')) return { label: 'Approved', tone: 'brand' }
  return { label: 'Testing', tone: 'quiet' }
}

function Card({ title, action, children, className = '' }) {
  return (
    <div className={`card ${className}`}>
      {(title || action) && <div className="flex items-center justify-between gap-3 mb-3"><div className="title-case text-sm font-semibold text-ink">{title}</div>{action}</div>}
      {children}
    </div>
  )
}

function Bars({ daily, days }) {
  // One bar a day for the period, gaps included, so a quiet day shows as quiet
  const map = new Map(daily.map(x => [x.d, x]))
  const out = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 864e5).toLocaleDateString('en-CA', { timeZone: 'Europe/London' })
    out.push({ d, units: num(map.get(d)?.units), orders: num(map.get(d)?.orders) })
  }
  const max = Math.max(1, ...out.map(x => x.units))
  return (
    <div>
      <div className="flex items-end gap-[2px] h-40" role="img" aria-label="Units despatched each day">
        {out.map(x => (
          <div key={x.d} className="flex-1 bg-royal-500/80 hover:bg-royal-600 rounded-t-[2px] min-h-[1px] transition-colors"
            style={{ height: `${(100 * x.units) / max}%` }} title={`${day(x.d)} · ${fmtUnits(x.units)} units · ${x.orders} orders`} />
        ))}
      </div>
      <div className="flex justify-between text-[11px] text-ink/45 mt-1.5"><span>{day(out[0].d)}</span><span>Today</span></div>
    </div>
  )
}
const num = (v) => parseFloat(v) || 0

/**
 * One product, everything about it: details (edited in place, confirmed before saving), its listings, sales,
 * stock, purchasing and a single timeline. Office only.
 */
export default function ProductPage({ si, stockItems, savedProducts, liveProducts, settings, inventory, me, showToast,
  onBack, onNavigate, onUpdateStockItem, onOrderStock, onCreateListing, onRefreshInventory, onStockItemsChanged,
  priceHistory = [], costHistory = [], onLiveStatusChange, onRemoveLive, onUpdateLivePrice }) {
  const d = si.data || {}
  const [tab, setTab] = useState('overview')
  const [adding, setAdding] = useState(false)   // putting it in Inventory without Goods In (stock already here)
  const [purchases, setPurchases] = useState(null)
  useEffect(() => { if (!inventory) onRefreshInventory?.() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadProductPurchases(si.id).then(setPurchases).catch(() => setPurchases([])) }, [si.id])

  const ipRaw = useMemo(() => (inventory?.products || []).find(p => p.stock_item_id === si.id) || null, [inventory, si.id])
  const ip = useMemo(() => (ipRaw ? { ...ipRaw, st: stockState(ipRaw) } : null), [ipRaw])
  const listings = useMemo(() => savedProducts.filter(r => !r.data?.archived && hasComponents(r.data || {}) && r.data.components.some(c => c.stockItemId === si.id))
    .map(row => {
      const p = row.data
      const live = liveProducts.find(lp => lp.saved_product_id === row.id)
      const r = calcProduct(p, settings?.carriers, settings?.packaging, stockItems)
      const qty = p.components.find(c => c.stockItemId === si.id)?.qty || 1
      return { row, p, live, r, qty, mixed: p.components.length > 1 }
    }).sort((a, b) => (!!b.live - !!a.live) || a.qty - b.qty), [savedProducts, liveProducts, settings, stockItems, si.id])
  const openPo = (purchases || []).some(x => !['draft', 'cancelled', 'received', 'completed'].includes(x.status) && x.kind !== 'credit_note' && x.line_status !== 'cancelled' && x.qty_received < x.qty)
  const status = statusOf({ archived: d.archived, ip, listings, openPo })
  const liveMargins = listings.filter(l => l.live && Number.isFinite(l.r.margin)).map(l => l.r.margin)
  const image = (listings.find(l => l.live) || listings[0])?.p
  const sku = ip?.code || d.sku || ''

  return (
    <div>
      <button className="text-sm text-royal-600 hover:underline inline-flex items-center gap-1 mb-3" onClick={onBack}><Icon name="back" size={14} /> Products</button>

      <div className="card flex flex-col sm:flex-row gap-4 sm:items-center">
        <div className="w-24 h-24 rounded-[8px] border border-rule bg-white flex items-center justify-center overflow-hidden shrink-0">
          <ProductImage asin={image?.asin} manualImage={image?.productImage} alt={si.name} className="object-contain w-full h-full p-1.5" placeholderSize="text-3xl" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap"><StatusBadge tone={status.tone} dot>{status.label}</StatusBadge>{ip?.kind === 'packaging' && <StatusBadge tone="quiet">Packaging</StatusBadge>}</div>
          <h1 className="text-xl font-semibold text-ink leading-snug mt-1.5" data-no-nick>{si.name}</h1>
          <NicknameLine si={si} me={me} canEdit showToast={showToast} onChanged={onStockItemsChanged} stockItems={stockItems} />
          <div className="text-sm text-ink/55 mt-1 flex flex-wrap gap-x-3 gap-y-1">
            {sku ? <span className="font-mono">{sku}</span> : <span className="text-warn">No SKU yet</span>}
            {d.brand && <BrandLink name={d.brand} />}
            {d.barcode && <span>{d.barcode}</span>}
            {d.supplierName && <SupplierLink name={d.supplierName} />}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 sm:justify-end">
          {!d.archived && onOrderStock && <button className="btn btn-primary btn-sm" onClick={() => onOrderStock([{ si, qty: 1 }])}><Icon name="briefcase" size={14} /> Order more</button>}
          {!d.archived && onCreateListing && <button className="btn btn-secondary btn-sm" onClick={() => onCreateListing(si, 1)}><Icon name="plus" size={14} /> New listing</button>}
          {ip && <button className="btn btn-secondary btn-sm" onClick={() => onNavigate?.('inventory', ip.id)}><Icon name="box" size={14} /> Open in Inventory</button>}
          {!ip && !d.archived && inventory && <button className="btn btn-secondary btn-sm" onClick={() => setAdding(true)}><Icon name="box" size={14} /> Add to Inventory</button>}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5 mt-3">
        <MetricCard label="Available" value={ip ? fmtUnits(ip.available) : '—'} color={ip && ip.available <= 0 ? 'text-loss' : 'text-ink'} sub="shelves minus open orders" />
        <MetricCard label="On the shelves" value={ip ? fmtUnits(ip.on_hand) : '—'} />
        <MetricCard label="On order" value={fmtUnits(ip?.on_order || 0)} />
        <MetricCard label="Sold" value={ip ? `${fmtUnits(ip.units_7)} · ${fmtUnits(ip.units_28)}` : '—'} sub="last 7 · 28 days" />
        <MetricCard label="Days of cover" value={ip && Number.isFinite(ip.st.cover) ? Math.round(ip.st.cover) : '—'} color={ip?.st.state === 'low' ? 'text-loss' : 'text-ink'} />
        <MetricCard label="Unit cost" value={money(d.costPrice) || '—'} color={money(d.costPrice) ? 'text-ink' : 'text-warn'} />
        <MetricCard label="Best live margin" value={liveMargins.length ? pct(Math.max(...liveMargins)) : '—'} sub={`${listings.filter(l => l.live).length} live of ${listings.length}`} />
      </div>

      <Tabs className="mt-5 mb-4" value={tab} onChange={setTab} items={[
        { id: 'overview', label: 'Overview' },
        { id: 'listings', label: 'Listings', count: listings.length },
        { id: 'sales', label: 'Sales' },
        { id: 'stock', label: 'Stock' },
        { id: 'purchasing', label: 'Purchasing', count: purchases?.length ?? null },
        { id: 'timeline', label: 'Timeline' },
      ]} />

      {tab === 'overview' && <Overview si={si} d={d} ip={ip} sku={sku} listings={listings} me={me} showToast={showToast}
        onUpdateStockItem={onUpdateStockItem} onStockItemsChanged={onStockItemsChanged} onTab={setTab} stockItems={stockItems} />}
      {tab === 'listings' && <Listings listings={listings} onNavigate={onNavigate} onCreateListing={() => onCreateListing?.(si, 1)}
        live={{ settings, stockItems, priceHistory, costHistory, onStatusChange: onLiveStatusChange, onRemove: onRemoveLive, onUpdatePrice: onUpdateLivePrice, onOrderStock }} />}
      {tab === 'sales' && <Sales si={si} ip={ip} />}
      {tab === 'stock' && <Stock ip={ip} onNavigate={onNavigate} onAdd={!d.archived && inventory ? () => setAdding(true) : null} />}
      {tab === 'purchasing' && <Purchasing purchases={purchases} d={d} onNavigate={onNavigate} />}
      {tab === 'timeline' && <Timeline si={si} />}

      {adding && (
        <AddProductSheet me={me} office products={inventory?.products || []} locations={inventory?.locations || []}
          stockItems={stockItems} showToast={showToast}
          initial={{ stockItem: si, name: si.name, code: (d.sku || '').trim().toUpperCase() }}
          onClose={() => setAdding(false)}
          onDone={() => { setAdding(false); onRefreshInventory?.(); onStockItemsChanged?.() }} />
      )}
    </div>
  )
}

function Overview({ si, d, ip, sku, listings, me, showToast, onUpdateStockItem, onStockItemsChanged, onTab, stockItems }) {
  const [editing, setEditing] = useState(false)
  const [f, setF] = useState(null)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [newSku, setNewSku] = useState('')
  const [skuConfirm, setSkuConfirm] = useState(false)
  const start = () => { setF(Object.fromEntries(FIELDS.map(x => [x.k, x.k === 'name' ? si.name : (d[x.k] ?? '')]))); setEditing(true) }
  const cur = (k) => (k === 'name' ? si.name : (d[k] ?? ''))
  const changes = editing && f ? FIELDS.filter(x => String(f[x.k] ?? '').trim() !== String(cur(x.k) ?? '').trim()) : []
  const missing = FIELDS.filter(x => x.required && !show(x, cur(x.k)))
  const costChanged = changes.some(x => x.k === 'costPrice')
  const nameChanged = changes.some(x => x.k === 'name')

  const save = async () => {
    setBusy(true)
    try {
      const next = { ...d, ...Object.fromEntries(changes.map(x => [x.k, String(f[x.k] ?? '').trim()])) }
      await onUpdateStockItem(si.id, next)
      setConfirm(false); setEditing(false)
    } finally { setBusy(false) }
  }
  const extra = useMemo(() => stockItems.filter(x => (x.data?.sku || '').trim()).map(x => ({ code: x.data.sku, name: x.name })), [stockItems])

  return (
    <div className="grid lg:grid-cols-[1.5fr_1fr] gap-3 items-start">
      <Card title="Details" action={!editing
        ? <button className="btn btn-secondary btn-sm" onClick={start}><Icon name="edit" size={14} /> Edit</button>
        : <div className="flex gap-2"><button className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>Cancel</button>
            <button className="btn btn-primary btn-sm" disabled={!changes.length || !String(f.name || '').trim()} onClick={() => setConfirm(true)}>Save changes{changes.length ? ` (${changes.length})` : ''}</button></div>}>
        {!editing && missing.length > 0 && (
          <div className="text-xs text-warn bg-warn/5 border border-warn/25 rounded-[6px] px-2.5 py-1.5 mb-3">Missing {missing.map(x => x.label.toLowerCase()).join(', ')} — listings and orders need {missing.length === 1 ? 'it' : 'them'}.</div>
        )}
        <div className="grid sm:grid-cols-2 gap-x-6 gap-y-3">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-ink/40 font-semibold">Our SKU</div>
            {sku ? <div className="text-sm text-ink font-mono mt-0.5">{sku}</div>
              : (
                <div className="mt-1 space-y-2">
                  <SkuField id="pp-sku" label="Give it its SKU" name={si.name} brand={d.brand || ''} value={newSku} onChange={setNewSku} check stockItemId={si.id} extra={extra} />
                  <button className="btn btn-primary btn-xs" disabled={!newSku.trim()} onClick={() => setSkuConfirm(true)}>Save SKU</button>
                </div>
              )}
            {ip && <div className="text-[11px] text-ink/45 mt-0.5">Change it in Inventory</div>}
          </div>
          {FIELDS.map(x => (
            <div key={x.k} className={x.wide ? 'sm:col-span-2' : ''}>
              <div className="text-[11px] uppercase tracking-wide text-ink/40 font-semibold">{x.label}</div>
              {editing ? (
                x.multiline
                  ? <textarea className="input text-sm mt-1 min-h-[70px]" value={f[x.k]} onChange={e => setF(v => ({ ...v, [x.k]: e.target.value }))} />
                  : <input className={`input text-sm mt-1 ${x.type ? 'tabular-nums' : ''} ${String(f[x.k] ?? '') !== String(cur(x.k) ?? '') ? 'border-royal-400 ring-1 ring-royal-200' : ''}`}
                      type={x.type ? 'number' : 'text'} step={x.type === 'money' ? '0.0001' : x.type === 'kg' ? '0.001' : '1'} min="0"
                      value={f[x.k]} onChange={e => setF(v => ({ ...v, [x.k]: e.target.value }))} />
              ) : (
                <div className={`text-sm mt-0.5 ${show(x, cur(x.k)) ? 'text-ink' : x.required ? 'text-warn' : 'text-ink/35'}`}>{show(x, cur(x.k)) || (x.required ? 'Missing' : '—')}</div>
              )}
            </div>
          ))}
        </div>
      </Card>

      <Suppliers si={si} d={d} onUpdateStockItem={onUpdateStockItem} />

      <div className="space-y-3 lg:row-start-1 lg:col-start-2">
        <Card title="Selling" action={<button className="text-xs text-royal-600 hover:underline" onClick={() => onTab('listings')}>All listings</button>}>
          {listings.length ? (
            <div className="space-y-2">
              {listings.slice(0, 4).map(l => (
                <div key={l.row.id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate"><span className="text-ink/50 tabular-nums">{l.qty}× </span>{l.row.name}</span>
                  <span className={`shrink-0 tabular-nums ${l.r.margin < 10 ? 'text-loss' : 'text-ink/70'}`}>{l.live ? pct(l.r.margin) : <span className="text-ink/40">not live</span>}</span>
                </div>
              ))}
              {listings.length > 4 && <div className="text-xs text-ink/45">+{listings.length - 4} more</div>}
            </div>
          ) : <div className="text-sm text-ink/55">No listings yet.</div>}
        </Card>
        <Card title="Stock" action={ip && <button className="text-xs text-royal-600 hover:underline" onClick={() => onTab('stock')}>Shelves</button>}>
          {ip ? (
            <div className="text-sm space-y-1">
              <div className="flex justify-between"><span className="text-ink/60">Shelves</span><span>{(ip.locations || []).map(l => l.code).join(', ') || <span className="text-loss">No location</span>}</span></div>
              <div className="flex justify-between"><span className="text-ink/60">Open orders</span><span className="tabular-nums">{fmtUnits(ip.open_orders)}</span></div>
              <div className="flex justify-between"><span className="text-ink/60">Daily rate</span><span className="tabular-nums">{ip.st.daily ? ip.st.daily.toFixed(1) : '—'}</span></div>
            </div>
          ) : <div className="text-sm text-ink/55">Not in Inventory yet — it comes in through Goods In when its first delivery arrives. Already here? Use <b>Add to Inventory</b>.</div>}
        </Card>
      </div>

      {confirm && (
        <Modal title="Save these changes?" description={si.name} onClose={() => setConfirm(false)}>
          <div className="border border-rule rounded-[8px] divide-y divide-rule/70 text-sm">
            {changes.map(x => (
              <div key={x.k} className="px-3 py-2 grid grid-cols-[110px_1fr] gap-2">
                <span className="text-ink/55">{x.label}</span>
                <span className="min-w-0"><span className="text-ink/45 line-through">{show(x, cur(x.k)) || 'empty'}</span> → <b className="text-ink">{show(x, f[x.k]) || 'empty'}</b></span>
              </div>
            ))}
          </div>
          {costChanged && listings.length > 0 && <div className="text-xs text-warn mt-3">The new cost changes the profit and margin of {listings.length === 1 ? 'its listing' : listings.length === 2 ? 'both its listings' : `all ${listings.length} of its listings`}.</div>}
          {nameChanged && <div className="text-xs text-warn mt-2">It’s renamed everywhere: {ip ? 'Inventory, ' : ''}Products and its purchase orders.</div>}
          <div className="flex gap-2 pt-4">
            <button className="btn btn-secondary flex-1 justify-center" onClick={() => setConfirm(false)}>Keep editing</button>
            <button className="btn btn-primary flex-1 justify-center" disabled={busy} onClick={save}><Icon name="check" size={14} /> {busy ? 'Saving…' : 'Save'}</button>
          </div>
        </Modal>
      )}
      {skuConfirm && (
        <Modal title="Give it this SKU?" description={si.name} onClose={() => setSkuConfirm(false)}>
          <div className="text-sm">Its SKU will be <b className="font-mono">{newSku.trim().toUpperCase()}</b> — used in Inventory, labels and HELM from its first delivery.</div>
          <div className="flex gap-2 pt-4">
            <button className="btn btn-secondary flex-1 justify-center" onClick={() => setSkuConfirm(false)}>Cancel</button>
            <button className="btn btn-primary flex-1 justify-center" disabled={busy} onClick={async () => {
              setBusy(true)
              try { await itemSetSku(si.id, newSku.trim(), me?.name); showToast?.('SKU saved'); setSkuConfirm(false); await onStockItemsChanged?.() }
              catch (e) { showToast?.(e.message, 'error') } finally { setBusy(false) }
            }}>Save SKU</button>
          </div>
        </Modal>
      )}
    </div>
  )
}

/**
 * Everyone we buy it from: their code, pack, cost per unit and when we last bought — learned from POs (a new
 * supplier is added when a PO is raised with them). The product's cost is the last price actually paid; the
 * preferred supplier is who it's normally ordered from.
 */
function Suppliers({ si, d, onUpdateStockItem }) {
  const list = Array.isArray(d.suppliers) ? d.suppliers : []
  const [making, setMaking] = useState(null)
  const [busy, setBusy] = useState(false)
  const unitOf = (e) => num(e.lastPrice) || num(e.costPrice)
  const cheapest = list.filter(e => unitOf(e) > 0).sort((a, b) => unitOf(a) - unitOf(b))[0]
  if (!list.length && !d.supplierName) return <Card title="Suppliers"><div className="text-sm text-ink/55">No supplier yet — raising a PO adds one.</div></Card>
  const rows = list.length ? list : [{ name: d.supplierName, supplierSku: d.supplierSku, costPrice: d.costPrice, packUnits: d.packUnits, preferred: true }]
  return (
    <Card title={`Suppliers · ${rows.length}`}>
      <div className="overflow-x-auto -mx-1">
        <table className="w-full text-sm">
          <thead><tr className="text-[11px] text-ink/45 border-b border-rule">
            <th className="text-left font-semibold px-1 py-1.5">Supplier</th><th className="text-left font-semibold px-1 py-1.5">Their code</th>
            <th className="text-right font-semibold px-1 py-1.5">Pack</th><th className="text-right font-semibold px-1 py-1.5">Cost each</th>
            <th className="text-left font-semibold px-1 py-1.5">Last bought</th><th className="px-1" />
          </tr></thead>
          <tbody>
            {rows.map((e, i) => {
              const paidLast = d.lastPaid && sameSupplier(d.lastPaid.supplier, e.name)
              return (
                <tr key={`${e.name}-${i}`} className="border-b border-rule/60 last:border-0">
                  <td className="px-1 py-2"><div className="text-ink">{e.name}</div>
                    <div className="flex gap-1 mt-0.5 flex-wrap">
                      {e.preferred && <StatusBadge tone="brand">Preferred</StatusBadge>}
                      {cheapest && cheapest === e && rows.length > 1 && <StatusBadge tone="live">Cheapest</StatusBadge>}
                      {paidLast && <StatusBadge tone="quiet">Cost from here</StatusBadge>}
                    </div></td>
                  <td className="px-1 py-2 text-ink/70 font-mono text-xs">{e.supplierSku || '—'}</td>
                  <td className="px-1 py-2 text-right tabular-nums text-ink/70">{num(e.packUnits) > 1 ? `${num(e.packUnits)} for ${fmt(num(e.lastPackPrice) || num(e.packPrice))}` : 'single'}</td>
                  <td className="px-1 py-2 text-right tabular-nums font-medium">{unitOf(e) > 0 ? `£${unitOf(e).toFixed(unitOf(e) < 1 ? 4 : 2)}` : '—'}</td>
                  <td className="px-1 py-2 text-xs text-ink/60 whitespace-nowrap">{e.lastBoughtAt ? <>{day(e.lastBoughtAt)}<div className="text-ink/40">{e.lastPo}{e.orders > 1 ? ` · ${e.orders} orders` : ''}</div></> : 'never ordered here'}</td>
                  <td className="px-1 py-2 text-right">{!e.preferred && list.length > 0 && <button className="text-xs text-royal-600 hover:underline whitespace-nowrap" onClick={() => setMaking(e)}>Make preferred</button>}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {d.lastPaid && <div className="text-[11px] text-ink/50 mt-2">Its cost is the last price paid: £{num(d.lastPaid.unit).toFixed(4)} each from {d.lastPaid.supplier} on {d.lastPaid.po} ({day(d.lastPaid.at)}).</div>}
      {making && (
        <Modal title={`Make ${making.name} the preferred supplier?`} description={si.name} onClose={() => setMaking(null)}>
          <div className="text-sm text-ink/75">New POs default to them for this product, and it shows them as its supplier. Its cost still follows the last price actually paid.</div>
          <div className="flex gap-2 pt-4">
            <button className="btn btn-secondary flex-1 justify-center" onClick={() => setMaking(null)}>Cancel</button>
            <button className="btn btn-primary flex-1 justify-center" disabled={busy} onClick={async () => {
              setBusy(true)
              try {
                await onUpdateStockItem(si.id, { ...d, name: si.name, supplierName: making.name, supplierSku: making.supplierSku || d.supplierSku || '',
                  suppliers: list.map(x => ({ ...x, preferred: x === making })) })
                setMaking(null)
              } finally { setBusy(false) }
            }}>Make preferred</button>
          </div>
        </Modal>
      )}
    </Card>
  )
}

function Listings({ listings, onNavigate, onCreateListing, live }) {
  const { stockItems = [] } = live || {}
  const liveOnes = listings.filter(l => l.live)
  const others = listings.filter(l => !l.live)
  if (listings.length && live?.onUpdatePrice) {
    return (
      <div className="space-y-4">
        {liveOnes.length > 0 && (
          <div>
            <div className="title-case text-sm font-semibold text-ink mb-2">Live — {liveOnes.length}</div>
            <div className="space-y-3">
              {liveOnes.map(l => (
                <LiveProductRow key={l.live.id} lp={l.live} saved={l.row} p={l.row.data || l.row}
                  settings={live.settings} stockItems={stockItems} onNavigate={onNavigate}
                  onStatusChange={live.onStatusChange} onRemove={live.onRemove} onUpdatePrice={live.onUpdatePrice} onOrderStock={live.onOrderStock}
                  history={live.priceHistory.filter(h => h.saved_product_id === l.row.id)}
                  costs={live.costHistory.filter(h => h.saved_product_id === l.row.id)} />
              ))}
            </div>
          </div>
        )}
        {others.length > 0 && (
          <div>
            <div className="title-case text-sm font-semibold text-ink mb-2">Not live — {others.length}</div>
            <ListingsTable listings={others} onNavigate={onNavigate} />
          </div>
        )}
      </div>
    )
  }
  if (!listings.length) return <Card><div className="text-sm text-ink/55 py-6 text-center">No listings sell this product yet. <button className="text-royal-600 hover:underline" onClick={onCreateListing}>Start one</button></div></Card>
  return <ListingsTable listings={listings} onNavigate={onNavigate} />
}

function ListingsTable({ listings, onNavigate }) {
  return (
    <div className="card p-0 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-rule bg-paper text-xs text-ink/45">
            <th className="text-left px-4 py-2.5 font-semibold">Listing</th><th className="px-3 py-2.5 font-semibold">Qty</th><th className="text-left px-3 py-2.5 font-semibold">Status</th>
            <th className="text-right px-3 py-2.5 font-semibold">Price</th><th className="text-right px-3 py-2.5 font-semibold">Profit</th><th className="text-right px-4 py-2.5 font-semibold">Margin</th>
          </tr></thead>
          <tbody>
            {listings.map(l => {
              const st = l.live ? ['Live', 'live'] : l.p.reviewStatus === 'approved' ? ['Approved', 'brand'] : l.p.reviewStatus === 'review' ? ['In review', 'brand'] : ['Draft', 'quiet']
              return (
                <tr key={l.row.id} className="border-b border-rule/60 last:border-0 hover:bg-paper">
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <div className="w-9 h-9 rounded border border-rule bg-white overflow-hidden shrink-0 flex items-center justify-center">
                        <ProductImage asin={l.p.asin} manualImage={l.p.productImage} alt={l.row.name} className="object-contain w-full h-full p-0.5" placeholderSize="text-xs" />
                      </div>
                      <div className="min-w-0">
                        <button className="text-ink font-medium text-left hover:text-royal-600 hover:underline" onClick={() => onNavigate?.(l.live ? 'live' : 'saved', l.row.id)}>{l.row.name}</button>
                        <div className="text-[11px] text-ink/45 flex gap-2">{l.p.asin ? <AmazonLink asin={l.p.asin} /> : 'No ASIN'}{l.mixed && <span>Mixed bundle</span>}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-center tabular-nums">{l.qty}×</td>
                  <td className="px-3 py-2.5"><StatusBadge tone={st[1]} dot>{st[0]}</StatusBadge></td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{l.r.sellPrice ? fmt(l.r.sellPrice) : '—'}</td>
                  <td className={`px-3 py-2.5 text-right tabular-nums ${l.r.netProfit < 0 ? 'text-loss' : ''}`}>{fmt(l.r.netProfit)}</td>
                  <td className={`px-4 py-2.5 text-right tabular-nums font-medium ${l.r.margin < 10 ? 'text-loss' : 'text-ink'}`}>{pct(l.r.margin)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Sales({ si, ip }) {
  const [days, setDays] = useState(90)
  const [s, setS] = useState(null)
  useEffect(() => { setS(null); loadProductSales(si.id, days).then(setS).catch(() => setS({ daily: [], codes: [], units: 0, orders: 0 })) }, [si.id, days])
  if (!ip) return <Card><div className="text-sm text-ink/55 py-6 text-center">Not in Inventory yet, so nothing has been despatched.</div></Card>
  return (
    <div className="grid lg:grid-cols-[2fr_1fr] gap-3 items-start">
      <Card title="Units despatched" action={
        <div className="flex gap-1">{[30, 90, 365].map(n => <button key={n} className={`btn btn-xs ${days === n ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setDays(n)}>{n === 365 ? '1 year' : `${n} days`}</button>)}</div>}>
        {!s ? <Spinner /> : (
          <>
            <div className="flex gap-6 mb-4 text-sm">
              <div><div className="text-2xl font-semibold text-ink tabular-nums">{fmtUnits(s.units)}</div><div className="text-ink/50 text-xs">units</div></div>
              <div><div className="text-2xl font-semibold text-ink tabular-nums">{fmtUnits(s.orders)}</div><div className="text-ink/50 text-xs">orders</div></div>
              <div><div className="text-2xl font-semibold text-ink tabular-nums">{(s.units / days).toFixed(1)}</div><div className="text-ink/50 text-xs">a day on average</div></div>
            </div>
            <Bars daily={s.daily || []} days={days} />
            <div className="text-[11px] text-ink/45 mt-3">Counted from despatch, since stock started being tracked in the portal.</div>
          </>
        )}
      </Card>
      <Card title="Sold as">
        {!s ? <Spinner /> : s.codes?.length ? (
          <div className="space-y-1.5">
            {s.codes.map(c => (
              <div key={c.code} className="flex items-center justify-between gap-3 text-sm">
                <span className="font-mono text-xs text-ink/75 truncate">{c.code}</span>
                <span className="shrink-0 tabular-nums text-ink/70">{fmtUnits(c.units)} <span className="text-ink/40">· {c.orders} orders</span></span>
              </div>
            ))}
            {s.substitutes > 0 && <div className="text-xs text-ink/55 pt-2 border-t border-rule">{fmtUnits(s.substitutes)} units went out as a substitute for something else.</div>}
          </div>
        ) : <div className="text-sm text-ink/55">Nothing despatched in this period.</div>}
      </Card>
    </div>
  )
}

function Stock({ ip, onNavigate, onAdd }) {
  const [moves, setMoves] = useState(null)
  useEffect(() => { if (ip) loadMovements({ productId: ip.id, limit: 30 }).then(setMoves).catch(() => setMoves([])) }, [ip?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!ip) return (
    <Card>
      <div className="text-sm text-ink/55 py-6 text-center">
        Not in Inventory yet — it comes in through Goods In when its first delivery arrives.
        {onAdd && <div className="mt-3"><button className="btn btn-primary btn-sm" onClick={onAdd}><Icon name="box" size={14} /> Add to Inventory — it’s already here</button></div>}
      </div>
    </Card>
  )
  return (
    <div className="grid lg:grid-cols-[1fr_1.4fr] gap-3 items-start">
      <Card title="Shelves" action={<button className="text-xs text-royal-600 hover:underline" onClick={() => onNavigate?.('inventory', ip.id)}>Move, add or count</button>}>
        {(ip.locations || []).length ? (
          <div className="divide-y divide-rule/70">
            {ip.locations.map(l => (
              <div key={l.code} className="flex items-center justify-between py-2 text-sm">
                <span className="font-mono">{l.code} {l.pickable && <span className="text-[11px] text-gain font-sans ml-1">pick</span>}</span>
                <span className="tabular-nums font-medium">{fmtUnits(l.qty)}</span>
              </div>
            ))}
          </div>
        ) : <div className="text-sm text-loss">No location{ip.nowhere > 0 ? ` · ${fmtUnits(ip.nowhere)} not on a shelf` : ''}</div>}
        <div className="grid grid-cols-2 gap-2 mt-3 text-sm">
          <div className="rounded-[6px] bg-paper px-3 py-2"><div className="text-[11px] text-ink/50">Open orders</div><div className="font-semibold tabular-nums">{fmtUnits(ip.open_orders)}</div></div>
          <div className="rounded-[6px] bg-paper px-3 py-2"><div className="text-[11px] text-ink/50">Reorder when cover is under</div><div className="font-semibold tabular-nums">{ip.st.lead} days</div></div>
        </div>
      </Card>
      <Card title="Recent stock changes">
        {!moves ? <Spinner /> : moves.length ? (
          <div className="divide-y divide-rule/70">
            {moves.map(m => (
              <div key={m.id} className="flex items-center justify-between gap-3 py-1.5 text-sm">
                <span className="min-w-0 truncate"><span className="text-ink/50 tabular-nums text-xs">{day(m.at)} {time(m.at)}</span> · {m.kind === 'despatch' ? 'Despatched' : m.kind === 'goods_in' ? 'Put away' : m.kind === 'opening' ? 'Opening count' : m.kind} <span className="text-ink/45">{m.location}{m.ref ? ` · ${m.ref}` : ''}</span></span>
                <span className={`shrink-0 tabular-nums font-medium ${m.qty < 0 ? 'text-loss' : 'text-gain'}`}>{m.qty > 0 ? '+' : ''}{fmtUnits(m.qty)}</span>
              </div>
            ))}
          </div>
        ) : <div className="text-sm text-ink/55">No changes yet.</div>}
      </Card>
    </div>
  )
}

function Purchasing({ purchases, d, onNavigate }) {
  if (!purchases) return <Card><Spinner /></Card>
  const orders = purchases.filter(x => x.kind !== 'credit_note')
  const costs = orders.map(x => parseFloat(x.unit_cost)).filter(c => c > 0)
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <MetricCard label="Orders" value={orders.length} />
        <MetricCard label="Units ordered" value={fmtUnits(orders.reduce((s, x) => s + num(x.qty), 0))} />
        <MetricCard label="Last cost" value={costs.length ? fmt(costs[0]) : '—'} sub={money(d.costPrice) && costs.length && Math.abs(costs[0] - num(d.costPrice)) > 0.005 ? `Product says ${money(d.costPrice)}` : ''} />
        <MetricCard label="Lead time" value={d.leadDays ? `${d.leadDays} days` : '—'} />
      </div>
      {(() => {
        const by = new Map()
        for (const x of orders) {
          if (x.line_status === 'cancelled' || x.status === 'cancelled') continue
          const k = x.supplier || '—'
          const g = by.get(k) || { name: k, orders: 0, units: 0, costs: [] }
          g.orders++; g.units += num(x.qty); if (num(x.unit_cost) > 0) g.costs.push(num(x.unit_cost)); by.set(k, g)
        }
        const groups = [...by.values()]
        if (groups.length < 2) return null
        return (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {groups.map(g => (
              <div key={g.name} className="card py-3">
                <div className="title-case text-sm font-semibold text-ink">{g.name}</div>
                <div className="text-xs text-ink/55 mt-0.5">{g.orders} order{g.orders !== 1 ? 's' : ''} · {fmtUnits(g.units)} ordered</div>
                {g.costs.length > 0 && <div className="text-xs text-ink/70 mt-1 tabular-nums">Last {fmt(g.costs[0])} · lowest {fmt(Math.min(...g.costs))} a line unit</div>}
              </div>
            ))}
          </div>
        )
      })()}
      <div className="card p-0 overflow-hidden">
        {orders.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-rule bg-paper text-xs text-ink/45">
                <th className="text-left px-4 py-2.5 font-semibold">PO</th><th className="text-left px-3 py-2.5 font-semibold">Supplier</th><th className="text-left px-3 py-2.5 font-semibold">Raised</th>
                <th className="text-right px-3 py-2.5 font-semibold">Ordered</th><th className="text-right px-3 py-2.5 font-semibold">Received</th><th className="text-right px-3 py-2.5 font-semibold">Unit cost</th><th className="text-left px-4 py-2.5 font-semibold">Status</th>
              </tr></thead>
              <tbody>
                {orders.map(x => (
                  <tr key={`${x.po_id}-${x.created_at}`} className="border-b border-rule/60 last:border-0 hover:bg-paper">
                    <td className="px-4 py-2.5"><button className="font-mono text-xs text-royal-600 hover:underline" onClick={() => onNavigate?.('purchases', x.po_id)}>{x.po_number}</button></td>
                    <td className="px-3 py-2.5 text-ink/75">{x.supplier}</td>
                    <td className="px-3 py-2.5 text-ink/60 whitespace-nowrap">{day(x.created_at)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{fmtUnits(x.qty)}</td>
                    <td className={`px-3 py-2.5 text-right tabular-nums ${x.qty_received < x.qty ? 'text-ink/50' : ''}`}>{fmtUnits(x.qty_received)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{x.unit_cost ? fmt(parseFloat(x.unit_cost)) : '—'}</td>
                    <td className="px-4 py-2.5 text-ink/65 capitalize whitespace-nowrap">{String(x.line_status === 'cancelled' ? 'cancelled' : x.status || '').replace(/_/g, ' ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className="text-sm text-ink/55 py-8 text-center">Never ordered yet.</div>}
      </div>
    </div>
  )
}

const TYPE_ICON = { stock: 'package', listing: 'tag', purchase: 'briefcase', delivery: 'truck', despatch: 'send', inventory: 'box', dispatch: 'send' }
function Timeline({ si }) {
  const [rows, setRows] = useState(null)
  useEffect(() => { loadProductTimeline(si.id, 300).then(setRows).catch(() => setRows([])) }, [si.id])
  const byDay = useMemo(() => {
    const m = new Map()
    for (const r of rows || []) { const k = day(r.at); if (!m.has(k)) m.set(k, []); m.get(k).push(r) }
    return [...m]
  }, [rows])
  if (!rows) return <Card><Spinner /></Card>
  if (!rows.length) return <Card><div className="text-sm text-ink/55 py-6 text-center">Nothing recorded yet.</div></Card>
  return (
    <div className="card">
      {byDay.map(([d, items]) => (
        <div key={d} className="mb-4 last:mb-0">
          <div className="text-[11px] uppercase tracking-wide text-ink/40 font-semibold mb-1.5">{d}</div>
          <div className="border-l-2 border-rule ml-2 pl-4 space-y-2">
            {items.map((r, i) => (
              <div key={i} className="relative text-sm">
                <span className="absolute -left-[25px] top-0.5 w-4 h-4 rounded-full bg-white border border-rule flex items-center justify-center"><Icon name={TYPE_ICON[r.type] || 'clock'} size={10} className="text-ink/50" /></span>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0"><b className="text-ink font-medium">{r.action}</b>{r.name && r.type !== 'stock' ? <span className="text-ink/55"> · {r.name}</span> : ''}{r.detail ? <span className="text-ink/60"> — {r.detail}</span> : ''}</span>
                  <span className="shrink-0 text-[11px] text-ink/40 tabular-nums">{time(r.at)}{r.who ? ` · ${r.who}` : ''}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
