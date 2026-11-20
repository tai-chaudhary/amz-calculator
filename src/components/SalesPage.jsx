import React, { useEffect, useMemo, useState } from 'react'
import { EmptyState, Icon, PageHeader, SegmentedControl, Spinner } from './UI'
import { AmazonLink } from './Links'
import { loadPlLines, loadPlOpen, loadOrderTags } from '../lib/db'
import { PERIODS, START, periodRange, spanFor, NO_PRODUCT, attachTags, isPrime } from '../lib/pnlScreen'
import { attachListings, salesTotals, salesGroups, salesByDay, salesByWeek, movers, NO_SKU, NO_ASIN } from '../lib/salesScreen'
import { londonToday } from '../lib/dates'
import { downloadCsv } from '../lib/csv'
import { money, money0, pct1, int, dayName, monthName, CHANNELS, channelName, Tile, longDay, spanText, short, Delta, ChangeChip, ChannelTabs, PeriodPicker, Bars, NameLink, pctChange } from './FinanceParts'

/**
 * Finance → Sales — what sold? (rebuilt in v2.85.0; the owner found the first page "super basic" and pointless.)
 *
 * The same periods, comparisons and channel tabs as Profit & Loss, but about selling, not profit: revenue, orders,
 * units, the average order, refunds and fees; revenue by day; each channel's share; the best sellers; what rose and
 * fell against the period before, what is new and what stopped selling; then every product, ASIN or listing in a
 * table. No costs here — those are the Profit & Loss's.
 *
 * It reads the same lines as the P&L (report_pl_lines, plus HELM's open orders dated today from report_pl_open) and
 * adds them up in lib/salesScreen.js. Revenue is ex VAT everywhere; "inc VAT" is what customers paid.
 */
const GROUPS = [
  { id: 'product', label: 'Product' }, { id: 'listing', label: 'Listing SKU' }, { id: 'asin', label: 'ASIN' },
  { id: 'channel', label: 'Channel' }, { id: 'tag', label: 'Tag' }, { id: 'day', label: 'Day' }, { id: 'month', label: 'Month' },
]
const KINDS = [{ id: 'product', label: 'Products' }, { id: 'asin', label: 'ASINs' }, { id: 'listing', label: 'Listings' }]
const METRICS = [{ id: 'revenue', label: 'Revenue' }, { id: 'orders', label: 'Orders' }, { id: 'units', label: 'Units' }]
const linked = (r) => ![NO_SKU, NO_ASIN, NO_PRODUCT].includes(r.key)
const csvText = (rows) => rows.map(x => x.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')

export default function SalesPage({ savedProducts = [], stockItems = [] }) {
  const today = useMemo(londonToday, [])
  const [channel, setChannel] = useState('')
  const [periodId, setPeriodId] = useState('yesterday')
  const [custom, setCustom] = useState({ from: today, to: today })
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [metric, setMetric] = useState('revenue')
  const [kind, setKind] = useState('product')
  const [groupPick, setGroupPick] = useState(null)
  const [sort, setSort] = useState(null)
  const [q, setQ] = useState('')

  const range = useMemo(() => periodRange(periodId, today, custom), [periodId, today, custom])
  const need = useMemo(() => spanFor(range), [range])
  const key = `${need.from}|${need.to}|${channel}`
  useEffect(() => {
    let live = true
    setError(null)
    Promise.all([loadPlLines(need.from, need.to, channel || null), need.to >= today ? loadPlOpen(channel || null) : null, loadOrderTags(need.from, need.to, channel || null).catch(() => null)])
      .then(([pl, open, tags]) => { if (live) setData({ key, lines: [...(pl.lines || []), ...(open?.lines || [])], tags }) })
      .catch(e => { if (live) setError(e?.message || 'Could not load') })
    return () => { live = false }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps

  const ready = data && data.key === key
  const savedById = useMemo(() => new Map(savedProducts.map(r => [r.id, r])), [savedProducts])
  const lines = useMemo(() => (ready ? attachTags(attachListings(data.lines, savedById), data.tags) : null), [ready, data, savedById])
  const T = useMemo(() => (lines ? salesTotals(lines, range.from, range.to) : null), [lines, range])
  const P = useMemo(() => (lines && range.prev ? salesTotals(lines, range.prev.from, range.prev.to) : null), [lines, range])
  const W = useMemo(() => (lines && need.weekBefore ? salesTotals(lines, need.weekBefore.from, need.weekBefore.to) : null), [lines, need])
  const M = useMemo(() => (lines && need.monthToDate ? salesTotals(lines, need.monthToDate.from, need.monthToDate.to) : null), [lines, need])
  const series = useMemo(() => {
    if (!lines) return null
    const rows = salesByDay(lines, need.chartFrom, range.to)
    return rows.length > 45 ? { by: 'week', rows: salesByWeek(rows) } : { by: 'day', rows }
  }, [lines, need, range])
  const grouped = (by) => {
    const now = salesGroups(lines, range.from, range.to, by, stockItems)
    const was = range.prev ? salesGroups(lines, range.prev.from, range.prev.to, by, stockItems) : []
    return movers(now, was)
  }
  const byKind = useMemo(() => (lines ? grouped(kind) : []), [lines, range, kind, stockItems]) // eslint-disable-line react-hooks/exhaustive-deps
  const byListing = useMemo(() => (lines ? grouped('listing') : []), [lines, range, stockItems]) // eslint-disable-line react-hooks/exhaustive-deps
  const productCount = useMemo(() => (lines ? salesGroups(lines, range.from, range.to, 'product', stockItems).filter(r => linked(r) && r.units > 0).length : 0), [lines, range, stockItems])

  // Amazon's orders by whether HELM has them tagged Prime (an order despatched before tagging began is not known)
  const primeOrders = useMemo(() => {
    if (!lines || channel !== 'Amazon') return null
    const sets = { prime: new Set(), other: new Set(), unknown: new Set() }
    for (const l of lines) if (l.kind === 'sale' && l.order_ref && l.sale_date >= range.from && l.sale_date <= range.to) sets[l.tags == null ? 'unknown' : isPrime(l.tags) ? 'prime' : 'other'].add(l.order_ref)
    return { prime: sets.prime.size, other: sets.other.size, unknown: sets.unknown.size }
  }, [lines, channel, range])
  const periodName = PERIODS.find(p => p.id === periodId)?.label || 'Yesterday'
  const oneDay = range.from === range.to
  const title = oneDay ? longDay(range.from) : spanText(range.from, range.to)
  const perDay = range.days > 1
  const openDay = (from, to = from) => { setCustom({ from: from < START ? START : from, to: to > today ? today : to }); setPeriodId('custom'); window.scrollTo?.({ top: 0, behavior: 'smooth' }) }
  const prevName = range.prev?.name

  const sellers = byKind.filter(r => linked(r) && r.revenue > 0).sort((a, b) => b.revenue - a.revenue)
  const up = byKind.filter(r => linked(r) && r.change > 0.5).sort((a, b) => b.change - a.change).slice(0, 5)
  const down = byKind.filter(r => linked(r) && r.change < -0.5).sort((a, b) => a.change - b.change).slice(0, 5)
  const soldListings = byListing.filter(r => linked(r) && r.revenue > 0)
  const fresh = soldListings.filter(r => r.isNew).length, stopped = byListing.filter(r => linked(r) && r.stopped).length

  // ── The table ────────────────────────────────────────────────────────────────────────────────────────────────────
  const group = groupPick || 'product'
  const named = group === 'product' || group === 'listing' || group === 'asin'
  const timed = group === 'day' || group === 'month'
  const rows = useMemo(() => {
    if (!lines) return []
    if (timed) return salesGroups(lines, range.from, range.to, group, stockItems)
    return grouped(group).filter(r => !r.stopped)
  }, [lines, range, group, stockItems]) // eslint-disable-line react-hooks/exhaustive-deps
  const useSort = sort || (timed ? { k: 'key', dir: 1 } : { k: 'revenue', dir: -1 })
  const nameOf = (r) => (group === 'month' ? monthName(r.key) : group === 'day' ? dayName(r.key) : group === 'channel' ? channelName(r.key) : group === 'product' ? r.name : r.key)
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const r = needle && named ? rows.filter(x => `${x.key} ${x.name || ''} ${x.asin || ''}`.toLowerCase().includes(needle)) : rows
    return [...r].sort((a, b) => {
      const va = a[useSort.k], vb = b[useSort.k]
      return (typeof va === 'string' || typeof vb === 'string' ? String(va ?? '').localeCompare(String(vb ?? '')) : (Number(va) || 0) - (Number(vb) || 0)) * useSort.dir
    })
  }, [rows, useSort, q, named])
  const Th = ({ k, children, right = true }) => (
    <th className={`th ${right ? 'text-right' : 'text-left'} cursor-pointer select-none`} onClick={() => setSort({ k, dir: useSort.k === k ? -useSort.dir : (k === 'key' ? 1 : -1) })}>
      {children}{useSort.k === k ? (useSort.dir > 0 ? ' ↑' : ' ↓') : ''}
    </th>
  )
  // By tag there is no fair "before": tagging began on 15 Nov 2026, so an earlier period's orders have no tags to compare
  const compare = !timed && group !== 'tag' && !!range.prev
  const exportCsv = () => downloadCsv(`sales-${group}-${range.from}-to-${range.to}.csv`, csvText([
    ['Group', 'Name', 'Orders', 'Units', 'Revenue ex VAT', 'Share of revenue %', ...(compare ? ['Revenue before', 'Change'] : []), 'A unit ex VAT', 'VAT', 'Inc VAT', 'Refunds', 'Fees'],
    ...list.map(r => [nameOf(r), group === 'product' ? '' : r.name || '', r.orders, r.units, r.revenue.toFixed(2), T.revenue ? ((r.revenue / T.revenue) * 100).toFixed(1) : '', ...(compare ? [r.was.toFixed(2), r.change.toFixed(2)] : []), r.perUnit == null ? '' : r.perUnit.toFixed(2), r.vat.toFixed(2), r.incVat.toFixed(2), r.refunds.toFixed(2), r.fees.toFixed(2)]),
  ]))
  const caption = (r) => `revenue ${money(r.revenue)} · ${int(r.orders)} order${r.orders === 1 ? '' : 's'} · ${int(r.units)} units`
  const fmtMetric = (v) => (metric === 'revenue' ? money0(v) : int(v))

  return (
    <div className="page-shell">
      <PageHeader eyebrow="Finance / Sales" title={title}
        description={`${periodName === 'Custom' ? 'Chosen dates' : periodName}${!oneDay ? ` · ${range.days} days` : ''}. What sold: a day is the day the orders were despatched; orders still open count with today. Revenue is ex VAT. Costs and profit are on Profit & Loss.`} />
      <ChannelTabs value={channel} onChange={setChannel} />
      <PeriodPicker periodId={periodId} onPeriod={setPeriodId} custom={custom} onCustom={setCustom} today={today} />

      {error && <div className="card text-sm text-loss">{error}</div>}
      {!error && (!ready || !T) && <div className="surface flex justify-center py-16"><Spinner /></div>}

      {!error && ready && T && (
        <>
          {/* ── Revenue, beside the period before; then the six figures ── */}
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-3 mb-3">
            <div className="xl:col-span-4 bg-royal-500 text-white rounded-card px-6 pt-5 pb-5 flex flex-col">
              <div className="text-[11px] uppercase tracking-[0.08em] font-semibold text-sky leading-relaxed">Revenue · {periodName === 'Custom' ? 'chosen dates' : periodName}{channel ? ` · ${channelName(channel)}` : ''}<br />{oneDay ? dayName(range.from) : spanText(range.from, range.to)}</div>
              <div className="text-[52px] leading-none font-bold tabular-nums mt-3" style={{ letterSpacing: '-0.03em' }} title={money(T.revenue)}>{money0(T.revenue)}</div>
              <div className="w-24 h-1 bg-lime rounded-sm mt-3" />
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-sky mt-3">
                <span><b className="text-white font-semibold tabular-nums">{money0(T.incVat)}</b> inc VAT</span>
                <span><b className="text-white font-semibold tabular-nums">{money0(T.vat)}</b> VAT</span>
                {perDay && <span><b className="text-white font-semibold tabular-nums">{money0(T.revenue / range.days)}</b> a day</span>}
              </div>
              {T.openOrders > 0 && <div className="mt-3 text-xs text-sky">Includes {money0(T.openRevenue)} from {int(T.openOrders)} orders still open in HELM, not despatched yet.</div>}
              <div className="mt-auto pt-4 text-sm">
                {P ? (
                  <div className="flex items-baseline justify-between gap-3 py-2.5 border-t border-white/20">
                    <span className="text-sky">{prevName} · {spanText(range.prev.from, range.prev.to)}{range.prev.partial ? ' (figures start 1 Aug)' : ''}</span>
                    <span className="whitespace-nowrap"><b className="tabular-nums">{money0(P.revenue)}</b> <span className="ml-2"><Delta now={T.revenue} was={P.revenue} light /></span></span>
                  </div>
                ) : <div className="py-2.5 border-t border-white/20 text-sky">Nothing to compare with: the figures start on 1 August 2026.</div>}
                {W && (
                  <div className="flex items-baseline justify-between gap-3 py-2.5 border-t border-white/20">
                    <span className="text-sky">Average of the {W.days} days before</span>
                    <span className="whitespace-nowrap"><b className="tabular-nums">{money0(W.revenue / W.days)}</b> <span className="ml-2"><Delta now={T.revenue} was={W.revenue / W.days} light /></span></span>
                  </div>
                )}
                {M && (
                  <div className="flex items-baseline justify-between gap-3 pt-2.5 border-t border-white/20">
                    <span className="text-sky">Month to date · {spanText(M.from, M.to)}</span>
                    <span className="whitespace-nowrap"><b className="tabular-nums">{money0(M.revenue)}</b> <span className="text-sky ml-2">{int(M.orders)} orders</span></span>
                  </div>
                )}
              </div>
            </div>

            <div className="xl:col-span-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <Tile label="Orders" right={P ? <ChangeChip now={T.orders} was={P.orders} /> : null}>
                <div className="text-[28px] leading-tight font-bold tabular-nums">{int(T.orders)}</div>
                <div className="text-[13px] text-ink mt-1">{perDay ? `${int(T.orders / range.days)} a day` : T.orders === 1 ? 'order' : 'orders'}{!channel && T.channels.length > 1 && ` · ${T.channels.slice(0, 3).map(c => `${channelName(c.channel)} ${int(c.orders)}`).join(' · ')}`}</div>
                {primeOrders && primeOrders.prime + primeOrders.other > 0 && <div className="text-xs text-ink/55 mt-1">Prime {int(primeOrders.prime)} · not Prime {int(primeOrders.other)}{primeOrders.unknown > 0 && ` · not known ${int(primeOrders.unknown)}`}</div>}
                {T.openOrders > 0 && <div className="text-xs text-warn mt-1">{int(T.openOrders)} still open in HELM, not despatched</div>}
                {P && <div className="text-xs text-ink/55 mt-auto pt-3">{prevName}: {int(P.orders)}</div>}
              </Tile>
              <Tile label="Units" right={P ? <ChangeChip now={T.units} was={P.units} /> : null}>
                <div className="text-[28px] leading-tight font-bold tabular-nums">{int(T.units)}</div>
                <div className="text-[13px] text-ink mt-1">{T.orders > 0 ? `${(T.units / T.orders).toFixed(2)} an order` : 'units'}{perDay && ` · ${int(T.units / range.days)} a day`}</div>
                {P && <div className="text-xs text-ink/55 mt-auto pt-3">{prevName}: {int(P.units)}{P.orders > 0 && ` · ${(P.units / P.orders).toFixed(2)} an order`}</div>}
              </Tile>
              <Tile label="Average order" right={P ? <ChangeChip now={T.perOrder} was={P.perOrder} /> : null}>
                <div className="text-[28px] leading-tight font-bold tabular-nums">{T.perOrder == null ? '—' : money(T.perOrder)}</div>
                <div className="text-[13px] text-ink mt-1">ex VAT{T.perUnit != null && ` · ${money(T.perUnit)} a unit`}</div>
                {P && P.perOrder != null && <div className="text-xs text-ink/55 mt-auto pt-3">{prevName}: {money(P.perOrder)}</div>}
              </Tile>
              <Tile label="Refunds" right={P ? <ChangeChip now={T.refundOrders} was={P.refundOrders} goodUp={false} /> : null}>
                <div className={`text-[28px] leading-tight font-bold tabular-nums ${T.refundOrders ? '' : 'text-ink/40'}`}>{int(T.refundOrders)}</div>
                <div className="text-[13px] text-ink mt-1">{T.orders ? `${((T.refundOrders / T.orders) * 100).toFixed(1)}% of orders · ` : ''}{money(-T.refunds)}</div>
                {P && <div className="text-xs text-ink/55 mt-auto pt-3">{prevName}: {int(P.refundOrders)}{P.orders ? ` · ${((P.refundOrders / P.orders) * 100).toFixed(1)}%` : ''} · {money(-P.refunds)}</div>}
              </Tile>
              <Tile label="Fees" right={P && P.revenue > 0 && T.revenue > 0 ? <Delta now={(-T.fees / T.revenue) * 100} was={(-P.fees / P.revenue) * 100} fmt={v => `${v.toFixed(1)} pts`} goodUp={false} eps={0.05} /> : null}>
                <div className="text-[28px] leading-tight font-bold tabular-nums">{T.revenue > 0 ? pct1((-T.fees / T.revenue) * 100) : '—'}</div>
                <div className="text-[13px] text-ink mt-1">of revenue · {money(-T.fees)} ex VAT</div>
                {T.estimated > 0 && <div className="text-xs text-warn mt-1">Estimated on {int(T.estimated)} of {int(T.saleLines)} lines until the report is uploaded</div>}
                {P && P.revenue > 0 && <div className="text-xs text-ink/55 mt-auto pt-3">{prevName}: {pct1((-P.fees / P.revenue) * 100)}</div>}
              </Tile>
              <Tile label="What sold" right={T.unlinked > 0 ? <span className="font-bold text-warn bg-[#FBF5E6] rounded-[4px] px-2 py-0.5 whitespace-nowrap">{int(T.unlinked)} not linked</span> : null}>
                <div className="text-[28px] leading-tight font-bold tabular-nums">{int(soldListings.length)}</div>
                <div className="text-[13px] text-ink mt-1">listing{soldListings.length === 1 ? '' : 's'} · {int(productCount)} product{productCount === 1 ? '' : 's'}</div>
                {P && <div className="text-xs text-ink/55 mt-auto pt-3">Against {prevName.toLowerCase()}: <b className="text-gain">{int(fresh)} new</b> · <b className={stopped ? 'text-loss' : ''}>{int(stopped)} stopped</b></div>}
              </Tile>
            </div>
          </div>

          {/* ── By day · channels ── */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 mb-3">
            <div className="lg:col-span-7 bg-white border border-rule rounded-card px-5 py-4 flex flex-col min-w-0">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
                <span className="text-[11px] uppercase tracking-[0.08em] font-semibold text-muted">{METRICS.find(m => m.id === metric).label} by {series.by}{series.by === 'day' && oneDay ? ' · the 14 days up to this one' : ''}</span>
                <SegmentedControl label="Show" items={METRICS} value={metric} onChange={setMetric} />
              </div>
              <Bars rows={series.rows} k={metric} by={series.by} from={series.by === 'week' ? series.rows.find(r => r.to >= range.from)?.d || range.from : range.from} caption={caption} onPick={(r) => openDay(r.d, r.to || r.d)} />
              <DayFacts rows={series.rows} k={metric} by={series.by} fmt={fmtMetric} />
            </div>

            <Tile label={channel ? `${channelName(channel)} against the period before` : 'Channels'} right={channel ? null : 'Share of revenue'} className="lg:col-span-5">
              {T.channels.length === 0 && <div className="text-sm text-ink/50 py-3">No sales in these dates.</div>}
              {T.channels.map(c => {
                const b = P?.channels.find(x => x.channel === c.channel)
                const share = T.revenue ? (c.revenue / T.revenue) * 100 : 0
                return (
                  <button key={c.channel} type="button" onClick={() => { if (!channel && CHANNELS.includes(c.channel)) setChannel(c.channel) }} disabled={!!channel} title={channel ? undefined : `Open ${channelName(c.channel)}`}
                    className="block w-full text-left py-2.5 border-t border-rule/70 first:border-t-0 enabled:hover:bg-paper -mx-2 px-2 rounded-[4px]">
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span><b className="text-ink">{channelName(c.channel)}</b> <span className="text-xs text-ink/50 ml-1">{int(c.orders)} orders · {int(c.units)} units</span></span>
                      <span className="whitespace-nowrap tabular-nums"><b>{money0(c.revenue)}</b> <span className="text-ink/55 ml-1">{pct1(share)}</span></span>
                    </div>
                    <div className="flex items-center gap-3 mt-1.5">
                      <span className="flex-1 h-1.5 rounded bg-ink/5 overflow-hidden" aria-hidden="true"><span className="block h-full bg-royal-500" style={{ width: `${Math.max(0, Math.min(100, share))}%` }} /></span>
                      {P && <span className="text-xs whitespace-nowrap text-ink/55">{b ? <>{money0(b.revenue)} before <span className="ml-1"><Delta now={c.revenue} was={b.revenue} /></span></> : <b className="text-gain">New</b>}</span>}
                    </div>
                  </button>
                )
              })}
              {P && P.channels.filter(b => !T.channels.some(c => c.channel === b.channel)).map(b => (
                <div key={b.channel} className="flex justify-between text-sm py-2.5 border-t border-rule/70 text-ink/55"><span>{channelName(b.channel)}</span><span>Nothing sold · {money0(b.revenue)} before</span></div>
              ))}
            </Tile>
          </div>

          {/* ── Best sellers · what rose and fell ── */}
          <div className="bg-white border border-rule rounded-card px-5 py-4 mb-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-[11px] uppercase tracking-[0.08em] font-semibold text-muted">Best sellers, and what changed{P ? ` against ${prevName.toLowerCase()}` : ''}</span>
              <SegmentedControl label="Show" items={KINDS} value={kind} onChange={setKind} />
            </div>
            {!sellers.length && !down.length ? <div className="text-sm text-ink/50 py-4">Nothing sold in these dates.</div> : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-10">
                <div>
                  <div className="text-xs font-semibold text-ink/55 pt-3 pb-1.5">Best sellers by revenue</div>
                  {sellers.slice(0, 8).map((r, i) => (
                    <div key={r.key} className="grid grid-cols-[18px_minmax(0,1fr)_auto] gap-x-2 py-2 border-t border-rule/70 text-sm items-start">
                      <span className="text-ink/40 tabular-nums text-xs pt-0.5">{i + 1}</span>
                      <span className="min-w-0">
                        <Name r={r} kind={kind} />
                        <span className="flex items-center gap-2 mt-1"><span className="flex-1 max-w-[160px] h-1.5 rounded bg-ink/5 overflow-hidden" aria-hidden="true"><span className="block h-full bg-royal-500" style={{ width: `${(r.revenue / sellers[0].revenue) * 100}%` }} /></span><span className="text-xs text-ink/50 tabular-nums">{int(r.units)} units · {pct1(T.revenue ? (r.revenue / T.revenue) * 100 : 0)} of revenue</span></span>
                      </span>
                      <span className="text-right whitespace-nowrap"><b className="tabular-nums">{money(r.revenue)}</b>{P && <span className="block text-xs">{r.isNew ? <b className="text-gain">New</b> : <Delta now={r.revenue} was={r.was} />}</span>}</span>
                    </div>
                  ))}
                </div>
                <div>
                  {!P && <div className="text-sm text-ink/50 pt-3">Nothing to compare with yet.</div>}
                  {P && <>
                    <div className="text-xs font-semibold text-gain pt-3 pb-1.5">Up most</div>
                    {!up.length && <div className="text-sm text-ink/50 py-2 border-t border-rule/70">Nothing sold more than before.</div>}
                    {up.map(r => <Mover key={r.key} r={r} kind={kind} />)}
                    <div className="text-xs font-semibold text-loss pt-4 pb-1.5">Down most</div>
                    {!down.length && <div className="text-sm text-ink/50 py-2 border-t border-rule/70">Nothing sold less than before.</div>}
                    {down.map(r => <Mover key={r.key} r={r} kind={kind} />)}
                  </>}
                </div>
              </div>
            )}
          </div>

          {/* ── Everything that sold ── */}
          <div className="table-shell overflow-x-auto">
            <div className="flex flex-wrap items-center gap-2.5 px-4 py-2.5 border-b border-rule">
              <span className="text-xs text-ink/45">Break down by</span>
              <SegmentedControl label="Break down by" items={GROUPS} value={group} onChange={(g) => { setGroupPick(g); setSort(null) }} />
              {named && <input type="search" className="input text-sm w-auto min-w-[220px]" placeholder={`Search ${GROUPS.find(g => g.id === group).label.toLowerCase()}s`} value={q} onChange={e => setQ(e.target.value)} aria-label="Search" />}
              <span className="text-xs text-ink/50 sm:ml-auto">{list.length} row{list.length !== 1 ? 's' : ''}</span>
              <button className="btn btn-secondary btn-xs" onClick={exportCsv} disabled={!list.length}><Icon name="download" size={13} /> Export CSV</button>
            </div>
            <table className="w-full min-w-[1040px] border-collapse">
              <thead className="table-head">
                <tr>
                  <Th k="key" right={false}>{GROUPS.find(g => g.id === group)?.label}</Th>
                  <Th k="orders">Orders</Th><Th k="units">Units</Th><Th k="revenue">Revenue</Th><th className="th text-left">Share of revenue</th>
                  {compare && <><Th k="was">{spanText(range.prev.from, range.prev.to)}</Th><Th k="change">Change</Th></>}
                  <Th k="perUnit">A unit</Th><Th k="incVat">Inc VAT</Th><Th k="refunds">Refunds</Th><Th k="fees">Fees</Th>
                </tr>
              </thead>
              <tbody>
                {list.map(r => {
                  const share = T.revenue ? (r.revenue / T.revenue) * 100 : 0
                  return (
                    <tr key={r.key} className="table-row">
                      <td className="td">
                        {named ? <div className="min-w-[250px] max-w-[440px]"><Name r={r} kind={group} asin /></div>
                          : group === 'day' ? <button type="button" className="text-sm font-semibold text-ink whitespace-nowrap hover:text-royal-500 hover:underline" title="Open this day" onClick={() => openDay(r.key)}>{nameOf(r)}</button>
                          : <span className="text-sm font-semibold text-ink whitespace-nowrap">{nameOf(r)}</span>}
                      </td>
                      <td className="td text-right tabular-nums whitespace-nowrap">{int(r.orders)}</td>
                      <td className="td text-right tabular-nums whitespace-nowrap">{int(r.units)}</td>
                      <td className="td text-right tabular-nums whitespace-nowrap font-semibold">{money(r.revenue)}</td>
                      <td className="td"><span className="flex items-center gap-2 min-w-[120px]"><span className="flex-1 h-1.5 rounded bg-ink/5 overflow-hidden" aria-hidden="true"><span className="block h-full bg-royal-500" style={{ width: `${Math.max(0, Math.min(100, share))}%` }} /></span><span className="text-xs tabular-nums text-ink/60 w-10 text-right">{pct1(share)}</span></span></td>
                      {compare && <>
                        <td className="td text-right tabular-nums whitespace-nowrap text-ink/55">{r.isNew ? '—' : money(r.was)}</td>
                        <td className="td text-right whitespace-nowrap text-[13px]">{r.isNew ? <b className="text-gain">New</b> : <><Delta now={r.revenue} was={r.was} fmt={money} eps={0.005} />{Math.abs(r.change) >= 0.005 && pctChange(r.revenue, r.was) != null && <span className="text-ink/45 ml-1 tabular-nums">{Math.abs(pctChange(r.revenue, r.was)).toFixed(0)}%</span>}</>}</td>
                      </>}
                      <td className="td text-right tabular-nums whitespace-nowrap">{r.perUnit == null ? '—' : money(r.perUnit)}</td>
                      <td className="td text-right tabular-nums whitespace-nowrap text-ink/70">{money(r.incVat)}</td>
                      <td className="td text-right tabular-nums whitespace-nowrap text-loss">{r.refunds ? money(r.refunds) : '—'}</td>
                      <td className="td text-right tabular-nums whitespace-nowrap text-loss">{money(r.fees)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {!list.length && <EmptyState icon="trend" title={q ? 'Nothing matches' : 'No sales in these dates'} sub={q ? 'Clear the search to see everything that sold.' : 'Change the dates or the channel.'} />}
          </div>
          <div className="text-xs text-ink/45 mt-3 leading-relaxed">
            Revenue, a unit and refunds are ex VAT; fees are ex VAT too. {group === 'product' && 'A listing that holds more than one product is shared between them by what each cost. '}
            {T.estimated > 0 && `Fees on ${int(T.estimated)} lines are estimated from the listing until the channel’s report is uploaded (Finance → Uploads). `}
            {group === 'tag' && 'Tags are the ones on each order in HELM; an order despatched before tagging began shows as “(tags not known)”. '}
            {T.unlinked > 0 && `${int(T.unlinked)} lines are not linked to a listing, so they show under “${group === 'product' ? NO_PRODUCT : group === 'asin' ? NO_ASIN : NO_SKU}”.`}
          </div>
        </>
      )}
    </div>
  )
}

/** A product, ASIN or listing by its full name, opening it in place */
function Name({ r, kind, asin }) {
  if (kind === 'product') return <NameLink kind="product" id={r.product_id} name={r.name} className="text-sm font-semibold text-ink" />
  return (
    <>
      <span className="block text-sm font-semibold text-ink break-words">{r.key}</span>
      {r.name && <span className="block text-xs text-ink/60 leading-snug mt-0.5">{kind === 'listing' && r.listing_id ? <NameLink kind="listing" id={r.listing_id} name={r.name} /> : r.name}</span>}
      {kind === 'listing' && !r.listing_id && linked(r) && <span className="block text-xs text-warn mt-0.5">No listing for this SKU</span>}
      {asin && r.asin && linked(r) && <span className="block mt-1"><AmazonLink asin={r.asin} label={r.asin} /></span>}
    </>
  )
}

function Mover({ r, kind }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 py-2 border-t border-rule/70 text-sm items-start">
      <span className="min-w-0">
        <Name r={r} kind={kind} />
        <span className="block text-xs text-ink/50 mt-0.5 tabular-nums">{r.stopped ? `Nothing sold · ${int(r.wasUnits)} units before` : r.isNew ? `New · ${int(r.units)} units` : `${int(r.units)} units · ${int(r.wasUnits)} before`}</span>
      </span>
      <span className="text-right whitespace-nowrap">
        <b className={`tabular-nums ${r.change < 0 ? 'text-loss' : 'text-gain'}`}>{r.change > 0 ? '▲' : '▼'} {money(Math.abs(r.change))}</b>
        <span className="block text-xs text-ink/55 tabular-nums">{money0(r.revenue)} · was {money0(r.was)}</span>
      </span>
    </div>
  )
}

function DayFacts({ rows, k, by, fmt }) {
  if (rows.length < 2) return null
  const best = rows.reduce((a, b) => (b[k] > a[k] ? b : a), rows[0]), worst = rows.reduce((a, b) => (b[k] < a[k] ? b : a), rows[0])
  const dn = (r) => (by === 'week' ? `week of ${short(r.d)}` : dayName(r.d))
  const total = rows.reduce((s, r) => s + r[k], 0)
  const fact = (l, v) => <div className="flex justify-between py-1.5 border-t border-rule/70 text-[13px]"><span className="text-ink/70">{l}</span><b className="tabular-nums">{v}</b></div>
  return (
    <div className="mt-auto pt-3">
      {fact(`Best · ${dn(best)}`, fmt(best[k]))}
      {fact(`Quietest · ${dn(worst)}`, fmt(worst[k]))}
      {fact(`Average a ${by}`, fmt(total / rows.length))}
    </div>
  )
}
