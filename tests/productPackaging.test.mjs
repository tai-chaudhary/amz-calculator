import test from 'node:test'
import assert from 'node:assert/strict'
import { packagingOn, basketPackaging, groupProductPackaging, packagingStates, isWebsiteChannel } from '../src/lib/productPackaging.js'
import { buildPnl } from '../src/lib/pnl.js'

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} is not ${b}`)
const ROWS = [
  { id: 1, stock_item_id: 'jug', from_date: '2026-08-01', packaging_id: 'glass', own: false },
  { id: 2, stock_item_id: 'salt', from_date: '2026-08-01', packaging_id: 'box10', own: false },
  { id: 3, stock_item_id: 'roll', from_date: '2026-08-01', packaging_id: null, own: true },
  { id: 4, stock_item_id: 'jug', from_date: '2026-11-10', packaging_id: 'box10', own: false },
  { id: 5, stock_item_id: 'gone', from_date: '2026-08-01', packaging_id: 'deleted-type', own: false },
]
const COST = { glass: 0.27, box10: 0.54 }
const costOf = (id) => (id in COST ? COST[id] : null)

test('a product’s own packaging on a day: the latest dated on or before it', () => {
  assert.equal(packagingOn(ROWS, 'jug', '2026-11-09').packaging_id, 'glass')
  assert.equal(packagingOn(ROWS, 'jug', '2026-11-10').packaging_id, 'box10')
  assert.equal(packagingOn(ROWS, 'jug', '2026-07-31'), null)
  assert.equal(packagingOn(ROWS, 'unknown', '2026-11-10'), null)
  assert.equal(packagingOn(groupProductPackaging(ROWS), 'jug', '2026-09-01').id, 1)
  const st = packagingStates(ROWS.filter(r => r.stock_item_id === 'jug'), '2026-11-01')
  assert.equal(st.get(1), 'current'); assert.equal(st.get(4), 'to come')
  assert.equal(isWebsiteChannel('Shopify'), true); assert.equal(isWebsiteChannel('WooCommerce'), true); assert.equal(isWebsiteChannel('eBay'), false)
})

test('a basket: the biggest item decides the box', () => {
  // a jug (27p glass box) and a bag of salt (54p box): the salt's box
  const b = basketPackaging({ productIds: ['jug', 'salt'], rows: ROWS, day: '2026-10-01', costOf })
  assert.deepEqual({ known: b.known, cost: b.cost, productId: b.productId, packagingId: b.packagingId }, { known: true, cost: 0.54, productId: 'salt', packagingId: 'box10' })
  // a product sent in its own packaging costs nothing, and is "known"
  const own = basketPackaging({ productIds: ['roll'], rows: ROWS, day: '2026-10-01', costOf })
  assert.deepEqual({ known: own.known, cost: own.cost, own: own.own }, { known: true, cost: 0, own: true })
  // a roll with a jug: the jug's box
  near(basketPackaging({ productIds: ['roll', 'jug', 'jug'], rows: ROWS, day: '2026-10-01', costOf }).cost, 0.27)
  // products with nothing set, or whose packaging type has been deleted, are reported and do not decide anything
  const part = basketPackaging({ productIds: ['jug', 'unknown', 'gone'], rows: ROWS, day: '2026-10-01', costOf })
  assert.equal(part.cost, 0.27); assert.deepEqual(part.missing, ['unknown', 'gone'])
  const none = basketPackaging({ productIds: ['unknown'], rows: ROWS, day: '2026-10-01', costOf })
  assert.equal(none.known, false); assert.equal(none.cost, 0)
  assert.equal(basketPackaging({ productIds: [], rows: ROWS, day: '2026-10-01', costOf }).known, false)
})

test('the P&L costs a website order as one basket, and every other channel as before', () => {
  const settings = {
    carriers: {
      evri: { name: 'Evri', maxWeight: 15, services: { nextday: true }, multi: { rule: 'same' }, helmServices: [{ name: 'Evri Next Day Contract Rate', service: 'nextday' }],
        categories: [{ id: 'a', name: 'Under 2KG', maxKg: 2, rates: { nextday: 2.07 } }, { id: 'b', name: '2-15KG', maxKg: 15, rates: { nextday: 2.70 } }] },
      dhl: { name: 'DHL', maxWeight: 30, services: { nextday: true }, multi: { rule: 'subsequent', rate: 3 }, helmServices: [{ name: 'DHL Parcel UK Parcel', service: 'nextday' }],
        categories: [{ id: 'n', name: 'Next Day', maxKg: 30, rates: { nextday: 4.59 } }] },
    },
    packaging: [{ id: 'glass', name: 'Medium Glass Item', cost: 0.27 }, { id: 'box10', name: '10KG Box', cost: 0.54 }],
  }
  const stockItems = [
    { id: 'jug', name: 'Pyrex Jug 1L', data: { sku: 'PYREX-JUG-GLASS-1L', costPrice: '4.51', weightKg: '0.82' } },
    { id: 'salt', name: 'Brown Salt 25kg', data: { sku: 'UNBRND-SALT-BROWN-DEICING-25KG', costPrice: '3.17', weightKg: '25' } },
  ]
  const savedById = new Map([['L1', { id: 'L1', name: 'Jug on Amazon', data: { components: [{ stockItemId: 'jug', qty: 1 }], useComponents: true, sellPrice: '12.95', carrierId: 'evri', carrierCatId: 'a', serviceLevel: 'nextday', packagingId: 'glass' } }]])
  const web = [
    { kind: 'sale', sale_date: '2026-11-17', channel: 'Shopify', order_ref: 'W1', listing_id: null, item_code: 'PYREX-JUG-GLASS-1L', listing_sku: 'PYREX-JUG-GLASS-1L', qty: 1, gross: 13.03, vat: 1.76, fees: -0.35 },
    { kind: 'sale', sale_date: '2026-11-17', channel: 'Shopify', order_ref: 'W1', listing_id: null, item_code: 'unbrnd-salt-brown-deicing-25kg', listing_sku: null, qty: 1, gross: 13.04, vat: 1.76, fees: -0.34 },
  ]
  const amazon = [{ kind: 'sale', sale_date: '2026-11-17', channel: 'Amazon', order_ref: 'A1', listing_id: 'L1', qty: 1, gross: 12.95, vat: 2.16, fees: -1.98 }]
  const args = { savedById, stockItems, settings, productPackaging: ROWS }

  // one DHL parcel: one box, the dearer of the two products' own (the jug's became the 10KG box on 10 Nov, so 54p either way)
  let out = buildPnl({ ...args, lines: [...web, ...amazon], parcels: { W1: ['DHL Parcel UK Parcel'] }, ship: { weights: { W1: 25.82 } } })
  near(out[0].packaging + out[1].packaging, 0.54); assert.equal(out[0].packFrom, 'basket'); assert.equal(out[1].packFrom, 'basket')
  near(out[0].shipping + out[1].shipping, 4.59)
  // the Amazon order is exactly what it is without any of this
  const plain = buildPnl({ savedById, stockItems, settings, lines: amazon })
  near(out[2].packaging, plain[0].packaging); near(out[2].shipping, plain[0].shipping); assert.equal(out[2].packFrom, plain[0].packFrom)

  // sent as two parcels: two boxes
  out = buildPnl({ ...args, lines: web, parcels: { W1: ['DHL Parcel UK Parcel', 'Evri Next Day Contract Rate'] }, ship: { weights: { W1: 25.82 } } })
  near(out[0].packaging + out[1].packaging, 1.08)

  // no label yet: one box
  out = buildPnl({ ...args, lines: web })
  near(out[0].packaging + out[1].packaging, 0.54)

  // before 10 Nov the jug's own packaging was the 27p glass box: a jug alone costs 27p
  out = buildPnl({ ...args, lines: [{ ...web[0], sale_date: '2026-11-05', order_ref: 'W0' }] })
  near(out[0].packaging, 0.27)

  // the stock that actually left decides, when the costing has it (here: only salt left)
  out = buildPnl({ ...args, lines: [{ ...web[0], sale_date: '2026-11-05', order_ref: 'W2' }], ship: { order_products: { W2: [{ id: 'salt', name: 'Brown Salt 25kg', units: 1 }] } } })
  near(out[0].packaging, 0.54)

  // products with nothing set: no packaging, and marked so (never a guess)
  out = buildPnl({ ...args, productPackaging: [], lines: web })
  assert.equal(out[0].packaging, 0); assert.equal(out[0].packFrom, 'none')

  // an eBay order with no listing is NOT a basket: as before, nothing
  out = buildPnl({ ...args, lines: [{ ...web[0], channel: 'eBay', order_ref: 'E1' }] })
  assert.equal(out[0].packaging, 0); assert.equal(out[0].packFrom, 'none')
})

test('each P&L line carries its parcels: the labels where there are any, else what the listing sends', () => {
  const settings = {
    carriers: { dhl: { name: 'DHL', maxWeight: 30, services: { nextday: true }, multi: { rule: 'subsequent', rate: 3 }, helmServices: [{ name: 'DHL Parcel UK Parcel', service: 'nextday' }],
      categories: [{ id: 'n', name: 'Next Day', maxKg: 30, rates: { nextday: 4.59 } }] } },
    packaging: [{ id: 'xl', name: 'XL', cost: 1.24 }],
  }
  const stockItems = [{ id: 'salt', name: 'Salt', data: { costPrice: '3.17', weightKg: '25' } }]
  const savedById = new Map([
    ['L2', { id: 'L2', name: 'Salt', data: { components: [{ stockItemId: 'salt', qty: 1 }], useComponents: true, sellPrice: '16.90', carrierId: 'dhl', carrierCatId: 'n', serviceLevel: 'nextday', packagingId: 'xl' } }],
    ['L3', { id: 'L3', name: 'Salt in two parcels', data: { components: [{ stockItemId: 'salt', qty: 2 }], useComponents: true, sellPrice: '30', carrierId: 'dhl', carrierCatId: 'n', serviceLevel: 'nextday', packagingId: 'xl', parcelSplit: true, numParcels: '2' } }],
  ])
  const line = (ref, id, qty) => ({ kind: 'sale', sale_date: '2026-10-20', channel: 'Amazon', order_ref: ref, listing_id: id, qty, gross: 16.9 * qty, vat: 2.82 * qty, fees: -2 })
  const out = buildPnl({ lines: [line('A', 'L2', 2), line('B', 'L2', 3), line('C', 'L3', 1), { ...line('D', null, 1), channel: 'eBay' }],
    parcels: { A: ['DHL Parcel UK Parcel', 'DHL Parcel UK Parcel'] }, savedById, stockItems, settings })
  near(out[0].parcels, 2)          // two labels
  near(out[1].parcels, 3)          // no label: the listing sends one parcel for each one sold
  near(out[2].parcels, 2)          // no label: a listing split over two parcels
  assert.equal(out[3].parcels || 0, 0)   // no listing and no label: not known, never guessed
})
