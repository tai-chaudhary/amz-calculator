import React, { useState, useMemo } from 'react'
import { calcProduct, effectiveCost, hasComponents, fmt, fmtSigned, pct } from '../lib/calc'
import { planMigration } from '../lib/migration'
import { exportRowsToCsv, stampedName } from '../lib/csv'
import { ProductImage } from './UI'

export default function StockItemsPage({
  stockItems, savedProducts, liveProducts, settings, focusId, onNavigate,
  onUpdateStockItem, onDeleteStockItem, onRunMigration, onAddStockItem,
}) {
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState('name')
  const [editing, setEditing] = useState(null)
  const [showMigration, setShowMigration] = useState(false)
  const [adding, setAdding] = useState(false)
  const [expanded, setExpanded] = useState(null)
  const [supplierFilter, setSupplierFilter] = useState('')
  const [brandFilter, setBrandFilter] = useState('')
  const [usageFilter, setUsageFilter] = useState('')

  // Arriving from another page — open that row and scroll to it
  React.useEffect(() => {
    if (!focusId) return
    setExpanded(focusId)
    setSearch(''); setSupplierFilter(''); setBrandFilter(''); setUsageFilter('')
    const t = setTimeout(() => {
      document.getElementById(`stock-${focusId}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 80)
    return () => clearTimeout(t)
  }, [focusId])

  // Which listings use each stock item
  const usage = useMemo(() => {
    const map = new Map()
    stockItems.forEach(si => map.set(si.id, []))
    savedProducts.forEach(row => {
      const p = row.data || {}
      if (!hasComponents(p)) return
      p.components.forEach(c => {
        if (!map.has(c.stockItemId)) map.set(c.stockItemId, [])
        map.get(c.stockItemId).push({ row, p, qty: parseInt(c.qty) || 1 })
      })
    })
    return map
  }, [stockItems, savedProducts])

  const unlinkedCount = savedProducts.filter(r => !hasComponents(r.data || {})).length

  const rows = stockItems.map(si => {
    const d = si.data || {}
    const uses = usage.get(si.id) || []
    const liveUses = uses.filter(u => liveProducts.some(lp => lp.saved_product_id === u.row.id))
    // Stock items have no ASIN of their own — borrow one from a linked listing
    const imageAsin = (liveUses[0] || uses[0])?.p?.asin || ''
    return { si, d, uses, liveUses, imageAsin }
  })

  const suppliers = [...new Set(rows.map(r => (r.d.supplierName || '').trim()).filter(Boolean))].sort()
  const brands = [...new Set(rows.map(r => (r.d.brand || '').trim()).filter(Boolean))].sort()

  const filtered = rows.filter(({ si, d, uses, liveUses }) => {
    if (supplierFilter && (d.supplierName || '').trim() !== supplierFilter) return false
    if (brandFilter && (d.brand || '').trim() !== brandFilter) return false
    if (usageFilter === 'unused' && uses.length > 0) return false
    if (usageFilter === 'live' && liveUses.length === 0) return false
    if (usageFilter === 'shared' && uses.length < 2) return false
    if (usageFilter === 'nosku' && (d.supplierSku || '').trim()) return false
    if (search.trim()) {
      const q = search.toLowerCase()
      const hit = si.name.toLowerCase().includes(q) ||
        (d.supplierSku || '').toLowerCase().includes(q) ||
        (d.supplierName || '').toLowerCase().includes(q) ||
        (d.brand || '').toLowerCase().includes(q) ||
        uses.some(u => u.row.name.toLowerCase().includes(q))
      if (!hit) return false
    }
    return true
  })

  const sorted = [...filtered].sort((a, b) => {
    switch (sort) {
      case 'name':      return a.si.name.localeCompare(b.si.name)
      case 'costHigh':  return (parseFloat(b.d.costPrice) || 0) - (parseFloat(a.d.costPrice) || 0)
      case 'costLow':   return (parseFloat(a.d.costPrice) || 0) - (parseFloat(b.d.costPrice) || 0)
      case 'mostUsed':  return b.uses.length - a.uses.length
      case 'weightHigh': return (parseFloat(b.d.weightKg) || 0) - (parseFloat(a.d.weightKg) || 0)
      case 'supplier':  return (a.d.supplierName || '').localeCompare(b.d.supplierName || '')
      default: return 0
    }
  })

  return (
    <div>
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div>
          <h1 className="text-[28px] leading-tight">Stock Items</h1>
          <p className="text-sm text-ink/50 mt-1">
            The physical products you buy. {stockItems.length} item{stockItems.length !== 1 ? 's' : ''} used across {savedProducts.length} listing{savedProducts.length !== 1 ? 's' : ''}.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button className="btn btn-secondary btn-sm" onClick={() => setAdding(true)}>+ Add stock item</button>
          <button
            className="btn btn-secondary btn-sm"
            disabled={sorted.length === 0}
            onClick={() => exportRowsToCsv(stampedName('stock-items'), sorted, [
              { header: 'Stock Item', value: x => x.si.name },
              { header: 'Brand', value: x => x.d.brand || '' },
              { header: 'Supplier', value: x => x.d.supplierName || '' },
              { header: 'Supplier SKU', value: x => x.d.supplierSku || '' },
              { header: 'Unit Cost', value: x => (parseFloat(x.d.costPrice) || 0).toFixed(4) },
              { header: 'Unit Weight KG', value: x => (parseFloat(x.d.weightKg) || 0).toFixed(3) },
              { header: 'Used In Listings', value: x => x.uses.length },
              { header: 'Live Listings', value: x => x.liveUses.length },
            ])}
          >⬇ Export CSV</button>
        </div>
      </div>

      {/* Migration prompt */}
      {unlinkedCount > 0 && (
        <div className="card mb-4 border-2 border-royal-200 bg-royal-50">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <div className="font-semibold text-ink">
                {unlinkedCount} listing{unlinkedCount !== 1 ? 's are' : ' is'} not linked to a stock item
              </div>
              <div className="text-sm text-ink/55 mt-0.5">
                Link them so a cost change on the stock item updates every listing that uses it.
              </div>
            </div>
            <button className="btn btn-primary btn-sm" onClick={() => setShowMigration(true)}>
              Review &amp; link automatically
            </button>
          </div>
        </div>
      )}

      {stockItems.length === 0 && unlinkedCount === 0 ? (
        <div className="card flex flex-col items-center justify-center py-16 text-center">
          <div className="text-4xl mb-3">📦</div>
          <div className="font-medium text-ink/80 mb-1">No stock items yet</div>
          <div className="text-sm text-ink/45">Stock items are the physical products you buy from suppliers</div>
        </div>
      ) : stockItems.length > 0 && (
        <>
          <div className="card mb-4 py-3">
            <div className="flex gap-3 flex-wrap items-end">
              <div>
                <label className="label text-xs">Search</label>
                <input type="text" placeholder="Name, SKU, supplier, listing…" value={search}
                  onChange={e => setSearch(e.target.value)} className="input text-sm" style={{ width: 230 }} />
              </div>
              <div>
                <label className="label text-xs">Sort by</label>
                <select className="input text-sm" style={{ width: 175 }} value={sort} onChange={e => setSort(e.target.value)}>
                  <option value="name">Name — A to Z</option>
                  <option value="mostUsed">Most listings</option>
                  <option value="costHigh">Cost — high to low</option>
                  <option value="costLow">Cost — low to high</option>
                  <option value="weightHigh">Weight — high to low</option>
                  <option value="supplier">Supplier</option>
                </select>
              </div>
              <div>
                <label className="label text-xs">Supplier</label>
                <select className="input text-sm" style={{ width: 165 }} value={supplierFilter} onChange={e => setSupplierFilter(e.target.value)}>
                  <option value="">All suppliers</option>
                  {suppliers.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="label text-xs">Brand</label>
                <select className="input text-sm" style={{ width: 145 }} value={brandFilter} onChange={e => setBrandFilter(e.target.value)}>
                  <option value="">All brands</option>
                  {brands.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>
              <div>
                <label className="label text-xs">Usage</label>
                <select className="input text-sm" style={{ width: 160 }} value={usageFilter} onChange={e => setUsageFilter(e.target.value)}>
                  <option value="">All</option>
                  <option value="live">In a live listing</option>
                  <option value="shared">Shared (2+ listings)</option>
                  <option value="unused">Not used anywhere</option>
                  <option value="nosku">Missing SKU</option>
                </select>
              </div>
              {(search || supplierFilter || brandFilter || usageFilter) && (
                <button className="btn btn-secondary btn-sm" onClick={() => {
                  setSearch(''); setSupplierFilter(''); setBrandFilter(''); setUsageFilter('')
                }}>Clear</button>
              )}
            </div>
            {(search || supplierFilter || brandFilter || usageFilter) && (
              <div className="text-xs text-ink/45 mt-2">Showing {filtered.length} of {rows.length} stock items</div>
            )}
          </div>

          <div className="card p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-rule bg-paper">
                    <th className="text-left px-4 py-3 text-xs font-semibold text-ink/45">Stock item</th>
                    <th className="text-left px-3 py-3 text-xs font-semibold text-ink/45">Supplier</th>
                    <th className="text-right px-3 py-3 text-xs font-semibold text-ink/45">Unit cost</th>
                    <th className="text-right px-3 py-3 text-xs font-semibold text-ink/45">Unit weight</th>
                    <th className="text-center px-3 py-3 text-xs font-semibold text-ink/45">Used in</th>
                    <th className="px-3 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map(({ si, d, uses, liveUses, imageAsin }) => {
                    const isOpen = expanded === si.id
                    return (
                    <React.Fragment key={si.id}>
                    <tr id={`stock-${si.id}`}
                        className={`border-b border-rule/60 hover:bg-paper group transition-colors ${
                          focusId === si.id ? 'bg-royal-50 ring-2 ring-royal-300' : isOpen ? 'bg-paper' : ''
                        }`}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <button
                            className="text-ink/30 hover:text-royal-500 text-xs w-4 flex-shrink-0"
                            onClick={() => setExpanded(isOpen ? null : si.id)}
                            title={uses.length ? 'Show linked listings' : 'Not linked to any listing'}
                            disabled={!uses.length}
                          >{uses.length ? (isOpen ? '▼' : '▶') : ''}</button>
                          <div className="w-11 h-11 rounded-lg border border-rule bg-white flex items-center justify-center flex-shrink-0 overflow-hidden">
                            <ProductImage asin={imageAsin} alt={si.name} className="object-contain w-full h-full p-1" placeholderSize="text-lg" />
                          </div>
                          <div className="min-w-0">
                            <div className="font-medium text-ink">{si.name}</div>
                            <div className="text-xs text-ink/45">
                              {d.brand && <span>{d.brand} · </span>}
                              {d.supplierSku
                                ? `SKU ${d.supplierSku}`
                                : <span className="text-warn">no SKU</span>}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-ink/70">{d.supplierName || <span className="text-ink/30">—</span>}</td>
                      <td className="px-3 py-3 text-right font-medium text-ink/80">{fmt(parseFloat(d.costPrice) || 0)}</td>
                      <td className="px-3 py-3 text-right text-ink/70">
                        {(parseFloat(d.weightKg) || 0) > 0
                          ? `${(parseFloat(d.weightKg) || 0).toFixed(3)}kg`
                          : <span className="text-warn text-xs">not set</span>}
                      </td>
                      <td className="px-3 py-3 text-center whitespace-nowrap">
                        <button
                          className={`text-xs font-semibold px-2 py-0.5 rounded-full ${uses.length ? 'bg-royal-100 text-royal-700 hover:bg-indigo-200' : 'bg-ink/5 text-ink/45'}`}
                          onClick={() => uses.length && setExpanded(isOpen ? null : si.id)}
                        >
                          {uses.length} listing{uses.length !== 1 ? 's' : ''}
                        </button>
                        {liveUses.length > 0 && (
                          <span className="text-xs text-gain ml-1.5 font-medium">{liveUses.length} live</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <div className="flex gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                          <button className="btn btn-xs btn-secondary" onClick={() => setEditing({ si, d, uses })}>Edit</button>
                          {uses.length === 0 && (
                            <button className="btn btn-xs btn-danger"
                              onClick={() => { if (window.confirm(`Delete "${si.name}"?`)) onDeleteStockItem(si.id) }}>✕</button>
                          )}
                        </div>
                      </td>
                    </tr>

                    {isOpen && (
                      <tr className="bg-paper border-b border-rule">
                        <td colSpan={6} className="px-4 pb-4 pt-0">
                          <div className="bg-white rounded-xl border border-rule overflow-hidden ml-7">
                            <div className="px-3 py-2 bg-paper border-b border-rule text-xs font-semibold text-ink/45">
                              Listings using this stock item
                            </div>
                            <table className="w-full text-xs">
                              <tbody>
                                {uses.map(u => {
                                  const isLive = liveProducts.some(lp => lp.saved_product_id === u.row.id)
                                  const lp = liveProducts.find(lp => lp.saved_product_id === u.row.id)
                                  const r = calcProduct(u.p, settings.carriers, settings.packaging, stockItems)
                                  const contribution = (parseFloat(d.costPrice) || 0) * u.qty
                                  const share = r.costPrice > 0 ? (contribution / r.costPrice) * 100 : 0
                                  return (
                                    <tr key={u.row.id} className="border-b border-rule/60 last:border-0">
                                      <td className="px-3 py-2">
                                        <div className="flex items-center gap-2">
                                          <div className="w-8 h-8 rounded border border-rule bg-white flex items-center justify-center flex-shrink-0 overflow-hidden">
                                            <ProductImage asin={u.p.asin} manualImage={u.p.productImage} alt={u.row.name}
                                              className="object-contain w-full h-full p-0.5" placeholderSize="text-xs" />
                                          </div>
                                          <div className="min-w-0">
                                            <button
                                              className="text-ink font-medium truncate text-left hover:text-royal-600 hover:underline"
                                              style={{ maxWidth: 300 }}
                                              onClick={() => onNavigate?.(isLive ? 'live' : 'saved', u.row.id)}
                                            >{u.row.name}</button>
                                            <div className="text-ink/45">
                                              {u.p.asin ? (
                                                <a href={`https://www.amazon.co.uk/dp/${u.p.asin}`} target="_blank" rel="noopener noreferrer"
                                                  className="text-royal-400 hover:text-royal-600">{u.p.asin} ↗</a>
                                              ) : 'no ASIN'}
                                            </div>
                                          </div>
                                        </div>
                                      </td>
                                      <td className="px-2 py-2 text-center">
                                        <span className="bg-ink/5 text-ink/70 font-semibold px-1.5 py-0.5 rounded">×{u.qty}</span>
                                      </td>
                                      <td className="px-2 py-2 text-right text-ink/55">
                                        {fmt(contribution)}
                                        <div className="text-ink/30">{share.toFixed(0)}% of cost</div>
                                      </td>
                                      <td className="px-2 py-2 text-right">
                                        <div className={r.netProfit >= 0 ? 'text-gain font-medium' : 'text-loss font-medium'}>
                                          {fmt(r.netProfit)}
                                        </div>
                                        <div className="text-ink/45">{pct(r.margin)}</div>
                                      </td>
                                      <td className="px-3 py-2 text-right">
                                        {isLive ? (
                                          <span className={`pill ${lp?.status === 'live' ? 'pill-live' : 'pill-paused'}`}>
                                            {lp?.status === 'live' ? 'Live' : 'Paused'}
                                          </span>
                                        ) : (
                                          <span className="text-xs text-ink/30">Not live</span>
                                        )}
                                      </td>
                                    </tr>
                                  )
                                })}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                    </React.Fragment>
                  )})}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {editing && (
        <StockItemModal
          item={editing.si} data={editing.d} uses={editing.uses}
          stockItems={stockItems} settings={settings} liveProducts={liveProducts}
          onSave={(updated) => { onUpdateStockItem(editing.si.id, updated); setEditing(null) }}
          onClose={() => setEditing(null)}
        />
      )}

      {adding && (
        <StockItemModal
          item={null} data={{ name: '', costPrice: '', weightKg: '', supplierName: '', supplierSku: '', brand: '' }}
          uses={[]} stockItems={stockItems} settings={settings} liveProducts={liveProducts}
          onSave={(created) => { onAddStockItem(created); setAdding(false) }}
          onClose={() => setAdding(false)}
        />
      )}

      {showMigration && (
        <MigrationModal
          savedProducts={savedProducts}
          onConfirm={(plan) => { onRunMigration(plan); setShowMigration(false) }}
          onClose={() => setShowMigration(false)}
        />
      )}
    </div>
  )
}

/* ── Edit modal, with live impact preview ─────────────────────────────────── */

function StockItemModal({ item, data, uses, stockItems, settings, liveProducts, onSave, onClose }) {
  const [form, setForm] = useState({ ...data })
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }))

  const oldCost = parseFloat(data.costPrice) || 0
  const newCost = parseFloat(form.costPrice) || 0
  const costChanged = Math.abs(oldCost - newCost) > 0.0001
  const oldWeight = parseFloat(data.weightKg) || 0
  const newWeight = parseFloat(form.weightKg) || 0
  const weightChanged = Math.abs(oldWeight - newWeight) > 0.0001

  // Recalculate every affected listing under the proposed values
  const impact = useMemo(() => {
    if (!costChanged && !weightChanged) return []
    const proposed = stockItems.map(s =>
      s.id === item?.id ? { ...s, data: { ...s.data, costPrice: form.costPrice, weightKg: form.weightKg } } : s
    )
    return uses.map(u => {
      const before = calcProduct(u.p, settings.carriers, settings.packaging, stockItems)
      const after = calcProduct(u.p, settings.carriers, settings.packaging, proposed)
      const isLive = liveProducts.some(lp => lp.saved_product_id === u.row.id)
      return { ...u, before, after, isLive }
    }).sort((a, b) => a.after.margin - b.after.margin)
  }, [form.costPrice, form.weightKg, costChanged, weightChanged, uses, stockItems, item, settings, liveProducts])

  const nowLossMaking = impact.filter(i => i.before.netProfit >= 0 && i.after.netProfit < 0)
  const nowLowMargin = impact.filter(i => i.before.margin >= 10 && i.after.margin < 10)

  return (
    <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl w-full max-w-3xl my-8 shadow-2xl">
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-rule">
          <div>
            <div className="font-semibold text-base text-ink">{item ? item.name : 'New stock item'}</div>
            {uses.length > 0 && (
              <div className="text-xs text-ink/45 mt-0.5">Used in {uses.length} listing{uses.length !== 1 ? 's' : ''}</div>
            )}
          </div>
          <button onClick={onClose} className="text-ink/45 hover:text-ink/70 text-2xl">×</button>
        </div>

        <div className="px-6 py-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label">Name</label>
              <input className="input" value={form.name || ''} onChange={set('name')} placeholder="e.g. Fairy Washing Up Liquid 320ml" />
            </div>
            <div>
              <label className="label">Brand</label>
              <input className="input" value={form.brand || ''} onChange={set('brand')} />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label">Supplier</label>
              <input className="input" value={form.supplierName || ''} onChange={set('supplierName')} />
            </div>
            <div>
              <label className="label">Supplier SKU</label>
              <input className="input" value={form.supplierSku || ''} onChange={set('supplierSku')} />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label">Unit cost £</label>
              <input type="number" step="0.0001"
                className={`input font-semibold ${costChanged ? 'border-amber-400 bg-warn/5' : ''}`}
                value={form.costPrice || ''} onChange={set('costPrice')} />
              {costChanged && (
                <div className={`text-xs mt-1 font-medium ${newCost > oldCost ? 'text-loss' : 'text-gain'}`}>
                  {fmt(oldCost)} → {fmt(newCost)} ({newCost > oldCost ? '+' : ''}{oldCost ? (((newCost - oldCost) / oldCost) * 100).toFixed(1) : '0'}%)
                </div>
              )}
            </div>
            <div>
              <label className="label">Unit weight (kg)</label>
              <input type="number" step="0.001"
                className={`input ${weightChanged ? 'border-amber-400 bg-warn/5' : ''}`}
                value={form.weightKg || ''} onChange={set('weightKg')} />
            </div>
          </div>

          {/* Impact preview */}
          {impact.length > 0 && (
            <div className="border-2 border-warn/25 bg-warn/5 rounded-xl p-4">
              <div className="font-semibold text-sm text-ink mb-1">
                This affects {impact.length} listing{impact.length !== 1 ? 's' : ''}
              </div>
              {(nowLossMaking.length > 0 || nowLowMargin.length > 0) && (
                <div className="text-xs mb-3 space-y-0.5">
                  {nowLossMaking.length > 0 && (
                    <div className="text-loss font-medium">
                      ⚠ {nowLossMaking.length} listing{nowLossMaking.length !== 1 ? 's' : ''} would start making a loss
                    </div>
                  )}
                  {nowLowMargin.length > 0 && (
                    <div className="text-warn font-medium">
                      {nowLowMargin.length} would drop below 10% margin
                    </div>
                  )}
                </div>
              )}

              <div className="overflow-x-auto bg-white rounded-lg">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-rule">
                      <th className="text-left px-3 py-2 font-semibold text-ink/45">Listing</th>
                      <th className="text-center px-2 py-2 font-semibold text-ink/45">Qty</th>
                      <th className="text-right px-2 py-2 font-semibold text-ink/45">Cost</th>
                      <th className="text-right px-2 py-2 font-semibold text-ink/45">Profit</th>
                      <th className="text-right px-3 py-2 font-semibold text-ink/45">Margin</th>
                    </tr>
                  </thead>
                  <tbody>
                    {impact.map(i => {
                      const broke = i.after.netProfit < 0
                      const dropped = i.after.margin < i.before.margin
                      return (
                        <tr key={i.row.id} className={`border-b border-rule/60 ${broke ? 'bg-loss/5' : ''}`}>
                          <td className="px-3 py-2">
                            <div className="text-ink truncate" style={{ maxWidth: 260 }}>{i.row.name}</div>
                            {i.isLive && <span className="text-gain font-medium">Live</span>}
                          </td>
                          <td className="px-2 py-2 text-center text-ink/55">×{i.qty}</td>
                          <td className="px-2 py-2 text-right text-ink/70">
                            {fmt(i.before.costPrice)} → <span className="font-medium text-ink">{fmt(i.after.costPrice)}</span>
                          </td>
                          <td className="px-2 py-2 text-right">
                            <span className="text-ink/45">{fmtSigned(i.before.netProfit)}</span>
                            {' → '}
                            <span className={`font-semibold ${i.after.netProfit >= 0 ? 'text-gain' : 'text-loss'}`}>
                              {fmtSigned(i.after.netProfit)}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right">
                            <span className="text-ink/45">{pct(i.before.margin)}</span>
                            {' → '}
                            <span className={`font-semibold ${i.after.margin < 0 ? 'text-loss' : i.after.margin < 10 ? 'text-warn' : 'text-gain'}`}>
                              {pct(i.after.margin)}
                            </span>
                            {broke && <div className="text-loss font-medium">loss</div>}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Where it's used, when nothing has changed yet */}
          {impact.length === 0 && uses.length > 0 && (
            <div className="bg-paper rounded-xl p-3">
              <div className="text-xs font-semibold text-ink/45 mb-2">Used in</div>
              <div className="space-y-1">
                {uses.map(u => (
                  <div key={u.row.id} className="flex justify-between text-xs">
                    <span className="text-ink/80 truncate" style={{ maxWidth: 380 }}>{u.row.name}</span>
                    <span className="text-ink/45">×{u.qty}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="px-6 pb-6 flex gap-2">
          <button className="btn btn-primary flex-1 justify-center" onClick={() => onSave(form)}>
            {costChanged || weightChanged
              ? `Save — updates ${impact.length} listing${impact.length !== 1 ? 's' : ''}`
              : 'Save changes'}
          </button>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

/* ── Migration modal ──────────────────────────────────────────────────────── */

function MigrationModal({ savedProducts, onConfirm, onClose }) {
  const plan = useMemo(() => planMigration(savedProducts), [savedProducts])

  return (
    <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl w-full max-w-3xl my-8 shadow-2xl">
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-rule">
          <div>
            <div className="font-semibold text-base text-ink">Link listings to stock items</div>
            <div className="text-xs text-ink/45 mt-0.5">Nothing is changed until you confirm</div>
          </div>
          <button onClick={onClose} className="text-ink/45 hover:text-ink/70 text-2xl">×</button>
        </div>

        <div className="px-6 py-4 space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="metric-card"><div className="metric-label">Stock items</div><div className="metric-value text-lg">{plan.stockItems.length}</div></div>
            <div className="metric-card"><div className="metric-label">Listings linked</div><div className="metric-value text-lg">{plan.links.length}</div></div>
            <div className="metric-card"><div className="metric-label">Mixed bundles</div><div className="metric-value text-lg">{plan.mixed.length}</div></div>
            <div className="metric-card">
              <div className="metric-label">Unlinkable</div>
              <div className={`metric-value text-lg ${plan.unlinkable.length ? 'text-warn' : ''}`}>{plan.unlinkable.length}</div>
            </div>
          </div>

          <div className="text-sm text-ink/55 bg-paper rounded-xl p-3">
            Listings are grouped by Supplier SKU, or by product name and supplier where no SKU is set.
            A listing's per-unit cost becomes the stock item's cost. Existing listings keep their own
            figures until you confirm.
          </div>

          {plan.conflicts.length > 0 && (
            <div className="border border-warn/25 bg-warn/5 rounded-xl p-3">
              <div className="font-semibold text-sm text-warn mb-2">
                {plan.conflicts.length} cost conflict{plan.conflicts.length !== 1 ? 's' : ''} — check these afterwards
              </div>
              <div className="space-y-2">
                {plan.conflicts.map((c, i) => (
                  <div key={i} className="text-xs text-warn">
                    <span className="font-medium">{c.name}</span>
                    {c.sku && <span className="text-warn"> [{c.sku}]</span>}
                    <div className="text-warn">
                      {c.field} values found: {c.values.map(v => c.field === 'cost' ? fmt(v) : `${v}kg`).join(', ')}
                      {' — using '}<span className="font-semibold">{c.field === 'cost' ? fmt(c.chosen) : `${c.chosen}kg`}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {plan.mixed.length > 0 && (
            <div className="border border-royal-200 bg-royal-50 rounded-xl p-3">
              <div className="font-semibold text-sm text-royal-700 mb-2">Mixed bundles detected</div>
              <div className="text-xs text-royal-600 mb-2">
                These have several SKUs listed, so they'll be linked to one of each component.
                Check the quantities afterwards if any component appears more than once.
              </div>
              {plan.mixed.map((m, i) => (
                <div key={i} className="text-xs text-royal-700">
                  <span className="font-medium">{m.row.name}</span> → {m.skus.join(' + ')}
                </div>
              ))}
            </div>
          )}

          {plan.unlinkable.length > 0 && (
            <div className="border border-rule rounded-xl p-3">
              <div className="font-semibold text-sm text-ink/80 mb-2">Can't link automatically</div>
              <div className="text-xs text-ink/55 space-y-0.5">
                {plan.unlinkable.map((u, i) => (
                  <div key={i}>{u.row.name}{u.reason ? ` — ${u.reason}` : ''}</div>
                ))}
              </div>
            </div>
          )}

          <details className="text-sm">
            <summary className="cursor-pointer text-royal-500 hover:text-royal-700 font-medium">
              Preview all {plan.stockItems.length} stock items
            </summary>
            <div className="mt-2 max-h-72 overflow-y-auto border border-rule rounded-lg">
              <table className="w-full text-xs">
                <thead className="bg-paper sticky top-0">
                  <tr>
                    <th className="text-left px-3 py-2 font-semibold text-ink/45 uppercase">Stock item</th>
                    <th className="text-left px-2 py-2 font-semibold text-ink/45 uppercase">SKU</th>
                    <th className="text-right px-2 py-2 font-semibold text-ink/45 uppercase">Cost</th>
                    <th className="text-right px-3 py-2 font-semibold text-ink/45 uppercase">Weight</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.stockItems.map((s, i) => (
                    <tr key={i} className="border-b border-rule/60">
                      <td className="px-3 py-1.5 text-ink/80">{s.name}</td>
                      <td className="px-2 py-1.5 text-ink/45">{s.supplierSku || '—'}</td>
                      <td className="px-2 py-1.5 text-right text-ink/70">{fmt(parseFloat(s.costPrice) || 0)}</td>
                      <td className="px-3 py-1.5 text-right text-ink/70">{(parseFloat(s.weightKg) || 0).toFixed(3)}kg</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </div>

        <div className="px-6 pb-6 flex gap-2">
          <button className="btn btn-primary flex-1 justify-center" onClick={() => onConfirm(plan)}>
            Create {plan.stockItems.length} stock items &amp; link {plan.links.length} listings
          </button>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  )
}
