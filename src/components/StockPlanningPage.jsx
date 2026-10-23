import React, { useState, useEffect, useMemo } from 'react'
import { PageHeader, Icon, SearchInput, EmptyState, MetricCard, Flag, CoverFlag, Spinner, SegmentedControl } from './UI'
import { stockState, fmtUnits, REORDER_DAYS } from '../lib/inventory'
import { loadInventoryValue } from '../lib/db'
import { smartFilter, hay } from '../lib/match'
import { exportRowsToCsv, stampedName } from '../lib/csv'

/**
 * Stock planning (Oct 2026): what to order today, what's suddenly selling faster, how old the stock on the
 * shelf is, what isn't selling, and where cash is tied up in too much stock.
 *
 * Reorder at 25 days of cover (on the shelf + on order), or the lead time + a week if that's longer.
 * A spike — the last 2 selling days each 40%+ over normal — uses the faster rate, so warnings come early.
 * Age is worked out first in, first out: what's on the shelf is the most recent deliveries.
 */

const money = (v) => (v == null ? '—' : `£${Number(v).toLocaleString('en-GB', { maximumFractionDigits: 0 })}`)
const daysSince = (iso) => (iso ? Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 864e5)) : null)
const BANDS = [
  { id: 'b30', label: '0–30 days', test: d => d <= 30 },
  { id: 'b60', label: '31–60 days', test: d => d > 30 && d <= 60 },
  { id: 'b90', label: '61–90 days', test: d => d > 60 && d <= 90 },
  { id: 'b90p', label: '90+ days', test: d => d > 90 },
]

/** What's on the shelf, by how long it's been there: newest deliveries first, the rest is the oldest. */
export function stockAge(p) {
  let left = Math.max(0, Number(p.on_hand) || 0)
  const layers = []
  for (const x of p.ins || []) {
    if (left <= 0) break
    const take = Math.min(left, Number(x.qty) || 0)
    if (take > 0) { layers.push({ qty: take, days: daysSince(x.at), at: x.at, opening: x.kind === 'opening' }); left -= take }
  }
  if (left > 0) layers.push({ qty: left, days: layers.length ? layers[layers.length - 1].days : null, unknown: true })
  const known = layers.filter(l => l.days != null)
  const oldest = known.length ? Math.max(...known.map(l => l.days)) : null
  const avg = known.length ? Math.round(known.reduce((t, l) => t + l.days * l.qty, 0) / Math.max(1, known.reduce((t, l) => t + l.qty, 0))) : null
  return { layers, oldest, avg, sinceOpening: layers.some(l => l.opening) }
}

export default function StockPlanningPage({ inventory, stockItems = [], sees = false, onOrderStock, onNavigate, showToast }) {
  const [view, setView] = useState('reorder')
  const [q, setQ] = useState('')
  const [value, setValue] = useState(null)
  useEffect(() => { if (sees) loadInventoryValue().then(setValue).catch(() => setValue(null)) }, [sees])
  const cost = useMemo(() => new Map((value?.products || []).map(x => [x.id, Number(x.unit_cost) || null])), [value])
  const siById = useMemo(() => new Map(stockItems.map(si => [si.id, si])), [stockItems])

  const rows = useMemo(() => (inventory?.products || []).filter(p => p.kind !== 'packaging').map(p => {
    const st = stockState(p)
    const age = stockAge(p)
    const si = p.stock_item_id ? siById.get(p.stock_item_id) : null
    const unit = cost.get(p.id) ?? null
    const lastSaleDays = daysSince(p.last_sale ? `${p.last_sale}T12:00:00Z` : null)
    const coverAll = st.daily > 0 ? (Math.max(0, p.available) + (Number(p.on_order) || 0)) / st.daily : null
    return { p, st, age, si, unit, value: unit != null ? unit * Math.max(0, p.on_hand) : null, lastSaleDays, coverAll,
      brand: si?.data?.brand || '', supplier: si?.data?.supplierName || '', moq: Number(si?.data?.moq) || 0, caseSize: Number(si?.data?.caseSize || si?.data?.packSize) || 0 }
  }), [inventory, siById, cost])

  // Order quantity: the suggestion, rounded up to the supplier's minimum and case size
  const orderQty = (r) => {
    let n = r.st.suggest
    if (n <= 0) return 0
    if (r.caseSize > 1) n = Math.ceil(n / r.caseSize) * r.caseSize
    if (r.moq > n) n = r.moq
    return n
  }

  const lists = {
    reorder: rows.filter(r => ['out', 'low', 'running_low'].includes(r.st.state)).sort((a, b) => (a.st.cover ?? -1) - (b.st.cover ?? -1)),
    spikes: rows.filter(r => r.st.spike).sort((a, b) => b.st.spike.pct - a.st.spike.pct),
    ageing: rows.filter(r => r.p.on_hand > 0).sort((a, b) => (b.age.oldest ?? -1) - (a.age.oldest ?? -1)),
    slow: rows.filter(r => r.p.on_hand > 0 && !r.st.learning && (r.st.daily < 1 / 7 || r.lastSaleDays == null || r.lastSaleDays > 30))
      .sort((a, b) => (b.value ?? b.p.on_hand) - (a.value ?? a.p.on_hand)),
    over: rows.filter(r => r.coverAll != null && r.coverAll > 90).sort((a, b) => b.coverAll - a.coverAll),
  }
  const VIEWS = [
    { id: 'reorder', label: `Reorder ${lists.reorder.length}` }, { id: 'spikes', label: `Spikes ${lists.spikes.length}` },
    { id: 'ageing', label: 'Stock age' }, { id: 'slow', label: `Slow & dead ${lists.slow.length}` }, { id: 'over', label: `Overstock ${lists.over.length}` },
  ]
  const list = smartFilter(lists[view] || [], q, r => hay(r.p.name, r.p.code, r.brand, r.supplier), { keepOrder: true })

  const bands = BANDS.map(b => {
    let units = 0, val = 0
    for (const r of rows) for (const l of r.age.layers) if (l.days != null && b.test(l.days)) { units += l.qty; val += (r.unit || 0) * l.qty }
    return { ...b, units, val }
  })
  const tiedUp = lists.over.reduce((t, r) => t + (r.unit || 0) * Math.max(0, r.p.on_hand - Math.ceil(r.st.daily * 60)), 0)
  const deadValue = lists.slow.reduce((t, r) => t + (r.value || 0), 0)

  const exportCsv = () => exportRowsToCsv(stampedName(`stock-${view}`), list, [
    { header: 'Product', value: r => r.p.name }, { header: 'SKU', value: r => r.p.code }, { header: 'Brand', value: r => r.brand },
    { header: 'Supplier', value: r => r.supplier }, { header: 'On hand', value: r => r.p.on_hand }, { header: 'Available', value: r => r.p.available },
    { header: 'On order', value: r => r.p.on_order }, { header: 'Daily (now)', value: r => Math.round(r.st.daily * 10) / 10 },
    { header: 'Daily (normal)', value: r => Math.round(r.st.normal * 10) / 10 }, { header: 'Days of cover', value: r => (r.st.cover == null ? '' : Math.floor(r.st.cover)) },
    { header: 'Suggested order', value: r => orderQty(r) }, { header: 'Oldest stock (days)', value: r => r.age.oldest ?? '' },
    { header: 'Last sale (days ago)', value: r => r.lastSaleDays ?? '' }, ...(sees ? [{ header: 'Stock value £', value: r => (r.value == null ? '' : Math.round(r.value)) }] : []),
  ])

  if (!inventory) return <Spinner />
  return (
    <div>
      <PageHeader eyebrow="Sourcing / stock planning" title="Stock Planning"
        description={`What to order today (under ${REORDER_DAYS} days of stock, or selling suddenly faster), how old the stock is, and what isn't moving.`}
        actions={<button className="btn btn-secondary btn-sm" onClick={exportCsv} disabled={!list.length}><Icon name="download" size={14} /> Export</button>} />

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4">
        <MetricCard label="Reorder now" value={lists.reorder.length} color={lists.reorder.length ? 'text-loss' : 'text-ink'} sub={`under ${REORDER_DAYS} days`} onClick={() => setView('reorder')} prominent />
        <MetricCard label="Sales spikes" value={lists.spikes.length} color={lists.spikes.length ? 'text-loss' : 'text-ink'} sub="40%+ for 2 days" onClick={() => setView('spikes')} />
        <MetricCard label="90+ days old" value={fmtUnits(bands[3].units)} sub={sees ? money(bands[3].val) : 'units'} color={bands[3].units ? 'text-warn' : 'text-ink'} onClick={() => setView('ageing')} />
        <MetricCard label="Slow & dead" value={lists.slow.length} sub={sees ? `${money(deadValue)} on the shelf` : 'products'} onClick={() => setView('slow')} />
        <MetricCard label="Overstock" value={lists.over.length} sub={sees ? `${money(tiedUp)} beyond 60 days` : '90+ days of stock'} onClick={() => setView('over')} />
      </div>

      <div className="filter-bar">
        <SegmentedControl value={view} onChange={setView} label="Show" items={VIEWS} />
        <SearchInput value={q} onChange={e => setQ(e.target.value)} placeholder="Product, SKU, brand or supplier" className="w-full sm:w-72 sm:ml-auto" />
      </div>

      {view === 'ageing' && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
          {bands.map((b, i) => (
            <div key={b.id} className="card py-2.5">
              <div className="text-[11px] text-ink/50">{b.label}</div>
              <div className={`text-lg font-semibold tabular-nums ${i === 3 && b.units ? 'text-warn' : 'text-ink'}`}>{fmtUnits(b.units)} <span className="text-xs text-ink/45 font-normal">units</span></div>
              {sees && <div className="text-xs text-ink/55">{money(b.val)}</div>}
            </div>
          ))}
        </div>
      )}

      {!list.length ? (
        <div className="surface"><EmptyState icon="check" title={{ reorder: 'Nothing needs ordering', spikes: 'No spikes', ageing: 'No stock', slow: 'Nothing slow', over: 'No overstock' }[view]}
          sub={view === 'spikes' ? 'A spike is the last 2 selling days each 40% or more above normal.' : ''} /></div>
      ) : (
        <div className="card p-0 overflow-hidden">
          {list.slice(0, 300).map(r => <Row key={r.p.id} r={r} view={view} sees={sees} qty={orderQty(r)}
            onOrder={r.si && onOrderStock ? () => onOrderStock([{ si: r.si, qty: orderQty(r) }]) : null} onOpen={() => onNavigate?.('inventory', r.p.id)} />)}
        </div>
      )}
      <div className="text-xs text-ink/45 mt-2">
        Stock age counts from goods in; stock that was here before the portal started counts from {inventory?.meta?.started_at ? new Date(inventory.meta.started_at).toLocaleDateString('en-GB') : 'the opening count'}, so early on ages read young.
      </div>
    </div>
  )
}

function Row({ r, view, sees, qty, onOrder, onOpen }) {
  const { p, st, age } = r
  const why = st.spike
    ? `Selling ${st.spike.days.map(d => d.u).join(' and ')} a day for 2 days, normally ${Math.round(st.normal * 10) / 10}`
    : st.state === 'out' ? 'Out of stock, nothing on order'
      : st.cover != null ? `${Math.floor(st.cover)} days left at ${Math.round(st.daily * 10) / 10}/day · ${st.lead}-day lead time` : ''
  return (
    <div className="px-4 py-3 border-b border-rule last:border-0 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
      <button className="min-w-0 flex-1 text-left" onClick={onOpen}>
        <div className="text-sm font-semibold text-ink leading-snug">{p.name}</div>
        <div className="text-xs text-ink/50 mt-0.5">{[p.code, r.brand, r.supplier].filter(Boolean).join(' · ')}</div>
        <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
          {(view === 'reorder' || view === 'spikes') && <CoverFlag st={st} />}
          {view === 'ageing' && age.oldest != null && <Flag tone={age.oldest > 90 ? 'amber' : age.oldest > 60 ? 'blue' : 'green'}>Oldest {age.oldest} days · average {age.avg ?? '—'}</Flag>}
          {view === 'slow' && <Flag tone={r.lastSaleDays == null || r.lastSaleDays > 60 ? 'red' : 'amber'}>{r.lastSaleDays == null ? 'No sales on record' : `Last sold ${r.lastSaleDays} days ago`}</Flag>}
          {view === 'over' && <Flag tone="amber">{Math.round(r.coverAll)} days of stock</Flag>}
          {p.on_order > 0 && <Flag tone="blue">{fmtUnits(p.on_order)} on order</Flag>}
        </div>
        {(view === 'reorder' || view === 'spikes') && why && <div className="text-xs text-ink/60 mt-1">{why}</div>}
        {view === 'slow' && <div className="text-xs text-ink/60 mt-1">{r.lastSaleDays == null || r.lastSaleDays > 60 ? 'Stop reordering; try a price cut, a bundle or a multi-pack listing.' : 'Selling under 1 a week — check the price and the listing before reordering.'}</div>}
        {view === 'over' && <div className="text-xs text-ink/60 mt-1">Hold further orders until it's under 60 days.</div>}
      </button>
      <div className="flex items-center gap-3 shrink-0">
        <div className="text-right">
          <div className="text-sm font-semibold tabular-nums">{fmtUnits(p.on_hand)} <span className="text-xs text-ink/45 font-normal">on hand</span></div>
          {sees && r.value != null && <div className="text-xs text-ink/50">{money(r.value)}</div>}
        </div>
        {(view === 'reorder' || view === 'spikes') && qty > 0 && (
          onOrder ? <button className="btn btn-primary btn-sm" onClick={onOrder} title={`Suggested: ${qty}${r.moq ? ` (MOQ ${r.moq})` : ''}`}><Icon name="receipt" size={13} /> Order ~{fmtUnits(qty)}</button>
            : <Flag tone="blue">Order ~{fmtUnits(qty)}</Flag>
        )}
      </div>
    </div>
  )
}
