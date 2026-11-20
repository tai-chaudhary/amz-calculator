// The Profit & Loss screen: what each period is compared with, and that the totals add up.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { periodRange, spanFor, summarise, byDay, byWeek, extrasByDay, weekStartOf, quarterStartOf, glance } from '../src/lib/pnlScreen.js'

const TODAY = '2026-11-15'   // a Sunday
const dates = (r) => [r.from, r.to]

test('yesterday is compared with the day before', () => {
  const r = periodRange('yesterday', TODAY)
  assert.deepEqual(dates(r), ['2026-11-14', '2026-11-14'])
  assert.deepEqual(dates(r.prev), ['2026-11-13', '2026-11-13'])
  assert.equal(r.prev.name, 'The day before')
})

test('today is compared with yesterday', () => {
  assert.deepEqual(dates(periodRange('today', TODAY).prev), ['2026-11-14', '2026-11-14'])
})

test('weeks run Monday to Sunday and are compared with the week before', () => {
  assert.equal(weekStartOf('2026-11-15'), '2026-11-09')
  assert.equal(weekStartOf('2026-11-09'), '2026-11-09')
  const last = periodRange('lastweek', TODAY)
  assert.deepEqual(dates(last), ['2026-11-02', '2026-11-08'])
  assert.deepEqual(dates(last.prev), ['2026-10-26', '2026-11-01'])
  // a week still running is set against the same days of the week before
  const wed = periodRange('week', '2026-11-11')
  assert.deepEqual(dates(wed), ['2026-11-09', '2026-11-11'])
  assert.deepEqual(dates(wed.prev), ['2026-11-02', '2026-11-04'])
  assert.equal(wed.prev.name, 'Same days the week before')
  assert.equal(periodRange('week', TODAY).prev.name, 'The week before')   // Sunday: the week is whole
})

test('months are compared with the month before', () => {
  const m = periodRange('month', TODAY)
  assert.deepEqual(dates(m), ['2026-11-01', '2026-11-15'])
  assert.deepEqual(dates(m.prev), ['2026-10-01', '2026-10-15'])
  const last = periodRange('lastmonth', TODAY)
  assert.deepEqual(dates(last), ['2026-10-01', '2026-10-31'])
  assert.deepEqual(dates(last.prev), ['2026-09-01', '2026-09-30'])
  // the 31st of a month against a 30-day month stops at the 30th
  assert.deepEqual(dates(periodRange('month', '2026-12-31').prev), ['2026-11-01', '2026-11-30'])
  assert.deepEqual(dates(periodRange('month', '2027-03-30').prev), ['2027-02-01', '2027-02-28'])
})

test('quarters are compared with the quarter before, and nothing is compared with dates before 1 August', () => {
  assert.equal(quarterStartOf('2026-11-15'), '2026-10-01')
  const q = periodRange('quarter', TODAY)
  assert.deepEqual(dates(q), ['2026-10-01', '2026-11-15'])
  // 46 days into Jul–Sep would be 1 Jul – 15 Aug; the ledger starts on 1 Aug
  assert.deepEqual(dates(q.prev), ['2026-08-01', '2026-08-15'])
  assert.equal(q.prev.partial, true)
  const lq = periodRange('lastquarter', TODAY)
  assert.deepEqual(dates(lq), ['2026-08-01', '2026-09-30'])   // Jul–Sep, from the first day there are figures
  assert.equal(lq.prev, null)
  const next = periodRange('lastquarter', '2027-02-10')
  assert.deepEqual(dates(next), ['2026-10-01', '2026-12-31'])
  assert.deepEqual(dates(next.prev), ['2026-08-01', '2026-09-30'])
})

test('custom dates are compared with the same number of days before', () => {
  const r = periodRange('custom', TODAY, { from: '2026-11-03', to: '2026-11-09' })
  assert.deepEqual(dates(r.prev), ['2026-10-27', '2026-11-02'])
  assert.equal(r.prev.name, 'The 7 days before')
})

test('one load covers the period, its comparison, the chart, the 7 days before and the month so far', () => {
  const s = spanFor(periodRange('yesterday', TODAY))
  assert.equal(s.from, '2026-11-01'); assert.equal(s.to, '2026-11-14')
  assert.equal(s.chartFrom, '2026-11-01')
  assert.deepEqual(s.weekBefore, { from: '2026-11-07', to: '2026-11-13' })
  assert.deepEqual(s.monthToDate, { from: '2026-11-01', to: '2026-11-14' })
  const m = spanFor(periodRange('lastmonth', TODAY))
  assert.equal(m.from, '2026-09-01'); assert.equal(m.to, '2026-10-31'); assert.equal(m.monthToDate, null)
})

const line = (o) => ({ kind: 'sale', channel: 'Amazon', qty: 1, vat: 0, fees: 0, cogs: 0, shipping: 0, packaging: 0, cogsFrom: 'fifo', shipFrom: 'labels', listing: { data: {} }, ...o })
const ctxOf = (lines, days, ohByDay) => ({ lines, ohOn: !!ohByDay, extras: extrasByDay({ days, ohByDay, ohOn: !!ohByDay }) })

test('gross profit is revenue less every direct cost; net profit takes the overheads off', () => {
  const ctx = ctxOf([
    line({ sale_date: '2026-11-14', order_ref: 'A1', gross: 12, vat: 2, fees: -1.5, cogs: 4, shipping: 2, packaging: 0.5, listing_sku: 'X' }),
    line({ sale_date: '2026-11-14', order_ref: 'A2', gross: 6, vat: 1, fees: -0.5, cogs: 2.5, shipping: 2.07, packaging: 0.12, listing_sku: 'Y', fee_estimated: true, cogsFrom: 'po' }),
    line({ kind: 'refund', sale_date: '2026-11-14', order_ref: 'A0', gross: -6, vat: -1, fees: 0.5 }),
    line({ sale_date: '2026-11-13', order_ref: 'B1', gross: 24, vat: 4, fees: -3, cogs: 8, shipping: 3, packaging: 1, channel: 'eBay' }),
  ], {
    charges: [{ d: '2026-11-14', channel: 'Amazon', amount: 3 }, { d: '2026-11-13', channel: 'eBay', amount: -2 }],
    replacements: [{ d: '2026-11-14', cost: 1.25, units: 2, orders: 1 }], losses: [],
  }, { '2026-11-13': 5, '2026-11-14': 5 })
  const t = summarise(ctx, '2026-11-14', '2026-11-14')
  assert.equal(t.sales, 15); assert.equal(t.orders, 2); assert.equal(t.units, 2); assert.equal(t.refunds, -5); assert.equal(t.refundOrders, 1)
  // 15 − 5 refunds − 1.5 fees − 6.5 goods − 4.07 shipping − 0.62 packaging + 3 credits − 1.25 replacements
  assert.equal(Math.round(t.gross * 100) / 100, -0.94)
  assert.equal(Math.round(t.direct * 100) / 100, 15.94)
  assert.equal(Math.round(t.net * 100) / 100, -5.94)
  assert.equal(t.feeEstimated, 1); assert.equal(t.notCosted, 1); assert.equal(t.notCostedCogs, 2.5)
  assert.equal(t.replacementOrders, 1)
  // A2: 5 − 0.5 − 2.5 − 2.07 − 0.12 = −0.19, the only order that lost money
  assert.deepEqual(t.losing.map(o => o.ref), ['A2']); assert.equal(Math.round(t.losingTotal * 100) / 100, -0.19)
  // the day before is a different channel with its own charge
  const p = summarise(ctx, '2026-11-13', '2026-11-13')
  assert.equal(p.gross, 20 - 3 - 8 - 3 - 1 - 2); assert.equal(p.net, 3 - 5)
  assert.deepEqual(p.channels.map(c => [c.channel, c.gross]), [['eBay', 3]])
  // both days together are the two days added up
  const both = summarise(ctx, '2026-11-13', '2026-11-14')
  assert.equal(Math.round(both.gross * 100), Math.round((t.gross + p.gross) * 100))
  // and the days of the chart add up to the same total
  const rows = byDay(ctx, '2026-11-12', '2026-11-14')
  assert.equal(rows.length, 3)
  assert.equal(rows[0].net, 0)   // nothing sold, no overhead entered that day
  assert.equal(Math.round(rows.reduce((s, r) => s + r.net, 0) * 100), Math.round(both.net * 100))
  assert.equal(byWeek(rows).length, 1)
})

test('break-even agrees with net profit, and a single channel has no net profit', () => {
  const lines = [line({ sale_date: '2026-11-14', order_ref: 'A1', gross: 120, vat: 20, cogs: 60 })]
  const t = summarise(ctxOf(lines, {}, { '2026-11-14': 20 }), '2026-11-14', '2026-11-14')
  assert.equal(t.gross, 40); assert.equal(t.breakEven, 50); assert.equal(t.net, 20)   // 40% margin: £50 covers £20
  const one = summarise(ctxOf(lines, {}, null), '2026-11-14', '2026-11-14')
  assert.equal(one.net, null); assert.equal(one.breakEven, null)
})

// ── v2.85.0: open orders, the profit split, by product, and the Sales page's sums ───────────────────────────────────
import { splitOf, groupByProduct, productShares } from '../src/lib/pnlScreen.js'
import { salesTotals, salesGroups, salesByDay, movers } from '../src/lib/salesScreen.js'

test('net profit is split 33% to Adrian Marsh and the rest to the partner', () => {
  const [am, us] = splitOf(300)
  assert.equal(am.name, 'Adrian Marsh'); assert.equal(Math.round(am.amount * 100), 9900); assert.equal(Math.round(us.amount * 100), 20100)
  assert.equal(Math.round(splitOf(-100).reduce((s, p) => s + p.amount, 0)), -100)
})

test('open orders are counted with today and told apart', () => {
  const ctx = ctxOf([
    line({ sale_date: '2026-11-15', order_ref: 'D1', gross: 12, vat: 2 }),
    line({ sale_date: '2026-11-15', order_ref: 'O1', gross: 24, vat: 4, open: true, fee_estimated: true, cogsFrom: 'current' }),
    line({ sale_date: '2026-11-15', order_ref: 'O1', gross: 6, vat: 1, open: true, fee_estimated: true, cogsFrom: 'current' }),
  ], {}, null)
  const t = summarise(ctx, '2026-11-15', '2026-11-15')
  assert.equal(t.orders, 2); assert.equal(t.openOrders, 1); assert.equal(t.openSales, 25); assert.equal(t.sales, 35)
})

test('a bundle is shared between its products by cost', () => {
  const stock = [{ id: 'a', name: 'Jug', data: { costPrice: '3' } }, { id: 'b', name: 'Lid', data: { costPrice: '1' } }]
  const bundle = { id: 'L1', name: 'Jug and two lids', data: { components: [{ stockItemId: 'a', qty: 1 }, { stockItemId: 'b', qty: 2 }] } }
  assert.deepEqual(productShares(bundle, new Map(stock.map(s => [s.id, s]))).map(p => [p.name, p.share]), [['Jug', 0.6], ['Lid', 0.4]])
  const lines = [line({ sale_date: '2026-11-14', order_ref: 'A1', qty: 2, gross: 24, vat: 4, fees: -2, cogs: 10, shipping: 4, packaging: 1, listing: bundle }),
    line({ sale_date: '2026-11-14', order_ref: 'A2', gross: 6, vat: 1, listing: null })]
  const rows = groupByProduct(lines, stock)
  const jug = rows.find(r => r.name === 'Jug'), lid = rows.find(r => r.name === 'Lid'), none = rows.find(r => r.key === '(not linked to a product)')
  assert.equal(jug.sales, 12); assert.equal(lid.sales, 8); assert.equal(jug.units, 2); assert.equal(lid.units, 4)
  assert.equal(Math.round((jug.profit + lid.profit) * 100), Math.round((20 - 2 - 10 - 4 - 1) * 100))   // the two add up to the listing
  assert.equal(none.sales, 5); assert.equal(none.unlinked, 1)
})

test('sales: totals, groups, days and movers', () => {
  const L = { id: 'L1', name: 'Jug', data: { components: [] } }
  const lines = [
    { kind: 'sale', sale_date: '2026-11-14', channel: 'Amazon', order_ref: 'A1', listing_sku: 'JUG', asin: 'B01', qty: 2, gross: 24, vat: 4, fees: -3, listing: L },
    { kind: 'sale', sale_date: '2026-11-14', channel: 'eBay', order_ref: 'E1', listing_sku: 'PVA', qty: 1, gross: 12, vat: 2, fees: -1, listing: null, fee_estimated: true },
    { kind: 'refund', sale_date: '2026-11-14', channel: 'Amazon', order_ref: 'A0', listing_sku: 'JUG', qty: 1, gross: -12, vat: -2, fees: 1, listing: L },
    { kind: 'sale', sale_date: '2026-11-13', channel: 'Amazon', order_ref: 'B1', listing_sku: 'SALT', qty: 1, gross: 6, vat: 1, fees: 0, listing: null },
  ]
  const t = salesTotals(lines, '2026-11-14', '2026-11-14')
  assert.equal(t.revenue, 30); assert.equal(t.vat, 6); assert.equal(t.incVat, 36); assert.equal(t.orders, 2); assert.equal(t.units, 3)
  assert.equal(t.refunds, -10); assert.equal(t.refundOrders, 1); assert.equal(t.perOrder, 15); assert.equal(t.estimated, 1); assert.equal(t.unlinked, 1)
  assert.deepEqual(t.channels.map(c => [c.channel, c.revenue]), [['Amazon', 20], ['eBay', 10]])
  const now = salesGroups(lines, '2026-11-14', '2026-11-14', 'listing'), was = salesGroups(lines, '2026-11-13', '2026-11-13', 'listing')
  assert.deepEqual(now.map(r => [r.key, r.revenue]).sort(), [['JUG', 20], ['PVA', 10]])
  const mv = movers(now, was)
  assert.equal(mv.find(r => r.key === 'SALT').stopped, true); assert.equal(mv.find(r => r.key === 'SALT').change, -5); assert.equal(mv.find(r => r.key === 'JUG').isNew, true)
  assert.deepEqual(salesByDay(lines, '2026-11-12', '2026-11-14').map(r => r.revenue), [0, 5, 30])
})

// ── v2.86.0: HELM's order tags ──────────────────────────────────────────────────────────────────────────────────────
import { attachTags, isPrime, groupByTag, primeSplit, tagLabel } from '../src/lib/pnlScreen.js'

test('order tags: Prime, no tag, and not known are three different things', () => {
  assert.equal(isPrime(['Prime']), true); assert.equal(isPrime(['PRIME - Dispatched']), true); assert.equal(isPrime(['Primed paint']), false)
  assert.equal(isPrime([]), false); assert.equal(isPrime(null), false)
  assert.equal(tagLabel(['Prime', 'Gift']), 'Gift + Prime'); assert.equal(tagLabel([]), '(no tag)'); assert.equal(tagLabel(null), '(tags not known)')
  const info = { tagged: { A1: ['Prime'] }, known_from: '2026-11-14' }
  const lines = attachTags([
    line({ sale_date: '2026-11-14', order_ref: 'A1', gross: 12, vat: 2, cogs: 4 }),
    line({ sale_date: '2026-11-14', order_ref: 'A2', gross: 6, vat: 1, cogs: 2 }),
    line({ sale_date: '2026-11-10', order_ref: 'A3', gross: 6, vat: 1 }),                       // despatched before tags were read
    line({ sale_date: '2026-11-15', order_ref: 'O1', gross: 24, vat: 4, open: true, tags: ['Prime'] }),
    line({ sale_date: '2026-11-15', order_ref: 'O2', gross: 6, vat: 1, open: true, tags: null }),   // not read yet
  ], info)
  assert.deepEqual(lines.map(l => l.tags), [['Prime'], [], null, ['Prime'], null])
  const s = primeSplit(lines)
  assert.equal(s.prime.orders, 2); assert.equal(s.prime.sales, 30); assert.equal(s.prime.profit, 26)
  assert.equal(s.other.orders, 1); assert.equal(s.other.sales, 5); assert.equal(s.unknown.orders, 2)
  assert.deepEqual(groupByTag(lines).map(r => [r.key, r.orders]).sort(), [['(no tag)', 1], ['(tags not known)', 2], ['Prime', 2]])
})

// ── v2.86.1: the products in an order that lost money ────────────────────────────────────────────────────────────────
import { orderProducts } from '../src/lib/pnlScreen.js'
test('orderProducts: each listing\'s products × units sold, the same product added up; unlinked lines say so', () => {
  const stock = [{ id: 's1', name: 'Peacock Salt 25KG Bag', data: { costPrice: 5 } }, { id: 's2', name: 'Scoop', data: { costPrice: 1 } }]
  const single = { id: 'l1', data: { components: [{ stockItemId: 's1', qty: 1 }] } }
  const bundle = { id: 'l2', data: { components: [{ stockItemId: 's1', qty: 2 }, { stockItemId: 's2', qty: 1 }] } }
  assert.deepEqual(orderProducts({ items: [{ listing: single, qty: 1 }] }, stock), [{ id: 's1', name: 'Peacock Salt 25KG Bag', qty: 1 }])
  assert.deepEqual(orderProducts({ items: [{ listing: single, qty: 1 }, { listing: bundle, qty: 2 }] }, stock),
    [{ id: 's1', name: 'Peacock Salt 25KG Bag', qty: 5 }, { id: 's2', name: 'Scoop', qty: 2 }])
  assert.equal(orderProducts({ items: [{ listing: null, qty: 1 }] }, stock)[0].name, '(not linked to a product)')
})

// ── v2.93.0 ────────────────────────────────────────────────────────────────────────────────────────────────────────
test('All time runs from 1 August 2026 to yesterday and has nothing to be compared with', () => {
  const r = periodRange('all', TODAY)
  assert.deepEqual(dates(r), ['2026-08-01', '2026-11-14'])
  assert.equal(r.prev, null)
  assert.equal(r.days, 106)
  const s = spanFor(r)
  assert.equal(s.from, '2026-08-01'); assert.equal(s.to, '2026-11-14')
  // on the very first day there is no yesterday to end on: it shows that one day rather than an upside-down range
  assert.deepEqual(dates(periodRange('all', '2026-08-01')), ['2026-08-01', '2026-08-01'])
})

test('an order is a loss only if it still loses after its cashback; the totals do not change', () => {
  const lines = [
    line({ sale_date: '2026-11-14', order_ref: 'L1', gross: 6, vat: 1, fees: -0.5, cogs: 2.5, shipping: 2.07, packaging: 0.12 }),  // −0.19 on its own
    line({ sale_date: '2026-11-14', order_ref: 'L2', gross: 6, vat: 1, fees: -0.5, cogs: 3.5, shipping: 2.07, packaging: 0.12 }),  // −1.19 on its own
    line({ sale_date: '2026-11-14', order_ref: 'L3', gross: 12, vat: 2, fees: -1, cogs: 3, shipping: 2.07, packaging: 0.12 }),    // +3.81
    line({ sale_date: '2026-11-14', order_ref: 'L4', gross: 12, vat: 2, fees: -1, cogs: 6.7, shipping: 2.07, packaging: 0.12 }),  // +0.11 on its own
  ]
  const days = { charges: [{ d: '2026-11-14', channel: 'Amazon', amount: 0.3 }], replacements: [], losses: [] }
  const plain = summarise(ctxOf(lines, days), '2026-11-14', '2026-11-14')
  assert.deepEqual(plain.losing.map(o => o.ref), ['L2', 'L1']); assert.equal(plain.savedByCredit, 0)
  // 30p cashback on L1 and L2 (and one for an order that is not in these dates)
  const ctx = { ...ctxOf(lines, days), orderCashback: { L1: 0.3, L2: 0.3, NOT_HERE: 9 } }
  const t = summarise(ctx, '2026-11-14', '2026-11-14')
  assert.deepEqual(t.losing.map(o => o.ref), ['L2'])                  // L1 is covered by its cashback; L2 still loses
  assert.deepEqual(t.losing.map(o => [Math.round(o.before * 100), o.credit, Math.round(o.profit * 100)]), [[-119, 0.3, -89]])
  assert.equal(Math.round(t.losingTotal * 100), -89)
  assert.equal(t.savedByCredit, 1)
  // the credits are already in "other charges and credits" by day: putting them against orders adds nothing twice
  assert.equal(t.gross, plain.gross); assert.equal(t.charges, plain.charges); assert.equal(t.sales, plain.sales)
})

test('shipping is added up by who carried it, and the parts make the whole', () => {
  const lines = [
    line({ sale_date: '2026-11-14', order_ref: 'S1', gross: 12, shipping: 2.07, shipCarrier: 'Evri' }),
    line({ sale_date: '2026-11-14', order_ref: 'S2', gross: 12, shipping: 2.7, shipCarrier: 'Evri' }),
    line({ sale_date: '2026-11-14', order_ref: 'S3', gross: 20, shipping: 4.59, shipCarrier: 'DHL' }),
    line({ sale_date: '2026-11-14', order_ref: 'S4', gross: 12, shipping: 1.97, shipFrom: 'estimated', shipCarrier: 'Estimated, no label yet (Evri)' }),
    line({ sale_date: '2026-11-14', order_ref: 'S5', gross: 12, shipping: 0, shipFrom: 'none', shipCarrier: null }),
    line({ sale_date: '2026-11-13', order_ref: 'S6', gross: 12, shipping: 5.1, shipCarrier: 'DPD' }),   // another day
  ]
  const t = summarise(ctxOf(lines, { charges: [], replacements: [], losses: [] }), '2026-11-14', '2026-11-14')
  const by = Object.fromEntries(Object.entries(t.shipBy).map(([k, v]) => [k, Math.round(v * 100) / 100]))
  assert.deepEqual(by, { Evri: 4.77, DHL: 4.59, 'Estimated, no label yet (Evri)': 1.97 })
  assert.equal(Math.round(Object.values(t.shipBy).reduce((s, v) => s + v, 0) * 100), Math.round(t.shipping * 100))
})


// ── v2.95.0 — the big card's "at a glance" ──────────────────────────────────────────────────────────────────────────
test('at a glance: days in profit, best, worst, average a day — and they add up to the period', () => {
  // gross by day: 9 Nov +10, 10 Nov −2, 11 Nov +6, 12 Nov nothing sold; overheads £3 a day
  const lines = [
    line({ sale_date: '2026-11-09', order_ref: 'G1', gross: 20, cogs: 10 }),
    line({ sale_date: '2026-11-10', order_ref: 'G2', gross: 10, cogs: 12 }),
    line({ sale_date: '2026-11-11', order_ref: 'G3', gross: 16, cogs: 10 }),
  ]
  const oh = { '2026-11-09': 3, '2026-11-10': 3, '2026-11-11': 3, '2026-11-12': 3 }
  const ctx = ctxOf(lines, { charges: [], replacements: [], losses: [] }, oh)
  const g = glance(ctx, '2026-11-09', '2026-11-12', { k: 'net' })
  assert.deepEqual(g.rows.map(r => r.v), [7, -5, 3, -3])
  assert.equal(g.days, 4); assert.equal(g.up, 2)
  assert.deepEqual([g.best.d, g.best.v], ['2026-11-09', 7]); assert.deepEqual([g.worst.d, g.worst.v], ['2026-11-10', -5])
  assert.equal(g.perDay, 0.5)
  assert.equal(g.total, summarise(ctx, '2026-11-09', '2026-11-12').net)      // the same net profit the card shows
  assert.equal(g.course, null)                                                // not asked for a running period
  // one channel (no overheads): on gross profit
  const gg = glance(ctxOf(lines, { charges: [], replacements: [], losses: [] }), '2026-11-09', '2026-11-12', { k: 'gross' })
  assert.deepEqual(gg.rows.map(r => r.v), [10, -2, 6, 0]); assert.equal(gg.up, 2)
  assert.equal(glance(ctx, '2026-11-12', '2026-11-11', {}), null)             // no days
})

test('at a glance: "at this pace" uses full days only, needs two of them, and stops when the period is over', () => {
  const lines = ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04'].map((d, i) => line({ sale_date: d, order_ref: `P${i}`, gross: 20, cogs: 10 }))
  lines.push(line({ sale_date: '2026-11-05', order_ref: 'P9', gross: 2, cogs: 1 }))      // today, barely started
  const ctx = ctxOf(lines, { charges: [], replacements: [], losses: [] }, Object.fromEntries(['01', '02', '03', '04', '05'].map(d => [`2026-11-${d}`, 4])))
  const month = periodRange('month', '2026-11-05')
  const g = glance(ctx, month.from, month.to, { k: 'net', range: month, today: '2026-11-05' })
  // four full days at £6 net each; today (−£3 so far) is left out; November has 30 days
  assert.deepEqual([g.course.fullDays, g.course.len, g.course.end, g.course.kind], [4, 30, '2026-11-30', 'month'])
  assert.equal(g.course.amount, 180)
  // the second day of a month: one full day is not enough to go on
  const early = periodRange('month', '2026-11-02')
  assert.equal(glance(ctx, early.from, early.to, { k: 'net', range: early, today: '2026-11-02' }).course, null)
  // a week: Monday to Sunday
  const week = periodRange('week', '2026-11-05')                               // Thursday; Mon 2 – Wed 4 are full
  const w = glance(ctx, week.from, week.to, { k: 'net', range: week, today: '2026-11-05' })
  assert.deepEqual([w.course.fullDays, w.course.len, w.course.end], [3, 7, '2026-11-08']); assert.equal(w.course.amount, 42)
  // periods that are over, a single day, All time and custom dates have no pace
  for (const id of ['lastweek', 'lastmonth', 'yesterday', 'today', 'all']) {
    const r = periodRange(id, '2026-11-05')
    assert.equal(glance(ctx, r.from, r.to, { k: 'net', range: r, today: '2026-11-05' }).course, null, id)
  }
  // a single day's card looks at the 14 days up to it instead: still no pace, because it is not the period itself
  const y = periodRange('today', '2026-11-05')
  assert.equal(glance(ctx, '2026-10-23', y.to, { k: 'net', range: y, today: '2026-11-05' }).course, null)
})


// ── v2.96.0 — the ASIN beside each listing SKU on an order that lost money ───────────────────────────────────────────
test('a losing order carries the ASIN of each of its listing SKUs', () => {
  const lines = [
    line({ sale_date: '2026-11-14', order_ref: 'A1', gross: 6, cogs: 9, listing_sku: 'SKU-ONE', asin: 'B0AAAAAAA1' }),
    line({ sale_date: '2026-11-14', order_ref: 'A1', gross: 6, cogs: 9, listing_sku: 'SKU-TWO', asin: null, listing: { id: 'x', data: { asin: 'B0BBBBBBB2' } } }),
    line({ sale_date: '2026-11-14', order_ref: 'A2', gross: 6, cogs: 9, listing_sku: 'EBAY-ITEM', asin: null }),          // eBay: no ASIN
  ]
  const t = summarise(ctxOf(lines, { charges: [], replacements: [], losses: [] }), '2026-11-14', '2026-11-14')
  const by = Object.fromEntries(t.losing.map(o => [o.ref, o]))
  assert.deepEqual(by.A1.skus, ['SKU-ONE', 'SKU-TWO'])
  assert.deepEqual(by.A1.asins, { 'SKU-ONE': 'B0AAAAAAA1', 'SKU-TWO': 'B0BBBBBBB2' })
  assert.deepEqual(by.A2.asins, {})
})


// ── v2.97.0 — an order with no listing names the stock that went out for it ──────────────────────────────────────────
test('an order with no listing shows what left the shelf; orders with a listing are as before', () => {
  const lines = [
    line({ sale_date: '2026-11-14', order_ref: 'EB1', channel: 'eBay', listing: null, listing_id: null, listing_sku: '366643105364', gross: 6, cogs: 9 }),
    line({ sale_date: '2026-11-14', order_ref: 'EB2', channel: 'eBay', listing: null, listing_id: null, listing_sku: '366601900474', gross: 6, cogs: 9 }),
  ]
  const t = summarise(ctxOf(lines, { charges: [], replacements: [], losses: [] }), '2026-11-14', '2026-11-14')
  const by = Object.fromEntries(t.losing.map(o => [o.ref, o]))
  assert.equal(by.EB1.unlinked, true)
  const left = { EB1: [{ id: 's-salt', name: 'Peacock White De-Icing Salt 20kg', units: 2 }, { id: 's-jug', name: 'Jug', units: 1 }] }
  const names = new Map([['s-jug', { id: 's-jug', name: 'Pyrex Glass Measuring Jug 500ml' }]])
  assert.deepEqual(orderProducts(by.EB1, names, left), [
    { id: 's-salt', name: 'Peacock White De-Icing Salt 20kg', qty: 2, fromStock: true },
    { id: 's-jug', name: 'Pyrex Glass Measuring Jug 500ml', qty: 1, fromStock: true },                 // today's name for the product
  ])
  // nothing recorded as leaving the shelf: still says so plainly, as before
  assert.deepEqual(orderProducts(by.EB2, names, left).map(p => p.name), ['(not linked to a product)'])
  assert.deepEqual(orderProducts(by.EB1, names).map(p => p.name), ['(not linked to a product)'])      // no map given: exactly as before
})


// ── v2.100.0 — Fulfilment cost: shipping + packaging + the overheads marked as fulfilment ───────────────────────────
test('fulfilment cost regroups shipping, packaging and the marked overheads; no profit figure moves', () => {
  const lines = [
    line({ sale_date: '2026-10-01', order_ref: 'A1', gross: 24, shipping: 2.5, packaging: 0.3, qty: 2 }),
    line({ sale_date: '2026-10-02', order_ref: 'A2', gross: 12, shipping: 2.0, packaging: 0.2, qty: 1 }),
    line({ sale_date: '2026-10-05', order_ref: 'A3', gross: 12, shipping: 9, packaging: 9, qty: 1 }),                 // outside the dates asked for
  ]
  const ohByDay = { '2026-10-01': 650, '2026-10-02': 650, '2026-10-05': 650 }
  const fulByDay = { '2026-10-01': 410, '2026-10-02': 410, '2026-10-05': 410 }
  const base = { lines, ohOn: true }
  const plain = summarise({ ...base, extras: extrasByDay({ days: {}, ohByDay, ohOn: true }) }, '2026-10-01', '2026-10-02')
  const t = summarise({ ...base, extras: extrasByDay({ days: {}, ohByDay, ohOn: true, fulByDay }) }, '2026-10-01', '2026-10-02')
  assert.equal(t.fulfilOh, 820)
  assert.ok(Math.abs(t.fulfilment - (4.5 + 0.5 + 820)) < 1e-9)
  assert.ok(Math.abs(t.fulfilmentPerOrder - 825 / 2) < 1e-9)
  assert.ok(Math.abs(t.fulfilmentPerUnit - 825 / 3) < 1e-9)
  for (const k of ['sales', 'gross', 'net', 'overheads', 'direct', 'shipping', 'packaging']) assert.equal(t[k], plain[k], k)      // nothing else moves
  assert.equal(plain.fulfilOh, 0)                                         // nothing marked: shipping and packaging only
  assert.ok(Math.abs(plain.fulfilment - 5) < 1e-9)
})

test('fulfilment cost is for the whole business only, and blank with no orders', () => {
  const lines = [line({ sale_date: '2026-10-01', order_ref: 'A1', gross: 24, shipping: 2.5, packaging: 0.3 })]
  const one = summarise({ lines, ohOn: false, extras: extrasByDay({ days: {}, ohByDay: { '2026-10-01': 650 }, ohOn: false, fulByDay: { '2026-10-01': 410 } }) }, '2026-10-01', '2026-10-01')
  assert.equal(one.fulfilment, null); assert.equal(one.fulfilmentPerOrder, null); assert.equal(one.fulfilOh, 0)
  const empty = summarise({ lines: [], ohOn: true, extras: extrasByDay({ days: {}, ohByDay: { '2026-10-03': 650 }, ohOn: true, fulByDay: { '2026-10-03': 410 } }) }, '2026-10-03', '2026-10-03')
  assert.equal(empty.fulfilment, 410); assert.equal(empty.fulfilmentPerOrder, null); assert.equal(empty.fulfilmentPerUnit, null)
})

test('advertising (v2.103.0): eBay Promoted Listings is shown on its own, and no total moves', async () => {
  const { extrasByDay, summarise, isAdvertising } = await import('../src/lib/pnlScreen.js')
  assert.equal(isAdvertising('Promoted listings'), true); assert.equal(isAdvertising('Sponsored Products'), true)
  assert.equal(isAdvertising('Subscription'), false); assert.equal(isAdvertising('FBM Ship+ cashback'), false); assert.equal(isAdvertising(null), false)
  const days = { charges: [{ d: '2026-10-01', channel: 'eBay', amount: -12.5 }, { d: '2026-10-01', channel: 'Amazon', amount: 4 }, { d: '2026-10-02', channel: 'eBay', amount: -3 }] }
  const chargeDays = [
    { d: '2026-10-01', channel: 'eBay', what: 'Promoted listings', amount: -10 }, { d: '2026-10-01', channel: 'eBay', what: 'Subscription', amount: -2.5 },
    { d: '2026-10-01', channel: 'Amazon', what: 'FBM Ship+ cashback', amount: 4 }, { d: '2026-10-02', channel: 'eBay', what: 'Promoted listings', amount: -3 },
  ]
  const withAds = summarise({ lines: [], extras: extrasByDay({ days, ohOn: false, chargeDays }) }, '2026-10-01', '2026-10-02')
  const without = summarise({ lines: [], extras: extrasByDay({ days, ohOn: false }) }, '2026-10-01', '2026-10-02')
  assert.equal(withAds.advertising, 13); assert.equal(without.advertising, 0)
  // the charges total, gross and net are the same whether or not the detail arrived
  assert.equal(withAds.charges, -11.5); assert.equal(without.charges, -11.5)
  assert.equal(withAds.gross, without.gross); assert.equal(withAds.net, without.net)
  // what is left on the charges line: −(charges) − advertising = 11.5 − 13 = −1.5 (the credit outweighs the subscription)
  assert.equal(-withAds.charges - withAds.advertising, -1.5)
  assert.equal(withAds.channels.find(c => c.channel === 'eBay').advertising, 13)
  // one day only
  assert.equal(summarise({ lines: [], extras: extrasByDay({ days, ohOn: false, chargeDays }) }, '2026-10-02', '2026-10-02').advertising, 3)
})
