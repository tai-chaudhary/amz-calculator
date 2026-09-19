import React, { useState } from 'react'
import { calcProduct, fmt, fmtSigned, pct } from '../lib/calc'
import { ProductImage } from './UI'

export default function ReviewPage({ savedProducts, stockItems = [], settings, liveProducts = [], onApprove, onSendBack, onLoad }) {
  const [search, setSearch] = useState('')
  const [noteFor, setNoteFor] = useState(null)
  const [noteText, setNoteText] = useState('')

  const inReview = savedProducts
    .filter(row => (row.data?.reviewStatus || 'none') === 'review')
    .filter(row => {
      if (!search.trim()) return true
      const q = search.toLowerCase()
      const p = row.data || {}
      return row.name.toLowerCase().includes(q) ||
        (p.brand || '').toLowerCase().includes(q) ||
        (p.asin || '').toLowerCase().includes(q) ||
        (p.supplierSku || '').toLowerCase().includes(q)
    })

  const handleSendBack = (row) => {
    onSendBack(row.id, noteText.trim())
    setNoteFor(null)
    setNoteText('')
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-[28px] leading-tight">Review Queue</h1>
          <p className="text-sm text-ink/50 mt-1">
            {inReview.length} product{inReview.length !== 1 ? 's' : ''} awaiting review
          </p>
        </div>
      </div>

      {inReview.length === 0 && !search.trim() ? (
        <div className="card flex flex-col items-center justify-center py-16 text-center">
          <div className="text-4xl mb-3">🔍</div>
          <div className="font-medium text-ink/80 mb-1">Nothing to review</div>
          <div className="text-sm text-ink/45">Products sent for review from Saved Products or Bulk Upload will appear here</div>
        </div>
      ) : (
        <>
          <div className="mb-4">
            <input
              type="text"
              placeholder="Search review queue…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="input text-sm"
              style={{ width: 300 }}
            />
          </div>

          <div className="space-y-3">
            {inReview.map(row => {
              const p = row.data || {}
              const r = calcProduct(p, settings.carriers, settings.packaging, stockItems)
              const isBundle = parseInt(p.bundleQty) > 1
              const asin = p.asin?.trim()
              const lowMargin = r.margin < 10

              return (
                <div key={row.id} className="card border-2 border-warn/25">
                  <div className="flex gap-4 flex-wrap">
                    {/* Image */}
                    <div className="flex-shrink-0 bg-white rounded-xl border border-rule flex items-center justify-center overflow-hidden" style={{ width: 90, height: 90 }}>
                      <ProductImage asin={asin} manualImage={p.productImage} alt={row.name} className="object-contain w-full h-full p-1.5" placeholderSize="text-3xl" />
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0" style={{ minWidth: 240 }}>
                      <div className="flex items-center gap-2 flex-wrap mb-0.5">
                        {p.brand && <span className="text-xs font-semibold text-royal-500">{p.brand}</span>}
                        <span className="pill pill-paused">🔍 In review</span>
                        {isBundle && <span className="pill pill-brand">Bundle ×{p.bundleQty}</span>}
                        {lowMargin && <span className="pill pill-alert">⚠ Low margin</span>}
                      </div>
                      <div className="font-semibold text-ink leading-snug">{row.name}</div>
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-xs">
                        {asin ? (
                          <a href={`https://www.amazon.co.uk/dp/${asin}`} target="_blank" rel="noopener noreferrer"
                            className="text-royal-500 hover:text-royal-700 font-medium">ASIN: {asin} ↗</a>
                        ) : <span className="text-ink/30">No ASIN</span>}
                        {p.supplierName && <span className="text-ink/45">{p.supplierName}</span>}
                        {p.supplierSku && <span className="text-ink/45">SKU: {p.supplierSku}</span>}
                      </div>
                      {(p.submittedByName || p.createdByName) && (
                        <div className="text-xs text-ink/45 mt-1">
                          Submitted by <span className="font-medium text-ink/70">{p.submittedByName || p.createdByName}</span>
                          {p.submittedAt && ` · ${new Date(p.submittedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`}
                        </div>
                      )}
                      {p.reviewNote && (
                        <div className="text-xs text-warn bg-warn/5 rounded-lg px-2 py-1 mt-2 inline-block">
                          Note: {p.reviewNote}
                        </div>
                      )}
                    </div>

                    {/* Metrics */}
                    <div className="flex-shrink-0" style={{ minWidth: 280 }}>
                      <div className="grid grid-cols-4 gap-2">
                        <div className="metric-card py-2">
                          <div className="metric-label">Sell</div>
                          <div className="metric-value text-sm">{fmt(r.sellPrice)}</div>
                        </div>
                        <div className="metric-card py-2">
                          <div className="metric-label">Cost</div>
                          <div className="metric-value text-sm">{fmt(r.costPrice)}</div>
                        </div>
                        <div className="metric-card py-2">
                          <div className="metric-label">Profit</div>
                          <div className={`metric-value text-sm ${r.netProfit >= 0 ? 'text-gain' : 'text-loss'}`}>{fmtSigned(r.netProfit)}</div>
                        </div>
                        <div className="metric-card py-2">
                          <div className="metric-label">Margin</div>
                          <div className={`metric-value text-sm ${r.margin >= 0 ? 'text-gain' : 'text-loss'}`}>{pct(r.margin)}</div>
                        </div>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex flex-col gap-2 flex-shrink-0 justify-center">
                      <button className="btn btn-success btn-sm" onClick={() => onApprove(row.id, row.name)}>
                        ✓ Approve &amp; go live
                      </button>
                      <button className="btn btn-secondary btn-sm" onClick={() => onLoad(row)}>
                        ✏️ Open in calculator
                      </button>
                      <button className="btn btn-secondary btn-sm" onClick={() => { setNoteFor(row.id); setNoteText(p.reviewNote || '') }}>
                        ↩ Send back
                      </button>
                    </div>
                  </div>

                  {/* Send back note */}
                  {noteFor === row.id && (
                    <div className="mt-3 pt-3 border-t border-rule">
                      <label className="label">Reason / feedback (optional)</label>
                      <div className="flex gap-2">
                        <input
                          autoFocus
                          className="input text-sm flex-1"
                          placeholder="e.g. margin too low, check shipping weight"
                          value={noteText}
                          onChange={e => setNoteText(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') handleSendBack(row); if (e.key === 'Escape') setNoteFor(null) }}
                        />
                        <button className="btn btn-primary btn-sm" onClick={() => handleSendBack(row)}>Send back</button>
                        <button className="btn btn-secondary btn-sm" onClick={() => setNoteFor(null)}>Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
