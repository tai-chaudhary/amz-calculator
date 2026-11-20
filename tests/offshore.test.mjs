// v2.109.0 — Off Shore: remote zones, packing into parcels of 25kg at most, the cheapest active carrier, and the P&L
// costing an order to a remote district at its zone price.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import * as O from '../src/lib/offshore.js'
import { buildPnl } from '../src/lib/pnl.js'
import { summarise } from '../src/lib/pnlScreen.js'
import { amazonTransactionsToLines } from '../src/lib/salesImport.js'

const near = (a, b, d = 0.005) => assert.ok(Math.abs(a - b) <= d, `${a} is not ${b}`)
const zones = [
  { id: 'ze', carrierId: 'evri', name: 'Scottish Highlands & Islands', postcodes: 'HS, IV, KW, AB10-AB16, AB21-AB25, AB30-AB39, AB41-AB45, AB51-AB56, PH3, PH5-PH7, ZE', bands: [{ maxKg: 2, rate: 4 }, { maxKg: 15, rate: 5 }], next: '', from: '2026-08-01', to: '' },
  { id: 'dd', carrierId: 'dhl', name: 'Zone D – Highlands & islands', postcodes: 'AB31-AB38, AB41-AB56, HS, IV, KW, ZE1-ZE3', bands: [{ maxKg: 30, rate: 18.96 }], next: 11.95, from: '2026-08-01', to: '' },
  { id: 'pp', carrierId: 'dpd', name: 'Highlands & Islands', postcodes: 'HS, IV, KW, ZE', bands: [{ maxKg: 30, rate: 12.97 }], next: '', from: '2026-11-09', to: '' },
]
const carriers = {
  evri: { name: 'Evri', maxWeight: 15, active: true, primeOk: true, services: { nextday: true, standard: true }, multi: { rule: 'same' },
    helmServices: [{ name: 'Evri Next Day Contract Rate', service: 'nextday', helmId: 4329 }],
    categories: [{ id: 'a', name: 'Under 2KG', maxKg: 2, rates: { nextday: 2.07, standard: 1.97 } }, { id: 'b', name: '2-15KG', maxKg: 15, rates: { nextday: 2.70, standard: 2.50 } }] },
  dhl: { name: 'DHL', maxWeight: 30, active: true, primeOk: false, services: { nextday: true }, multi: { rule: 'subsequent', rate: 3 },
    helmServices: [{ name: 'DHL Parcel UK Parcel', service: 'nextday', helmId: 4227 }], categories: [{ id: 'n', name: 'Next Day', maxKg: 30, rates: { nextday: 4.59 } }] },
  dpd: { name: 'DPD', maxWeight: 30, active: false, primeOk: true, services: { nextday: true }, multi: { rule: 'all', rate: 3.5 }, categories: [{ id: 'p', name: 'Next Day', maxKg: 25, rates: { nextday: 5.10 } }] },
}
const day = '2026-11-19'
const best = (unitsKg, district, prime = false, c = carriers) => O.bestCarrier({ carriers: c, unitsKg, district, prime, day, zones })

test('the postcode district, as Amazon, HELM and labels write it', () => {
  assert.equal(O.districtOf('AB51 4XY'), 'AB51'); assert.equal(O.districtOf('ab514xy'), 'AB51'); assert.equal(O.districtOf('AB51 4'), 'AB51')
  assert.equal(O.districtOf('EC1A 1BB'), 'EC1A'); assert.equal(O.districtOf('W1'), 'W1'); assert.equal(O.districtOf(''), null); assert.equal(O.districtOf('hello there'), null)
})

test('postcode lists: areas, districts and ranges — and AB1 is not AB10', () => {
  const p = O.parsePostcodes('BT, PH3, AB31-AB38, KA27-28')
  for (const d of ['BT1', 'BT94', 'PH3', 'AB31', 'AB35', 'AB38', 'KA27', 'KA28']) assert.ok(p.test(d), d)
  for (const d of ['PH30', 'AB3', 'AB39', 'AB1', 'KA29', 'B1', 'SW1A']) assert.ok(!p.test(d), d)
  assert.deepEqual(O.parsePostcodes('AB31-CD38, ??').bad, ['AB31-CD38', '??'])
})

test('a zone holds only between its dates', () => {
  assert.equal(O.zoneFor(zones, 'dpd', 'IV2', '2026-11-08'), null)
  assert.equal(O.zoneFor(zones, 'dpd', 'IV2', '2026-11-09').id, 'pp')
  assert.equal(O.zoneFor(zones, 'evri', 'SW1A', day), null)
})

test('packing: no parcel over 25kg (Evri under 15kg), heaviest first; one item too heavy means that carrier can\'t', () => {
  assert.deepEqual(O.packParcels([10, 10, 10, 6], 25), [20, 16])
  assert.deepEqual(O.packParcels([25], 25), [25])
  assert.equal(O.packParcels([26], 25), null)
  assert.equal(O.parcelCap(carriers.dhl), 25)
  assert.ok(O.parcelCap(carriers.evri) < 15)
  assert.equal(O.packParcels([15], O.parcelCap(carriers.evri)), null)
})

test('the cheapest active carrier, with the extra over its mainland price', () => {
  let r = best([1], 'AB51')                    // Evri £4.00 instead of £2.07; DHL Zone D £18.96
  assert.equal(r.status, 'surcharged'); assert.equal(r.best.name, 'Evri'); near(r.best.cost, 4); near(r.best.extra, 1.93)
  r = best([1], 'SW1A')
  assert.equal(r.status, 'mainland'); near(r.best.cost, 2.07); near(r.best.extra, 0)
  // 20kg in one piece: Evri can't, DHL Zone D
  r = best([20], 'IV2')
  assert.equal(r.best.name, 'DHL'); near(r.best.cost, 18.96); near(r.best.extra, 18.96 - 4.59)
  assert.match(r.refused[0].why, /over Evri/)
  // 3 × 10kg to Shetland by Evri: 3 parcels at £5
  r = best([10, 10, 10], 'ZE2')
  assert.equal(r.best.name, 'Evri'); assert.equal(r.best.boxes.length, 3); near(r.best.cost, 15)
})

test('"Free to send": an off shore postcode the cheapest carrier sends at its mainland price', () => {
  // AB15 is Evri Highlands but DHL mainland: with Evri switched off, DHL sends it at its normal rate
  const r = best([1], 'AB15', false, { ...carriers, evri: { ...carriers.evri, active: false } })
  assert.equal(r.status, 'free'); assert.equal(r.best.name, 'DHL'); near(r.best.extra, 0)
})

test('Prime: only carriers that take Prime; a switched-off carrier is never suggested', () => {
  let r = best([20], 'IV2', true)           // Evri can't (weight), DHL not Prime, DPD switched off
  assert.equal(r.status, 'no-carrier'); assert.equal(r.best, null)
  r = best([20], 'IV2', true, { ...carriers, dpd: { ...carriers.dpd, active: true } })
  assert.equal(r.best.name, 'DPD'); near(r.best.cost, 12.97)
})

test('a surcharge in force adds to every parcel, zone or not', () => {
  const r = O.bestCarrier({ carriers, unitsKg: [1], district: 'AB51', day, zones, surcharges: [{ carrierId: 'evri', amount: 0.15, from: '2026-11-15', to: '2027-01-15' }] })
  near(r.best.cost, 4.15); near(r.best.extra, 1.93)
})

test('an order\'s units: product weights, else its listings\' weights (a bundle splits into its units)', () => {
  assert.deepEqual(O.unitsOf({ lines: [{ qty: 2, kg: 10 }, { qty: 1, kg: 0.5 }] }).unitsKg, [10, 10, 0.5])
  const u = O.unitsOf({ lines: [{ qty: 2, kg: null }], listings: [{ listing_sku: 'SALT-2', qty: 1 }] }, new Map([['salt-2', { kg: 30, units: 2 }]]))
  assert.deepEqual(u.unitsKg, [15, 15]); assert.equal(u.unknown, 0)
  assert.equal(O.unitsOf({ lines: [{ qty: 1, kg: null }] }).unknown, 1)
})

test('P&L: an order to a remote district costs its zone price, the extra shown as its own Shipping line', () => {
  const settings = { carriers, carrierZones: zones, packaging: [] }
  const stockItems = [{ id: 'jug', name: 'Jug', data: { costPrice: '2.50', weightKg: '0.5' } }]
  const savedById = new Map([['L1', { id: 'L1', name: 'Jug', data: { components: [{ stockItemId: 'jug', qty: 1 }], useComponents: true, sellPrice: '10', carrierId: 'evri', carrierCatId: 'a', serviceLevel: 'nextday' } }]])
  const sale = (ref) => ({ kind: 'sale', sale_date: '2026-11-03', channel: 'Amazon', order_ref: ref, listing_id: 'L1', qty: 1, gross: 10, vat: 1.67, fees: -1.3 })
  const lines = [sale('A'), sale('B'), sale('C')]
  const parcels = { A: ['Evri Next Day Contract Rate'], B: ['Evri Next Day Contract Rate'] }
  // without districts: exactly as before
  let o = buildPnl({ lines, parcels, ship: {}, savedById, stockItems, settings })
  near(o[0].shipping, 2.07); near(o[1].shipping, 2.07); near(o[2].shipping, 2.07)
  // A to Aberdeenshire (HELM parcel), C to Inverness (estimated from the listing), B to London
  o = buildPnl({ lines, parcels, ship: { districts: { A: 'AB51', B: 'SW1A', C: 'IV2' } }, savedById, stockItems, settings })
  near(o[0].shipping, 4); near(o[0].remote, 1.93); assert.equal(o[0].remoteZone, 'Scottish Highlands & Islands')
  near(o[1].shipping, 2.07); assert.ok(!o[1].remote)
  near(o[2].shipping, 4); near(o[2].remote, 1.93)
  const t = summarise({ lines: o }, '2026-11-01', '2026-11-30')
  near(t.shipping, 10.07); near(t.offshore, 3.86); near(t.shipBy['Off shore postcodes'], 3.86)
  near(Object.values(t.shipBy).reduce((a, b) => a + b, 0), t.shipping)
})

test('the Amazon report keeps only the postcode district of each order', () => {
  const rows = [
    ['date/time', 'settlement id', 'type', 'order id', 'sku', 'description', 'quantity', 'order city', 'order state', 'order postal', 'product sales', 'total'],
    ['3 Nov 2026 10:00:00 UTC', '1', 'Order', '206-1', 'SKU', 'Jug', '1', 'Town', 'Shire', 'AB51 4XY', '10', '8'],
    ['3 Nov 2026 10:00:00 UTC', '1', 'Order', '206-2', 'SKU', 'Jug', '1', 'Town', 'Shire', 'SW1A', '10', '8'],
  ]
  const r = amazonTransactionsToLines(rows)
  assert.deepEqual(r.districts, { '206-1': 'AB51', '206-2': 'SW1A' })
  assert.ok(!JSON.stringify(r).includes('4XY'))
})

test('the alert job\'s copy of offshore.js is the same as the portal\'s', () => {
  const a = fs.readFileSync(new URL('../src/lib/offshore.js', import.meta.url), 'utf8')
  const b = fs.readFileSync(new URL('../supabase/functions/offshore-check/offshore.js', import.meta.url), 'utf8')
  const strip = (s) => s.replace(/^\/\/ COPY[^\n]*\n/, '').replace("import { parcelsCost, surchargeOn } from './deps.js'\n", "import { parcelsCost } from './calc.js'\nimport { surchargeOn } from './surcharges.js'\n")
  assert.equal(strip(b), a, 'Copy src/lib/offshore.js to supabase/functions/offshore-check/offshore.js (see the file\'s first line)')
})
