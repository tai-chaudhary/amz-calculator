// v2.91.0 — shipping in the P&L from more than HELM's parcels (report_pl_ship): the portal's own labels, the weight of
// orders that have no listing, and how a listing and quantity has really shipped.
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildPnl } from '../src/lib/pnl.js'

const near = (a, b, d = 0.005) => assert.ok(Math.abs(a - b) <= d, `${a} is not ${b}`)
const settings = {
  carriers: {
    evri: { name: 'Evri', maxWeight: 15, services: { nextday: true, standard: true }, multi: { rule: 'same' },
      helmServices: [{ name: 'Evri Next Day Contract Rate', service: 'nextday' }, { name: 'Hermes 48 POD', service: 'standard' }],
      categories: [{ id: 'a', name: 'Under 2KG', maxKg: 2, rates: { nextday: 2.07, standard: 1.97 } }, { id: 'b', name: '2-15KG', maxKg: 15, rates: { nextday: 2.70, standard: 2.50 } }] },
    dhl: { name: 'DHL', maxWeight: 30, services: { nextday: true }, multi: { rule: 'subsequent', rate: 3 }, helmServices: [{ name: 'DHL Parcel UK Parcel', service: 'nextday' }],
      categories: [{ id: 'n', name: 'Next Day', maxKg: 30, rates: { nextday: 4.59 } }] },
  },
  packaging: [{ id: 'm8', name: 'Mailer 8', cost: 0.16 }, { id: 'xl', name: 'XL', cost: 1.24 }],
}
const stockItems = [{ id: 'jug', name: 'Jug', data: { costPrice: '2.50', weightKg: '0.5' } }, { id: 'salt', name: 'Salt', data: { costPrice: '3.17', weightKg: '25' } }]
const savedById = new Map([
  ['L1', { id: 'L1', name: 'Jug', data: { components: [{ stockItemId: 'jug', qty: 1 }], useComponents: true, sellPrice: '10.70', carrierId: 'evri', carrierCatId: 'a', serviceLevel: 'nextday', packagingId: 'm8' } }],
  ['L2', { id: 'L2', name: 'Salt', data: { components: [{ stockItemId: 'salt', qty: 1 }], useComponents: true, sellPrice: '16.90', carrierId: 'dhl', carrierCatId: 'n', serviceLevel: 'nextday', packagingId: 'xl' } }],
])
const sale = (ref, listing, qty, extra = {}) => ({ kind: 'sale', sale_date: '2026-11-03', channel: 'Amazon', order_ref: ref, listing_id: listing, qty, gross: 10 * qty, vat: 1.67 * qty, fees: -1.3 * qty, ...extra })
const run = (lines, parcels = {}, ship = undefined) => buildPnl({ lines, parcels, ship, savedById, stockItems, settings })
const pick = (o) => o.map(l => [l.shipping, l.packaging, l.shipFrom, l.packFrom])

test('nothing new to go on: every figure is exactly what it was', () => {
  const lines = [sale('A', 'L1', 1), sale('B', 'L2', 2), sale('C', 'L1', 3), sale('D', null, 1, { channel: 'eBay' })]
  const parcels = { A: ['Evri Next Day Contract Rate'], B: ['DHL Parcel UK Parcel', 'DHL Parcel UK Parcel'], D: ['Evri Next Day Contract Rate'] }
  const before = run(lines, parcels)                 // as the page calls it when report_pl_ship is not there
  for (const ship of [null, {}, { extra_labels: {}, weights: {}, ship_patterns: {} }]) assert.deepEqual(pick(run(lines, parcels, ship)), pick(before))
  near(before[0].shipping, 2.07); near(before[1].shipping, 7.59); near(before[2].shipping, 3 * 2.07); near(before[3].shipping, 2.07)
  assert.equal(before[2].shipFrom, 'estimated')
})

test('a label bought outside HELM is costed from the portal\'s own label, at our rates', () => {
  // Amazon Buy Shipping = our Evri account: next day, 0.5kg
  let o = run([sale('A', 'L1', 1)], {}, { extra_labels: { A: [{ carrier: 'Evri', service: 'Next Day' }] } })
  near(o[0].shipping, 2.07); assert.equal(o[0].shipFrom, 'labels'); assert.equal(o[0].shipVia, 'portal'); near(o[0].packaging, 0.16)
  // Evri 48 hour is "Standard" on the label
  o = run([sale('A', 'L1', 1)], {}, { extra_labels: { A: [{ carrier: 'Evri', service: 'Standard' }] } })
  near(o[0].shipping, 1.97)
  // a 25kg bag by DHL, label bought on DHL's own site
  o = run([sale('B', 'L2', 1)], {}, { extra_labels: { B: [{ carrier: 'DHL', service: 'Next Day' }] } })
  near(o[0].shipping, 4.59); near(o[0].packaging, 1.24)
})

test('a second parcel HELM does not know about is added to the order — with the carrier\'s rule for more than one', () => {
  const o = run([sale('B', 'L2', 2)], { B: ['DHL Parcel UK Parcel'] }, { extra_labels: { B: [{ carrier: 'DHL', service: 'Next Day' }] } })
  near(o[0].shipping, 4.59 + 3); assert.equal(o[0].shipVia, 'helm+portal'); near(o[0].packaging, 2 * 1.24)
  // an Evri top-up on an Evri order: each at its own rate, weight shared over the two
  const e = run([sale('C', 'L1', 12)], { C: ['Evri Next Day Contract Rate'] }, { extra_labels: { C: [{ carrier: 'Evri', service: 'Next Day' }] } })
  near(e[0].shipping, 2 * 2.70)   // 6kg over two parcels = 3kg each
})

test('a label for a carrier Cost Settings does not know is left out, not guessed', () => {
  const o = run([sale('A', 'L1', 1)], { A: ['Evri Next Day Contract Rate'] }, { extra_labels: { A: [{ carrier: 'Yodel', service: 'Next Day' }] } })
  near(o[0].shipping, 2.07); assert.equal(o[0].shipVia, 'helm')
  const none = run([sale('A', 'L1', 1)], {}, { extra_labels: { A: [{ carrier: 'Yodel', service: 'Next Day' }] } })
  assert.equal(none[0].shipFrom, 'estimated')
})

test('an order with no listing is weighed by the stock that went out, not as nothing', () => {
  const lines = [sale('E', null, 1, { channel: 'eBay' })]
  const parcels = { E: ['Evri Next Day Contract Rate'] }
  near(run(lines, parcels)[0].shipping, 2.07)                               // before: 0kg, the lightest band
  near(run(lines, parcels, { weights: { E: 10 } })[0].shipping, 2.70)       // a 10kg bag
  // two lines with no listing still share the order's shipping between them
  const two = run([sale('F', null, 1, { channel: 'eBay' }), sale('F', null, 1, { channel: 'eBay' })], { F: ['Evri Next Day Contract Rate'] }, { weights: { F: 10 } })
  near(two[0].shipping + two[1].shipping, 2.70); near(two[0].shipping, 1.35)
})

test('no label at all, several units on one line: as many parcels as that listing and quantity really goes in', () => {
  const lines = [sale('G', 'L1', 3, { sale_date: '2026-09-10' })]
  near(run(lines)[0].shipping, 3 * 2.07)                                                              // before: a parcel for every unit
  const one = run(lines, {}, { ship_patterns: { 'L1|3': { parcels: 1, service: 'Evri Next Day Contract Rate', seen: 4 } } })
  near(one[0].shipping, 2.07); assert.equal(one[0].shipFrom, 'estimated'); assert.equal(one[0].shipVia, 'pattern')   // 1.5kg in one parcel
  const heavy = run([sale('H', 'L2', 2, { sale_date: '2026-09-10' })], {}, { ship_patterns: { 'L2|2': { parcels: 2, service: 'DHL Parcel UK Parcel', seen: 9 } } })
  near(heavy[0].shipping, 4.59 + 3)                                                                   // two bags, two DHL parcels
  // a quantity never seen, a service Cost Settings does not know, or more than one line: the old estimate stands
  near(run(lines, {}, { ship_patterns: { 'L1|2': { parcels: 1, service: 'Evri Next Day Contract Rate', seen: 4 } } })[0].shipping, 3 * 2.07)
  near(run(lines, {}, { ship_patterns: { 'L1|3': { parcels: 1, service: 'Mystery', seen: 4 } } })[0].shipping, 3 * 2.07)
  const mixed = run([sale('I', 'L1', 3), sale('I', 'L2', 1)], {}, { ship_patterns: { 'L1|3': { parcels: 1, service: 'Evri Next Day Contract Rate', seen: 4 } } })
  near(mixed[0].shipping, 3 * 2.07); near(mixed[1].shipping, 4.59)
})

// ── v2.93.0 — who carried it, for the breakdown under Shipping ───────────────────────────────────────────────────────
test('every line with shipping says who carried it, and the figures are untouched', () => {
  const lines = [sale('A', 'L1', 1), sale('B', 'L2', 2), sale('C', 'L1', 1), sale('E', 'L1', 1)]
  const parcels = { A: ['Evri Next Day Contract Rate'], B: ['DHL Parcel UK Parcel', 'DHL Parcel UK Parcel'], E: ['Evri Next Day Contract Rate', 'DHL Parcel UK Parcel'] }
  const out = run(lines, parcels)
  const by = Object.fromEntries(out.map(l => [l.order_ref, l.shipCarrier]))
  assert.equal(by.A, 'Evri'); assert.equal(by.B, 'DHL')
  assert.equal(by.E, 'More than one carrier')
  assert.match(by.C, /^Estimated, no label yet/)                       // no label found: the listing's own figure
  for (const l of out) if (l.shipping > 0) assert.ok(l.shipCarrier, `${l.order_ref} has shipping and no carrier name`)
  near(out.find(l => l.order_ref === 'A').shipping, 2.07); near(out.find(l => l.order_ref === 'B').shipping, 7.59)
})
