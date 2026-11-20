// Prime in Dispatch (v2.87.0). The first rule tested here is the one that matters most to the people using Dispatch
// every day: with nothing Prime, an upload plans, groups and saves EXACTLY as it did before.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planUpload, buildBatches, checkOrders, primeOf, splitPrime } from '../src/lib/dispatch.js'

const o = (ref, code, carrier = 'Evri', extra = {}) => ({
  slip: { channelRef: ref, items: [{ code, name: code, qty: 1 }] },
  labels: [{ pageIndex: 0, carrier, service: 'Next Day', refs: [ref], postcode: 'AB1 2CD' }], ...extra,
})
const maps = ['SALT', 'JUG'].map(c => ({ item_key: `${c}x1`, label_name: c, parcels: 1 }))
const orders = [o('026-1111111-1111111', 'SALT'), o('026-2222222-2222222', 'SALT'), o('026-3333333-3333333', 'JUG'), o('026-4444444-4444444', 'SALT', 'DHL')]
const prime = (refs = [], all = false, postcodes = []) => ({ refs: new Set(refs), postcodes: new Set(postcodes), all, checked: true })

test('with nothing Prime, an upload plans exactly as it did before', () => {
  const before = planUpload(orders, maps)
  for (const p of [null, prime(), prime(['02699999999999999'])]) {
    const now = planUpload(orders, maps, { prime: p })
    assert.deepEqual(now.batches, before.batches); assert.deepEqual(now.checked, before.checked)
    assert.deepEqual(now.heldBack, before.heldBack); assert.equal(now.needsYou, before.needsYou)
    assert.ok(now.batches.every(b => !('prime' in b)), 'no group carries a Prime flag')
    assert.ok(now.checked.every(x => !('prime' in x)))
  }
  assert.deepEqual(splitPrime(before.batches, before.heldBack).map(x => [x.prime, x.batches.length]), [[false, before.batches.length]], 'and saves as the one batch')
})

test('HELM decides which orders are Prime; the tick is the backup', () => {
  const order = orders[0]
  assert.equal(primeOf(order, null), null)
  assert.equal(primeOf(order, prime(['02611111111111111'])), 'helm')
  assert.equal(primeOf(order, prime([], true)), 'upload')
  assert.equal(primeOf(order, prime(['02611111111111111'], true)), 'both')
  assert.equal(primeOf(order, prime(['02622222222222222'])), null)
  // A postcode only speaks for a label with no order number at all
  assert.equal(primeOf(order, prime([], false, ['AB12CD'])), null)
  assert.equal(primeOf({ slip: null, labels: [{ postcode: 'ab1 2cd' }] }, prime([], false, ['AB12CD'])), 'helm')
  assert.equal(primeOf({ slip: null, labels: [{ postcode: 'ZZ9 9ZZ' }] }, prime([], false, ['AB12CD'])), null)
})

test('Prime orders are grouped apart and save as a batch of their own, Prime first', () => {
  const plan = planUpload(orders, maps, { prime: prime(['02611111111111111']) })
  assert.deepEqual(plan.checked.map(x => !!x.prime), [true, false, false, false])
  assert.equal(plan.checked[0].primeSource, 'helm')
  // The same product, same carrier: the Prime parcel is its own group, the other SALT parcel stays where it was
  const salt = plan.batches.filter(b => b.label_name === 'SALT' && b.carrier === 'Evri')
  assert.equal(salt.length, 2)
  assert.deepEqual(salt.map(b => [!!b.prime, b.labels.length]).sort(), [[false, 1], [true, 1]])
  assert.deepEqual(salt.find(b => b.prime).labels.map(l => l.seq), [1], 'numbered within its own group')
  const parts = splitPrime(plan.batches, plan.heldBack)
  assert.deepEqual(parts.map(x => x.prime), [true, false])
  assert.equal(parts[0].batches.length, 1); assert.equal(parts[1].batches.length, 3)
  assert.equal(parts[0].batches.reduce((n, b) => n + b.labels.length, 0) + parts[1].batches.reduce((n, b) => n + b.labels.length, 0), 4, 'every label is in exactly one batch')
})

test('a whole file ticked Prime is one Prime batch; a held Prime order waits in the Prime batch', () => {
  const all = planUpload(orders, maps, { prime: prime([], true) })
  assert.ok(all.checked.every(x => x.prime && x.primeSource === 'upload'))
  assert.deepEqual(splitPrime(all.batches, all.heldBack).map(x => x.prime), [true])
  // An order with nothing set up for it is held; if it is Prime it is held with the Prime batch
  const withNew = [...orders, o('026-5555555-5555555', 'NEWITEM')]
  const plan = planUpload(withNew, maps, { prime: prime(['02655555555555555', '02611111111111111']) })
  const parts = splitPrime(plan.batches, plan.heldBack)
  assert.deepEqual(parts.map(x => [x.prime, x.held.length]), [[true, 1], [false, 0]])
  // Marking Prime never changes what is checked or held
  assert.deepEqual(plan.checked.map(x => x.level), planUpload(withNew, maps).checked.map(x => x.level))
  assert.deepEqual(splitPrime([], []), [{ prime: false, batches: [], held: [] }])
})

test('the checks see the same orders whether or not Prime is known', () => {
  const a = checkOrders(orders, maps), b = planUpload(orders, maps, { prime: prime(['02611111111111111'], true) }).checked
  assert.deepEqual(b.map(({ prime: _p, primeSource: _s, ...rest }) => rest), a.map(x => ({ ...x })))
  assert.equal(buildBatches(a).length, 3)
})

// ── v2.88.0 / v2.89.0: Amazon Buy Shipping — the label, and what Amazon's own packing slip says ───────────────────────
import { pairPages, manualSlip, parseAmazonSlip, looksAmazonSlip, amazonAsks, applyAmazon, pageKind } from '../src/lib/dispatch.js'
const picLabel = (i, extra = {}) => ({ index: i, items: [], ocr: 'ADRIAN MARSH LIMITED Marketplace\nEVRi\nNDAY', ocrAddress: 'Destination :\nTest Buyer\nAB1 2CD', hasPicture: true, stamp: { lineY: 153 }, ...extra })
const SLIP = `Ship To:
Order ID: 206-2662025-6558741/Prime
Thank you for buying from Adrian Marsh on Amazon Marketplace.
Shipping Address: Order Date:
Product Details [Unit price | Order Totals
1 Swirl Liquid Jewellery Cleaner with [£3.95 Item subtotal £3.95
Basket for Silver, Gold, Platinum, Ge-
SKU: Swirl Liquid Jewellery Cleaner-
ASIN:BOCK8KCGD9
Condition: New
Listing ID: Item total £3.95 |
Order Item 1D:70760261959842
2 Peacock Salt 10KG Bag White De-lc- (£8.65 Item subtotal £17.30
SKU:Peacock Salt 10KG Bag-ND
ASIN:B08H5CZ2LP
Condition: New
Order Item 1D:70777330586082
Grand Total: £21.25
Return and replace your item`

test("Amazon's packing slip is read as it really comes out of text recognition", () => {
  assert.ok(looksAmazonSlip(SLIP)); assert.ok(!looksAmazonSlip('Adrian Marsh LTD Marketplace EVRi NDAY Destination : Test Buyer'))
  const p = parseAmazonSlip(SLIP)
  assert.deepEqual(p.refs, ['206-2662025-6558741'])
  assert.deepEqual(p.lines, [{ qty: 1, sku: 'Swirl Liquid Jewellery Cleaner', asin: 'BOCK8KCGD9' }, { qty: 2, sku: 'Peacock Salt 10KG Bag-ND', asin: 'B08H5CZ2LP' }])
  // a quantity that can't be read is left empty, never guessed
  assert.equal(parseAmazonSlip(SLIP.replace('\n1 Swirl', '\nl Swirl')).lines[0].qty, null)
})

test("Amazon's slip page belongs to the label before it and is never a label itself", () => {
  const info = { ref: '206-2662025-6558741', sure: true, lines: parseAmazonSlip(SLIP).lines }
  const slipPage = { index: 1, items: [], ocr: SLIP, hasPicture: true, stamp: {}, amazonSlip: info }
  assert.equal(pageKind(slipPage), 'amazon-slip')
  const { orders } = pairPages([picLabel(0), slipPage])
  assert.equal(orders.length, 1, 'one order, not a label and a page to cancel')
  assert.equal(orders[0].labels.length, 1); assert.equal(orders[0].labels[0].amazon.ref, '206-2662025-6558741'); assert.equal(orders[0].labels[0].amazon.slipPage, 1)
  // an ordinary label with no slip is exactly what it was
  const plain = pairPages([picLabel(0)]).orders[0]
  assert.ok(!('amazon' in plain.labels[0])); assert.equal(manualSlip(plain.labels[0], { items: [{ code: 'X', qty: 1 }] }).channelRef, '')
  // a full sheet: the label page itself carries what the slip beside it said
  const crop = { left: 87.5, bottom: 108, right: 465.5, top: 360, turn: -90 }
  const sheet = pairPages([picLabel(0, { amazon: info, stamp: { lineY: 153, crop } })]).orders[0]
  assert.equal(sheet.labels[0].amazon.ref, info.ref); assert.deepEqual(sheet.labels[0].stamp.crop, crop)
})

test('HELM first, then the listing for one click, then a person', () => {
  const info = { ref: '206-2662025-6558741', sure: true, lines: parseAmazonSlip(SLIP).lines }
  const { orders } = pairPages([picLabel(0), { index: 1, items: [], ocr: SLIP, hasPicture: true, stamp: {}, amazonSlip: info }, picLabel(2)])
  assert.deepEqual(amazonAsks(orders), [{ ref: info.ref, lines: info.lines }])
  const helmItems = [{ code: 'SWIRL', name: 'Swirl', qty: 1 }, { code: 'SALT10', name: 'Salt', qty: 2 }]
  // 1) HELM has the order: a slip made from HELM's record; the order number is now trusted
  const a = applyAmazon(orders, { [info.ref]: { helm: { items: helmItems, prime: true }, listing: { items: helmItems, lines: [] } } })
  assert.equal(a[0].slip.from, 'helm'); assert.equal(a[0].slip.channelRef, info.ref); assert.deepEqual(a[0].slip.items, helmItems)
  assert.equal(a[0].labels[0].slipRef, info.ref); assert.equal(a[0].slip.postcode, 'AB1 2CD')
  assert.equal(a[1], orders[1], 'the other label is the same object, untouched')
  const maps = [{ item_key: 'SWIRLx1+SALT10x2', label_name: 'SWIRL + 2 SALT', parcels: 1 }]
  const planned = planUpload(a, maps, { prime: { refs: new Set(['20626620256558741']), postcodes: new Set(), all: false } })
  assert.equal(planned.checked[0].prime, true, 'and HELM can say it is Prime')
  // 2) not in HELM, but the portal has the listing: a suggestion, nothing decided
  const b = applyAmazon(orders, { [info.ref]: { helm: null, listing: { items: helmItems, lines: [{ listing: 'Swirl', asin: 'B0CK8KCGD9', qty: 1 }] } } })
  assert.equal(b[0].slip, null); assert.deepEqual(b[0].suggest.items, helmItems); assert.equal(b[0].suggest.ref, info.ref)
  assert.equal(planUpload(b, maps).needsYou, 2, 'it waits for a person: one click for this one')
  assert.equal(manualSlip(b[0].labels[0], { items: b[0].suggest.items, reason: 'manual', amazonRef: b[0].suggest.ref }).channelRef, info.ref)
  assert.equal(manualSlip(b[0].labels[0], { items: b[0].suggest.items, reason: 'manual' }).channelRef, '', 'an order number nobody confirmed is not kept')
  // 3) neither, or the lookup failed: exactly as a label with no slip always was
  for (const f of [{ [info.ref]: { helm: null, listing: null } }, {}, null]) { const c = applyAmazon(orders, f); assert.equal(c[0], orders[0]); assert.equal(c[1], orders[1]) }
  // a slip whose lines weren't read the same way twice is only ever checked against HELM
  assert.deepEqual(amazonAsks([{ slip: null, labels: [{ amazon: { ...info, sure: false } }] }]), [{ ref: info.ref, lines: [] }])
})
