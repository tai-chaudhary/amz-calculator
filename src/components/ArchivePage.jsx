import React, { useState, useMemo } from 'react'
import { calcProduct, hasComponents, fmt, pct } from '../lib/calc'

export default function ArchivePage({
  savedProducts, liveProducts, stockItems, settings,
  onRunSweep, onRestore, onArchive,
}) {
  const [search, setSearch] = useState('')
  const [showSweep, setShowSweep] = useState(false)

  const archived = savedProducts.filter(r => r.data?.archived)
  const filtered = search.trim()
    ? archived.filter(r => {
        const q = search.toLowerCase()
        const p = r.data || {}
        return r.name.toLowerCase().includes(q) ||
          (p.brand || '').toLowerCase().includes(q) ||
          (p.asin || '').toLowerCase().includes(q) ||
          (p.supplierSku || '').toLowerCase().includes(q)
      })
    : archived

  // What a sweep would do right now
  const sweep = useMemo(() => {
    const liveIds = new Set(liveProducts.map(lp => lp.saved_product_id))
    const toArchive = savedProducts.filter(r =>
      !r.data?.archived && !liveIds.has(r.id)
    )
    const keptIds = new Set(savedProducts.filter(r => liveIds.has(r.id)).map(r => r.id))

    // Stock items still used by something that stays
    const usedByKept = new Set()
    savedProducts.forEach(r => {
      if (!keptIds.has(r.id)) return
      const p = r.data || {}
      if (!hasComponents(p)) return
      p.components.forEach(c => usedByKept.add(c.stockItemId))
    })
    const orphanStock = stockItems.filter(si => !usedByKept.has(si.id))

    return { toArchive, orphanStock, liveCount: liveIds.size, keptCount: keptIds.size }
  }, [savedProducts, liveProducts, stockItems])

  return (
    <div>
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div>
          <h1 className="text-[28px] leading-tight">Archive</h1>
          <p className="text-sm text-ink/50 mt-1">
            {archived.length} archived listing{archived.length !== 1 ? 's' : ''}. Hidden everywhere else, nothing deleted.
          </p>
        </div>
        {sweep.toArchive.length > 0 && (
          <button className="btn btn-primary btn-sm" onClick={() => setShowSweep(true)}>
            Archive {sweep.toArchive.length} non-live listing{sweep.toArchive.length !== 1 ? 's' : ''}
          </button>
        )}
      </div>

      {sweep.toArchive.length > 0 && (
        <div className="card mb-4 border-2 border-warn/25 bg-warn/5">
          <div className="font-semibold text-ink text-sm">
            {sweep.toArchive.length} listing{sweep.toArchive.length !== 1 ? 's are' : ' is'} not live
          </div>
          <div className="text-sm text-ink/55 mt-0.5">
            These are still showing in Saved Listings, Brands, Suppliers and elsewhere. Archiving hides
            them without deleting anything — you can restore any of them from this page.
          </div>
        </div>
      )}

      {archived.length === 0 ? (
        <div className="card flex flex-col items-center justify-center py-16 text-center">
          <div className="text-4xl mb-3">🗄</div>
          <div className="font-medium text-ink/80 mb-1">Nothing archived</div>
          <div className="text-sm text-ink/45">Archived listings stay here until you restore them</div>
        </div>
      ) : (
        <>
          <div className="mb-4">
            <input
              type="text" placeholder="Search archive…" value={search}
              onChange={e => setSearch(e.target.value)}
              className="input text-sm" style={{ width: 280 }}
            />
          </div>

          <div className="card p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-rule bg-paper">
                    <th className="text-left px-4 py-3 text-xs font-semibold text-ink/45">Listing</th>
                    <th className="text-right px-3 py-3 text-xs font-semibold text-ink/45">Sell</th>
                    <th className="text-right px-3 py-3 text-xs font-semibold text-ink/45">Margin</th>
                    <th className="text-left px-3 py-3 text-xs font-semibold text-ink/45">Archived</th>
                    <th className="px-3 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(row => {
                    const p = row.data || {}
                    const r = calcProduct(p, settings.carriers, settings.packaging, stockItems)
                    return (
                      <tr key={row.id} className="border-b border-rule/60 hover:bg-paper group">
                        <td className="px-4 py-3">
                          <div className="font-medium text-ink/80">{row.name}</div>
                          <div className="text-xs text-ink/45">
                            {p.brand && <span>{p.brand} · </span>}
                            {p.asin || 'no ASIN'}
                          </div>
                        </td>
                        <td className="px-3 py-3 text-right text-ink/55">{fmt(r.sellPrice)}</td>
                        <td className="px-3 py-3 text-right text-ink/55">{pct(r.margin)}</td>
                        <td className="px-3 py-3 text-xs text-ink/45">
                          {p.archivedAt ? new Date(p.archivedAt).toLocaleDateString('en-GB') : '—'}
                        </td>
                        <td className="px-3 py-3 text-right">
                          <button
                            className="btn btn-xs btn-secondary opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={() => onRestore(row.id, row.name)}
                          >↩ Restore</button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {showSweep && (
        <SweepModal
          sweep={sweep}
          settings={settings}
          stockItems={stockItems}
          onConfirm={(opts) => { onRunSweep(sweep, opts); setShowSweep(false) }}
          onClose={() => setShowSweep(false)}
        />
      )}
    </div>
  )
}

function SweepModal({ sweep, settings, stockItems, onConfirm, onClose }) {
  const [keepReview, setKeepReview] = useState(true)
  const [removeStock, setRemoveStock] = useState(true)

  const inReview = sweep.toArchive.filter(r => (r.data?.reviewStatus || 'none') === 'review')
  const willArchive = keepReview
    ? sweep.toArchive.filter(r => (r.data?.reviewStatus || 'none') !== 'review')
    : sweep.toArchive

  return (
    <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl w-full max-w-2xl my-8 shadow-2xl">
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-rule">
          <div>
            <div className="font-semibold text-base text-ink">Archive non-live listings</div>
            <div className="text-xs text-ink/45 mt-0.5">Nothing happens until you confirm</div>
          </div>
          <button onClick={onClose} className="text-ink/45 hover:text-ink/70 text-2xl">×</button>
        </div>

        <div className="px-6 py-4 space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="metric-card">
              <div className="metric-label">Stays live</div>
              <div className="metric-value text-lg text-gain">{sweep.liveCount}</div>
            </div>
            <div className="metric-card">
              <div className="metric-label">To archive</div>
              <div className="metric-value text-lg text-warn">{willArchive.length}</div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Stock items removed</div>
              <div className="metric-value text-lg">{removeStock ? sweep.orphanStock.length : 0}</div>
            </div>
          </div>

          {/* The safeguard */}
          <div className={`rounded-xl p-3 text-sm ${sweep.liveCount === 112 ? 'bg-gain/5 border border-gain/25 text-green-800' : 'bg-warn/5 border border-warn/25 text-warn'}`}>
            {sweep.liveCount === 112
              ? '✓ 112 live listings found, as expected.'
              : `⚠ Found ${sweep.liveCount} live listings, not the 112 you expected. Worth checking before you confirm.`}
          </div>

          {inReview.length > 0 && (
            <label className="flex items-start gap-2 cursor-pointer text-sm text-ink/70 bg-paper rounded-xl p-3">
              <input type="checkbox" className="w-4 h-4 accent-royal-500 mt-0.5"
                checked={keepReview} onChange={e => setKeepReview(e.target.checked)} />
              <span>
                Keep the {inReview.length} listing{inReview.length !== 1 ? 's' : ''} in the Review Queue
                <span className="block text-xs text-ink/45">They're not live, but they may be work in progress</span>
              </span>
            </label>
          )}

          <label className="flex items-start gap-2 cursor-pointer text-sm text-ink/70 bg-paper rounded-xl p-3">
            <input type="checkbox" className="w-4 h-4 accent-royal-500 mt-0.5"
              checked={removeStock} onChange={e => setRemoveStock(e.target.checked)} />
            <span>
              Remove the {sweep.orphanStock.length} stock item{sweep.orphanStock.length !== 1 ? 's' : ''} no live listing uses
              <span className="block text-xs text-ink/45">
                Anything shared with a live listing is kept. This one is a deletion, not an archive.
              </span>
            </span>
          </label>

          <details className="text-sm">
            <summary className="cursor-pointer text-royal-500 hover:text-royal-700 font-medium">
              Preview the {willArchive.length} listings to archive
            </summary>
            <div className="mt-2 max-h-56 overflow-y-auto border border-rule rounded-lg">
              <table className="w-full text-xs">
                <tbody>
                  {willArchive.map(r => (
                    <tr key={r.id} className="border-b border-rule/60">
                      <td className="px-3 py-1.5 text-ink/80">{r.name}</td>
                      <td className="px-3 py-1.5 text-right text-ink/45">{r.data?.asin || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>

          {removeStock && sweep.orphanStock.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer text-royal-500 hover:text-royal-700 font-medium">
                Preview the {sweep.orphanStock.length} stock items to remove
              </summary>
              <div className="mt-2 max-h-56 overflow-y-auto border border-rule rounded-lg">
                <table className="w-full text-xs">
                  <tbody>
                    {sweep.orphanStock.map(si => (
                      <tr key={si.id} className="border-b border-rule/60">
                        <td className="px-3 py-1.5 text-ink/80">{si.name}</td>
                        <td className="px-3 py-1.5 text-right text-ink/45">{si.data?.supplierSku || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
        </div>

        <div className="px-6 pb-6 flex gap-2">
          <button className="btn btn-primary flex-1 justify-center"
            onClick={() => onConfirm({ keepReview, removeStock })}>
            Archive {willArchive.length} listings
            {removeStock && sweep.orphanStock.length > 0 && ` & remove ${sweep.orphanStock.length} stock items`}
          </button>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  )
}
