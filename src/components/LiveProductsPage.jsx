import React, { useState, useEffect, useMemo } from 'react'
import { fmt, pct, fmtSigned, calcProduct, effectiveWeight } from '../lib/calc'
import { ProductImage } from './UI'
import { exportRowsToCsv, stampedName } from '../lib/csv'

const SORT_OPTIONS = [
  { value: 'newest',      label: 'Newest live first' },
  { value: 'oldest',      label: 'Oldest live first' },
  { value: 'profitHigh',  label: 'Profit — high to low' },
  { value: 'profitLow',   label: 'Profit — low to high' },
  { value: 'marginHigh',  label: 'Margin — high to low' },
  { value: 'marginLow',   label: 'Margin — low to high' },
  { value: 'priceHigh',   label: 'Sell price — high to low' },
  { value: 'priceLow',    label: 'Sell price — low to high' },
  { value: 'nameAZ',      label: 'Name — A to Z' },
  { value: 'nameZA',      label: 'Name — Z to A' },
  { value: 'brandAZ',     label: 'Brand — A to Z' },
]

export default function LiveProductsPage({ liveProducts, savedProducts, stockItems = [], settings, priceHistory = [], costHistory = [], focusId, onNavigate, onStatusChange, onRemove, onUpdatePrice }) {
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState('newest')
  const [brandFilter, setBrandFilter] = useState('')
  const [supplierFilter, setSupplierFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [marginFilter, setMarginFilter] = useState('')

  React.useEffect(() => {
    if (!focusId) return
    setSearch(''); setBrandFilter(''); setSupplierFilter(''); setStatusFilter(''); setMarginFilter('')
    const t = setTimeout(() => {
      document.getElementById(`live-${focusId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 80)
    return () => clearTimeout(t)
  }, [focusId])

  const all = useMemo(() => liveProducts
    .map(lp => {
      const saved = savedProducts.find(s => s.id === lp.saved_product_id)
      if (!saved) return null
      const p = saved.data || saved
      const r = calcProduct(p, settings.carriers, settings.packaging, stockItems)
      return { lp, saved, p, r }
    })
    .filter(Boolean), [liveProducts, savedProducts, settings])

  // Unique brands and suppliers for the filter dropdowns
  const brands = useMemo(() =>
    [...new Set(all.map(x => (x.p.brand || '').trim()).filter(Boolean))].sort(), [all])
  const suppliers = useMemo(() =>
    [...new Set(all.map(x => (x.p.supplierName || '').trim()).filter(Boolean))].sort(), [all])

  const filtered = all.filter(({ p, saved, r, lp }) => {
    if (brandFilter && (p.brand || '').trim() !== brandFilter) return false
    if (supplierFilter && (p.supplierName || '').trim() !== supplierFilter) return false
    if (statusFilter && lp.status !== statusFilter) return false
    if (marginFilter === 'negative' && r.netProfit >= 0) return false
    if (marginFilter === 'low' && !(r.margin >= 0 && r.margin < 10)) return false
    if (marginFilter === 'healthy' && r.margin < 20) return false
    if (search.trim()) {
      const q = search.toLowerCase()
      const hit = saved.name?.toLowerCase().includes(q) ||
        (p.brand || '').toLowerCase().includes(q) ||
        (p.asin || '').toLowerCase().includes(q) ||
        (p.supplierSku || '').toLowerCase().includes(q) ||
        (p.supplierName || '').toLowerCase().includes(q)
      if (!hit) return false
    }
    return true
  })

  const sorted = [...filtered].sort((a, b) => {
    switch (sort) {
      case 'newest':     return new Date(b.lp.went_live_at) - new Date(a.lp.went_live_at)
      case 'oldest':     return new Date(a.lp.went_live_at) - new Date(b.lp.went_live_at)
      case 'profitHigh': return b.r.netProfit - a.r.netProfit
      case 'profitLow':  return a.r.netProfit - b.r.netProfit
      case 'marginHigh': return b.r.margin - a.r.margin
      case 'marginLow':  return a.r.margin - b.r.margin
      case 'priceHigh':  return b.r.sellPrice - a.r.sellPrice
      case 'priceLow':   return a.r.sellPrice - b.r.sellPrice
      case 'nameAZ':     return a.saved.name.localeCompare(b.saved.name)
      case 'nameZA':     return b.saved.name.localeCompare(a.saved.name)
      case 'brandAZ':    return (a.p.brand || 'zzz').localeCompare(b.p.brand || 'zzz')
      default: return 0
    }
  })

  // Portfolio stats across everything currently live
  const liveOnly = all.filter(x => x.lp.status === 'live')
  const stats = {
    live: liveOnly.length,
    paused: all.filter(x => x.lp.status === 'paused').length,
    avgMargin: liveOnly.length ? liveOnly.reduce((s, x) => s + x.r.margin, 0) / liveOnly.length : 0,
    lossMaking: liveOnly.filter(x => x.r.netProfit < 0).length,
    lowMargin: liveOnly.filter(x => x.r.margin >= 0 && x.r.margin < 10).length,
    brands: brands.length,
    suppliers: suppliers.length,
  }

  const clearFilters = () => {
    setBrandFilter(''); setSupplierFilter(''); setStatusFilter(''); setMarginFilter(''); setSearch('')
  }
  const anyFilter = brandFilter || supplierFilter || statusFilter || marginFilter || search.trim()

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h1 className="text-[28px] leading-tight">Live Products</h1>
          <p className="text-sm text-ink/50 mt-1">
            {stats.live} live · {stats.paused} paused · {stats.brands} brand{stats.brands !== 1 ? 's' : ''} · {stats.suppliers} supplier{stats.suppliers !== 1 ? 's' : ''}
          </p>
        </div>
        <button
          className="btn btn-secondary btn-sm"
          onClick={() => exportRowsToCsv(stampedName('live-products'), sorted, [
            { header: 'Product', value: x => x.saved.name },
            { header: 'Brand', value: x => x.p.brand || '' },
            { header: 'ASIN', value: x => x.p.asin || '' },
            { header: 'Supplier', value: x => x.p.supplierName || '' },
            { header: 'Supplier SKU', value: x => x.p.supplierSku || '' },
            { header: 'Status', value: x => x.lp.status },
            { header: 'Sell Price', value: x => x.r.sellPrice.toFixed(2) },
            { header: 'Cost Price', value: x => x.r.costPrice.toFixed(2) },
            { header: 'Bundle Qty', value: x => x.p.bundleQty || 1 },
            { header: 'Referral Fee', value: x => x.r.referralFee.toFixed(2) },
            { header: 'Shipping', value: x => x.r.shippingCost.toFixed(2) },
            { header: 'Packaging', value: x => x.r.packCost.toFixed(2) },
            { header: 'Ad Cost', value: x => x.r.adCost.toFixed(2) },
            { header: 'VAT', value: x => x.r.vatAmount.toFixed(2) },
            { header: 'Net Profit', value: x => x.r.netProfit.toFixed(2) },
            { header: 'Margin %', value: x => x.r.margin.toFixed(1) },
            { header: 'Break Even', value: x => x.r.breakEven.toFixed(2) },
            { header: 'Weight KG', value: x => effectiveWeight(x.p).toFixed(3) },
            { header: 'Live Since', value: x => new Date(x.lp.went_live_at).toLocaleDateString('en-GB') },
          ])}
          disabled={sorted.length === 0}
        >⬇ Export CSV</button>
      </div>

      {/* Alerts */}
      {(stats.lossMaking > 0 || stats.lowMargin > 0) && (
        <div className="flex gap-2 mb-4 flex-wrap">
          {stats.lossMaking > 0 && (
            <button
              className="text-sm px-3 py-2 rounded-xl bg-loss/5 border border-loss/25 text-loss font-medium hover:bg-loss/10 transition-colors"
              onClick={() => { setMarginFilter('negative'); setStatusFilter('live') }}
            >
              ⚠ {stats.lossMaking} live listing{stats.lossMaking !== 1 ? 's are' : ' is'} making a loss — review
            </button>
          )}
          {stats.lowMargin > 0 && (
            <button
              className="text-sm px-3 py-2 rounded-xl bg-warn/5 border border-warn/25 text-warn font-medium hover:bg-warn/10 transition-colors"
              onClick={() => { setMarginFilter('low'); setStatusFilter('live') }}
            >
              {stats.lowMargin} under 10% margin
            </button>
          )}
        </div>
      )}

      {all.length === 0 ? (
        <div className="card flex flex-col items-center justify-center py-16 text-center">
          <div className="text-4xl mb-3">🟢</div>
          <div className="font-medium text-ink/80 mb-1">No live listings yet</div>
          <div className="text-sm text-ink/45">Go to Saved Products and click "Go Live" on a product</div>
        </div>
      ) : (
        <>
          {/* Controls */}
          <div className="card mb-4 py-3">
            <div className="flex gap-3 flex-wrap items-end">
              <div>
                <label className="label text-xs">Search</label>
                <input
                  type="text"
                  placeholder="Name, brand, ASIN, SKU…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="input text-sm"
                  style={{ width: 220 }}
                />
              </div>
              <div>
                <label className="label text-xs">Sort by</label>
                <select className="input text-sm" style={{ width: 190 }} value={sort} onChange={e => setSort(e.target.value)}>
                  {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label className="label text-xs">Brand</label>
                <select className="input text-sm" style={{ width: 150 }} value={brandFilter} onChange={e => setBrandFilter(e.target.value)}>
                  <option value="">All brands</option>
                  {brands.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>
              <div>
                <label className="label text-xs">Supplier</label>
                <select className="input text-sm" style={{ width: 160 }} value={supplierFilter} onChange={e => setSupplierFilter(e.target.value)}>
                  <option value="">All suppliers</option>
                  {suppliers.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="label text-xs">Status</label>
                <select className="input text-sm" style={{ width: 120 }} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                  <option value="">All</option>
                  <option value="live">Live only</option>
                  <option value="paused">Paused only</option>
                </select>
              </div>
              <div>
                <label className="label text-xs">Margin</label>
                <select className="input text-sm" style={{ width: 150 }} value={marginFilter} onChange={e => setMarginFilter(e.target.value)}>
                  <option value="">Any margin</option>
                  <option value="negative">Loss making</option>
                  <option value="low">Under 10%</option>
                  <option value="healthy">20% and above</option>
                </select>
              </div>
              {anyFilter && (
                <button className="btn btn-secondary btn-sm" onClick={clearFilters}>Clear filters</button>
              )}
            </div>
            {anyFilter && (
              <div className="text-xs text-ink/45 mt-2">
                Showing {sorted.length} of {all.length} listings
              </div>
            )}
          </div>

          {sorted.length === 0 ? (
            <div className="card py-12 text-center text-sm text-ink/45">
              No listings match those filters.
            </div>
          ) : (
            <div className="space-y-3">
              {sorted.map(({ lp, saved, p }) => (
                <LiveProductRow
                  key={lp.id}
                  lp={lp} saved={saved} p={p}
                  settings={settings}
                  stockItems={stockItems}
                  focusId={focusId}
                  onNavigate={onNavigate}
                  onStatusChange={onStatusChange}
                  onRemove={onRemove}
                  onUpdatePrice={onUpdatePrice}
                  history={priceHistory.filter(h => h.saved_product_id === saved.id)}
                  costs={costHistory.filter(h => h.saved_product_id === saved.id)}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function LiveProductRow({ lp, saved, p, settings, stockItems = [], focusId, onNavigate, onStatusChange, onRemove, onUpdatePrice, history = [], costs = [] }) {
  const isLive = lp.status === 'live'
  const asin = p.asin?.trim()
  const amazonUrl = asin ? `https://www.amazon.co.uk/dp/${asin}` : null
  const wentLive = new Date(lp.went_live_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  const daysLive = Math.floor((Date.now() - new Date(lp.went_live_at)) / 86400000)
  const isBundle = parseInt(p.bundleQty) > 1

  const [price, setPrice] = useState(p.sellPrice || '')
  const [saving, setSaving] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [note, setNote] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  const [showCosts, setShowCosts] = useState(false)
  useEffect(() => { setPrice(p.sellPrice || '') }, [p.sellPrice])

  const savedPrice = parseFloat(p.sellPrice) || 0
  const currentPrice = parseFloat(price) || 0
  const hasChanged = Math.abs(currentPrice - savedPrice) > 0.001

  const r = calcProduct({ ...p, sellPrice: price }, settings.carriers, settings.packaging, stockItems)
  const rSaved = calcProduct(p, settings.carriers, settings.packaging, stockItems)
  const profitDelta = r.netProfit - rSaved.netProfit
  const marginDelta = r.margin - rSaved.margin

  const handleConfirmSave = async () => {
    setSaving(true)
    await onUpdatePrice(saved.id, { ...p, sellPrice: price }, {
      oldPrice: savedPrice, newPrice: currentPrice,
      oldMargin: rSaved.margin, newMargin: r.margin,
      oldProfit: rSaved.netProfit, newProfit: r.netProfit,
      costPrice: r.costPrice,
      note: note.trim(),
    })
    setSaving(false)
    setConfirming(false)
    setNote('')
  }

  const lossMaking = r.netProfit < 0

  return (
    <div id={`live-${saved.id}`} className={`card relative border-2 transition-colors ${
      focusId === saved.id ? 'border-royal-400 ring-2 ring-royal-200'
        : lossMaking ? 'border-loss/25' : isLive ? 'border-gain/25' : 'border-rule bg-paper/50'
    }`}>
      {/* Remove — tucked in the corner, away from everything else */}
      <button
        className="absolute top-2 right-2 w-7 h-7 rounded-lg text-ink/30 hover:text-loss hover:bg-loss/5 transition-colors flex items-center justify-center text-sm"
        title="Remove from live listings"
        onClick={() => { if (window.confirm(`Remove "${saved.name}" from live listings?\n\nThis only removes it from Live Products — the saved product stays.`)) onRemove(lp.id) }}
      >✕</button>

      <div className="flex gap-4 flex-wrap pr-8">
        {/* Image */}
        <div className="flex-shrink-0 bg-white rounded-xl border border-rule flex items-center justify-center overflow-hidden" style={{ width: 90, height: 90 }}>
          <ProductImage asin={asin} manualImage={p.productImage} alt={saved.name}
            className="object-contain w-full h-full p-1.5" placeholderSize="text-3xl" />
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0" style={{ minWidth: 220 }}>
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            {p.brand && <span className="text-xs font-semibold text-royal-500">{p.brand}</span>}
            <span className={`pill ${isLive ? 'pill-live' : 'pill-paused'}`}>
              {isLive ? 'Live' : 'Paused'}
            </span>
            {isBundle && <span className="pill pill-brand">Bundle ×{p.bundleQty}</span>}
            {lossMaking && <span className="pill pill-alert">⚠ Loss making</span>}
            {isBundle && !p.weightPerItem && !p.weightOverride && (
              <span className="pill pill-alert">⚠ Check weight</span>
            )}
          </div>
          <div className="font-semibold text-ink leading-snug">{saved.name}</div>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-xs">
            {asin ? (
              <a href={amazonUrl} target="_blank" rel="noopener noreferrer" className="text-royal-500 hover:text-royal-700 font-medium">
                ASIN: {asin} ↗
              </a>
            ) : <span className="text-ink/30">No ASIN</span>}
            {p.supplierName && <span className="text-ink/45">{p.supplierName}</span>}
            {p.supplierSku && <span className="text-ink/45">SKU: {p.supplierSku}</span>}
            <span className="text-ink/45">Cost: {fmt(r.costPrice)}</span>
            {Array.isArray(p.components) && p.components.length > 0 && p.components.map((cp, i) => {
              const si = stockItems.find(s => s.id === cp.stockItemId)
              if (!si) return null
              return (
                <button key={i}
                  className="text-royal-400 hover:text-royal-600 hover:underline"
                  onClick={() => onNavigate?.('stock', si.id)}
                  title="Open this stock item"
                >{cp.qty}× {si.name}</button>
              )
            })}
            <span className="text-ink/45" title={`Live since ${wentLive}`}>
              {daysLive === 0 ? 'Live today' : `${daysLive}d live`}
            </span>
            {p.liveByName && <span className="text-ink/45">by {p.liveByName}</span>}
            {history.length > 0 && (
              <button
                className="text-royal-400 hover:text-royal-600 font-medium"
                onClick={() => { setExpanded(true); setShowHistory(true) }}
              >
                {history.length} price change{history.length !== 1 ? 's' : ''}
              </button>
            )}
            {costs.length > 0 && (() => {
              const oldest = costs[costs.length - 1]
              const drift = r.costPrice - (oldest.old_cost || 0)
              if (Math.abs(drift) < 0.01) return null
              const up = drift > 0
              const pctDrift = oldest.old_cost ? (drift / oldest.old_cost) * 100 : 0
              return (
                <button
                  className={`font-medium ${up ? 'text-loss hover:text-loss' : 'text-gain hover:text-gain'}`}
                  onClick={() => { setExpanded(true); setShowCosts(true) }}
                  title={`Cost has moved from ${fmt(oldest.old_cost)} to ${fmt(r.costPrice)}`}
                >
                  Cost {up ? '↑' : '↓'} {Math.abs(pctDrift).toFixed(0)}%
                </button>
              )
            })()}
          </div>
        </div>

        {/* Price + metrics */}
        <div className="flex-shrink-0" style={{ minWidth: 300 }}>
          <div className="flex items-end gap-2 mb-2">
            <div>
              <label className="label text-xs">Sell price £</label>
              <input
                type="number" step="0.01"
                className={`input text-sm font-semibold ${hasChanged ? 'border-amber-400 bg-warn/5' : ''}`}
                style={{ width: 110 }}
                value={price}
                onChange={e => setPrice(e.target.value)}
              />
            </div>
            {hasChanged && (
              <>
                <button className="btn btn-primary btn-sm" onClick={() => setConfirming(true)} disabled={saving}>
                  {saving ? '…' : 'Set as live price'}
                </button>
                <button className="btn btn-secondary btn-sm" onClick={() => { setPrice(p.sellPrice || ''); setConfirming(false) }}>Reset</button>
              </>
            )}
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="metric-card py-2">
              <div className="metric-label">Profit</div>
              <div className={`metric-value text-sm ${r.netProfit >= 0 ? 'text-gain' : 'text-loss'}`}>{fmtSigned(r.netProfit)}</div>
              {hasChanged && (
                <div className={`text-xs mt-0.5 ${profitDelta >= 0 ? 'text-gain' : 'text-loss'}`}>
                  {profitDelta >= 0 ? '▲' : '▼'} {fmt(Math.abs(profitDelta))}
                </div>
              )}
            </div>
            <div className="metric-card py-2">
              <div className="metric-label">Margin</div>
              <div className={`metric-value text-sm ${r.margin >= 0 ? 'text-gain' : 'text-loss'}`}>{pct(r.margin)}</div>
              {hasChanged && (
                <div className={`text-xs mt-0.5 ${marginDelta >= 0 ? 'text-gain' : 'text-loss'}`}>
                  {marginDelta >= 0 ? '▲' : '▼'} {Math.abs(marginDelta).toFixed(1)}%
                </div>
              )}
            </div>
            <div className="metric-card py-2">
              <div className="metric-label">Break-even</div>
              <div className="metric-value text-sm">{fmt(r.breakEven)}</div>
              {currentPrice > 0 && currentPrice < r.breakEven && (
                <div className="text-xs mt-0.5 text-loss font-medium">Below!</div>
              )}
            </div>
          </div>

          {hasChanged && !confirming && (
            <div className="text-xs text-warn mt-1.5 font-medium">
              Trying out {fmt(currentPrice)} — not saved. Current live price is {fmt(savedPrice)}.
            </div>
          )}

          {/* Confirmation — this is the only thing that writes to history */}
          {confirming && (
            <div className="mt-2 p-3 bg-royal-50 border border-royal-200 rounded-xl">
              <div className="text-sm font-semibold text-ink mb-1">
                Change the live price to {fmt(currentPrice)}?
              </div>
              <div className="text-xs text-ink/55 mb-2">
                {fmt(savedPrice)} → {fmt(currentPrice)} · margin {pct(rSaved.margin)} → {pct(r.margin)}
                {' '}({marginDelta >= 0 ? '+' : ''}{marginDelta.toFixed(1)}%)
              </div>
              <input
                autoFocus
                className="input text-sm mb-2"
                placeholder="Reason (optional) — e.g. matching competitor, supplier cost up"
                value={note}
                onChange={e => setNote(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleConfirmSave(); if (e.key === 'Escape') setConfirming(false) }}
              />
              <div className="flex gap-2">
                <button className="btn btn-primary btn-sm" onClick={handleConfirmSave} disabled={saving}>
                  {saving ? 'Saving…' : 'Confirm change'}
                </button>
                <button className="btn btn-secondary btn-sm" onClick={() => setConfirming(false)}>Cancel</button>
              </div>
            </div>
          )}
        </div>

        {/* Pause only — remove lives in the corner */}
        <div className="flex flex-col gap-2 flex-shrink-0 justify-center">
          <button
            className={`btn btn-sm ${isLive ? 'btn-secondary' : 'btn-success'}`}
            onClick={() => onStatusChange(lp.id, isLive ? 'paused' : 'live')}
          >
            {isLive ? '⏸ Pause' : '▶ Go live'}
          </button>
        </div>
      </div>

      {/* Full-width breakdown toggle at the bottom */}
      <button
        className="w-full mt-3 pt-2 border-t border-rule text-xs text-ink/45 hover:text-royal-500 transition-colors font-medium"
        onClick={() => setExpanded(x => !x)}
      >
        {expanded ? '▲ Hide cost breakdown' : '▼ Show cost breakdown'}
      </button>

      {expanded && (
        <div className="mt-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-1">
            <div>
              <div className="text-xs font-semibold text-ink/45 mb-2">Revenue</div>
              <BreakdownRow label="Sell price (inc. VAT)" value={fmt(r.sellPrice)} />
              <BreakdownRow label={p.vatZero ? 'VAT (0% rated)' : 'VAT liability (20%)'} value={`-${fmt(r.vatAmount)}`} negative />
              <BreakdownRow label="Ex-VAT revenue" value={fmt(r.exVatRevenue)} bold />
            </div>
            <div>
              <div className="text-xs font-semibold text-ink/45 mb-2">Costs</div>
              <BreakdownRow
                label={isBundle ? `Product cost (${p.bundleQty} × ${fmt(parseFloat(p.costPerItem) || 0)})` : 'Product cost'}
                value={`-${fmt(r.costPrice)}`} negative />
              <BreakdownRow label={`Amazon referral fee (${p.refFee || '15.3'}%)`} value={`-${fmt(r.referralFee)}`} negative />
              <BreakdownRow
                label={isBundle && !p.weightOverride
                  ? `Shipping (${effectiveWeight(p, stockItems).toFixed(3)}kg — ${p.bundleQty} × ${(parseFloat(p.weightPerItem) || 0).toFixed(3)}kg)`
                  : `Shipping (${effectiveWeight(p, stockItems).toFixed(3)}kg)`}
                value={`-${fmt(r.shippingCost)}`} negative />
              <BreakdownRow label="Packaging" value={`-${fmt(r.packCost)}`} negative />
              <BreakdownRow label="Ad cost" value={`-${fmt(r.adCost)}`} negative />
              <BreakdownRow label="Total costs" value={`-${fmt(r.totalCosts)}`} bold />
            </div>
          </div>

          <div className="flex justify-between items-center mt-3 pt-3 border-t border-rule">
            <span className="font-semibold text-ink text-sm">Net profit per unit</span>
            <div className="text-right">
              <span className={`font-bold ${r.netProfit >= 0 ? 'text-gain' : 'text-loss'}`}>{fmtSigned(r.netProfit)}</span>
              <span className="text-xs text-ink/45 ml-2">({pct(r.margin)} margin)</span>
            </div>
          </div>

          <div className="text-xs text-ink/45 mt-2">Live since {wentLive}</div>

          {/* Price history */}
          {history.length > 0 && (
            <div className="mt-4 pt-3 border-t border-rule">
              <button
                className="flex items-center gap-2 text-xs font-semibold text-ink/45 hover:text-royal-500 transition-colors mb-2"
                onClick={() => setShowHistory(h => !h)}
              >
                <span>{showHistory ? '▼' : '▶'}</span>
                Price history ({history.length} change{history.length !== 1 ? 's' : ''})
              </button>

              {showHistory && (
                <div className="space-y-1.5">
                  {history.map(h => {
                    const up = h.new_price > h.old_price
                    const mDelta = (h.new_margin ?? 0) - (h.old_margin ?? 0)
                    return (
                      <div key={h.id} className="flex items-start justify-between gap-3 text-xs py-1.5 px-2.5 rounded-lg bg-paper">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-ink/55">{fmt(h.old_price)}</span>
                            <span className={up ? 'text-gain' : 'text-loss'}>{up ? '→' : '→'}</span>
                            <span className="font-semibold text-ink">{fmt(h.new_price)}</span>
                            <span className={`font-medium ${up ? 'text-gain' : 'text-loss'}`}>
                              {up ? '▲' : '▼'} {fmt(Math.abs(h.new_price - h.old_price))}
                            </span>
                            <span className="text-ink/45">·</span>
                            <span className="text-ink/55">
                              margin {(h.old_margin ?? 0).toFixed(1)}% → {(h.new_margin ?? 0).toFixed(1)}%
                            </span>
                            <span className={`font-medium ${mDelta >= 0 ? 'text-gain' : 'text-loss'}`}>
                              ({mDelta >= 0 ? '+' : ''}{mDelta.toFixed(1)}%)
                            </span>
                          </div>
                          <div className="text-ink/45 mt-0.5">
                            {h.user_name && <span className="font-medium text-ink/55">{h.user_name}</span>}
                            {h.user_name && h.note && ' · '}
                            {h.note && <span className="italic">{h.note}</span>}
                          </div>
                        </div>
                        <div className="text-ink/45 whitespace-nowrap flex-shrink-0">
                          {new Date(h.changed_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* Cost history */}
          {costs.length > 0 && (
            <div className="mt-4 pt-3 border-t border-rule">
              <button
                className="flex items-center gap-2 text-xs font-semibold text-ink/45 hover:text-royal-500 transition-colors mb-2"
                onClick={() => setShowCosts(c => !c)}
              >
                <span>{showCosts ? '▼' : '▶'}</span>
                Cost history ({costs.length} change{costs.length !== 1 ? 's' : ''})
              </button>
              {showCosts && (
                <div className="space-y-1.5">
                  {costs.map(c => {
                    const up = c.new_cost > c.old_cost
                    const mDelta = (c.new_margin ?? 0) - (c.old_margin ?? 0)
                    return (
                      <div key={c.id} className="flex items-start justify-between gap-3 text-xs py-1.5 px-2.5 rounded-lg bg-paper">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-ink/55">{fmt(c.old_cost)}</span>
                            <span className="text-ink/45">→</span>
                            <span className="font-semibold text-ink">{fmt(c.new_cost)}</span>
                            <span className={`font-medium ${up ? 'text-loss' : 'text-gain'}`}>
                              {up ? '▲' : '▼'} {fmt(Math.abs(c.new_cost - c.old_cost))}
                            </span>
                            <span className="text-ink/45">·</span>
                            <span className="text-ink/55">margin {(c.old_margin ?? 0).toFixed(1)}% → {(c.new_margin ?? 0).toFixed(1)}%</span>
                            <span className={`font-medium ${mDelta >= 0 ? 'text-gain' : 'text-loss'}`}>
                              ({mDelta >= 0 ? '+' : ''}{mDelta.toFixed(1)}%)
                            </span>
                          </div>
                          <div className="text-ink/45 mt-0.5">
                            {c.user_name && <span className="font-medium text-ink/55">{c.user_name}</span>}
                            {c.user_name && c.supplier_name && ' · '}
                            {c.supplier_name}
                          </div>
                        </div>
                        <div className="text-ink/45 whitespace-nowrap flex-shrink-0">
                          {new Date(c.changed_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {r.shippingWarning && (
            <div className="text-xs text-warn bg-warn/5 rounded-lg px-3 py-2 mt-3">⚠ {r.shippingWarning}</div>
          )}
          {p.notes && (
            <div className="text-xs text-ink/55 bg-paper rounded-lg px-3 py-2 mt-3">
              <span className="font-medium text-ink/70">Notes: </span>{p.notes}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function BreakdownRow({ label, value, negative, bold }) {
  return (
    <div className={`flex justify-between py-1 text-sm ${bold ? 'border-t border-rule mt-1 pt-1.5' : ''}`}>
      <span className={bold ? 'font-medium text-ink/80' : 'text-ink/55'}>{label}</span>
      <span className={`${bold ? 'font-semibold text-ink' : negative ? 'text-loss' : 'text-ink/80'}`}>{value}</span>
    </div>
  )
}
