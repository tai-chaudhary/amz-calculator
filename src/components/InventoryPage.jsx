import React, { useState, useMemo } from 'react'
import { calcProduct, fmt, fmtSigned, pct } from '../lib/calc'
import { EmptyState, Spinner, Modal, MetricCard, ResultRow, SectionHead, PLRow } from './UI'
import { SERVICE_LABELS, REF_FEE_OPTIONS } from '../lib/defaults'

export default function InventoryPage({ inventory, settings, onUpdateItem, onDeleteItem, onSendToCalculator, loading }) {
  const [search, setSearch] = useState('')
  const [editItem, setEditItem] = useState(null)
  const [viewPL, setViewPL] = useState(false)
  const [sortCol, setSortCol] = useState('name')
  const [sortDir, setSortDir] = useState('asc')

  if (loading) return <Spinner />

  const { carriers, packaging } = settings

  const calcItem = (item) => {
    if (!item.sellPrice) return null
    return calcProduct({ ...item, costPrice: item.costPrice }, carriers, packaging)
  }

  const totalStockValue = inventory.reduce((s, i) => s + (parseFloat(i.costPrice) || 0) * (parseInt(i.units) || 0), 0)
  const totalRetailValue = inventory.reduce((s, i) => {
    if (!i.sellPrice) return s
    return s + (parseFloat(i.sellPrice) || 0) * (parseInt(i.units) || 0)
  }, 0)
  const totalUnits = inventory.reduce((s, i) => s + (parseInt(i.units) || 0), 0)
  const productsWithSellPrice = inventory.filter(i => i.sellPrice).length

  const sortIcon = (col) => sortCol === col ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ' ↕'
  const handleSort = (col) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
  }

  const filtered = search.trim()
    ? inventory.filter(i => i.name.toLowerCase().includes(search.toLowerCase()) || (i.asin || '').toLowerCase().includes(search.toLowerCase()))
    : inventory

  const sorted = [...filtered].sort((a, b) => {
    const dir = sortDir === 'asc' ? 1 : -1
    switch (sortCol) {
      case 'name': return dir * a.name.localeCompare(b.name)
      case 'units': return dir * ((parseInt(a.units) || 0) - (parseInt(b.units) || 0))
      case 'costPrice': return dir * ((parseFloat(a.costPrice) || 0) - (parseFloat(b.costPrice) || 0))
      case 'stockValue': return dir * ((parseFloat(a.costPrice) || 0) * (parseInt(a.units) || 0) - (parseFloat(b.costPrice) || 0) * (parseInt(b.units) || 0))
      case 'sellPrice': return dir * ((parseFloat(a.sellPrice) || 0) - (parseFloat(b.sellPrice) || 0))
      case 'margin': {
        const ra = calcItem(a); const rb = calcItem(b)
        return dir * ((ra?.margin || 0) - (rb?.margin || 0))
      }
      default: return dir * a.name.localeCompare(b.name)
    }
  })

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Homey's Inventory</h1>
          <p className="text-sm text-slate-400 mt-0.5">{inventory.length} products · {totalUnits.toLocaleString()} total units</p>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-secondary btn-sm" onClick={() => setViewPL(true)}>📊 Inventory P&L</button>
        </div>
      </div>

      {/* Summary metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <MetricCard label="Total stock value" value={fmt(totalStockValue)} />
        <MetricCard label="Total retail value" value={totalRetailValue > 0 ? fmt(totalRetailValue) : '—'} color="text-indigo-600" />
        <MetricCard label="Total units" value={totalUnits.toLocaleString()} />
        <MetricCard label="Priced products" value={`${productsWithSellPrice} / ${inventory.length}`} />
      </div>

      {/* Search */}
      <div className="mb-4">
        <input
          type="text"
          placeholder="Search inventory…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="input text-sm"
          style={{ width: 260 }}
        />
        {search && <span className="text-xs text-slate-400 ml-3">{filtered.length} of {inventory.length} shown</span>}
      </div>

      {/* Table */}
      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wide cursor-pointer hover:text-indigo-500 select-none" onClick={() => handleSort('name')}>Product{sortIcon('name')}</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wide cursor-pointer hover:text-indigo-500 select-none" onClick={() => handleSort('units')}>Units{sortIcon('units')}</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wide cursor-pointer hover:text-indigo-500 select-none" onClick={() => handleSort('costPrice')}>Cost/unit{sortIcon('costPrice')}</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wide cursor-pointer hover:text-indigo-500 select-none" onClick={() => handleSort('stockValue')}>Stock value{sortIcon('stockValue')}</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wide cursor-pointer hover:text-indigo-500 select-none" onClick={() => handleSort('sellPrice')}>Sell price{sortIcon('sellPrice')}</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wide cursor-pointer hover:text-indigo-500 select-none" onClick={() => handleSort('margin')}>Margin{sortIcon('margin')}</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(item => {
                const r = calcItem(item)
                const stockVal = (parseFloat(item.costPrice) || 0) * (parseInt(item.units) || 0)
                return (
                  <tr key={item.id} className="border-b border-slate-50 hover:bg-slate-50 group">
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-800">{item.name}</div>
                      {item.asin && <div className="text-xs text-slate-400">ASIN: {item.asin}</div>}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-600">{(parseInt(item.units) || 0).toLocaleString()}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{fmt(parseFloat(item.costPrice) || 0)}</td>
                    <td className="px-4 py-3 text-right font-medium text-slate-700">{fmt(stockVal)}</td>
                    <td className="px-4 py-3 text-right">
                      {item.sellPrice
                        ? <span className="text-slate-700">{fmt(parseFloat(item.sellPrice))}</span>
                        : <span className="text-slate-300 text-xs">not set</span>
                      }
                    </td>
                    <td className="px-4 py-3 text-right">
                      {r
                        ? <span className={`font-medium ${r.margin >= 0 ? 'text-green-600' : 'text-red-500'}`}>{pct(r.margin)}</span>
                        : <span className="text-slate-300 text-xs">—</span>
                      }
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                        <button className="btn btn-xs btn-secondary" onClick={() => setEditItem({...item})}>Edit</button>
                        <button className="btn btn-xs btn-primary" onClick={() => onSendToCalculator(item)} title="Open in Calculator">🧮</button>
                        <button className="btn btn-xs btn-danger" onClick={() => { if(window.confirm(`Delete "${item.name}" from inventory?`)) onDeleteItem(item.id) }}>✕</button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit modal */}
      {editItem && (
        <InventoryEditModal
          item={editItem}
          settings={settings}
          onSave={(updated) => { onUpdateItem(updated); setEditItem(null) }}
          onClose={() => setEditItem(null)}
        />
      )}

      {/* P&L modal */}
      {viewPL && (
        <InventoryPLModal
          inventory={inventory}
          settings={settings}
          onClose={() => setViewPL(false)}
        />
      )}
    </div>
  )
}

function InventoryEditModal({ item, settings, onSave, onClose }) {
  const [form, setForm] = useState({ ...item })
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
  const { carriers, packaging } = settings
  const carrier = form.carrierId ? carriers[form.carrierId] : null
  const r = form.sellPrice ? calcProduct({ ...form }, carriers, packaging) : null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl w-full max-w-lg my-8 shadow-2xl">
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-slate-100">
          <div className="font-semibold text-base text-slate-800">{item.name}</div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-2xl">×</button>
        </div>
        <div className="px-6 py-4 space-y-4">

          {/* Stock */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Units in stock</label>
              <input type="number" className="input" value={form.units} onChange={set('units')} />
            </div>
            <div>
              <label className="label">Cost price / unit £</label>
              <input type="number" className="input" value={form.costPrice} onChange={set('costPrice')} />
            </div>
          </div>

          {/* Pricing */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Sell price (inc. VAT) £</label>
              <input type="number" className="input" value={form.sellPrice || ''} onChange={set('sellPrice')} placeholder="0.00" />
            </div>
            <div>
              <label className="label">Ad cost £</label>
              <input type="number" className="input" value={form.adCost || ''} onChange={set('adCost')} placeholder="0.00" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Referral fee</label>
              <select className="input" value={form.refFee || '15.3'} onChange={set('refFee')}>
                {REF_FEE_OPTIONS.filter(o => o.value !== 'custom').map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div className="flex items-end pb-1">
              <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-600">
                <input type="checkbox" checked={!!form.vatZero} onChange={set('vatZero')} className="w-4 h-4 accent-indigo-500" />
                0% VAT rated
              </label>
            </div>
          </div>

          {/* Shipping */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Weight (kg)</label>
              <input type="number" className="input" value={form.weightKg || ''} onChange={set('weightKg')} placeholder="0.00" />
            </div>
            <div>
              <label className="label">Service level</label>
              <select className="input" value={form.serviceLevel || 'standard'} onChange={set('serviceLevel')}>
                {Object.entries(SERVICE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Carrier</label>
              <select className="input" value={form.carrierId || ''} onChange={e => setForm(f => ({ ...f, carrierId: e.target.value, carrierCatId: '' }))}>
                <option value="">None</option>
                {Object.entries(carriers).map(([id, c]) => <option key={id} value={id}>{c.name}</option>)}
              </select>
            </div>
            {carrier && (
              <div>
                <label className="label">Weight category</label>
                <select className="input" value={form.carrierCatId || ''} onChange={set('carrierCatId')}>
                  <option value="">Select</option>
                  {carrier.categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            )}
          </div>

          <div>
            <label className="label">Packaging</label>
            <select className="input" value={form.packagingId || ''} onChange={set('packagingId')}>
              <option value="">None</option>
              {packaging.map(p => <option key={p.id} value={p.id}>{p.name} (£{p.cost.toFixed(2)})</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">ASIN</label>
              <input type="text" className="input" value={form.asin || ''} onChange={set('asin')} placeholder="B08XYZ..." />
            </div>
            <div>
              <label className="label">Supplier</label>
              <input type="text" className="input" value={form.supplierName || ''} onChange={set('supplierName')} />
            </div>
          </div>

          <div>
            <label className="label">Notes</label>
            <textarea className="input" rows={2} value={form.notes || ''} onChange={set('notes')} style={{ resize: 'vertical' }} />
          </div>

          {/* Live results */}
          {r && (
            <div className="bg-slate-50 rounded-xl p-4">
              <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Per unit calculation</div>
              <div className="grid grid-cols-3 gap-2 mb-3">
                <div className="metric-card"><div className="metric-label">Profit/unit</div><div className={`metric-value text-sm ${r.netProfit >= 0 ? 'text-green-600' : 'text-red-500'}`}>{fmtSigned(r.netProfit)}</div></div>
                <div className="metric-card"><div className="metric-label">Margin</div><div className={`metric-value text-sm ${r.margin >= 0 ? 'text-green-600' : 'text-red-500'}`}>{pct(r.margin)}</div></div>
                <div className="metric-card"><div className="metric-label">Break-even</div><div className="metric-value text-sm">{fmt(r.breakEven)}</div></div>
              </div>
              <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Total stock ({(parseInt(form.units)||0).toLocaleString()} units)</div>
              <div className="grid grid-cols-3 gap-2">
                <div className="metric-card"><div className="metric-label">Revenue</div><div className="metric-value text-sm">{fmt(r.sellPrice*(parseInt(form.units)||0))}</div></div>
                <div className="metric-card"><div className="metric-label">Gross profit</div><div className={`metric-value text-sm ${r.netProfit*(parseInt(form.units)||0) >= 0 ? 'text-green-600' : 'text-red-500'}`}>{fmtSigned(r.netProfit*(parseInt(form.units)||0))}</div></div>
                <div className="metric-card"><div className="metric-label">VAT liability</div><div className="metric-value text-sm text-blue-600">{fmt(r.vatAmount*(parseInt(form.units)||0))}</div></div>
              </div>
            </div>
          )}
        </div>
        <div className="px-6 pb-6 flex gap-2">
          <button className="btn btn-primary flex-1 justify-center" onClick={() => onSave(form)}>Save changes</button>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

function InventoryPLModal({ inventory, settings, onClose }) {
  const { carriers, packaging } = settings
  const priced = inventory.filter(i => i.sellPrice)

  const totals = priced.reduce((acc, item) => {
    const r = calcProduct({ ...item }, carriers, packaging)
    const u = parseInt(item.units) || 0
    return {
      revenue: acc.revenue + r.sellPrice * u,
      exVatRevenue: acc.exVatRevenue + r.exVatRevenue * u,
      vatLiability: acc.vatLiability + r.vatAmount * u,
      cogs: acc.cogs + r.costPrice * u,
      referralFees: acc.referralFees + r.referralFee * u,
      shipping: acc.shipping + r.shippingCost * u,
      packaging: acc.packaging + r.packCost * u,
      adSpend: acc.adSpend + r.adCost * u,
      grossProfit: acc.grossProfit + r.netProfit * u,
      units: acc.units + u,
    }
  }, { revenue: 0, exVatRevenue: 0, vatLiability: 0, cogs: 0, referralFees: 0, shipping: 0, packaging: 0, adSpend: 0, grossProfit: 0, units: 0 })

  const totalStockValue = inventory.reduce((s, i) => s + (parseFloat(i.costPrice) || 0) * (parseInt(i.units) || 0), 0)
  const costOfSales = totals.cogs + totals.referralFees + totals.shipping + totals.packaging + totals.adSpend
  const grossMargin = totals.revenue > 0 ? (totals.grossProfit / totals.revenue) * 100 : 0
  const unpriced = inventory.length - priced.length

  const rows = priced.map(item => {
    const r = calcProduct({ ...item }, carriers, packaging)
    const u = parseInt(item.units) || 0
    return { item, r, u }
  }).sort((a, b) => b.r.margin - a.r.margin)

  return (
    <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl w-full max-w-2xl my-8 shadow-2xl">
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-slate-100">
          <div>
            <div className="font-bold text-lg text-slate-800">Inventory P&L</div>
            <div className="text-xs text-slate-400 mt-0.5">
              Based on {priced.length} priced products ({totals.units.toLocaleString()} units)
              {unpriced > 0 && ` · ${unpriced} products excluded (no sell price set)`}
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-2xl">×</button>
        </div>

        <div className="px-6 py-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
            <MetricCard label="Total Revenue" value={fmt(totals.revenue)} />
            <MetricCard label="Gross Profit" value={fmtSigned(totals.grossProfit)} color={totals.grossProfit >= 0 ? 'text-green-600' : 'text-red-500'} />
            <MetricCard label="Gross Margin" value={pct(grossMargin)} color={grossMargin >= 0 ? 'text-green-600' : 'text-red-500'} />
            <MetricCard label="VAT Liability" value={fmt(totals.vatLiability)} color="text-blue-600" />
          </div>

          <SectionHead>Revenue</SectionHead>
          <PLRow label="Gross revenue (inc. VAT)" value={fmt(totals.revenue)} />
          <PLRow label="VAT liability" value={`-${fmt(totals.vatLiability)}`} valueClass="text-red-500" />
          <PLRow label="Ex-VAT revenue" value={fmt(totals.exVatRevenue)} valueClass="font-medium" />

          <SectionHead>Cost of sales</SectionHead>
          <PLRow label="Cost of goods (stock value)" value={`-${fmt(totals.cogs)}`} valueClass="text-red-500" />
          <PLRow label="Amazon referral fees" value={`-${fmt(totals.referralFees)}`} valueClass="text-red-500" />
          <PLRow label="Shipping costs" value={`-${fmt(totals.shipping)}`} valueClass="text-red-500" />
          <PLRow label="Packaging costs" value={`-${fmt(totals.packaging)}`} valueClass="text-red-500" />
          <PLRow label="Ad spend" value={`-${fmt(totals.adSpend)}`} valueClass="text-red-500" />
          <PLRow label="Total cost of sales" value={`-${fmt(costOfSales)}`} valueClass="font-medium" />

          <div className="flex justify-between items-center py-2 px-3 bg-amber-50 border border-amber-100 rounded-lg mt-2 mb-1">
            <span className="text-sm font-medium text-amber-800">Total stock value (upfront cost)</span>
            <span className="font-semibold text-amber-800">{fmt(totalStockValue)}</span>
          </div>

          <div className="flex justify-between items-center py-3 bg-slate-50 rounded-lg px-3 mt-2 mb-4">
            <span className="font-bold text-slate-800">Gross profit</span>
            <div className="text-right">
              <span className={`font-bold text-lg ${totals.grossProfit >= 0 ? 'text-green-600' : 'text-red-500'}`}>{fmtSigned(totals.grossProfit)}</span>
              <span className="text-xs text-slate-400 ml-2">({pct(grossMargin)} margin)</span>
            </div>
          </div>

          {/* Product breakdown */}
          <div className="flex items-center justify-between border-b-2 border-slate-200 pb-2 mb-3">
            <div className="font-bold text-sm text-slate-800">Product Breakdown</div>
            <div className="flex gap-2">
              <span className="bg-slate-100 text-slate-700 font-bold text-xs px-2 py-1 rounded-full">{priced.length} products</span>
              <span className="bg-indigo-100 text-indigo-700 font-bold text-xs px-2 py-1 rounded-full">{totals.units.toLocaleString()} units</span>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left py-2 text-xs font-semibold text-slate-400 uppercase tracking-wide">Product</th>
                  <th className="text-right py-2 text-xs font-semibold text-slate-400 uppercase tracking-wide">Units</th>
                  <th className="text-right py-2 text-xs font-semibold text-slate-400 uppercase tracking-wide">Revenue</th>
                  <th className="text-right py-2 text-xs font-semibold text-slate-400 uppercase tracking-wide">Gross Profit</th>
                  <th className="text-right py-2 text-xs font-semibold text-slate-400 uppercase tracking-wide">Margin</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ item, r, u }) => (
                  <tr key={item.id} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className="py-2 text-slate-700">{item.name}</td>
                    <td className="py-2 text-right text-slate-600">{u.toLocaleString()}</td>
                    <td className="py-2 text-right text-slate-600">{fmt(r.sellPrice * u)}</td>
                    <td className={`py-2 text-right font-medium ${r.netProfit * u >= 0 ? 'text-green-600' : 'text-red-500'}`}>{fmtSigned(r.netProfit * u)}</td>
                    <td className="py-2 text-right text-slate-600">{pct(r.margin)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="px-6 pb-6">
          <button className="btn btn-secondary w-full justify-center" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
