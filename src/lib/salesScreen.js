/**
 * The Sales page's sums (v2.85.0): what sold, in any run of days out of one load. No costs here — revenue, VAT, orders,
 * units, refunds and fees only; costs and profit are the Profit & Loss's (lib/pnlScreen.js, lib/pnl.js).
 *
 * `lines` are the sales ledger's lines as report_pl_lines gives them (plus HELM's open orders, dated today), each with
 * its listing attached by attachListings(). Revenue is always ex VAT; "inc VAT" is what the customer paid.
 */
import { addDays, daysBetween, productShares, NO_PRODUCT, weekStartOf, tagLabel } from './pnlScreen.js'

const num = (v) => { const x = parseFloat(v); return Number.isFinite(x) ? x : 0 }

export const attachListings = (lines, savedById) => (lines || []).map(l => ({ ...l, qty: Math.abs(num(l.qty)), listing: l.listing_id ? savedById.get(l.listing_id) || null : null }))

const blank = () => ({ orders: new Set(), units: 0, revenue: 0, vat: 0, fees: 0, refunds: 0, refundRefs: new Set(), lines: 0 })
const addLine = (g, l, share = 1, unitsPer = 1) => {
  const gross = num(l.gross) * share, vat = num(l.vat) * share
  g.lines++; g.fees += num(l.fees) * share
  if (l.kind !== 'sale') { g.refunds += gross - vat; g.refundRefs.add(l.order_ref || `r${g.refundRefs.size}`); return }
  g.revenue += gross - vat; g.vat += vat; g.units += l.qty * unitsPer
  if (l.order_ref) g.orders.add(l.order_ref)
}
const done = (g) => ({ ...g, orders: g.orders.size, refundOrders: g.refundRefs.size, refundRefs: undefined, incVat: g.revenue + g.vat,
  perOrder: g.orders.size ? g.revenue / g.orders.size : null, perUnit: g.units ? g.revenue / g.units : null })

/** Everything sold from..to, and each channel's part of it */
export function salesTotals(lines, from, to) {
  const t = blank(), channels = new Map(), open = new Set(), listings = new Set()
  let openRevenue = 0, estimated = 0, unlinked = 0, saleLines = 0
  for (const l of lines || []) {
    if (l.sale_date < from || l.sale_date > to) continue
    addLine(t, l)
    addLine(channels.get(l.channel) || channels.set(l.channel, { channel: l.channel, ...blank() }).get(l.channel), l)
    if (l.kind !== 'sale') continue
    saleLines++
    if (l.fee_estimated) estimated++
    if (!l.listing && l.source !== 'wholesale') unlinked++
    if (l.listing_sku) listings.add(`${l.channel}|${l.listing_sku}`)
    if (l.open) { openRevenue += num(l.gross) - num(l.vat); if (l.order_ref) open.add(`${l.channel}|${l.order_ref}`) }
  }
  return { from, to, days: daysBetween(from, to), ...done(t), saleLines, estimated, unlinked, listings: listings.size, openOrders: open.size, openRevenue,
    channels: [...channels.values()].map(done).filter(c => c.revenue || c.refunds).sort((a, b) => b.revenue - a.revenue) }
}

export const NO_SKU = '(no Listing SKU)', NO_ASIN = '(no ASIN)'
/** What sold from..to, by day | week | month | channel | tag | listing | asin | product. Rows carry orders, units, revenue, VAT, refunds, fees. */
export function salesGroups(lines, from, to, by, stockItems = []) {
  const siById = new Map(stockItems.map(x => [x.id, x]))
  const m = new Map(), cache = new Map()
  const at = (k, extra) => m.get(k) || m.set(k, { key: k, ...extra, ...blank() }).get(k)
  for (const l of lines || []) {
    if (l.sale_date < from || l.sale_date > to) continue
    if (by === 'product') {
      if (l.listing && !cache.has(l.listing.id)) cache.set(l.listing.id, productShares(l.listing, siById))
      const sh = l.listing ? cache.get(l.listing.id) : []
      const parts = sh.length ? sh : [{ id: null, name: l.source === 'wholesale' ? (l.name || NO_PRODUCT) : NO_PRODUCT, qty: 1, share: 1 }]
      for (const p of parts) addLine(at(p.id || p.name, { name: p.name, product_id: p.id }), l, p.share, p.qty)
      continue
    }
    const k = by === 'day' ? l.sale_date : by === 'week' ? weekStartOf(l.sale_date) : by === 'month' ? l.sale_date.slice(0, 7) : by === 'channel' ? l.channel : by === 'tag' ? tagLabel(l.tags)
      : by === 'asin' ? (l.asin || NO_ASIN) : (l.listing_sku || NO_SKU)
    const g = at(k, { name: null, listing_id: null, asin: null })
    if (by === 'listing' || by === 'asin') { g.name = g.name || l.listing?.name || l.name || null; g.listing_id = g.listing_id || l.listing_id || null; g.asin = g.asin || l.asin || null }
    addLine(g, l)
  }
  return [...m.values()].map(done)
}

/** One row for every day from..to, sold or not */
export function salesByDay(lines, from, to) {
  const m = new Map()
  for (let d = from; d <= to; d = addDays(d, 1)) m.set(d, { d, ...blank() })
  for (const l of lines || []) { const g = m.get(l.sale_date); if (g) addLine(g, l) }
  return [...m.values()].map(done)
}
export function salesByWeek(rows) {
  const m = new Map()
  for (const r of rows) {
    const k = weekStartOf(r.d)
    const w = m.get(k) || m.set(k, { d: k, to: r.d, orders: 0, units: 0, revenue: 0, incVat: 0, refunds: 0 }).get(k)
    w.to = r.d; w.orders += r.orders; w.units += r.units; w.revenue += r.revenue; w.incVat += r.incVat; w.refunds += r.refunds
  }
  return [...m.values()]
}

/**
 * What changed against the period before: every row of `now` beside the same key in `was`, plus the rows that sold
 * before and not now. change = revenue now − revenue before.
 */
export function movers(now, was) {
  const before = new Map(was.map(r => [r.key, r]))
  const out = now.map(r => { const b = before.get(r.key); before.delete(r.key); return { ...r, was: b ? b.revenue : 0, wasUnits: b ? b.units : 0, change: r.revenue - (b ? b.revenue : 0), isNew: !b || !(b.revenue > 0) } })
  for (const b of before.values()) if (b.revenue > 0) out.push({ ...b, orders: 0, units: 0, revenue: 0, incVat: 0, was: b.revenue, wasUnits: b.units, change: -b.revenue, stopped: true })
  return out
}
