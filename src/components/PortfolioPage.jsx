import React, { useState, useMemo } from 'react'
import { fmt, pct, fmtSigned, calcProduct, hasComponents } from '../lib/calc'
import { EmptyState, Icon, PageHeader, ProductImage, SearchInput } from './UI'
import { AmazonLink, SupplierLink, ProductLink } from './Links'
import { exportRowsToCsv, stampedName } from '../lib/csv'

/**
 * Groups the catalogue by brand or supplier, showing products and listings
 * as two distinct things rather than conflating them.
 *
 * Supplier and brand live on the product, so grouping walks from products
 * outward to the listings that use them. Unlinked listings fall back to their
 * own field so nothing disappears.
 */
export default function PortfolioPage({
  groupBy, title, icon, emptyHint, unlabelled,
  liveProducts, savedProducts, stockItems = [], settings, onNavigate,
  focusId,
}) {
  const [openGroup, setOpenGroup] = useState(null)
  // Arriving from a brand link: open that brand and bring it into view
  React.useEffect(() => {
    if (!focusId) return
    const name = decodeURIComponent(focusId)
    setOpenGroup(name)
    setTimeout(() => document.getElementById(`group-${name}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80)
  }, [focusId])
  const [tab, setTab] = useState('listings')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState('listings')

  const field = groupBy === 'supplierName' ? 'supplierName' : 'brand'
  const bySupplier = field === 'supplierName'

  const listings = useMemo(() => liveProducts
    .map(lp => {
      const saved = savedProducts.find(s => s.id === lp.saved_product_id)
      if (!saved) return null
      const p = saved.data || saved
      return { lp, saved, p, r: calcProduct(p, settings.carriers, settings.packaging, stockItems) }
    })
    .filter(Boolean), [liveProducts, savedProducts, stockItems, settings])

  const stockFor = (p) => {
    if (!hasComponents(p)) return []
    return p.components
      .map(c => ({ si: stockItems.find(s => s.id === c.stockItemId), qty: parseInt(c.qty) || 1 }))
      .filter(x => x.si)
  }

  const keyForStock = (si) => ((si.data || {})[field] || '').trim() || unlabelled
  const keyForListing = (p) => {
    const comps = stockFor(p)
    if (comps.length) {
      const k = (comps[0].si.data || {})[field]
      if (k && k.trim()) return k.trim()
    }
    return (p[field] || '').trim() || unlabelled
  }

  const groups = useMemo(() => {
    const map = new Map()
    const ensure = (k) => {
      if (!map.has(k)) map.set(k, { name: k, stock: [], listings: [] })
      return map.get(k)
    }
    stockItems.forEach(si => ensure(keyForStock(si)).stock.push(si))
    listings.forEach(l => ensure(keyForListing(l.p)).listings.push(l))

    return [...map.values()].map(g => {
      const items = g.listings
      return {
        ...g,
        avgMargin: items.length ? items.reduce((s, i) => s + i.r.margin, 0) / items.length : 0,
        avgProfit: items.length ? items.reduce((s, i) => s + i.r.netProfit, 0) / items.length : 0,
        lossMaking: items.filter(i => i.r.netProfit < 0).length,
        stockValue: g.stock.reduce((s, si) => s + (parseFloat(si.data?.costPrice) || 0), 0),
        bestMargin: items.length ? Math.max(...items.map(i => i.r.margin)) : 0,
        worstMargin: items.length ? Math.min(...items.map(i => i.r.margin)) : 0,
      }
    }).filter(g => g.stock.length || g.listings.length)
  }, [stockItems, listings, field, unlabelled])

  const filtered = search.trim()
    ? groups.filter(g => g.name.toLowerCase().includes(search.toLowerCase()))
    : groups

  const sorted = [...filtered].sort((a, b) => {
    switch (sort) {
      case 'listings':   return b.listings.length - a.listings.length
      case 'stock':      return b.stock.length - a.stock.length
      case 'marginHigh': return b.avgMargin - a.avgMargin
      case 'marginLow':  return a.avgMargin - b.avgMargin
      case 'nameAZ':     return a.name.localeCompare(b.name)
      default: return 0
    }
  })

  const label = title.slice(0, -1).toLowerCase()

  return (
    <div>
      <PageHeader
        eyebrow={`Catalogue / ${bySupplier ? 'sourcing' : 'portfolio'}`}
        title={title}
        description={bySupplier
          ? 'See supplier exposure, the products sourced from each partner and the live listings they support.'
          : 'See each brand as a portfolio: its stock inputs, live listings and commercial health in one place.'}
        meta={`${groups.length} ${groups.length === 1 ? label : title.toLowerCase()} · ${stockItems.length} product${stockItems.length !== 1 ? 's' : ''} · ${listings.length} live listing${listings.length !== 1 ? 's' : ''}`}
        actions={
          <button
            className="btn btn-secondary btn-sm"
            disabled={listings.length === 0}
            onClick={() => exportRowsToCsv(stampedName(title.toLowerCase()), listings, [
              { header: title.slice(0, -1), value: x => keyForListing(x.p) },
              { header: 'Listing', value: x => x.saved.name },
              { header: 'ASIN', value: x => x.p.asin || '' },
              { header: 'Products', value: x => stockFor(x.p).map(s => `${s.qty}x ${s.si.name}`).join(' + ') },
              { header: 'Status', value: x => x.lp.status },
              { header: 'Sell Price', value: x => x.r.sellPrice.toFixed(2) },
              { header: 'Cost Price', value: x => x.r.costPrice.toFixed(2) },
              { header: 'Net Profit', value: x => x.r.netProfit.toFixed(2) },
              { header: 'Margin %', value: x => x.r.margin.toFixed(1) },
            ])}
          ><Icon name="download" size={14} /> Export CSV</button>
        }
      />

      {groups.length === 0 ? (
        <div className="surface">
          <EmptyState icon={icon} title="Nothing to show yet" sub={emptyHint} />
        </div>
      ) : (
        <>
          <div className="filter-bar mb-4">
            <SearchInput value={search} onChange={e => setSearch(e.target.value)} placeholder={`Search ${title.toLowerCase()}…`} className="w-full sm:max-w-sm" />
            <select className="input text-sm sm:w-[210px]" value={sort} onChange={e => setSort(e.target.value)} aria-label="Sort">
              <option value="listings">Most listings</option>
              <option value="stock">Most products</option>
              <option value="marginHigh">Avg margin — high to low</option>
              <option value="marginLow">Avg margin — low to high</option>
              <option value="nameAZ">Name — A to Z</option>
            </select>
            {search && <button className="btn btn-secondary btn-sm" onClick={() => setSearch('')}>Clear</button>}
            <div className="text-xs text-ink/45 sm:ml-auto">{sorted.length} result{sorted.length !== 1 ? 's' : ''}</div>
          </div>

          <div className="space-y-3">
            {sorted.map(g => {
              const isOpen = openGroup === g.name
              return (
                <div key={g.name} id={`group-${g.name}`} className="card p-0 overflow-hidden">
                  <button
                    className="w-full text-left px-5 py-4 hover:bg-paper transition-colors"
                    onClick={() => setOpenGroup(isOpen ? null : g.name)}
                  >
                    <div className="flex items-center justify-between flex-wrap gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <Icon name={isOpen ? 'chevronDown' : 'chevronRight'} size={15} className="text-ink/35 flex-shrink-0" />
                        <div className="min-w-0">
                          <div className="font-semibold text-ink flex items-center gap-2 flex-wrap">
                            {g.name === unlabelled ? <span className="text-ink/45 italic">{unlabelled}</span> : g.name}
                            {g.lossMaking > 0 && (
                              <span className="pill pill-alert">
                                {g.lossMaking} loss making
                              </span>
                            )}
                          </div>
                          <div className="text-xs mt-0.5 flex gap-2 flex-wrap items-center">
                            <span className="text-royal-500 font-medium">{g.stock.length} product{g.stock.length !== 1 ? 's' : ''}</span>
                            <span className="text-ink/30">·</span>
                            <span className="text-gain font-medium">{g.listings.length} listing{g.listings.length !== 1 ? 's' : ''}</span>
                            {bySupplier && g.stockValue > 0 && (
                              <>
                                <span className="text-ink/30">·</span>
                                <span className="text-ink/45">{fmt(g.stockValue)} to buy one of each</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      {g.listings.length > 0 && (
                        <div className="flex gap-2 flex-wrap">
                          <div className="metric-card py-1.5 px-3" style={{ minWidth: 90 }}>
                            <div className="metric-label">Avg margin</div>
                            <div className={`metric-value text-sm ${g.avgMargin >= 0 ? 'text-gain' : 'text-loss'}`}>{pct(g.avgMargin)}</div>
                          </div>
                          <div className="metric-card py-1.5 px-3" style={{ minWidth: 90 }}>
                            <div className="metric-label">Avg profit</div>
                            <div className={`metric-value text-sm ${g.avgProfit >= 0 ? 'text-gain' : 'text-loss'}`}>{fmtSigned(g.avgProfit)}</div>
                          </div>
                          <div className="metric-card py-1.5 px-3" style={{ minWidth: 90 }}>
                            <div className="metric-label">Range</div>
                            <div className="metric-value text-sm text-ink/70">{g.worstMargin.toFixed(0)}–{g.bestMargin.toFixed(0)}%</div>
                          </div>
                        </div>
                      )}
                    </div>
                  </button>

                  {isOpen && (
                    <div className="border-t border-rule">
                      <div className="flex gap-1 px-4 pt-3">
                        <button
                          className={`px-3 py-1.5 rounded-[5px] text-xs font-medium transition-colors ${tab === 'listings' ? 'bg-royal-100 text-royal-700' : 'text-ink/45 hover:text-ink/70'}`}
                          onClick={() => setTab('listings')}
                        >Listings ({g.listings.length})</button>
                        <button
                          className={`px-3 py-1.5 rounded-[5px] text-xs font-medium transition-colors ${tab === 'stock' ? 'bg-royal-100 text-royal-700' : 'text-ink/45 hover:text-ink/70'}`}
                          onClick={() => setTab('stock')}
                        >Products ({g.stock.length})</button>
                      </div>

                      {tab === 'listings'
                        ? <ListingsTable rows={g.listings} stockFor={stockFor} onNavigate={onNavigate} />
                        : <StockTable rows={g.stock} listings={listings} stockFor={stockFor} onNavigate={onNavigate} />}
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

function ListingsTable({ rows, stockFor, onNavigate }) {
  if (!rows.length) return <div className="px-5 py-6 text-sm text-ink/45 text-center">No live listings here</div>
  return (
    <div className="overflow-x-auto mt-2">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-paper border-y border-rule">
            <th className="text-left px-5 py-2.5 text-xs font-semibold text-ink/45">Listing</th>
            <th className="text-left px-3 py-2.5 text-xs font-semibold text-ink/45">Made from</th>
            <th className="text-right px-3 py-2.5 text-xs font-semibold text-ink/45">Sell</th>
            <th className="text-right px-3 py-2.5 text-xs font-semibold text-ink/45">Profit</th>
            <th className="text-right px-3 py-2.5 text-xs font-semibold text-ink/45">Margin</th>
          </tr>
        </thead>
        <tbody>
          {[...rows].sort((a, b) => b.r.margin - a.r.margin).map(({ lp, saved, p, r }) => (
            <tr key={lp.id} className="border-b border-rule/60 hover:bg-royal-50/40 cursor-pointer" role="button" tabIndex={0} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); (() => onNavigate?.('live', saved.id))() } }} onClick={() => onNavigate?.('live', saved.id)}>
              <td className="px-5 py-2.5">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-[5px] border border-rule bg-white flex items-center justify-center flex-shrink-0 overflow-hidden">
                    <ProductImage asin={p.asin} manualImage={p.productImage} alt={saved.name}
                      className="object-contain w-full h-full p-0.5" placeholderSize="text-base" />
                  </div>
                  <div className="min-w-0">
                    <div className="font-medium text-ink truncate hover:text-royal-600" style={{ maxWidth: "min(100%, 260px)" }}>{saved.name}</div>
                    <div className="text-xs text-ink/45 flex gap-2">
                      <AmazonLink asin={p.asin} />
                      <span className={lp.status === 'live' ? 'text-gain' : 'text-warn'}>
                        {lp.status === 'live' ? 'Live' : 'Paused'}
                      </span>
                    </div>
                  </div>
                </div>
              </td>
              <td className="px-3 py-2.5">
                {stockFor(p).length ? (
                  <div className="flex flex-col gap-0.5">
                    {stockFor(p).map((s, i) => (
                      <button key={i}
                        className="text-xs text-left text-royal-500 hover:text-royal-700 hover:underline"
                        onClick={e => { e.stopPropagation(); onNavigate?.('stock', s.si.id) }}
                      >{s.qty}× {s.si.name}</button>
                    ))}
                  </div>
                ) : <span className="text-xs text-warn">not linked</span>}
              </td>
              <td className="px-3 py-2.5 text-right text-ink/70">{fmt(r.sellPrice)}</td>
              <td className={`px-3 py-2.5 text-right font-medium ${r.netProfit >= 0 ? 'text-gain' : 'text-loss'}`}>{fmtSigned(r.netProfit)}</td>
              <td className={`px-3 py-2.5 text-right font-medium ${r.margin >= 0 ? 'text-gain' : 'text-loss'}`}>{pct(r.margin)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function StockTable({ rows, listings, stockFor, onNavigate }) {
  if (!rows.length) return <div className="px-5 py-6 text-sm text-ink/45 text-center">No products here</div>
  const usedIn = (siId) => listings.filter(l => stockFor(l.p).some(s => s.si.id === siId))
  return (
    <div className="overflow-x-auto mt-2">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-paper border-y border-rule">
            <th className="text-left px-5 py-2.5 text-xs font-semibold text-ink/45">Product</th>
            <th className="text-left px-3 py-2.5 text-xs font-semibold text-ink/45">SKU</th>
            <th className="text-right px-3 py-2.5 text-xs font-semibold text-ink/45">Unit cost</th>
            <th className="text-right px-3 py-2.5 text-xs font-semibold text-ink/45">Weight</th>
            <th className="text-center px-3 py-2.5 text-xs font-semibold text-ink/45">Used in</th>
          </tr>
        </thead>
        <tbody>
          {[...rows].sort((a, b) => a.name.localeCompare(b.name)).map(si => {
            const d = si.data || {}
            const uses = usedIn(si.id)
            const firstAsin = uses[0]?.p?.asin || ''
            return (
              <tr key={si.id} className="border-b border-rule/60 hover:bg-royal-50/40 cursor-pointer" role="button" tabIndex={0} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); (() => onNavigate?.('stock', si.id))() } }} onClick={() => onNavigate?.('stock', si.id)}>
                <td className="px-5 py-2.5">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-[5px] border border-rule bg-white flex items-center justify-center flex-shrink-0 overflow-hidden">
                      <ProductImage asin={firstAsin} alt={si.name} className="object-contain w-full h-full p-0.5" placeholderSize="text-base" />
                    </div>
                    <div className="font-medium text-ink truncate hover:text-royal-600" style={{ maxWidth: "min(100%, 280px)" }}>{si.name}</div>
                  </div>
                </td>
                <td className="px-3 py-2.5 text-xs text-ink/45">{d.supplierSku || '—'}</td>
                <td className="px-3 py-2.5 text-right font-medium text-ink/80">{fmt(parseFloat(d.costPrice) || 0)}</td>
                <td className="px-3 py-2.5 text-right text-ink/70">{(parseFloat(d.weightKg) || 0).toFixed(3)}kg</td>
                <td className="px-3 py-2.5 text-center">
                  <span className={`pill ${uses.length ? 'pill-brand' : 'pill-quiet'}`}>
                    {uses.length} listing{uses.length !== 1 ? 's' : ''}
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
