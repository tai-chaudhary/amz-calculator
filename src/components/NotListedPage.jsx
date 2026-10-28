import React, { useState, useMemo } from 'react'
import { PageHeader, Icon, SearchInput, EmptyState, MetricCard, Flag, SegmentedControl, ProductImage } from './UI'
import { calcProduct, fmt, pct, hasComponents } from '../lib/calc'
import { smartFilter, hay } from '../lib/match'
import { exportRowsToCsv, stampedName } from '../lib/csv'
import { fmtUnits } from '../lib/inventory'

/**
 * Not Listed (Sourcing, Oct 2026): every product with no live listing — so stock sitting on the shelf,
 * listings modelled but never put live, and products nobody has worked on yet are all in one place.
 *
 * "Live" means a Live Products entry that's live (paused and removed don't count). Views:
 *   In stock        units on the shelf and nothing selling them on Amazon: money sitting still
 *   Ready to list   a saved listing exists — the work is done, it just isn't live
 *   Paused          a listing exists but is paused
 *   Never modelled  no listing at all
 *   Selling elsewhere  despatched in the last 28 days anyway (eBay, TikTok, manual)
 */

export default function NotListedPage({ stockItems = [], savedProducts = [], liveProducts = [], inventory, settings, sees = false, onCreateListing, onOpenProduct, onNavigate }) {
  const [view, setView] = useState('stock')
  const [q, setQ] = useState('')
  const [sort, setSort] = useState('value')

  const rows = useMemo(() => {
    const live = new Map(liveProducts.filter(lp => lp.status !== 'removed').map(lp => [lp.saved_product_id, lp.status]))
    const uses = new Map()
    for (const row of savedProducts) {
      const p = row.data || {}
      if (p.archived || !hasComponents(p)) continue
      for (const c of p.components) { if (!uses.has(c.stockItemId)) uses.set(c.stockItemId, []); uses.get(c.stockItemId).push(row) }
    }
    const inv = new Map((inventory?.products || []).map(p => [p.stock_item_id, p]))
    return stockItems
      .filter(si => !si.data?.archived && !(si.data?.packaging && !si.data?.alsoSold))
      .map(si => {
        const mine = uses.get(si.id) || []
        const statuses = mine.map(r => live.get(r.id)).filter(Boolean)
        if (statuses.includes('live')) return null
        const ip = inv.get(si.id)
        const d = si.data || {}
        const cost = parseFloat(d.lastPaid ?? d.costPrice) || 0
        // The best margin among its saved listings, so the one to put live first is obvious
        let best = null
        for (const r of mine) {
          try {
            const res = calcProduct(r.data, settings?.carriers, settings?.packaging, stockItems)
            if (!res?.incomplete && (!best || res.margin > best.margin)) best = { row: r, margin: res.margin, profit: res.netProfit }
          } catch { /* skip */ }
        }
        const onHand = Math.max(0, Number(ip?.on_hand) || 0)
        return {
          si, d, ip, listings: mine, paused: statuses.includes('paused'), best, onHand, cost,
          value: cost * onHand, sold28: Number(ip?.units_28) || 0, onOrder: Number(ip?.on_order) || 0,
          asin: mine.find(r => r.data?.asin)?.data?.asin || '', image: mine[0]?.data?.productImage,
        }
      }).filter(Boolean)
  }, [stockItems, savedProducts, liveProducts, inventory, settings])

  const VIEWS = [
    { id: 'stock', label: 'In stock', test: r => r.onHand > 0 },
    { id: 'ready', label: 'Ready to list', test: r => r.listings.length > 0 && !r.paused },
    { id: 'paused', label: 'Paused', test: r => r.paused },
    { id: 'never', label: 'Never modelled', test: r => r.listings.length === 0 },
    { id: 'elsewhere', label: 'Selling elsewhere', test: r => r.sold28 > 0 },
    { id: 'all', label: 'All', test: () => true },
  ]
  const counts = Object.fromEntries(VIEWS.map(v => [v.id, rows.filter(v.test).length]))
  const sorter = {
    value: (a, b) => b.value - a.value || b.onHand - a.onHand,
    stock: (a, b) => b.onHand - a.onHand,
    margin: (a, b) => (b.best?.margin ?? -999) - (a.best?.margin ?? -999),
    sold: (a, b) => b.sold28 - a.sold28,
    name: (a, b) => a.si.name.localeCompare(b.si.name),
  }[sort]
  const list = smartFilter(rows.filter(VIEWS.find(v => v.id === view).test).sort(sorter), q,
    r => hay(r.si.name, r.d.sku, r.d.brand, r.d.supplierName, r.d.supplierSku, r.d.nickname, r.asin), { keepOrder: true })
  const stockValue = rows.reduce((t, r) => t + r.value, 0)
  const stockUnits = rows.reduce((t, r) => t + r.onHand, 0)

  const exportCsv = () => exportRowsToCsv(stampedName('not-listed'), list, [
    { header: 'Product', value: r => r.si.name }, { header: 'SKU', value: r => r.d.sku || '' }, { header: 'Brand', value: r => r.d.brand || '' },
    { header: 'Supplier', value: r => r.d.supplierName || '' }, { header: 'On hand', value: r => r.onHand }, { header: 'On order', value: r => r.onOrder },
    { header: 'Sold last 28 days', value: r => r.sold28 }, { header: 'Saved listings', value: r => r.listings.length },
    { header: 'Status', value: r => (r.paused ? 'Paused' : r.listings.length ? 'Ready to list' : 'Never modelled') },
    { header: 'Best margin', value: r => (r.best ? `${Math.round(r.best.margin * 10) / 10}%` : '') },
    ...(sees ? [{ header: 'Cost £', value: r => r.cost || '' }, { header: 'Stock value £', value: r => Math.round(r.value) }] : []),
  ])

  return (
    <div>
      <PageHeader eyebrow="Sourcing / not listed" title="Not Listed"
        description="Every product with no live listing: stock sitting on the shelf, listings modelled but never put live, and products nobody has worked on yet."
        actions={<button className="btn btn-secondary btn-sm" onClick={exportCsv} disabled={!list.length}><Icon name="download" size={14} /> Export</button>} />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <MetricCard label="Not listed" value={rows.length} sub="products" onClick={() => setView('all')} prominent />
        <MetricCard label="In stock, not listed" value={counts.stock} color={counts.stock ? 'text-loss' : 'text-ink'}
          sub={sees ? `${fmtUnits(stockUnits)} units · ${fmt(stockValue)}` : `${fmtUnits(stockUnits)} units`} onClick={() => setView('stock')} />
        <MetricCard label="Ready to list" value={counts.ready} color={counts.ready ? 'text-warn' : 'text-ink'} sub="saved, not live" onClick={() => setView('ready')} />
        <MetricCard label="Selling elsewhere" value={counts.elsewhere} sub="despatched in 28 days" onClick={() => setView('elsewhere')} />
      </div>

      <div className="filter-bar">
        <SegmentedControl value={view} onChange={setView} label="Show" items={VIEWS.map(v => ({ id: v.id, label: `${v.label} ${counts[v.id]}` }))} />
        <select className="input text-sm sm:w-[170px]" value={sort} onChange={e => setSort(e.target.value)} aria-label="Sort">
          {sees && <option value="value">Most stock value</option>}
          <option value="stock">Most units</option><option value="margin">Best margin</option><option value="sold">Most sold elsewhere</option><option value="name">Name</option>
        </select>
        <SearchInput value={q} onChange={e => setQ(e.target.value)} placeholder="Product, SKU, brand, supplier or ASIN" className="w-full sm:w-72 sm:ml-auto" />
      </div>

      {!list.length ? (
        <div className="surface"><EmptyState icon="check" title="Nothing here" sub={view === 'stock' ? 'Everything with stock has a live listing.' : 'Try another view.'} /></div>
      ) : (
        <div className="card p-0 overflow-hidden">
          {list.slice(0, 400).map(r => (
            <div key={r.si.id} className="px-4 py-3 border-b border-rule last:border-0 flex flex-col sm:flex-row sm:items-center gap-3">
              <button className="flex items-center gap-3 min-w-0 flex-1 text-left" onClick={() => onOpenProduct?.(r.si.id)}>
                <div className="w-12 h-12 rounded-[6px] border border-rule bg-white overflow-hidden shrink-0">
                  <ProductImage asin={r.asin} manualImage={r.image} alt={r.si.name} className="object-contain w-full h-full p-1" placeholderSize="text-lg" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-ink leading-snug">{r.si.name}</div>
                  <div className="text-xs text-ink/50">{[r.d.sku, r.d.brand, r.d.supplierName].filter(Boolean).join(' · ')}</div>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {r.paused ? <Flag tone="amber">Paused</Flag> : r.listings.length ? <Flag tone="amber">{r.listings.length} saved, not live</Flag> : <Flag tone="grey">Never modelled</Flag>}
                    {r.onHand > 0 && <Flag tone="red">{fmtUnits(r.onHand)} on the shelf{sees && r.value ? ` · ${fmt(r.value)}` : ''}</Flag>}
                    {r.onOrder > 0 && <Flag tone="blue">{fmtUnits(r.onOrder)} on order</Flag>}
                    {r.sold28 > 0 && <Flag tone="green">{fmtUnits(r.sold28)} sold in 28 days elsewhere</Flag>}
                    {r.best && <Flag tone={r.best.margin >= 15 ? 'green' : r.best.margin >= 0 ? 'amber' : 'red'}>Best margin {pct(r.best.margin)}</Flag>}
                  </div>
                </div>
              </button>
              <div className="flex gap-2 shrink-0">
                {r.best && <button className="btn btn-secondary btn-sm" onClick={() => onNavigate?.('saved', r.best.row.id)}><Icon name="bookmark" size={13} /> Open listing</button>}
                {onCreateListing && <button className="btn btn-primary btn-sm" onClick={() => onCreateListing(r.si)}><Icon name="calculator" size={13} /> {r.listings.length ? 'New listing' : 'Create listing'}</button>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
