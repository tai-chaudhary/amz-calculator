import React from 'react'
import { calcProduct, fmt, fmtSigned, pct } from '../lib/calc'
import { EmptyState, Spinner } from './UI'

export default function RecycleBinPage({ binItems, settings, onRestore, onPermanentDelete, loading }) {
  if (loading) return <Spinner />

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-slate-800">Recycle Bin</h1>
        <p className="text-sm text-slate-400 mt-0.5">Deleted products — restore or permanently remove</p>
      </div>

      {binItems.length === 0 && (
        <EmptyState icon="🗑" title="Recycle bin is empty" sub="Deleted products will appear here and can be restored" />
      )}

      <div className="space-y-3">
        {binItems.map((row) => {
          const p = row.data?.data || row.data
          const r = settings ? calcProduct(p, settings.carriers, settings.packaging) : null
          const deletedAt = new Date(row.deleted_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

          return (
            <div key={row.id} className="card opacity-75 hover:opacity-100 transition-opacity">
              <div className="flex items-start justify-between flex-wrap gap-3">
                <div>
                  <div className="font-semibold text-slate-700">{row.name}</div>
                  <div className="text-xs text-slate-400 mt-0.5">
                    Deleted {deletedAt}
                    {r && ` · Sell: ${fmt(parseFloat(p.sellPrice) || 0)} · Profit: ${fmtSigned(r.netProfit)} / unit`}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => onRestore(row)}
                  >
                    ♻️ Restore
                  </button>
                  <button
                    className="btn btn-danger btn-sm"
                    onClick={() => {
                      if (window.confirm(`Permanently delete "${row.name}"? This cannot be undone.`))
                        onPermanentDelete(row.id)
                    }}
                  >
                    🗑 Delete permanently
                  </button>
                </div>
              </div>

              {r && (
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-3 mt-4">
                  <div className="metric-card">
                    <div className="metric-label">Net Profit</div>
                    <div className={`metric-value ${r.netProfit >= 0 ? 'text-green-600' : 'text-red-500'}`}>{fmtSigned(r.netProfit)}</div>
                  </div>
                  <div className="metric-card">
                    <div className="metric-label">Margin</div>
                    <div className="metric-value">{pct(r.margin)}</div>
                  </div>
                  <div className="metric-card">
                    <div className="metric-label">Sell price</div>
                    <div className="metric-value">{fmt(parseFloat(p.sellPrice) || 0)}</div>
                  </div>
                  <div className="metric-card">
                    <div className="metric-label">Break-even</div>
                    <div className="metric-value">{fmt(r.breakEven)}</div>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
