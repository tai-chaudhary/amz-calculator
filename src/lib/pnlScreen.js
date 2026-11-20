/**
 * The Profit & Loss screen's sums (v2.84.0): which dates a period covers, what it is compared with, and the totals
 * for any run of days out of one load.
 *
 * The owner's rule (15 Nov 2026): every period is compared with the one before it — yesterday with the day before, a
 * week with the week before, a month with the month before, a quarter with the quarter before. A period that is
 * still running (this week, this month, this quarter) is compared with the SAME DAYS of the one before, so three
 * days of a week are never set against seven.
 *
 * Nothing here works out a cost: lines come in already worked out by buildPnl (lib/pnl.js), the by-day extras from
 * report_pl_days, and the overheads by day from overheads_for_pl. This only adds them up.
 */
export const START = '2026-08-01'   // the first day the sales ledger holds

/**
 * How net profit is shared (the owner, 15 Nov 2026): Adrian Marsh keeps 33% of any net profit, the partner keeps the
 * rest ("Our share" — the name he confirmed). Shown under the Net profit figure for every period. A net loss is
 * shared the same way, 33 / 67 (confirmed by the owner, 15 Nov 2026).
 */
export const SPLIT = [{ name: 'Adrian Marsh', share: 0.33 }, { name: 'Our share', share: 0.67 }]
export const splitOf = (net) => SPLIT.map(p => ({ ...p, amount: net * p.share }))

const num = (v) => { const x = parseFloat(v); return Number.isFinite(x) ? x : 0 }
const D = (s) => new Date(`${s}T12:00:00Z`)
const S = (d) => d.toISOString().slice(0, 10)
const pad = (n) => String(n).padStart(2, '0')

export const addDays = (s, n) => { const d = D(s); d.setUTCDate(d.getUTCDate() + n); return S(d) }
export const daysBetween = (a, b) => Math.round((D(b) - D(a)) / 86400000) + 1
export const monthStartOf = (s) => `${s.slice(0, 7)}-01`
export const addMonths = (s, n) => { const d = D(monthStartOf(s)); d.setUTCMonth(d.getUTCMonth() + n); return S(d) }
export const monthEndOf = (s) => addDays(addMonths(s, 1), -1)
export const quarterStartOf = (s) => `${s.slice(0, 4)}-${pad(Math.floor((Number(s.slice(5, 7)) - 1) / 3) * 3 + 1)}-01`
/** Weeks run Monday to Sunday */
export const weekStartOf = (s) => addDays(s, -((D(s).getUTCDay() + 6) % 7))
const minDate = (a, b) => (a < b ? a : b)
const maxDate = (a, b) => (a > b ? a : b)

export const PERIODS = [
  { id: 'today', label: 'Today' }, { id: 'yesterday', label: 'Yesterday' },
  { id: 'week', label: 'This week' }, { id: 'lastweek', label: 'Last week' },
  { id: 'month', label: 'This month' }, { id: 'lastmonth', label: 'Last month' },
  { id: 'quarter', label: 'This quarter' }, { id: 'lastquarter', label: 'Last quarter' },
  { id: 'all', label: 'All time' },
  { id: 'custom', label: 'Custom' },
]

/**
 * The dates of a period and of the one it is compared with.
 * Returns { id, kind: day | week | month | quarter | custom, running, from, to, days, prev }, where prev is
 * { from, to, days, name, partial } or null when there is nothing before it in the ledger.
 */
export function periodRange(id, today, custom = {}) {
  let kind, from, to, running = false, pf, pt, name
  const y = addDays(today, -1)
  if (id === 'today') { kind = 'day'; from = to = today; pf = pt = y; name = 'The day before'; running = true }
  else if (id === 'week') {
    kind = 'week'; running = true; from = weekStartOf(today); to = today
    pf = addDays(from, -7); pt = addDays(to, -7); name = to === addDays(from, 6) ? 'The week before' : 'Same days the week before'
  } else if (id === 'lastweek') {
    kind = 'week'; from = addDays(weekStartOf(today), -7); to = addDays(from, 6)
    pf = addDays(from, -7); pt = addDays(to, -7); name = 'The week before'
  } else if (id === 'month') {
    kind = 'month'; running = true; from = monthStartOf(today); to = today
    pf = addMonths(from, -1); pt = minDate(monthEndOf(pf), addDays(pf, daysBetween(from, to) - 1))
    name = to === monthEndOf(from) ? 'The month before' : 'Same days the month before'
  } else if (id === 'lastmonth') {
    kind = 'month'; from = addMonths(monthStartOf(today), -1); to = monthEndOf(from)
    pf = addMonths(from, -1); pt = monthEndOf(pf); name = 'The month before'
  } else if (id === 'quarter') {
    kind = 'quarter'; running = true; from = quarterStartOf(today); to = today
    pf = addMonths(from, -3); pt = minDate(addDays(from, -1), addDays(pf, daysBetween(from, to) - 1))
    name = to === addDays(addMonths(from, 3), -1) ? 'The quarter before' : 'Same days the quarter before'
  } else if (id === 'lastquarter') {
    kind = 'quarter'; from = addMonths(quarterStartOf(today), -3); to = addDays(quarterStartOf(today), -1)
    pf = addMonths(from, -3); pt = addDays(from, -1); name = 'The quarter before'
  } else if (id === 'all') {
    // Everything since the figures start (1 Aug 2026), up to yesterday — a whole day at each end, nothing to compare with
    kind = 'custom'; from = START; to = y < START ? START : y; pt = addDays(START, -1); pf = pt; name = ''
  } else if (id === 'custom') {
    kind = 'custom'; from = custom.from || today; to = custom.to || from
    if (to < from) to = from
    const n = daysBetween(from, to)
    pt = addDays(from, -1); pf = addDays(pt, -(n - 1)); name = n === 1 ? 'The day before' : `The ${n} days before`
  } else { kind = 'day'; from = to = y; pf = pt = addDays(y, -1); name = 'The day before' }   // yesterday: what the screen opens on

  from = maxDate(from, START); to = maxDate(to, from)
  let prev = null
  if (pt >= START) {
    const partial = pf < START
    const f = maxDate(pf, START)
    prev = { from: f, to: pt, days: daysBetween(f, pt), name, partial }
  }
  return { id, kind, running, from, to, days: daysBetween(from, to), prev }
}

/**
 * Everything one load has to cover for a period: the period, what it is compared with, the days the chart shows, and
 * — for a day or a week — the month so far and the seven days before.
 */
export function spanFor(range) {
  const small = range.kind === 'day' || (range.kind === 'custom' && range.days === 1)
  const chartFrom = small ? addDays(range.to, -13) : range.from
  const weekBefore = small ? { from: addDays(range.from, -7), to: addDays(range.from, -1) } : null
  const monthToDate = small || range.kind === 'week' ? { from: monthStartOf(range.to), to: range.to } : null
  let from = minDate(range.from, chartFrom)
  if (range.prev) from = minDate(from, range.prev.from)
  if (weekBefore) from = minDate(from, weekBefore.from)
  if (monthToDate) from = minDate(from, monthToDate.from)
  const clip = (r) => (r && r.to >= START ? { from: maxDate(r.from, START), to: r.to } : null)
  return { from: maxDate(from, START), to: range.to, chartFrom: maxDate(chartFrom, START), weekBefore: clip(weekBefore), monthToDate: clip(monthToDate) }
}

/**
 * A channel's charge that is advertising: eBay's Promoted Listings, sponsored ads. v2.103.0 (the owner: "advertising
 * and all" should be displayed properly): it is shown on its own line. It was, and still is, inside the channels'
 * other charges, so no total moves.
 */
export const isAdvertising = (what) => /promoted listing|advertis|sponsored/i.test(String(what || ''))
/**
 * A channel's charge that belongs to returns: Amazon's return postage and SAFE-T reimbursements (v2.111.0, the returns
 * rebuild). Shown in the Returns group on its own lines; still inside the channels' other charges, so no total moves.
 */
export const isReturnCharge = (what) => /return postage|returnpostage|safe-?t/i.test(String(what || ''))

/** day → { charges, replacements, losses, overheads, and what is shown outside the P&L } for every day that has any */
export function extrasByDay({ days, ohByDay, ohOn, fulByDay = null, chargeDays = null }) {
  const m = new Map()
  const at = (d) => m.get(d) || m.set(d, { charges: 0, chargesBy: {}, advertising: 0, advertisingBy: {}, returnCharges: 0, returnsCredit: 0, returnedUnits: 0, replacements: 0, replacementOrders: 0, replacementUnits: 0, losses: 0, overheads: 0, fulfilOh: 0, returned: 0, startup: 0, lossesBefore: 0 }).get(d)
  for (const c of days?.charges || []) { const e = at(c.d); e.charges += num(c.amount); e.chargesBy[c.channel] = (e.chargesBy[c.channel] || 0) + num(c.amount) }
  // the advertising inside those charges (a cost, so the charge is negative): by day and by channel
  for (const c of chargeDays || []) if (isAdvertising(c.what)) { const e = at(c.d); e.advertising -= num(c.amount); e.advertisingBy[c.channel] = (e.advertisingBy[c.channel] || 0) - num(c.amount) }
  // v2.111.0 — return postage and SAFE-T inside those charges (a cost is negative, a SAFE-T payment positive)
  for (const c of chargeDays || []) if (isReturnCharge(c.what)) at(c.d).returnCharges += num(c.amount)
  // v2.111.0 — units that came back and went on the shelf: their cost is taken back off, on the day they arrived
  for (const r of days?.returns || []) { const e = at(r.d); e.returnsCredit += num(r.credit); e.returnedUnits += num(r.units) }
  for (const r of days?.replacements || []) { const e = at(r.d); e.replacements += num(r.cost); e.replacementOrders += num(r.orders); e.replacementUnits += num(r.units) }
  for (const l of days?.losses || []) at(l.d).losses += num(l.cost)
  // shown under the P&L, never part of it: returned to a supplier, start-up differences, losses before 1 Dec
  for (const o of days?.outside || []) { const e = at(o.d); e.returned += num(o.returned); e.startup += num(o.startup); e.lossesBefore += num(o.losses_before) }
  if (ohOn) for (const [d, v] of Object.entries(ohByDay || {})) at(d).overheads += num(v)
  // v2.100.0 — the part of each day's overheads marked as a cost of fulfilment (already inside `overheads`)
  if (ohOn) for (const [d, v] of Object.entries(fulByDay || {})) at(d).fulfilOh += num(v)
  return m
}

const blank = () => ({ sales: 0, refunds: 0, fees: 0, cogs: 0, shipping: 0, packaging: 0 })
const grossOf = (t) => t.sales + t.refunds + t.fees - t.cogs - t.shipping - t.packaging

/**
 * The totals for the days from..to. `ctx` is { lines (from buildPnl), extras (extrasByDay), ohOn }.
 *   gross  = revenue − direct costs (refunds, fees, other charges and credits, cost of goods sold, shipping,
 *            packaging, replacements, and stock losses from 1 Dec)
 *   net    = gross − overheads; null when overheads don't apply (a single channel, or none set up)
 * Also: the orders that lost money, each channel's figures, and how much of it is estimated.
 */
export function summarise(ctx, from, to) {
  const t = { from, to, days: daysBetween(from, to), ...blank(), orders: 0, units: 0, saleLines: 0,
    charges: 0, advertising: 0, returnCharges: 0, returnsCredit: 0, returnedUnits: 0, replacements: 0, replacementOrders: 0, replacementUnits: 0, losses: 0, overheads: 0, fulfilOh: 0, parcels: 0,
    returned: 0, startup: 0, lossesBefore: 0,
    shipBy: {}, refundOrders: 0, feeEstimated: 0, notCosted: 0, notCostedCogs: 0, shipEstimated: 0, unlinked: 0, noPackaging: 0, openOrders: 0, openSales: 0 }
  const orders = new Map(), refs = new Set(), refunded = new Set(), channels = new Map(), open = new Set()
  const chan = (c) => channels.get(c) || channels.set(c, { channel: c, ...blank(), charges: 0, advertising: 0, orders: new Set(), units: 0 }).get(c)
  for (const l of ctx.lines || []) {
    if (l.sale_date < from || l.sale_date > to) continue
    const net = num(l.gross) - num(l.vat), fees = num(l.fees), c = chan(l.channel)
    t.fees += fees; c.fees += fees
    if (l.kind !== 'sale') { t.refunds += net; c.refunds += net; refunded.add(l.order_ref || `line-${refunded.size}`); continue }
    t.saleLines++; t.sales += net; t.units += l.qty; t.cogs += l.cogs; t.shipping += l.shipping; t.packaging += l.packaging; t.parcels += Number(l.parcels) || 0
    // v2.106.0: carrier surcharges (a peak surcharge) are part of Shipping, shown as their own line under it
    const sur = Number(l.surcharge) || 0
    // v2.109.0: what the carriers charge over mainland for remote postcodes (Highlands & Islands, NI, the islands), its own line too
    const rem = Number(l.remote) || 0
    if (l.shipping) { const who = l.shipCarrier || 'Carrier not known'; t.shipBy[who] = (t.shipBy[who] || 0) + l.shipping - sur - rem }
    if (sur) { t.surcharges = (t.surcharges || 0) + sur; t.shipBy['Carrier surcharges'] = (t.shipBy['Carrier surcharges'] || 0) + sur }
    if (rem) { t.offshore = (t.offshore || 0) + rem; t.shipBy['Off shore postcodes'] = (t.shipBy['Off shore postcodes'] || 0) + rem }
    c.sales += net; c.units += l.qty; c.cogs += l.cogs; c.shipping += l.shipping; c.packaging += l.packaging
    if (l.fee_estimated) t.feeEstimated++
    if (l.open) { t.openSales += net; if (l.order_ref) open.add(`${l.channel}|${l.order_ref}`) }   // open in HELM, not despatched yet
    if (l.cogsFrom !== 'fifo' && !l.wholesale) { t.notCosted++; t.notCostedCogs += l.cogs }
    if (l.shipFrom === 'estimated') t.shipEstimated++
    if (!l.listing && !l.wholesale) t.unlinked++
    if (l.listing && !l.wholesale && !(l.packaging > 0) && l.shipFrom !== 'pallet' && !l.listing.data?.ownPackaging) t.noPackaging++
    if (!l.order_ref) continue
    refs.add(l.order_ref); c.orders.add(l.order_ref)
    const k = `${l.channel}|${l.order_ref}`
    const o = orders.get(k) || orders.set(k, { key: k, ref: l.order_ref, channel: l.channel, date: l.sale_date, tags: l.tags, ...blank(), units: 0, skus: new Set(), asins: {}, items: [],
      // v2.93.0: the Ship+ cashback Amazon paid on this order (ex VAT). Only the cashback: a return's postage belongs
      // with the refund, and a label bought through Amazon is already in the order's shipping.
      credit: num(ctx.orderCashback?.[l.order_ref]) }).get(k)
    o.sales += net; o.fees += fees; o.cogs += l.cogs; o.shipping += l.shipping; o.packaging += l.packaging; o.units += l.qty
    if (!l.listing && !l.wholesale) o.unlinked = true        // a line with no listing in the portal (v2.97.0)
    if (l.listing_sku) {
      o.skus.add(l.listing_sku)
      // v2.96.0: the ASIN beside each listing SKU (the order's own line, else the listing's)
      const asin = l.asin || l.listing?.data?.asin
      if (asin && !o.asins[l.listing_sku]) o.asins[l.listing_sku] = asin
    }
    o.items.push({ listing: l.listing || null, qty: l.qty, name: l.wholesale ? (l.name || l.listing_sku || null) : null })
  }
  for (const [d, e] of ctx.extras || []) {
    if (d < from || d > to) continue
    t.charges += e.charges; t.replacements += e.replacements; t.replacementOrders += e.replacementOrders; t.replacementUnits += e.replacementUnits
    t.losses += e.losses; t.overheads += e.overheads; t.fulfilOh += e.fulfilOh || 0
    t.returned += e.returned; t.startup += e.startup; t.lossesBefore += e.lossesBefore
    for (const [c, v] of Object.entries(e.chargesBy)) chan(c).charges += v
    t.advertising += e.advertising || 0
    t.returnCharges += e.returnCharges || 0; t.returnsCredit += e.returnsCredit || 0; t.returnedUnits += e.returnedUnits || 0
    for (const [c, v] of Object.entries(e.advertisingBy || {})) chan(c).advertising += v
  }
  t.orders = refs.size
  t.openOrders = open.size
  t.refundOrders = refunded.size
  t.gross = grossOf(t) + t.charges - t.replacements - t.losses + t.returnsCredit
  t.direct = t.sales - t.gross
  t.grossMargin = t.sales ? (t.gross / t.sales) * 100 : null
  t.net = ctx.ohOn ? t.gross - t.overheads : null
  t.netMargin = t.net != null && t.sales ? (t.net / t.sales) * 100 : null
  // Fulfilment cost (v2.100.0): what it cost to store, pick, pack and send the period's orders — the carriers, the
  // packaging, and the share of the overheads marked as fulfilment (warehouse, its staff, HELM). Every part is already
  // in the figures above, so this regroups costs and changes no profit. Whole business only, like the overheads.
  t.fulfilment = ctx.ohOn ? t.shipping + t.packaging + t.fulfilOh : null
  t.fulfilmentPerOrder = t.fulfilment != null && t.orders > 0 ? t.fulfilment / t.orders : null
  t.fulfilmentPerUnit = t.fulfilment != null && t.units > 0 ? t.fulfilment / t.units : null
  // a parcel: labels where there are any, else what the listing sends (v2.105.0). Wholesale collections have none
  t.fulfilmentPerParcel = t.fulfilment != null && t.parcels > 0.5 ? t.fulfilment / t.parcels : null
  // Break-even: the revenue that would just cover the overheads at this period's gross margin. Revenue above it is
  // exactly a net profit, so "cleared" always agrees with the sign of net profit.
  t.breakEven = ctx.ohOn && t.sales > 0 && t.gross > 0 ? t.overheads / (t.gross / t.sales) : null
  // An order lost money only if it is still a loss AFTER the cashback paid on it. `before` is the order on its own;
  // `profit` is with the cashback — the figure that counts.
  const judged = [...orders.values()].map(o => { const before = grossOf(o); return { ...o, skus: [...o.skus], before, profit: before + o.credit } })
  t.losing = judged.filter(o => o.profit < -0.004).sort((a, b) => a.profit - b.profit)
  t.losingTotal = t.losing.reduce((s, o) => s + o.profit, 0)
  t.savedByCredit = judged.filter(o => o.before < -0.004 && o.profit >= -0.004).length
  t.channels = [...channels.values()].map(c => { const gross = grossOf(c) + c.charges; return { ...c, orders: c.orders.size, gross, margin: c.sales ? (gross / c.sales) * 100 : null } })
    .filter(c => c.sales || c.refunds || c.fees || c.charges).sort((a, b) => b.sales - a.sales)
  return t
}

/** One row for every day from..to (days with no sales included): revenue, gross profit, overheads and net profit */
export function byDay(ctx, from, to) {
  const m = new Map()
  for (let d = from; d <= to; d = addDays(d, 1)) m.set(d, { d, ...blank(), orders: new Set(), extra: 0, overheads: 0 })
  for (const l of ctx.lines || []) {
    const r = m.get(l.sale_date); if (!r) continue
    const net = num(l.gross) - num(l.vat)
    r.fees += num(l.fees)
    if (l.kind !== 'sale') { r.refunds += net; continue }
    r.sales += net; r.cogs += l.cogs; r.shipping += l.shipping; r.packaging += l.packaging
    if (l.order_ref) r.orders.add(l.order_ref)
  }
  for (const [d, e] of ctx.extras || []) { const r = m.get(d); if (r) { r.extra += e.charges - e.replacements - e.losses + (e.returnsCredit || 0); r.overheads += e.overheads } }
  return [...m.values()].map(r => { const gross = grossOf(r) + r.extra; return { d: r.d, sales: r.sales, orders: r.orders.size, gross, overheads: r.overheads, net: ctx.ohOn ? gross - r.overheads : null } })
}

/**
 * The big card's "at a glance" figures (v2.95.0) for the days from..to, on `k` (net or gross): how many days were in
 * profit, the best and the worst day, the average a day, the day-by-day values for a small trend line — and, for a
 * week, month or quarter still running, where it ends at this pace.
 *   The pace is the average of the FULL days so far (today is never a full day: its orders are still coming in), times
 *   the days in the whole period. It needs at least two full days, and is left out once the period is over.
 */
export function glance(ctx, from, to, { k = 'net', range = null, today = null } = {}) {
  const rows = byDay(ctx, from, to).map(r => ({ d: r.d, v: num(k === 'net' && r.net != null ? r.net : r.gross) }))
  if (!rows.length) return null
  const total = rows.reduce((s, r) => s + r.v, 0)
  const best = rows.reduce((a, b) => (b.v > a.v ? b : a), rows[0]), worst = rows.reduce((a, b) => (b.v < a.v ? b : a), rows[0])
  const out = { rows, days: rows.length, up: rows.filter(r => r.v > 0.004).length, best, worst, total, perDay: total / rows.length, course: null }
  if (range?.running && today && ['week', 'month', 'quarter'].includes(range.kind) && from === range.from) {
    const end = range.kind === 'week' ? addDays(range.from, 6) : range.kind === 'month' ? monthEndOf(range.from) : addDays(addMonths(range.from, 3), -1)
    const len = daysBetween(range.from, end)
    const full = rows.filter(r => r.d < today)
    if (full.length >= 2 && full.length < len) out.course = { amount: (full.reduce((s, r) => s + r.v, 0) / full.length) * len, end, fullDays: full.length, len, kind: range.kind }
  }
  return out
}

/** The same rows added up by week (Monday to Sunday), for a chart of a long period */
export function byWeek(rows) {
  const m = new Map()
  for (const r of rows) {
    const k = weekStartOf(r.d)
    const w = m.get(k) || m.set(k, { d: k, to: r.d, sales: 0, orders: 0, gross: 0, overheads: 0, net: r.net == null ? null : 0 }).get(k)
    w.to = r.d; w.sales += r.sales; w.orders += r.orders; w.gross += r.gross; w.overheads += r.overheads
    if (r.net != null) w.net += r.net
  }
  return [...m.values()]
}

/**
 * A listing's products and each one's share of the listing, for breaking sales down BY PRODUCT. A listing of one
 * product gives it everything; a bundle is shared between its products by what they cost (quantity × cost), or
 * equally when none has a cost. Returns [] for a listing with no products linked.
 */
export function productShares(listing, siById) {
  const comps = (Array.isArray(listing?.data?.components) ? listing.data.components : []).map(c => {
    const si = siById.get(c.stockItemId); if (!si) return null
    const qty = num(c.qty) || 1
    return { id: si.id, name: si.name || si.data?.name || '(unnamed product)', qty, cost: qty * num(si.data?.costPrice) }
  }).filter(Boolean)
  const all = comps.reduce((a, c) => a + c.cost, 0)
  return comps.map(c => ({ ...c, share: all > 0 ? c.cost / all : 1 / comps.length }))
}

export const NO_PRODUCT = '(not linked to a product)'
/** The P&L by product: the same figures as groupPnl (lib/pnl.js) gives by listing, with each line shared between its products */
export function groupByProduct(lines, stockItems = []) {
  const siById = new Map(stockItems.map(x => [x.id, x]))
  const m = new Map(), cache = new Map()
  const sharesOf = (l) => { if (!l.listing) return []; if (!cache.has(l.listing.id)) cache.set(l.listing.id, productShares(l.listing, siById)); return cache.get(l.listing.id) }
  const at = (k, name, id) => m.get(k) || m.set(k, { key: k, name, product_id: id, orders: new Set(), units: 0, sales: 0, refunds: 0, fees: 0, cogs: 0, shipping: 0, packaging: 0, cogsCurrent: 0, shipEstimated: 0, unlinked: 0, lines: 0 }).get(k)
  for (const l of lines) {
    const sh = sharesOf(l)
    const parts = sh.length ? sh : [{ id: null, name: l.wholesale ? (l.name || l.listing_sku || NO_PRODUCT) : NO_PRODUCT, qty: 1, share: 1 }]
    const net = num(l.gross) - num(l.vat)
    for (const p of parts) {
      const g = at(p.id || p.name, p.name, p.id)
      g.lines++
      g.fees += num(l.fees) * p.share
      if (l.kind !== 'sale') { g.refunds += net * p.share; continue }
      g.sales += net * p.share; g.units += l.qty * p.qty; g.cogs += l.cogs * p.share; g.shipping += l.shipping * p.share; g.packaging += l.packaging * p.share
      if (l.order_ref) g.orders.add(l.order_ref)
      if (l.cogsFrom !== 'fifo' && !l.wholesale) g.cogsCurrent++
      if (l.shipFrom === 'estimated') g.shipEstimated++
      if (!l.listing && !l.wholesale) g.unlinked++
    }
  }
  return [...m.values()].map(g => { const profit = grossOf(g); return { ...g, orders: g.orders.size, profit, margin: g.sales ? (profit / g.sales) * 100 : null } })
}

// ── HELM's order tags (v2.86.0) ──────────────────────────────────────────────────────────────────────────────────────
// The owner tags every Prime order "Prime" in HELM. report_order_tags gives the tags of despatched orders and
// report_pl_open those of the open ones; a tag is on the ORDER, so every line of it carries the same tags.
//   line.tags: array of names · [] = read, none · undefined/null = not known (despatched before tags were read)
export const isPrime = (tags) => Array.isArray(tags) && tags.some(t => /\bprime\b/i.test(t))
export const NO_TAG = '(no tag)', TAGS_UNKNOWN = '(tags not known)'
/** Put each order's tags on its lines. `info` is report_order_tags' reply; open lines already carry theirs. */
export function attachTags(lines, info) {
  const tagged = info?.tagged || {}, from = info?.known_from || null
  return (lines || []).map(l => {
    if (l.open) return { ...l, tags: Array.isArray(l.tags) ? l.tags : null }
    const t = l.order_ref ? tagged[l.order_ref] : null
    // HELM's orders only: a wholesale order or a line with no order was never in HELM, so it has no tags to know
    return { ...l, tags: t || (from && l.sale_date >= from && l.source !== 'wholesale' ? [] : null) }
  })
}
export const tagLabel = (tags) => (tags == null ? TAGS_UNKNOWN : tags.length ? [...tags].sort().join(' + ') : NO_TAG)
const fold = (rows) => rows.map(g => { const profit = grossOf(g); return { ...g, orders: g.orders.size, profit, margin: g.sales ? (profit / g.sales) * 100 : null } })
const tagRow = (k) => ({ key: k, name: null, orders: new Set(), units: 0, sales: 0, refunds: 0, fees: 0, cogs: 0, shipping: 0, packaging: 0, cogsCurrent: 0, shipEstimated: 0, unlinked: 0, lines: 0 })
const addTagLine = (g, l) => {
  const net = num(l.gross) - num(l.vat)
  g.lines++; g.fees += num(l.fees)
  if (l.kind !== 'sale') { g.refunds += net; return }
  g.sales += net; g.units += l.qty; g.cogs += l.cogs || 0; g.shipping += l.shipping || 0; g.packaging += l.packaging || 0
  if (l.order_ref) g.orders.add(l.order_ref)
  if (l.cogsFrom !== 'fifo' && !l.wholesale) g.cogsCurrent++
  if (l.shipFrom === 'estimated') g.shipEstimated++
  if (!l.listing && !l.wholesale) g.unlinked++
}
/** The P&L by tag: one row for each set of tags an order carries ("Prime", "Prime + Gift"), "(no tag)" and "(tags not known)" */
export function groupByTag(lines) {
  const m = new Map()
  for (const l of lines) { const k = tagLabel(l.tags); addTagLine(m.get(k) || m.set(k, tagRow(k)).get(k), l) }
  return fold([...m.values()])
}
/** Prime against not Prime: { prime, other, unknown }, each with orders, revenue, costs, gross profit and margin */
export function primeSplit(lines) {
  const g = { prime: tagRow('Prime'), other: tagRow('Not Prime'), unknown: tagRow('Not known') }
  for (const l of lines) addTagLine(l.tags == null ? g.unknown : isPrime(l.tags) ? g.prime : g.other, l)
  const [prime, other, unknown] = fold([g.prime, g.other, g.unknown])
  return { prime, other, unknown }
}

/**
 * The products in an order (v2.86.1), for the "orders that lost money" list: [{ id, name, qty }] — each listing's
 * products × the units of it sold, the same product added up. A line not linked to a listing gives NO_PRODUCT.
 * Given `left` ({ order ref → [{ id, name, units }] }), such an order shows the stock that went out for it instead.
 */
export function orderProducts(order, stockItems = [], left = null) {
  const siById = stockItems instanceof Map ? stockItems : new Map(stockItems.map(s => [s.id, s]))
  // v2.97.0 — an order with a line that has no listing (eBay, TikTok, an Amazon SKU nobody set up): name what actually
  // left the shelf for it (report_pl_ship's order_products), for the whole order so nothing is counted twice
  const out = left?.[order?.ref]
  if (out?.length && (order?.items || []).some(it => !it.listing && !it.name)) {
    return out.map(p => ({ id: p.id || null, name: siById.get(p.id)?.name || p.name, qty: Number(p.units) || 0, fromStock: true }))
  }
  const m = new Map()
  const add = (id, name, qty) => { const k = id || name; const g = m.get(k) || m.set(k, { id, name, qty: 0 }).get(k); g.qty += qty }
  for (const it of order?.items || []) {
    const sh = it.listing ? productShares(it.listing, siById) : []
    if (sh.length) sh.forEach(p => add(p.id, p.name, p.qty * (it.qty || 1)))
    else add(null, it.name || NO_PRODUCT, it.qty || 1)
  }
  return [...m.values()]
}
