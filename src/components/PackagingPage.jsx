import React, { useState, useMemo } from 'react'
import { calcProduct, fmt, pct } from '../lib/calc'
import { exportRowsToCsv, stampedName } from '../lib/csv'
import { PageHeader, Icon, StatusBadge, SearchInput, EmptyState, Modal } from './UI'

const NONE = '__none__'

/**
 * Listings by the packaging they ship in. Laid out like Products — filter bar,
 * table, exports in the header — because it answers the same kind of question.
 *
 * Packaging belongs to a listing, not a product: the same product goes out in
 * different packaging depending on how it's bundled, so each row shows the
 * products behind the listing.
 */
export default function PackagingPage({
  savedProducts, liveProducts, stockItems, settings, me, focusId, onNavigate, onBulkPackaging,
}) {
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState(focusId || '')
  const [statusFilter, setStatusFilter] = useState('')
  const [sort, setSort] = useState('name')
  const [picked, setPicked] = useState(new Set())
  const [moving, setMoving] = useState(false)

  const packaging = settings?.packaging || []
  const nameOf = (id) => (id === NONE ? 'No packaging set' : packaging.find(p => p.id === id)?.name || 'Unknown packaging')
  const costOf = (id) => (id === NONE ? 0 : parseFloat(packaging.find(p => p.id === id)?.cost) || 0)
  const weightOf = (id) => (id === NONE ? 0 : parseFloat(packaging.find(p => p.id === id)?.weightKg) || 0)

  const rows = useMemo(() => savedProducts
    .filter(r => !r.data?.archived)
    .map(r => {
      const p = r.data || {}
      const live = liveProducts.some(lp => lp.saved_product_id === r.id && lp.status === 'live')
      return {
        id: r.id, name: r.name, p, live,
        packagingId: p.packagingId || NONE,
        calc: calcProduct(p, settings?.carriers, packaging, stockItems),
        products: (p.components || [])
          .map(c => ({ qty: parseInt(c.qty) || 0, si: stockItems.find(s => s.id === c.stockItemId) }))
          .filter(x => x.si),
        volume: parseInt(p.monthlyVolume) || 0,
      }
    }), [savedProducts, liveProducts, stockItems, settings, packaging])

  const counts = useMemo(() => {
    const m = new Map()
    rows.forEach(r => m.set(r.packagingId, (m.get(r.packagingId) || 0) + 1))
    return m
  }, [rows])

  const filtered = rows.filter(r => {
    if (typeFilter && r.packagingId !== typeFilter) return false
    if (statusFilter === 'live' && !r.live) return false
    if (statusFilter === 'saved' && r.live) return false
    if (search.trim()) {
      const q = search.toLowerCase()
      const hit = r.name.toLowerCase().includes(q) ||
        nameOf(r.packagingId).toLowerCase().includes(q) ||
        r.products.some(x => x.si.name.toLowerCase().includes(q))
      if (!hit) return false
    }
    return true
  })

  const sorted = [...filtered].sort((a, b) => {
    switch (sort) {
      case 'packaging': return nameOf(a.packagingId).localeCompare(nameOf(b.packagingId)) || a.name.localeCompare(b.name)
      case 'costHigh': return costOf(b.packagingId) - costOf(a.packagingId)
      case 'marginLow': return (a.calc.incomplete ? 9 : a.calc.margin) - (b.calc.incomplete ? 9 : b.calc.margin)
      case 'volumeHigh': return b.volume - a.volume
      default: return a.name.localeCompare(b.name)
    }
  })

  const unset = counts.get(NONE) || 0
  const monthlyCost = rows.reduce((s, r) => s + costOf(r.packagingId) * r.volume, 0)
  const shownMonthly = sorted.reduce((s, r) => s + costOf(r.packagingId) * r.volume, 0)
  const filtering = !!(search || typeFilter || statusFilter)

  const exportCurrent = () => exportRowsToCsv(
    stampedName(typeFilter ? `packaging-${nameOf(typeFilter).toLowerCase().replace(/[^a-z0-9]+/g, '-')}` : 'listings-by-packaging'),
    sorted, [
      { header: 'Listing', value: x => x.name },
      { header: 'ASIN', value: x => x.p.asin || '' },
      { header: 'Status', value: x => (x.live ? 'Live' : 'Saved') },
      { header: 'Packaging', value: x => nameOf(x.packagingId) },
      { header: 'Packaging Cost', value: x => costOf(x.packagingId).toFixed(2) },
      { header: 'Packaging Weight KG', value: x => weightOf(x.packagingId).toFixed(3) },
      { header: 'Products', value: x => x.products.map(p => `${p.qty} x ${p.si.name}`).join('; ') },
      { header: 'Items In Listing', value: x => x.calc.units },
      { header: 'Sell Price', value: x => (parseFloat(x.p.sellPrice) || 0).toFixed(2) },
      { header: 'Product Cost', value: x => x.calc.costPrice.toFixed(2) },
      { header: 'Shipping', value: x => x.calc.shippingCost.toFixed(2) },
      { header: 'Net Profit', value: x => (x.calc.incomplete ? '' : x.calc.netProfit.toFixed(2)) },
      { header: 'Margin %', value: x => (x.calc.incomplete ? '' : (x.calc.margin * 100).toFixed(1)) },
      { header: 'Monthly Volume', value: x => x.volume || '' },
      { header: 'Monthly Packaging Cost', value: x => (costOf(x.packagingId) * x.volume).toFixed(2) },
      { header: 'Listing ID', value: x => x.id },
    ])

  const toggle = (id) => setPicked(s => {
    const next = new Set(s)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })
  const allShownPicked = sorted.length > 0 && sorted.every(r => picked.has(r.id))

  return (
    <div>
      <PageHeader
        eyebrow="Optimise / packaging"
        title="Packaging"
        description="Which packaging each listing ships in, what it adds to the parcel, and changing it for several listings at once."
        meta={`${packaging.length} type${packaging.length !== 1 ? 's' : ''} · ${rows.length} listing${rows.length !== 1 ? 's' : ''}${unset ? ` · ${unset} with none set` : ''}`}
        actions={
          <>
            <button className="btn btn-secondary btn-sm" disabled={sorted.length === 0} onClick={exportCurrent}
              title={filtering ? 'Just the listings shown' : 'Every listing with its packaging'}>
              <Icon name="download" size={14} /> {filtering ? 'Export this view' : 'Export CSV'}
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => onNavigate?.('settings')}
              title="Packaging types, costs and weights live in Cost Settings">
              <Icon name="settings" size={14} /> Edit types
            </button>
          </>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Metric label="Packaging types in use" value={[...counts.keys()].filter(k => k !== NONE).length} />
        <Metric label="Listings" value={rows.length} sub={`${rows.filter(r => r.live).length} live`} />
        <Metric label="No packaging set" value={unset} tone={unset ? 'text-warn' : ''}
          sub={unset ? 'margins overstated' : 'all set'}
          onClick={unset ? () => { setTypeFilter(NONE); setStatusFilter('') } : undefined} />
        <Metric label="Packaging a month" value={fmt(monthlyCost)} sub="at current volumes" />
      </div>

      {rows.length === 0 ? (
        <div className="surface"><EmptyState icon="box" title="No listings yet" /></div>
      ) : (
        <>
          <div className="filter-bar mb-4">
            <SearchInput value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Listing, product or packaging…" className="flex-1 min-w-[200px]" />
            <select className="input text-sm sm:w-[215px]" value={typeFilter} onChange={e => setTypeFilter(e.target.value)} aria-label="Packaging filter">
              <option value="">All packaging</option>
              {packaging.map(p => <option key={p.id} value={p.id}>{p.name} ({counts.get(p.id) || 0})</option>)}
              {unset > 0 && <option value={NONE}>No packaging set ({unset})</option>}
            </select>
            <select className="input text-sm sm:w-[140px]" value={statusFilter} onChange={e => setStatusFilter(e.target.value)} aria-label="Status filter">
              <option value="">All listings</option>
              <option value="live">Live only</option>
              <option value="saved">Not live</option>
            </select>
            <select className="input text-sm sm:w-[185px]" value={sort} onChange={e => setSort(e.target.value)} aria-label="Sort listings">
              <option value="name">Listing — A to Z</option>
              <option value="packaging">Packaging type</option>
              <option value="costHigh">Packaging cost — high first</option>
              <option value="marginLow">Margin — low first</option>
              <option value="volumeHigh">Volume — high first</option>
            </select>
            {filtering && (
              <button className="btn btn-secondary btn-sm" onClick={() => { setSearch(''); setTypeFilter(''); setStatusFilter('') }}>Clear</button>
            )}
            <div className="text-xs text-ink/45 sm:ml-auto">
              {sorted.length} of {rows.length}{shownMonthly > 0 ? ` · ${fmt(shownMonthly)} a month` : ''}
            </div>
          </div>

          {picked.size > 0 && (
            <div className="card mb-4 border-royal-200 bg-royal-50 flex items-center justify-between gap-3 flex-wrap">
              <div className="text-sm text-ink">
                <b>{picked.size}</b> selected
                <button className="link-chip ml-2" onClick={() => setPicked(new Set())}>Clear selection</button>
              </div>
              <button className="btn btn-primary btn-sm" onClick={() => setMoving(true)}>
                <Icon name="edit" size={14} /> Change packaging
              </button>
            </div>
          )}

          <div className="card p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-rule bg-paper">
                    <th className="px-4 py-3 w-9">
                      <input type="checkbox" className="w-4 h-4 accent-royal-500" checked={allShownPicked}
                        aria-label="Select all shown"
                        onChange={() => setPicked(allShownPicked ? new Set() : new Set(sorted.map(r => r.id)))} />
                    </th>
                    <th className="text-left px-2 py-3 text-xs font-semibold text-ink/45">Listing</th>
                    <th className="text-left px-3 py-3 text-xs font-semibold text-ink/45">Packaging</th>
                    <th className="text-right px-3 py-3 text-xs font-semibold text-ink/45">Each</th>
                    <th className="text-right px-3 py-3 text-xs font-semibold text-ink/45">Margin</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-ink/45">A month</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map(r => (
                    <tr key={r.id} className={`border-b border-rule/60 hover:bg-paper transition-colors ${picked.has(r.id) ? 'bg-royal-50/60' : ''}`}>
                      <td className="px-4 py-3">
                        <input type="checkbox" className="w-4 h-4 accent-royal-500" checked={picked.has(r.id)}
                          aria-label={`Select ${r.name}`} onChange={() => toggle(r.id)} />
                      </td>
                      <td className="px-2 py-3">
                        <div className="flex items-center gap-2 flex-wrap">
                          <button className="font-medium text-ink hover:text-royal-600 text-left"
                            onClick={() => onNavigate?.(r.live ? 'live' : 'saved', r.id)}>{r.name}</button>
                          {r.live && <StatusBadge tone="live">Live</StatusBadge>}
                        </div>
                        <div className="text-xs text-ink/50 mt-0.5 truncate max-w-[420px]">
                          {r.products.length
                            ? r.products.map(x => `${x.qty} × ${x.si.name}`).join(' · ')
                            : 'not built from products'}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        {r.packagingId === NONE
                          ? <StatusBadge tone="alert">None set</StatusBadge>
                          : <span className="text-ink/80">{nameOf(r.packagingId)}</span>}
                        {r.packagingId !== NONE && (
                          <div className="text-xs text-ink/45 mt-0.5">{weightOf(r.packagingId).toFixed(3)}kg</div>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right text-ink/80">{fmt(costOf(r.packagingId))}</td>
                      <td className={`px-3 py-3 text-right ${r.calc.incomplete ? 'text-ink/35' : r.calc.margin < 0 ? 'text-loss' : 'text-ink'}`}>
                        {r.calc.incomplete ? '—' : pct(r.calc.margin)}
                      </td>
                      <td className="px-4 py-3 text-right text-ink/70">
                        {r.volume ? fmt(costOf(r.packagingId) * r.volume) : <span className="text-ink/30">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {sorted.length === 0 && <EmptyState icon="box" title="Nothing matches those filters" />}
          </div>
        </>
      )}

      {moving && (
        <ChangePackaging
          items={rows.filter(r => picked.has(r.id))}
          packaging={packaging} settings={settings} stockItems={stockItems} nameOf={nameOf}
          onClose={() => setMoving(false)}
          onConfirm={async (toId) => {
            await onBulkPackaging([...picked], toId)
            setMoving(false); setPicked(new Set())
          }} />
      )}
    </div>
  )
}

function Metric({ label, value, sub, tone = '', onClick }) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag className={`metric-card text-left ${onClick ? 'hover:border-royal-300 transition-colors' : ''}`} onClick={onClick}>
      <div className="metric-label">{label}</div>
      <div className={`metric-value text-xl ${tone}`}>{value}</div>
      {sub && <div className="text-xs text-ink/45 mt-0.5">{sub}</div>}
    </Tag>
  )
}

/** Choosing the new packaging, with what it does to margins before committing. */
function ChangePackaging({ items, packaging, settings, stockItems, nameOf, onClose, onConfirm }) {
  const [toId, setToId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const from = [...new Set(items.map(i => i.packagingId))]

  const effect = useMemo(() => {
    if (!toId) return null
    let better = 0, worse = 0, monthly = 0, tipped = 0
    for (const l of items) {
      const after = calcProduct({ ...l.p, packagingId: toId }, settings?.carriers, packaging, stockItems)
      if (l.calc.incomplete || after.incomplete) continue
      const diff = after.netProfit - l.calc.netProfit
      if (diff > 0.001) better++
      if (diff < -0.001) worse++
      if (l.calc.netProfit > 0 && after.netProfit <= 0) tipped++
      monthly += diff * l.volume
    }
    return { better, worse, monthly, tipped }
  }, [items, toId, settings, packaging, stockItems])

  return (
    <Modal title={`Change packaging on ${items.length} listing${items.length !== 1 ? 's' : ''}`}
      description={from.length === 1 ? `Currently ${nameOf(from[0])}` : `Currently ${from.length} different types`}
      onClose={onClose} maxWidth="max-w-lg">
      <div className="space-y-3">
        <div>
          <label className="label" htmlFor="pk-to">Change to</label>
          <select id="pk-to" className="input" value={toId} onChange={e => setToId(e.target.value)}>
            <option value="">Choose packaging…</option>
            {packaging.map(p => (
              <option key={p.id} value={p.id}>{p.name} — {fmt(parseFloat(p.cost) || 0)}, {(parseFloat(p.weightKg) || 0).toFixed(3)}kg</option>
            ))}
          </select>
        </div>

        {effect && (
          <div className="card">
            <div className="text-sm font-semibold text-ink mb-2">What this changes</div>
            <div className="text-sm text-ink/70 space-y-1">
              <div>{effect.better} better off, {effect.worse} worse off</div>
              {effect.monthly !== 0 && (
                <div className={effect.monthly >= 0 ? 'text-gain' : 'text-loss'}>
                  About {fmt(Math.abs(effect.monthly))} a month {effect.monthly >= 0 ? 'better' : 'worse'} at current volumes
                </div>
              )}
              {effect.tipped > 0 && (
                <div className="text-loss">{effect.tipped} listing{effect.tipped !== 1 ? 's' : ''} would stop making a profit.</div>
              )}
              {items.some(l => l.live) && (
                <div className="text-xs text-ink/55 pt-1">{items.filter(l => l.live).length} of these are live.</div>
              )}
            </div>
          </div>
        )}

        {error && <div className="text-sm text-loss">{error}</div>}
        <div className="flex gap-2 pt-1">
          <button className="btn btn-secondary flex-1" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn btn-primary flex-1" disabled={busy || !toId}
            onClick={async () => {
              setBusy(true); setError('')
              try { await onConfirm(toId) } catch (e) { setError(e?.message || 'Could not change them'); setBusy(false) }
            }}>
            {busy ? 'Changing…' : `Change ${items.length}`}
          </button>
        </div>
      </div>
    </Modal>
  )
}
