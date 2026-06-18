import React, { useState } from 'react'
import { calcProduct, fmt, fmtSigned, pct } from '../lib/calc'
import { EmptyState, Spinner, ResultRow, Modal } from './UI'
import { SERVICE_LABELS } from '../lib/defaults'

const SORT_OPTIONS = [
  { value: 'latest', label: 'Latest added' },
  { value: 'oldest', label: 'Oldest added' },
  { value: 'margin_desc', label: 'Highest margin' },
  { value: 'margin_asc', label: 'Lowest margin' },
  { value: 'profit_desc', label: 'Highest profit' },
  { value: 'profit_asc', label: 'Lowest profit' },
  { value: 'price_desc', label: 'Highest price' },
  { value: 'price_asc', label: 'Lowest price' },
  { value: 'name_asc', label: 'Name A–Z' },
  { value: 'name_desc', label: 'Name Z–A' },
]

export default function SavedPage({ savedProducts, settings, onDelete, onLoad, onRename }) {
  const [units, setUnits] = useState({})
  const [detailProduct, setDetailProduct] = useState(null)
  const [sort, setSort] = useState('latest')
  const [renamingId, setRenamingId] = useState(null)
  const [renameVal, setRenameVal] = useState('')
  const [search, setSearch] = useState('')

  if (!savedProducts.length) return (
    <div>
      <h1 className="text-xl font-semibold text-slate-800 mb-6">Saved Products</h1>
      <EmptyState icon="💾" title="No saved products yet" sub="Calculate a product and hit Save to store it here" />
    </div>
  )

  // Sort products
  const filtered = search.trim() ? savedProducts.filter(p => p.name.toLowerCase().includes(search.toLowerCase()) || (p.data?.asin||'').toLowerCase().includes(search.toLowerCase()) || (p.data?.supplierName||'').toLowerCase().includes(search.toLowerCase())) : savedProducts
  const sorted = [...filtered].sort((a, b) => {
    const ra = calcProduct(a.data, settings.carriers, settings.packaging)
    const rb = calcProduct(b.data, settings.carriers, settings.packaging)
    switch (sort) {
      case 'latest': return new Date(b.created_at) - new Date(a.created_at)
      case 'oldest': return new Date(a.created_at) - new Date(b.created_at)
      case 'margin_desc': return rb.margin - ra.margin
      case 'margin_asc': return ra.margin - rb.margin
      case 'profit_desc': return rb.netProfit - ra.netProfit
      case 'profit_asc': return ra.netProfit - rb.netProfit
      case 'price_desc': return (parseFloat(b.data.sellPrice)||0) - (parseFloat(a.data.sellPrice)||0)
      case 'price_asc': return (parseFloat(a.data.sellPrice)||0) - (parseFloat(b.data.sellPrice)||0)
      case 'name_asc': return a.name.localeCompare(b.name)
      case 'name_desc': return b.name.localeCompare(a.name)
      default: return 0
    }
  })

  const handleRenameSubmit = (id) => {
    if (renameVal.trim()) onRename(id, renameVal.trim())
    setRenamingId(null)
    setRenameVal('')
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Saved Products</h1>
          <p className="text-sm text-slate-400 mt-0.5">{filtered.length} of {savedProducts.length} product{savedProducts.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="text"
            placeholder="Search products…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="input text-sm"
            style={{width: 180}}
          />
          <label className="text-xs text-slate-500">Sort by</label>
          <select className="input text-sm" style={{width: 160}} value={sort} onChange={e => setSort(e.target.value)}>
            {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      </div>

      {sorted.length === 0 && search && (
        <div className="text-center py-12 text-slate-400 text-sm">No products matching "{search}"</div>
      )}
      <div className="space-y-4">
        {sorted.map((row) => {
          const p = row.data
          const r = calcProduct(p, settings.carriers, settings.packaging)
          const u = parseFloat(units[row.id]) || 0

          return (
            <div key={row.id} className="card">
              <div className="flex items-start justify-between mb-4 flex-wrap gap-2">
                <div className="flex-1">
                  {renamingId === row.id ? (
                    <div className="flex gap-2 items-center">
                      <input
                        autoFocus
                        className="input text-sm font-semibold"
                        style={{maxWidth: 220}}
                        value={renameVal}
                        onChange={e => setRenameVal(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleRenameSubmit(row.id); if (e.key === 'Escape') setRenamingId(null) }}
                      />
                      <button className="btn btn-primary btn-xs" onClick={() => handleRenameSubmit(row.id)}>Save</button>
                      <button className="btn btn-secondary btn-xs" onClick={() => setRenamingId(null)}>Cancel</button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <div
                        className="font-semibold text-base text-slate-800 cursor-pointer hover:text-indigo-600"
                        onClick={() => setDetailProduct(row)}
                      >
                        {row.name}
                      </div>
                      <button
                        className="text-slate-300 hover:text-slate-500 text-xs"
                        onClick={() => { setRenamingId(row.id); setRenameVal(row.name) }}
                        title="Rename"
                      >✏️</button>
                    </div>
                  )}
                  <div className="text-xs text-slate-400 mt-0.5">
                    Sell: {fmt(parseFloat(p.sellPrice) || 0)} · Cost: {fmt(parseFloat(p.costPrice) || 0)} · Ref: {p.refFee}% · <span className="cursor-pointer underline text-indigo-400" onClick={() => setDetailProduct(row)}>View details</span>
                  </div>
                </div>
                <div className="flex gap-2 flex-wrap">
                  <span className={`badge ${r.netProfit >= 0 ? 'badge-green' : 'badge-red'}`}>{fmtSigned(r.netProfit)} / unit</span>
                  <span className="badge badge-blue">{pct(r.margin)} margin</span>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                <div className="metric-card">
                  <div className="metric-label">Net Profit</div>
                  <div className={`metric-value ${r.netProfit >= 0 ? 'text-green-600' : 'text-red-500'}`}>{fmtSigned(r.netProfit)}</div>
                </div>
                <div className="metric-card">
                  <div className="metric-label">Margin</div>
                  <div className="metric-value">{pct(r.margin)}</div>
                </div>
                <div className="metric-card">
                  <div className="metric-label">Break-even</div>
                  <div className="metric-value">{fmt(r.breakEven)}</div>
                </div>
                <div className="metric-card">
                  <div className="metric-label">VAT / unit</div>
                  <div className="metric-value text-blue-600">{fmt(r.vatAmount)}</div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3 mb-4">
                <div className="text-xs text-slate-500">Monthly forecast:</div>
                <input
                  type="number"
                  placeholder="Units / month"
                  value={units[row.id] || ''}
                  onChange={(e) => setUnits((u2) => ({ ...u2, [row.id]: e.target.value }))}
                  className="input text-sm"
                  style={{ width: 130 }}
                />
                {u > 0 && (
                  <div className="flex gap-3 text-sm flex-wrap">
                    <span className={`font-medium ${r.netProfit * u >= 0 ? 'text-green-600' : 'text-red-500'}`}>{fmtSigned(r.netProfit * u)} profit / mo</span>
                    <span className="text-slate-400">·</span>
                    <span className="text-blue-600">{fmt(r.vatAmount * u)} VAT / mo</span>
                    <span className="text-slate-400">·</span>
                    <span className="text-slate-600">{fmt(r.sellPrice * u)} revenue / mo</span>
                  </div>
                )}
              </div>

              <div className="border-t border-slate-100 pt-3 flex gap-2">
                <button className="btn btn-secondary btn-sm" onClick={() => onLoad(row)}>✏️ Edit in calculator</button>
                <button className="btn btn-danger btn-sm" onClick={() => onDelete(row.id)}>🗑 Delete</button>
              </div>
            </div>
          )
        })}
      </div>

      {detailProduct && (
        <ProductDetailModal
          row={detailProduct}
          settings={settings}
          onClose={() => setDetailProduct(null)}
          onLoad={() => { onLoad(detailProduct); setDetailProduct(null) }}
        />
      )}
    </div>
  )
}

function ProductDetailModal({ row, settings, onClose, onLoad }) {
  const p = row.data
  const r = calcProduct(p, settings.carriers, settings.packaging)
  const carrier = p.carrierId ? settings.carriers[p.carrierId] : null
  const carrierCat = carrier ? carrier.categories.find((c) => c.id === p.carrierCatId) : null
  const packagingItem = p.packagingId ? settings.packaging.find((x) => x.id === p.packagingId) : null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl w-full max-w-lg my-8 shadow-2xl">
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-slate-100">
          <div>
            <div className="font-semibold text-lg text-slate-800">{row.name}</div>
            <div className="text-xs text-slate-400 mt-0.5">Full product details</div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-2xl leading-none">×</button>
        </div>
        <div className="px-6 py-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
            <div className="metric-card"><div className="metric-label">Net Profit</div><div className={`metric-value ${r.netProfit >= 0 ? 'text-green-600' : 'text-red-500'}`}>{fmtSigned(r.netProfit)}</div></div>
            <div className="metric-card"><div className="metric-label">Margin</div><div className="metric-value">{pct(r.margin)}</div></div>
            <div className="metric-card"><div className="metric-label">Break-even</div><div className="metric-value">{fmt(r.breakEven)}</div></div>
            <div className="metric-card"><div className="metric-label">VAT / unit</div><div className="metric-value text-blue-600">{fmt(r.vatAmount)}</div></div>
          </div>

          {(p.asin || p.supplierName || p.productUrl || p.notes) && (
            <>
              <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Product Info</div>
              {p.asin && <ResultRow label="ASIN" value={p.asin} />}
              {p.supplierName && <ResultRow label="Supplier" value={p.supplierName} />}
              {p.productUrl && (
                <div className="result-row">
                  <span className="text-slate-500">Amazon listing</span>
                  <a href={p.productUrl} target="_blank" rel="noopener noreferrer" className="text-indigo-500 text-sm hover:underline">View on Amazon ↗</a>
                </div>
              )}
              {p.supplierUrl && (
                <div className="result-row">
                  <span className="text-slate-500">Supplier link</span>
                  <a href={p.supplierUrl} target="_blank" rel="noopener noreferrer" className="text-orange-500 text-sm hover:underline">View supplier ↗</a>
                </div>
              )}
              {p.notes && <ResultRow label="Notes" value={p.notes} />}
            </>
          )}

          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mt-4 mb-2">Pricing</div>
          <ResultRow label="Sell price (inc. VAT)" value={fmt(parseFloat(p.sellPrice) || 0)} />
          <ResultRow label="Cost price" value={fmt(parseFloat(p.costPrice) || 0)} />
          <ResultRow label="Ad cost" value={fmt(parseFloat(p.adCost) || 0)} />
          <ResultRow label="VAT rate" value={p.vatZero ? '0% rated' : '20%'} />
          <ResultRow label="Referral fee" value={p.refFee + '%'} />

          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mt-4 mb-2">Shipping</div>
          <ResultRow label="Weight" value={(parseFloat(p.weightKg) || 0) + ' kg'} />
          <ResultRow label="Service level" value={SERVICE_LABELS[p.serviceLevel] || p.serviceLevel} />
          <ResultRow label="Carrier" value={carrier ? carrier.name : '—'} />
          <ResultRow label="Weight category" value={carrierCat ? carrierCat.name : '—'} />
          <ResultRow label="Shipping cost" value={fmt(r.shippingCost)} />
          <ResultRow label="Packaging" value={packagingItem ? packagingItem.name + ' (' + fmt(packagingItem.cost) + ')' : '—'} />
          {p.parcelSplit && <ResultRow label="Parcel split" value={p.numParcels + ' parcels'} />}

          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mt-4 mb-2">P&L breakdown</div>
          <ResultRow label="Ex-VAT revenue" value={fmt(r.exVatRevenue)} />
          <ResultRow label="VAT liability" value={fmt(r.vatAmount)} valueClass="text-blue-600" />
          <ResultRow label="Referral fee" value={`-${fmt(r.referralFee)}`} valueClass="text-red-500" />
          <ResultRow label="Cost of goods" value={`-${fmt(r.costPrice)}`} valueClass="text-red-500" />
          <ResultRow label="Shipping" value={`-${fmt(r.shippingCost)}`} valueClass="text-red-500" />
          <ResultRow label="Packaging" value={`-${fmt(r.packCost)}`} valueClass="text-red-500" />
          <ResultRow label="Ad cost" value={`-${fmt(r.adCost)}`} valueClass="text-red-500" />
          <div className="flex justify-between items-center pt-3 mt-1 border-t border-slate-200">
            <span className="font-semibold text-slate-800">Net profit</span>
            <span className={`font-bold text-base ${r.netProfit >= 0 ? 'text-green-600' : 'text-red-500'}`}>{fmtSigned(r.netProfit)}</span>
          </div>
        </div>
        <div className="px-6 pb-6 pt-2 flex gap-2">
          <button className="btn btn-primary flex-1 justify-center" onClick={onLoad}>✏️ Edit in calculator</button>
          <button className="btn btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
