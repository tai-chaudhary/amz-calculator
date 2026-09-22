import React, { useMemo, useState } from 'react'
import { calcProduct, fmt, fmtSigned, pct } from '../lib/calc'
import { readiness, timeline } from '../lib/readiness'
import { ListingConnections, AmazonLink } from './Links'
import {
  EmptyState, ResultRow, ProductImage, PageHeader, Icon, Drawer,
  SearchInput, StatusBadge, IconButton, Input,
} from './UI'
import { exportRowsToCsv, stampedName } from '../lib/csv'
import { SERVICE_LABELS } from '../lib/defaults'

const SORT_OPTIONS = [
  { value: 'latest', label: 'Latest saved' },
  { value: 'oldest', label: 'Oldest saved' },
  { value: 'margin_desc', label: 'Highest margin' },
  { value: 'margin_asc', label: 'Lowest margin' },
  { value: 'profit_desc', label: 'Highest profit' },
  { value: 'profit_asc', label: 'Lowest profit' },
  { value: 'price_desc', label: 'Highest price' },
  { value: 'price_asc', label: 'Lowest price' },
  { value: 'name_asc', label: 'Name A–Z' },
]

export default function SavedPage({
  savedProducts, stockItems = [], settings, focusId, liveProducts = [],
  onDelete, onLoad, onRename, onPushLive, onSendReview, onLoadActivity,
}) {
  const [detailProduct, setDetailProduct] = useState(null)
  const [sort, setSort] = useState('latest')
  const [search, setSearch] = useState('')
  const [view, setView] = useState('all')

  // Saved Listings is deliberately the pre-live workspace. Records remain in the
  // database for history, but once a listing has gone live it moves out of this view.
  const everLiveIds = useMemo(
    () => new Set(liveProducts.filter(lp => lp.status !== 'removed').map(lp => lp.saved_product_id)),
    [liveProducts]
  )
  const preLive = useMemo(() => savedProducts.filter(row => !everLiveIds.has(row.id)), [savedProducts, everLiveIds])

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    let filtered = preLive.filter(row => {
      const status = row.data?.reviewStatus || 'none'
      if (view === 'draft' && status !== 'none') return false
      if (view === 'review' && status !== 'review') return false
      if (view === 'approved' && status !== 'approved') return false
      if (!q) return true
      return [row.name, row.data?.brand, row.data?.asin, row.data?.supplierSku, row.data?.supplierName]
        .some(v => (v || '').toLowerCase().includes(q))
    })

    return [...filtered].sort((a, b) => {
      const ra = calcProduct(a.data, settings.carriers, settings.packaging, stockItems)
      const rb = calcProduct(b.data, settings.carriers, settings.packaging, stockItems)
      switch (sort) {
        case 'latest': return new Date(b.created_at) - new Date(a.created_at)
        case 'oldest': return new Date(a.created_at) - new Date(b.created_at)
        case 'margin_desc': return rb.margin - ra.margin
        case 'margin_asc': return ra.margin - rb.margin
        case 'profit_desc': return rb.netProfit - ra.netProfit
        case 'profit_asc': return ra.netProfit - rb.netProfit
        case 'price_desc': return (parseFloat(b.data.sellPrice) || 0) - (parseFloat(a.data.sellPrice) || 0)
        case 'price_asc': return (parseFloat(a.data.sellPrice) || 0) - (parseFloat(b.data.sellPrice) || 0)
        case 'name_asc': return a.name.localeCompare(b.name)
        default: return 0
      }
    })
  }, [preLive, search, view, sort, settings, stockItems])

  const reviewCount = preLive.filter(row => (row.data?.reviewStatus || 'none') === 'review').length
  const approvedCount = preLive.filter(row => row.data?.reviewStatus === 'approved').length
  const draftCount = preLive.length - reviewCount - approvedCount

  React.useEffect(() => {
    if (!focusId) return
    const match = preLive.find(row => row.id === focusId)
    if (match) setDetailProduct(match)
  }, [focusId, preLive])

  const exportCurrent = () => exportRowsToCsv(stampedName('saved-listings'), rows, [
    { header: 'Listing', value: row => row.name },
    { header: 'Brand', value: row => row.data?.brand || '' },
    { header: 'ASIN', value: row => row.data?.asin || '' },
    { header: 'Supplier', value: row => row.data?.supplierName || '' },
    { header: 'Supplier SKU', value: row => row.data?.supplierSku || '' },
    { header: 'Sell Price', value: row => calcProduct(row.data, settings.carriers, settings.packaging, stockItems).sellPrice.toFixed(2) },
    { header: 'Cost Price', value: row => calcProduct(row.data, settings.carriers, settings.packaging, stockItems).costPrice.toFixed(2) },
    { header: 'Net Profit', value: row => calcProduct(row.data, settings.carriers, settings.packaging, stockItems).netProfit.toFixed(2) },
    { header: 'Margin %', value: row => calcProduct(row.data, settings.carriers, settings.packaging, stockItems).margin.toFixed(1) },
    { header: 'Status', value: row => ({ review: 'In review', approved: 'Approved' })[row.data?.reviewStatus] || 'Draft' },
    { header: 'Saved', value: row => new Date(row.created_at).toLocaleDateString('en-GB') },
  ])

  return (
    <div className="page-shell">
      <PageHeader
        eyebrow="Listings / pre-live"
        title="Saved Listings"
        description="Calculated listings that have not gone live yet. Use this as the working area between modelling, review and launch."
        meta={<><span>{preLive.length} pre-live</span><span>{draftCount} draft</span><span>{reviewCount} in review</span></>}
        actions={(
          <button className="btn btn-secondary" disabled={!rows.length} onClick={exportCurrent}>
            <Icon name="download" size={15} /> Export CSV
          </button>
        )}
      >
        <div className="mt-6 tab-row">
          <button className={`tab ${view === 'all' ? 'tab-active' : ''}`} onClick={() => setView('all')}>All <span className="text-ink/35 ml-1">{preLive.length}</span></button>
          <button className={`tab ${view === 'draft' ? 'tab-active' : ''}`} onClick={() => setView('draft')}>Draft <span className="text-ink/35 ml-1">{draftCount}</span></button>
          <button className={`tab ${view === 'review' ? 'tab-active' : ''}`} onClick={() => setView('review')}>In review <span className="text-ink/35 ml-1">{reviewCount}</span></button>
          <button className={`tab ${view === 'approved' ? 'tab-active' : ''}`} onClick={() => setView('approved')}>Approved <span className="text-ink/35 ml-1">{approvedCount}</span></button>
        </div>
      </PageHeader>

      {preLive.length === 0 ? (
        <div className="surface">
          <EmptyState icon="bookmark" title="No saved listings" sub="New calculations will stay here until they are sent to review or pushed live." />
        </div>
      ) : (
        <>
          <div className="filter-bar mb-4">
            <SearchInput className="w-full sm:w-[340px]" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search listing, ASIN, brand or supplier…" />
            <div className="sm:ml-auto flex items-center gap-2">
              <span className="text-xs font-semibold text-ink/45">Sort</span>
              <select className="input text-xs min-w-[155px]" value={sort} onChange={e => setSort(e.target.value)}>
                {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>

          <div className="table-shell overflow-x-auto">
            <table className="w-full min-w-[980px] border-collapse">
              <thead className="table-head">
                <tr>
                  <th className="th text-left">Listing</th>
                  <th className="th text-left">Status</th>
                  <th className="th text-right">Sell</th>
                  <th className="th text-right">Cost</th>
                  <th className="th text-right">Profit</th>
                  <th className="th text-right">Margin</th>
                  <th className="th text-left">Supplier</th>
                  <th className="th text-left">Saved</th>
                  <th className="th w-[82px]">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => {
                  const p = row.data || {}
                  const r = calcProduct(p, settings.carriers, settings.packaging, stockItems)
                  const review = (p.reviewStatus || 'none') === 'review'
                  const weightCheck = parseInt(p.bundleQty) > 1 && !p.weightPerItem && !p.weightOverride
                  return (
                    <tr key={row.id} className="table-row cursor-pointer" role="button" tabIndex={0} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); (() => setDetailProduct(row))() } }} onClick={() => setDetailProduct(row)}>
                      <td className="td">
                        <div className="flex items-center gap-3 min-w-[280px]">
                          <div className="w-10 h-10 border border-rule bg-white rounded-[4px] overflow-hidden flex-shrink-0">
                            <ProductImage asin={p.asin} manualImage={p.productImage} alt={row.name} className="object-contain w-full h-full p-1" placeholderSize="text-xl" />
                          </div>
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-ink truncate max-w-[280px]">{row.name}</div>
                            <div className="text-xs text-ink/42 mt-0.5 flex items-center gap-1.5">
                              {p.brand && <span>{p.brand}</span>}
                              {p.brand && p.asin && <span>·</span>}
                              {p.asin && <span>{p.asin}</span>}
                              {parseInt(p.bundleQty) > 1 && <><span>·</span><span>{p.bundleQty} pack</span></>}
                              <AmazonLink asin={p.asin} />
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="td">
                        <div className="flex flex-col items-start gap-1.5">
                          <StatusBadge tone={p.reviewStatus === 'approved' ? 'success' : review ? 'brand' : 'quiet'} dot>{p.reviewStatus === 'approved' ? 'Approved' : review ? 'In review' : 'Draft'}</StatusBadge>
                          {weightCheck && <StatusBadge tone="alert">Check weight</StatusBadge>}
                          {(() => { const rd = readiness(p, r); return (
                            <span className={`text-xs ${rd.done >= 4 ? 'text-gain' : 'text-ink/50'}`} title={rd.steps.filter(x => !x.done).map(x => x.label).join(', ')}>
                              {rd.done} of {rd.total} ready
                            </span>) })()}
                        </div>
                      </td>
                      <td className="td text-right font-medium">{fmt(r.sellPrice)}</td>
                      <td className="td text-right text-ink/60">{fmt(r.costPrice)}</td>
                      <td className={`td text-right font-semibold ${r.incomplete ? 'text-ink/40' : r.netProfit >= 0 ? 'text-gain' : 'text-loss'}`}>{r.incomplete ? '—' : fmtSigned(r.netProfit)}</td>
                      <td className={`td text-right font-semibold ${r.incomplete ? 'text-warn' : r.margin >= 10 ? 'text-ink' : 'text-loss'}`} title={r.incomplete ? r.issues.map(i => i.text).join('; ') : undefined}>{r.incomplete ? 'Incomplete' : pct(r.margin)}</td>
                      <td className="td text-ink/60 max-w-[170px] truncate">{p.supplierName || '—'}</td>
                      <td className="td text-ink/45 text-xs whitespace-nowrap">{new Date(row.created_at).toLocaleDateString('en-GB')}</td>
                      <td className="td" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          <IconButton icon="edit" label="Edit in calculator" onClick={() => onLoad(row)} />
                          <IconButton icon="chevronRight" label="Open details" onClick={() => setDetailProduct(row)} />
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {!rows.length && <EmptyState icon="search" title="No listings match" sub="Change your search or switch to another saved-listing view." />}
          </div>
        </>
      )}

      {detailProduct && (savedProducts.find(r => r.id === detailProduct.id) || detailProduct) && (
        <ListingDrawer
          onLoadActivity={onLoadActivity}
          row={savedProducts.find(r => r.id === detailProduct.id) || detailProduct}
          isLive={liveProducts.some(lp => lp.saved_product_id === detailProduct.id && lp.status !== 'removed')}
          settings={settings}
          stockItems={stockItems}
          onClose={() => setDetailProduct(null)}
          onLoad={() => onLoad(savedProducts.find(r => r.id === detailProduct.id) || detailProduct)}
          onRename={onRename}
          onDelete={onDelete}
          onPushLive={onPushLive}
          onSendReview={onSendReview}
        />
      )}
    </div>
  )
}

function ListingDrawer({ row, isLive = false, settings, stockItems, onClose, onLoad, onRename, onDelete, onPushLive, onSendReview, onLoadActivity }) {
  const [busy, setBusy] = useState(null)
  const [activity, setActivity] = useState([])
  React.useEffect(() => {
    let live = true
    onLoadActivity?.({ entityId: row.id, limit: 100 }).then(r => live && setActivity(r || []))
    return () => { live = false }
  }, [row.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const p = row.data || {}
  const r = calcProduct(p, settings.carriers, settings.packaging, stockItems)
  const [units, setUnits] = useState(p.monthlyVolume || '')
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(row.name)
  React.useEffect(() => setName(row.name), [row.name])
  const carrier = p.carrierId ? settings.carriers[p.carrierId] : null
  const carrierCat = carrier?.categories?.find(c => c.id === p.carrierCatId)
  const packagingItem = p.packagingId ? settings.packaging.find(x => x.id === p.packagingId) : null
  const review = (p.reviewStatus || 'none') === 'review'
  const volume = parseFloat(units) || 0

  const saveRename = () => {
    const next = name.trim()
    if (next && next !== row.name) onRename(row.id, next)
    setRenaming(false)
  }

  const footer = (
    <div className="flex gap-2 flex-wrap">
      <button className="btn btn-primary flex-1 min-w-[170px]" onClick={onLoad}><Icon name="edit" size={15} /> Edit in calculator</button>
      {isLive ? (
        <button className="btn btn-secondary" disabled><Icon name="live" size={15} /> Live</button>
      ) : p.reviewStatus === 'approved' ? (
        <button className="btn btn-secondary" disabled><Icon name="check" size={15} /> Approved{p.reviewedByName ? ` by ${p.reviewedByName}` : ''}</button>
      ) : review ? (
        <button className="btn btn-secondary" disabled title={p.submittedAt ? `Sent ${new Date(p.submittedAt).toLocaleString('en-GB')}` : ''}>
          <Icon name="check" size={15} /> Sent for review{p.submittedByName ? ` by ${p.submittedByName}` : ''}
        </button>
      ) : (
        <button className="btn btn-secondary" disabled={busy === 'review'}
          onClick={async () => { setBusy('review'); await onSendReview?.(row.id, name.trim() || row.name); setBusy(null) }}>
          <Icon name="review" size={15} /> {busy === 'review' ? 'Sending…' : 'Send to review'}
        </button>
      )}
      {!isLive && (
        <button className="btn btn-success" disabled={busy === 'live'}
          onClick={async () => { setBusy('live'); await onPushLive?.(row.id, name.trim() || row.name); setBusy(null) }}>
          <Icon name="send" size={15} /> {busy === 'live' ? 'Going live…' : p.reviewStatus === 'approved' ? 'Go live' : 'Go live without approval'}
        </button>
      )}
    </div>
  )

  return (
    <Drawer title={name || row.name} description="Saved listing · pre-live workspace" onClose={onClose} footer={footer}>
      <ListingConnections p={p} stockItems={stockItems} className="mb-4" />
      <div className="flex items-start gap-4 pb-5 border-b border-rule">
        <div className="w-20 h-20 bg-white border border-rule rounded-[5px] overflow-hidden flex-shrink-0">
          <ProductImage asin={p.asin} manualImage={p.productImage} alt={row.name} className="object-contain w-full h-full p-2" placeholderSize="text-3xl" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-2">
            <StatusBadge tone={p.reviewStatus === 'approved' ? 'success' : review ? 'brand' : 'quiet'} dot>{p.reviewStatus === 'approved' ? 'Approved' : review ? 'In review' : 'Draft'}</StatusBadge>
            {parseInt(p.bundleQty) > 1 && <StatusBadge tone="brand">Bundle ×{p.bundleQty}</StatusBadge>}
          </div>
          {renaming ? (
            <div className="flex gap-2">
              <input className="input" value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') saveRename(); if (e.key === 'Escape') setRenaming(false) }} autoFocus />
              <button className="btn btn-primary btn-sm" onClick={saveRename}>Save</button>
            </div>
          ) : (
            <button className="text-xs text-royal-600 font-semibold flex items-center gap-1.5" onClick={() => setRenaming(true)}><Icon name="edit" size={13} /> Rename listing</button>
          )}
        </div>
      </div>

      {(() => {
        const rd = readiness(p, r)
        // Recorded events, plus lifecycle stamps from before the log existed
        const recorded = activity.map(e => ({ at: e.at, label: e.action, by: e.user_name, note: e.detail }))
        const tl = [...timeline(p, row).filter(t => !recorded.some(r => r.label === t.label &&
            Math.abs(new Date(r.at) - new Date(t.at)) < 120000)), ...recorded]
          .sort((a, b) => new Date(a.at) - new Date(b.at))
        return (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 my-5">
            <div className="card py-3">
              <div className="text-sm font-semibold text-ink mb-2">{rd.done} of {rd.total} ready</div>
              <ul className="space-y-1.5">
                {rd.steps.map(st => (
                  <li key={st.key} className="flex items-start gap-2 text-sm">
                    <span className={`mt-0.5 w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 ${st.done ? 'bg-gain text-white' : 'border border-ink/25'}`}>
                      {st.done && <Icon name="check" size={10} />}
                    </span>
                    <span>
                      <span className={st.done ? 'text-ink' : 'text-ink/60'}>{st.label}</span>
                      {!st.done && <span className="block text-xs text-ink/45">{st.hint}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="card py-3">
              <div className="text-sm font-semibold text-ink mb-2">History</div>
              {tl.length === 0 ? <div className="text-sm text-ink/50">No history recorded.</div> : (
                <ol className="relative border-l border-rule ml-1.5 space-y-2.5">
                  {tl.map((e, i) => (
                    <li key={i} className="pl-3">
                      <span className="absolute -left-[5px] w-2.5 h-2.5 rounded-full bg-royal-400 mt-1.5" />
                      <div className="text-sm text-ink">{e.label}{e.by ? <span className="text-ink/55"> by {e.by}</span> : ''}</div>
                      <div className="text-xs text-ink/45">{new Date(e.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
                      {e.note && <div className={`text-xs mt-0.5 ${e.label === 'Sent back' ? 'text-loss' : 'text-ink/55'}`}>{e.label === 'Sent back' ? `"${e.note}"` : e.note}</div>}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        )
      })()}

      <div className="grid grid-cols-2 gap-3 my-5">
        <div className="metric-card"><div className="metric-label">Net profit</div><div className={`figure text-[25px] ${r.netProfit >= 0 ? 'text-gain' : 'text-loss'}`}>{fmtSigned(r.netProfit)}</div></div>
        <div className="metric-card"><div className="metric-label">Margin</div><div className="figure text-[25px]">{pct(r.margin)}</div></div>
        <div className="metric-card"><div className="metric-label">Break-even</div><div className="metric-value">{fmt(r.breakEven)}</div></div>
        <div className="metric-card"><div className="metric-label">VAT / unit</div><div className="metric-value text-royal-600">{fmt(r.vatAmount)}</div></div>
      </div>

      <div className="mb-5">
        <div className="section-kicker mb-2">Product</div>
        {p.brand && <ResultRow label="Brand" value={p.brand} />}
        {p.asin && <ResultRow label="ASIN" value={p.asin} />}
        {p.supplierName && <ResultRow label="Supplier" value={p.supplierName} />}
        {p.supplierSku && <ResultRow label="Supplier SKU" value={p.supplierSku} />}
        {p.productUrl && <div className="result-row"><span className="text-ink/55">Amazon listing</span><a href={p.productUrl} target="_blank" rel="noopener noreferrer" className="text-royal-600 text-xs font-semibold inline-flex items-center gap-1">Open <Icon name="external" size={12} /></a></div>}
      </div>

      <div className="mb-5">
        <div className="section-kicker mb-2">Commercial model</div>
        <ResultRow label="Sell price" value={fmt(r.sellPrice)} />
        <ResultRow label="Product cost" value={fmt(r.costPrice)} />
        <ResultRow label={`Amazon fee (${p.refFee || 0}%)`} value={`-${fmt(r.referralFee)}`} valueClass="text-loss" />
        <ResultRow label="Shipping" value={`-${fmt(r.shippingCost)}`} valueClass="text-loss" />
        <ResultRow label="Packaging" value={`-${fmt(r.packCost)}`} valueClass="text-loss" />
        <ResultRow label="Advertising" value={`-${fmt(r.adCost)}`} valueClass="text-loss" />
      </div>

      <div className="mb-5">
        <div className="section-kicker mb-2">Fulfilment</div>
        <ResultRow label="Weight" value={`${parseFloat(p.weightKg) || 0} kg`} />
        <ResultRow label="Service" value={SERVICE_LABELS[p.serviceLevel] || p.serviceLevel || '—'} />
        <ResultRow label="Carrier" value={carrier?.name || '—'} />
        <ResultRow label="Weight category" value={carrierCat?.name || '—'} />
        <ResultRow label="Packaging" value={packagingItem ? `${packagingItem.name} (${fmt(packagingItem.cost)})` : '—'} />
      </div>

      <div className="surface-sky p-4 mb-5">
        <div className="section-kicker mb-2">Volume scenario</div>
        <Input label="Units / month" type="number" value={units} onChange={e => setUnits(e.target.value)} placeholder="e.g. 250" />
        {volume > 0 && (
          <div className="grid grid-cols-3 gap-3 mt-4">
            <div><div className="metric-label">Profit</div><div className={`text-sm font-semibold ${r.netProfit * volume >= 0 ? 'text-gain' : 'text-loss'}`}>{fmtSigned(r.netProfit * volume)}</div></div>
            <div><div className="metric-label">Revenue</div><div className="text-sm font-semibold">{fmt(r.sellPrice * volume)}</div></div>
            <div><div className="metric-label">VAT</div><div className="text-sm font-semibold text-royal-600">{fmt(r.vatAmount * volume)}</div></div>
          </div>
        )}
      </div>

      <button className="text-xs text-loss font-semibold inline-flex items-center gap-1.5" onClick={() => { if (window.confirm(`Delete “${name || row.name}”?`)) { onDelete(row.id); onClose() } }}>
        <Icon name="trash" size={13} /> Delete saved listing
      </button>
    </Drawer>
  )
}
