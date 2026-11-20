import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Drawer, EmptyState, Icon, PageHeader, SegmentedControl, Spinner, StatusBadge } from './UI'
import { AmazonLink } from './Links'
import { loadPlLines, loadPlDays, loadPlOpen, loadPlShip, loadOrderDistricts, loadOrderTags, loadCostVersions, loadOverheadsForPl, loadStockReport, loadProductPackaging } from '../lib/db'
import { categoryLabel } from '../lib/overheads'
import { buildPnl, groupPnl } from '../lib/pnl'
import { PERIODS, START, periodRange, spanFor, extrasByDay, isAdvertising, isReturnCharge, summarise, byDay, byWeek, glance, splitOf, groupByProduct, NO_PRODUCT, attachTags, groupByTag, primeSplit, isPrime, orderProducts } from '../lib/pnlScreen'
import { stockState, fmtDays } from '../lib/inventory'
import { londonToday } from '../lib/dates'
import { downloadCsv } from '../lib/csv'
import { money, money0, pct1, int, dayName, monthName, CHANNELS, channelName, chargesOf, Tile, GROSS_HERO, longDay, spanText, short, Delta, ChangeChip, ChannelTabs, PeriodPicker, Bars, NameLink } from './FinanceParts'

/**
 * Finance → Profit & Loss — how did we do?
 *
 * The owner's brief (15 Nov 2026): Net profit is the key figure, top left; the screen opens on Yesterday; it is for
 * keeping an eye on everything important and making decisions, so every figure sits beside the one it is compared
 * with — the period before (yesterday with the day before, a week with the week before, and so on: lib/pnlScreen.js).
 * Built from design Option 3 (the control room in the portal's colours), like the Overheads page.
 *
 * TERMS (his, use them everywhere): Revenue = sales ex VAT. Direct costs = refunds, fees, the channels' other charges
 * and credits, cost of goods sold, shipping, packaging, replacements (and stock losses from 1 Dec). Gross profit =
 * Revenue − Direct costs. Net profit = Gross profit − the fixed overheads. Gross margin and Net margin are of revenue.
 *
 * WHERE THE FIGURES COME FROM — nothing is costed differently from the old Reports page:
 *   every order line, costed       report_pl_lines + buildPnl (lib/pnl.js): real cost of goods sold first in first
 *                                  out, shipping from the parcels HELM booked, packaging from the listing
 *   open orders (v2.85.0)          report_pl_open: the orders open in HELM right now, dated TODAY and costed by the
 *                                  same buildPnl — all estimates. Once despatched an order moves to its despatch day.
 *   charges, replacements, losses  report_pl_days — the same totals, by day
 *   overheads                      overheads_for_pl, by day
 *   order tags (v2.86.0)           report_order_tags + report_pl_open: HELM's tags on each order (the owner tags every
 *                                  Prime order "Prime"). They change no figure: they split and label what is there.
 * One load covers the period, the period before it and the chart; lib/pnlScreen.js adds up whichever days are asked.
 * Overheads, replacements and stock losses belong to the whole business, so a single channel shows Gross profit as
 * its headline and has no Net profit (and no profit split).
 */
const GROUPS = [
  { id: 'month', label: 'Month' }, { id: 'day', label: 'Day' }, { id: 'channel', label: 'Channel' },
  { id: 'product', label: 'Product' }, { id: 'asin', label: 'ASIN' }, { id: 'listing', label: 'Listing SKU' }, { id: 'tag', label: 'Tag' },
]
const NO_SKU = '(no Listing SKU)', NO_ASIN = '(no ASIN)'
const linked = (r) => ![NO_SKU, NO_ASIN, NO_PRODUCT].includes(r.key)
const stamp = (iso) => new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }).replace(/\//g, '-').replace(',', '')
const csvText = (rows) => rows.map(x => x.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')

const STATE = {
  loss: { label: 'Losing money', tone: 'alert' }, none: { label: 'No profit', tone: 'alert' }, low: { label: 'Margin under 10%', tone: 'warn' },
  unlinked: { label: 'Not linked', tone: 'warn' }, est: { label: 'Not costed yet', tone: 'info' }, ok: { label: 'Healthy', tone: 'live' },
}
const stateOf = (r) => (!linked(r) || (r.unlinked > 0 && r.unlinked === r.lines) ? 'unlinked'
  : r.profit < -0.004 ? 'loss' : r.sales > 0 && r.margin < 1 ? 'none' : r.sales > 0 && r.margin < 10 ? 'low' : r.cogsCurrent > 0 ? 'est' : 'ok')

export default function PnlPage({ savedProducts = [], stockItems = [], settings, purchaseOrders = [], inventory, onNavigate }) {
  const today = useMemo(londonToday, [])
  const [channel, setChannel] = useState('')
  const [periodId, setPeriodId] = useState('yesterday')
  const [custom, setCustom] = useState({ from: today, to: today })
  const [data, setData] = useState(null)        // { key, lines, parcels, bulk, costed_at, days, oh } for one span and channel
  const [error, setError] = useState(null)
  const [ohPeriod, setOhPeriod] = useState(null) // the period's overheads by category
  const [versions, setVersions] = useState([])
  const [stock, setStock] = useState(null)
  const [groupPick, setGroupPick] = useState(null)
  const [sort, setSort] = useState(null)
  const [chip, setChip] = useState('all')
  const [drawer, setDrawer] = useState(null)    // 'orders' | 'listings'

  const range = useMemo(() => periodRange(periodId, today, custom), [periodId, today, custom])
  const need = useMemo(() => spanFor(range), [range])
  const key = `${need.from}|${need.to}|${channel}`

  useEffect(() => { loadCostVersions('carrier').then(setVersions).catch(() => setVersions([])) }, [])
  useEffect(() => { loadStockReport(null).then(setStock).catch(() => setStock(null)) }, [])
  useEffect(() => {
    let live = true
    setError(null)
    Promise.all([
      loadPlLines(need.from, need.to, channel || null), loadPlDays(need.from, need.to, channel || null),
      channel ? null : loadOverheadsForPl(need.from, need.to),
      // The orders open in HELM count with today, so they are only wanted when the dates reach today
      need.to >= today ? loadPlOpen(channel || null) : null,
      // HELM's order tags never stop the page: without them every order is simply "tags not known"
      loadOrderTags(need.from, need.to, channel || null).catch(() => null),
      // v2.91.0: labels bought outside HELM, weights for orders with no listing, how listings really ship. Never stops the page
      loadPlShip(need.from, need.to, channel || null).catch(() => null),
      // v2.105.0: each product's own packaging, for website baskets. Never stops the page: without it a basket has none
      loadProductPackaging().catch(() => null),
      // v2.109.0: each order's postcode district, for the carriers' remote-zone prices. Never stops the page: without it every order costs mainland
      loadOrderDistricts(need.from, need.to).catch(() => null),
    ]).then(([pl, days, oh, open, tags, ship, prodPack, districts]) => { if (live) setData({ key, ...pl, lines: [...(pl.lines || []), ...(open?.lines || [])], days, oh, tags, ship: { ...(ship || {}), districts: districts || {} }, prodPack }) })
      .catch(e => { if (live) setError(e?.message || 'Could not load') })
    return () => { live = false }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setOhPeriod(null)
    if (channel) return
    let live = true
    loadOverheadsForPl(range.from, range.to).then(d => { if (live) setOhPeriod(d) })
    return () => { live = false }
  }, [range.from, range.to, channel])
  useEffect(() => { setChip('all'); setSort(null) }, [periodId, channel])

  const ready = data && data.key === key && settings
  const savedById = useMemo(() => new Map(savedProducts.map(r => [r.id, r])), [savedProducts])
  const siById = useMemo(() => new Map(stockItems.map(s => [s.id, s])), [stockItems])
  const worked = useMemo(() => (ready ? attachTags(buildPnl({ lines: data.lines, parcels: data.parcels, bulk: data.bulk || {}, ship: data.ship || null, productPackaging: data.prodPack?.rows || [], savedById, stockItems, settings, carrierVersions: versions, purchaseOrders }), data.tags) : null),
    [ready, data, settings, savedById, stockItems, versions, purchaseOrders])
  // Overheads count once the first one has been added, and only for the whole business
  const ohOn = !channel && !!data?.oh && Number(data.oh.set_up) > 0
  const ctx = useMemo(() => (worked ? { lines: worked, ohOn, extras: extrasByDay({ days: data.days, ohByDay: data.oh?.by_day, ohOn, fulByDay: data.oh?.fulfilment_by_day, chargeDays: data.ship?.charge_days }), orderCashback: data.ship?.order_cashback || null } : null), [worked, data, ohOn])

  const T = useMemo(() => (ctx ? summarise(ctx, range.from, range.to) : null), [ctx, range])
  const P = useMemo(() => (ctx && range.prev ? summarise(ctx, range.prev.from, range.prev.to) : null), [ctx, range])
  const W = useMemo(() => (ctx && need.weekBefore ? summarise(ctx, need.weekBefore.from, need.weekBefore.to) : null), [ctx, need])
  const M = useMemo(() => (ctx && need.monthToDate ? summarise(ctx, need.monthToDate.from, need.monthToDate.to) : null), [ctx, need])
  const series = useMemo(() => {
    if (!ctx) return null
    const rows = byDay(ctx, need.chartFrom, range.to)
    return rows.length > 45 ? { by: 'week', rows: byWeek(rows) } : { by: 'day', rows }
  }, [ctx, need, range])
  // v2.95.0 — the big card's "at a glance": the period's own days; for a single day, the 14 days up to it
  const atGlance = useMemo(() => {
    if (!ctx) return null
    const one = range.days === 1
    const g = glance(ctx, one ? need.chartFrom : range.from, range.to, { k: ohOn ? 'net' : 'gross', range, today })
    return g ? { ...g, one } : null
  }, [ctx, need, range, ohOn, today])
  const periodLines = useMemo(() => (worked ? worked.filter(l => l.sale_date >= range.from && l.sale_date <= range.to) : null), [worked, range])
  const listings = useMemo(() => (periodLines ? groupPnl(periodLines, 'listing') : []), [periodLines])
  const asins = useMemo(() => (periodLines ? groupPnl(periodLines, 'asin') : []), [periodLines])
  const products = useMemo(() => (periodLines ? groupByProduct(periodLines, stockItems) : []), [periodLines, stockItems])
  const prime = useMemo(() => (periodLines && channel === 'Amazon' ? primeSplit(periodLines) : null), [periodLines, channel])
  const lowMargin = useMemo(() => listings.filter(r => linked(r) && r.sales > 0 && r.margin < 10).sort((a, b) => a.margin - b.margin), [listings])

  // The headline: Net profit for the business; Gross profit for one channel (overheads are not a channel's)
  const head = ohOn ? { k: 'net', name: 'Net profit', margin: 'netMargin', marginName: 'net margin' } : { k: 'gross', name: 'Gross profit', margin: 'grossMargin', marginName: 'gross margin' }
  const periodName = PERIODS.find(p => p.id === periodId)?.label || 'Yesterday'
  const oneDay = range.from === range.to
  const title = oneDay ? longDay(range.from) : spanText(range.from, range.to)
  const dates = oneDay ? dayName(range.from) : spanText(range.from, range.to)
  const perDay = range.days > 1
  const openDay = (from, to = from) => { setCustom({ from: from < START ? START : from, to: to > today ? today : to }); setPeriodId('custom'); window.scrollTo?.({ top: 0, behavior: 'smooth' }) }

  // ── The breakdown table ────────────────────────────────────────────────────────────────────────────────────────
  const autoGroup = range.days <= 2 ? 'listing' : range.days <= 62 ? 'day' : 'month'
  const group = groupPick || autoGroup
  const timed = group === 'day' || group === 'month'
  const rows = useMemo(() => {
    if (!periodLines || !T) return null
    if (group === 'listing') return listings.map(r => ({ ...r, state: stateOf(r) }))
    if (group === 'asin') return asins.map(r => ({ ...r, state: stateOf(r) }))
    if (group === 'product') return products.map(r => ({ ...r, state: stateOf(r) }))
    if (group === 'tag') return groupByTag(periodLines)
    const base = groupPnl(periodLines, group)
    if (timed) {
      // each day's or month's share of what sits outside any one order, so the rows add up to the totals above
      const per = new Map()
      for (const [d, e] of ctx.extras) {
        if (d < range.from || d > range.to) continue
        const k = group === 'day' ? d : d.slice(0, 7)
        const g = per.get(k) || per.set(k, { other: 0, overheads: 0, fulfilOh: 0 }).get(k)
        g.other += e.charges - e.replacements - e.losses + (e.returnsCredit || 0); g.overheads += e.overheads; g.fulfilOh += e.fulfilOh || 0
      }
      const out = base.map(r => { const g = per.get(r.key) || { other: 0, overheads: 0, fulfilOh: 0 }; per.delete(r.key); const profit = r.profit + g.other; return { ...r, other: g.other, profit, margin: r.sales ? (profit / r.sales) * 100 : null, overheads: g.overheads, net: profit - g.overheads, fulfilment: r.shipping + r.packaging + g.fulfilOh } })
      for (const [k, g] of per) if (Math.abs(g.other) > 0.004 || Math.abs(g.overheads) > 0.004) out.push({ key: k, name: null, orders: 0, units: 0, sales: 0, refunds: 0, fees: 0, cogs: 0, shipping: 0, packaging: 0, margin: null, cogsCurrent: 0, shipEstimated: 0, unlinked: 0, lines: 0, other: g.other, profit: g.other, overheads: g.overheads, net: g.other - g.overheads, fulfilment: g.fulfilOh })
      return out
    }
    return base.map(r => { const other = T.channels.find(c => c.channel === r.key)?.charges || 0; const profit = r.profit + other; return { ...r, other, profit, margin: r.sales ? (profit / r.sales) * 100 : null } })
  }, [periodLines, T, group, timed, ctx, range, listings, asins, products])
  const useSort = sort || (timed ? { k: 'key', dir: 1 } : group === 'channel' || group === 'tag' ? { k: 'sales', dir: -1 } : { k: 'profit', dir: -1 })
  const named = group === 'listing' || group === 'asin' || group === 'product'
  const list = useMemo(() => {
    let r = rows || []
    if (named && chip !== 'all') r = r.filter(x => (chip === 'loss' ? ['loss', 'none'].includes(x.state) : chip === 'low' ? x.state === 'low' : chip === 'est' ? x.cogsCurrent > 0 : true))
    return [...r].sort((a, b) => {
      const va = a[useSort.k], vb = b[useSort.k]
      return (typeof va === 'string' || typeof vb === 'string' ? String(va ?? '').localeCompare(String(vb ?? '')) : (Number(va) || 0) - (Number(vb) || 0)) * useSort.dir
    })
  }, [rows, useSort, chip, named])
  const showOther = timed || group === 'channel'
  const showNet = timed && ohOn
  // what in a row is still an estimate (shown in full under a listing; as a hover note on a day or month)
  const notes = (r) => [r.unlinked > 0 && `${r.unlinked} not linked`, r.cogsCurrent > 0 && `${r.cogsCurrent} not costed yet`, r.shipEstimated > 0 && `${r.shipEstimated} shipping estimated`].filter(Boolean).join(' · ')
  const label = (r) => (group === 'month' ? monthName(r.key) : group === 'day' ? dayName(r.key) : group === 'channel' ? channelName(r.key) : group === 'product' ? r.name : r.key)
  const Th = ({ k, children, right = true }) => (
    <th className={`th ${right ? 'text-right' : 'text-left'} cursor-pointer select-none`} onClick={() => setSort({ k, dir: useSort.k === k ? -useSort.dir : (k === 'key' ? 1 : -1) })}>
      {children}{useSort.k === k ? (useSort.dir > 0 ? ' ↑' : ' ↓') : ''}
    </th>
  )
  const exportCsv = () => downloadCsv(`profit-and-loss-${group}-${range.from}-to-${range.to}.csv`, csvText([
    ['Group', 'Name', 'Orders', 'Units', 'Revenue ex VAT', 'Refunds', 'Fees', 'Cost of goods sold', 'Shipping', 'Packaging', ...(showOther ? ['Other charges, credits and replacements'] : []), 'Gross profit', 'Gross margin %', ...(showNet ? ['Overheads', 'Net profit', 'Fulfilment cost (shipping, packaging and the fulfilment share of overheads; already in the columns before)'] : [])],
    ...list.map(r => [label(r), group === 'product' ? '' : r.name || '', r.orders, r.units, r.sales.toFixed(2), r.refunds.toFixed(2), r.fees.toFixed(2), r.cogs.toFixed(2), r.shipping.toFixed(2), r.packaging.toFixed(2), ...(showOther ? [r.other.toFixed(2)] : []), r.profit.toFixed(2), r.margin == null ? '' : r.margin.toFixed(1), ...(showNet ? [r.overheads.toFixed(2), r.net.toFixed(2), (r.fulfilment || 0).toFixed(2)] : [])]),
  ]))

  // ── Stock: what is on the shelves and what is about to run out (the same rules as Stock Planning) ────────────────
  const running = useMemo(() => (inventory?.products || []).filter(p => p.active !== false).map(p => ({ p, st: stockState(p) }))
    .filter(x => (x.st.state === 'out' && x.st.daily > 0) || x.st.state === 'low').sort((a, b) => b.st.daily - a.st.daily), [inventory])
  const outNow = running.filter(x => x.st.state === 'out').length

  // ── From revenue to net profit: each line, its share of revenue, and the change in the amount ───────────────────
  const statement = useMemo(() => {
    if (!T || !(T.sales > 0)) return null
    const share = (v, t) => (t && t.sales > 0 ? (v / t.sales) * 100 : null)
    const row = (name, pick, extra = {}) => ({ name, ...extra, v: pick(T), share: share(pick(T), T), was: P ? pick(P) : null, wasShare: P ? share(pick(P), P) : null })
    const costs = [
      row('Cost of goods sold', t => t.cogs, { tone: 'bg-ink' }),
      row('Shipping', t => t.shipping, { tone: 'bg-muted' }),
      row('Fees', t => -t.fees, { tone: 'bg-[#9AA5B5]', hint: 'ex VAT' }),
      row('Packaging', t => t.packaging, { tone: 'bg-[#C9D0DA]' }),
      ...(channel ? [] : [row('Replacements', t => t.replacements, { tone: 'bg-[#E3E6EB]', hint: 'stock sent again' })]),
      row('Refunds', t => -t.refunds, { tone: 'bg-[#E3E6EB]' }),
      // v2.103.0 — advertising (eBay Promoted Listings…) on its own line; the charges line is what is left
      ...(T.advertising > 0.004 || (P && P.advertising > 0.004) ? [row('Advertising', t => t.advertising, { tone: 'bg-[#E3E6EB]' })] : []),
      // v2.111.0 — returns: Amazon's return postage and SAFE-T payments (moved out of the charges line, no total moves),
      // and the cost taken back off for units that came back and went on the shelf (at the cost they left at)
      ...(Math.abs(T.returnCharges) > 0.004 || (P && Math.abs(P.returnCharges) > 0.004) ? [row('Return postage and SAFE-T', t => -t.returnCharges, { tone: 'bg-[#E3E6EB]', hint: 'from the channels’ reports' })] : []),
      ...(!channel && (T.returnsCredit > 0.004 || (P && P.returnsCredit > 0.004)) ? [row('Returns back in stock', t => -t.returnsCredit, { tone: 'bg-[#E3E6EB]', hint: 'cost taken back off' })] : []),
      row(chargesOf(channel).name, t => -t.charges - t.advertising + t.returnCharges, { tone: 'bg-[#E3E6EB]', hint: chargesOf(channel).hint }),
      ...(T.losses > 0 ? [row('Stock losses and damages', t => t.losses, { tone: 'bg-[#E3E6EB]' })] : []),
    ]
    // v2.93.0 — what is inside a line, shown when it is opened: largest first, the small ones gathered at the end
    const inside = (pairs, keep = 8) => {
      const all = pairs.filter(([, v]) => Math.abs(v) >= 0.005).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
      const top = all.slice(0, keep), rest = all.slice(keep)
      return [...top.map(([name, v]) => ({ name, v })), ...(rest.length ? [{ name: `${rest.length} more`, v: rest.reduce((s, [, v]) => s + v, 0) }] : [])]
    }
    const byChan = (pick) => (!channel && T.channels.length > 1 ? inside(T.channels.map(c => [channelName(c.channel), pick(c)])) : null)
    const chargeKinds = new Map(), adKinds = new Map(), retKinds = new Map()
    for (const c of data?.ship?.charge_days || []) if (c.d >= range.from && c.d <= range.to) {
      const into = isAdvertising(c.what) ? adKinds : isReturnCharge(c.what) ? retKinds : chargeKinds
      const k = isAdvertising(c.what) && !channel ? `${channelName(c.channel)}: ${c.what}` : c.what
      into.set(k, (into.get(k) || 0) - Number(c.amount || 0))
    }
    const find = (name) => costs.find(c => c.name === name)
    find('Cost of goods sold').detail = inside(products.map(p => [p.name, p.cogs]))
    find('Shipping').detail = inside(Object.entries(T.shipBy || {}))
    find('Fees').detail = byChan(c => -c.fees)
    find('Refunds').detail = byChan(c => -c.refunds)
    find(chargesOf(channel).name).detail = chargeKinds.size ? inside([...chargeKinds.entries()]) : null
    if (find('Advertising')) find('Advertising').detail = adKinds.size ? inside([...adKinds.entries()]) : null
    if (find('Return postage and SAFE-T')) find('Return postage and SAFE-T').detail = retKinds.size ? inside([...retKinds.entries()]) : null
    if (find('Returns back in stock')) find('Returns back in stock').detail = T.returnedUnits ? [{ name: `${int(T.returnedUnits)} unit${T.returnedUnits === 1 ? '' : 's'} put back on the shelf`, v: -T.returnsCredit }] : null
    // the direct cost whose share of revenue grew most since the period before — the one to look at first
    const moved = costs.filter(c => c.wasShare != null && c.share - c.wasShare >= 0.5).sort((a, b) => (b.share - b.wasShare) - (a.share - a.wasShare))[0] || null
    return { costs, moved, revenue: row('Revenue', t => t.sales), direct: row('Direct costs', t => t.direct), gross: row('Gross profit', t => t.gross),
      overheads: ohOn ? row('Overheads', t => t.overheads) : null, net: ohOn ? row('Net profit', t => t.net) : null }
  }, [T, P, channel, ohOn, products, data, range])

  // v2.93.0 — once the big card has scrolled away, a slim bar stays at the top with the dates and the key figures
  const heroRef = useRef(null)
  const [stuck, setStuck] = useState(false)
  useEffect(() => {
    const el = heroRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return undefined
    const io = new IntersectionObserver(([e]) => setStuck(!e.isIntersecting && e.boundingClientRect.top < 0), { threshold: 0 })
    io.observe(el)
    return () => io.disconnect()
  }, [T != null, ready])  // eslint-disable-line react-hooks/exhaustive-deps
  const isGross = head.k === 'gross'

  const prevLine = range.prev ? `${range.prev.name} · ${spanText(range.prev.from, range.prev.to)}${range.prev.partial ? ' (figures start 1 Aug)' : ''}` : null
  const take = T ? -T.fees - T.charges : 0   // what a channel keeps for itself: its fees and its other charges, less its credits
  const takeWas = P ? -P.fees - P.charges : 0
  const caption = (r) => `${head.name.toLowerCase()} ${money(r[head.k])} · revenue ${money(r.sales)} · ${int(r.orders)} order${r.orders === 1 ? '' : 's'}`

  return (
    <div className="page-shell">
      <PageHeader eyebrow="Finance / Profit & Loss" title={title}
        description={`${periodName === 'Custom' ? 'Chosen dates' : periodName}${!oneDay ? ` · ${range.days} days` : ''}${range.running && periodId !== 'today' && range.to === today ? ' · up to today' : ''}. A day is the day the orders were despatched; orders still open count with today. All figures ex VAT.`}
        actions={data?.costed_at ? <span className="inline-flex items-center gap-2 text-xs font-semibold text-gain"><span className="w-2 h-2 rounded-full bg-gain" aria-hidden="true" />Costed {stamp(data.costed_at)}</span> : null} />

      <ChannelTabs value={channel} onChange={setChannel} />
      <PeriodPicker periodId={periodId} onPeriod={setPeriodId} custom={custom} onCustom={setCustom} today={today} />

      {/* v2.93.0 — stays at the top once the big card has scrolled out of sight: which dates, and the key figures */}
      {ready && T && (
        <div className="sticky top-14 lg:top-0 z-20 h-0" data-sticky-bar aria-hidden={!stuck}>
          <div className={`absolute inset-x-0 top-0 transition duration-150 ${stuck ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2 pointer-events-none'}`}>
            <div className="bg-ink text-white rounded-b-[8px] shadow-[0_6px_18px_rgba(11,27,51,0.25)] px-4 py-2.5 flex items-center gap-x-6 gap-y-1.5 flex-wrap">
              <div className="flex items-center gap-2 min-w-0">
                <Icon name="calendar" size={14} />
                <span className="text-sm font-semibold whitespace-nowrap">{periodName === 'Custom' ? 'Chosen dates' : periodName}</span>
                <span className="text-sm text-sky whitespace-nowrap">{dates}</span>
                <span className="text-xs text-sky/80 whitespace-nowrap">· {channel ? channelName(channel) : 'All channels'}</span>
              </div>
              <div className="flex items-baseline gap-x-5 gap-y-1 flex-wrap text-sm ml-auto">
                {ohOn && <span className="whitespace-nowrap"><span className="text-sky text-xs mr-1.5">Net profit</span><b className={`tabular-nums ${T.net < 0 ? 'text-[#FFB4A8]' : 'text-lime'}`}>{money0(T.net)}</b></span>}
                <span className="whitespace-nowrap"><span className="text-sky text-xs mr-1.5">Gross profit</span><b className={`tabular-nums ${T.gross < 0 ? 'text-[#FFB4A8]' : ''}`}>{money0(T.gross)}</b></span>
                <span className="whitespace-nowrap"><span className="text-sky text-xs mr-1.5">Revenue</span><b className="tabular-nums">{money0(T.sales)}</b></span>
                <span className="whitespace-nowrap"><span className="text-sky text-xs mr-1.5">Orders</span><b className="tabular-nums">{int(T.orders)}</b></span>
                <span className="whitespace-nowrap"><span className="text-sky text-xs mr-1.5">Units</span><b className="tabular-nums">{int(T.units)}</b></span>
              </div>
            </div>
          </div>
        </div>
      )}

      {error && <div className="card text-sm text-loss">{error}</div>}
      {!error && (!ready || !T) && <div className="surface flex justify-center py-16"><Spinner /></div>}

      {!error && ready && T && (
        <>
          {/* ── Headline: net profit and how it is shared, beside the period before; then the six figures ── */}
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-3 mb-3">
            <div ref={heroRef} className={`xl:col-span-4 ${isGross ? GROSS_HERO : 'bg-royal-500'} text-white rounded-card px-6 pt-5 pb-5 flex flex-col`} data-hero={head.k}>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="text-[11px] uppercase tracking-[0.08em] font-semibold text-sky">{head.name}{channel ? ` · ${channelName(channel)}` : ''}</div>
                {isGross && <span className="text-[10px] uppercase tracking-[0.08em] font-bold bg-lime text-ink rounded-[3px] px-1.5 py-0.5">Gross · before overheads</span>}
              </div>
              <div className="mt-2.5 inline-flex items-center gap-2 self-start rounded-[6px] bg-white/15 border border-white/25 px-3 py-1.5" data-hero-dates>
                <Icon name="calendar" size={14} />
                <span className="text-[15px] font-semibold text-white leading-none">{periodName === 'Custom' ? 'Chosen dates' : periodName}</span>
                <span className="text-[15px] text-sky leading-none">{dates}</span>
              </div>
              <div className="text-[52px] leading-none font-bold tabular-nums mt-3" style={{ letterSpacing: '-0.03em' }} title={money(T[head.k])}>{money0(T[head.k])}</div>
              <div className="w-24 h-1 bg-lime rounded-sm mt-3" />
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-sky mt-3">
                <span><b className="text-white font-semibold tabular-nums">{pct1(T[head.margin])}</b> {head.marginName}</span>
                {T.orders > 0 && <span><b className="text-white font-semibold tabular-nums">{money(T[head.k] / T.orders)}</b> an order</span>}
              </div>
              {ohOn && (
                <div className="mt-4 rounded-[6px] border border-white/25 px-3 py-2.5">
                  <div className="text-[10px] uppercase tracking-[0.08em] font-semibold text-sky mb-1.5">{T.net < 0 ? 'Net loss, split' : 'Net profit, split'}</div>
                  <div className="grid grid-cols-2 gap-3">
                    {splitOf(T.net).map(p => (
                      <div key={p.name}>
                        <div className="text-xl font-bold tabular-nums leading-tight" title={money(p.amount)}>{money0(p.amount)}</div>
                        <div className="text-xs text-sky">{p.name} · {Math.round(p.share * 100)}%</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {/* v2.95.0 — at a glance: what explains the figure above and is not on another card */}
              {atGlance && T.sales > 0 && (
                <div className="mt-4 flex-1 flex flex-col min-h-0" data-glance>
                  <div className="text-[10px] uppercase tracking-[0.08em] font-semibold text-sky mb-1.5">At a glance{atGlance.one && atGlance.days > 1 ? ` · the ${atGlance.days} days up to this one` : ''}</div>
                  <div className="text-sm text-sky leading-relaxed" data-glance-sum>
                    {ohOn
                      ? <>Gross profit <b className="text-white tabular-nums">{money0(T.gross)}</b> − overheads <b className="text-white tabular-nums">{money0(T.overheads)}</b> = <b className={`tabular-nums ${T.net < 0 ? 'text-[#FFB4A8]' : 'text-lime'}`}>{money0(T.net)}</b></>
                      : <>Revenue <b className="text-white tabular-nums">{money0(T.sales)}</b> − direct costs <b className="text-white tabular-nums">{money0(T.direct)}</b> = <b className={`tabular-nums ${T.gross < 0 ? 'text-[#FFB4A8]' : 'text-lime'}`}>{money0(T.gross)}</b></>}
                  </div>
                  {channel && statement && (() => {
                    const top = statement.costs.reduce((a, b) => (b.v > a.v ? b : a), statement.costs[0])
                    return (
                      <div className="text-sm text-sky leading-relaxed" data-glance-channel>
                        {channelName(channel)} takes <b className="text-white tabular-nums">{pct1((take / T.sales) * 100)}</b> of revenue · biggest cost: {top.name.toLowerCase()}, <b className="text-white tabular-nums">{pct1(top.share)}</b>
                      </div>
                    )
                  })()}
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 mt-3">
                    {!atGlance.one && atGlance.days > 1 && (
                      <div data-glance-perday>
                        <div className={`text-lg font-bold tabular-nums leading-tight ${atGlance.perDay < 0 ? 'text-[#FFB4A8]' : ''}`}>{money0(atGlance.perDay)}</div>
                        <div className="text-xs text-sky">{head.name.toLowerCase()} a day, on average</div>
                      </div>
                    )}
                    {atGlance.days > 1 && (
                      <div data-glance-days>
                        <div className="text-lg font-bold tabular-nums leading-tight">{atGlance.up} of {atGlance.days}</div>
                        <div className="text-xs text-sky">days made a {head.name.toLowerCase()}</div>
                      </div>
                    )}
                    {atGlance.days > 1 && (
                      <div data-glance-best>
                        <div className={`text-lg font-bold tabular-nums leading-tight ${atGlance.best.v < 0 ? 'text-[#FFB4A8]' : ''}`}>{money0(atGlance.best.v)}</div>
                        <div className="text-xs text-sky">best day · {dayName(atGlance.best.d)}</div>
                      </div>
                    )}
                    {atGlance.days > 1 && (
                      <div data-glance-worst>
                        <div className={`text-lg font-bold tabular-nums leading-tight ${atGlance.worst.v < 0 ? 'text-[#FFB4A8]' : ''}`}>{money0(atGlance.worst.v)}</div>
                        <div className="text-xs text-sky">worst day · {dayName(atGlance.worst.d)}</div>
                      </div>
                    )}
                  </div>
                  {atGlance.course && (
                    <div className="text-sm text-sky mt-3 leading-snug" data-glance-course title={`The average of the ${atGlance.course.fullDays} full days so far, over all ${atGlance.course.len} days. Today is left out: its orders are still coming in.`}>
                      At this pace the {atGlance.course.kind} ends at about <b className={`tabular-nums ${atGlance.course.amount < 0 ? 'text-[#FFB4A8]' : 'text-white'}`}>{money0(atGlance.course.amount)}</b>
                      <span className="text-sky/75"> · from {atGlance.course.fullDays} full days</span>
                    </div>
                  )}
                  {atGlance.days > 2 && <Spark rows={atGlance.rows} label={`${head.name} by day`} />}
                </div>
              )}
              <div className="mt-auto pt-4 text-sm">
                {P ? (
                  <div className="flex items-baseline justify-between gap-3 py-2.5 border-t border-white/20">
                    <span className="text-sky">{prevLine}</span>
                    <span className="whitespace-nowrap"><b className="tabular-nums" title={money(P[head.k])}>{money0(P[head.k])}</b> <span className="ml-2"><Delta now={T[head.k]} was={P[head.k]} light /></span></span>
                  </div>
                ) : <div className="py-2.5 border-t border-white/20 text-sky">Nothing to compare with: the figures start on 1 August 2026.</div>}
                {W && (
                  <div className="flex items-baseline justify-between gap-3 py-2.5 border-t border-white/20">
                    <span className="text-sky">Average of the {W.days} days before</span>
                    <span className="whitespace-nowrap"><b className="tabular-nums">{money0(W[head.k] / W.days)}</b> <span className="ml-2"><Delta now={T[head.k]} was={W[head.k] / W.days} light /></span></span>
                  </div>
                )}
                {M && (
                  <div className="flex items-baseline justify-between gap-3 pt-2.5 border-t border-white/20">
                    <span className="text-sky">Month to date · {spanText(M.from, M.to)}</span>
                    <span className="whitespace-nowrap"><b className="tabular-nums" title={money(M[head.k])}>{money0(M[head.k])}</b> <span className="text-sky ml-2">{pct1(M[head.margin])}</span></span>
                  </div>
                )}
                {!ohOn && <div className="text-xs text-sky/90 pt-3 leading-relaxed">{channel ? 'Overheads, replacements and stock losses belong to the whole business, so Net profit and its split show under All channels.' : 'No overheads have been added yet. Add them on the Overheads page and Net profit shows here.'}</div>}
              </div>
            </div>

            <div className="xl:col-span-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {/* v2.93.0 — with Net profit in the big card: Gross profit, Orders and units, Revenue, then the channels */}
              {ohOn ? (
                <Tile tone="gross" label="Gross profit" right={<span className="font-bold text-ink bg-ink/5 rounded-[4px] px-2 py-0.5 whitespace-nowrap">{pct1(T.grossMargin)} margin</span>}>
                  <div className={`text-[28px] leading-tight font-bold tabular-nums ${T.gross < 0 ? 'text-loss' : ''}`} title={money(T.gross)}>{money0(T.gross)}</div>
                  <div className="text-[13px] text-ink mt-1">after {money0(T.direct)} of direct costs</div>
                  {P && <div className="text-xs text-ink/55 mt-auto pt-3">{range.prev.name}: {money0(P.gross)} · {pct1(P.grossMargin)} <span className="ml-1"><Delta now={T.gross} was={P.gross} /></span></div>}
                </Tile>
              ) : (
                <Tile label="Revenue" right={P ? <ChangeChip now={T.sales} was={P.sales} /> : null}>
                <div className="text-[28px] leading-tight font-bold tabular-nums" title={money(T.sales)}>{money0(T.sales)}</div>
                <div className="text-[13px] text-ink mt-1">{T.orders > 0 ? `${money(T.sales / T.orders)} an order` : 'No orders'}{perDay && ` · ${money0(T.sales / range.days)} a day`}</div>
                {T.openOrders > 0 && <div className="text-xs text-warn mt-1">{money0(T.openSales)} of it from open orders</div>}
                {P && <div className="text-xs text-ink/55 mt-auto pt-3">{range.prev.name}: {money0(P.sales)}</div>}
                </Tile>

              )}

              <Tile label="Orders and units" right={P ? <ChangeChip now={T.orders} was={P.orders} /> : null}>
                <div className="grid grid-cols-2 gap-3" data-orders-units>
                  <div><div className="text-[28px] leading-tight font-bold tabular-nums">{int(T.orders)}</div><div className="text-[13px] text-ink">order{T.orders === 1 ? '' : 's'}</div></div>
                  <div className="border-l border-rule pl-3"><div className="text-[28px] leading-tight font-bold tabular-nums">{int(T.units)}</div><div className="text-[13px] text-ink">unit{T.units === 1 ? '' : 's'} sold</div></div>
                </div>
                <div className="text-[13px] text-ink mt-1.5">{T.orders > 0 ? `${(T.units / T.orders).toFixed(2)} units an order` : 'No orders'}{perDay && ` · ${int(T.orders / range.days)} orders and ${int(T.units / range.days)} units a day`}</div>
                {prime && prime.prime.orders + prime.other.orders > 0 && <div className="text-xs text-ink/55 mt-1">Prime {int(prime.prime.orders)} · not Prime {int(prime.other.orders)}{prime.unknown.orders > 0 && ` · not known ${int(prime.unknown.orders)}`}</div>}
                {T.openOrders > 0 && <div className="text-xs text-warn mt-1">{int(T.openOrders)} still open in HELM, not despatched</div>}
                {P && <div className="text-xs text-ink/55 mt-auto pt-3">{range.prev.name}: {int(P.orders)} orders · {int(P.units)} units</div>}
              </Tile>

              {ohOn ? (
                <Tile label="Revenue" right={P ? <ChangeChip now={T.sales} was={P.sales} /> : null}>
                <div className="text-[28px] leading-tight font-bold tabular-nums" title={money(T.sales)}>{money0(T.sales)}</div>
                <div className="text-[13px] text-ink mt-1">{T.orders > 0 ? `${money(T.sales / T.orders)} an order` : 'No orders'}{perDay && ` · ${money0(T.sales / range.days)} a day`}</div>
                {T.openOrders > 0 && <div className="text-xs text-warn mt-1">{money0(T.openSales)} of it from open orders</div>}
                {P && <div className="text-xs text-ink/55 mt-auto pt-3">{range.prev.name}: {money0(P.sales)}</div>}
                </Tile>

              ) : (
                <Tile label="Direct costs" right={T.sales > 0 ? <span className="font-bold text-ink bg-ink/5 rounded-[4px] px-2 py-0.5 whitespace-nowrap">{pct1((T.direct / T.sales) * 100)} of revenue</span> : null}>
                  <div className="text-[28px] leading-tight font-bold tabular-nums" title={money(T.direct)}>{money0(T.direct)}</div>
                  <div className="text-[13px] text-ink mt-1">cost of goods sold, shipping, fees, packaging, refunds</div>
                  {P && <div className="text-xs text-ink/55 mt-auto pt-3">{range.prev.name}: {money0(P.direct)}{P.sales > 0 && ` · ${pct1((P.direct / P.sales) * 100)}`}</div>}
                </Tile>
              )}

              {!channel ? (
                <Tile tone="gross" label="Channels" right="Click one to open it" className="!px-4 sm:col-span-2 lg:row-span-2" >
                  {T.channels.length === 0 && <div className="text-sm text-ink/50 py-3">No sales in these dates.</div>}
                  {/* v2.94.1 — a real table: every column is as wide as its longest figure, so a six-figure revenue can
                      never run into the next column, and the headings sit over their figures whatever the numbers are.
                      The card is two tiles wide (and two high beside Losing money and How sure) so it always has room. */}
                  {T.channels.length > 0 && (
                    <div className="overflow-x-auto -mx-1 px-1">
                    <table className="w-full border-collapse text-sm" data-channel-table>
                      <thead>
                        <tr className="text-[10px] uppercase tracking-[0.08em] font-semibold text-ink/50" data-channel-head>
                          <th className="uppercase tracking-[0.08em] text-[10px] text-left font-semibold pb-1.5 pl-1">Channel</th>
                          <th className="uppercase tracking-[0.08em] text-[10px] text-right font-semibold pb-1.5 pl-3">Revenue</th>
                          <th className="uppercase tracking-[0.08em] text-[10px] text-right font-semibold pb-1.5 pl-3 sm:whitespace-nowrap">Gross profit</th>
                          <th className="uppercase tracking-[0.08em] text-[10px] text-right font-semibold pb-1.5 pl-3 pr-1">Margin</th>
                        </tr>
                      </thead>
                      <tbody>
                        {T.channels.map(c => {
                          const open = () => setChannel(CHANNELS.includes(c.channel) ? c.channel : '')
                          return (
                            <tr key={c.channel} role="button" tabIndex={0} title={`Open ${channelName(c.channel)}`} onClick={open}
                              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open() } }}
                              className="border-t border-royal-200 cursor-pointer hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-royal-500" data-channel-row>
                              <td className="py-2 pl-1 align-middle"><b className="text-ink">{channelName(c.channel)}</b><br /><span className="text-xs text-ink/50 whitespace-nowrap">{int(c.orders)} order{c.orders === 1 ? '' : 's'}</span></td>
                              <td className="py-2 pl-3 text-right tabular-nums whitespace-nowrap align-middle">{money0(c.sales)}</td>
                              <td className={`py-2 pl-3 text-right tabular-nums whitespace-nowrap align-middle font-bold ${c.gross < 0 ? 'text-loss' : ''}`}>{money0(c.gross)}</td>
                              <td className={`py-2 pl-3 pr-1 text-right tabular-nums whitespace-nowrap align-middle ${c.margin != null && c.margin < 10 ? 'text-loss' : ''}`}>{pct1(c.margin)}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                    </div>
                  )}
                  {T.replacements > 0 && <div className="text-xs text-ink/50 mt-auto pt-3">Before {money(T.replacements)} of replacements, which are not split by channel.</div>}
                </Tile>
              ) : (
                <Tile label={`What ${channelName(channel) || 'the channel'} takes`} right={P && P.sales > 0 && T.sales > 0 ? <Delta now={(take / T.sales) * 100} was={(takeWas / P.sales) * 100} fmt={v => `${v.toFixed(1)} pts`} goodUp={false} eps={0.05} /> : null}>
                  <div className="text-[28px] leading-tight font-bold tabular-nums">{T.sales > 0 ? pct1((take / T.sales) * 100) : '—'}</div>
                  <div className="text-[13px] text-ink mt-1">of revenue: {money0(take)} in fees and charges</div>
                  <div className="text-xs text-ink/55 mt-1">Fees {money(-T.fees)}{T.advertising > 0.004 ? ` · advertising ${money(T.advertising)}` : ''} · other charges and credits {money(-T.charges - T.advertising)}</div>
                  {P && P.sales > 0 && <div className="text-xs text-ink/55 mt-auto pt-3">{range.prev.name}: {pct1((takeWas / P.sales) * 100)} · {money0(takeWas)}</div>}
                </Tile>
              )}

              <Tile label="Losing money" right={T.losing.length || lowMargin.length ? <span className="font-bold text-warn bg-[#FBF5E6] rounded-[4px] px-2 py-0.5">Check</span> : <span className="font-bold text-gain bg-[#EEF7F2] rounded-[4px] px-2 py-0.5">Nothing</span>}>
                <div className="grid grid-cols-2 gap-3">
                  <button type="button" className="text-left rounded-[4px] hover:bg-paper -m-1 p-1 disabled:hover:bg-transparent" disabled={!T.losing.length} onClick={() => setDrawer('orders')}>
                    <div className={`text-[28px] leading-tight font-bold tabular-nums ${T.losing.length ? 'text-loss' : 'text-ink/40'}`}>{int(T.losing.length)}</div>
                    <div className="text-[13px] text-ink leading-snug">order{T.losing.length === 1 ? '' : 's'} lost money</div>
                    <div className="text-xs text-ink/55">{T.orders ? `${((T.losing.length / T.orders) * 100).toFixed(1)}% · ` : ''}{money(T.losingTotal)} · after cashback</div>
                    {T.savedByCredit > 0 && <div className="text-xs text-gain" data-saved-by-credit title="Orders that would have lost money on their own, but their cashback covered it. They are not counted as losses.">{int(T.savedByCredit)} more covered by cashback</div>}
                    {T.losing.length > 0 && <div className="text-xs font-semibold text-royal-500 mt-1.5">Open the orders</div>}
                  </button>
                  <button type="button" className="text-left rounded-[4px] hover:bg-paper -m-1 p-1 disabled:hover:bg-transparent" disabled={!lowMargin.length} onClick={() => setDrawer('listings')}>
                    <div className={`text-[28px] leading-tight font-bold tabular-nums ${lowMargin.length ? 'text-warn' : 'text-ink/40'}`}>{int(lowMargin.length)}</div>
                    <div className="text-[13px] text-ink leading-snug">listing{lowMargin.length === 1 ? '' : 's'} under 10%</div>
                    <div className="text-xs text-ink/55">of {int(listings.filter(r => r.sales > 0).length)} that sold</div>
                    {lowMargin.length > 0 && <div className="text-xs font-semibold text-royal-500 mt-1.5">Open the listings</div>}
                  </button>
                </div>
              </Tile>

              <Sure T={T} onListings={() => { setGroupPick('listing'); setSort(null); setChip('est'); document.getElementById('pnl-breakdown')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }} />
            </div>
          </div>

          {/* ── From revenue to net profit, as a share of revenue, against the period before · net profit by day ── */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 mb-3">
            <Tile label={ohOn ? 'From revenue to net profit' : 'From revenue to gross profit'} right={P ? `Compared with ${range.prev.name.toLowerCase()} · ${spanText(range.prev.from, range.prev.to)}` : null} className="lg:col-span-7">
              {!statement && <div className="text-sm text-ink/55 py-6">No revenue in these dates{ohOn && T.overheads > 0 ? `; the overheads were ${money(T.overheads)}, so net profit is ${money(T.net)}` : ''}.</div>}
              {statement && (
                <>
                  <div className="flex h-3.5 rounded-[3px] overflow-hidden mb-3 bg-royal-500" aria-hidden="true">
                    {statement.costs.filter(c => c.share > 0).map(c => <span key={c.name} className={c.tone} style={{ width: `${c.share}%` }} />)}
                    {statement.overheads && <span className="bg-royal-200" style={{ width: `${Math.max(0, statement.overheads.share)}%` }} />}
                  </div>
                  <div className="overflow-x-auto">
                    <div className="min-w-[440px] text-sm">
                      <div className={`grid ${P ? COLS5 : COLS3} gap-x-2 text-[10px] uppercase tracking-[0.08em] font-semibold text-ink/45 pb-1.5`}>
                        <span /><span className="text-right">{periodName === 'Custom' ? 'These dates' : periodName}</span><span className="text-right">% of revenue</span>
                        {P && <><span className="text-right whitespace-nowrap">{spanText(range.prev.from, range.prev.to)}</span><span className="text-right">Change</span></>}
                      </div>
                      <StatementRow r={statement.revenue} hasPrev={!!P} strong line share="100%" />
                      {statement.costs.map(c => <StatementRow key={c.name} r={c} hasPrev={!!P} cost flag={statement.moved === c} sales={T.sales} />)}
                      <StatementRow r={statement.direct} hasPrev={!!P} cost semi line />
                      <StatementRow r={statement.gross} hasPrev={!!P} strong line={!ohOn ? 'heavy' : true} tone={ohOn ? null : 'bg-royal-500'} />
                      {ohOn && (
                        <>
                          <StatementRow r={{ ...statement.overheads, tone: 'bg-royal-200', hint: 'fixed costs, by days', detail: ohPeriod ? Object.entries(ohPeriod.by_category || {}).sort((a, b) => b[1] - a[1]).map(([c, v]) => ({ name: categoryLabel(c), v })) : null }} hasPrev={!!P} cost sales={T.sales} />
                          <StatementRow r={statement.net} hasPrev={!!P} strong big line="heavy" tone="bg-royal-500" />
                        </>
                      )}
                    </div>
                  </div>
                  {P && <div className="text-xs text-ink/45 mt-3 leading-relaxed">Change is the rise or fall in the amount. A cost is red when it took a bigger share of revenue than before and green when it took a smaller one.</div>}
                </>
              )}
              {!channel && (T.returned > 0 || T.startup > 0 || T.lossesBefore > 0) && (
                <div className="mt-3 pt-3 border-t border-rule text-xs text-ink/60">
                  <span className="text-[11px] uppercase tracking-[0.08em] font-semibold text-muted mr-2">Not in the P&L</span>
                  {[T.returned > 0 && `Returned to supplier ${money(T.returned)} (covered by the credit note)`, T.startup > 0 && `Start-up differences ${money(T.startup)}`, T.lossesBefore > 0 && `Removed and damaged stock ${money(T.lossesBefore)} (counted from 1 Dec)`].filter(Boolean).join(' · ')}
                </div>
              )}
            </Tile>

            <Tile tone={isGross ? 'gross' : null} label={`${head.name} by ${series.by}`} right={series.by === 'day' && oneDay ? 'The 14 days up to this one' : ohOn ? `After each ${series.by}’s overheads` : null} className="lg:col-span-5">
              <Bars rows={series.rows} k={head.k} by={series.by} from={series.by === 'week' ? series.rows.find(r => r.to >= range.from)?.d || range.from : range.from} caption={caption} onPick={(r) => openDay(r.d, r.to || r.d)} />
              <ChartFacts rows={series.rows} k={head.k} by={series.by} name={head.name} total={T[head.k]} show={!oneDay} />
            </Tile>
          </div>

          {/* ── Fulfilment cost (v2.100.0): what it cost to store, pick, pack and send the period's orders ── */}
          {ohOn && T.fulfilment != null && (() => {
            const F = T.fulfilment, parts = [
              { k: 'ship', name: 'Shipping', hint: 'the carriers', v: T.shipping, tone: 'bg-royal-500' },
              { k: 'pack', name: 'Packaging', hint: 'boxes, bags, tape', v: T.packaging, tone: 'bg-royal-200' },
              { k: 'oh', name: 'Warehouse and staff', hint: 'the overheads marked as fulfilment', v: T.fulfilOh, tone: 'bg-ink' },
            ]
            return (
              <Tile label="Fulfilment cost" className="mb-3" right={T.sales > 0 ? <span className="font-bold text-ink bg-ink/5 rounded-[4px] px-2 py-0.5 whitespace-nowrap">{pct1((F / T.sales) * 100)} of revenue</span> : null}>
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-x-8 gap-y-4" data-fulfilment>
                  <div className="lg:col-span-3 flex flex-col min-w-0">
                    <div className="text-[28px] leading-tight font-bold tabular-nums" title={money(F)} data-fulfilment-total>{money0(F)}</div>
                    <div className="text-[13px] text-ink mt-1">to store, pick, pack and send {int(T.orders)} order{T.orders === 1 ? '' : 's'}</div>
                    {P && P.fulfilment != null && <div className="text-xs text-ink/55 mt-auto pt-3">{range.prev.name}: {money0(P.fulfilment)} <span className="ml-1"><Delta now={F} was={P.fulfilment} goodUp={false} /></span></div>}
                  </div>
                  <div className="lg:col-span-3 grid grid-cols-3 lg:grid-cols-1 gap-3 lg:border-l lg:border-rule lg:pl-6 min-w-0">
                    <div>
                      <div className="text-[22px] leading-tight font-bold tabular-nums" data-fulfilment-order>{T.fulfilmentPerOrder != null ? money(T.fulfilmentPerOrder) : '—'}</div>
                      <div className="text-[13px] text-ink">an order{P?.fulfilmentPerOrder != null && T.fulfilmentPerOrder != null && <span className="text-xs text-ink/55"> · was {money(P.fulfilmentPerOrder)} <Delta now={T.fulfilmentPerOrder} was={P.fulfilmentPerOrder} goodUp={false} fmt={money} eps={0.005} /></span>}</div>
                    </div>
                    <div>
                      <div className="text-[22px] leading-tight font-bold tabular-nums">{T.fulfilmentPerUnit != null ? money(T.fulfilmentPerUnit) : '—'}</div>
                      <div className="text-[13px] text-ink">a unit sold</div>
                    </div>
                    <div title={T.parcels > 0 ? `${int(T.parcels)} parcels: the labels bought, and what the listing sends where there is no label yet` : undefined}>
                      <div className="text-[22px] leading-tight font-bold tabular-nums" data-fulfilment-parcel>{T.fulfilmentPerParcel != null ? money(T.fulfilmentPerParcel) : '—'}</div>
                      <div className="text-[13px] text-ink">a parcel{P?.fulfilmentPerParcel != null && T.fulfilmentPerParcel != null && <span className="text-xs text-ink/55"> · was {money(P.fulfilmentPerParcel)}</span>}</div>
                    </div>
                  </div>
                  <div className="lg:col-span-6 lg:border-l lg:border-rule lg:pl-6 min-w-0">
                    <div className="flex h-2 rounded-sm overflow-hidden bg-ink/5 mb-3" aria-hidden="true">
                      {parts.map(p => <span key={p.k} className={p.tone} style={{ width: `${F > 0 ? Math.max(0, (p.v / F) * 100) : 0}%` }} />)}
                    </div>
                    <table className="w-full border-collapse text-sm" data-fulfilment-parts>
                      <tbody>
                        {parts.map(p => (
                          <tr key={p.k} className="border-t border-rule first:border-t-0">
                            <td className="py-1.5 pr-3"><span className={`inline-block w-2 h-2 rounded-[2px] mr-2 ${p.tone}`} /><b className="text-ink font-semibold">{p.name}</b> <span className="hidden sm:inline text-xs text-ink/50">{p.hint}</span></td>
                            <td className="py-1.5 pl-3 text-right tabular-nums whitespace-nowrap font-semibold">{money0(p.v)}</td>
                            <td className="py-1.5 pl-3 text-right tabular-nums whitespace-nowrap text-ink/55 w-14">{F > 0 ? pct1((p.v / F) * 100) : '—'}</td>
                            <td className="hidden sm:table-cell py-1.5 pl-3 text-right tabular-nums whitespace-nowrap text-ink/55">{T.orders > 0 ? `${money(p.v / T.orders)} an order` : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="text-xs text-ink/55 mt-2">
                      {T.fulfilOh > 0 ? 'Every part is already in the figures above; this only groups them. ' : <span className="text-warn">No overhead is marked as a fulfilment cost yet, so this is shipping and packaging only. </span>}
                      Choose which overheads count in Finance → Overheads (open one, then Fulfilment share).
                    </div>
                  </div>
                </div>
              </Tile>
            )
          })()}

          {/* ── Channels · refunds and replacements · stock ── */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mb-3">
            {ohOn && (
                <Tile label={perDay ? 'Break-even revenue a day' : 'Break-even revenue'}
                  right={T.breakEven != null ? <span className={`font-bold rounded-[4px] px-2 py-0.5 whitespace-nowrap ${T.sales >= T.breakEven ? 'text-gain bg-[#EEF7F2]' : 'text-loss bg-[#FCEFED]'}`}>{T.sales >= T.breakEven ? 'Cleared' : 'Short'}</span> : null}>
                  {T.breakEven != null ? (
                    <>
                      <div className="text-[28px] leading-tight font-bold tabular-nums">{money0(T.breakEven / range.days)}</div>
                      <div className="relative h-2 rounded bg-royal-200 mt-3 mb-1" aria-hidden="true">
                        <div className="absolute inset-y-0 left-0 rounded bg-royal-500" style={{ width: `${Math.min(100, (T.sales / Math.max(T.sales, T.breakEven)) * 100)}%` }} />
                        <div className="absolute -top-1.5 w-0.5 h-5 bg-ink" style={{ left: `${Math.min(100, (T.breakEven / Math.max(T.sales, T.breakEven)) * 100)}%` }} />
                      </div>
                      <div className={`text-[13px] font-semibold mt-1 ${T.sales >= T.breakEven ? 'text-gain' : 'text-loss'}`}>{T.sales >= T.breakEven ? 'Cleared by' : 'Short by'} {money0(Math.abs(T.sales - T.breakEven) / range.days)}{perDay ? ' a day' : ''}</div>
                      <div className="text-xs text-ink/55 mt-auto pt-2">Overheads {money0(T.overheads / range.days)}{perDay ? ' a day' : ''} ÷ {pct1(T.grossMargin)} gross margin</div>
                    </>
                  ) : (
                    <>
                      <div className="text-[28px] leading-tight font-bold text-loss">Not reached</div>
                      <div className="text-xs text-ink/55 mt-auto pt-2">{T.sales > 0 ? 'Direct costs took all the revenue, so no amount of it would cover the overheads.' : `No revenue in these dates; the overheads were ${money0(T.overheads)}.`}</div>
                    </>
                  )}
                </Tile>
            )}
            <Tile label="Refunds and replacements" right="As a share of orders">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-[28px] leading-tight font-bold tabular-nums">{int(T.refundOrders)}</div>
                  <div className="text-[13px] text-ink">refund{T.refundOrders === 1 ? '' : 's'}</div>
                  <div className="text-xs text-ink/55">{T.orders ? `${((T.refundOrders / T.orders) * 100).toFixed(1)}% · ` : ''}{money(-T.refunds)}</div>
                </div>
                {!channel && (
                  <div>
                    <div className="text-[28px] leading-tight font-bold tabular-nums">{int(T.replacementOrders)}</div>
                    <div className="text-[13px] text-ink">replacement{T.replacementOrders === 1 ? '' : 's'} sent</div>
                    <div className="text-xs text-ink/55">{T.orders ? `${((T.replacementOrders / T.orders) * 100).toFixed(1)}% · ` : ''}{money(T.replacements)} · {int(T.replacementUnits)} units</div>
                  </div>
                )}
              </div>
              {P && (
                <div className="mt-auto pt-3">
                  <div className="text-[10px] uppercase tracking-[0.08em] font-semibold text-ink/45 pt-2 pb-1 border-t border-rule">{range.prev.name} · {int(P.orders)} orders</div>
                  <div className="flex justify-between text-sm py-1"><span className="text-ink/70">Refunds</span><span className="tabular-nums"><b>{int(P.refundOrders)}</b>{P.orders ? ` · ${((P.refundOrders / P.orders) * 100).toFixed(1)}%` : ''} · {money(-P.refunds)}</span></div>
                  {!channel && <div className="flex justify-between text-sm py-1"><span className="text-ink/70">Replacements</span><span className="tabular-nums"><b>{int(P.replacementOrders)}</b>{P.orders ? ` · ${((P.replacementOrders / P.orders) * 100).toFixed(1)}%` : ''} · {money(P.replacements)}</span></div>}
                </div>
              )}
            </Tile>

            {prime && <PrimeTile s={prime} knownFrom={data.tags?.known_from} />}

            {!channel && (
              <Tile label="Stock" right="Today">
                <div className="grid grid-cols-2 gap-4">
                  <button type="button" className="text-left rounded-[4px] hover:bg-paper -m-1 p-1" onClick={() => onNavigate?.('stock-value')}>
                    <div className="text-[28px] leading-tight font-bold tabular-nums">{stock ? money0(stock.value) : '—'}</div>
                    <div className="text-[13px] text-ink">value on hand</div>
                    <div className="text-xs text-ink/55">{stock ? `${int(stock.units)} units · pre-live stock ${money0(stock.prelive?.value_left)} of it` : 'Loading…'}</div>
                  </button>
                  <button type="button" className="text-left rounded-[4px] hover:bg-paper -m-1 p-1" onClick={() => onNavigate?.('stock-planning')}>
                    <div className={`text-[28px] leading-tight font-bold tabular-nums ${running.length ? 'text-warn' : 'text-ink/40'}`}>{inventory ? int(running.length) : '—'}</div>
                    <div className="text-[13px] text-ink">out, or to order now</div>
                    <div className="text-xs text-ink/55">{int(outNow)} out of stock · {int(running.length - outNow)} to order now</div>
                  </button>
                </div>
                <div className="mt-auto pt-3">
                  {running.slice(0, 3).map(({ p, st }) => (
                    <div key={p.id} className="flex justify-between gap-3 py-1.5 border-t border-rule/70 text-sm">
                      <span className="text-ink">{p.name}</span>
                      <span className={`whitespace-nowrap font-semibold ${st.state === 'out' ? 'text-loss' : 'text-warn'}`}>{st.state === 'out' ? `Out · sells ${st.daily.toFixed(st.daily < 10 ? 1 : 0)} a day` : `${int(p.available)} left · ${fmtDays(st.cover)}`}</span>
                    </div>
                  ))}
                </div>
              </Tile>
            )}
          </div>

          {/* ── Best and worst by gross profit ── */}
          <Performers listings={listings} asins={asins} products={products} />

          {/* ── The breakdown ── */}
          <div id="pnl-breakdown" className="table-shell overflow-x-auto mt-3">
            <div className="flex flex-wrap items-center gap-2.5 px-4 py-2.5 border-b border-rule">
              <span className="text-xs text-ink/45">Break down by</span>
              <SegmentedControl label="Break down by" items={GROUPS} value={group} onChange={(g) => { setGroupPick(g); setSort(null); setChip('all') }} />
              {named && (
                <div className="flex flex-wrap gap-1.5">
                  {[['all', 'All'], ['loss', 'Losing money'], ['low', 'Margin under 10%'], ['est', 'Not costed yet']].map(([id, name]) => (
                    <button key={id} type="button" aria-pressed={chip === id} onClick={() => setChip(id)}
                      className={`text-xs font-medium px-2.5 py-1.5 rounded-full border ${chip === id ? 'bg-royal-500 border-royal-500 text-white' : 'bg-white border-rule text-ink/70 hover:border-royal-200'}`}>{name}</button>
                  ))}
                </div>
              )}
              <span className="text-xs text-ink/50 sm:ml-auto">{list.length} row{list.length !== 1 ? 's' : ''}</span>
              <button className="btn btn-secondary btn-xs" onClick={exportCsv} disabled={!list.length}><Icon name="download" size={13} /> Export CSV</button>
            </div>
            <table className={`w-full ${showNet ? 'min-w-[1100px] [&_td]:px-2 [&_th]:px-2' : named ? 'min-w-[1040px]' : 'min-w-[1080px]'} border-collapse`}>
              <thead className="table-head">
                <tr>
                  <Th k="key" right={false}>{GROUPS.find(g => g.id === group)?.label}</Th>
                  {!named && <Th k="orders">Orders</Th>}{!showNet && <Th k="units">Units</Th>}<Th k="sales">Revenue</Th>
                  {named ? <th className="th text-left">Where each £1 goes</th> : <Th k="refunds">Refunds</Th>}
                  <Th k="fees">Fees</Th><Th k="cogs">Cost of goods sold</Th><Th k="shipping">Shipping</Th><Th k="packaging">Packaging</Th>
                  {showOther && <Th k="other">Other</Th>}
                  <Th k="profit">Gross profit</Th><Th k="margin">Gross margin</Th>
                  {showNet && <><Th k="overheads">Overheads</Th><Th k="net">Net profit</Th></>}
                </tr>
              </thead>
              <tbody>
                {list.map(r => (
                  <tr key={r.key} className="table-row">
                    <td className="td">
                      {named ? (
                        <div className="min-w-[250px] max-w-[420px]">
                          <div className="flex items-start gap-2 flex-wrap">
                            {group === 'product'
                              ? <NameLink kind="product" id={r.product_id} name={r.name} className="text-sm font-semibold text-ink" />
                              : <span className="text-sm font-semibold text-ink break-words">{r.key}</span>}
                            <StatusBadge tone={STATE[r.state].tone}>{STATE[r.state].label}</StatusBadge>
                          </div>
                          {group === 'listing' && <div className="text-xs text-ink/60 mt-1 leading-snug">{r.listing_id ? <NameLink kind="listing" id={r.listing_id} name={r.name} /> : <span className="text-warn">No listing for this SKU</span>}</div>}
                          {group === 'asin' && r.name && <div className="text-xs text-ink/60 mt-1 leading-snug">{r.name}</div>}
                          {group !== 'product' && r.asin && linked(r) && <div className="mt-1"><AmazonLink asin={r.asin} label={r.asin} /></div>}
                        </div>
                      ) : group === 'day'
                        ? <button type="button" className="text-sm font-semibold text-ink whitespace-nowrap hover:text-royal-500 hover:underline" title="Open this day" onClick={() => openDay(r.key)}>{label(r)}</button>
                        : <span className="text-sm font-semibold text-ink whitespace-nowrap">{label(r)}</span>}
                      {notes(r) && <div className={`text-[11px] text-ink/45 mt-1 ${timed ? 'whitespace-nowrap' : ''}`} title={notes(r)}>{timed ? 'Part estimated' : notes(r)}</div>}
                    </td>
                    {!named && <td className="td text-right tabular-nums whitespace-nowrap">{int(r.orders)}</td>}
                    {!showNet && <td className="td text-right tabular-nums whitespace-nowrap">{int(r.units)}</td>}
                    <td className="td text-right tabular-nums whitespace-nowrap font-medium">{money(r.sales)}</td>
                    {named ? <td className="td"><Split r={r} /></td> : <td className="td text-right tabular-nums whitespace-nowrap text-loss">{r.refunds ? money(r.refunds) : '—'}</td>}
                    <td className="td text-right tabular-nums whitespace-nowrap text-loss">{money(r.fees)}</td>
                    <td className="td text-right tabular-nums whitespace-nowrap text-loss">{money(-r.cogs)}</td>
                    <td className="td text-right tabular-nums whitespace-nowrap text-loss">{money(-r.shipping)}</td>
                    <td className="td text-right tabular-nums whitespace-nowrap text-loss">{money(-r.packaging)}</td>
                    {showOther && <td className={`td text-right tabular-nums whitespace-nowrap ${r.other < 0 ? 'text-loss' : 'text-ink/70'}`}>{Math.abs(r.other) > 0.004 ? money(r.other) : '—'}</td>}
                    <td className={`td text-right tabular-nums whitespace-nowrap font-semibold ${r.profit >= 0 ? 'text-gain' : 'text-loss'}`}>{money(r.profit)}</td>
                    <td className={`td text-right tabular-nums whitespace-nowrap ${r.margin != null && r.margin < 10 ? 'text-loss' : 'text-ink'}`}>{pct1(r.margin)}</td>
                    {showNet && <>
                      <td className="td text-right tabular-nums whitespace-nowrap text-loss">{r.overheads ? money(-r.overheads) : '—'}</td>
                      <td className={`td text-right tabular-nums whitespace-nowrap font-semibold ${r.net >= 0 ? 'text-gain' : 'text-loss'}`}>{money(r.net)}</td>
                    </>}
                  </tr>
                ))}
              </tbody>
            </table>
            {!list.length && <EmptyState icon="trend" title={chip !== 'all' && named ? 'Nothing like that' : 'No sales in these dates'} sub={chip !== 'all' && named ? 'Choose All to see everything that sold.' : 'Change the dates or the channel.'} />}
          </div>
          <div className="text-xs text-ink/45 mt-3 leading-relaxed">
            {timed && 'Other = the channels’ other charges and credits, less replacements and stock losses, on the day they fell. '}
            {group === 'channel' && `Other = each channel’s other charges and credits.${T.replacements > 0 ? ` Replacements (${money(-T.replacements)}) are not split by channel, so they are in the totals above but not in these rows.` : ''} `}
            {group === 'product' && 'A listing that holds more than one product is shared between them by what each cost. '}
            {group === 'tag' && `Tags are the ones on each order in HELM. ${data.tags?.known_from ? `Orders despatched before ${dayName(data.tags.known_from)} were never tagged, so their tags are not known.` : 'No tagged order has been despatched yet, so despatched orders show as not known; open orders show their tags.'} `}
            {named && (Math.abs(T.charges) > 0.004 || T.replacements > 0) && `${chargesOf(channel).whose} (${money(T.charges)})${T.replacements > 0 ? ` and replacements (${money(-T.replacements)})` : ''} aren’t part of any one ${group === 'product' ? 'product' : 'listing'}, so they are in the totals above but not in these rows. `}
            {showNet && `Each ${group}’s overheads are the fixed costs for the days in it; a ${group} with no sales still carries them.`}
          </div>
        </>
      )}

      {drawer === 'orders' && T && (
        <Drawer title="Orders that lost money" width="max-w-5xl" onClose={() => setDrawer(null)}
          description={`${int(T.losing.length)} of ${int(T.orders)} orders · ${money(T.losingTotal)} in all · ${title}${channel ? ` · ${channelName(channel)}` : ''}. After the Ship+ cashback paid on each order; before any refund; worst first.`}
          footer={<button className="btn btn-secondary btn-sm" onClick={() => downloadCsv(`orders-that-lost-money-${range.from}-to-${range.to}.csv`, csvText([['Order', 'Channel', 'Day', 'Tags', 'Product', 'Listing SKU', 'ASIN', 'Units', 'Revenue ex VAT', 'Fees', 'Cost of goods sold', 'Shipping', 'Packaging', 'Before cashback', 'Cashback', 'Gross profit after cashback'],
            ...T.losing.map(o => [o.ref, o.channel, o.date, (o.tags || []).join(' + '), orderProducts(o, siById, data?.ship?.order_products).map(p => `${p.qty} x ${p.name}`).join(' + '), o.skus.join(' + '), o.skus.map(k => o.asins?.[k] || '').filter(Boolean).join(' + '), o.units, o.sales.toFixed(2), o.fees.toFixed(2), o.cogs.toFixed(2), o.shipping.toFixed(2), o.packaging.toFixed(2), o.before.toFixed(2), o.credit.toFixed(2), o.profit.toFixed(2)])]))}><Icon name="download" size={13} /> Export CSV</button>}>
          {/* v2.96.0 — the list scrolls inside its own frame so the headings stay put; a row opens the order in Order Audit
              (in a new tab, so this list and its dates are still here to come back to) */}
          <div className="table-shell !overflow-auto max-h-[calc(100dvh-16rem)]" data-losing-scroll>
            <table className="w-full min-w-[900px] border-separate border-spacing-0">
              <thead><tr data-losing-head>
                {[['Order', 'text-left pl-4'], ['Product', 'text-left'], ['Revenue', 'text-right'], ['Cost of goods sold', 'text-right'], ['Shipping', 'text-right'], ['Fees', 'text-right'], ['Packaging', 'text-right'], ['Cashback', 'text-right'], ['Gross profit', 'text-right pr-4']]
                  .map(([h, c]) => <th key={h} className={`th ${c} sticky top-0 z-10 bg-paper border-b border-rule`}>{h}</th>)}
              </tr></thead>
              <tbody>
                {T.losing.slice(0, 300).map(o => {
                  const href = `#/order-audit?focus=${encodeURIComponent(o.ref || '')}`
                  return (
                    <tr key={o.key} className="table-row cursor-pointer" title="Open this order in Order Audit (new tab)" data-losing-row
                      onClick={(e) => { if (!e.target.closest('a')) window.open(href, '_blank', 'noopener') }}>
                      <td className="td pl-4">
                        <a href={href} target="_blank" rel="noopener" className="text-sm font-semibold text-royal-600 hover:underline whitespace-nowrap" data-no-nick data-losing-link>{o.ref}</a>
                        <div className="text-xs text-ink/45 whitespace-nowrap">{channelName(o.channel)} · {dayName(o.date)}</div>{o.tags?.length > 0 && <div className="flex flex-wrap gap-1 mt-1">{o.tags.map(t => <TagChip key={t} name={t} />)}</div>}
                      </td>
                      <td className="td text-sm min-w-[240px]">
                        {orderProducts(o, siById, data?.ship?.order_products).map(p => <div key={p.id || p.name} className="font-semibold text-ink leading-snug">{p.qty > 1 && <span className="tabular-nums">{int(p.qty)} × </span>}{p.name}</div>)}
                        <div className="text-xs text-ink/50 mt-0.5" data-losing-listing>
                          {o.skus.length
                            ? o.skus.map((sku, i) => <span key={sku}>{i > 0 && ' + '}{o.unlinked ? 'SKU' : 'Listing'}: {sku}{o.asins?.[sku] && <> · <span className="whitespace-nowrap">ASIN <span className="tabular-nums text-ink/70">{o.asins[sku]}</span></span></>}</span>)
                            : <span className="text-warn">No listing SKU on the order</span>}
                          {o.units > 1 && ` · ${int(o.units)} sold`}
                          {o.unlinked && <span className="text-warn" title="This SKU has not been set up as a listing in the portal, so there is no packaging cost or fee estimate for it. The product shown is the stock that went out for the order."> · not set up as a listing in the portal</span>}
                        </div>
                      </td>
                      <td className="td text-right tabular-nums whitespace-nowrap">{money(o.sales)}</td>
                      <td className="td text-right tabular-nums whitespace-nowrap text-loss">{money(-o.cogs)}</td>
                      <td className="td text-right tabular-nums whitespace-nowrap text-loss">{money(-o.shipping)}</td>
                      <td className="td text-right tabular-nums whitespace-nowrap text-loss">{money(o.fees)}</td>
                      <td className="td text-right tabular-nums whitespace-nowrap text-loss">{money(-o.packaging)}</td>
                      <td className={`td text-right tabular-nums whitespace-nowrap ${o.credit > 0 ? 'text-gain' : o.credit < 0 ? 'text-loss' : 'text-ink/40'}`}>{o.credit ? money(o.credit) : '—'}</td>
                      <td className="td text-right tabular-nums whitespace-nowrap font-semibold text-loss pr-4">{money(o.profit)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {T.losing.length > 300 && <div className="text-xs text-ink/45 mt-3">The worst 300 are shown; the export has all {int(T.losing.length)}.</div>}
        </Drawer>
      )}

      {drawer === 'listings' && T && (
        <Drawer title="Listings under 10% gross margin" width="max-w-3xl" onClose={() => setDrawer(null)}
          description={`${int(lowMargin.length)} of ${int(listings.filter(r => r.sales > 0).length)} listings that sold · ${title}${channel ? ` · ${channelName(channel)}` : ''}. Lowest margin first.`}>
          <div className="table-shell overflow-x-auto">
            <table className="w-full min-w-[620px] border-collapse">
              <thead className="table-head"><tr>
                <th className="th text-left pl-4">Listing SKU</th><th className="th text-right">Units</th><th className="th text-right">Revenue</th><th className="th text-left">Where each £1 goes</th><th className="th text-right">Gross profit</th><th className="th text-right pr-4">Gross margin</th>
              </tr></thead>
              <tbody>
                {lowMargin.map(r => (
                  <tr key={r.key} className="table-row">
                    <td className="td pl-4">
                      <div className="text-sm font-semibold text-ink break-words">{r.key}</div>
                      <div className="text-xs text-ink/60 mt-1 leading-snug">{r.listing_id ? <NameLink kind="listing" id={r.listing_id} name={r.name} /> : <span className="text-warn">No listing for this SKU</span>}</div>
                      {r.asin && <div className="mt-1"><AmazonLink asin={r.asin} label={r.asin} /></div>}
                    </td>
                    <td className="td text-right tabular-nums whitespace-nowrap">{int(r.units)}</td>
                    <td className="td text-right tabular-nums whitespace-nowrap">{money(r.sales)}</td>
                    <td className="td"><Split r={r} /></td>
                    <td className={`td text-right tabular-nums whitespace-nowrap font-semibold ${r.profit < 0 ? 'text-loss' : 'text-ink'}`}>{money(r.profit)}</td>
                    <td className={`td text-right tabular-nums whitespace-nowrap font-semibold pr-4 ${r.margin < 0 ? 'text-loss' : 'text-warn'}`}>{pct1(r.margin)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <SplitKey />
        </Drawer>
      )}
    </div>
  )
}

const COLS5 = 'grid-cols-[minmax(128px,2.2fr)_minmax(76px,1fr)_minmax(64px,0.8fr)_minmax(76px,1fr)_minmax(70px,0.9fr)]'
const COLS3 = 'grid-cols-[minmax(128px,2.2fr)_minmax(76px,1fr)_minmax(64px,0.8fr)]'

/**
 * How a line moved since the period before, as a percentage of the amount. Revenue and profit are green when up. A
 * cost is judged by its share of revenue — red when it took more of each pound than before, green when less — because
 * a cost that rises with sales is not bad news. Where a percentage would mean nothing (from nothing, or from a loss
 * to a profit) the change is given in pounds.
 */
function Change({ r, cost }) {
  if (r.was == null) return null
  const diff = r.v - r.was
  if (Math.abs(diff) < 0.005) return <span className="text-ink/45">level</span>
  const tone = cost ? (r.share == null || r.wasShare == null || Math.abs(r.share - r.wasShare) < 0.05 ? 'text-ink/55' : r.share > r.wasShare ? 'text-loss' : 'text-gain') : diff > 0 ? 'text-gain' : 'text-loss'
  const pounds = !(r.was > 0.005) || r.v < 0
  const text = pounds ? money0(Math.abs(diff)) : `${Math.abs((diff / r.was) * 100) >= 1000 ? '999+' : Math.abs((diff / r.was) * 100).toFixed(1)}%`
  return <span className={`font-semibold tabular-nums whitespace-nowrap ${tone}`} title={r.share != null && r.wasShare != null ? `${pct1(r.share)} of revenue; before ${pct1(r.wasShare)}` : undefined}>{diff > 0 ? '▲' : '▼'} {text}</span>
}

/** One line of the statement: what it is, the amount, its share of revenue, the amount before, and the change */
function StatementRow({ r, hasPrev, cost, strong, semi, big, line, tone, below, flag, share, sales }) {
  const swatch = tone || r.tone
  // v2.93.0 — a line that has something inside it opens to show it (closed until asked for)
  const [open, setOpen] = useState(false)
  const detail = r.detail && r.detail.length > 1 ? r.detail : r.detail && r.detail.length === 1 && r.detail[0].name !== r.name ? r.detail : null
  return (
    <>
    <div className={`grid ${hasPrev ? COLS5 : COLS3} gap-x-2 items-baseline py-[7px] ${line === 'heavy' ? 'border-t-2 border-ink mt-0.5 pt-2.5' : line ? 'border-t border-rule' : 'border-t border-rule/60'} ${strong ? 'font-bold' : semi ? 'font-semibold' : ''} ${big ? 'text-base' : ''} ${flag ? 'bg-[#FCEFED] -mx-2 px-2 rounded-[3px]' : ''}`}>
      <span className="min-w-0 flex items-baseline">
        {/* the arrow's own slot, kept on every cost line so the names stay in one column */}
        {detail ? (
          <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} aria-label={`${open ? 'Hide' : 'Show'} what is in ${r.name}`} title={open ? 'Hide the breakdown' : 'Show the breakdown'} data-row-toggle={r.name}
            className="shrink-0 inline-flex items-center justify-center w-5 h-5 -ml-1 mr-1 rounded-[3px] text-ink/60 hover:bg-paper hover:text-ink self-start mt-px">
            <span className={`inline-block text-[9px] leading-none transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden="true">▶</span>
          </button>
        ) : swatch ? <span className="shrink-0 w-5 -ml-1 mr-1" aria-hidden="true" /> : null}
        {swatch && <span className={`shrink-0 inline-block w-2 h-2 rounded-[2px] mr-2 ${swatch}`} aria-hidden="true" />}
        <span className="min-w-0">
          {r.name}
          {flag && <span className="text-xs font-semibold text-loss ml-2 whitespace-nowrap" title="The direct cost whose share of revenue grew most since the period before">Up most</span>}
          {r.hint && !flag && !below && <span className="hidden sm:inline text-xs font-normal text-ink/45 ml-2">{r.hint}</span>}
          {r.hint && below && <span className="block text-xs font-normal text-ink/45 mt-0.5 leading-snug">{r.hint}</span>}
        </span>
      </span>
      <span className={`text-right tabular-nums whitespace-nowrap ${!cost && r.v < 0 ? 'text-loss' : ''}`}>{money(r.v)}</span>
      <span className="text-right tabular-nums whitespace-nowrap">{share || pct1(r.share)}</span>
      {hasPrev && <span className="text-right tabular-nums whitespace-nowrap font-normal text-ink/55">{money(r.was)}</span>}
      {hasPrev && <span className="text-right text-[13px] font-normal"><Change r={r} cost={cost} /></span>}
    </div>
    {open && detail && (
      <div className="bg-paper/70 border-t border-rule/60 rounded-b-[4px] py-1" data-row-detail={r.name}>
        {detail.map((d, i) => (
          <div key={`${i}-${d.name}`} className={`grid ${hasPrev ? COLS5 : COLS3} gap-x-2 items-baseline py-1 text-[13px] text-ink/75`}>
            <span className="min-w-0 pl-[30px]">{d.name}</span>
            <span className="text-right tabular-nums whitespace-nowrap">{money(d.v)}</span>
            <span className="text-right tabular-nums whitespace-nowrap text-ink/50">{sales > 0 ? pct1((d.v / sales) * 100) : ''}</span>
            {hasPrev && <span />}{hasPrev && <span />}
          </div>
        ))}
      </div>
    )}
    </>
  )
}

/** A small trend line for the big card: one point a day, a faint line at zero. Drawn to fill its width. */
function Spark({ rows, label }) {
  const vals = rows.map(r => r.v)
  const hi = Math.max(0, ...vals), lo = Math.min(0, ...vals), span = hi - lo || 1
  const W = 100, H = 30, pad = 2
  const x = (i) => (rows.length === 1 ? W / 2 : (i / (rows.length - 1)) * W)
  const y = (v) => pad + ((hi - v) / span) * (H - pad * 2)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full grow shrink-0 basis-[36px] max-h-[96px] mt-3 block" role="img" aria-label={label} data-glance-spark>
      <line x1="0" x2={W} y1={y(0)} y2={y(0)} stroke="rgba(255,255,255,0.35)" strokeWidth="1" strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />
      <polyline points={rows.map((r, i) => `${x(i).toFixed(2)},${y(r.v).toFixed(2)}`).join(' ')} fill="none" stroke="#C8EF3F" strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

function ChartFacts({ rows, k, by, name, total, show }) {
  if (!rows.length) return null
  const best = rows.reduce((a, b) => (b[k] > a[k] ? b : a), rows[0]), worst = rows.reduce((a, b) => (b[k] < a[k] ? b : a), rows[0])
  const dn = (r) => (by === 'week' ? `week of ${short(r.d)}` : dayName(r.d))
  const fact = (l, v, neg) => <div className="flex justify-between py-1.5 border-t border-rule/70 text-[13px]"><span className="text-ink/70">{l}</span><b className={`tabular-nums ${neg ? 'text-loss' : ''}`}>{v}</b></div>
  return (
    <div className="mt-auto pt-3">
      {rows.length > 1 && fact(`Best · ${dn(best)}`, money0(best[k]), best[k] < 0)}
      {rows.length > 1 && fact(`Worst · ${dn(worst)}`, money0(worst[k]), worst[k] < 0)}
      {rows.length > 1 && fact(`${by === 'week' ? 'Weeks' : 'Days'} with a ${name.toLowerCase()}`, `${rows.filter(r => r[k] > 0).length} of ${rows.length}`)}
      {show && fact(`${name} for these dates`, money0(total), total < 0)}
    </div>
  )
}

/** Where each £1 of revenue went: cost of goods sold, shipping, fees, packaging, and what is left */
function Split({ r }) {
  if (!(r.sales > 0)) return <span className="text-ink/30">—</span>
  const w = (v) => `${Math.max(0, Math.min(100, (v / r.sales) * 100))}%`
  return (
    <span className="flex h-2 rounded-[2px] overflow-hidden bg-royal-500 min-w-[130px]" aria-hidden="true"
      title={`Cost of goods sold ${pct1((r.cogs / r.sales) * 100)} · shipping ${pct1((r.shipping / r.sales) * 100)} · fees ${pct1((-r.fees / r.sales) * 100)} · packaging ${pct1((r.packaging / r.sales) * 100)}`}>
      <span className="flex-none bg-ink" style={{ width: w(r.cogs) }} /><span className="flex-none bg-muted" style={{ width: w(r.shipping) }} />
      <span className="flex-none bg-[#9AA5B5]" style={{ width: w(-r.fees) }} /><span className="flex-none bg-[#C9D0DA]" style={{ width: w(r.packaging) }} />
    </span>
  )
}
function SplitKey() {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink/55 mt-3">
      {[['bg-ink', 'Cost of goods sold'], ['bg-muted', 'Shipping'], ['bg-[#9AA5B5]', 'Fees'], ['bg-[#C9D0DA]', 'Packaging'], ['bg-royal-500', 'Gross profit']].map(([c, l]) => (
        <span key={l}><span className={`inline-block w-2 h-2 rounded-[2px] mr-1.5 ${c}`} aria-hidden="true" />{l}</span>
      ))}
    </div>
  )
}

/**
 * How much of what is shown is firm and how much is still an estimate — one small card (the owner, 15 Nov 2026: it
 * matters, but it does not need the width of the screen). Each line is a count; the detail is in its hover note.
 */
function Sure({ T, onListings }) {
  const of = T.saleLines
  const items = [
    T.openOrders > 0 && { k: 'open', name: 'Open orders, not despatched', v: `${int(T.openOrders)}`, tip: `Orders open in HELM count with today, costed from the portal: ${money(T.openSales)} of revenue. Each moves to its own day once it is despatched.` },
    T.feeEstimated > 0 && { k: 'fees', name: 'Fees estimated', v: `${int(T.feeEstimated)} of ${int(of)}`, tip: `The channel’s report for these dates is not uploaded yet (${money(-T.fees)} of fees). Its fees, credits and FBM Ship+ Cashback replace the estimates when it is: Finance → Uploads.` },
    T.notCosted > 0 && { k: 'cogs', name: 'Not costed yet', v: `${int(T.notCosted)} of ${int(of)}`, tip: `Not costed first in, first out yet: ${money(T.notCostedCogs)} of the ${money(T.cogs)} cost of goods sold uses the latest purchase order price until the costing reaches them.`, open: true },
    T.shipEstimated > 0 && { k: 'ship', name: 'Shipping estimated', v: int(T.shipEstimated), tip: 'No parcel in HELM yet, so shipping is the listing’s own figure until the label is booked.' },
    T.unlinked > 0 && { k: 'unlinked', name: 'Not linked to a listing', v: int(T.unlinked), tip: 'These lines carry no shipping or packaging cost, so their gross profit is overstated.' },
    T.noPackaging > 0 && { k: 'pack', name: 'No packaging set', v: int(T.noPackaging), tip: 'Sold on a listing with no packaging chosen.' },
  ].filter(Boolean)
  const part = of ? Math.max(T.feeEstimated, T.notCosted) / of : 0
  const verdict = !items.length ? ['Firm', 'text-gain bg-[#EEF7F2]'] : part > 0.5 ? ['Mostly estimated', 'text-warn bg-[#FBF5E6]'] : ['Part estimated', 'text-warn bg-[#FBF5E6]']
  return (
    <Tile label="How sure these figures are" right={<span className={`font-bold rounded-[4px] px-2 py-0.5 whitespace-nowrap ${verdict[1]}`}>{verdict[0]}</span>}>
      {!items.length && <div className="text-[13px] text-ink/70">Fees as charged and every sale costed.</div>}
      {items.map((i, x) => (
        <div key={i.k} className={`flex items-baseline justify-between gap-2 py-[5px] text-[13px] ${x ? 'border-t border-rule/60' : ''}`} title={i.tip}>
          {i.open ? <button type="button" className="text-left text-ink/80 underline decoration-rule underline-offset-2 hover:text-royal-500" onClick={onListings}>{i.name}</button> : <span className="text-ink/80">{i.name}</span>}
          <b className="tabular-nums whitespace-nowrap">{i.v}</b>
        </div>
      ))}
      <div className="text-[11px] text-ink/45 mt-auto pt-2 leading-snug" title="Packaging uses each listing’s current packaging at today’s prices for every date. The mapping is still being corrected, so that line will move.">Packaging is at today’s mapping and prices. Hover a line for more.</div>
    </Tile>
  )
}

/** A HELM order tag; Prime stands out */
function TagChip({ name }) {
  return <span className={`inline-block text-[11px] font-semibold rounded-[4px] px-1.5 py-0.5 ${isPrime([name]) ? 'bg-royal-500 text-white' : 'bg-ink/5 text-ink/70'}`}>{name}</span>
}

/**
 * Amazon's orders, Prime against not Prime (v2.86.0) — from the tags the owner puts on Prime orders in HELM. An order
 * despatched before tagging began is "not known", never "not Prime".
 */
function PrimeTile({ s, knownFrom }) {
  const known = s.prime.orders + s.other.orders
  const Row = ({ r, name, chip }) => (
    <div className="grid grid-cols-[minmax(90px,1.3fr)_repeat(4,minmax(0,1fr))] items-baseline gap-2 py-2 border-t border-rule/70 text-sm">
      <span>{chip ? <TagChip name="Prime" /> : <b className="text-ink">{name}</b>}<span className="block text-xs text-ink/50 mt-0.5">{int(r.orders)} order{r.orders === 1 ? '' : 's'}{known > 0 && r !== s.unknown ? ` · ${((r.orders / known) * 100).toFixed(0)}%` : ''}</span></span>
      <span className="text-right tabular-nums">{money0(r.sales)}</span>
      <span className={`text-right tabular-nums font-bold ${r.profit < 0 ? 'text-loss' : ''}`}>{money0(r.profit)}</span>
      <span className={`text-right tabular-nums ${r.margin != null && r.margin < 10 ? 'text-loss' : ''}`}>{pct1(r.margin)}</span>
      <span className="text-right tabular-nums">{r.orders ? money(r.profit / r.orders) : '—'}</span>
    </div>
  )
  return (
    <Tile label="Prime and not Prime" right="From the order tags in HELM" className="md:col-span-2 lg:col-span-2">
      <div className="grid grid-cols-[minmax(90px,1.3fr)_repeat(4,minmax(0,1fr))] gap-2 text-[10px] uppercase tracking-[0.08em] font-semibold text-ink/45 pb-1.5">
        <span /><span className="text-right">Revenue</span><span className="text-right">Gross profit</span><span className="text-right">Margin</span><span className="text-right">An order</span>
      </div>
      {known > 0 && <Row r={s.prime} chip />}
      {known > 0 && <Row r={s.other} name="Not Prime" />}
      {s.unknown.orders > 0 && <Row r={s.unknown} name="Not known" />}
      {known + s.unknown.orders === 0 && <div className="text-sm text-ink/50 py-3 border-t border-rule/70">No orders in this period.</div>}
      <div className="text-xs text-ink/45 mt-auto pt-3 leading-relaxed">
        A Prime order is one tagged “Prime” in HELM; gross profit is before Amazon’s other charges and credits.
        {s.unknown.orders > 0 && ` ${int(s.unknown.orders)} order${s.unknown.orders === 1 ? ' was' : 's were'} despatched before tagging began${knownFrom ? ` (${dayName(knownFrom)})` : ''}, so whether ${s.unknown.orders === 1 ? 'it was' : 'they were'} Prime is not known.`}
      </div>
    </Tile>
  )
}

/** The best and the worst five by gross profit — products, ASINs or listings — for the dates on screen */
function Performers({ listings, asins, products }) {
  const [by, setBy] = useState('product')
  const all = (by === 'product' ? products : by === 'asin' ? asins : listings).filter(r => linked(r) && r.units > 0).sort((a, b) => b.profit - a.profit)
  const top = all.slice(0, Math.min(5, Math.ceil(all.length / 2)))
  const worst = all.slice(top.length).slice(-5).reverse()
  const Row = ({ r, i }) => (
    <div className="grid grid-cols-[18px_minmax(0,1fr)_auto] gap-x-2 py-2 border-t border-rule/70 text-sm items-start">
      <span className="text-ink/40 tabular-nums text-xs pt-0.5">{i + 1}</span>
      <span className="min-w-0">
        {by === 'product' ? <NameLink kind="product" id={r.product_id} name={r.name} className="font-semibold text-ink" />
          : <span className="font-semibold text-ink break-words">{r.key}</span>}
        {by !== 'product' && r.name && <span className="block text-xs text-ink/60 leading-snug mt-0.5">{by === 'listing' && r.listing_id ? <NameLink kind="listing" id={r.listing_id} name={r.name} /> : r.name}</span>}
        <span className="block text-xs text-ink/50 mt-0.5 tabular-nums">{int(r.units)} units · {money0(r.sales)} revenue</span>
      </span>
      <span className="text-right whitespace-nowrap">
        <b className={`tabular-nums ${r.profit < 0 ? 'text-loss' : 'text-ink'}`}>{money(r.profit)}</b>
        <span className={`block text-xs tabular-nums ${r.margin != null && r.margin < 10 ? 'text-loss' : 'text-ink/55'}`}>{pct1(r.margin)}</span>
      </span>
    </div>
  )
  return (
    <div className="bg-white border border-rule rounded-card px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
        <span className="text-[11px] uppercase tracking-[0.08em] font-semibold text-muted">Best and worst by gross profit</span>
        <SegmentedControl label="Best and worst of" items={[{ id: 'product', label: 'Products' }, { id: 'asin', label: 'ASINs' }, { id: 'listing', label: 'Listings' }]} value={by} onChange={setBy} />
      </div>
      {!all.length ? <div className="text-sm text-ink/50 py-4">Nothing sold in these dates.</div> : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8">
          <div>
            <div className="text-xs font-semibold text-gain pt-2 pb-1.5">Best {top.length}</div>
            {top.map((r, i) => <Row key={r.key} r={r} i={i} />)}
          </div>
          <div>
            <div className="text-xs font-semibold text-loss pt-2 pb-1.5">Worst {worst.length}{worst.length ? '' : ' — nothing else sold'}</div>
            {worst.map((r, i) => <Row key={r.key} r={r} i={i} />)}
          </div>
        </div>
      )}
      <div className="text-[11px] text-ink/45 mt-2">Gross profit before the channels’ other charges and replacements, which belong to no one product.</div>
    </div>
  )
}
