import React, { useEffect, useMemo, useState } from 'react'
import { PageHeader, Spinner } from './UI'
import { loadStockReport } from '../lib/db'
import { money, ymd, START, dayName, int } from './FinanceParts'

// Where stock on hand came from, in plain words (the costing's own names are kept in the database)
const SOURCE_LABEL = {
  'pre-live stock': 'Pre-live stock', 'goods in': 'Deliveries booked in at Goods In', 'in stock at the count, no PO': 'In stock at the 17 Oct count, no PO',
  PO: 'Purchase orders before the count', 'found stock': 'Stock added in Inventory', 'supplier invoice': 'Supplier invoices, July to September',
  'PO, later returned': 'Going back to a supplier', 'count gain': 'Found at a count', 'opened packs, part used for singles': 'Opened packs', 'from opened packs': 'Singles from opened packs',
  'despatch undone': 'Despatch undone',
}
const OUT_LABEL = { count: 'Start-up differences', 'count before 1 Dec': 'Start-up differences', replacement: 'Replacements', removed: 'Removed', damage: 'Damaged', 'returned to supplier': 'Returned to supplier', 'split into singles': 'Opened for singles' }

/**
 * Finance → Stock value (a page of its own since v2.84.0; a tab of Reports before): what the stock is worth.
 */
export default function StockValuePage() {
  return (
    <div className="page-shell">
      <PageHeader eyebrow="Finance / what the stock is worth" title="Stock value"
        description="What the stock on hand cost, at the end of any day since 1 August, and the pre-live stock: what was brought in, what has sold and what is left." />
      <StockView />
    </div>
  )
}

/**
 * Stock value (v2.83.0): what the stock on hand cost, at any date, from the costing's layers (each delivery at the
 * price paid, less every unit that has left it). Below it, the pre-live stock: what was brought in on 1 August, what
 * has sold, and what is left. For people who see costs.
 */
function StockView() {
  const today = useMemo(() => ymd(new Date()), [])
  const [date, setDate] = useState(today)
  const [d, setD] = useState(null)
  const [error, setError] = useState(null)
  useEffect(() => { setD(null); setError(null); loadStockReport(date).then(setD).catch(e => setError(e?.message || 'Could not load')) }, [date])
  const p = d?.prelive
  const soldPct = p && Number(p.units_in) ? (Number(p.units_sold) / Number(p.units_in)) * 100 : 0
  const leftPct = p && Number(p.units_in) ? (Number(p.units_left) / Number(p.units_in)) * 100 : 0
  const others = useMemo(() => { const m = new Map(); for (const o of p?.other || []) { const k = OUT_LABEL[o.kind] || o.kind; const g = m.get(k) || { kind: k, units: 0, cost: 0 }; g.units += Number(o.units) || 0; g.cost += Number(o.cost) || 0; m.set(k, g) } return [...m.values()] }, [p])
  const margin = p ? Number(p.revenue) + Number(p.fees) - Number(p.cost_sold) : 0
  return (
    <div>
      <div className="filter-bar mb-4 flex-wrap gap-3">
        <span className="text-xs text-ink/45">Stock on hand at the end of</span>
        <input type="date" className="input text-sm w-auto" value={date} min={START} max={today} onChange={e => setDate(e.target.value || today)} aria-label="Date" />
        {date !== today && <button className="btn btn-secondary btn-xs" onClick={() => setDate(today)}>Today</button>}
        {[['End of October', '2026-10-31'], ['End of September', '2026-09-30'], ['End of August', '2026-08-31']].filter(([, v]) => v <= today).map(([l, v]) => (
          <button key={v} className={`filter-chip ${date === v ? 'ring-1 ring-royal-500' : ''}`} onClick={() => setDate(v)}>{l}</button>
        ))}
      </div>
      {error && <div className="card text-sm text-loss">{error}</div>}
      {!error && !d && <div className="surface flex justify-center py-10"><Spinner /></div>}
      {d && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 mb-4">
            <div className="lg:col-span-5 bg-royal-500 text-white rounded-card px-6 py-5 flex flex-col">
              <div className="text-[11px] uppercase tracking-[0.08em] font-semibold text-sky">Stock on hand · {dayName(d.date)}</div>
              <div className="text-[44px] leading-none font-bold tabular-nums mt-3" style={{ letterSpacing: '-0.03em' }}>{money(d.value)}</div>
              <div className="w-24 h-1 bg-lime rounded-sm mt-3" />
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-sky mt-3">
                <span><b className="text-white font-semibold tabular-nums">{int(d.units)}</b> units</span>
                <span><b className="text-white font-semibold tabular-nums">{int(d.products)}</b> products</span>
              </div>
              <div className="text-xs text-sky/90 mt-auto pt-4 leading-relaxed">
                At cost, ex VAT: each delivery at the price paid, less every unit that has left it.
                {d.date < '2026-10-17' && ' Before the 17 Oct count, only stock the records know of is included, so this is on the low side.'}
              </div>
            </div>
            <div className="lg:col-span-7 bg-white border border-rule rounded-card px-5 py-4">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[11px] uppercase tracking-[0.08em] font-semibold text-muted">Pre-live stock</span>
                <span className="text-[11px] text-ink/45">Brought in on 1 August</span>
              </div>
              <div className="grid grid-cols-3 gap-4 mt-3">
                <div><div className="text-xs text-ink/50">Brought in</div><div className="text-xl font-bold text-ink tabular-nums">{money(p.value_in)}</div><div className="text-xs text-ink/50 tabular-nums">{int(p.units_in)} units</div></div>
                <div><div className="text-xs text-ink/50">Sold</div><div className="text-xl font-bold text-ink tabular-nums">{money(p.cost_sold)}</div><div className="text-xs text-ink/50 tabular-nums">{int(p.units_sold)} units at cost</div></div>
                <div><div className="text-xs text-ink/50">Left</div><div className="text-xl font-bold text-ink tabular-nums">{money(p.value_left)}</div><div className="text-xs text-ink/50 tabular-nums">{int(p.units_left)} units</div></div>
              </div>
              <div className="flex h-2 rounded-sm overflow-hidden bg-ink/5 mt-3" aria-hidden="true">
                <span className="bg-royal-500" style={{ width: `${soldPct}%` }} /><span className="bg-rule" style={{ width: `${Math.max(0, 100 - soldPct - leftPct)}%` }} /><span className="bg-lime" style={{ width: `${leftPct}%` }} />
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink/55 mt-1.5">
                <span><span className="inline-block w-2 h-2 rounded-[2px] bg-royal-500 mr-1.5" />Sold {soldPct.toFixed(0)}%</span>
                {others.length > 0 && <span><span className="inline-block w-2 h-2 rounded-[2px] bg-rule mr-1.5" />Other {Math.max(0, 100 - soldPct - leftPct).toFixed(0)}%</span>}
                <span><span className="inline-block w-2 h-2 rounded-[2px] bg-lime mr-1.5" />Left {leftPct.toFixed(0)}%</span>
              </div>
              <div className="mt-3 pt-3 border-t border-rule grid sm:grid-cols-2 gap-x-8">
                <div>
                  {[['Revenue from what sold', p.revenue], ['Marketplace fees', p.fees], ['Cost of goods sold', -p.cost_sold]].map(([l, v]) => (
                    <div key={l} className="flex justify-between py-1 text-sm"><span className="text-ink/70">{l}</span><span className={`tabular-nums ${v < 0 ? 'text-loss' : 'text-ink'}`}>{money(v)}</span></div>
                  ))}
                  <div className="flex justify-between py-1.5 mt-1 border-t border-rule text-sm font-semibold"><span>Profit before shipping and packaging</span><span className={`tabular-nums ${margin >= 0 ? 'text-gain' : 'text-loss'}`}>{money(margin)}</span></div>
                </div>
                <div>
                  {others.map(o => <div key={o.kind} className="flex justify-between py-1 text-sm"><span className="text-ink/70">{o.kind}</span><span className="tabular-nums text-ink/70">{int(o.units)} units · {money(o.cost)}</span></div>)}
                  <div className="text-xs text-ink/45 mt-1 leading-relaxed">Where an order mixed pre-live and newer stock, its revenue and fees are shared by cost.</div>
                </div>
              </div>
            </div>
          </div>
          <div className="grid lg:grid-cols-2 gap-4">
            <div className="table-shell">
              <div className="px-4 py-2.5 border-b border-rule text-sm font-semibold text-ink">Where it came from</div>
              <table className="w-full border-collapse"><tbody>
                {(d.by_source || []).map(r => (
                  <tr key={r.source} className="table-row">
                    <td className="td pl-4">
                      <div className="text-sm text-ink">{SOURCE_LABEL[r.source] || r.source}</div>
                      <div className="h-1 w-full max-w-[220px] rounded-sm bg-ink/5 mt-1.5 overflow-hidden" aria-hidden="true"><div className="h-full bg-royal-500/70" style={{ width: `${Number(d.value) ? (Number(r.value) / Number(d.value)) * 100 : 0}%` }} /></div>
                    </td>
                    <td className="td text-right tabular-nums text-ink/60 whitespace-nowrap">{int(r.units)} units</td>
                    <td className="td text-right tabular-nums font-semibold pr-4">{money(r.value)}</td>
                  </tr>
                ))}
              </tbody></table>
            </div>
            <div className="table-shell">
              <div className="px-4 py-2.5 border-b border-rule text-sm font-semibold text-ink">Most value on the shelves</div>
              <table className="w-full border-collapse"><tbody>
                {(d.top || []).map(r => (
                  <tr key={r.name} className="table-row">
                    <td className="td pl-4 text-sm text-ink">{r.name}</td>
                    <td className="td text-right tabular-nums text-ink/60 whitespace-nowrap">{int(r.units)} units</td>
                    <td className="td text-right tabular-nums font-semibold pr-4">{money(r.value)}</td>
                  </tr>
                ))}
              </tbody></table>
            </div>
          </div>
          {d.costed_at && <div className="text-xs text-ink/45 mt-3">From the costing run of {new Date(d.costed_at).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }).replace(/\//g, '-')}. It reruns every night and after each report upload.</div>}
        </>
      )}
    </div>
  )
}
