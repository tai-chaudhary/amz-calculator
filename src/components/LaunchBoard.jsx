import React, { useEffect, useMemo, useState } from 'react'
import { EmptyState, Spinner, SearchInput, Icon } from './UI'
import { ListingTable, ListingDrawer, LaunchAction } from './SavedPage'
import { useLaunch, STAGES, stageInfo } from '../lib/launch'
import { smartFilter, hay } from '../lib/match'

/**
 * Approvals → Launch (v2.73.1): every approved listing that isn't live yet, in the same listing table and drawer as
 * Saved Listings, with its launch stage — worked out by the database from stock on hand, purchase orders and
 * Goods In, never set by hand:  Needs ordering → Ordered → Arriving → Ready to go live (any stock at all).
 */
export default function LaunchBoard({
  savedProducts = [], stockItems = [], settings, liveProducts = [], onCounts,
  onPushLive, onOrderStock, onLoad, onRename, onDelete, onSendReview, onLoadActivity,
}) {
  const { rows: launchRows, byId, reload } = useLaunch(savedProducts.length)
  const [stage, setStage] = useState(null)
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(null)

  const counts = useMemo(() => Object.fromEntries(STAGES.map(s => [s.id, (launchRows || []).filter(r => r.stage === s.id).length])), [launchRows])
  useEffect(() => { if (launchRows) onCounts?.(counts) }, [counts, launchRows]) // eslint-disable-line react-hooks/exhaustive-deps
  // Open on the first stage with something in it, starting with what can go live now
  useEffect(() => {
    if (launchRows && (!stage || !counts[stage])) setStage(['ready', 'needs_order', 'ordered', 'arriving', 'no_products'].find(s => counts[s]) || 'ready')
  }, [launchRows]) // eslint-disable-line react-hooks/exhaustive-deps

  const savedById = useMemo(() => new Map(savedProducts.map(r => [r.id, r])), [savedProducts])
  const siById = useMemo(() => new Map(stockItems.map(s => [s.id, s])), [stockItems])
  const rows = useMemo(() => {
    const inStage = (launchRows || []).filter(r => r.stage === stage).map(r => savedById.get(r.id)).filter(Boolean)
    return smartFilter(inStage, search.trim().toLowerCase(), row => hay(row.name, row.data?.listingSku, row.data?.brand, row.data?.asin, row.data?.supplierName))
      .sort((a, b) => new Date(a.data?.reviewedAt || a.created_at) - new Date(b.data?.reviewedAt || b.created_at))
  }, [launchRows, stage, search, savedById])

  // Order everything that still needs ordering: one purchase order per supplier, sized to expected sales
  const bySupplier = useMemo(() => {
    const m = new Map()
    for (const r of (launchRows || []).filter(x => x.stage === 'needs_order')) {
      const est = parseInt(savedById.get(r.id)?.data?.monthlyVolume) || 0
      for (const x of r.products) {
        if (x.enough || x.ordered) continue
        const si = siById.get(x.stock_item_id); if (!si) continue
        const sup = si.data?.supplierName || ''
        const g = m.get(sup) || new Map()
        g.set(si.id, { si, qty: (g.get(si.id)?.qty || 0) + Math.max(x.need, est * x.need) })
        m.set(sup, g)
      }
    }
    return [...m.entries()].map(([supplier, g]) => ({ supplier, items: [...g.values()] })).sort((a, b) => b.items.length - a.items.length)
  }, [launchRows, siById, savedById])

  if (!launchRows) return <div className="surface flex justify-center py-10"><Spinner /></div>
  if (!launchRows.length) return <div className="surface"><EmptyState icon="live" title="Nothing waiting to launch" sub="Every approved listing is live." /></div>

  const st = stageInfo(stage)
  const openRow = open ? savedById.get(open) : null
  return (
    <div>
      <div className="tab-row mb-4">
        {STAGES.filter(s => s.id !== 'no_products' || counts.no_products).map(s => (
          <button key={s.id} className={`tab ${stage === s.id ? 'tab-active' : ''}`} onClick={() => setStage(s.id)}>
            {s.label} <span className="text-ink/35 ml-1">{counts[s.id] || 0}</span>
          </button>
        ))}
      </div>

      <div className="filter-bar mb-4">
        <SearchInput className="w-full sm:w-[340px]" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search listing, Listing SKU, ASIN, brand or supplier…" />
        <div className="text-xs text-ink/50 sm:ml-auto">{st?.hint}. Worked out from stock, purchase orders and Goods In.</div>
      </div>

      {stage === 'needs_order' && onOrderStock && bySupplier.length > 0 && (
        <div className="surface-sky p-4 mb-4 flex flex-wrap items-center gap-2">
          <div className="text-sm font-semibold text-ink mr-2">Order what’s needed</div>
          {bySupplier.map(g => (
            <button key={g.supplier || 'none'} className="btn btn-secondary btn-sm" disabled={!g.supplier}
              title={g.supplier ? `One purchase order to ${g.supplier} for ${g.items.length} product${g.items.length !== 1 ? 's' : ''}` : 'These products have no supplier set in Products'}
              onClick={() => onOrderStock(g.items)}>
              <Icon name="briefcase" size={14} /> {g.supplier || 'No supplier set'} · {g.items.length} product{g.items.length !== 1 ? 's' : ''}
            </button>
          ))}
        </div>
      )}

      <ListingTable
        rows={rows} settings={settings} stockItems={stockItems} launchById={byId} showStock
        dateLabel="Approved" dateOf={row => row.data?.reviewedAt || row.created_at}
        onOpen={row => setOpen(row.id)} onLoad={onLoad}
        showSupplier={false}
        rowAction={(row, launch) => <LaunchAction row={row} launch={launch} stockItems={stockItems} onPushLive={onPushLive} onOrderStock={onOrderStock} onDone={reload} />}
        empty={<EmptyState icon="search" title="Nothing here" sub={search ? 'Change your search.' : 'No approved listings are at this stage.'} />}
      />

      {openRow && (
        <ListingDrawer
          row={openRow} launch={byId.get(openRow.id)} onLaunchChanged={reload}
          isLive={liveProducts.some(lp => lp.saved_product_id === openRow.id && lp.status !== 'removed')}
          settings={settings} stockItems={stockItems} onClose={() => setOpen(null)}
          onLoad={() => onLoad(openRow)} onRename={onRename} onDelete={onDelete}
          onPushLive={async (...a) => { await onPushLive?.(...a); setOpen(null) }}
          onSendReview={onSendReview} onLoadActivity={onLoadActivity} onOrderStock={onOrderStock}
        />
      )}
    </div>
  )
}
